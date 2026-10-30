import { fieldFlashState } from './fieldFlash';

export const LIGHTNING_MAX_COUNT = 5;
export function lightningCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(5, Math.round(value))) : 3;
}
/** 休む割合（GS-279）。0〜0.9、既定 0（毎回光る）。0.9 までにして、いつかは光るようにする。 */
export const LIGHTNING_GAP_MAX = 0.9;
export function lightningGap(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(LIGHTNING_GAP_MAX, value)) : 0;
}
export function lightningWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.2, Math.min(20, value)) : 3;
}
const random = (seed: number) => { const n = Math.sin(seed * 127.1 + 17.3) * 43758.5453; return n - Math.floor(n); };

/** 雷が 1 回光る周期（秒。速さ 1 のとき）。 */
export const LIGHTNING_PERIOD = 3.2;
/**
 * 今が何回目の光か（環境音の「光るたびに鳴らす」が見る。SampleGame GS-278）。
 * 1 本目（slot 0）は周期の頭で光るので、この数が増えた時が光った時。速さ 0（止めた絵）は光らないので undefined。
 */
export function lightningCycle(seconds: number, speed: number): number | undefined {
  if (!(speed > 0)) return undefined;
  return Math.floor((Math.max(0, seconds) * speed) / LIGHTNING_PERIOD);
}

/**
 * その回（`lightningCycle`）に光るか（GS-279。光る間隔のばらつき）。区切りは 3.2 秒のまま、回ごとにくじで休む。
 * くじの種は**プリセットの id から**（`lightningGapSeed`）——同じプリセットを何か所に置いても同じ回に光り、
 * 環境音の「光るたびに」と合う。マップエディタとゲームで同じ光り方になる。
 */
export function lightningLit(cycle: number, gap: number, gapSeed: number): boolean {
  const rest = lightningGap(gap);
  if (rest <= 0) return true;
  return random(gapSeed * 0.731 + cycle * 57.3 + 11) >= rest;
}
/** 休むくじの種（プリセットの id だけで決める）。 */
export function lightningGapSeed(id: string): number {
  return lightningSeed(id, 0, 0, 0);
}

/** 範囲ごとの安定した種。再構築・再放電では同じ位置へ戻る。 */
export function lightningSeed(id: string, x: number, y: number, z: number): number {
  let hash = 2166136261;
  for (const char of `${id}|${x}|${y}|${z}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100000;
}

/** 各区画の中央付近へ散らし、隣接区画の間に余白を残す。壁は横だけ、床はXZ。 */
export function lightningStrike(seconds: number, speed: number, count: number, slot: number, seed: number, wall: boolean, gap = 0, gapSeed = 0) {
  count = lightningCount(count);
  const clock = Math.max(0, seconds) * Math.max(0, speed);
  const cycle = Math.floor(clock / LIGHTNING_PERIOD);
  const local = clock - cycle * LIGHTNING_PERIOD;
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
  // 休む回（GS-279）は光らない。止めた絵（速さ 0）は休まず全本を見せる。
  const pulse = slot >= count ? 0 : speed === 0 ? 1 : age < 0 || !lightningLit(cycle, gap, gapSeed) ? 0 : fieldFlashState(age, 1).pulse;
  return { x, z, cycle, delay, pulse, shape: cycle + slot * 17 + seed };
}
