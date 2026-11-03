// 種族と種族特性（2026-11-03）。**決まりだけ**の所（画面も音も台帳の読み込みも知らない）。
//
// 種族は仲間の台帳 `party.json` の `races`（id → 名前・説明・特性）、仲間は `members.<id>.race` で指す。
// 敵には付けない。特性ごとに `level`（そのレベルから効く。書かなければ 1）を書けるので、
// 同じ種族でもレベルが上がると特性が増える（例: ノル族はレベル 5 から、作るとたまに 2 個できる）。
//
//   "races": {
//     "nol":  { "name": "ノル族", "traits": [{ "type": "craft" }, { "type": "craftExtra", "chance": 0.2, "level": 5 }] },
//     "naga": { "name": "ナーガ族", "traits": [{ "type": "mpRate", "kind": "魔法", "rate": 0.8 }, { "type": "powerRate", "kind": "魔法", "rate": 1.2 }] }
//   }
//
// 特性の種類:
// - `craft`      道具を作れる。**隊列にこの特性の人がいないと、メニューの「つくる」が出ない。**
// - `craftExtra` 作ったとき、`chance`（0〜1）の見込みで もう 1 個できる（材料は 1 回ぶん）。隊列の中でいちばん高い見込みを使う。
// - `mpRate`     技の消費 MP を `rate` 倍（四捨五入。1 以上の技は 1 より下げない）。`kind`（「特技」「魔法」）を書けばその種類だけ。
// - `powerRate`  技のダメージを `rate` 倍（後衛・高台の倍率と重ねてから丸める）。`kind` は上と同じ。通常攻撃には効かない。

import type { SkillDef } from './rules';

export type RaceTraitType = 'craft' | 'craftExtra' | 'mpRate' | 'powerRate';
/** 特性の種類の一覧（台帳の検査と台帳エディタの選択に使う）。 */
export const RACE_TRAIT_TYPES: readonly RaceTraitType[] = ['craft', 'craftExtra', 'mpRate', 'powerRate'];
/** 倍率の範囲（`mpRate`・`powerRate`）。 */
export const RACE_RATE = { min: 0.1, max: 5 } as const;

/** 特性 1 つぶん。 */
export interface RaceTrait {
  type: RaceTraitType;
  /** そのレベルから効く。書かなければ 1（はじめから）。 */
  level?: number;
  /** `mpRate`・`powerRate` の倍率。 */
  rate?: number;
  /** `mpRate`・`powerRate` が効く技の種類（「特技」「魔法」）。書かなければどの技にも。 */
  kind?: string;
  /** `craftExtra` の見込み（0〜1）。 */
  chance?: number;
  /** ステータスに出す説明。書かなければ種類と数から作る（`traitText`）。 */
  text?: string;
}

/** 種族 1 つぶん。 */
export interface RaceDef {
  name: string;
  /** ステータスに出す一言。 */
  text?: string;
  traits?: RaceTrait[];
}

/** その特性が効き始めるレベル。 */
export function traitLevel(trait: RaceTrait): number {
  const level = Math.trunc(Number(trait.level ?? 1));
  return Number.isFinite(level) && level >= 1 ? level : 1;
}

/** そのレベルで効いている特性（台帳の並び順）。種族が無ければ空。 */
export function traitsAt(race: RaceDef | null | undefined, level: number): RaceTrait[] {
  return (race?.traits ?? []).filter((trait) => trait && traitLevel(trait) <= level);
}

/** 技にかかる倍率（その種類の特性を掛け合わせる）。技が無い（通常攻撃）なら 1。 */
function skillRate(type: 'mpRate' | 'powerRate', skill: Pick<SkillDef, 'kind'> | null | undefined, traits: readonly RaceTrait[] | undefined): number {
  if (!skill) return 1;
  let rate = 1;
  for (const trait of traits ?? []) {
    if (trait.type !== type) continue;
    if (trait.kind && trait.kind !== skill.kind) continue;
    const value = Number(trait.rate);
    if (Number.isFinite(value) && value > 0) rate *= value;
  }
  return rate;
}

/**
 * 払う MP（`mp` は台帳の消費 MP。フィールドアタックの `field.mp` にも使う）。
 * 0 の技は 0 のまま。1 以上の技は、減らしても 1 より下げない。
 */
export function scaledMp(mp: number, skill: Pick<SkillDef, 'kind'> | null | undefined, traits: readonly RaceTrait[] | undefined): number {
  if (!(mp > 0)) return 0;
  return Math.max(1, Math.round(mp * skillRate('mpRate', skill, traits)));
}

/** その人がその技に払う MP。技が無ければ 0。 */
export function mpCostOf(skill: SkillDef | null | undefined, traits: readonly RaceTrait[] | undefined): number {
  return skill ? scaledMp(skill.mp, skill, traits) : 0;
}

/** その技のダメージの倍率（種族特性）。通常攻撃（技なし）は 1。 */
export function powerRateOf(skill: Pick<SkillDef, 'kind'> | null | undefined, traits: readonly RaceTrait[] | undefined): number {
  return skillRate('powerRate', skill, traits);
}

/** 隊列の誰かが道具を作れるか（人ごとの、効いている特性の並び）。 */
export function canCraftWith(party: ReadonlyArray<readonly RaceTrait[]>): boolean {
  return party.some((traits) => traits.some((trait) => trait.type === 'craft'));
}

/** 作ったときにもう 1 個できる見込み（0〜1）。隊列の中でいちばん高い物。 */
export function craftExtraChance(party: ReadonlyArray<readonly RaceTrait[]>): number {
  let best = 0;
  for (const traits of party) {
    for (const trait of traits) {
      if (trait.type !== 'craftExtra') continue;
      const chance = Number(trait.chance);
      if (Number.isFinite(chance)) best = Math.max(best, Math.min(1, chance));
    }
  }
  return best;
}

/** 倍率を「2割 減る／上がる」の形に。割り切れなければ ％ で。 */
function rateWords(rate: number, down: string, up: string): string {
  const diff = Math.abs(1 - rate);
  const tenths = diff * 10;
  const amount = Math.abs(tenths - Math.round(tenths)) < 1e-9 ? `${Math.round(tenths)}割` : `${Math.round(diff * 100)}％`;
  return `${amount} ${rate < 1 ? down : up}`;
}

/** ステータスに出す特性の説明。台帳に `text` があればそれ。 */
export function traitText(trait: RaceTrait): string {
  if (trait.text) return trait.text;
  const kind = trait.kind ?? '技';
  switch (trait.type) {
    case 'craft':
      return '道具を 作れる';
    case 'craftExtra':
      return `作ると ${Math.round(Math.min(1, Math.max(0, Number(trait.chance) || 0)) * 100)}％で もう 1 個 できる`;
    case 'mpRate':
      return `${kind}の 消費MPが ${rateWords(Number(trait.rate) || 1, '減る', '増える')}`;
    case 'powerRate':
      return `${kind}の 威力が ${rateWords(Number(trait.rate) || 1, '下がる', '上がる')}`;
    default:
      return String((trait as { type?: unknown }).type ?? '');
  }
}
