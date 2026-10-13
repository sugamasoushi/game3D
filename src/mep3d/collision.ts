// オブジェクトが持つ当たりの情報（GS-239）。範囲と見えない地面を読むだけ。
//
// 当たりそのものは物理エンジン Rapier（`game/physics.ts`）が持つ。形は `hitShapes.ts`。
// ここは**オブジェクトのプロパティから範囲を読む**部品だけ:
// - `Collision`（マスを丸ごと塞ぐ）・`NoHit`（その中のチップは当たりを作らない）→ `hitShapes.ts`
// - `Ground`（見えない地面）→ `hitShapes.ts`
// - `Climb`（登れる段差）・`Ladder`（はしご）→ ゲームの体の動き
//
// 以前はここがマス単位の当たり（`buildCollision`）そのものだった。Rapier へ移したので外した（GS-239）。

import type { MapDef, MapObjectDef } from './types';


/**
 * 段差を登れる高さ（マス。DEC-237）。**オブジェクト**のプロパティ。
 * その範囲では `STEP_UP` の代わりにこの値まで登れる。`true` なら 2 マス。
 */
export const CLIMB_PROPERTY = 'Climb';

/** はしご（DEC-237）。**オブジェクト**のプロパティ。その範囲では上下に歩いて動ける。 */
export const LADDER_PROPERTY = 'Ladder';

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
/** 当たりを外すオブジェクト（GS-238）。この中のチップは当たりを作らない。 */
export const NO_HIT_PROPERTY = 'NoHit';

/** `Climb` を `true` で書いたときの高さ。 */
const CLIMB_DEFAULT = 2;

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
export function readZones(map: MapDef, name: string): Zone[] {
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

/**
 * `Collision` を付けたオブジェクトの塞ぎ（DEC-338）。**マスを丸ごと埋める。**
 *
 * - **ブロック**は持っているマスをそのまま
 * - **床向きの面**は `y` から**押し出しの高さ**（無ければ 1 マス）ぶんの箱
 * - 縦面（XY / YZ）は対象外——薄い板の塞ぎはチップの壁と同じ扱いが要る
 */
export function readSolidCells(map: MapDef): string[] {
  return readObjectCells(map, OBJECT_COLLISION_PROPERTY);
}

/**
 * 「当たりを外す」オブジェクト（`NoHit`。GS-238 / マップエディタ DEC-467）のマス。
 * **この中のチップは当たりを作らない**（見た目はそのまま）。隠し通路・落とし穴に使う。範囲の取り方は `Collision` と同じ。
 */
export function readNoHitCells(map: MapDef): Set<string> {
  return new Set(readObjectCells(map, NO_HIT_PROPERTY));
}

/** その名前のプロパティを付けたオブジェクトが占めるマス（範囲の取り方は上の `Collision` と同じ）。 */
function readObjectCells(map: MapDef, name: string): string[] {
  const out: string[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object' || layer.visible === false) continue;
    for (const entry of layer.objects ?? []) {
      if (entry.visible === false) continue;
      const raw = objectProperty(entry, name);
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
export function zoneAt(list: Zone[], x: number, y: number, z: number, pad = 0): Zone | null {
  for (const zone of list) {
    if (x < zone.minX - pad || x > zone.maxX + pad) continue;
    if (z < zone.minZ - pad || z > zone.maxZ + pad) continue;
    if (y < zone.minY - 0.001 || y > zone.maxY + 0.001) continue;
    return zone;
  }
  return null;
}

/** "x,y,z" を数値 3 つに戻す。 */
/** ワールド座標をセル座標へ。セル c のワールド範囲は [c*unit, (c+1)*unit)。 */
export function cellOf(world: number, unit: number): number {
  return Math.floor(world / unit);
}
