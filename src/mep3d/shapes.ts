import { BufferAttribute, BufferGeometry, Quaternion, Vector3 } from 'three';
import { isCeilShape, isEdgeWallShape, isFloorShape, type Shape } from './types';

/**
 * 各形状の単位ジオメトリ。UV は [0,1]。表は反時計回り（DEC-26。Godot 版とは一致しない）。
 */

const HALF = 0.5;

/** 上面 4 隅の高さ。0 が床、1 が天井。上から反時計回り、(−X,−Z) 始まり。 */
const SLOPE_CORNER_HEIGHTS: Partial<Record<Shape, number[]>> = {
  slope: [1, 1, 0, 0],
  slope_corner: [1, 0, 0, 0],
  slope_corner_in: [1, 1, 0, 1],
};

/**
 * 面 1 枚の形の 4 隅の高さ（DEC-127）。影を落とすときの板の傾きに使う。
 * 上向き面はマスの底からの高さ、下向き面はマスの天からの下がり（＝天面に貼る板）。
 * 棟・谷はマスの中で折れるので、平均の高さの平らな板で近似する。
 * 三角や妻壁は輪郭が欠けるが、影ではマスいっぱいの板として扱う。
 */
export function plateCornerHeights(shape: Shape): number[] | undefined {
  if (isCeilShape(shape)) return [1, 1, 1, 1];
  if (!isFloorShape(shape)) return undefined;
  const tail = shape.slice('floor_'.length);
  if (tail.startsWith('ramp2_')) return RAMP2_HEIGHTS[tail.slice('ramp2_'.length)];
  if (tail.startsWith('ramp_')) return RAMP_HEIGHTS[tail.slice('ramp_'.length)];
  if (tail.startsWith('slant_')) return SLANT_HEIGHTS[tail.slice('slant_'.length)];
  // 折れ面は 4 隅が同一平面に無いので、双一次の近似になる（DEC-352 / DEC-353）。
  // 尾根（南西—北東）の中央は本当は 0.5 だが、ここでは 0.25 にしかならない。影と当たりだけの話。
  if (tail.startsWith('fold_')) return FOLD_HEIGHTS[tail.slice('fold_'.length)];
  // 棟・谷はマスの中で折れるので、`plateHalves()` で 2 枚に割る。ここでは平らな近似を返す。
  const fold = ridgeFold(shape);
  if (fold) return [fold.lift + fold.rise / 2, fold.lift + fold.rise / 2, fold.lift + fold.rise / 2, fold.lift + fold.rise / 2];
  return [0, 0, 0, 0];
}

/**
 * 4 隅の高さを R に合わせて並べ替える（DEC-210）。
 * 絵の回転は **+Y まわり −90°×歩数**（`loader` のインスタンス姿勢）。
 * 回転前の隅 j は回転後の隅 j+r の位置へ来るので、回転後の隅 i の高さは回転前の i−r。
 * `loader.rotateCorners` は逆向きなので流用しない。
 */
export function rotatePlate(heights: readonly number[], rotation: number): Float32Array {
  const r = ((rotation % 4) + 4) % 4;
  const out = new Float32Array(4);
  for (let i = 0; i < 4; i += 1) out[i] = heights[(i - r + 4) % 4] ?? 0;
  return out;
}

/**
 * マス内 (fx, fz) の高さ。`fx` は東、`fz` は南へ 0..1。並びは [nw, ne, se, sw]。
 * 隅どうしを双一次で混ぜる。平らな床はどこでも 0 になる。
 */
export function plateHeight(plate: ArrayLike<number>, fx: number, fz: number): number {
  const north = plate[0] + (plate[1] - plate[0]) * fx;
  const south = plate[3] + (plate[2] - plate[3]) * fx;
  return north + (south - north) * fz;
}

/** 高さが全部 0 の板。平らな床はこれを共有する。 */
export const FLAT_PLATE = new Float32Array(4);

/** 棟・谷の折れ方（DEC-128）。`rise` は中央の高さ、`lift` は板ごと持ち上げる量、`peak` は山なら真。 */
export function ridgeFold(shape: Shape): { rise: number; lift: number; peak: boolean } | undefined {
  if (!isFloorShape(shape) && !isCeilShape(shape)) return undefined;
  const tail = shape.slice(shape.indexOf('_') + 1);
  if (tail === 'ridge') return { rise: 1, lift: 0, peak: true };
  if (tail === 'ridge_half') return { rise: 0.5, lift: 0, peak: true };
  if (tail === 'ridge_quarter') return { rise: 0.25, lift: 0, peak: true };
  if (tail === 'ridge_quarter_up') return { rise: 0.25, lift: 0.5, peak: true };
  if (tail === 'valley') return { rise: 0.5, lift: 0, peak: false };
  return undefined;
}

/**
 * 棟・谷を左右 2 枚の板に割る（DEC-128）。折れ目はマスの中央。
 * 影を 1 枚の平らな板で近似すると、隣の坂と高さが合わず継ぎ目が空く。
 * 戻り値の `foot` はマス内の割合（0..1）。回転はマスの中で 90 度ずつ回す。
 */
export function plateHalves(
  shape: Shape,
  rotation: number,
): Array<{ foot: { x0: number; z0: number; x1: number; z1: number }; corners: number[] }> | undefined {
  const fold = ridgeFold(shape);
  if (!fold) return undefined;
  const mid = fold.peak ? fold.rise : 0;
  const side = fold.peak ? 0 : fold.rise;
  const steps = ((rotation % 4) + 4) % 4;
  const alongZ = steps % 2 === 0;
  const lift = fold.lift;
  if (alongZ) {
    // 折れ目は Z 方向。西半分と東半分。
    return [
      { foot: { x0: 0, z0: 0, x1: 0.5, z1: 1 }, corners: [side + lift, mid + lift, mid + lift, side + lift] },
      { foot: { x0: 0.5, z0: 0, x1: 1, z1: 1 }, corners: [mid + lift, side + lift, side + lift, mid + lift] },
    ];
  }
  // 折れ目は X 方向。北半分と南半分。
  return [
    { foot: { x0: 0, z0: 0, x1: 1, z1: 0.5 }, corners: [side + lift, side + lift, mid + lift, mid + lift] },
    { foot: { x0: 0, z0: 0.5, x1: 1, z1: 1 }, corners: [mid + lift, mid + lift, side + lift, side + lift] },
  ];
}

/** 斜面・隅の 4 隅の高さ。無ければ箱。 */
export function slopeCornerHeights(shape: Shape): number[] | undefined {
  const heights = SLOPE_CORNER_HEIGHTS[shape];
  return heights ? heights.slice() : undefined;
}

const cache = new Map<Shape, BufferGeometry>();

/** `floor_gable_half` → `half`。接尾辞が無い（＝急）ときは `steep`（DEC-110）。 */
function gableKey(shape: string, head: string): string {
  const tail = shape.slice(head.length).replace(/^_/, '');
  return tail || 'steep';
}

export function geometryFor(shape: Shape): BufferGeometry {
  const hit = cache.get(shape);
  if (hit) return hit;

  let geometry: BufferGeometry;
  switch (shape) {
    case 'floor':
      geometry = floorGeometry(false);
      break;
    case 'ceil':
      geometry = floorGeometry(true);
      break;
    case 'floor_ramp_e':
    case 'floor_ramp_w':
    case 'floor_ramp_n':
    case 'floor_ramp_s':
      geometry = rampGeometry(RAMP_HEIGHTS[shape.slice('floor_ramp_'.length)], false);
      break;
    case 'floor_ramp2_lo':
    case 'floor_ramp2_hi':
    case 'floor_ramp2_lo_flip':
    case 'floor_ramp2_hi_flip':
    case 'floor_ramp2_n_lo':
    case 'floor_ramp2_n_hi':
    case 'floor_ramp2_s_lo':
    case 'floor_ramp2_s_hi':
      geometry = rampGeometry(RAMP2_HEIGHTS[shape.slice('floor_ramp2_'.length)], false);
      break;
    case 'ceil_ramp2_lo':
    case 'ceil_ramp2_hi':
    case 'ceil_ramp2_lo_flip':
    case 'ceil_ramp2_hi_flip':
      geometry = rampGeometry(RAMP2_HEIGHTS[shape.slice('ceil_ramp2_'.length)], true);
      break;
    case 'floor_slant_nwse':
    case 'floor_slant_nesw':
      geometry = rampGeometry(SLANT_HEIGHTS[shape.slice('floor_slant_'.length)], false);
      break;
    case 'floor_fold_ne':
    case 'floor_fold_nw': {
      const fold = shape.slice('floor_fold_'.length);
      geometry = foldGeometry(FOLD_HEIGHTS[fold], FOLD_SW_NE[fold]);
      break;
    }
    case 'floor_ridge':
      geometry = ridgeGeometry(true, false);
      break;
    case 'floor_ridge_half':
      geometry = ridgeGeometry(true, false, 0.5);
      break;
    case 'ceil_ridge_half':
      geometry = ridgeGeometry(true, true, 0.5);
      break;
    case 'floor_ridge_quarter':
      geometry = ridgeGeometry(true, false, 0.25);
      break;
    case 'floor_ridge_quarter_up':
      geometry = ridgeGeometry(true, false, 0.25, 0.5);
      break;
    case 'ceil_ridge_quarter_up':
      geometry = ridgeGeometry(true, true, 0.25, 0.5);
      break;
    case 'floor_gable':
    case 'floor_gable_half':
    case 'floor_gable_quarter':
      geometry = polyGeometry(GABLE_SHAPES[gableKey(shape, 'floor_gable')], false);
      break;
    case 'ceil_gable':
    case 'ceil_gable_half':
    case 'ceil_gable_quarter':
      geometry = polyGeometry(GABLE_SHAPES[gableKey(shape, 'ceil_gable')], true);
      break;
    case 'wall_gable':
    case 'wall_gable_half':
    case 'wall_gable_quarter':
      geometry = wallPolyGeometry(GABLE_SHAPES[gableKey(shape, 'wall_gable')]);
      break;
    case 'ceil_ridge_quarter':
      geometry = ridgeGeometry(true, true, 0.25);
      break;
    case 'floor_valley':
      geometry = ridgeGeometry(false, false);
      break;
    case 'ceil_ridge':
      geometry = ridgeGeometry(true, true);
      break;
    case 'ceil_valley':
      geometry = ridgeGeometry(false, true);
      break;
    case 'ceil_slant_nwse':
    case 'ceil_slant_nesw':
      geometry = rampGeometry(SLANT_HEIGHTS[shape.slice('ceil_slant_'.length)], true);
      break;
    case 'floor_tri2_a_tip':
    case 'floor_tri2_a_base':
    case 'floor_tri2_b_tip':
    case 'floor_tri2_b_base':
    case 'floor_tri2_a_tip_flip':
    case 'floor_tri2_a_base_flip':
    case 'floor_tri2_b_tip_flip':
    case 'floor_tri2_b_base_flip':
      geometry = polyGeometry(TRI2_SHAPES[shape.slice('floor_tri2_'.length)], false);
      break;
    case 'ceil_tri2_a_tip':
    case 'ceil_tri2_a_base':
    case 'ceil_tri2_b_tip':
    case 'ceil_tri2_b_base':
    case 'ceil_tri2_a_tip_flip':
    case 'ceil_tri2_a_base_flip':
    case 'ceil_tri2_b_tip_flip':
    case 'ceil_tri2_b_base_flip':
      geometry = polyGeometry(TRI2_SHAPES[shape.slice('ceil_tri2_'.length)], true);
      break;
    case 'ceil_ramp_e':
    case 'ceil_ramp_w':
    case 'ceil_ramp_n':
    case 'ceil_ramp_s':
      geometry = rampGeometry(RAMP_HEIGHTS[shape.slice('ceil_ramp_'.length)], true);
      break;
    case 'floor_tri_nw':
    case 'floor_tri_ne':
    case 'floor_tri_se':
    case 'floor_tri_sw':
      geometry = floorTriGeometry(shape.slice('floor_tri_'.length), false);
      break;
    case 'ceil_tri_nw':
    case 'ceil_tri_ne':
    case 'ceil_tri_se':
    case 'ceil_tri_sw':
      geometry = floorTriGeometry(shape.slice('ceil_tri_'.length), true);
      break;
    case 'wall_tri2_a_tip':
    case 'wall_tri2_a_base':
    case 'wall_tri2_b_tip':
    case 'wall_tri2_b_base':
    case 'wall_tri2_a_tip_flip':
    case 'wall_tri2_a_base_flip':
    case 'wall_tri2_b_tip_flip':
    case 'wall_tri2_b_base_flip':
      geometry = wallPolyGeometry(TRI2_SHAPES[shape.slice('wall_tri2_'.length)]);
      break;
    case 'wall_tri_tl':
    case 'wall_tri_tr':
    case 'wall_tri_br':
    case 'wall_tri_bl':
      geometry = wallTriGeometry(shape.slice('wall_tri_'.length));
      break;
    case 'floor_circle':
      geometry = roundFloorGeometry(false);
      break;
    case 'floor_round':
      geometry = roundFloorGeometry(true, ROUND_WALL_NORTH);
      break;
    case 'wall_round':
      geometry = roundWallGeometry(true, ROUND_WALL_NORTH);
      break;
    case 'wall_cylinder':
      geometry = roundWallGeometry(false);
      break;
    case 'wall_diag_nwse':
      geometry = diagWallGeometry(true);
      break;
    case 'wall_diag_nesw':
      geometry = diagWallGeometry(false);
      break;
    case 'wall':
    case 'billboard':
    case 'billboard_fixed':
      geometry = wallGeometry();
      break;
    case 'billboard_deep':
    case 'billboard_fixed_deep':
      geometry = spriteStackGeometry(SPRITE_STACK_COPIES, SPRITE_STACK_GAP);
      break;
    case 'billboard_flat':
    case 'billboard_flat_follow':
      geometry = floorGeometry(false);
      break;
    case 'box':
      geometry = boxGeometry();
      break;
    case 'slope':
    case 'slope_corner':
    case 'slope_corner_in':
      geometry = slopedGeometry(SLOPE_CORNER_HEIGHTS[shape] as number[]);
      break;
    default:
      geometry = floorGeometry(false);
  }
  cache.set(shape, geometry);
  return geometry;
}

/**
 * 同じ面に重なるレイヤーを法線方向へずらす量。共面だとどちらが手前か決まらない。
 */
export const LAYER_DEPTH_STEP = 0.003;

/** proto.offset の分母。32px チップなら 1 ステップ = 1px。 */
export const OFFSET_STEPS = 32;
/** プレハブ箱の見た目の上限。32 セル。 */
export const THICKNESS_MAX = OFFSET_STEPS * 32;

/** assets version 1 は 1/16。当時の数値は今の倍の意味。 */
const LEGACY_OFFSET_STEPS = 16;

/** アセットファイルの offset が使う分母。 */
export function offsetStepsFor(assetsVersion: number): number {
  return assetsVersion >= 2 ? OFFSET_STEPS : LEGACY_OFFSET_STEPS;
}

/** JSON のずれをワールドのセル単位にする。Z は奥が＋、ワールド +Z は南なので符号を反転する。 */
export function offsetInCells(offset: [number, number, number], denom: number, out: Vector3): Vector3 {
  return out.set(offset[0] / denom, offset[1] / denom, -offset[2] / denom);
}

/** ブロックの厚み。省略・±32 はマスいっぱい。符号は押し込む方向（DEC-41）。 */
function clampThickness(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return OFFSET_STEPS;
  return Math.max(1, Math.min(THICKNESS_MAX, Math.round(Math.abs(value))));
}

function clampSignedThickness(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return OFFSET_STEPS;
  const sign: 1 | -1 = value < 0 ? -1 : 1;
  return sign * clampThickness(value);
}

/** 数値は Y のみ。配列は [Y, Z] または [Y, Z, X]。省略は天井→床と手前→奥と左→右。 */
export function readThickness(
  raw: number | [number, number] | [number, number, number] | undefined,
): [number, number, number] {
  if (Array.isArray(raw) && raw.length >= 3) {
    return [clampSignedThickness(raw[0]), clampSignedThickness(raw[1]), clampSignedThickness(raw[2])];
  }
  if (Array.isArray(raw) && raw.length >= 2) return [clampSignedThickness(raw[0]), clampSignedThickness(raw[1]), OFFSET_STEPS];
  if (typeof raw === 'number') return [clampSignedThickness(raw), OFFSET_STEPS, OFFSET_STEPS];
  return [-OFFSET_STEPS, OFFSET_STEPS, OFFSET_STEPS];
}

/** 箱の一辺（セル単位）。符号は見ない。 */
export function boxHeight(thickness: number | undefined): number {
  return clampThickness(thickness) / OFFSET_STEPS;
}

/** 軸の小さい側を残すときの、中心からのずれ（セル単位）。 */
export function boxThicknessLift(thickness: number | undefined): number {
  return (boxHeight(thickness) - 1) * 0.5;
}

/** 回転後の XZ 外形。＋Z は南側から奥、−Z は奥から手前。＋X は左から右、−X は右から左。ブロックは回さない。 */
export function boxFootprint(
  cellX: number,
  cellZ: number,
  thicknessZ: number,
  rotation: number,
  thicknessX = OFFSET_STEPS,
): { x0: number; z0: number; x1: number; z1: number } {
  const depth = boxHeight(thicknessZ);
  const width = boxHeight(thicknessX);
  if (Math.abs(depth - 1) < 1e-6 && Math.abs(width - 1) < 1e-6) {
    return { x0: cellX, z0: cellZ, x1: cellX + 1, z1: cellZ + 1 };
  }
  const cx = cellX + 0.5;
  const cz = cellZ + 0.5;
  const keepNorth = thicknessZ >= 0;
  const keepEast = thicknessX >= 0;
  const lz0 = keepNorth ? -0.5 : 0.5 - depth;
  const lz1 = keepNorth ? -0.5 + depth : 0.5;
  const lx0 = keepEast ? 0.5 - width : -0.5;
  const lx1 = keepEast ? 0.5 : -0.5 + width;
  const corners: Array<[number, number]> = [
    [lx0, lz0],
    [lx1, lz0],
    [lx1, lz1],
    [lx0, lz1],
  ];
  const steps = ((rotation % 4) + 4) % 4;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [lx, lz] of corners) {
    let x = lx;
    let z = lz;
    for (let i = 0; i < steps; i += 1) {
      const nx = -z;
      z = x;
      x = nx;
    }
    x0 = Math.min(x0, cx + x);
    x1 = Math.max(x1, cx + x);
    z0 = Math.min(z0, cz + z);
    z1 = Math.max(z1, cz + z);
  }
  return { x0, z0, x1, z1 };
}

/** 見える面の向き。レイヤーずらし用。体積はずらさない。 */
export function overlayNormal(shape: Shape): Vector3 {
  if (isFloorShape(shape) || shape === 'billboard_flat' || shape === 'billboard_flat_follow') {
    return new Vector3(0, 1, 0);
  }
  if (isCeilShape(shape)) return new Vector3(0, -1, 0);
  if (
    isEdgeWallShape(shape) ||
    shape === 'billboard' ||
    shape === 'billboard_fixed' ||
    shape === 'billboard_deep' ||
    shape === 'billboard_fixed_deep'
  ) {
    return new Vector3(0, 0, 1);
  }
  return new Vector3(0, 0, 0);
}

/** マス中心からのメッシュ位置。 */
export function offsetFor(shape: Shape): Vector3 {
  // 形が増えても取りこぼさないよう、`types.ts` の仲間分けで決める（DEC-98）。
  if (isFloorShape(shape) || shape === 'billboard_flat' || shape === 'billboard_flat_follow') {
    return new Vector3(0, -HALF, 0);
  }
  if (isCeilShape(shape)) return new Vector3(0, HALF, 0);
  if (isEdgeWallShape(shape)) return new Vector3(0, 0, HALF);
  return new Vector3(0, 0, 0);
}

const WALL_Y = new Vector3(0, 1, 0);

/**
 * 壁の rot はカードのヨーではない。南が既定。東は東辺で 90°。北は奥へ平行移動。
 */
export function applyWallPose(rotation: number, offset: Vector3, quaternion: Quaternion): void {
  const steps = ((rotation % 4) + 4) % 4;
  if (steps === 0) {
    offset.set(0, 0, HALF);
    quaternion.identity();
    return;
  }
  if (steps === 1) {
    offset.set(HALF, 0, 0);
    quaternion.setFromAxisAngle(WALL_Y, Math.PI / 2);
    return;
  }
  if (steps === 2) {
    offset.set(0, 0, -HALF);
    quaternion.identity();
    return;
  }
  offset.set(-HALF, 0, 0);
  quaternion.setFromAxisAngle(WALL_Y, Math.PI / 2);
}

function floorGeometry(flipped: boolean): BufferGeometry {
  const positions = [-HALF, 0, -HALF, HALF, 0, -HALF, HALF, 0, HALF, -HALF, 0, HALF];
  const normal = flipped ? [0, -1, 0] : [0, 1, 0];
  const indices = flipped ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  return build(positions, repeat(normal, 4), quadUvs(), indices);
}

/**
 * 四隅のどれを落とすか。名前は**直角の隅**なので、対角の隅を落とす。
 * 隅の並びは床が (−X,−Z) (+X,−Z) (+X,+Z) (−X,+Z)、壁が 左上 右上 右下 左下。
 * どちらも UV は (0,0) (1,0) (1,1) (0,1) なので、同じ表で扱える。
 */
const TRI_KEEP: Record<string, [number, number, number]> = {
  // 床: nw=(−X,−Z) 隅が直角 → (+X,+Z) を落とす
  nw: [0, 1, 3],
  ne: [0, 1, 2],
  se: [1, 2, 3],
  sw: [0, 2, 3],
  // 壁: tl=左上 隅が直角 → 右下を落とす
  tl: [0, 1, 3],
  tr: [0, 1, 2],
  br: [1, 2, 3],
  bl: [0, 2, 3],
};

/** 四角形と同じ向きで巻く三角形の並び。UV 空間の向きを四角形と揃えてある。 */
function triIndices(keep: [number, number, number]): number[] {
  const key = keep.join('');
  if (key === '012') return [0, 2, 1];
  if (key === '023') return [0, 3, 2];
  if (key === '013') return [0, 3, 1];
  return [1, 3, 2];
}

/** 隅を 1 つ落とした床・天井。落とした隅の頂点はそのまま置き、面だけ張らない。 */
function floorTriGeometry(corner: string, flipped: boolean): BufferGeometry {
  const positions = [-HALF, 0, -HALF, HALF, 0, -HALF, HALF, 0, HALF, -HALF, 0, HALF];
  const normal = flipped ? [0, -1, 0] : [0, 1, 0];
  const keep = TRI_KEEP[corner] ?? [0, 1, 2];
  const indices = triIndices(keep);
  return build(positions, repeat(normal, 4), quadUvs(), flipped ? [...indices].reverse() : indices);
}

/** 隅を 1 つ落とした壁。板の向きは `wall` と同じ。 */
function wallTriGeometry(corner: string): BufferGeometry {
  const positions = [-HALF, HALF, 0, HALF, HALF, 0, HALF, -HALF, 0, -HALF, -HALF, 0];
  const keep = TRI_KEEP[corner] ?? [0, 1, 2];
  return build(positions, repeat([0, 0, 1], 4), quadUvs(), triIndices(keep));
}

/**
 * 円柱の分割数（DEC-361 / DEC-362）。半円は 8 枚、丸ごとはその倍の 16 枚。
 * 増やすほど滑らかになるが、HD-2D の絵では 8 で足りる。
 */
const ROUND_WALL_SEGMENTS = 8;

/**
 * 半円柱を北へずらす量（DEC-362）。**16px＝半マス**（1 ステップ = 1/32 マス）。
 * ずらす前は弧がマスの南半分に居て、平らな側がマスの真ん中を通っていた。
 * 半マス北へ寄せると**平らな側が北の面**に乗り、膨らみがマスの真ん中まで来る。
 * ずらすのは半円だけ。丸ごとの円柱はマスの中心に据える。
 */
const ROUND_WALL_NORTH = -HALF;

/**
 * 縦に立つ円柱（DEC-361 / DEC-362）。マスの中心を軸に、半径 0.5 マスの円を Y へ伸ばす。
 *
 * `half` が真なら**南向きの半分**だけ（弧の両端は西と東の面、頂は南）。
 * さらに `shift` のぶん Z へずらす——半円は半マス北へ寄せて、平らな側を北の面に乗せる。
 * 辺ではなくマスの中心に据えるので、R では本当に回る（`isCentreWallShape`）。
 *
 * 法線は半径の向きそのもの（頂点ごと）。面ごとに折ると板の集まりに見えるが、
 * 半径で滑らかにすると柱らしい明暗の回り込みが出る。
 * UV は弧に沿って左から右へ。絵が柱に**巻き付いて**見える。
 */
function roundWallGeometry(half: boolean, shift = 0): BufferGeometry {
  const segments = half ? ROUND_WALL_SEGMENTS : ROUND_WALL_SEGMENTS * 2;
  const sweep = half ? Math.PI : Math.PI * 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // 半円は −90°→+90°、丸ごとは南から一周。x は西から東へ、z は南へ張り出す。
    const angle = (t - 0.5) * sweep;
    const nx = Math.sin(angle);
    const nz = Math.cos(angle);
    const x = nx * HALF;
    const z = nz * HALF + shift;
    positions.push(x, HALF, z, x, -HALF, z);
    normals.push(nx, 0, nz, nx, 0, nz);
    uvs.push(t, 0, t, 1);
  }
  for (let i = 0; i < segments; i += 1) {
    const at = i * 2;
    // 巻き順は `wallGeometry` と同じで、表が外を向く。
    indices.push(at, at + 1, at + 2, at + 2, at + 1, at + 3);
  }
  return build(positions, normals, uvs, indices);
}

/**
 * 上を向いた円（DEC-371）。マスの中心を軸に半径 0.5 マスの円盤を寝かせる。
 *
 * `half` が真なら**半円**。`shift` のぶん Z へずらすので、`ROUND_WALL_NORTH` を渡すと
 * **平らな側が北の面に乗る**——半円柱（DEC-362）とまったく同じ足あとになり、柱を丸い床の上に
 * そのまま立てられる。R で回るのは他の床と同じ。
 *
 * UV は床と同じ**真上からの写し**（u = x + 0.5, v = z + 0.5）。壁の円柱のように弧へ沿わせると、
 * 床では絵が渦を巻いて見える。巻き順は `floorGeometry` と揃えて表を上に向ける。
 */
function roundFloorGeometry(half: boolean, shift = 0): BufferGeometry {
  const segments = half ? ROUND_WALL_SEGMENTS : ROUND_WALL_SEGMENTS * 2;
  const sweep = half ? Math.PI : Math.PI * 2;
  // 扇の要。半円は弦の真ん中（＝ずらした先の中心）に置く。
  const positions: number[] = [0, 0, shift];
  const normals: number[] = [0, 1, 0];
  const uvs: number[] = [0.5, shift + 0.5];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments - 0.5) * sweep;
    const x = Math.sin(angle) * HALF;
    const z = Math.cos(angle) * HALF + shift;
    positions.push(x, 0, z);
    normals.push(0, 1, 0);
    uvs.push(x + 0.5, z + 0.5);
    if (i > 0) indices.push(0, i, i + 1);
  }
  return build(positions, normals, uvs, indices);
}

/**
 * マスの対角線に立つ 45 度の壁。`nwse` は (−X,−Z) から (+X,+Z) へ。
 * 幅は √2 マス。マスの中心に置くので `offsetFor` は 0 のまま。
 */
function diagWallGeometry(nwse: boolean): BufferGeometry {
  const z0 = nwse ? -HALF : HALF;
  const z1 = nwse ? HALF : -HALF;
  const positions = [-HALF, HALF, z0, HALF, HALF, z1, HALF, -HALF, z1, -HALF, -HALF, z0];
  // 対角線 (1,0,±1) に垂直な水平法線。
  const k = Math.SQRT1_2;
  const normal = nwse ? [-k, 0, k] : [k, 0, k];
  return build(positions, repeat(normal, 4), quadUvs(), [0, 2, 1, 0, 3, 2]);
}

/**
 * 坂の面の 4 隅の高さ（マス）。並びは床と同じ NW, NE, SE, SW。
 * 高いほうの辺が 1、向かいの辺が 0。マスを 1 辺から向かいの辺へ斜めに切った断面と同じ。
 */
const RAMP_HEIGHTS: Record<string, number[]> = {
  e: [0, 1, 1, 0],
  w: [1, 0, 0, 1],
  // 南北へ傾く（DEC-204）。隅の並びは [nw, ne, se, sw]。北が高い＝南から北へ上る。
  n: [1, 1, 0, 0],
  s: [0, 0, 1, 1],
};

/**
 * 2 マスの板（緩い坂）の 4 隅の高さ。2 マスで 1 マス上がるので、1 マスにつき 0.5。
 * `lo` の東端と `hi` の西端が 0.5 で揃うので、横に並べると 1 枚の板になる。
 */
const RAMP2_HEIGHTS: Record<string, number[]> = {
  lo: [0, 0.5, 0.5, 0],
  hi: [0.5, 1, 1, 0.5],
  // 南北へ上る 2 マス坂（DEC-363）。`n` は北が高い、`s` は南が高い。
  // 1 マスの `ramp_n` / `ramp_s` と同じ理由で、R では絵ごと回ってしまうので形状で分ける（DEC-204）。
  n_lo: [0.5, 0.5, 0, 0],
  n_hi: [1, 1, 0.5, 0.5],
  s_lo: [0, 0, 0.5, 0.5],
  s_hi: [0.5, 0.5, 1, 1],
  // 左右反転（西へ上る）。隅の並びは [nw, ne, se, sw] なので東西を入れ替える（DEC-109）。
  lo_flip: [0.5, 0, 0, 0.5],
  hi_flip: [1, 0.5, 0.5, 1],
};

/**
 * 斜め坂の 4 隅の高さ。対角の 2 隅が 1 と 0、残りが中間の 0.5。
 * 対角へ 1 段ずつ下げて並べると平面の式が一致し、継ぎ目が消える（DEC-85）。
 */
const SLANT_HEIGHTS: Record<string, number[]> = {
  nwse: [1, 0.5, 0, 0.5],
  nesw: [0.5, 1, 0.5, 0],
};

/**
 * 2 マスの細長い直角三角形を 1 マスずつに割った形（DEC-86）。座標は (u, v)。
 * u は西→東、v は北→南。長辺は u 方向の 2 マス、短辺は v 方向の 1 マス。
 * `a` は南側が埋まる向き、`b` はその鏡像。斜辺は隣のマスの中点（v = 0.5）で継ぐ。
 */
const TRI2_SHAPES: Record<string, Array<[number, number]>> = {
  a_tip: [[0, 0], [1, 0], [1, 0.5]],
  a_base: [[0, 0], [1, 0], [1, 1], [0, 0.5]],
  b_tip: [[0, 1], [1, 1], [1, 0.5]],
  b_base: [[0, 1], [1, 1], [1, 0], [0, 0.5]],
  // 左右反転（u → 1 - u）。`a` / `b` は v 方向の鏡像なので、こちらは回転でも作れない（DEC-109）。
  a_tip_flip: [[1, 0], [0, 0], [0, 0.5]],
  a_base_flip: [[1, 0], [0, 0], [0, 1], [1, 0.5]],
  b_tip_flip: [[1, 1], [0, 1], [0, 0.5]],
  b_base_flip: [[1, 1], [0, 1], [0, 0], [1, 0.5]],
};

/**
 * 切妻の妻壁（DEC-110）。棟の下を塞ぐ形。座標は (u, v) で v は上→下。
 * 頂点はマスの上辺の中央、肩は屋根の勾配ぶんだけ下がる。肩から下はマスいっぱいに埋める。
 * 勾配の名前は棟（`*_ridge*`）と揃えてある。急は肩が下辺まで落ちるので三角形になる。
 */
const GABLE_SHAPES: Record<string, Array<[number, number]>> = {
  steep: [[0.5, 0], [1, 1], [0, 1]],
  half: [[0.5, 0], [1, 0.5], [1, 1], [0, 1], [0, 0.5]],
  // 2 マス坂だけ半マスぶん（v で 0.25）下げてある。肩の高さが 2 マス三角の
  // 高いほうの端（高さ 0.5）と揃い、そのまま隣に繋がる（DEC-115）。
  quarter: [[0.5, 0.25], [1, 0.5], [1, 1], [0, 1], [0, 0.5]],
};

/**
 * (u, v) の多角形をマス内の平らな面にする。巻きは四角形と揃える。
 * 頂点の並び順は気にしなくてよい。符号付き面積で向きを見て、必要なら裏返す。
 */
function polyGeometry(points: Array<[number, number]>, flipped: boolean): BufferGeometry {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [u0, v0] = points[i];
    const [u1, v1] = points[(i + 1) % points.length];
    area += u0 * v1 - u1 * v0;
  }
  const order = area >= 0 ? points : [...points].reverse();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [u, v] of order) {
    positions.push(u - HALF, 0, v - HALF);
    uvs.push(u, v);
  }
  const indices: number[] = [];
  for (let i = 1; i + 1 < order.length; i += 1) {
    if (flipped) indices.push(0, i, i + 1);
    else indices.push(0, i + 1, i);
  }
  const normal = flipped ? [0, -1, 0] : [0, 1, 0];
  return build(positions, repeat(normal, order.length), uvs, indices);
}

/**
 * 折れ面の 4 隅の高さ（DEC-352 / DEC-353 / DEC-354）。並びは床と同じ NW, NE, SE, SW。
 * 上がるのは 1 隅だけで、そこが尾根の高いほうの端になる。
 * `ne` は北東（画面では ／）、`nw` はその左右反転で北西（＼）。
 * 尾根はその隅と**向かいの隅**を結ぶ対角線。だから隅が変われば割る対角線も変わる。
 */
const FOLD_HEIGHTS: Record<string, number[]> = {
  ne: [0, 1, 0, 0],
  nw: [1, 0, 0, 0],
};

/** 折れ面の尾根がどちらの対角線か。`ne` は南西—北東、`nw` は北西—南東。 */
const FOLD_SW_NE: Record<string, boolean> = {
  ne: true,
  nw: false,
};

/**
 * 対角線で折り曲げた 1 枚の面（DEC-352 / DEC-353）。
 *
 * 折り目は対角線で、そこが尾根になる**山折り**。尾根は低いほうの隅（高さ 0）から
 * 高い隅（高さ 1）へ上り、両脇の隅は底へ落ちる——寄棟の隅木そのものの形。
 * `swNe` が真なら尾根は南西—北東（画面では ／）、偽なら北西—南東（＼。DEC-354）。
 *
 * 割り方が要。**同じ隅の高さでも、逆の対角線で割ると別の形**になる——
 * 尾根を通らない対角線で割ると「半分が平ら＋半分が坂」になり、山折りにならない。
 *
 * 隅の高さは `rampGeometry` と同じ渡し方だが、**4 隅が同一平面に無い**。
 * 1 枚の法線で塗ると両斜面が同じ陰になるので、三角 2 枚に分けて
 * それぞれの法線を出す（`ridgeGeometry` と同じ理由）。
 *
 * UV は真上から見た足跡のまま（隅の x/z は動かないので `quadUvs` がそれ）。
 * だから絵は引き伸ばされず、**折り目で曲がって**見える。
 */
function foldGeometry(heights: number[], swNe: boolean): BufferGeometry {
  const [nw, ne, se, sw] = heights;
  const corner: Array<[number, number, number]> = [
    [-HALF, nw, -HALF],
    [HALF, ne, -HALF],
    [HALF, se, HALF],
    [-HALF, sw, HALF],
  ];
  const uv: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // 折れ目は 3—1（南西—北東）か 0—2（北西—南東）。巻き順は表を上へ向けるため（DEC-353 / DEC-354）。
  const faces: Array<[number, number, number]> = swNe
    ? [[0, 3, 1], [1, 3, 2]]
    : [[0, 2, 1], [0, 3, 2]];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const n = new Vector3();
  for (const face of faces) {
    const [i0, i1, i2] = face;
    const p0 = corner[i0];
    const p1 = corner[i1];
    const p2 = corner[i2];
    a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    n.crossVectors(a, b).normalize();
    const base = positions.length / 3;
    for (const at of face) {
      positions.push(corner[at][0], corner[at][1], corner[at][2]);
      normals.push(n.x, n.y, n.z);
      uvs.push(uv[at][0], uv[at][1]);
    }
    indices.push(base, base + 1, base + 2);
  }
  return build(positions, normals, uvs, indices);
}

/** 隅の高さで傾けた床。マスを埋めない面 1 枚。法線は 4 隅から出す。 */
function rampGeometry(heights: number[], flipped: boolean): BufferGeometry {
  const [nw, ne, se, sw] = heights;
  const positions = [-HALF, nw, -HALF, HALF, ne, -HALF, HALF, se, HALF, -HALF, sw, HALF];
  const toNe = new Vector3(1, ne - nw, 0);
  const toSw = new Vector3(0, sw - nw, 1);
  const normal = new Vector3().crossVectors(toSw, toNe).normalize();
  if (flipped) normal.negate();
  const indices = flipped ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  return build(positions, repeat([normal.x, normal.y, normal.z], 4), quadUvs(), indices);
}

/**
 * (u, v) の多角形を壁の面にする。u は板に沿って右、v は上からの下向き。
 * 床の `polyGeometry` と同じ座標系なので、`TRI2_SHAPES` をそのまま使える。
 */
/**
 * 屋根の棟・谷（DEC-98）。マスの**中央**（X = 0）で折れる面 1 枚。
 * `peak` が真なら中央が高い山型（屋根のてっぺん）、偽なら中央が低い谷型。
 * `rise` は頂上の高さ（マス）。半マス進んで `rise` 上がるので、坂の勾配に合わせて選ぶ。
 * 0.5 なら 1 マスの坂（45 度）、0.25 なら 2 マスの坂（2 マスで 1 マス）と繋がる。
 * 折れ目は Z 方向へ走る。左右それぞれが四角 1 枚なので、面ごとの法線で陰影が分かれる。
 * UV は真上から見た footprint（u = X、v = Z）。隣の坂チップと絵が繋がる。
 */
/** `lift` はマス内で上へずらす量（1 = 1 マス）。棟を坂の上端に合わせるのに使う（DEC-110）。 */
function ridgeGeometry(peak: boolean, flipped: boolean, rise = 1, lift = 0): BufferGeometry {
  const mid = (peak ? rise : 0) + lift;
  const side = (peak ? 0 : rise) + lift;
  const at = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const uvAt = (x: number, z: number): [number, number] => [x + HALF, z + HALF];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
  ) => {
    const ua = uvAt(a[0], a[2]);
    const ub = uvAt(b[0], b[2]);
    const uc = uvAt(c[0], c[2]);
    const ud = uvAt(d[0], d[2]);
    if (flipped) {
      addTriangle(positions, normals, uvs, indices, a, c, b, ua, uc, ub);
      addTriangle(positions, normals, uvs, indices, a, d, c, ua, ud, uc);
    } else {
      addTriangle(positions, normals, uvs, indices, a, b, c, ua, ub, uc);
      addTriangle(positions, normals, uvs, indices, a, c, d, ua, uc, ud);
    }
  };
  // 西側と東側。並びは床の四角と同じ（北西 → 北東 → 南東 → 南西）。
  quad(at(-HALF, side, -HALF), at(0, mid, -HALF), at(0, mid, HALF), at(-HALF, side, HALF));
  quad(at(0, mid, -HALF), at(HALF, side, -HALF), at(HALF, side, HALF), at(0, mid, HALF));
  return build(positions, normals, uvs, indices);
}

function wallPolyGeometry(points: Array<[number, number]>): BufferGeometry {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [u0, v0] = points[i];
    const [u1, v1] = points[(i + 1) % points.length];
    area += u0 * v1 - u1 * v0;
  }
  const order = area >= 0 ? points : [...points].reverse();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [u, v] of order) {
    positions.push(u - HALF, HALF - v, 0);
    uvs.push(u, v);
  }
  const indices: number[] = [];
  for (let i = 1; i + 1 < order.length; i += 1) indices.push(0, i + 1, i);
  return build(positions, repeat([0, 0, 1], order.length), uvs, indices);
}

function wallGeometry(): BufferGeometry {
  const positions = [-HALF, HALF, 0, HALF, HALF, 0, HALF, -HALF, 0, -HALF, -HALF, 0];
  return build(positions, repeat([0, 0, 1], 4), quadUvs(), [0, 2, 1, 0, 3, 2]);
}

/** 奥行きに重ねるビルボードの枚数（DEC-205）。 */
export const SPRITE_STACK_COPIES = 3;
/**
 * 板の間隔（マス。DEC-206）。**枚数で割った値にする。**
 * 好きな値にすると、Z へ隣り合うマスに置いたときにマスの継ぎ目だけ間隔が空く。
 * 1/枚数 なら、マスをまたいでも等間隔で続く。
 */
export const SPRITE_STACK_GAP = 1 / SPRITE_STACK_COPIES;

/**
 * 縦の絵を奥行きへ何枚か並べた形（DEC-205）。1 マスの中で草むらに厚みを出す。
 * 間隔は 1/枚数。マスを並べても等間隔で続く（DEC-206）。
 * **奥から手前の順に積む。** 半透明は後ろから描かないと縁が抜ける。
 * 視点追従のビルボードでは、この Z が「視線の奥」になる（`material.ts` の basis）。
 */
function spriteStackGeometry(copies: number, gap: number): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < copies; i += 1) {
    const z = (i - (copies - 1) / 2) * gap;
    const base = positions.length / 3;
    positions.push(-HALF, HALF, z, HALF, HALF, z, HALF, -HALF, z, -HALF, -HALF, z);
    normals.push(...repeat([0, 0, 1], 4));
    uvs.push(...quadUvs());
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return build(positions, normals, uvs, indices);
}

function boxGeometry(): BufferGeometry {
  const faces: Array<{ corners: number[][]; normal: number[] }> = [
    { corners: [[-HALF, HALF, HALF], [HALF, HALF, HALF], [HALF, -HALF, HALF], [-HALF, -HALF, HALF]], normal: [0, 0, 1] },
    { corners: [[HALF, HALF, -HALF], [-HALF, HALF, -HALF], [-HALF, -HALF, -HALF], [HALF, -HALF, -HALF]], normal: [0, 0, -1] },
    { corners: [[HALF, HALF, HALF], [HALF, HALF, -HALF], [HALF, -HALF, -HALF], [HALF, -HALF, HALF]], normal: [1, 0, 0] },
    { corners: [[-HALF, HALF, -HALF], [-HALF, HALF, HALF], [-HALF, -HALF, HALF], [-HALF, -HALF, -HALF]], normal: [-1, 0, 0] },
    { corners: [[-HALF, HALF, -HALF], [HALF, HALF, -HALF], [HALF, HALF, HALF], [-HALF, HALF, HALF]], normal: [0, 1, 0] },
    { corners: [[-HALF, -HALF, HALF], [HALF, -HALF, HALF], [HALF, -HALF, -HALF], [-HALF, -HALF, -HALF]], normal: [0, -1, 0] },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const face of faces) {
    const base = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    uvs.push(...quadUvs());
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  return build(positions, normals, uvs, indices);
}

function slopedGeometry(heights: number[]): BufferGeometry {
  const footprint: Array<[number, number]> = [
    [-HALF, -HALF],
    [HALF, -HALF],
    [HALF, HALF],
    [-HALF, HALF],
  ];
  const topUv: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const top = footprint.map<[number, number, number]>(([x, z], i) => [x, -HALF + heights[i], z]);
  const bottom = footprint.map<[number, number, number]>(([x, z]) => [x, -HALF, z]);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const add = (
    a: [number, number, number], b: [number, number, number], c: [number, number, number],
    ua: [number, number], ub: [number, number], uc: [number, number],
  ) => addTriangle(positions, normals, uvs, indices, a, b, c, ua, ub, uc);

  add(top[0], top[1], top[2], topUv[0], topUv[1], topUv[2]);
  add(top[0], top[2], top[3], topUv[0], topUv[2], topUv[3]);

  add(bottom[0], bottom[2], bottom[1], topUv[0], topUv[2], topUv[1]);
  add(bottom[0], bottom[3], bottom[2], topUv[0], topUv[3], topUv[2]);

  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    if (heights[i] === 0 && heights[j] === 0) continue;
    const v = 1 - heights[i];
    const w = 1 - heights[j];
    add(bottom[i], bottom[j], top[j], [0, 1], [1, 1], [1, w]);
    add(bottom[i], top[j], top[i], [0, 1], [1, w], [0, v]);
  }

  return build(positions, normals, uvs, indices);
}

/** Godot の時計回りを Three.js の反時計回りへ入れ替える。陰影が法線を読む。 */
function addTriangle(
  positions: number[], normals: number[], uvs: number[], indices: number[],
  a: [number, number, number], b: [number, number, number], c: [number, number, number],
  ua: [number, number], ub: [number, number], uc: [number, number],
): void {
  [b, c] = [c, b];
  [ub, uc] = [uc, ub];
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: [number, number, number] = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length < 1e-6) return;

  const base = positions.length / 3;
  const corners: Array<[[number, number, number], [number, number]]> = [
    [a, ua],
    [b, ub],
    [c, uc],
  ];
  for (const [position, uv] of corners) {
    positions.push(position[0], position[1], position[2]);
    normals.push(n[0] / length, n[1] / length, n[2] / length);
    uvs.push(uv[0], uv[1]);
  }
  indices.push(base, base + 1, base + 2);
}

function quadUvs(): number[] {
  return [0, 0, 1, 0, 1, 1, 0, 1];
}

function repeat(values: number[], times: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < times; i += 1) out.push(...values);
  return out;
}

function build(positions: number[], normals: number[], uvs: number[], indices: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}
