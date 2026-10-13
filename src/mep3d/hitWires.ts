// 形どおりの当たりの表示（GS-237 / マップエディタ DEC-467）。`hitShapes.ts` の三角形をそのまま見せる。
// 緑＝立てる面、橙＝壁の板、赤＝塊（ブロック・斜面・Collision のオブジェクト）。面は半透明で塗り、縁を線で引く。
// **ゲームと同じ形を見せる**——ゲームの当たり（Rapier）もこの三角形から作る。

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { buildHitMeshes, type HitMesh } from './hitShapes';
import type { HitRole } from './hitRules';
import type { MapDef } from './types';

const COLORS: Record<HitRole, number> = { ground: 0x35e07a, wall: 0xffa23a, solid: 0xff5a5a };
const FACE_OPACITY: Record<HitRole, number> = { ground: 0.28, wall: 0.32, solid: 0.18 };

export interface HitWires {
  group: Group;
  setVisible(on: boolean): void;
  /** 三角形の数（役割ごと）。 */
  stats: Record<HitRole, number>;
  dispose(): void;
}

/** 三角形の縁（重なる辺は 1 本にまとめる）。 */
function edgesOf(mesh: HitMesh): Float32Array {
  const seen = new Set<string>();
  const out: number[] = [];
  const key = (i: number) => {
    const v = mesh.vertices;
    return `${v[i * 3].toFixed(3)},${v[i * 3 + 1].toFixed(3)},${v[i * 3 + 2].toFixed(3)}`;
  };
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const ia = mesh.indices[t + a];
      const ib = mesh.indices[t + b];
      const ka = key(ia);
      const kb = key(ib);
      const edge = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      out.push(...mesh.vertices.slice(ia * 3, ia * 3 + 3), ...mesh.vertices.slice(ib * 3, ib * 3 + 3));
    }
  }
  return new Float32Array(out);
}

/** マップの当たりを組んで `parent` に足す。見せるのは `setVisible(true)` のあと。 */
export function createHitWires(parent: Object3D, map: MapDef): HitWires {
  const group = new Group();
  group.name = 'hit-wires';
  group.visible = false;
  const stats: Record<HitRole, number> = { ground: 0, wall: 0, solid: 0 };
  const disposables: Array<{ dispose(): void }> = [];
  for (const mesh of buildHitMeshes(map)) {
    if (mesh.indices.length < 3) continue;
    stats[mesh.role] += mesh.indices.length / 3;
    const faceGeometry = new BufferGeometry();
    faceGeometry.setAttribute('position', new BufferAttribute(mesh.vertices, 3));
    faceGeometry.setIndex(new BufferAttribute(mesh.indices, 1));
    const faceMaterial = new MeshBasicMaterial({
      color: COLORS[mesh.role],
      transparent: true,
      opacity: FACE_OPACITY[mesh.role],
      depthWrite: false,
      side: DoubleSide,
      // 描いた面と同じ所に重なるので、少し手前へ出す。
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const faces = new Mesh(faceGeometry, faceMaterial);
    faces.renderOrder = 10;
    faces.name = `${mesh.from}（${mesh.role}）`;
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new BufferAttribute(edgesOf(mesh), 3));
    const edgeMaterial = new LineBasicMaterial({ color: COLORS[mesh.role], transparent: true, opacity: 0.75 });
    const edges = new LineSegments(edgeGeometry, edgeMaterial);
    edges.renderOrder = 11;
    group.add(faces, edges);
    disposables.push(faceGeometry, faceMaterial, edgeGeometry, edgeMaterial);
  }
  parent.add(group);
  return {
    group,
    setVisible(on) {
      group.visible = on;
    },
    stats,
    dispose() {
      group.removeFromParent();
      for (const item of disposables) item.dispose();
    },
  };
}
