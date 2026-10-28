// 風で揺らすチップの塊（GS-274）。**木 1 本ぶんの塊ごとに**根元と揺れの位相を決める。
//
// 列ごとに決めると、1 本の木でも列ごとに別々に揺れて絵が割れる（利用者の指摘）。
// 塊の決め方:
//   - スタンプで置いた物（`gid` あり）: 同じレイヤーの同じ `gid` を 1 本とする。別のレイヤーでも
//     同じ `gid` で XZ の範囲が重なる物は同じ 1 本（幹と葉をレイヤーに分けたスタンプ）。
//     レイヤーの写しは同じ `gid` が別の場所に残るので、重ならなければ混ぜない。
//   - 1 枚ずつ描いた物（`gid` 0）: 同じレイヤーで面が接するチップを 1 塊にする。
//     ただし横か奥行きが `LOOSE_SWAY_SPAN` を超える塊（森の壁など）は列ごとに分ける——一斉に動くと板のように見える。
//   - **真上に積んだ塊は同じ 1 本**（レイヤーをまたいでも）。幹・葉・葉と 2 段ずつのスタンプを積んだ木が、
//     段ごとに自分の下端を支点にしなって、行ごとに割れて見えた（利用者の指摘）。横に接するだけの隣の木はつながない。
// 塊の根元はいちばん低いマス、揺れの位相と風の範囲の判定は塊の XZ の中心で取る。
//
// チップ 1 枚ずつのデータ（根元・中心）は、インスタンスの番号で引く表（`createSwayDataTexture`）にして渡す。
// 頂点の属性は 16 個で上限なので、属性には足せない（GC-36）。

import { DataTexture, FloatType, NearestFilter, RGBAFormat, type InstancedMesh, type Material, type Object3D } from 'three';

/** 1 枚ずつ描いた塊を 1 本とみなす大きさの上限（マス）。超えたら列ごとに揺らす。 */
export const LOOSE_SWAY_SPAN = 8;

/** 揺らすチップ 1 枚。座標はマス。 */
export interface SwayCell {
  layer: string;
  x: number;
  y: number;
  z: number;
  /** スタンプの組。0 は 1 枚ずつ描いた物。 */
  gid: number;
}

/** チップ 1 枚が属する塊の根元と中心（マス）。 */
export interface SwayAnchor {
  /** 塊のいちばん低いマス。ここから上ほどしなる。 */
  root: number;
  /** 塊の XZ の中心。揺れの位相と、風の範囲に入っているかをここで決める。 */
  x: number;
  z: number;
}

/** 並びは `cells` と同じ。 */
export function swayAnchors(cells: readonly SwayCell[]): SwayAnchor[] {
  const n = cells.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  type Box = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number };
  const boxOf = (members: readonly number[]): Box => {
    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity };
    for (const i of members) {
      const cell = cells[i];
      box.minX = Math.min(box.minX, cell.x);
      box.maxX = Math.max(box.maxX, cell.x);
      box.minZ = Math.min(box.minZ, cell.z);
      box.maxZ = Math.max(box.maxZ, cell.z);
      box.minY = Math.min(box.minY, cell.y);
    }
    return box;
  };
  const groups = (): Map<number, number[]> => {
    const out = new Map<number, number[]>();
    for (let i = 0; i < n; i += 1) {
      const root = find(i);
      const list = out.get(root);
      if (list) list.push(i);
      else out.set(root, [i]);
    }
    return out;
  };

  // 1. もとの塊。スタンプは同じレイヤーの同じ gid、1 枚ずつは同じレイヤーで面が接するもの。
  const stampOf = new Map<string, number>();
  const looseAt = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const cell = cells[i];
    if (cell.gid) {
      const key = `${cell.layer}|${cell.gid}`;
      const first = stampOf.get(key);
      if (first === undefined) stampOf.set(key, i);
      else union(first, i);
      continue;
    }
    const key = `${cell.layer}|${cell.x},${cell.y},${cell.z}`;
    const same = looseAt.get(key);
    if (same === undefined) looseAt.set(key, i);
    else union(same, i);
  }
  const NEIGHBOURS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (const [key, i] of looseAt) {
    const cell = cells[i];
    const layer = key.slice(0, key.lastIndexOf('|'));
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const next = looseAt.get(`${layer}|${cell.x + dx},${cell.y + dy},${cell.z + dz}`);
      if (next !== undefined) union(i, next);
    }
  }

  // 2. 大きすぎる 1 枚ずつの塊（森の壁）は列ごとに揺らす。ほかの塊とはつながない。
  const wide = new Set<number>();
  for (const [root, list] of groups()) {
    if (cells[root].gid) continue;
    const box = boxOf(list);
    if (box.maxX - box.minX + 1 > LOOSE_SWAY_SPAN || box.maxZ - box.minZ + 1 > LOOSE_SWAY_SPAN) {
      for (const i of list) wide.add(i);
    }
  }

  // 3. 別のレイヤーの同じ gid で XZ の範囲が重なるスタンプは同じ 1 本（幹と葉をレイヤーに分けたスタンプ）。
  const stampsByGid = new Map<number, Array<{ root: number; box: Box }>>();
  for (const [root, list] of groups()) {
    const gid = cells[root].gid;
    if (!gid) continue;
    const entry = stampsByGid.get(gid) ?? [];
    entry.push({ root, box: boxOf(list) });
    stampsByGid.set(gid, entry);
  }
  for (const list of stampsByGid.values()) {
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const p = list[a].box;
        const q = list[b].box;
        if (p.minX <= q.maxX && q.minX <= p.maxX && p.minZ <= q.maxZ && q.minZ <= p.maxZ) union(list[a].root, list[b].root);
      }
    }
  }

  // 4. 真上に積んだ塊は同じ 1 本（幹のスタンプの上に葉のスタンプ、のように段ごとに置いた木）。
  //    レイヤーをまたいでもつなぐ。横に接するだけの隣の木はつながない。
  const at = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    if (wide.has(i)) continue;
    const cell = cells[i];
    at.set(`${cell.x},${cell.y},${cell.z}`, i);
  }
  for (let i = 0; i < n; i += 1) {
    if (wide.has(i)) continue;
    const cell = cells[i];
    const below = at.get(`${cell.x},${cell.y - 1},${cell.z}`);
    if (below !== undefined) union(below, i);
  }

  // 5. 塊ごとに根元と中心を出す。
  const out: SwayAnchor[] = new Array(n);
  for (const list of groups().values()) {
    if (!wide.has(list[0])) {
      const box = boxOf(list);
      const anchor: SwayAnchor = { root: box.minY, x: (box.minX + box.maxX + 1) / 2, z: (box.minZ + box.maxZ + 1) / 2 };
      for (const i of list) out[i] = anchor;
      continue;
    }
    // 大きな塊は列ごと（塊の中の列のいちばん低いマスが根元）。
    const columns = new Map<string, number>();
    for (const i of list) {
      const key = `${cells[i].x},${cells[i].z}`;
      const low = columns.get(key);
      if (low === undefined || cells[i].y < low) columns.set(key, cells[i].y);
    }
    for (const i of list) {
      const cell = cells[i];
      out[i] = { root: columns.get(`${cell.x},${cell.z}`) as number, x: cell.x + 0.5, z: cell.z + 0.5 };
    }
  }
  return out;
}

/** 表の横幅の上限。インスタンスの番号を (番号 % 幅, 番号 / 幅) で引く。 */
const DATA_WIDTH = 1024;

/**
 * チップ 1 枚ずつの塊の情報（GS-274）。RGBA = 根元・中心 X・中心 Z・1（揺らす印）。シェーダが `gl_InstanceID` で引く。
 */
export function createSwayDataTexture(anchors: readonly SwayAnchor[]): DataTexture {
  const width = Math.max(1, Math.min(DATA_WIDTH, anchors.length));
  const height = Math.max(1, Math.ceil(anchors.length / width));
  const data = new Float32Array(width * height * 4);
  anchors.forEach((anchor, i) => {
    data.set([anchor.root, anchor.x, anchor.z, 1], i * 4);
  });
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

let emptyData: DataTexture | null = null;

/** 表が無いときの 1x1（印 0＝揺らさない）。 */
export function emptySwayDataTexture(): DataTexture {
  emptyData ??= createSwayDataTexture([]);
  return emptyData;
}

/**
 * メッシュの表を描く直前に材質へ入れる（GS-274）。材質は同じ形のバッチで共有しているので、
 * 表はメッシュの側に持たせ、描くたびに差し替えて uniform を送り直す。
 */
function swayBeforeRender(this: Object3D, _renderer: unknown, _scene: unknown, _camera: unknown, _geometry: unknown, material: Material) {
  const texture = this.userData.mepSwayData as DataTexture | undefined;
  const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (!uniforms?.mepSwayData) return;
  uniforms.mepSwayData.value = texture ?? emptySwayDataTexture();
  uniforms.mepSwayDataWidth.value = texture ? texture.image.width : 1;
  (material as Material & { uniformsNeedUpdate?: boolean }).uniformsNeedUpdate = true;
}

/** メッシュへ表を付ける。前の表を返す（捨てるのは呼ぶ側。引き継ぎの途中で前のシーンがまだ描くため）。 */
export function attachSwayData(mesh: InstancedMesh, texture: DataTexture | null): DataTexture | null {
  const before = (mesh.userData.mepSwayData as DataTexture | undefined) ?? null;
  if (texture) mesh.userData.mepSwayData = texture;
  else delete mesh.userData.mepSwayData;
  mesh.onBeforeRender = swayBeforeRender as unknown as InstancedMesh['onBeforeRender'];
  return before;
}
