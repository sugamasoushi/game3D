'use client';

// 種族特性（2026-11-07。「仲間」の種類の 1 つ）。前はステータスの右に出していたのを、ここへ移した。
//
// 種族の名前と説明、特性を「Lv 5 ：説明」で並べる。**まだ効いていない特性も薄く出す**——何が増えるか分かるように。
// 決まりは `battle/races.ts`（効き始めるレベル `traitLevel`・文 `traitText`）。

import { characterMenuImage } from '../../game/characters';
import { memberRace } from '../../game/battle/party';
import { traitLevel, traitText } from '../../game/battle/races';
import type { MemberState } from '../../game/state';

export function RacePage({ who, member }: { who: string; member: MemberState | null }) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;
  const image = characterMenuImage(who);
  const race = memberRace(who);
  const traits = race?.traits ?? [];

  return (
    <div className="menu-figured race-page">
      <div className="menu-figure-frame">{image ? <img className="menu-figure" src={image} alt="" /> : <span className="menu-figure-empty">No Data</span>}</div>
      <div className="menu-figured-body">
        {race ? (
          <div className="status-race">
            <p className="status-race-name">
              {race.name}
              {race.text ? <span className="status-race-text">{race.text}</span> : null}
            </p>
            {traits.length ? (
              <ul className="status-traits">
                {traits.map((trait, index) => {
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
            ) : (
              <p className="menu-empty">特性は ない</p>
            )}
          </div>
        ) : (
          <p className="menu-empty">種族特性は ない</p>
        )}
      </div>
    </div>
  );
}
