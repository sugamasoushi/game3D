// 相手を選ぶ窓の一言（2026-10-31 / GS-292）。狙っている相手に、この攻撃が何倍で入るかとその理由を短く出す。
// 純粋な計算だけ（倍率の決まりは `height.ts` の `heightFactors` と `cover.ts` の `hitsOf` をそのまま使う——ダメージの式と食い違わない）。
// 旧作の「獲物はあいつだ！！」から置き換えた。

import { hitsOf } from './cover';
import { heightFactors, type HeightRates, type RateFactor } from './height';
import type { Fighter, SkillDef, SkillReach } from './rules';

/** 倍率を短い字に（×1.2・×0.5・×0.25。小数は 2 桁まで、後ろの 0 は落とす）。 */
export function rateText(rate: number): string {
  return `×${Number(rate.toFixed(2))}`;
}

export interface AimInfo {
  /** 選んだ相手に入る倍率（理由を全部掛けた物）。 */
  rate: number;
  /** 掛かる理由（無ければ空）。 */
  factors: RateFactor[];
  /** 貫通で一緒に当たる後ろの人の倍率（後衛の倍率と高さを掛けた物。重なりは除く）。いなければ空。 */
  behind: number[];
  /** 窓に出す一文（「ダメージ ×0.6（高台から ×1.2・飛ぶ相手に直接 ×0.5）」など）。 */
  text: string;
}

/**
 * 狙っている相手への入り方。`side` は相手の陣営（貫通の後ろを数える）、`backRate` は後衛の倍率。
 * 全体の技は相手を選ばないので使わない。
 */
export function aimInfo(
  attacker: Fighter,
  target: Fighter,
  side: Fighter[],
  skill: (Pick<SkillDef, 'kind' | 'range'> & { reach?: SkillReach }) | null,
  rates: HeightRates,
  backRate: number,
): AimInfo {
  const factors = heightFactors(attacker, target, skill, rates);
  const rate = factors.reduce((sum, one) => sum * one.rate, 1);
  const reach = skill?.reach ?? 'single';
  const behind = reach === 'pierce'
    ? [...new Set(hitsOf(target, side, 'pierce', backRate).slice(1)
      .map((hit) => Number((hit.rate * heightFactors(attacker, hit.who, skill, rates).reduce((sum, one) => sum * one.rate, 1)).toFixed(2))))]
    : [];
  const reasons = factors.map((one) => `${one.label} ${rateText(one.rate)}`).join('・');
  const main = `ダメージ ${rateText(rate)}${reasons ? `（${reasons}）` : ''}`;
  const tail = behind.length ? `／後ろにも ${behind.map(rateText).join('・')}` : '';
  return { rate, factors, behind, text: main + tail };
}
