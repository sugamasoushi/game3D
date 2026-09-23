// 床に落とすブロック影。乗算で直射だけを環境光まで落とす。ぼかしはしない。
// 箱・斜面の頂点を光と逆へ伸ばし、重なりはステンシルで 1 回だけ塗る。

import {
  AlwaysStencilFunc,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  EqualStencilFunc,
  Group,
  KeepStencilOp,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  ReplaceStencilOp,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';
import { blockShadowStrength, lightDirection, resolveLighting } from './lighting';
import type { MaskColumn } from './shadowMask';
import { slopeCornerHeights } from './shapes';
import { isBillboardFlat, isBillboardShape, type LightingDef, type Shape } from './types';

/** 床タイル・格子より上、ブロックの中に埋もれる高さ。 */
const FLOOR_Y = 0.006;
/** 壁の影を面から少し浮かせる。 */
const FACE_LIFT = 0.004;

type Point = [number, number];
type FaceDir = '-x' | '+x' | '-z' | '+z';
type Vertex = [number, number, number];

const FOOTPRINT: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function isBoxShape(shape: Shape | undefined): boolean {
  return shape === undefined || shape === 'box' || shape === 'mesh';
}

/** インスタンスの Y 回転（-90° × 歩数）に合わせる。 */
function rotateFoot(dx: number, dz: number, rotation: number): Point {
  let x = dx - 0.5;
  let z = dz - 0.5;
  const steps = ((rotation % 4) + 4) % 4;
  for (let i = 0; i < steps; i += 1) {
    const nx = -z;
    z = x;
    x = nx;
  }
  return [x + 0.5, z + 0.5];
}

function lerp3(a: Vertex, b: Vertex, t: number): Vertex {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 箱または斜面・板の頂点と辺。影の凸包の元。 */
function occluderPolyhedron(column: MaskColumn): { verts: Vertex[]; edges: Array<[number, number]> } {
  if (isBillboardShape(column.shape ?? '')) return boardPolyhedron(column);
  const foot = column.foot;
  const x = foot?.x0 ?? column.cell.x;
  const z = foot?.z0 ?? column.cell.z;
  const x1 = foot?.x1 ?? column.cell.x + 1;
  const z1 = foot?.z1 ?? column.cell.z + 1;
  const y0 = column.bottom ?? 0;
  const y1 = column.height;
  // 面 1 枚の板（屋根・庇）は、隅の高さで傾けた 1 枚の四角として投げる（DEC-127）。
  if (column.plate) {
    const cellY = column.cell.y;
    const rot = column.rotation ?? 0;
    // 半マスの板（棟を折り目で割ったもの）もあるので、実寸に合わせて伸ばす（DEC-133）。
    const wide = x1 - x;
    const deep = z1 - z;
    const verts: Vertex[] = [];
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < 4; i += 1) {
      // 隅の高さは形の向きのまま。footprint を R で回して当てはめる（斜面と同じ）。
      const [dx, dz] = rotateFoot(FOOTPRINT[i][0], FOOTPRINT[i][1], rot);
      verts.push([x + dx * wide, cellY + (column.plate[i] ?? 0), z + dz * deep]);
    }
    for (let i = 0; i < 4; i += 1) edges.push([i, (i + 1) % 4]);
    return { verts, edges };
  }
  const heights = column.shape ? slopeCornerHeights(column.shape) : undefined;
  if (!heights) {
    const verts: Vertex[] = [
      [x, y0, z],
      [x1, y0, z],
      [x1, y0, z1],
      [x, y0, z1],
      [x, y1, z],
      [x1, y1, z],
      [x1, y1, z1],
      [x, y1, z1],
    ];
    const edges: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    return { verts, edges };
  }
  const cellY = y0;
  const rotation = column.rotation ?? 0;
  const verts: Vertex[] = [];
  const topIdx: number[] = [];
  const botIdx: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [dx, dz] = rotateFoot(FOOTPRINT[i][0], FOOTPRINT[i][1], rotation);
    botIdx.push(verts.length);
    verts.push([x + dx, cellY, z + dz]);
    if (heights[i] > 1e-6) {
      topIdx.push(verts.length);
      verts.push([x + dx, cellY + heights[i], z + dz]);
    } else {
      topIdx.push(botIdx[i]);
    }
  }
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    edges.push([botIdx[i], botIdx[j]]);
    if (topIdx[i] !== topIdx[j]) edges.push([topIdx[i], topIdx[j]]);
    if (topIdx[i] !== botIdx[i]) edges.push([topIdx[i], botIdx[i]]);
  }
  return { verts, edges };
}

/** セル中央の薄い縦板。本体のビルボードと違い、rot だけで向きが決まりカメラでは回らない。 */
function boardPolyhedron(column: MaskColumn): { verts: Vertex[]; edges: Array<[number, number]> } {
  const cx = column.cell.x + 0.5;
  const cz = column.cell.z + 0.5;
  const y0 = column.bottom ?? 0;
  const y1 = column.height;
  const half = 0.5;
  const thick = 0.02;
  const steps = ((((column.rotation ?? 0) % 4) + 4) % 4);
  const corner = (lx: number, ly: number, lz: number): Vertex => {
    let x = lx;
    let z = lz;
    for (let i = 0; i < steps; i += 1) {
      const nx = -z;
      z = x;
      x = nx;
    }
    return [cx + x, ly, cz + z];
  };
  const verts: Vertex[] = [
    corner(-half, y0, -thick),
    corner(half, y0, -thick),
    corner(half, y0, thick),
    corner(-half, y0, thick),
    corner(-half, y1, -thick),
    corner(half, y1, -thick),
    corner(half, y1, thick),
    corner(-half, y1, thick),
  ];
  const edges: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return { verts, edges };
}

function hasVolumeAbove(column: MaskColumn, columns: MaskColumn[]): boolean {
  const top = column.height;
  return columns.some(
    (other) =>
      other !== column &&
      !isBillboardShape(other.shape ?? '') &&
      other.cell.x === column.cell.x &&
      other.cell.z === column.cell.z &&
      Math.abs((other.bottom ?? 0) - top) < 1e-6,
  );
}

/** 2D 凸包（単調連鎖）。辺は頂点間の直線。 */
function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function clipPoly(
  poly: Point[],
  inside: (p: Point) => boolean,
  intersect: (a: Point, b: Point) => Point,
): Point[] {
  if (poly.length === 0) return [];
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (bIn) {
      if (!aIn) out.push(intersect(a, b));
      out.push(b);
    } else if (aIn) {
      out.push(intersect(a, b));
    }
  }
  return out;
}

/** 面の矩形に切り取る。 */
function clipRect(poly: Point[], u0: number, u1: number, v0: number, v1: number): Point[] {
  const lerp = (a: Point, b: Point, t: number): Point => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  let p = poly;
  p = clipPoly(p, (q) => q[0] >= u0, (a, b) => lerp(a, b, (u0 - a[0]) / (b[0] - a[0])));
  p = clipPoly(p, (q) => q[0] <= u1, (a, b) => lerp(a, b, (u1 - a[0]) / (b[0] - a[0])));
  p = clipPoly(p, (q) => q[1] >= v0, (a, b) => lerp(a, b, (v0 - a[1]) / (b[1] - a[1])));
  p = clipPoly(p, (q) => q[1] <= v1, (a, b) => lerp(a, b, (v1 - a[1]) / (b[1] - a[1])));
  return p;
}

/** 影が進む向きに対して、先に当たる側面。 */
function incomingFaces(away: Vector3): FaceDir[] {
  const faces: FaceDir[] = [];
  if (away.x > 0.01) faces.push('-x');
  if (away.x < -0.01) faces.push('+x');
  if (away.z > 0.01) faces.push('-z');
  if (away.z < -0.01) faces.push('+z');
  return faces;
}

function columnFoot(column: MaskColumn): { x0: number; z0: number; x1: number; z1: number } {
  return column.foot ?? {
    x0: column.cell.x,
    z0: column.cell.z,
    x1: column.cell.x + 1,
    z1: column.cell.z + 1,
  };
}

function planeOf(dir: FaceDir, foot: { x0: number; z0: number; x1: number; z1: number }): number {
  if (dir === '+x') return foot.x1;
  if (dir === '-x') return foot.x0;
  if (dir === '+z') return foot.z1;
  return foot.z0;
}

function faceNormal(dir: FaceDir): [number, number, number] {
  if (dir === '+x') return [1, 0, 0];
  if (dir === '-x') return [-1, 0, 0];
  if (dir === '+z') return [0, 0, 1];
  return [0, 0, -1];
}

function faceRayT(
  px: number,
  pz: number,
  dir: FaceDir,
  plane: number,
  away: Vector3,
  length: number,
): number | null {
  if (dir === '+z' || dir === '-z') {
    const denom = away.z * length;
    if (Math.abs(denom) < 1e-8) return null;
    return (plane - pz) / denom;
  }
  const denom = away.x * length;
  if (Math.abs(denom) < 1e-8) return null;
  return (plane - px) / denom;
}

/** 箱の頂点を壁の平面へ、地面と同じ光線で落とす。u は面の横、v は高さ。 */
function projectToFace(
  px: number,
  py: number,
  pz: number,
  dir: FaceDir,
  plane: number,
  away: Vector3,
  length: number,
): Point | null {
  const t = faceRayT(px, pz, dir, plane, away, length);
  if (t === null || t < -1e-4) return null;
  if (dir === '+z' || dir === '-z') return [px + t * away.x * length, py - t];
  return [pz + t * away.z * length, py - t];
}

function uvToWorld(
  dir: FaceDir,
  plane: number,
  u: number,
  v: number,
  unit: number,
): [number, number, number] {
  const y = Math.max(v * unit, FLOOR_Y);
  const lift = FACE_LIFT;
  if (dir === '+z') return [u * unit, y, plane * unit + lift];
  if (dir === '-z') return [u * unit, y, plane * unit - lift];
  if (dir === '+x') return [plane * unit + lift, y, u * unit];
  return [plane * unit - lift, y, u * unit];
}

function projectToTop(
  px: number,
  py: number,
  pz: number,
  yPlane: number,
  away: Vector3,
  length: number,
): Point | null {
  const t = py - yPlane;
  if (t < -1e-4) return null;
  return [px + t * away.x * length, pz + t * away.z * length];
}

function topToWorld(u: number, yPlane: number, v: number, unit: number): [number, number, number] {
  return [u * unit, yPlane * unit + FACE_LIFT, v * unit];
}

/** 上面より上の頂点と、上面を横切る辺の交点。 */
function pointsForTop(column: MaskColumn, yPlane: number, away: Vector3, length: number): Point[] {
  const { verts, edges } = occluderPolyhedron(column);
  const out: Point[] = [];
  for (const [px, py, pz] of verts) {
    const uv = projectToTop(px, py, pz, yPlane, away, length);
    if (uv) out.push(uv);
  }
  for (const [i, j] of edges) {
    const a = verts[i];
    const b = verts[j];
    if ((a[1] - yPlane) * (b[1] - yPlane) >= 0) continue;
    const t = (yPlane - a[1]) / (b[1] - a[1]);
    const p = lerp3(a, b, t);
    const uv = projectToTop(p[0], p[1], p[2], yPlane, away, length);
    if (uv) out.push(uv);
  }
  return out;
}

/** 側面より先にある頂点と、その面を横切る辺の交点。 */
/** 面が接しているか（DEC-127）。1 つの塊の内側に影を描かないための判定。 */
function touchingColumns(a: MaskColumn, b: MaskColumn): boolean {
  const ay0 = a.bottom ?? 0;
  const ay1 = a.height;
  const by0 = b.bottom ?? 0;
  const by1 = b.height;
  if (ay1 < by0 - 1e-6 || by1 < ay0 - 1e-6) return false;
  const fa = columnFoot(a);
  const fb = columnFoot(b);
  const gapX = Math.max(fa.x0 - fb.x1, fb.x0 - fa.x1);
  const gapZ = Math.max(fa.z0 - fb.z1, fb.z0 - fa.z1);
  return gapX <= 1e-6 && gapZ <= 1e-6;
}

function pointsForFace(
  column: MaskColumn,
  dir: FaceDir,
  plane: number,
  away: Vector3,
  length: number,
): Point[] {
  const { verts, edges } = occluderPolyhedron(column);
  const out: Point[] = [];
  const tOf = (v: Vertex) => faceRayT(v[0], v[2], dir, plane, away, length);
  for (const v of verts) {
    const uv = projectToFace(v[0], v[1], v[2], dir, plane, away, length);
    if (uv) out.push(uv);
  }
  for (const [i, j] of edges) {
    const ta = tOf(verts[i]);
    const tb = tOf(verts[j]);
    if (ta === null || tb === null) continue;
    if (ta * tb >= 0) continue;
    const t = ta / (ta - tb);
    const p = lerp3(verts[i], verts[j], t);
    const uv = projectToFace(p[0], p[1], p[2], dir, plane, away, length);
    if (uv) out.push(uv);
  }
  return out;
}

function pushFan(
  positions: number[],
  indices: number[],
  verts: Array<[number, number, number]>,
  normals?: number[],
  normal?: [number, number, number],
): void {
  if (verts.length < 3) return;
  const base = positions.length / 3;
  for (const v of verts) {
    positions.push(v[0], v[1], v[2]);
    if (normals && normal) normals.push(normal[0], normal[1], normal[2]);
  }
  for (let i = 1; i < verts.length - 1; i += 1) {
    indices.push(base, base + i, base + i + 1);
  }
}

/** 直射を環境光まで落とす乗算。灰色のベールは掛けない。 */
function shadowFillMaterial(lighting: LightingDef | undefined, ref = 1): ShaderMaterial {
  const settings = resolveLighting(lighting);
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vFogView;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vFogView = (viewMatrix * world).xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 lightDir;
      uniform float lightAmbient;
      uniform float lightIntensity;
      uniform float lightWrap;
      uniform float shadowStrength;
      varying vec3 vWorldNormal;
      varying vec3 vFogView;
      void main() {
        float d = dot(normalize(vWorldNormal), lightDir);
        float lambert = clamp(mix(max(d, 0.0), d * 0.5 + 0.5, lightWrap), 0.0, 1.0);
        float shade = lightAmbient + lightIntensity * lambert;
        float shadowed = lightAmbient + lightIntensity * lambert * (1.0 - shadowStrength);
        float k = shadowed / max(shade, 0.0001);
        gl_FragColor = vec4(k, k, k, 1.0);
      }
    `,
    uniforms: {
      lightDir: { value: lightDirection(settings) },
      lightAmbient: { value: settings.ambient },
      lightIntensity: { value: settings.intensity },
      lightWrap: { value: settings.wrap },
      shadowStrength: { value: Math.min(1, blockShadowStrength(lighting)) },
    },
    blending: MultiplyBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    toneMapped: false,
    stencilWrite: true,
    stencilRef: ref,
    // タイルはレイヤーごとに深度を手前へ寄せている（DEC-123）。影はそれより少しだけ手前（DEC-128）。
    // 大きくすると、遠くから見たときに影がブロックの手前に出てしまう。
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -12,
    stencilFunc: EqualStencilFunc,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: KeepStencilOp,
  });
}

function stencilWriteMaterial(ref = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    stencilWrite: true,
    stencilRef: ref,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -12,
    stencilFunc: AlwaysStencilFunc,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: ReplaceStencilOp,
  });
}

function makeMesh(geometry: BufferGeometry, material: Material, name: string, order: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 側面と上面へ投射し、面の矩形で切った多角形と、塗り用の面全体を返す。
 */
function buildFaceShadows(
  columns: MaskColumn[],
  away: Vector3,
  length: number,
  unit: number,
  lengthOf?: (column: MaskColumn) => number,
): { stencil: BufferGeometry; fill: BufferGeometry } | null {
  const dirs = incomingFaces(away);
  const stencilPos: number[] = [];
  const stencilIdx: number[] = [];
  const fillPos: number[] = [];
  const fillIdx: number[] = [];
  const fillNrm: number[] = [];
  const filled = new Set<string>();

  for (const receiver of columns) {
    if (receiver.castOnly) continue;
    const box = isBoxShape(receiver.shape);
    const deck = isBillboardFlat(receiver.shape ?? '');
    if (!box && !deck) continue;
    const y0 = receiver.bottom ?? 0;
    const y1 = receiver.height;
    const foot = columnFoot(receiver);
    if (box) {
    for (const dir of dirs) {
      const plane = planeOf(dir, foot);
      const u0 = dir === '+x' || dir === '-x' ? foot.z0 : foot.x0;
      const u1 = dir === '+x' || dir === '-x' ? foot.z1 : foot.x1;
      let hit = false;
      for (const caster of columns) {
        if (caster === receiver) continue;
        if (isBillboardFlat(caster.shape ?? '')) continue;
        // くっついている物どうしは 1 つの塊とみなし、境目に影を出さない（DEC-127）。
        if (touchingColumns(caster, receiver)) continue;
        const reach = lengthOf ? lengthOf(caster) : length;
        if (reach < 0.04) continue;
        const projected = pointsForFace(caster, dir, plane, away, reach);
        if (projected.length < 3) continue;
        const clipped = clipRect(convexHull(projected), u0, u1, y0, y1);
        if (clipped.length < 3) continue;
        hit = true;
        pushFan(
          stencilPos,
          stencilIdx,
          clipped.map(([u, v]) => uvToWorld(dir, plane, u, v, unit)),
        );
      }
      if (!hit) continue;
      const key = `${foot.x0},${foot.z0},${y0},${y1},${dir}`;
      if (filled.has(key)) continue;
      filled.add(key);
      pushFan(
        fillPos,
        fillIdx,
        [
          uvToWorld(dir, plane, u0, y0, unit),
          uvToWorld(dir, plane, u1, y0, unit),
          uvToWorld(dir, plane, u1, y1, unit),
          uvToWorld(dir, plane, u0, y1, unit),
        ],
        fillNrm,
        faceNormal(dir),
      );
    }
    }

    if (hasVolumeAbove(receiver, columns)) continue;
    let topHit = false;
    for (const caster of columns) {
      if (caster === receiver) continue;
      if (isBillboardFlat(caster.shape ?? '')) continue;
      const reach = lengthOf ? lengthOf(caster) : length;
      if (reach < 0.04) continue;
      const projected = pointsForTop(caster, y1, away, reach);
      if (projected.length < 3) continue;
      const clipped = clipRect(convexHull(projected), foot.x0, foot.x1, foot.z0, foot.z1);
      if (clipped.length < 3) continue;
      topHit = true;
      pushFan(
        stencilPos,
        stencilIdx,
        clipped.map(([u, v]) => topToWorld(u, y1, v, unit)),
      );
    }
    if (!topHit) continue;
    const topKey = `${foot.x0},${foot.z0},${y1},+y`;
    if (filled.has(topKey)) continue;
    filled.add(topKey);
    pushFan(
      fillPos,
      fillIdx,
      [
        topToWorld(foot.x0, y1, foot.z0, unit),
        topToWorld(foot.x1, y1, foot.z0, unit),
        topToWorld(foot.x1, y1, foot.z1, unit),
        topToWorld(foot.x0, y1, foot.z1, unit),
      ],
      fillNrm,
      [0, 1, 0],
    );
  }

  if (stencilIdx.length === 0) return null;
  const stencil = new BufferGeometry();
  stencil.setAttribute('position', new BufferAttribute(new Float32Array(stencilPos), 3));
  stencil.setIndex(stencilIdx);
  const fill = new BufferGeometry();
  fill.setAttribute('position', new BufferAttribute(new Float32Array(fillPos), 3));
  fill.setAttribute('normal', new BufferAttribute(new Float32Array(fillNrm), 3));
  fill.setIndex(fillIdx);
  return { stencil, fill };
}

/**
 * 床の投射多角形と、側面・上面へ落とした影を組む。
 */
/**
 * ブロック影（DEC-126）。
 * 影は**遮る物の足元にある地面の高さ**へ敷く。`groundAt` が無ければ今までどおり y=0。
 * 高さごとに分けて、それぞれステンシル番号を変えて塗る（同じ番号だと別の段の影が混ざる）。
 * 段差をまたいで伸びる影は、その段の高さのまま平らに伸びる。地形に沿わせるのは別の話。
 */
export function createFloorShadow(
  columns: MaskColumn[],
  away: Vector3,
  length: number,
  unit: number,
  lighting: LightingDef | undefined,
  lengthOf?: (column: MaskColumn) => number,
  decks: MaskColumn[] = [],
  groundAt?: (column: MaskColumn) => number,
): Group | null {
  if (columns.length === 0 || length <= 0) return null;

  const byGround = new Map<number, MaskColumn[]>();
  for (const column of columns) {
    const ground = groundAt ? groundAt(column) : 0;
    const list = byGround.get(ground);
    if (list) list.push(column);
    else byGround.set(ground, [column]);
  }

  const group = new Group();
  group.name = 'floor-shadow';
  let order = 2;
  let ref = 0;
  let drew = false;

  for (const [groundY, list] of [...byGround.entries()].sort((a, b) => a[0] - b[0])) {
    const positions: number[] = [];
    const indices: number[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const floorY = groundY * unit + FLOOR_Y;

    // 印の付いた柱は、投影点を 1 か所に集めてから凸包を取る（DEC-130）。
    // チップごとに影を出すと、屋根の段差や柱の隙間がそのまま穴になって見える。
    const merged = new Map<string, Point[]>();

    const addHull = (hull: Point[]) => {
      if (hull.length < 3) return;
      const base = positions.length / 3;
      for (const [px, pz] of hull) {
        const wx = px * unit;
        const wz = pz * unit;
        positions.push(wx, floorY, wz);
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz;
        if (wz > maxZ) maxZ = wz;
      }
      for (let i = 1; i < hull.length - 1; i += 1) {
        indices.push(base, base + i, base + i + 1);
      }
    };

    for (const column of list) {
      const reach = lengthOf ? lengthOf(column) : length;
      if (reach < 0.04) continue;
      const projected: Point[] = [];
      for (const [px, py, pz] of occluderPolyhedron(column).verts) {
        // 高さは地面からの差。地面が上がれば影も一緒に上がる。
        const high = Math.max(py - groundY, 0);
        projected.push([px + away.x * high * reach, pz + away.z * high * reach]);
      }
      if (column.silhouette) {
        const bag = merged.get(column.silhouette);
        if (bag) bag.push(...projected);
        else merged.set(column.silhouette, projected);
        continue;
      }
      addHull(convexHull(projected));
    }

    for (const bag of merged.values()) addHull(convexHull(bag));

    if (indices.length === 0) continue;

    const hullGeometry = new BufferGeometry();
    hullGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    hullGeometry.setIndex(indices);

    const pad = 0.01 * unit;
    const fillGeometry = new BufferGeometry();
    fillGeometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          minX - pad, floorY, minZ - pad,
          maxX + pad, floorY, minZ - pad,
          maxX + pad, floorY, maxZ + pad,
          minX - pad, floorY, maxZ + pad,
        ]),
        3,
      ),
    );
    fillGeometry.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    fillGeometry.setIndex([0, 2, 1, 0, 3, 2]);

    // ステンシル番号は段ごとに変える。面の影が 2 番を使うので 3 から回す。
    ref = (ref % 200) + 3;
    group.add(
      makeMesh(hullGeometry, stencilWriteMaterial(ref), 'floor-shadow-stencil', order),
      makeMesh(fillGeometry, shadowFillMaterial(lighting, ref), 'floor-shadow-fill', order + 1),
    );
    order += 2;
    drew = true;
  }

  if (!drew) return null;

  const faces = buildFaceShadows([...columns, ...decks], away, length, unit, lengthOf);
  if (faces) {
    group.add(
      makeMesh(faces.stencil, stencilWriteMaterial(2), 'face-shadow-stencil', order),
      makeMesh(faces.fill, shadowFillMaterial(lighting, 2), 'face-shadow-fill', order + 1),
    );
  }

  return group;
}
