'use client';

// コンディション。旧作の専用タブと同じく、隊列の顔・Lv・HP・MP を並べる。

import { memberStats } from '../../game/battle/party';
import { characterIcon, characterName } from '../../game/characters';
import { ailmentDef } from '../../game/battle/book';
import { itemName } from '../../game/items';
import type { MemberState } from '../../game/state';
import { AilTags } from '../AilTags';

export function ConditionPage({ party, members, gold }: { party: string[]; members: Map<string, MemberState>; gold: number }) {
  if (party.length === 0) return <><p className="condition-gold">所持金　{gold} G</p><p className="menu-empty">まだ 仲間が いない</p></>;

  return (
    <>
    <p className="condition-gold">所持金　{gold} G</p>
    <ul className="condition-list">
      {party.map((who) => {
        const member = members.get(who);
        const full = memberStats(who, member?.level);
        const image = characterIcon(who);
        return (
          <li key={who} className="condition-member">
            {image ? <img src={image} alt="" /> : <span className="condition-face-empty" />}
            <div className="condition-member-info">
              <h2><span>{characterName(who)}</span><span className="condition-state">{member?.ailments.length ? member.ailments.map((id) => ailmentDef(id)?.name ?? id).join('・') : '正常'}</span></h2>
              <dl>
                <dt>レベル</dt><dd>{member?.level ?? full.level}</dd>
                <dt>HP</dt><dd><Gauge value={member?.hp ?? 0} max={full.hp} /></dd>
                <dt>MP</dt><dd><Gauge value={member?.mp ?? 0} max={full.mp} mp /></dd>
              </dl>
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}

function Gauge({ value, max, mp = false }: { value: number; max: number; mp?: boolean }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return <span className={`condition-gauge${mp ? ' mp' : ''}${!mp && ratio <= 0.4 ? ' low' : ''}`}>
    <span style={{ width: `${ratio * 100}%` }} />
    <b>{value} / {max}</b>
  </span>;
}
