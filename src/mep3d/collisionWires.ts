// 当たり判定のデバッグ表示。ゲームが「どこを足場と見ているか」を目で確かめる用。
// 緑の板＝立てる面、赤い枠＝体が入れないマス。

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Scene,
} from 'three';
import type { CollisionMap } from './collision';

/** 面が床にめり込まないよう少しだけ持ち上げる。 */
const LIFT = 0.012;

export interface CollisionWires {
  setVisible(on: boolean): void;
  dispose(): void;
  stats: { surfaces: number; blockers: number };
}

export function createCollisionWires(scene: Scene, collision: CollisionMap): CollisionWires {
  const unit = collision.unit;
  const group = new Group();
  group.name = 'collision-debug';
  group.visible = false;

  const surfaces = collision.surfaces();
  const blockers = collision.blockers();

  const faceGeometry = new BufferGeometry();
  const facePositions = new Float32Array(surfaces.length * 6 * 3);
  surfaces.forEach((cell, index) => {
    const x0 = cell.x * unit;
    const x1 = (cell.x + 1) * unit;
    const z0 = cell.z * unit;
    const z1 = (cell.z + 1) * unit;
    const y = cell.top + LIFT * unit;
    const quad = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
    facePositions.set(quad, index * 18);
  });
  faceGeometry.setAttribute('position', new BufferAttribute(facePositions, 3));
  const faceMaterial = new MeshBasicMaterial({
    color: 0x35e07a,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: DoubleSide,
  });
  const faces = new Mesh(faceGeometry, faceMaterial);
  faces.renderOrder = 10;
  group.add(faces);

  const edgeGeometry = new BufferGeometry();
  const edgePositions = new Float32Array(blockers.length * 24 * 3);
  blockers.forEach((entry, index) => {
    const { x: cx, y: cy, z: cz, foot, line } = entry;
    const y0 = cy * unit;
    const y1 = (cy + 1) * unit;
    // 塞ぐ範囲だけを描く（DEC-236）。壁チップはマス全部ではない。
    const x0 = (cx + foot[0]) * unit;
    const z0 = (cz + foot[1]) * unit;
    const x1 = (cx + foot[2]) * unit;
    const z1 = (cz + foot[3]) * unit;
    const corner = line
      ? // 対角は四角で書けないので、線に沿った薄い板として 4 隅を出す。
        (() => {
          const b = 0.14 * unit;
          const mx = (cx + 0.5) * unit;
          const mz = (cz + 0.5) * unit;
          const half = 0.5 * unit;
          const dx = half;
          const dz = line.nwse ? half : -half;
          // 対角に垂直な向きへ厚みぶんずらす。
          const nx = line.nwse ? b : b;
          const nz = line.nwse ? -b : b;
          return [
            [mx - dx + nx, y0, mz - dz + nz],
            [mx + dx + nx, y0, mz + dz + nz],
            [mx + dx - nx, y0, mz + dz - nz],
            [mx - dx - nx, y0, mz - dz - nz],
            [mx - dx + nx, y1, mz - dz + nz],
            [mx + dx + nx, y1, mz + dz + nz],
            [mx + dx - nx, y1, mz + dz - nz],
            [mx - dx - nx, y1, mz - dz - nz],
          ];
        })()
      : [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ];
    const pairs = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    let cursor = index * 72;
    for (const [a, b] of pairs) {
      edgePositions.set(corner[a], cursor);
      edgePositions.set(corner[b], cursor + 3);
      cursor += 6;
    }
  });
  edgeGeometry.setAttribute('position', new BufferAttribute(edgePositions, 3));
  const edgeMaterial = new LineBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.6 });
  const edges = new LineSegments(edgeGeometry, edgeMaterial);
  edges.renderOrder = 11;
  group.add(edges);

  scene.add(group);

  return {
    setVisible(on) {
      group.visible = on;
    },
    dispose() {
      group.removeFromParent();
      faceGeometry.dispose();
      faceMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
    },
    stats: { surfaces: surfaces.length, blockers: blockers.length },
  };
}
