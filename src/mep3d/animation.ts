import type { AnimationDef } from './types';

/**
 * タイルアニメのタイミングと再生。pingpong は列に展開し、実行時はリストを歩くだけ。
 */

export type PlayMode = 'loop' | 'once' | 'pingpong';

const DEFAULT_MS = 125;
const MIN_MS = 10;
const MAX_MS = 10000;

interface AnimationStep {
  tile: number;
  ms: number;
  /** `frames` の何番目か。pingpong は同じフレームを 2 回出す。 */
  frame: number;
}

export interface PlaySequence {
  steps: AnimationStep[];
  totalMs: number;
  mode: PlayMode;
}

function clampMs(ms: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(ms)));
}

export function playMode(anim: AnimationDef): PlayMode {
  if (anim.mode === 'loop' || anim.mode === 'once' || anim.mode === 'pingpong') {
    return anim.mode;
  }
  return anim.loop === false ? 'once' : 'loop';
}

/** 各フレームの長さ。無いときは fps。短いリストは末尾で埋める。 */
export function durationsOf(anim: AnimationDef): number[] {
  const fallback = clampMs(anim.fps > 0 ? 1000 / anim.fps : DEFAULT_MS);
  const raw = anim.durations ?? [];
  return anim.frames.map((_, i) => {
    if (i < raw.length) return clampMs(raw[i]);
    if (raw.length > 0) return clampMs(raw[raw.length - 1]);
    return fallback;
  });
}

/** 実際に再生する列。pingpong は既に展開済み。 */
export function playSequence(anim: AnimationDef): PlaySequence {
  const durations = durationsOf(anim);
  const steps: AnimationStep[] = anim.frames.map((tile, i) => ({
    tile,
    ms: durations[i],
    frame: i,
  }));
  const mode = playMode(anim);

  if (mode === 'pingpong' && steps.length > 2) {
    for (let i = steps.length - 2; i > 0; i -= 1) steps.push({ ...steps[i] });
  }

  const totalMs = Math.max(
    MIN_MS,
    steps.reduce((sum, step) => sum + step.ms, 0),
  );
  return { steps, totalMs, mode };
}

/** 経過秒後に出しているステップ。 */
export function frameAt(sequence: PlaySequence, elapsedSeconds: number): number {
  if (sequence.steps.length === 0) return 0;

  let ms = Math.floor(elapsedSeconds * 1000);
  if (sequence.mode === 'once') {
    ms = Math.min(ms, sequence.totalMs - 1);
  } else {
    ms = ((ms % sequence.totalMs) + sequence.totalMs) % sequence.totalMs;
  }

  let running = 0;
  for (let i = 0; i < sequence.steps.length; i += 1) {
    running += sequence.steps[i].ms;
    if (ms < running) return i;
  }
  return sequence.steps.length - 1;
}
