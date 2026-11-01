// 技の属性の札（2026-10-31 / GS-293）。メニューのスキルと戦闘の技の一覧で、説明の頭に［特技］［全体］［対空］のように出す。
// 純粋な計算だけ。**札の名前はここ 1 か所**——台帳エディタの「戦闘」タブの選択肢も同じ名前にそろえる（`Ledger Editor/presentation.js` の `SKILL_TAG`）。
//
// - 種類（`kind`）: ［特技］［魔法］など、書いた字のまま。
// - 届き方（`reach`）: 貫通は［貫通］、全体は［全体］。単体は出さない。
// - 対空: ダメージを与える技（`type: attack`）で、離れた攻撃（`rangeOf` が `ranged`。魔法は書かなければ離れた）は［対空］。
//   飛ぶ敵にも軽くならずに入る（直接攻撃は飛ぶ敵に `rates.flyGuard` 倍）。直接攻撃は出さない。

import { rangeOf } from './height';
import type { SkillDef } from './rules';

/** 札の名前（台帳エディタと同じ）。 */
export const SKILL_TAG = {
  pierce: '貫通',
  all: '全体',
  ranged: '対空',
} as const;

/** 説明の頭に並べる札（括弧なし）。 */
export function skillTags(skill: Pick<SkillDef, 'kind' | 'type' | 'reach' | 'range'> | null | undefined): string[] {
  if (!skill) return [];
  const tags: string[] = [];
  if (skill.kind) tags.push(skill.kind);
  if (skill.reach === 'pierce' || skill.reach === 'all') tags.push(SKILL_TAG[skill.reach]);
  if (skill.type === 'attack' && rangeOf(skill) === 'ranged') tags.push(SKILL_TAG.ranged);
  return tags;
}

/** 札を全角の角括弧でつないだ字（「［魔法］［全体］［対空］」）。札が無ければ空。 */
export function skillTagText(skill: Parameters<typeof skillTags>[0]): string {
  return skillTags(skill).map((tag) => `［${tag}］`).join('');
}
