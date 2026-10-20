// カメラエディタ用のマス目（GS-167）。**道具のための表示で、遊ぶ画面には出ない。**
//
// 出すのは 3 つだけ。
//   1. 主人公を中心にしたマス目（どのマスがどこか、目で数えられるように）
//   2. いまカメラが見ているマスの枠（「基準のマス」）
//   3. マウスを置いているマスの色（マスを拾うのを待っている間だけ。2026-10-20 / Event Editor EE-87）
//
// **当たり判定の線（`collisionWires`）と同じ作り**にしてある——線は 1 本の `LineSegments`、
// 見せ消しは `visible` だけ。毎フレーム作り直すと、演出を再生しながら見たときに重い。

import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Scene,
} from 'three';

/** 主人公を中心に出すマスの数（片側）。21×21 マスぶん。 */
const HALF = 10;
/** 床にめり込まないよう少しだけ持ち上げる。 */
const LIFT = 0.02;

export interface EditorGrid {
  setVisible(on: boolean): void;
  visible(): boolean;
  /** 主人公とカメラの注視点（ワールド）に合わせて置き直す。 */
  update(center: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, unit: number): void;
  /**
   * マウスを置いているマス（マスの番号。`y` は床の高さ〈マス〉）。null で消す。
   * マス目を出していなくても出す——拾うときに、どのマスが入るかを見せるためのもの。
   */
  setHover(cell: { x: number; y: number; z: number } | null, unit: number): void;
  /** いま色を付けているマス。無ければ null。 */
  hover(): { x: number; y: number; z: number } | null;
  dispose(): void;
}

/** マス目の線。原点まわりに組んでおき、置き場所はグループの位置で動かす。 */
function gridLines(unit: number): BufferGeometry {
  const points: number[] = [];
  const span = HALF * unit;
  for (let i = -HALF; i <= HALF; i += 1) {
    const at = i * unit;
    points.push(at, 0, -span, at, 0, span);
    points.push(-span, 0, at, span, 0, at);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
}

/** マス 1 つを塗る板（上向き。原点の角から +x・+z へ 1 マス）。 */
function cellFill(unit: number): BufferGeometry {
  const s = unit;
  const points = [0, 0, 0, 0, 0, s, s, 0, 0, s, 0, 0, 0, 0, s, s, 0, s];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
}

/** マス 1 つの枠（上向き）。こちらも原点まわり。 */
function cellFrame(unit: number): BufferGeometry {
  const s = unit;
  const points = [0, 0, 0, s, 0, 0, s, 0, 0, s, 0, s, s, 0, s, 0, 0, s, 0, 0, s, 0, 0, 0];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
}

export function createEditorGrid(scene: Scene): EditorGrid {
  const group = new Group();
  group.name = 'editor-grid';
  group.visible = false;
  scene.add(group);

  let unitNow = 0;
  let mesh: LineSegments | null = null;
  let frame: LineSegments | null = null;
  const gridMaterial = new LineBasicMaterial({ color: 0x3fa9ff, transparent: true, opacity: 0.45, depthTest: false });
  const frameMaterial = new LineBasicMaterial({ color: 0xffd447, depthTest: false });
  // マウスの下のマス。**マス目の外に置く**（マス目を出していなくても見せる）。両面から見えるように。
  const hoverMaterial = new MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, side: DoubleSide });
  const hoverEdgeMaterial = new LineBasicMaterial({ color: 0xffb37a, depthTest: false });
  const hoverGroup = new Group();
  hoverGroup.name = 'editor-grid-hover';
  hoverGroup.visible = false;
  scene.add(hoverGroup);
  let hoverUnit = 0;
  let hoverCell: { x: number; y: number; z: number } | null = null;
  let hoverFill: Mesh | null = null;
  let hoverEdge: LineSegments | null = null;

  /** マスの大きさが変わったら組み直す（マップを替えたとき）。 */
  const build = (unit: number) => {
    if (unitNow === unit) return;
    unitNow = unit;
    mesh?.geometry.dispose();
    frame?.geometry.dispose();
    mesh?.removeFromParent();
    frame?.removeFromParent();
    mesh = new LineSegments(gridLines(unit), gridMaterial);
    frame = new LineSegments(cellFrame(unit), frameMaterial);
    // **線は最後に描く**（depthTest を切ってあるので、床に隠れず読める）。
    mesh.renderOrder = 900;
    frame.renderOrder = 901;
    group.add(mesh, frame);
  };

  return {
    setVisible(on) {
      group.visible = on;
    },
    visible: () => group.visible,
    setHover(cell, unit) {
      hoverCell = cell ? { ...cell } : null;
      hoverGroup.visible = Boolean(cell);
      if (!cell) return;
      if (hoverUnit !== unit) {
        hoverUnit = unit;
        hoverFill?.geometry.dispose();
        hoverEdge?.geometry.dispose();
        hoverFill?.removeFromParent();
        hoverEdge?.removeFromParent();
        hoverFill = new Mesh(cellFill(unit), hoverMaterial);
        hoverEdge = new LineSegments(cellFrame(unit), hoverEdgeMaterial);
        // マス目と枠より後に描く。
        hoverFill.renderOrder = 902;
        hoverEdge.renderOrder = 903;
        hoverGroup.add(hoverFill, hoverEdge);
      }
      hoverGroup.position.set(cell.x * unit, cell.y * unit + LIFT * 3, cell.z * unit);
    },
    hover: () => (hoverCell ? { ...hoverCell } : null),
    update(center, target, unit) {
      if (!group.visible) return;
      build(unit);
      // マス目は**マスの角**に合わせる。主人公の居るマスの角が基準。
      const cx = Math.floor(center.x / unit) * unit;
      const cz = Math.floor(center.z / unit) * unit;
      if (mesh) mesh.position.set(cx, center.y + LIFT, cz);
      // 注視点のマス。高さは主人公と同じにする——足下に敷いて読むためのもの。
      if (frame) {
        frame.position.set(
          Math.floor(target.x / unit) * unit,
          center.y + LIFT * 2,
          Math.floor(target.z / unit) * unit,
        );
      }
    },
    dispose() {
      mesh?.geometry.dispose();
      frame?.geometry.dispose();
      gridMaterial.dispose();
      frameMaterial.dispose();
      hoverFill?.geometry.dispose();
      hoverEdge?.geometry.dispose();
      hoverMaterial.dispose();
      hoverEdgeMaterial.dispose();
      group.removeFromParent();
      hoverGroup.removeFromParent();
    },
  };
}
