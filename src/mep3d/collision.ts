// マップの当たり判定。セル単位で持つ。
//
// 「立てる（足場）」と「入れない（壁）」は別の軸で持つ。
//   足場   … レイヤーのカスタムプロパティ `Walkable`。省略時は形から推測（01-要件定義書 §4.6）
//   入れない … ブロック（マスを埋める形）＋ 当たりレイヤーの床・天井以外のセル
//              ＋ `NoEntry` レイヤーのセル（形を問わない。DEC-209）
// 面の高さは形で決まる。ブロックは上面 (y+1)*unit。
// 床チップは**マスの中で高さが変わる**（DEC-210）。坂・斜め坂・2 マス板は 4 隅の高さを
// 双一次で混ぜる。平らな床・三角はマスの底のまま。
//
// 4 隅の高さは絵と同じ表（`shapes.plateCornerHeights`）から取る。並びは
// `[nw, ne, se, sw]`（nw = 西・北）で、インスタンスの R は **+Y 軸まわり −90°×歩数**。
// その回転で「回転前の隅 j」は「回転後の隅 j+r」の位置へ来るので、
// 回転後の隅 i が持つ高さは `heights[i - r]`（`rotatePlate`）。

import { decodeCells, decodeProtoIndices, decodeRotationFlags } from './decode';
import { FLAT_PLATE, offsetStepsFor, plateCornerHeights, plateHeight, rotatePlate } from './shapes';
import {
  isDiagWallShape,
  isEdgeWallShape,
  isFloorShape,
  ROTATION_MASK,
  shapeRotates,
  type AssetsDef,
  type LayerDef,
  type MapDef,
  type MapObjectDef,
  type Shape,
} from './types';

/** マスを埋める形。loader.ts の SOLID_SHAPES と同じ。 */
const SOLID_SHAPES = new Set<Shape>(['box', 'slope', 'slope_corner', 'slope_corner_in', 'mesh']);
/** 面 1 枚だけの形。当たりレイヤーでもマスを塞がない。 */
const SURFACE_SHAPES = new Set<Shape>(['floor', 'ceil']);
/** 足場かどうかを決めるレイヤープロパティ。エディタが新規レイヤーに必ず付ける。 */
const WALKABLE_PROPERTY = 'Walkable';
/**
 * 進入禁止（DEC-209）。オンなら**形に関係なく**そのセルを塞ぐ。
 * `Collision` は床・天井を塞がないので、水面のような「歩けないが地面」を表せなかった。
 * 既定 false なので、入れていないマップの動きは変わらない。
 */
const NO_ENTRY_PROPERTY = 'NoEntry';

/**
 * 段差を登れる高さ（マス。DEC-237）。**オブジェクト**のプロパティ。
 * その範囲では `STEP_UP` の代わりにこの値まで登れる。`true` なら 2 マス。
 */
const CLIMB_PROPERTY = 'Climb';

/** はしご（DEC-237）。**オブジェクト**のプロパティ。その範囲では上下に歩いて動ける。 */
const LADDER_PROPERTY = 'Ladder';

/**
 * 見えない地面（DEC-332）。**オブジェクト**のプロパティ。
 * 床向き（XZ）に描いた面は**その高さの足場**になり、ブロックは**マスを埋める**。
 * 絵は出ない——3D モデルや描き込んだ背景に当たりだけ合わせるためのもの。
 */
const GROUND_PROPERTY = 'Ground';

/**
 * オブジェクトの当たり（DEC-338）。**その体積へ入れなくなる。**
 * レイヤーの `Collision`（チップ用）と同じ名前だが、こちらは**オブジェクト 1 個**に付ける。
 * 見えない壁・見えない箱を置くためのもので、絵は出ない。
 */
const OBJECT_COLLISION_PROPERTY = 'Collision';

/** `Climb` を `true` で書いたときの高さ。 */
const CLIMB_DEFAULT = 2;

/** デバッグ表示用。立てる面 1 枚。`top` はその面のワールド Y。 */
export interface SurfaceCell {
  x: number;
  z: number;
  top: number;
}

/** デバッグ表示用。レイヤーをどう解釈したか。 */
export interface LayerVerdict {
  name: string;
  /** `Walkable` プロパティの値。無ければ null（形から推測した）。 */
  walkable: boolean | null;
  /** 当たりレイヤーか。 */
  blocks: boolean;
  /** このレイヤーが出した足場の枚数。 */
  surfaces: number;
  /** `NoEntry` が入っているか（DEC-209）。 */
  noEntry: boolean;
}

export interface CollisionMap {
  /** 1 マスのワールド単位。 */
  unit: number;
  /**
   * 体が入れないか。**`x` / `z` はセル座標で小数可**（DEC-236）。
   * 壁チップはマスを丸ごとではなく、立っている辺・対角の帯だけを塞ぐ。
   */
  blockedAt(x: number, y: number, z: number): boolean;
  /**
   * そのマスが**丸ごと**塞がっているか（GS-116）。ブロック・斜面・`NoEntry` だけを数え、
   * 辺や対角に立つ薄い壁チップは数えない——薄い壁は**歩けるマスの中**に描いてあることが多く、
   * マス 1 つぶんの四角で当たりを取るときに丸ごと塞ぐ扱いにすると、壁ぎわの床に立てなくなる。
   */
  solidCellAt(x: number, y: number, z: number): boolean;
  /**
   * その柱で `feetY` 以下にある一番高い足場のワールド Y。無ければ null。
   * `fx` / `fz` はマス内の位置（東・南へ 0..1、既定は中央）。坂は場所で高さが変わる（DEC-210）。
   */
  surfaceUnder(x: number, z: number, feetY: number, fx?: number, fz?: number): number | null;
  /**
   * 落下が止まる高さ（DEC-209）。足場に加えて**塞ぐマスの上面**も受け止める。
   * これが無いと、足場を持たない壁チップ（斜め壁など）の柱へ落ちたとき中に入り、
   * 四方が `blockedAt` になって動けなくなる。
   * 登れるかの判定には使わない（壁の上へ歩いて登れてしまうため）。
   */
  landingUnder(x: number, z: number, feetY: number, fx?: number, fz?: number): number | null;
  /**
   * そこで登れる段差（マス。DEC-237）。`Climb` のオブジェクトが無ければ既定。
   * 座標はセル。
   */
  climbAt(x: number, y: number, z: number, fallback: number): number;
  /** そこがはしごなら、その範囲と掴まる位置（セル）。無ければ null（DEC-237）。 */
  ladderAt(x: number, y: number, z: number): LadderSpot | null;
  /** 立てる面を全部返す。デバッグ表示用。 */
  surfaces(): SurfaceCell[];
  /**
   * 塞ぐマスを全部返す。デバッグ表示用。
   * `foot` はマス内の塞ぐ範囲（DEC-236）。`[x0, z0, x1, z1]` の 0..1。
   * 対角は四角では書けないので、線を渡す（`line`）。
   */
  blockers(): Array<{
    x: number;
    y: number;
    z: number;
    foot: [number, number, number, number];
    line?: { nwse: boolean };
  }>;
  /** レイヤーごとの解釈。デバッグ表示用。 */
  layers: LayerVerdict[];
}

/** レイヤーの boolean プロパティ。無ければ null。名前はエディタの書式そのまま。 */
/**
 * 塞ぎ方（DEC-236）。壁チップは絵と同じく**辺や対角に立つ薄い板**なので、
 * マスを丸ごと塞ぐと斜めの崖が階段のような当たりになる。
 */
type BlockShape =
  /** マスを埋める。ブロック・斜面・`NoEntry`。 */
  | { kind: 'full' }
  /** マスの辺に立つ板。0 南 / 1 東 / 2 北 / 3 西（`applyWallPose` と同じ）。 */
  | { kind: 'edge'; side: number }
  /** マスの対角に立つ板。`nwse` は北西〜南東。 */
  | { kind: 'diag'; nwse: boolean };

/**
 * 板の厚み（マス）。**薄くしすぎると 1 フレームで跨げる。**
 * 走りは 8 マス毎秒＝1 フレーム 0.13 マス。体の半径 0.28 と合わせて 0.2 なら抜けない。
 */
const WALL_BAND = 0.2;

/** マス内 (fx, fz) が塞がっているか。fx は東、fz は南へ 0..1。 */
function insideBlock(shape: BlockShape, fx: number, fz: number): boolean {
  if (shape.kind === 'full') return true;
  if (shape.kind === 'edge') {
    if (shape.side === 0) return fz >= 1 - WALL_BAND;
    if (shape.side === 1) return fx >= 1 - WALL_BAND;
    if (shape.side === 2) return fz <= WALL_BAND;
    return fx <= WALL_BAND;
  }
  // 対角線からの距離。中心を原点にして、線 x∓z=0 との距離を測る。
  const cx = fx - 0.5;
  const cz = fz - 0.5;
  const away = shape.nwse ? Math.abs(cx - cz) : Math.abs(cx + cz);
  return away / Math.SQRT2 <= WALL_BAND;
}

/** その形の塞ぎ方。壁チップ以外はマスを丸ごと。 */
function blockShapeOf(shape: Shape, rotation: number): BlockShape {
  const steps = ((rotation % 4) + 4) % 4;
  if (isDiagWallShape(shape)) {
    // 90 度回すともう一方の対角へ移る。180 度は同じ線。
    const nwse = shape === 'wall_diag_nwse';
    return { kind: 'diag', nwse: steps % 2 === 1 ? !nwse : nwse };
  }
  if (isEdgeWallShape(shape)) return { kind: 'edge', side: steps };
  return { kind: 'full' };
}

/** はしごの掴まり所（DEC-237）。座標はすべてセル。 */
export interface LadderSpot {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /**
   * 上り下りする筒のマス（整数のセル）。範囲の中で縦に空いているマス。
   * **中心座標ではなくマス番号を返す。** 呼ぶ側は「既にそのマスに居るなら動かさない」ので、
   * はしごが 2 マス幅でもマスの中心へ吸い寄せられない（DEC-237）。見つからなければ null。
   */
  shaftX: number | null;
  shaftZ: number | null;
}

/** オブジェクトで囲んだ範囲（DEC-237）。セル座標の箱。 */
export interface Zone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** `Climb` の高さ。`Ladder` では使わない。 */
  value: number;
  /** プロパティに書かれていた文字列そのまま。値を文字で使いたいときに。 */
  text: string;
}

/** その名前のプロパティを持つ値。無ければ null。 */
function objectProperty(entry: MapObjectDef, name: string): string | null {
  for (const property of entry.properties ?? []) {
    if (property.name !== name) continue;
    return String(property.value ?? '').trim();
  }
  return null;
}

/**
 * オブジェクトから範囲を拾う（DEC-237）。フィールド効果と同じ読み方。
 * **描いた格子で縦横が決まる**——`xy` / `yz` の縦面は点が高さを持つので、はしごはこれで描く。
 * 目を切ったレイヤー・オブジェクトは拾わない。
 */
function readZones(map: MapDef, name: string): Zone[] {
  const out: Zone[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object' || layer.visible === false) continue;
    for (const entry of layer.objects ?? []) {
      if (entry.visible === false) continue;
      const raw = objectProperty(entry, name);
      if (raw === null || raw === '' || raw === 'false') continue;
      const asNumber = Number(raw);
      const value = Number.isFinite(asNumber) && asNumber > 0 ? asNumber : CLIMB_DEFAULT;
      const text = raw;
      if (entry.cells && entry.cells.length > 0) {
        // ブロック。マスの集まりなので、そのまま箱にする。
        for (const [x, y, z] of entry.cells) {
          out.push({ minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: z, maxZ: z + 1, value, text });
        }
        continue;
      }
      const points = entry.points ?? [];
      if (points.length < 2) continue;
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const [u, v] of points) {
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
      if (!Number.isFinite(minU)) continue;
      const plane = entry.plane === 'xy' || entry.plane === 'yz' ? entry.plane : 'xz';
      if (plane === 'xy') {
        const z = entry.z ?? 0;
        out.push({ minX: minU, maxX: maxU, minY: minV, maxY: maxV, minZ: z - 0.5, maxZ: z + 0.5, value, text });
      } else if (plane === 'yz') {
        const x = entry.x ?? 0;
        out.push({ minX: x - 0.5, maxX: x + 0.5, minY: minV, maxY: maxV, minZ: minU, maxZ: maxU, value, text });
      } else {
        // 床向き。高さは押し出しぶん。無ければ 1 マス。
        const y = entry.y ?? 0;
        const tall = Math.max(0.5, entry.height ?? 1);
        out.push({ minX: minU, maxX: maxU, minY: y, maxY: y + tall, minZ: minV, maxZ: maxV, value, text });
      }
    }
  }
  return out;
}

/**
 * 見えない地面（DEC-332）。オブジェクトから足場の板を作る。
 *
 * - **ブロック**（`cells` を持つもの）は**マスを埋める**。上面が足場になり、中には入れない
 * - **床向き（XZ）に描いた面**はその高さの**板 1 枚**。塞がないので下は通れる
 * - `Rise` があると**坂**。`RiseTo` の向きへ、面の端から端で `Rise` マスぶん上がる
 *
 * 形は**外接する矩形**で取る（多角形・円もそうなる）。坂は矩形で描くのが素直。
 */
export interface GroundPatch {
  /** マスを埋めるブロックか。 */
  solid: boolean;
  cells?: Array<[number, number, number]>;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 面の高さ（マス）。坂の起点。 */
  baseY: number;
  rise: number;
  /** 坂が上がる向きの単位ベクトル（x, z）。 */
  dx: number;
  dz: number;
  /** その向きへ測った端から端まで（マス）。0 なら坂ではない。 */
  span: number;
  /** その向きの起点（一番低い側）。 */
  start: number;
  /**
   * 形（DEC-333）。**斜めに置いた面をそのまま拾う**ための輪郭。
   * 3 点以上あるときだけ使い、足りなければ外接矩形で代える。
   */
  shape?: Array<[number, number]>;
}

/**
 * オブジェクト 1 個を見えない地面として読む（DEC-332 / DEC-334）。
 * 地面でなければ null。**エディタの線もこれを使う**ので、当たりと絵が必ず一致する。
 */
/**
 * 傾いた面（DEC-337）。**`Ground` は見ない**——傾きは「形」の話で、
 * 地面にするかどうかとは別だから。エディタの線はこちらを使い、当たりは
 * `groundPatchOf` を使う。ブロック・縦面・点は傾かないので null。
 */
export function slopePatchOf(entry: MapObjectDef): GroundPatch | null {
  if (entry.cells && entry.cells.length > 0) return null;
  // 床向きだけ。縦面は「高さのある地面」にならない。
  if (entry.plane === 'xy' || entry.plane === 'yz') return null;
  const points = entry.points ?? [];
  if (points.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [u, v] of points) {
    minX = Math.min(minX, u);
    maxX = Math.max(maxX, u);
    minZ = Math.min(minZ, v);
    maxZ = Math.max(maxZ, v);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxZ <= minZ) return null;
  const rad = ((entry.tiltTo ?? 0) * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dz = -Math.cos(rad);
  /*
   * 坂の目盛りは**上がる向きへ投げた長さ**で測る（DEC-333）。
   * 軸に沿った坂も斜めの坂も同じ式で済み、外接矩形の縦横に縛られない。
   */
  let start = Infinity;
  let end = -Infinity;
  for (const [u, v] of points) {
    const t = u * dx + v * dz;
    start = Math.min(start, t);
    end = Math.max(end, t);
  }
  const span = end - start;
  /*
   * 角度は**端から端まででどれだけ上がるか**へ直す（DEC-335）。
   * 角度で持つほうが「見た目の傾き」と一致し、面の広さを変えても勾配が変わらない。
   */
  const lift = span * Math.tan(((entry.tilt ?? 0) * Math.PI) / 180);
  return {
    solid: false,
    minX,
    maxX,
    minZ,
    maxZ,
    baseY: entry.y ?? 0,
    rise: lift,
    dx,
    dz,
    span,
    start,
    ...(points.length >= 3 ? { shape: points as Array<[number, number]> } : {}),
  };
}

/**
 * オブジェクト 1 個を見えない地面として読む（DEC-332 / DEC-337）。
 * **`Ground` を付けたものだけ**が地面になる。傾けただけでは地面にしない——
 * 傾きは形の話なので、当たりに出すかどうかは別に言わせる。
 */
export function groundPatchOf(entry: MapObjectDef): GroundPatch | null {
  const raw = objectProperty(entry, GROUND_PROPERTY);
  if (raw === null || raw === '' || raw === 'false') return null;
  const rad = ((entry.tiltTo ?? 0) * Math.PI) / 180;
  if (entry.cells && entry.cells.length > 0) {
    return {
      solid: true,
      cells: entry.cells,
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      baseY: 0,
      rise: 0,
      dx: Math.sin(rad),
      dz: -Math.cos(rad),
      span: 0,
      start: 0,
    };
  }
  return slopePatchOf(entry);
}

function readGroundPatches(map: MapDef): GroundPatch[] {
  const out: GroundPatch[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object' || layer.visible === false) continue;
    for (const entry of layer.objects ?? []) {
      if (entry.visible === false) continue;
      const patch = groundPatchOf(entry);
      if (patch) out.push(patch);
    }
  }
  return out;
}

/** 坂の面の高さ（マス）。形の外は端の値で止める。 */
export function groundHeightAt(patch: GroundPatch, x: number, z: number): number {
  if (patch.rise === 0 || patch.span <= 0) return patch.baseY;
  const t = (x * patch.dx + z * patch.dz - patch.start) / patch.span;
  return patch.baseY + patch.rise * Math.min(1, Math.max(0, t));
}

/** 輪郭の中か（DEC-333）。交差の数え上げ。3 点未満のものは外接矩形で代える。 */
function insideShape(
  shape: Array<[number, number]> | undefined,
  box: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
): boolean {
  if (!shape || shape.length < 3) {
    return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
  }
  let hit = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i, i += 1) {
    const [xi, zi] = shape[i];
    const [xj, zj] = shape[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function insideGround(patch: GroundPatch, x: number, z: number): boolean {
  return insideShape(patch.shape, patch, x, z);
}

/**
 * `Collision` を付けたオブジェクトの塞ぎ（DEC-338）。**マスを丸ごと埋める。**
 *
 * - **ブロック**は持っているマスをそのまま
 * - **床向きの面**は `y` から**押し出しの高さ**（無ければ 1 マス）ぶんの箱
 * - 縦面（XY / YZ）は対象外——薄い板の塞ぎはチップの壁と同じ扱いが要る
 */
function readSolidCells(map: MapDef): string[] {
  const out: string[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object' || layer.visible === false) continue;
    for (const entry of layer.objects ?? []) {
      if (entry.visible === false) continue;
      const raw = objectProperty(entry, OBJECT_COLLISION_PROPERTY);
      if (raw === null || raw === '' || raw === 'false') continue;
      if (entry.cells && entry.cells.length > 0) {
        for (const [x, y, z] of entry.cells) out.push(`${x},${y},${z}`);
        continue;
      }
      if (entry.plane === 'xy' || entry.plane === 'yz') continue;
      const points = entry.points ?? [];
      if (points.length < 2) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [u, v] of points) {
        minX = Math.min(minX, u);
        maxX = Math.max(maxX, u);
        minZ = Math.min(minZ, v);
        maxZ = Math.max(maxZ, v);
      }
      if (!Number.isFinite(minX) || maxX <= minX || maxZ <= minZ) continue;
      const box = { minX, maxX, minZ, maxZ };
      const shape = points.length >= 3 ? (points as Array<[number, number]>) : undefined;
      const y0 = Math.floor(entry.y ?? 0);
      const y1 = Math.ceil((entry.y ?? 0) + Math.max(0.5, entry.height ?? 1));
      for (let cz = Math.floor(minZ); cz < Math.ceil(maxZ); cz += 1) {
        for (let cx = Math.floor(minX); cx < Math.ceil(maxX); cx += 1) {
          if (!insideShape(shape, box, cx + 0.5, cz + 0.5)) continue;
          for (let cy = y0; cy < y1; cy += 1) out.push(`${cx},${cy},${cz}`);
        }
      }
    }
  }
  return out;
}

/** その点を含む範囲。無ければ null。`pad` は横（X・Z）だけ広げる。 */
function zoneAt(list: Zone[], x: number, y: number, z: number, pad = 0): Zone | null {
  for (const zone of list) {
    if (x < zone.minX - pad || x > zone.maxX + pad) continue;
    if (z < zone.minZ - pad || z > zone.maxZ + pad) continue;
    if (y < zone.minY - 0.001 || y > zone.maxY + 0.001) continue;
    return zone;
  }
  return null;
}

function boolProperty(layer: LayerDef, name: string): boolean | null {
  for (const entry of layer.properties ?? []) {
    if (entry.type !== 'boolean' || entry.name !== name) continue;
    return entry.value === true;
  }
  return null;
}

/**
 * マップ JSON から当たり判定を組む。
 * 透明ブロック（invisible）も塞ぐ。見えない壁として置かれるため（GC-7）。
 */
export function buildCollision(map: MapDef): CollisionMap {
  const unit = map.grid?.unit ?? 1;
  /** 体が入れないマス。組み終わりに `soft` を足して決める。落下の受けにも使う。 */
  const blocked = new Set<string>();
  /**
   * マスごとの塞ぎ方（DEC-236）。1 マスに複数の壁チップが入ることがあるので配列。
   * `full` が 1 つでもあればマス全部。
   */
  const blockShapes = new Map<string, BlockShape[]>();
  const addBlock = (key: string, shape: BlockShape) => {
    const list = blockShapes.get(key);
    if (!list) {
      blockShapes.set(key, [shape]);
      return;
    }
    if (list.some((item) => item.kind === 'full')) return;
    if (shape.kind === 'full') {
      list.length = 0;
      list.push(shape);
      return;
    }
    list.push(shape);
  };
  /**
   * 飾りの壁チップによる塞ぎ（DEC-210）。`Collision` レイヤーの壁・ビルボードは
   * **マス 1 つを丸ごと**塞ぐ。階段の側面を壁チップで飾ると、坂と同じマスに入るので
   * 坂に乗れなくなる。同じマスに**傾いた足場**があるものは、あとで塞ぎから外す。
   * ブロック（マスを埋める形）と `NoEntry` は意図がはっきりしているので外さない。
   */
  const soft = new Set<string>();
  /** 傾いた足場のあるマス。平らな床（マスの底ちょうど）は入らない。 */
  const sloped = new Set<string>();
  /** 上面が足場になるマス（ブロック）。面は (y+1)*unit。 */
  const standTop = new Set<string>();
  /**
   * 床チップの足場（DEC-210）。値はマスの底からの 4 隅の高さ（回転・微 Y 込み）。
   * 平らな床は `FLAT_PLATE` を共有するので、増えるのはキーだけ。
   */
  const standBottom = new Map<string, Float32Array>();
  const layers: LayerVerdict[] = [];
  let lowest = 0;

  const assets = typeof map.assets === 'object' && map.assets ? (map.assets as AssetsDef) : null;
  const protosById = new Map((assets?.protos ?? []).map((entry) => [entry.id, entry]));
  /** `proto.offset` の分母。アセットの版で変わる。 */
  const offsetSteps = offsetStepsFor(assets?.version ?? 1);
  /** 形 × 回転 × 微 Y の板。同じ組み合わせは 1 つを使い回す。 */
  const plateCache = new Map<string, Float32Array>();
  /**
   * 同じマスに面が 2 枚来たときの混ぜ方（DEC-386 / DEC-341）。**4 隅ごとに高いほう。**
   * 変わらなければ元の板をそのまま返す——使い回しの板を無駄に複製しない。
   * **元の板は書き換えない。** `FLAT_PLATE` のような共有の板を壊してしまう。
   */
  const higherPlate = (known: Float32Array | undefined, plate: Float32Array): Float32Array => {
    if (!known) return plate;
    let out: Float32Array | null = null;
    for (let i = 0; i < 4; i += 1) {
      if (plate[i] <= known[i]) continue;
      if (!out) out = new Float32Array(known);
      out[i] = plate[i];
    }
    return out ?? known;
  };

  const plateFor = (shape: Shape, rotation: number, lift: number): Float32Array => {
    const base = plateCornerHeights(shape);
    if (!base) return FLAT_PLATE;
    if (lift === 0 && base.every((value) => value === 0)) return FLAT_PLATE;
    const cacheKey = `${shape}|${rotation}|${lift}`;
    const hit = plateCache.get(cacheKey);
    if (hit) return hit;
    const made = rotatePlate(base, rotation);
    if (lift !== 0) for (let i = 0; i < 4; i += 1) made[i] += lift;
    plateCache.set(cacheKey, made);
    return made;
  };

  for (const layer of map.layers) {
    if (layer.kind === 'group' || layer.kind === 'object') continue;
    if (layer.visible === false) continue;

    const walkable = boolProperty(layer, WALKABLE_PROPERTY);
    const noEntry = boolProperty(layer, NO_ENTRY_PROPERTY) === true;
    const verdict: LayerVerdict = {
      name: layer.name,
      walkable,
      blocks: layer.collision === true || noEntry,
      surfaces: 0,
      noEntry,
    };
    layers.push(verdict);

    for (const batch of layer.batches) {
      const isSolid = SOLID_SHAPES.has(batch.shape);
      // 坂・三角・棟もすべて床の仲間として足場にする（DEC-209）。
      // 以前は `floor` ちょうどだけを見ていたので、`floor_ramp_*` や `floor_tri_*` を
      // 敷いた所が素通りで落ちていた。高さは 4 隅から出す（DEC-210）。
      const isFloor = isFloorShape(batch.shape);
      // 足場にするか。プロパティがあればそれに従い、無ければ形から推測する。
      // 面の高さは形が決めるので、壁・ビルボード・天井は walkable でも足場にならない。
      const stands = (walkable ?? true) && (isSolid || isFloor);
      // 当たりレイヤーは壁チップやビルボードでも塞ぐ。ただし床・天井は塞がない。
      // `NoEntry` は形を問わず塞ぐ（DEC-209）。
      const blocks = isSolid || noEntry || (layer.collision === true && !SURFACE_SHAPES.has(batch.shape));
      if (!stands && !blocks) continue;

      const cells = decodeCells(batch);
      // 床チップの高さは 4 隅 × R × 微 Y で決まるので、そのぶんだけ読む。
      const wantsPlate = stands && !isSolid;
      const flags = wantsPlate && shapeRotates(batch.shape) ? decodeRotationFlags(batch) : null;
      // 壁チップの向き（DEC-236）。塞ぎ方を決めるのに要る。
      const blockFlags = blocks && shapeRotates(batch.shape) ? decodeRotationFlags(batch) : null;
      const protoIndices = wantsPlate ? decodeProtoIndices(batch) : null;
      for (let i = 0; i + 2 < cells.length; i += 3) {
        const at = i / 3;
        const y = cells[i + 1];
        const key = `${cells[i]},${y},${cells[i + 2]}`;
        if (blocks) {
          (isSolid || noEntry ? blocked : soft).add(key);
          // 壁チップは辺・対角の帯だけ（DEC-236）。ブロックと `NoEntry` はマス全部。
          addBlock(
            key,
            isSolid || noEntry
              ? { kind: 'full' }
              : blockShapeOf(batch.shape, (blockFlags?.[at] ?? 0) & ROTATION_MASK),
          );
        }
        if (stands) {
          if (isSolid) {
            standTop.add(key);
          } else {
            const proto = protoIndices ? protosById.get(batch.protos[protoIndices[at]]) : undefined;
            const lift = proto?.offset ? proto.offset[1] / offsetSteps : 0;
            const plate = plateFor(batch.shape, (flags?.[at] ?? 0) & ROTATION_MASK, lift);
            // 同じマスに面が 2 枚来たら**高いほうを採る**（DEC-386）。
            // 上書きにしていたので、**あとのレイヤーの平らな床が坂を潰していた**
            // ——地面の上に丘を重ねると、坂のマスに床が 2 枚になる。
            // `Ground` オブジェクトの経路（DEC-341）だけ直っていたので、こちらも揃える。
            const put = higherPlate(standBottom.get(key), plate);
            standBottom.set(key, put);
            if (put.some((value) => value > 0.001)) sloped.add(key);
          }
          verdict.surfaces += 1;
        }
        if (y < lowest) lowest = y;
      }
    }
  }

  // 飾りの壁は、同じマスに傾いた足場があるなら塞がない（DEC-210）。
  for (const key of soft) {
    if (sloped.has(key)) blockShapes.delete(key);
    else blocked.add(key);
  }

  const climbZones = readZones(map, CLIMB_PROPERTY);
  const ladderZones = readZones(map, LADDER_PROPERTY);

  /*
   * `Collision` を付けたオブジェクト（DEC-338）。**マスを丸ごと塞ぐ。**
   * 地面より先に入れる——同じマスに地面も来たら、あとから板が乗るだけで塞ぎは残る。
   */
  /*
   * `Collision` は**塞ぐだけ**（DEC-340）。上面は足場にしない——
   * 建物を「入れない塊」として置くのが主な使い道で、**屋根に登れてほしくない**。
   * 上に立ちたいときは `Ground` も付ける（ブロックの `Ground` は塞ぎ＋上面の足場）。
   * 落ちてきたものは `landingUnder` が塞ぎで受け止めるので、中に埋まることはない。
   */
  for (const key of readSolidCells(map)) {
    blocked.add(key);
    addBlock(key, { kind: 'full' });
    lowest = Math.min(lowest, parseKey(key)[1]);
  }

  /*
   * 見えない地面（DEC-332）。**チップを組んだあとに足す。**
   * 板は「マスの底からの 4 隅の高さ」なので、坂は隅を拾うだけで済む——
   * `plateHeight` が双一次で混ぜてくれる（DEC-210 の仕掛けをそのまま使う）。
   */
  for (const patch of readGroundPatches(map)) {
    if (patch.solid) {
      for (const [x, y, z] of patch.cells ?? []) {
        const key = `${x},${y},${z}`;
        blocked.add(key);
        addBlock(key, { kind: 'full' });
        standTop.add(key);
        lowest = Math.min(lowest, y);
      }
      continue;
    }
    const x0 = Math.floor(patch.minX);
    const x1 = Math.ceil(patch.maxX);
    const z0 = Math.floor(patch.minZ);
    const z1 = Math.ceil(patch.maxZ);
    /*
     * 形の中のマスへ板を置く（DEC-332 / DEC-333）。**中に入るかはマスの中心で決める。**
     * 1 マスより細い面は中心を跨がず 1 枚も置けないことがあるので、
     * **1 枚も出なかったときだけ外接矩形で置き直す**——描いたのに何も起きないほうが困る。
     */
    const put = (loose: boolean): number => {
      let made = 0;
      for (let cz = z0; cz < z1; cz += 1) {
        for (let cx = x0; cx < x1; cx += 1) {
          if (!loose && !insideGround(patch, cx + 0.5, cz + 0.5)) continue;
          // 並びは [nw, ne, se, sw]。fx は東、fz は南へ 0..1。
          const nw = groundHeightAt(patch, cx, cz);
          const ne = groundHeightAt(patch, cx + 1, cz);
          const se = groundHeightAt(patch, cx + 1, cz + 1);
          const sw = groundHeightAt(patch, cx, cz + 1);
          const cy = Math.floor(Math.min(nw, ne, se, sw));
          const plate = new Float32Array([nw - cy, ne - cy, se - cy, sw - cy]);
          const key = `${cx},${cy},${cz}`;
          /*
           * 同じマスに面が 2 枚来たら**高いほうを採る**（DEC-341）。
           * 上書きにしていたので、**あとから読んだ平らな地面が坂を潰していた**——
           * 見えない地面どうしが少しでも重なると、坂の一部が平らに戻る。
           * チップの床とぶつかったときも同じで、地面は「下げる」ことはしない。
           */
          const known = standBottom.get(key);
          const put = known ? new Float32Array([
            Math.max(known[0], plate[0]),
            Math.max(known[1], plate[1]),
            Math.max(known[2], plate[2]),
            Math.max(known[3], plate[3]),
          ]) : plate;
          standBottom.set(key, put);
          if (put.some((value) => value > 0.001)) sloped.add(key);
          lowest = Math.min(lowest, cy);
          made += 1;
        }
      }
      return made;
    };
    if (put(false) === 0) put(true);
  }

  /** マスを塞ぐか。`blockedAt` の中身。はしごの筒探しからも呼ぶ。 */
  /** 隣のマスも見る向き（DEC-244）。対角壁の帯がはみ出してくるのはこの 4 方向。 */
  const AROUND: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  const blocksCell = (x: number, y: number, z: number): boolean => {
    // 小数で来る（DEC-236）。マスを出してから、マス内の位置で形に当てる。
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const fx = x - cx;
    const fz = z - cz;
    const list = blockShapes.get(`${cx},${y},${cz}`);
    if (list && list.some((shape) => insideBlock(shape, fx, fz))) return true;
    // **対角壁の帯はマスの外へはみ出す**（DEC-244）。
    //
    // 帯は線から 0.2 マスの幅があるので、線がマスの角に届く所では隣のマスへ食い込む。
    // 自分のマスだけを見ると、階段状に並べた対角壁の継ぎ目に**帯の欠け**ができ、
    // 体の当たり点がそこに入ると壁沿いに動けなくなる（実測: 斜面を滑って継ぎ目で停止）。
    // 隣のマスの対角線をそのまま延長して当てれば継ぎ目が埋まる。線は元々まっすぐ続いている。
    for (const [dx, dz] of AROUND) {
      const near = blockShapes.get(`${cx + dx},${y},${cz + dz}`);
      if (!near) continue;
      for (const shape of near) {
        if (shape.kind !== 'diag') continue;
        if (insideBlock(shape, fx - dx, fz - dz)) return true;
      }
    }
    return false;
  };

  /**
   * マスを丸ごと塞ぐか（GS-116）。`solidCellAt` の中身。
   * 薄い壁チップ（辺・対角）は数えない——形が `full` の物だけ。
   */
  const solidCell = (x: number, y: number, z: number): boolean => {
    const list = blockShapes.get(`${Math.floor(x)},${y},${Math.floor(z)}`);
    return list !== undefined && list.some((shape) => shape.kind === 'full');
  };

  /** そのマスの上（`feetY` 以下）で一番高い床面。`surfaceUnder` の中身。 */
  const standUnder = (x: number, z: number, feetY: number, fx = 0.5, fz = 0.5): number | null => {
    const eps = 0.001 * unit;
    // 板はマスの上へ 1 マスまで伸びるので、1 つ上から見る（DEC-210）。
    const from = cellOf(feetY + eps, unit) + 1;
    for (let y = from; y >= lowest - 1; y -= 1) {
      const key = `${x},${y},${z}`;
      if (standTop.has(key) && (y + 1) * unit <= feetY + eps) return (y + 1) * unit;
      const plate = standBottom.get(key);
      if (plate) {
        const top = (y + plateHeight(plate, fx, fz)) * unit;
        if (top <= feetY + eps) return top;
      }
    }
    return null;
  };

  return {
    unit,
    climbAt(x, y, z, fallback) {
      const zone = zoneAt(climbZones, x, y, z);
      return zone ? Math.max(fallback, zone.value) : fallback;
    },
    ladderAt(x, y, z) {
      const zone = zoneAt(ladderZones, x, y, z);
      if (!zone) return null;
      // 掴まる筒（DEC-237）。範囲の中で**上から下まで空いている**マスを選ぶ。
      // 壁に立てかけたはしごは、壁のマスと手前のマスの両方を含めて描く。
      // 壁の中を降りないよう、掴んだ瞬間に手前のマスへ寄せる。
      let shaftX: number | null = null;
      let shaftZ: number | null = null;
      let best = Infinity;
      const eps = 0.001 * unit;
      for (let cz = Math.floor(zone.minZ); cz < Math.ceil(zone.maxZ); cz += 1) {
        for (let cx = Math.floor(zone.minX); cx < Math.ceil(zone.maxX); cx += 1) {
          let free = true;
          for (let cy = Math.floor(zone.minY); cy < Math.ceil(zone.maxY) && free; cy += 1) {
            if (blocksCell(cx + 0.5, cy, cz + 0.5)) free = false;
          }
          if (!free) continue;
          // **床が途中や上端にあるマスは筒ではない。** 段の上のマスは床が上端にあるので、
          // これを見ないと段の中（床の裏）を降りてしまう。筒は床が下端以下のマス。
          const floor = standUnder(cx, cz, zone.maxY * unit);
          if (floor !== null && floor > zone.minY * unit + eps) continue;
          const d = (cx + 0.5 - x) ** 2 + (cz + 0.5 - z) ** 2;
          if (d >= best) continue;
          best = d;
          shaftX = cx;
          shaftZ = cz;
        }
      }
      return {
        minY: zone.minY,
        maxY: zone.maxY,
        minX: zone.minX,
        maxX: zone.maxX,
        minZ: zone.minZ,
        maxZ: zone.maxZ,
        shaftX,
        shaftZ,
      };
    },
    blockedAt: blocksCell,
    solidCellAt: solidCell,
    surfaceUnder: standUnder,
    landingUnder(x, z, feetY, fx = 0.5, fz = 0.5) {
      const eps = 0.001 * unit;
      const from = cellOf(feetY + eps, unit) + 1;
      for (let y = from; y >= lowest - 1; y -= 1) {
        const key = `${x},${y},${z}`;
        // 塞ぐマスは形にかかわらず上面で受ける。中に入れない以上、上に載せるしかない。
        if ((standTop.has(key) || blocked.has(key)) && (y + 1) * unit <= feetY + eps) return (y + 1) * unit;
        const plate = standBottom.get(key);
        if (plate) {
          const top = (y + plateHeight(plate, fx, fz)) * unit;
          if (top <= feetY + eps) return top;
        }
      }
      return null;
    },
    surfaces() {
      const out: SurfaceCell[] = [];
      for (const key of standTop) {
        const [x, y, z] = parseKey(key);
        out.push({ x, z, top: (y + 1) * unit });
      }
      for (const [key, plate] of standBottom) {
        const [x, y, z] = parseKey(key);
        // 見た目の確認用なのでマスの中央の高さで代表させる。
        out.push({ x, z, top: (y + plateHeight(plate, 0.5, 0.5)) * unit });
      }
      return out;
    },
    blockers() {
      const out: Array<{
        x: number;
        y: number;
        z: number;
        foot: [number, number, number, number];
        line?: { nwse: boolean };
      }> = [];
      for (const key of blocked) {
        const [x, y, z] = parseKey(key);
        const list = blockShapes.get(key) ?? [{ kind: 'full' as const }];
        for (const shape of list) {
          if (shape.kind === 'full') {
            out.push({ x, y, z, foot: [0, 0, 1, 1] });
          } else if (shape.kind === 'edge') {
            const b = WALL_BAND;
            const foot: [number, number, number, number] =
              shape.side === 0
                ? [0, 1 - b, 1, 1]
                : shape.side === 1
                  ? [1 - b, 0, 1, 1]
                  : shape.side === 2
                    ? [0, 0, 1, b]
                    : [0, 0, b, 1];
            out.push({ x, y, z, foot });
          } else {
            out.push({ x, y, z, foot: [0, 0, 1, 1], line: { nwse: shape.nwse } });
          }
        }
      }
      return out;
    },
    layers,
  };
}

/** "x,y,z" を数値 3 つに戻す。 */
function parseKey(key: string): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** ワールド座標をセル座標へ。セル c のワールド範囲は [c*unit, (c+1)*unit)。 */
export function cellOf(world: number, unit: number): number {
  return Math.floor(world / unit);
}
