// 戦闘のマスの高さ（2026-10-29 / GS-285）。純粋な計算だけ（地形を見るのは GameView、ここは決まりだけ）。
//
// - マスは地形から拾った高さで 3 つに分ける: **床** / **高台**（舞台の点の床より `highStep` 以上高い）/ **空**（床が無い）。
// - **高台から、高台でない相手を攻めると 1.2 倍**（`rates.high`）。技の種類によらない。
// - **高台にいる人が、高台でない相手から直接攻撃（`melee`）を受けると 0.8 倍**（`rates.highGuard`）。離れた攻撃（`ranged`）はそのまま。
// - 両方が高台なら、どちらも掛けない。空のマスには立たせない（飛ぶ敵を作るまで。`cells.ts` が避ける）。
// 飛ぶ敵・マスごとの手書きの印は後で（SampleGame note 4.19 の計画）。

import type { Fighter, SkillDef } from './rules';

/** マスの分け方。 */
export type CellGround = 'floor' | 'high' | 'sky';
export const CELL_GROUNDS: readonly CellGround[] = ['floor', 'high', 'sky'];

/** 技の届く距離の印。`melee` 直接 / `ranged` 離れた。 */
export type SkillRange = 'melee' | 'ranged';
export const SKILL_RANGES: readonly SkillRange[] = ['melee', 'ranged'];

/**
 * 技が直接攻撃か。書いていなければ種類で決める（魔法は離れた、それ以外は直接）。通常攻撃（技なし）は直接。
 */
export function rangeOf(skill: Pick<SkillDef, 'kind' | 'range'> | null | undefined): SkillRange {
  if (!skill) return 'melee';
  return skill.range ?? (skill.kind === '魔法' ? 'ranged' : 'melee');
}

/**
 * 床からの高さ（フィールドのマス。舞台の点の床が 0）でマスを分ける。床が無ければ（null）空。
 * `highStep` 以上高ければ高台（低い所は床のまま。窪地の不利は持たない）。
 */
export function groundOf(height: number | null, highStep: number): CellGround {
  if (height === null || !Number.isFinite(height)) return 'sky';
  return height >= highStep - 1e-6 ? 'high' : 'floor';
}

/** 高さの倍率（戦闘共通の台帳の `rates`）。 */
export interface HeightRates {
  /** 高台から攻めたときに与えるダメージ。 */
  high: number;
  /** 高台にいる人が直接攻撃で受けるダメージ。 */
  highGuard: number;
}

const onHigh = (who: Fighter) => who.cell?.ground === 'high';

/** 高さで掛けるダメージの倍率。マスの無い人・高さの分からない人は 1。 */
export function heightRate(attacker: Fighter, defender: Fighter, skill: Pick<SkillDef, 'kind' | 'range'> | null, rates: HeightRates): number {
  const up = onHigh(attacker);
  const down = onHigh(defender);
  if (up === down) return 1;
  if (up) return rates.high;
  return rangeOf(skill) === 'melee' ? rates.highGuard : 1;
}
