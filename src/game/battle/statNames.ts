// 能力値の呼び名（2026-11-07）。**メニュー・図鑑・装備で同じ言葉を使う**ための 1 か所。
//
// 攻撃・守りは「物理攻撃力」「物理防御力」に呼び替え、魔法攻撃力・魔法防御力を足した（計算は `rules.ts` の `damageOf`）。

import { magicGuardOf, magicOf, type Stats } from './rules';

/** 装備やレベルで変わる数（HP・MP 以外）。並びはメニューに出す順。 */
export const POWER_KEYS = ['attack', 'guard', 'magic', 'magicGuard', 'speed'] as const;
export type PowerKey = (typeof POWER_KEYS)[number];

/** 呼び名。 */
export const STAT_NAMES: Record<PowerKey, string> = {
  attack: '物理攻撃力',
  guard: '物理防御力',
  magic: '魔法攻撃力',
  magicGuard: '魔法防御力',
  speed: '素早さ',
};

/** 台帳の数値から 1 つ読む（魔法の 2 つは書いていなければ物理と同じ）。 */
export function powerOf(stats: Pick<Stats, 'attack' | 'guard' | 'magic' | 'magicGuard' | 'speed'>, key: PowerKey): number {
  if (key === 'magic') return magicOf(stats);
  if (key === 'magicGuard') return magicGuardOf(stats);
  return stats[key];
}

/** 装備込みの値。素早さは 1 より下げない（`party.ts` の `statsOf` と同じ）。 */
export function powerWithGear(stats: Parameters<typeof powerOf>[0], gear: Record<PowerKey, number>, key: PowerKey): number {
  const sum = powerOf(stats, key) + gear[key];
  return key === 'speed' ? Math.max(1, sum) : sum;
}
