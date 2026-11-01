// 戦闘のマスの高さ（2026-10-29 / GS-285）。純粋な計算だけ（地形を見るのは GameView、ここは決まりだけ）。
//
// - マスは地形から拾った高さで 3 つに分ける: **床** / **高台**（舞台の点の床より `highStep` 以上高い）/ **空**（床が無い）。
// - **高台から、高台でない相手を攻めると 1.2 倍**（`rates.high`）。技の種類によらない。
// - **高台にいる人が、高台でない相手から直接攻撃（`melee`）を受けると 0.8 倍**（`rates.highGuard`）。離れた攻撃（`ranged`）はそのまま。
// - 両方が高台なら、どちらも掛けない。
// - **飛ぶ敵**（2026-10-30 / GS-288。敵の台帳の `flying`）: 高台の扱いは受けない（宙にいる）。飛ばない相手からの直接攻撃は 0.5 倍（`rates.flyGuard`）。
//   飛ぶ敵の攻撃は、高台で受ける倍率（0.8）を掛けない（上から来るので）。
// - **マスごとの手書きの印**（GS-288。`battleStages.json` の `maps.<id>.cells`）: 地形から拾った分け方を上書きする。`block` は誰も立てない。

import type { Fighter, SkillDef } from './rules';

/** マスの分け方。`block` は手書きの印だけ（地形からは出ない。誰も立てない。GS-288）。 */
export type CellGround = 'floor' | 'high' | 'sky' | 'block';
export const CELL_GROUNDS: readonly CellGround[] = ['floor', 'high', 'sky', 'block'];
/** マスごとの手書きの印（GS-288）。書いた分け方で地形の答えを上書きする。 */
export type CellMark = CellGround;
export const CELL_MARKS: readonly CellMark[] = CELL_GROUNDS;

/** そのマスに立てるか（GS-288）。立てないマスには誰も立たず、空のマスには飛ぶ敵だけが立つ。 */
export function canStand(ground: CellGround | undefined | null, flying = false): boolean {
  if (ground === 'block') return false;
  if (ground === 'sky') return flying;
  return true;
}

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
  /** 飛ぶ敵が、飛ばない相手から直接攻撃を受けたときのダメージ（GS-288。既定 0.5）。 */
  flyGuard: number;
}

/** 高台に立っているか。飛ぶ人は宙にいるので高台の扱いを受けない（GS-288）。 */
const onHigh = (who: Fighter) => !who.flying && who.cell?.ground === 'high';

/**
 * 位置の高さで掛けるダメージの倍率（高台・飛ぶ敵）。マスの無い人・高さの分からない人は床の扱い。
 * - 高台から、高台でない相手を攻める → `high`
 * - 高台にいる人が、高台でも飛ぶのでもない相手から直接攻撃を受ける → `highGuard`
 * - 飛ぶ人が、飛ばない相手から直接攻撃を受ける → `flyGuard`（高台からでも掛かる）
 */
export function heightRate(attacker: Fighter, defender: Fighter, skill: Pick<SkillDef, 'kind' | 'range'> | null, rates: HeightRates): number {
  return heightFactors(attacker, defender, skill, rates).reduce((rate, one) => rate * one.rate, 1);
}

/** 倍率 1 つぶんと、その理由（2026-10-31 / GS-292。相手を選ぶ窓が見せる）。 */
export interface RateFactor {
  key: 'high' | 'highGuard' | 'flyGuard' | 'back';
  /** 画面に出す短い理由（「高台から」など）。 */
  label: string;
  rate: number;
}

/** `heightRate` の中身（掛かる倍率と理由）。**倍率の決まりはここ 1 本**——ダメージも画面の説明もここから。 */
export function heightFactors(attacker: Fighter, defender: Fighter, skill: Pick<SkillDef, 'kind' | 'range'> | null, rates: HeightRates): RateFactor[] {
  const up = onHigh(attacker);
  const down = onHigh(defender);
  const melee = rangeOf(skill) === 'melee';
  const out: RateFactor[] = [];
  if (up && !down) out.push({ key: 'high', label: '高台から', rate: rates.high });
  else if (down && !up && melee && !attacker.flying) out.push({ key: 'highGuard', label: '高台の相手', rate: rates.highGuard });
  if (defender.flying && !attacker.flying && melee) out.push({ key: 'flyGuard', label: '飛ぶ相手に直接', rate: rates.flyGuard });
  return out;
}
