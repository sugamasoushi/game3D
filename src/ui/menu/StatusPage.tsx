'use client';

// ステータス（GS-67）。**数を全部 1 か所で見せる。**
//
// 左の柱（`Menu`）は歩きながら見る要点（Lv・HP・MP・お金）だけを出すので、
// 攻撃・守り・速さ・経験・装備はここで見る。**素の値と装備ぶんを分けて出す**——
// 装備を替えたときに何がどれだけ変わったのか、これが無いと分からない。

import { itemName } from '../../game/items';
import { equipBonus, memberStats } from '../../game/battle/party';
import { levelUpRule } from '../../game/battle/book';
import { expToNext } from '../../game/battle/growth';
import { characterName } from '../../game/characters';
import type { MemberState } from '../../game/state';
import { AilTags } from '../AilTags';

const SLOT_LABEL: Record<string, string> = { weapon: 'ぶき', armor: 'よろい' };

export function StatusPage({
  who,
  member,
  gold,
}: {
  who: string;
  member: MemberState | null;
  gold: number;
}) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;

  const base = memberStats(who, member.level);
  const gear = equipBonus(member.equip);
  const toNext = expToNext(member.exp, member.level, levelUpRule());

  /** 素の値と装備ぶん。装備が 0 なら括弧は出さない。 */
  const row = (label: string, value: number, plus: number) => (
    <>
      <dt>{label}</dt>
      <dd>
        {value + plus}
        {plus ? (
          <span className="equip-plus">
            （{value} {plus > 0 ? '+' : '-'} {Math.abs(plus)}）
          </span>
        ) : null}
      </dd>
    </>
  );

  const slots = Object.keys(member.equip);

  return (
    <div className="status">
      <p className="status-name">
        {characterName(who)}　<span className="status-level">Lv {member.level}</span>
        <AilTags ids={member.ailments} />
      </p>
      <dl className="status-facts">
        <dt>HP</dt>
        <dd>
          {member.hp} / {base.hp}
        </dd>
        <dt>MP</dt>
        <dd>
          {member.mp} / {base.mp}
        </dd>
        {row('こうげき', base.attack, gear.attack)}
        {row('まもり', base.guard, gear.guard)}
        {row('すばやさ', base.speed, gear.speed)}
        <dt>けいけんち</dt>
        <dd>{member.exp}</dd>
        <dt>つぎまで</dt>
        <dd>{toNext > 0 ? toNext : '—'}</dd>
        <dt>おかね</dt>
        <dd>{gold} G</dd>
      </dl>
      <dl className="status-facts">
        {slots.length === 0 ? (
          <>
            <dt>そうび</dt>
            <dd>なし</dd>
          </>
        ) : (
          slots.map((slot) => (
            <span key={slot} className="status-pair">
              <dt>{SLOT_LABEL[slot] ?? slot}</dt>
              <dd>{itemName(member.equip[slot])}</dd>
            </span>
          ))
        )}
      </dl>
    </div>
  );
}
