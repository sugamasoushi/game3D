// 敵の技の予兆（2026-11-05。`foeFieldAttack.ts`）。**当たる範囲のマスを床に赤く出す。**
// 1 マスごとに少し小さい四角を床の高さへ敷き、ゆっくり明滅させる。光は当てない（夜でも見える）。
// 深度は見る（壁の向こうは隠れる）が書かない。床とぴったり重ならないよう少し浮かせる。

import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D } from 'three';

/** 1 マスに対する四角の大きさ（隣のマスと分かれて見えるように）。 */
const CELL_FILL = 0.9;
/** 床から浮かせる高さ（マス）。 */
const LIFT = 0.03;
const RENDER_ORDER = 7000;

export interface DangerCells {
  /** 範囲を出す。`key` ごとに 1 組（同じ `key` で出し直すと置き換え）。位置はワールド座標（床の高さ）。 */
  show(key: string, cells: readonly { x: number; y: number; z: number }[], unit: number, seconds: number): void;
  clear(key: string): void;
  clearAll(): void;
  /** 毎フレーム。明滅させる（予兆の終わりに近づくほど速く濃く）。 */
  update(elapsed: number): void;
  dispose(): void;
}

export function createDangerCells(parent: Object3D): DangerCells {
  const group = new Group();
  group.name = 'danger-cells';
  parent.add(group);
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const sets = new Map<string, { meshes: Mesh[]; material: MeshBasicMaterial; start: number; seconds: number }>();
  let now = 0;

  const clear = (key: string) => {
    const set = sets.get(key);
    if (!set) return;
    for (const mesh of set.meshes) mesh.removeFromParent();
    set.material.dispose();
    sets.delete(key);
  };

  return {
    show(key, cells, unit, seconds) {
      clear(key);
      const material = new MeshBasicMaterial({ color: 0xff1a0a, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide, toneMapped: false, fog: false });
      const meshes = cells.map((cell) => {
        const mesh = new Mesh(geometry, material);
        mesh.scale.set(unit * CELL_FILL, 1, unit * CELL_FILL);
        mesh.position.set(cell.x, cell.y + LIFT * unit, cell.z);
        mesh.renderOrder = RENDER_ORDER;
        group.add(mesh);
        return mesh;
      });
      sets.set(key, { meshes, material, start: now, seconds: Math.max(0.05, seconds) });
    },
    clear,
    clearAll() {
      for (const key of [...sets.keys()]) clear(key);
    },
    update(elapsed) {
      now = elapsed;
      for (const set of sets.values()) {
        const t = Math.min(1, (elapsed - set.start) / set.seconds);
        const speed = 4 + 10 * t;
        set.material.opacity = 0.5 + 0.3 * t + 0.15 * Math.sin((elapsed - set.start) * speed);
      }
    },
    dispose() {
      for (const key of [...sets.keys()]) clear(key);
      geometry.dispose();
      group.removeFromParent();
    },
  };
}
