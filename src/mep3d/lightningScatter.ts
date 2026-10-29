import { fieldFlashState } from './fieldFlash';

export const LIGHTNING_MAX_COUNT = 5;
export function lightningCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(5, Math.round(value))) : 3;
}
export function lightningWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.2, Math.min(20, value)) : 3;
}
const random = (seed: number) => { const n = Math.sin(seed * 127.1 + 17.3) * 43758.5453; return n - Math.floor(n); };

/** 範囲ごとの安定した種。再構築・再放電では同じ位置へ戻る。 */
export function lightningSeed(id: string, x: number, y: number, z: number): number {
  let hash = 2166136261;
  for (const char of `${id}|${x}|${y}|${z}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100000;
}

/** 各区画の中央付近へ散らし、隣接区画の間に余白を残す。壁は横だけ、床はXZ。 */
export function lightningStrike(seconds: number, speed: number, count: number, slot: number, seed: number, wall: boolean) {
  count = lightningCount(count);
  const clock = Math.max(0, seconds) * Math.max(0, speed);
  const cycle = Math.floor(clock / 3.2);
  const local = clock - cycle * 3.2;
  const key = seed + cycle * 113.7;
  // 並ぶ順序も周期ごとにずらし、時間順が固定の横流れにならないようにする。
  const cell = (slot + Math.floor(random(key) * count)) % count;
  const columns = wall ? count : Math.ceil(Math.sqrt(count));
  const rows = wall ? 1 : Math.ceil(count / columns);
  const x = (cell % columns + 0.25 + random(key + slot * 13 + 2) * 0.5) / columns;
  const z = wall ? 0.5 : (Math.floor(cell / columns) + 0.25 + random(key + slot * 19 + 3) * 0.5) / rows;
  const delay = slot === 0 ? 0 : slot * 0.13 + random(key + slot * 7 + 5) * 0.09;
  const age = local - delay;
  // 静止時には全本の形を見せる。稼働中はそれぞれの遅延後に同じ発光曲線を使う。
  const pulse = slot >= count ? 0 : speed === 0 ? 1 : age < 0 ? 0 : fieldFlashState(age, 1).pulse;
  return { x, z, cycle, delay, pulse, shape: cycle + slot * 17 + seed };
}
