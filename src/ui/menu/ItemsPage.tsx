'use client';

// 持ち物のページ（GS-46 / GS-54 / GS-64）。
//
// 名前と説明は台帳（`data/items.json`）、**持っている数は記録**（`state.items`）から取る。
// 台帳に無い id はそのまま出す——台帳から消しただけで持ち物が消えたように見えないため。
//
// **使えるのは `use` を書いた物だけ。** 鍵や手紙のような「持っているだけの物」は
// 押せない行として並べる——消してしまうと、持っているのか無くしたのか分からない。
//
// **効かない物も押せなくするだけで消さない**（満タンのときの やくそう など）。
// 数だけ減って何も起きないのが一番困る。

import { useState } from 'react';
import { itemName, itemText, itemUse } from '../../game/items';
import { memberStats } from '../../game/battle/party';
import { wouldHelp } from '../../game/battle/heal';
import { characterName } from '../../game/characters';
import type { MemberState } from '../../game/state';

export function ItemsPage({
  items,
  party,
  members,
  onUse,
}: {
  items: Map<string, number>;
  /** 隊列（GS-60）。使い先が 1 人なら選ばせない。 */
  party: string[];
  members: Map<string, MemberState>;
  /** 使う。返り値は画面に出す一言（使えなければ空）。 */
  onUse(id: string, who: string): string;
}) {
  // 使うと数が減る。**記録は入れ物のまま書き換わる**ので、描き直しはここで促す。
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState('');
  /** 使い先を選んでいる物。null なら選んでいない。 */
  const [asking, setAsking] = useState<string | null>(null);

  const rows = [...items.entries()].filter(([, count]) => count > 0);
  if (rows.length === 0) return <p className="menu-empty">なにも持っていない</p>;

  const use = (id: string, who: string) => {
    setNote(onUse(id, who));
    setAsking(null);
    setTick(tick + 1);
  };

  /** その人に効くか。台帳に無い人（記録が古い）には使わせない。 */
  const helps = (id: string, who: string): boolean => {
    const def = itemUse(id, 'field');
    const now = members.get(who);
    if (!def || !now) return false;
    return wouldHelp(now, memberStats(who, now.level), def);
  };

  const alive = party.filter((who) => members.has(who));

  return (
    <>
      <ul className="menu-items" data-tick={tick}>
        {rows.map(([id, count]) => {
          const usable = Boolean(itemUse(id, 'field'));
          const ready = usable && alive.some((who) => helps(id, who));
          return (
            <li key={id}>
              {usable ? (
                <button
                  type="button"
                  data-pick
                  className="item-name item-use"
                  disabled={!ready}
                  onClick={() => {
                    // 使い先が 1 人なら選ばせない。増えたときだけ選ぶ段へ進む。
                    if (alive.length <= 1) use(id, alive[0] ?? party[0] ?? '');
                    else setAsking(id);
                  }}
                >
                  {itemName(id)}
                </button>
              ) : (
                <span className="item-name">{itemName(id)}</span>
              )}
              <span className="item-count">{count}</span>
              <span className="item-text">{itemText(id)}</span>
            </li>
          );
        })}
      </ul>

      {/* 使い先を選ぶ（仲間が 2 人以上のとき）。 */}
      {asking ? (
        <div className="menu-pick">
          <span>だれに つかう？</span>
          {alive.map((who) => (
            <button key={who} type="button" data-pick disabled={!helps(asking, who)} onClick={() => use(asking, who)}>
              {characterName(who)}
            </button>
          ))}
          <button type="button" data-pick onClick={() => setAsking(null)}>
            やめる
          </button>
        </div>
      ) : null}

      {note ? <p className="menu-note">{note}</p> : null}
    </>
  );
}
