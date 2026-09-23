'use client';

// スキル（GS-67）。**見せるだけ。**
//
// 旧作には「フィールドスキル」があったが、いま覚える技（防御・回避・攻撃魔法）は
// **どれも戦っている最中にしか意味がない**。歩いているときに押せる形にすると、
// 押せるのに何も起きない場所ができる（メニューのタブを絞ったのと同じ理由。GS-54）。
// 使うのは戦闘の「とくぎ」「まほう」から。

import { levelUpRule, skillDef } from '../../game/battle/book';
import { learnedAt } from '../../game/battle/growth';
import { memberDef } from '../../game/battle/book';
import type { MemberState } from '../../game/state';

export function SkillsPage({ who, member }: { who: string; member: MemberState | null }) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;
  if (member.skills.length === 0) return <p className="menu-empty">まだ 何も 覚えていない</p>;

  const def = memberDef(who);
  const max = levelUpRule().max;
  /** これから覚える物（レベルの近い順に 3 つ）。**先が見えると育てる気になる。** */
  const coming: Array<{ level: number; id: string }> = [];
  if (def) {
    for (let level = member.level + 1; level <= max && coming.length < 3; level += 1) {
      for (const id of learnedAt(def, level)) coming.push({ level, id });
    }
  }

  return (
    <>
      <ul className="menu-items">
        {member.skills.map((id) => {
          const skill = skillDef(id);
          return (
            <li key={id}>
              <span className="item-name">{skill?.name ?? id}</span>
              <span className="item-count">{skill?.mp ? `MP ${skill.mp}` : ''}</span>
              <span className="item-text">
                {skill?.kind ? `［${skill.kind}］` : ''}
                {skill?.text ?? ''}
              </span>
            </li>
          );
        })}
      </ul>
      {coming.length > 0 ? (
        <p className="menu-note">
          この先: {coming.map((one) => `Lv${one.level} ${skillDef(one.id)?.name ?? one.id}`).join('　')}
        </p>
      ) : null}
    </>
  );
}
