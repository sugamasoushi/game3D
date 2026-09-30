'use client';

// ステータス（GS-67）。**数を全部 1 か所で見せる。**
//
// 左の柱（`Menu`）は歩きながら見る要点（Lv・HP・MP・お金）だけを出すので、
// 攻撃・守り・速さ・経験・装備はここで見る。**素の値と装備ぶんを分けて出す**——
// 装備を替えたときに何がどれだけ変わったのか、これが無いと分からない。

import { characterMenuImage, characterName } from '../../game/characters';
import { equipBonus, memberStats } from '../../game/battle/party';
import { itemName } from '../../game/items';
import { levelUpRule } from '../../game/battle/book';
import { expToNext } from '../../game/battle/growth';
import type { MemberState } from '../../game/state';
import { AilTags } from '../AilTags';

export function StatusPage({
  who,
  member,
}: {
  who: string;
  member: MemberState | null;
}) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;

  const base = memberStats(who, member.level);
  const toNext = expToNext(member.exp, member.level, levelUpRule());
  const image = characterMenuImage(who);
  const gear = equipBonus(member.equip);

  return (
    <div className="status">
      {image ? <img className="status-character-icon" src={image} alt="" /> : null}
      <div className="status-content">
      <p className="status-name">
        {characterName(who)}
        <AilTags ids={member.ailments} />
      </p>
      <div className="status-columns">
      <dl className="status-facts">
        <dt>レベル</dt><dd>{member.level}</dd>
        <dt>HP</dt>
        <dd>
          {member.hp} / {base.hp}
        </dd>
        <dt>MP</dt>
        <dd>
          {member.mp} / {base.mp}
        </dd>
        <dt>攻撃</dt><dd>{base.attack + gear.attack}</dd>
        <dt>守り</dt><dd>{base.guard + gear.guard}</dd>
        <dt>素早さ</dt><dd>{Math.max(1, base.speed + gear.speed)}</dd>
        <dt>経験値</dt>
        <dd>{member.exp}</dd>
        <dt>次のレベルまで</dt>
        <dd>{toNext > 0 ? toNext : '—'}</dd>
      </dl>
      <dl className="status-facts status-equipment">
        <dt>武器</dt><dd>{member.equip.weapon ? itemName(member.equip.weapon) : 'なし'}</dd>
        <dt>鎧</dt><dd>{member.equip.armor ? itemName(member.equip.armor) : 'なし'}</dd>
        {Object.entries(member.equip).filter(([slot]) => !['weapon', 'armor'].includes(slot)).map(([slot, id]) => (
          <span key={slot} className="status-pair"><dt>{slot}</dt><dd>{itemName(id)}</dd></span>
        ))}
      </dl>
      </div>
      </div>
    </div>
  );
}
