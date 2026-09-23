// カメラ演出台帳。場面の種類を知らず、時刻からカメラの値を求める。
// **イベント用**（GS-115）。戦闘の舞台の板を動かす・注視する機能（フィールドオブジェクトトラック・注視対象・選択中の味方）は削除した——
// 戦闘のカメラは `battle/battleCamera.ts` が別に持つ（GS-105）。
import { assetUrl } from './assets';
import { createCameraShots, type CameraShot, type CameraShotFrame, type CameraShotKind } from '../view/cameraShots';

export interface CueFrame {
  at: number;
  yaw?: number;
  pitch?: number;
  distance?: number;
  x?: number;
  y?: number;
  z?: number;
  tilt?: boolean;
}
export type IllustrationMotion = 'none' | 'fade' | 'left' | 'right' | 'top' | 'bottom';
export interface CameraIllustrationEffect {
  at: number;
  kind: 'illustration';
  ms: number;
  asset: string;
  /** 最終位置。画面の左上を0%、右下を100%とし、画像の下中央を置く。 */
  x: number;
  y: number;
  /** 画面高に対する画像高の割合。 */
  height: number;
  opacity: number;
  enter: IllustrationMotion;
  enterMs: number;
  exit: IllustrationMotion;
  exitMs: number;
  easing: 'linear' | 'easeOut' | 'easeInOut';
}
export interface CameraIllustrationSample {
  key: string;
  asset: string;
  x: number;
  y: number;
  height: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
}
export interface CameraCue {
  name: string;
  duration: number;
  hold?: boolean;
  frames: CueFrame[];
  effects: Array<(Omit<CameraShot, 'kind'> & { at: number; kind: CameraShotKind }) | CameraIllustrationEffect>;
}
export interface CameraCueBook { version: 1; cues: Record<string, CameraCue> }
/** 場面カメラへ重ねる値。連続する演出の間で、直前の見た目を受け渡す。 */
export interface CameraCueState {
  yaw: number;
  pitch: number;
  distance: number;
  x: number;
  y: number;
  z: number;
  tilt?: boolean;
}
export interface CameraCueSample extends CameraCueState {
  shot: CameraShotFrame;
  illustrations: CameraIllustrationSample[];
}
let book: CameraCueBook = { version: 1, cues: {} };
let pending: Promise<void> | undefined;
export function loadCameraCues(): Promise<void> {
  return pending ??= fetch(assetUrl('data/cameraCues.json')).then(async (res) => {
    if (!res.ok) throw new Error('カメラ演出台帳を読めません');
    book = await res.json() as CameraCueBook;
  }).catch((error) => { pending = undefined; throw error; });
}
export function cameraCue(id: string): CameraCue {
  const cue = book.cues[id];
  if (!cue) throw new Error(`カメラ演出がありません: ${id}`);
  return cue;
}
/** 未保存の台帳は開発用プレビューからだけ渡す。 */
export function previewCameraCues(next: CameraCueBook): void { book = structuredClone(next); }

export function sampleCue(cue: CameraCue, time: number, basePitch: number, inherited?: CameraCueState): CameraCueSample {
  const t = Math.max(0, Math.min(time, cue.duration));
  const frames = cue.frames;
  const defaults = {
    yaw: inherited?.yaw ?? 0,
    pitch: inherited?.pitch ?? basePitch,
    distance: inherited?.distance ?? 1,
    x: inherited?.x ?? 0,
    y: inherited?.y ?? 0,
    z: inherited?.z ?? 0,
  };
  const numbers = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
    let previous = defaults[key];
    let at = 0;
    for (const frame of frames) {
      const value = frame[key];
      if (value === undefined) continue;
      if (frame.at > t) {
        const ratio = frame.at > at ? (t - at) / (frame.at - at) : 1;
        previous += (value - previous) * Math.max(0, Math.min(1, ratio));
        break;
      }
      previous = value;
      at = frame.at;
    }
    numbers[key] = previous;
  }
  let tilt: boolean | undefined = inherited?.tilt;
  for (const frame of frames) if (frame.at <= t && frame.tilt !== undefined) tilt = frame.tilt;
  const shots = createCameraShots();
  let last = 0;
  for (const effect of cue.effects) {
    if (effect.kind === 'illustration') continue;
    if (effect.at > t) break;
    shots.update((effect.at - last) / 1000);
    shots.play(effect);
    last = effect.at;
  }
  const shot = shots.update((t - last) / 1000);
  const illustrations = cue.effects.flatMap((effect, index): CameraIllustrationSample[] => {
    if (effect.kind !== 'illustration' || t < effect.at || t >= effect.at + effect.ms) return [];
    const local = t - effect.at;
    const enterProgress = effect.enterMs > 0 ? Math.min(1, local / effect.enterMs) : 1;
    const exitProgress = effect.exitMs > 0 ? Math.max(0, Math.min(1, (local - (effect.ms - effect.exitMs)) / effect.exitMs)) : 0;
    const ease = (value: number) => effect.easing === 'linear' ? value
      : effect.easing === 'easeInOut' ? value * value * (3 - 2 * value)
        : 1 - Math.pow(1 - value, 3);
    const into = ease(enterProgress);
    const out = ease(exitProgress);
    const motion = (kind: IllustrationMotion, amount: number) => ({
      x: kind === 'left' ? -120 * amount : kind === 'right' ? 120 * amount : 0,
      y: kind === 'top' ? -120 * amount : kind === 'bottom' ? 120 * amount : 0,
    });
    const start = motion(effect.enter, 1 - into);
    const end = motion(effect.exit, out);
    const opacity = effect.opacity
      * (effect.enter === 'fade' ? into : 1)
      * (effect.exit === 'fade' ? 1 - out : 1);
    return [{ key: `${index}:${effect.asset}`, asset: effect.asset, x: effect.x, y: effect.y, height: effect.height,
      opacity, offsetX: start.x + end.x, offsetY: start.y + end.y }];
  });
  return { ...numbers, tilt, shot, illustrations };
}

export function createCuePlayer() {
  let current: CameraCue | null = null;
  let time = 0;
  let paused = false;
  let before: CameraCueState | null = null;
  let last: CameraCueState | null = null;
  const stateOf = (sample: CameraCueSample): CameraCueState => {
    const state: CameraCueState = {
      yaw: sample.yaw, pitch: sample.pitch, distance: sample.distance,
      x: sample.x, y: sample.y, z: sample.z,
    };
    if (sample.tilt !== undefined) state.tilt = sample.tilt;
    return state;
  };
  const restoredSample = (state: CameraCueState): CameraCueSample => ({
    ...state,
    shot: createCameraShots().frame(),
    illustrations: [],
  });
  return {
    play(cue: CameraCue) {
      before = last ? { ...last } : null;
      current = structuredClone(cue);
      time = 0;
      paused = false;
    },
    stop() {
      current = null; before = null; last = null;
      time = 0; paused = false;
    },
    pause(value: boolean) { paused = value; },
    seek(ms: number) { time = Math.max(0, Math.min(ms, current?.duration ?? 0)); paused = true; },
    update(dt: number, pitch: number) {
      if (!current) return last ? restoredSample(last) : null;
      if (!paused) time += Math.max(0, dt) * 1000;
      if (time > current.duration && !current.hold && !paused) {
        current = null;
        last = before;
        return last ? restoredSample(last) : null;
      }
      const sample = sampleCue(current, time, pitch, before ?? undefined);
      last = stateOf(sample);
      return sample;
    },
    state: () => last ? { ...last } : null,
  };
}
