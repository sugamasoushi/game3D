// 形どおりの当たり（GS-237。物理エンジン Rapier へ移すための土台）。
//
// 今の当たり（`collision.ts`）はマスごとに「塞ぐ・立てる」を決めて当てる。ここは**描く形そのもの**を
// 三角形にして返す。物理エンジンには依らない——ゲームは Rapier に渡し、エディタは線で見せる。
//
// 決まり（どのチップが何になるか）は `hitRules.ts`。オブジェクトの当たり（`Collision` / `Ground`）は今までどおり。
//
// 置き方（回転・壁の向き・ずらし・箱の厚み）は描画（`loader.ts` の `buildBatch`）と同じ式。
// ずらすと「見えている形」と「当たる形」が食い違うので、変えるときは両方を直す。

import { Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { groundHeightAt, groundPatchOf, readNoHitCells, readSolidCells } from './collision';
import { decodeCells, decodeProtoIndices, decodeRotationFlags } from './decode';
import {
  applyWallPose,
  boxHeight,
  geometryFor,
  offsetFor,
  offsetInCells,
  offsetStepsFor,
  protosByIdWithOffsets,
  readThickness,
  solidPieceHeight,
} from './shapes';
import { chipRoleOf, layerHitOf, type HitRole } from './hitRules';
import {
  isEdgeWallShape,
  isSolidPieceShape,
  ROTATION_MASK,
  shapeRotates,
  type AssetsDef,
  type MapDef,
  type ProtoDef,
} from './types';

export { chipRoleOf, layerHitOf, type HitRole } from './hitRules';

/** 当たりの三角形の束。座標はワールド、`indices` は 3 つで 1 枚。 */
export interface HitMesh {
  role: HitRole;
  /** どこから来たか（デバッグ表示用）。レイヤー名かオブジェクトの名前。 */
  from: string;
  vertices: Float32Array;
  indices: Uint32Array;
}

/** 三角形を貯める。役割ごとに 1 本にまとめる（当たりの数を減らす）。 */
class Soup {
  vertices: number[] = [];
  indices: number[] = [];
  push(points: ArrayLike<number>, index: ArrayLike<number>): void {
    const base = this.vertices.length / 3;
    for (let i = 0; i < points.length; i += 1) this.vertices.push(points[i]);
    for (let i = 0; i < index.length; i += 1) this.indices.push(base + index[i]);
  }
  /** 軸に沿った箱（ワールド）。12 枚。 */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    // prettier-ignore
    const p = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    // prettier-ignore
    const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    this.push(p, f);
  }
  take(role: HitRole, from: string): HitMesh | null {
    if (this.indices.length === 0) return null;
    return { role, from, vertices: new Float32Array(this.vertices), indices: new Uint32Array(this.indices) };
  }
}

const point = new Vector3();

/** 形の三角形を 1 枚の行列で置いて足す。 */
function pushGeometry(soup: Soup, geometry: BufferGeometry, matrix: Matrix4): void {
  const position = geometry.getAttribute('position');
  const points = new Float32Array(position.count * 3);
  for (let v = 0; v < position.count; v += 1) {
    point.fromBufferAttribute(position, v).applyMatrix4(matrix);
    points[v * 3] = point.x;
    points[v * 3 + 1] = point.y;
    points[v * 3 + 2] = point.z;
  }
  const index = geometry.getIndex();
  soup.push(points, index ? (index.array as ArrayLike<number>) : Array.from({ length: position.count }, (_, i) => i));
}

/**
 * 箱の厚み（DEC-96）。描画のシェーダと同じ範囲（マスの中の 0..1 ではなく中心からの -0.5..0.5）。
 * 厚みが無ければ null（マスいっぱい）。
 */
function boxRange(proto: ProtoDef | undefined): [number, number, number, number, number, number] | null {
  // 厚みは [Y, Z, X] の順（`readThickness`）。描画（`loader.ts`）と同じ読み順にする。
  const [ty, tz, tx] = readThickness(proto?.thickness);
  const cx = boxHeight(tx);
  const cy = boxHeight(ty);
  const cz = boxHeight(tz);
  if (Math.abs(cx - 1) < 1e-6 && Math.abs(cy - 1) < 1e-6 && Math.abs(cz - 1) < 1e-6) return null;
  const x0 = tx >= 0 ? 0.5 - cx : -0.5;
  const x1 = tx >= 0 ? 0.5 : -0.5 + cx;
  const y0 = ty < 0 ? -0.5 : 0.5 - cy;
  const y1 = ty < 0 ? -0.5 + cy : 0.5;
  const z0 = tz >= 0 ? -0.5 : 0.5 - cz;
  const z1 = tz >= 0 ? -0.5 + cz : 0.5;
  return [x0, y0, z0, x1, y1, z1];
}

function pointInPolygon(shape: Array<[number, number]>, x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i, i += 1) {
    const [xi, zi] = shape[i];
    const [xj, zj] = shape[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * マップの当たりを三角形で返す。**`Hidden`（ゲームで描かない）のレイヤーも当てる**——
 * 見えない壁として使う決まり（GS-57）なので、描く用のマップではなく元のマップを渡す。
 * エディタで目を閉じたレイヤー（`visible: false`）は当てない（今の当たりと同じ）。
 */
export function buildHitMeshes(map: MapDef): HitMesh[] {
  const unit = map.grid?.unit ?? 1;
  const assets = typeof map.assets === 'object' && map.assets ? (map.assets as AssetsDef) : null;
  const offsetSteps = offsetStepsFor(assets?.version ?? 1);
  // ずれの分母を揃えた表（DEC-516）。描画と同じ。
  const protosById = protosByIdWithOffsets(assets?.protos, offsetSteps);
  const out: HitMesh[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3(unit, unit, unit);
  const offset = new Vector3();
  const scratch = new Vector3();
  const UP = new Vector3(0, 1, 0);
  // 「当たりを外す」オブジェクトの中のチップは当たりを作らない（GS-238）。
  const noHit = readNoHitCells(map);

  for (const layer of map.layers) {
    if (layer.kind !== 'tile' || layer.visible === false) continue;
    const hit = layerHitOf(layer);
    if (hit === 'none') continue;
    const soups: Record<HitRole, Soup> = { ground: new Soup(), wall: new Soup(), solid: new Soup() };
    for (const batch of layer.batches) {
      const role = chipRoleOf(batch.shape, hit);
      if (!role) continue;
      const cells = decodeCells(batch);
      const flags = decodeRotationFlags(batch);
      const protoIndices = decodeProtoIndices(batch);
      const shapeOffset = offsetFor(batch.shape);
      const geometry = batch.shape === 'mesh' ? null : geometryFor(batch.shape);
      for (let i = 0; i < batch.count; i += 1) {
        const cx = cells[i * 3];
        const cy = cells[i * 3 + 1];
        const cz = cells[i * 3 + 2];
        if (noHit.has(`${cx},${cy},${cz}`)) continue;
        // メッシュの形は持っていないので、マスを丸ごと塞ぐ。`block` のレイヤーも形に関係なくマスを塞ぐ（進入禁止）。
        if (batch.shape === 'mesh' || hit === 'block') {
          soups.solid.box(cx * unit, cy * unit, cz * unit, (cx + 1) * unit, (cy + 1) * unit, (cz + 1) * unit);
          continue;
        }
        const proto = protosById.get(batch.protos[protoIndices[i]]);
        if (batch.shape === 'box') {
          const range = boxRange(proto) ?? [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5];
          const nudge = proto?.offset ? offsetInCells(proto.offset, offsetSteps, scratch) : scratch.set(0, 0, 0);
          const ox = cx + 0.5 + nudge.x;
          const oy = cy + 0.5 + nudge.y;
          const oz = cz + 0.5 + nudge.z;
          soups.solid.box(
            (ox + range[0]) * unit, (oy + range[1]) * unit, (oz + range[2]) * unit,
            (ox + range[3]) * unit, (oy + range[4]) * unit, (oz + range[5]) * unit,
          );
          continue;
        }
        // 立体の部品（DEC-479）は描画と同じく高さぶん縦に縮め、マスの床にそろえる。
        if (isSolidPieceShape(batch.shape)) {
          const height = solidPieceHeight(proto?.thickness);
          offset.set(0, (height - 1) / 2, 0);
          if (proto?.offset) offset.add(offsetInCells(proto.offset, offsetSteps, scratch));
          position.set(cx + 0.5, cy + 0.5, cz + 0.5).add(offset).multiplyScalar(unit);
          quaternion.identity();
          matrix.compose(position, quaternion, scratch.set(unit, unit * height, unit));
          pushGeometry(soups[role], geometry as BufferGeometry, matrix);
          continue;
        }
        const rotation = shapeRotates(batch.shape) ? (flags[i] ?? 0) & ROTATION_MASK : 0;
        if (isEdgeWallShape(batch.shape)) {
          applyWallPose(rotation, offset, quaternion);
          offset.multiplyScalar(unit);
        } else {
          quaternion.setFromAxisAngle(UP, (-rotation * Math.PI) / 2);
          offset.copy(shapeOffset).multiplyScalar(unit).applyQuaternion(quaternion);
        }
        if (proto?.offset) offset.add(offsetInCells(proto.offset, offsetSteps, scratch).multiplyScalar(unit));
        position.set(cx + 0.5, cy + 0.5, cz + 0.5).multiplyScalar(unit).add(offset);
        matrix.compose(position, quaternion, scale);
        pushGeometry(soups[role], geometry as BufferGeometry, matrix);
      }
    }
    for (const role of ['ground', 'wall', 'solid'] as const) {
      const mesh = soups[role].take(role, layer.name);
      if (mesh) out.push(mesh);
    }
  }

  // オブジェクトの当たり（DEC-338 の `Collision`）。マスを丸ごと塞ぐ。
  const solidCells = new Soup();
  for (const key of new Set(readSolidCells(map))) {
    const [x, y, z] = key.split(',').map(Number);
    solidCells.box(x * unit, y * unit, z * unit, (x + 1) * unit, (y + 1) * unit, (z + 1) * unit);
  }
  const solidMesh = solidCells.take('solid', 'Collision のオブジェクト');
  if (solidMesh) out.push(solidMesh);

  // 見えない地面（DEC-332 の `Ground`）。ブロックは箱、面はマスごとの板（坂は 4 隅の高さ）。
  const ground = new Soup();
  for (const layer of map.layers) {
    if (layer.kind !== 'object' || layer.visible === false) continue;
    for (const entry of layer.objects ?? []) {
      if (entry.visible === false) continue;
      const patch = groundPatchOf(entry);
      if (!patch) continue;
      if (patch.solid) {
        for (const [x, y, z] of patch.cells ?? []) ground.box(x * unit, y * unit, z * unit, (x + 1) * unit, (y + 1) * unit, (z + 1) * unit);
        continue;
      }
      for (let z = Math.floor(patch.minZ); z < Math.ceil(patch.maxZ); z += 1) {
        for (let x = Math.floor(patch.minX); x < Math.ceil(patch.maxX); x += 1) {
          const inside = patch.shape
            ? pointInPolygon(patch.shape, x + 0.5, z + 0.5)
            : x + 0.5 >= patch.minX && x + 0.5 <= patch.maxX && z + 0.5 >= patch.minZ && z + 0.5 <= patch.maxZ;
          if (!inside) continue;
          const h = (u: number, v: number) => groundHeightAt(patch, u, v) * unit;
          // prettier-ignore
          ground.push([
            x * unit, h(x, z), z * unit, (x + 1) * unit, h(x + 1, z), z * unit,
            (x + 1) * unit, h(x + 1, z + 1), (z + 1) * unit, x * unit, h(x, z + 1), (z + 1) * unit,
          ], [0, 2, 1, 0, 3, 2]);
        }
      }
    }
  }
  const groundMesh = ground.take('ground', 'Ground のオブジェクト');
  if (groundMesh) out.push(groundMesh);
  return out;
}
