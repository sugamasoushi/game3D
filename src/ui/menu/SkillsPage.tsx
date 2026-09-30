'use client';

// スキル（GS-67）。**見せるだけ。**
//
// 旧作には「フィールドスキル」があったが、いま覚える技（防御・回避・攻撃魔法）は
// **どれも戦っている最中にしか意味がない**。歩いているときに押せる形にすると、
// 押せるのに何も起きない場所ができる（メニューのタブを絞ったのと同じ理由。GS-54）。
// 使うのは戦闘の「とくぎ」「まほう」から。

import { skillDef } from '../../game/battle/book';
import { characterIcon } from '../../game/characters';
import type { MemberState } from '../../game/state';

export function SkillsPage({ who, member }: { who: string; member: MemberState | null }) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;
  if (member.skills.length === 0) return <p className="menu-empty">まだ 何も 覚えていない</p>;

  const image = characterIcon(who);

  return (
    <>
      <div className="skill-page">
       <ul className="menu-items skill-items">
        {member.skills.map((id) => {
          const skill = skillDef(id);
          return (
            <li key={id}>
              <span className="item-name">{skill?.name ?? id}</span>
              <span className="item-count">{skill?.mp ? `MP ${skill.mp}` : '—'}</span>
              <span className="item-text">
                {skill?.kind ? `［${skill.kind}］` : ''}
                {skill?.text ?? ''}
              </span>
            </li>
          );
        })}
       </ul>
       {image ? <img className="skill-character-icon" src={image} alt="" /> : null}
      </div>
    </>
  );
}
