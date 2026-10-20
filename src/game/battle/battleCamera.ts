// 戦闘用のカメラ（GS-104 / GS-105）。**イベント用のカメラ演出（`cameraCues.ts`・`cameraCues.json`）とは仕組みごと分ける**——
// 形・補間・再生を戦闘側だけで持ち、カメラエディタの台帳や再生器を作り変えても戦闘は影響を受けない。
//
// **構図は BattleStage から直接カメラを決める**（2026-10-19 / BPE-30 で作り直した）。土台のカメラに重ねる 2 段の作りはやめた。
// - 見る点 = BattleStage の床 ＋ `x`（右）・`y`（上）・`z`（手前。負で奥＝敵の方）
// - カメラ = 見る点から手前へ水平に `distance`、BattleStage の床から高さ `height` の所。見下ろす角度はそこから決まる
// - 向き `yaw` = フィールドのカメラの向きに足す（度）
// 長さの単位はどれもマス。**拡縮はマップの `CharacterScale` に準ずる**（全部の構図・マスで共通。2026-10-19）。

/** カメラのキー 1 つ。`at`（ミリ秒）までに値へ移る。書かない値は直前の値のまま。 */
export interface BattleCameraKey {
  at: number;
  /** 横の回転（度）。フィールドのカメラの向きに足す。 */
  yaw?: number;
  /** 見る点（マス）。BattleStage の床から右・上・手前（負で奥）。 */
  x?: number;
  y?: number;
  z?: number;
  /** カメラの位置（マス）。見る点から手前へ水平の距離と、BattleStage の床からの高さ。 */
  distance?: number;
  height?: number;
  /** カメラを傾けて見せるか（チルトシフト）。 */
  tilt?: boolean;
}

export interface BattleCamera {
  /** 長さ（ミリ秒）。戦闘の進行はこの時間だけ待つ。 */
  duration: number;
  /** 終わった後も最後の構図を保つ（偽なら前の構図へ戻る）。 */
  hold: boolean;
  keys: BattleCameraKey[];
}

/** そのフレームのカメラ（BattleStage からの値。マス）。 */
export interface BattleCameraView {
  yaw: number;
  x: number;
  y: number;
  z: number;
  distance: number;
  height: number;
  tilt?: boolean;
}

/** どのキーにも書いていない値。見る点は胸の高さ、カメラは手前 9 マス・高さ 4 マス。 */
export const DEFAULT_BATTLE_VIEW: BattleCameraView = { yaw: 0, x: 0, y: 1.2, z: 0, distance: 9, height: 4 };

const NUMBER_KEYS = ['yaw', 'x', 'y', 'z', 'distance', 'height'] as const;

/**
 * 構図の始まりの値（時刻 0 のキーに書いた値。書いていなければ既定 `DEFAULT_BATTLE_VIEW`）。前の構図が無いときはここから始め、
 * 後のキーへ向かって動く。
 */
export function battleCameraStartView(camera: BattleCamera | null): BattleCameraView {
  const view: BattleCameraView = { ...DEFAULT_BATTLE_VIEW };
  for (const key of camera?.keys ?? []) {
    if (key.at > 0) break;
    for (const name of NUMBER_KEYS) if (key[name] !== undefined) view[name] = key[name];
    if (key.tilt !== undefined) view.tilt = key.tilt;
  }
  return view;
}

/** 時刻 `time` の値。始まりの値は `from`（前の構図の最後。無ければこの構図の始まり）。 */
export function sampleBattleCamera(camera: BattleCamera, time: number, from: BattleCameraView | null): BattleCameraView {
  const t = Math.max(0, Math.min(time, camera.duration));
  const view: BattleCameraView = from ? { ...from } : battleCameraStartView(camera);
  for (const name of NUMBER_KEYS) {
    let value = view[name];
    let at = 0;
    for (const key of camera.keys) {
      const next = key[name];
      if (next === undefined) continue;
      if (key.at > t) {
        const ratio = key.at > at ? (t - at) / (key.at - at) : 1;
        value += (next - value) * Math.max(0, Math.min(1, ratio));
        break;
      }
      value = next;
      at = key.at;
    }
    view[name] = value;
  }
  for (const key of camera.keys) if (key.at <= t && key.tilt !== undefined) view.tilt = key.tilt;
  return view;
}

/**
 * カメラの置き方（ワールド）。見る点と、そこからの距離・見下ろす角度（度。負で見下ろす）。
 * `floorY` は BattleStage の床の高さ（ワールド）、`k` は長さに掛ける倍率（マスの大きさ × CharacterScale）。
 */
export function battleCameraPose(view: BattleCameraView, k: number): { up: number; pitch: number; distance: number } {
  const across = Math.max(0.01, view.distance * k);
  const rise = (view.height - view.y) * k;
  return { up: view.y * k, pitch: (-Math.atan2(rise, across) * 180) / Math.PI, distance: Math.hypot(across, rise) };
}

/** 戦闘のカメラを流す。舞台を片づけるときは `stop`。 */
export function createBattleCameraPlayer() {
  let current: BattleCamera | null = null;
  let time = 0;
  let from: BattleCameraView | null = null;
  let last: BattleCameraView | null = null;
  return {
    play(camera: BattleCamera) {
      from = last ? { ...last } : null;
      current = camera;
      time = 0;
    },
    stop() {
      current = null;
      from = null;
      last = null;
      time = 0;
    },
    update(dt: number): BattleCameraView | null {
      if (!current) return last;
      time += Math.max(0, dt) * 1000;
      if (time > current.duration && !current.hold) {
        current = null;
        last = from;
        return last;
      }
      last = sampleBattleCamera(current, time, from);
      return last;
    },
  };
}
