// カメラ。向き（水平角・仰角）と寄りはマップのプロパティが決め、ゲーム側からは動かせない（DEC-260）。
// 投影（正射／透視）だけ見比べ用に切り替えられる。
// 置き方と正射の半径はエディタ（EditorView.placeCamera / resize）と同じ式。ずらすと A-10 が崩れる。

import { OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three';
import { ORTHO_SCALE, PERSP_FOV, visibleHalfCells } from '../mep3d/mapCamera';

/** エディタの「HD-2D 20°」と同じ向き。ここが既定（DEC-147 / DEC-228）。 */
export const HD2D_YAW = 0;
export const HD2D_PITCH = -20;

/** 仰角の範囲。真上・真横まで振ると、ビルボードと影の見え方が破綻する。 */
export const PITCH_MIN = -89;
export const PITCH_MAX = -5;

const DISTANCE_MIN = 2;
const DISTANCE_MAX = 200;
export interface CameraRig {
  /** 方位（度）。移動方向の計算にも使う。 */
  yaw: number;
  /** 仰角（度）。0 が水平、−90 が真上から。 */
  pitch: number;
  distance: number;
  orthographic: boolean;
  readonly target: Vector3;
  active(): Camera;
  /** 位置と投影を計算し直す。target・distance を変えたら呼ぶ。 */
  apply(): void;
  resize(width: number, height: number, pixelRatio: number): void;
  /**
   * target をキャラへ合わせる。**遅らせない**（DEC-268）。
   * 止め位置があればそこで丸め、そのあと画素の格子へ寄せる。
   */
  follow(to: Vector3): void;
  /**
   * スクロールの止め位置（DEC-148）。ワールドの矩形。`null` で解除。
   * 画面に入る半径を引いた範囲へ target を丸めるので、枠の外は映らない。
   */
  setBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null): void;
  /** 床の上で画面に入る半径（ワールド）。奥行きは仰角で伸びる。 */
  visibleHalf(): { x: number; z: number };
}

export function createCameraRig(): CameraRig {
  const persp = new PerspectiveCamera(PERSP_FOV, 1, 0.1, 2000);
  const ortho = new OrthographicCamera(-1, 1, 1, -1, -500, 500);
  const target = new Vector3();
  let aspect = 1;
  /** 画面の高さ（画素）。画素そろえに使う。 */
  let viewH = 1;

  /** target からカメラへ向かう単位ベクトル。向きを変えたら組み直す。 */
  const away = new Vector3();
  /** スクロールの止め位置（DEC-148）。プレイ中の追従だけに効かせる。 */
  let bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  /** 画面の 1 画素ぶんのワールド幅（注視点の面で）。ここで丸めると画がぶれない。 */
  const pixelStep = (): number => {
    const half = rig.orthographic
      ? rig.distance * ORTHO_SCALE
      : rig.distance * Math.tan((PERSP_FOV * Math.PI) / 360);
    return (2 * half) / viewH;
  };

  /** 枠の外が映らないところまで target を戻す。枠より画面が広い軸は中央で固定。 */
  const clampTarget = () => {
    if (!bounds) return;
    const seen = rig.visibleHalf();
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midZ = (bounds.minZ + bounds.maxZ) / 2;
    const roomX = (bounds.maxX - bounds.minX) / 2 - seen.x;
    const roomZ = (bounds.maxZ - bounds.minZ) / 2 - seen.z;
    target.x = roomX <= 0 ? midX : Math.min(Math.max(target.x, midX - roomX), midX + roomX);
    target.z = roomZ <= 0 ? midZ : Math.min(Math.max(target.z, midZ - roomZ), midZ + roomZ);
  };

  /**
   * 注視点を**画面の画素の格子**へ寄せる（DEC-265）。
   * ドット絵は最近傍で拡大しているので、カメラが半端に動くと絵の 1 画素が
   * 画面の 2 画素と 3 画素を行き来して、画面じゅうがちらつく。追従の値を
   * 画素単位に丸めれば、画は画素ごと平行移動するだけになって止まる。
   * 奥行き（`away` 方向）は丸めない——寄りが変わって見える。
   */
  const snapRight = new Vector3();
  const snapUp = new Vector3();
  const snapAway = new Vector3();
  const WORLD_UP = new Vector3(0, 1, 0);
  const snapToPixels = () => {
    const step = pixelStep();
    if (!(step > 0)) return;
    const yawR = (rig.yaw * Math.PI) / 180;
    const pitchR = (rig.pitch * Math.PI) / 180;
    const cp = Math.cos(pitchR);
    snapAway.set(Math.sin(yawR) * cp, -Math.sin(pitchR), Math.cos(yawR) * cp).normalize();
    snapRight.crossVectors(WORLD_UP, snapAway).normalize();
    snapUp.crossVectors(snapAway, snapRight).normalize();
    const r = Math.round(target.dot(snapRight) / step) * step;
    const u = Math.round(target.dot(snapUp) / step) * step;
    const f = target.dot(snapAway);
    target
      .set(0, 0, 0)
      .addScaledVector(snapRight, r)
      .addScaledVector(snapUp, u)
      .addScaledVector(snapAway, f);
  };

  const rig: CameraRig = {
    yaw: HD2D_YAW,
    pitch: HD2D_PITCH,
    distance: 20,
    // ゲームは透視投影が既定（GC-51）。O で正射へ切り替えられる。
    orthographic: false,
    target,
    active: () => (rig.orthographic ? ortho : persp),
    apply() {
      rig.distance = Math.min(DISTANCE_MAX, Math.max(DISTANCE_MIN, rig.distance));
      rig.yaw = ((rig.yaw % 360) + 360) % 360;
      rig.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, rig.pitch));
      const yawR = (rig.yaw * Math.PI) / 180;
      const pitchR = (rig.pitch * Math.PI) / 180;
      const cp = Math.cos(pitchR);
      away.set(Math.sin(yawR) * cp, -Math.sin(pitchR), Math.cos(yawR) * cp).normalize();

      const half = rig.distance * ORTHO_SCALE;
      ortho.left = -half * aspect;
      ortho.right = half * aspect;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.updateProjectionMatrix();

      persp.position.copy(target).addScaledVector(away, rig.distance);
      persp.lookAt(target);
      ortho.position.copy(persp.position);
      ortho.quaternion.copy(persp.quaternion);
      ortho.updateMatrixWorld();
    },
    resize(width, height) {
      aspect = width / Math.max(height, 1);
      viewH = Math.max(height, 1);
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      rig.apply();
    },
    setBounds(next) {
      bounds = next;
    },
    visibleHalf() {
      // 式はエディタと共通（`mep3d/mapCamera.ts`）。ずらすと止め位置の表示と食い違う。
      return visibleHalfCells({
        distance: rig.distance,
        aspect,
        pitch: rig.pitch,
        perspective: !rig.orthographic,
      });
    },
    follow(to) {
      // **その場で合わせる**（DEC-268）。以前は指数の減衰で寄せていたが（GC-19）、
      // キャラが止まってもカメラだけしばらく動き続け、遅れて追ってくるのが目に付いた。
      target.copy(to);
      clampTarget();
      snapToPixels();
      rig.apply();
    },
  };

  rig.apply();
  return rig;
}
