'use client';

// ステータス（GS-67）。**数を全部 1 か所で見せる。**
//
// 左の柱（`Menu`）は歩きながら見る要点（Lv・HP・MP・お金）だけを出すので、
// 攻撃・守り・速さ・経験・装備はここで見る。**素の値と装備ぶんを分けて出す**——
// 装備を替えたときに何がどれだけ変わったのか、これが無いと分からない。

import { characterMenuImage } from '../../game/characters';
import { equipBonus, memberRace, memberStats } from '../../game/battle/party';
import { traitLevel, traitText } from '../../game/battle/races';
import { levelUpRule } from '../../game/battle/book';
import { expToNext } from '../../game/battle/growth';
import type { MemberState } from '../../game/state';

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
  // 種族と種族特性（2026-11-03）。まだ効いていない特性も薄く出す（何が増えるか分かるように）。
  const race = memberRace(who);

  return (
    <div className="menu-figured status">
      {/* 絵の場所は**いつも同じ幅と高さ**で取る。絵が無い・細い人でも、右の項目が左へ寄らない。 */}
      <div className="menu-figure-frame">{image ? <img className="menu-figure" src={image} alt="" /> : <span className="menu-figure-empty">No Data</span>}</div>
      {/* 名前は上の「見る仲間」に、装備は「装備」のページに、状態異常は「コンディション」に出す。ここは数と種族。 */}
      <div className="menu-figured-body status-content">
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
            <dt>攻撃</dt><dd>{base.attack + gear.attack}<Plus value={gear.attack} /></dd>
            <dt>守り</dt><dd>{base.guard + gear.guard}<Plus value={gear.guard} /></dd>
            <dt>素早さ</dt><dd>{Math.max(1, base.speed + gear.speed)}<Plus value={gear.speed} /></dd>
            <dt>経験値</dt>
            <dd>{member.exp}</dd>
            <dt>次のレベルまで</dt>
            <dd>{toNext > 0 ? toNext : '—'}</dd>
          </dl>
          {race ? (
            <div className="status-race">
              <p className="status-race-name">
                {race.name}
                {race.text ? <span className="status-race-text">{race.text}</span> : null}
              </p>
              {(race.traits ?? []).length ? (
                <ul className="status-traits">
                  {(race.traits ?? []).map((trait, index) => {
                    const from = traitLevel(trait);
                    const on = from <= member.level;
                    return (
                      // 「Lv 5 ：説明」。Lv 1 から効く物は「Lv - 」。数字は右寄せの列にして、桁が違っても「：」をそろえる。
                      <li key={index} className={on ? '' : 'off'}>
                        <span className="status-trait-lv">Lv</span>
                        <span className="status-trait-level">{from > 1 ? from : '-'}</span>
                        <span className="status-trait-colon">：</span>
                        <span className="status-trait-text">{traitText(trait)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 装備で増えた（減った）ぶん。0 なら出さない。 */
function Plus({ value }: { value: number }) {
  if (!value) return null;
  return <span className="equip-plus">（装備 {value > 0 ? `+${value}` : value}）</span>;
}
