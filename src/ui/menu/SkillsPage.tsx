'use client';

// スキル（GS-67）。**見せるだけ。**
//
// 旧作には「フィールドスキル」があったが、いま覚える技（防御・回避・攻撃魔法）は
// **どれも戦っている最中にしか意味がない**。歩いているときに押せる形にすると、
// 押せるのに何も起きない場所ができる（メニューのタブを絞ったのと同じ理由。GS-54）。
// 使うのは戦闘の「とくぎ」「まほう」から。
//
// 絵はステータスと同じメニュー用の絵を左に置く（GS-206）。

import { skillDef } from '../../game/battle/book';
import { characterMenuImage } from '../../game/characters';
import type { MemberState } from '../../game/state';

export function SkillsPage({ who, member }: { who: string; member: MemberState | null }) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;

  const image = characterMenuImage(who);

  return (
    <div className="menu-figured skill-page">
      {image ? <img className="menu-figure" src={image} alt="" /> : null}
      <div className="menu-figured-body">
        {member.skills.length === 0 ? (
          <p className="menu-empty">まだ 何も 覚えていない</p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
