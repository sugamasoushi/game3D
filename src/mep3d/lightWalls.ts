// 配置光源の光と影を遮る。平面オブジェクトと、遮光オンのブロック（マスごと）。
// 環境光のブロック影は CPU 側で同じ壁に当てて切る。

import { Vector4, type IUniform } from 'three';
import type { MapObjectDef, MapObjectPlane, PropertyDef } from './types';

/** シェーダに載せる遮光の上限。平面とブロックマスを合わせる。 */
export const MAX_LIGHT_WALLS = 32;

/** オブジェクトのカスタムプロパティ。true なら配置光源の光と影を遮る。 */
export const WALL_PROPERTY_NAME = 'Wall';

/** true ならその向きの無限平面。false ならオブジェクトの形の範囲だけ。 */
export const WALL_INFINITE_PROPERTY_NAME = 'WallInfinite';

/** 軸平行の遮光。座標はセル単位。`axis === 3` はブロック 1 マスの AABB。 */
export interface LightWall {
  /** 0=X（YZ 壁）、1=Y（床・天井）、2=Z（XY 壁）、3=直方体マス。 */
  axis: 0 | 1 | 2 | 3;
  /** 平面ならその軸の位置。直方体なら x0。 */
  pos: number;
  infinite: boolean;
  /** 平面は残る 2 軸の AABB。直方体は u0=y0 u1=z0 v0=x1 v1=y1。 */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** 直方体の z1。`axis === 3` のとき。 */
  w1?: number;
}

export interface LightWallUniformBuf {
  axis: Vector4[];
  bounds: Vector4[];
}

export interface LightWallLayer {
  id: string;
  kind: string;
  visible?: boolean;
  parent?: string;
  objects?: MapObjectDef[];
}

/** 点光源シェーダの遮光 uniform。 */
export const LIGHT_WALL_UNIFORMS_GLSL = /* glsl */ `
uniform int mepWallCount;
uniform vec4 mepWallAxis[${MAX_LIGHT_WALLS}];
uniform vec4 mepWallBounds[${MAX_LIGHT_WALLS}];
`;

/** 配置光源の光線が平面またはブロックに当たるか。t は 0..1。端点は面の上なので無視する。 */
export const LIGHT_WALL_GLSL = /* glsl */ `
bool mepSegHitsAabb(vec3 fromPos, vec3 toPos, vec3 bmin, vec3 bmax) {
  vec3 d = toPos - fromPos;
  float t0 = 0.002;
  float t1 = 0.998;
  vec3 mn = min(bmin, bmax);
  vec3 mx = max(bmin, bmax);
  vec3 inv = vec3(
    abs(d.x) < 1e-8 ? 1e8 : 1.0 / d.x,
    abs(d.y) < 1e-8 ? 1e8 : 1.0 / d.y,
    abs(d.z) < 1e-8 ? 1e8 : 1.0 / d.z
  );
  vec3 a = (mn - fromPos) * inv;
  vec3 b = (mx - fromPos) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  if (abs(d.x) < 1e-8 && (fromPos.x < mn.x || fromPos.x > mx.x)) return false;
  if (abs(d.y) < 1e-8 && (fromPos.y < mn.y || fromPos.y > mx.y)) return false;
  if (abs(d.z) < 1e-8 && (fromPos.z < mn.z || fromPos.z > mx.z)) return false;
  t0 = max(t0, max(lo.x, max(lo.y, lo.z)));
  t1 = min(t1, min(hi.x, min(hi.y, hi.z)));
  return t0 <= t1;
}

bool mepWallBlocks(vec3 fromPos, vec3 toPos) {
  vec3 delta = toPos - fromPos;
  for (int i = 0; i < ${MAX_LIGHT_WALLS}; i++) {
    if (i >= mepWallCount) break;
    vec4 ax = mepWallAxis[i];
    vec4 b = mepWallBounds[i];
    if (ax.x > 2.5) {
      if (mepSegHitsAabb(fromPos, toPos, ax.yzw, b.xyz)) return true;
      continue;
    }
    float axis = ax.x;
    float pos = ax.y;
    float inf = ax.z;
    float a0 = axis < 0.5 ? fromPos.x : (axis < 1.5 ? fromPos.y : fromPos.z);
    float a1 = axis < 0.5 ? toPos.x : (axis < 1.5 ? toPos.y : toPos.z);
    float da = a1 - a0;
    if (abs(da) < 1e-5) continue;
    float t = (pos - a0) / da;
    if (t <= 0.002 || t >= 0.998) continue;
    if (inf > 0.5) return true;
    vec3 hit = fromPos + delta * t;
    float u = axis < 0.5 ? hit.z : hit.x;
    float v = axis < 1.5 ? (axis < 0.5 ? hit.y : hit.z) : hit.y;
    if (u >= b.x && u <= b.y && v >= b.z && v <= b.w) return true;
  }
  return false;
}
`;

/** マテリアル初期化用の空配列。 */
export function createLightWallArrays(): LightWallUniformBuf {
  return {
    axis: Array.from({ length: MAX_LIGHT_WALLS }, () => new Vector4()),
    bounds: Array.from({ length: MAX_LIGHT_WALLS }, () => new Vector4()),
  };
}

/** セル単位の平面をワールド単位の uniform に書く。戻り値は枚数。 */
export function fillLightWallUniforms(walls: LightWall[], unit: number, buf: LightWallUniformBuf): number {
  const scale = unit > 0 ? unit : 1;
  const n = Math.min(walls.length, MAX_LIGHT_WALLS);
  for (let i = 0; i < MAX_LIGHT_WALLS; i += 1) {
    const wall = i < n ? walls[i] : undefined;
    if (!wall) {
      buf.axis[i]?.set(0, 0, 0, 0);
      buf.bounds[i]?.set(0, 0, 0, 0);
      continue;
    }
    if (wall.axis === 3) {
      buf.axis[i]?.set(3, wall.pos * scale, wall.u0 * scale, wall.u1 * scale);
      buf.bounds[i]?.set(wall.v0 * scale, wall.v1 * scale, (wall.w1 ?? wall.v1) * scale, 0);
      continue;
    }
    buf.axis[i]?.set(wall.axis, wall.pos * scale, wall.infinite ? 1 : 0, 0);
    buf.bounds[i]?.set(wall.u0 * scale, wall.u1 * scale, wall.v0 * scale, wall.v1 * scale);
  }
  return n;
}

/** マテリアルの遮光 uniform を差し替える。未対応なら何もしない。 */
export function applyLightWallUniforms(
  material: { uniforms: Record<string, IUniform> },
  walls: LightWall[],
  unit: number,
): void {
  if (!material.uniforms.mepWallCount) return;
  const axis = material.uniforms.mepWallAxis?.value as Vector4[] | undefined;
  const bounds = material.uniforms.mepWallBounds?.value as Vector4[] | undefined;
  if (!axis || !bounds) return;
  material.uniforms.mepWallCount.value = fillLightWallUniforms(walls, unit, { axis, bounds });
}

type CellPoint = { x: number; y: number; z: number };

/** セル単位の光線が最初に当たる壁の t（0..1）。無ければ null。 */
export function lightRayHitT(from: CellPoint, to: CellPoint, walls: LightWall[]): number | null {
  if (walls.length === 0) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  let hit: number | null = null;
  for (const wall of walls) {
    let t: number | null = null;
    if (wall.axis === 3) {
      t = segHitsAabbT(
        from,
        to,
        { x: wall.pos, y: wall.u0, z: wall.u1 },
        { x: wall.v0, y: wall.v1, z: wall.w1 ?? wall.v1 },
      );
    } else {
      const a0 = wall.axis === 0 ? from.x : wall.axis === 1 ? from.y : from.z;
      const da = wall.axis === 0 ? dx : wall.axis === 1 ? dy : dz;
      if (Math.abs(da) < 1e-6) continue;
      const at = (wall.pos - a0) / da;
      if (at <= 0.002 || at >= 0.998) continue;
      if (wall.infinite) {
        t = at;
      } else {
        const hx = from.x + dx * at;
        const hy = from.y + dy * at;
        const hz = from.z + dz * at;
        const u = wall.axis === 0 ? hz : hx;
        const v = wall.axis === 2 ? hy : wall.axis === 0 ? hy : hz;
        if (u >= wall.u0 && u <= wall.u1 && v >= wall.v0 && v <= wall.v1) t = at;
      }
    }
    if (t == null) continue;
    if (hit == null || t < hit) hit = t;
  }
  return hit;
}

/** セル単位の光線が遮光平面に当たるか。配置光源の影用。 */
export function lightRayBlocked(from: CellPoint, to: CellPoint, walls: LightWall[]): boolean {
  return lightRayHitT(from, to, walls) != null;
}

/** 表示中レイヤーの Wall オブジェクトから遮光を集める。上限あり。 */
export function collectLightWalls(layers: readonly LightWallLayer[]): LightWall[] {
  const out: LightWall[] = [];
  for (const layer of layers) {
    if (layer.kind !== 'object') continue;
    if (!layerEffectivelyVisible(layers, layer)) continue;
    for (const entry of layer.objects ?? []) {
      for (const wall of wallsFromObject(entry)) {
        if (out.length >= MAX_LIGHT_WALLS) return out;
        out.push(wall);
      }
    }
  }
  return out;
}

function wallsFromObject(entry: MapObjectDef): LightWall[] {
  if (entry.visible === false) return [];
  if (!flag(entry.properties, WALL_PROPERTY_NAME)) return [];
  if (entry.kind === 'box') return boxCellWalls(entry);
  const wall = planeWall(entry);
  return wall ? [wall] : [];
}

function planeWall(entry: MapObjectDef): LightWall | null {
  if (entry.kind === 'sphere' || entry.kind === 'ellipsoid') return null;
  if (entry.space === 'solid' || ((entry.height ?? 0) > 0 && entry.space !== 'plane')) return null;
  const infinite = flag(entry.properties, WALL_INFINITE_PROPERTY_NAME);
  if (entry.kind === 'point' && !infinite) return null;
  if (entry.kind !== 'rect' && entry.kind !== 'polygon' && entry.kind !== 'circle' && entry.kind !== 'point') {
    return null;
  }
  const plane = planeOf(entry);
  const box = uvBounds(entry.points);
  if (plane === 'xy') {
    return {
      axis: 2,
      pos: entry.z ?? 0,
      infinite,
      u0: box.u0,
      u1: box.u1,
      v0: box.v0,
      v1: box.v1,
    };
  }
  if (plane === 'yz') {
    return {
      axis: 0,
      pos: entry.x ?? 0,
      infinite,
      u0: box.u0,
      u1: box.u1,
      v0: box.v0,
      v1: box.v1,
    };
  }
  return {
    axis: 1,
    pos: entry.y,
    infinite,
    u0: box.u0,
    u1: box.u1,
    v0: box.v0,
    v1: box.v1,
  };
}

function boxCellWalls(entry: MapObjectDef): LightWall[] {
  const cells = entry.cells ?? [];
  return cells.map(([x, y, z]) => ({
    axis: 3 as const,
    pos: x,
    infinite: false,
    u0: y,
    u1: z,
    v0: x + 1,
    v1: y + 1,
    w1: z + 1,
  }));
}

function segHitsAabbT(from: CellPoint, to: CellPoint, a: CellPoint, b: CellPoint): number | null {
  const mn = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
  const mx = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  let t0 = 0.002;
  let t1 = 0.998;
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    const o = from[axis];
    const dd = d[axis];
    if (Math.abs(dd) < 1e-8) {
      if (o < mn[axis] || o > mx[axis]) return null;
      continue;
    }
    const ta = (mn[axis] - o) / dd;
    const tb = (mx[axis] - o) / dd;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return null;
  }
  return t0;
}

function planeOf(entry: MapObjectDef): MapObjectPlane {
  return entry.plane === 'xy' || entry.plane === 'yz' ? entry.plane : 'xz';
}

function flag(list: PropertyDef[] | undefined, name: string): boolean {
  return list?.some((entry) => entry.name === name && entry.value === true) === true;
}

function uvBounds(points: [number, number][]): { u0: number; u1: number; v0: number; v1: number } {
  if (points.length === 0) return { u0: 0, u1: 0, v0: 0, v1: 0 };
  let u0 = points[0][0];
  let u1 = points[0][0];
  let v0 = points[0][1];
  let v1 = points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const u = points[i][0];
    const v = points[i][1];
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  return { u0, u1, v0, v1 };
}

function layerEffectivelyVisible(layers: readonly LightWallLayer[], layer: LightWallLayer): boolean {
  const byId = new Map(layers.map((entry) => [entry.id, entry]));
  let current: LightWallLayer | undefined = layer;
  let guard = 0;
  while (current && guard < layers.length) {
    if (current.visible === false) return false;
    current = current.parent ? byId.get(current.parent) : undefined;
    guard += 1;
  }
  return true;
}
