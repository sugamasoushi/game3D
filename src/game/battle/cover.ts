// 前衛・後衛と技の届き方（2026-10-29 / GS-280）。純粋な計算だけ（画面も乱数も持たない）。
//
// - **前＝相手側に近い＝`|row|` が小さい**。同じ陣営で生きている A が、横の差 1 以内でより前にいれば、B は「前に守られている」。
// - 単体の技・通常攻撃では、前に守られている人は狙えない（前が倒れればその時点で狙える。後ろの人は詰めない）。
// - 貫通は選んだ人とその後ろ、全体は全員（いつも貫通の扱い）。前に守られた後衛には倍率（`rates.back`）を掛ける。
// - マスの無い人（`cell` が無い）はこの決まりの外——守らず、守られない。
// かばう（特技）・高さ・飛ぶ敵はまだ無い（SampleGame note 4.19 の計画）。足すときはここに。

import { alive, type Fighter, type SkillReach } from './rules';

/** 守る幅（横のマスの差）。 */
const GUARD_WIDTH = 1;

/** `front` が `back` の前にいて守るか（同じ陣営・生きている・横の差 1 以内・より前）。 */
export function shields(front: Fighter, back: Fighter): boolean {
  if (front === back || front.side !== back.side || !alive(front)) return false;
  if (!front.cell || !back.cell) return false;
  return Math.abs(front.cell.col - back.cell.col) <= GUARD_WIDTH && Math.abs(front.cell.row) < Math.abs(back.cell.row);
}

/** 前に守られているか（同じ陣営の誰かが前で守っている）。 */
export function shielded(who: Fighter, side: Fighter[]): boolean {
  return side.some((one) => shields(one, who));
}

/** 技の届き方。書いていなければ単体。 */
export function reachOf(skill: { reach?: SkillReach } | null | undefined): SkillReach {
  return skill?.reach ?? 'single';
}

/** 狙って選べる相手（生きていて、前に守られていない人）。全体は選ばないので空。 */
export function targetables(side: Fighter[], reach: SkillReach): Fighter[] {
  if (reach === 'all') return [];
  return side.filter((who) => alive(who) && !shielded(who, side));
}

/** 1 人ぶんの当たり。`rate` はダメージに掛ける倍率。 */
export interface Hit {
  who: Fighter;
  rate: number;
}

/**
 * 当たる相手と倍率。`chosen` は選んだ相手（全体では使わない）。`backRate` は前に守られた後衛の倍率。
 * 並びは前の人から（同じ近さなら陣営の並び順）——見せる順・言う順に使う。
 */
export function hitsOf(chosen: Fighter | null, side: Fighter[], reach: SkillReach, backRate: number): Hit[] {
  const living = side.filter(alive);
  const rateOf = (who: Fighter) => (shielded(who, side) ? backRate : 1);
  const frontFirst = (list: Fighter[]) => list
    .map((who, index) => ({ who, index }))
    .sort((a, b) => Math.abs(a.who.cell?.row ?? 0) - Math.abs(b.who.cell?.row ?? 0) || a.index - b.index)
    .map((one) => one.who);
  if (reach === 'all') return frontFirst(living).map((who) => ({ who, rate: rateOf(who) }));
  if (!chosen || !alive(chosen)) return [];
  if (reach === 'single') return [{ who: chosen, rate: 1 }];
  // 貫通: 選んだ人と、その人が守っている人（後ろ・横の差 1 以内）。
  const behind = living.filter((who) => shields(chosen, who));
  return [{ who: chosen, rate: 1 }, ...frontFirst(behind).map((who) => ({ who, rate: rateOf(who) }))];
}

/** 倍率を掛けたダメージ。**必ず 1 は通す**（`damageOf` と同じ決まり）。0 は 0 のまま（避けた）。 */
export function scaledDamage(amount: number, rate: number): number {
  if (amount <= 0) return amount;
  return Math.max(1, Math.round(amount * rate));
}
