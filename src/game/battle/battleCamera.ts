// 戦闘用のカメラ（GS-104 / GS-105）。**イベント用のカメラ演出（`cameraCues.ts`・`cameraCues.json`）とは仕組みごと分ける**——
// 形・補間・再生を戦闘側だけで持ち、カメラエディタの台帳や再生器を作り変えても戦闘は影響を受けない。
// 戦闘の舞台のカメラ（`applyStage`）へ、描画する間だけ重ねる。

/** カメラのキー 1 つ。`at`（ミリ秒）までに値へ移る。書かない値は直前の値のまま。 */
export interface BattleCameraKey {
  at: number;
  /** 横の回転（度）。舞台の向きに足す。 */
  yaw?: number;
  /** 見下ろす角度（度）。舞台の角度を置き換える。 */
  pitch?: number;
  /** 距離の倍率（1 で舞台のまま）。 */
  distance?: number;
  /** 注視点を舞台の位置からずらす量（マス）。`z` が負で敵の方へ進む、`y` が負で下がる。 */
  x?: number;
  y?: number;
  z?: number;
  /** カメラを傾けて見せるか（チルトシフト）。 */
  tilt?: boolean;
}

export interface BattleCamera {
  /** 長さ（ミリ秒）。戦闘の進行はこの時間だけ待つ。 */
  duration: number;
  /** 終わった後も最後の構図を保つ（偽なら舞台のカメラへ戻る）。 */
  hold: boolean;
  keys: BattleCameraKey[];
}

/** そのフレームに舞台のカメラへ重ねる値。 */
export interface BattleCameraView {
  yaw: number;
  pitch: number;
  distance: number;
  x: number;
  y: number;
  z: number;
  tilt?: boolean;
}

/**
 * 戦闘開始のカメラ（元はカメラエディタの「戦闘開始！」`cue_1`）。**見た目はこの値で調整する。**
 * 500ms かけて敵の方へ進んで下がり、見上げ気味にする。`hold` なので戦闘のあいだこの構図のまま。
 */
export const BATTLE_START_CAMERA: BattleCamera = {
  duration: 1000,
  hold: true,
  keys: [
    { at: 500, pitch: -10, yaw: 0, distance: 1, x: 0, y: -1, z: -6, tilt: false },
  ],
};

const NUMBER_KEYS = ['yaw', 'pitch', 'distance', 'x', 'y', 'z'] as const;

/** 時刻 `time` の値。始まりの値は `from`（前のカメラの最後。無ければ舞台のまま）。 */
export function sampleBattleCamera(camera: BattleCamera, time: number, basePitch: number, from: BattleCameraView | null): BattleCameraView {
  const t = Math.max(0, Math.min(time, camera.duration));
  const view: BattleCameraView = from
    ? { ...from }
    : { yaw: 0, pitch: basePitch, distance: 1, x: 0, y: 0, z: 0 };
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
    update(dt: number, basePitch: number): BattleCameraView | null {
      if (!current) return last;
      time += Math.max(0, dt) * 1000;
      if (time > current.duration && !current.hold) {
        current = null;
        last = from;
        return last;
      }
      last = sampleBattleCamera(current, time, basePitch, from);
      return last;
    },
  };
}
