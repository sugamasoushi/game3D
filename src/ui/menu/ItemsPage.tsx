'use client';

// 持ち物のページ（GS-46 / GS-54 / GS-64）。
//
// 名前と説明は台帳（`data/items.json`）、**持っている数は記録**（`state.items`）から取る。
// 台帳に無い id はそのまま出す——台帳から消しただけで持ち物が消えたように見えないため。
//
// **どの行にもカーソルが止まる（GS-206）。** 使えない物（鍵・手紙・武具）は薄く出し、
// 決定しても使わずに理由を一言出す。
//
// **使える物は HP・MP の残りに関わらず選べる（GS-208）。** 決定すると使い先の小窓を出し、
// 仲間ごとに顔・Lv・HP・MP・状態を見せて選ばせる（1 人でも出す——いまの数を見て決められるように）。
// 効き目の無い人（満タン・その状態でない）は選べない。使っても数が残る間は小窓を開いたままにし、
// 続けて使えるようにする。
//
// **効かない物も消さない**——一覧から消すと持っているのか無くしたのか分からない。

import { useEffect, useRef, useState } from 'react';
import { itemName, itemText, itemUse } from '../../game/items';
import { memberStats } from '../../game/battle/party';
import { wouldHelp } from '../../game/battle/heal';
import { characterIcon, characterName } from '../../game/characters';
import { ailmentDef } from '../../game/battle/book';
import { Gauge } from './ConditionPage';
import type { MemberState } from '../../game/state';

export function ItemsPage({
  items,
  party,
  members,
  onUse,
}: {
  items: Map<string, number>;
  /** 隊列（GS-60）。使い先の小窓に並ぶ順。 */
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
  /** 小窓を閉じた・使い切ったあとにカーソルを戻す行（id と、その時の何行目か）。 */
  const backTo = useRef<{ id: string; row: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const askRef = useRef<HTMLElement>(null);
  /** 小窓で最後に使った人。続けて使うときにカーソルを留める。 */
  const lastWho = useRef('');

  const rows = [...items.entries()].filter(([, count]) => count > 0);

  useEffect(() => {
    if (asking) {
      const ask = askRef.current;
      // 続けて使うときは同じ人に留まる。効かなくなったら次に効く人、誰もいなければ「やめる」。
      const same = ask?.querySelector<HTMLElement>(`[data-who="${lastWho.current}"]:not(:disabled)`);
      (same ?? ask?.querySelector<HTMLElement>('[data-pick]:not(:disabled)'))?.focus();
      return;
    }
    const back = backTo.current;
    if (!back) return;
    backTo.current = null;
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
    // 使い切って行が消えたら、同じ高さ（無ければ最後）の行へ。
    (all.find((el) => el.dataset.item === back.id) ?? all[Math.min(back.row, all.length - 1)])?.focus();
  }, [asking, tick]);

  if (rows.length === 0) return <p className="menu-empty">なにも持っていない</p>;

  const alive = party.filter((who) => members.has(who));

  /** その人に効くか。台帳に無い人（記録が古い）には使わせない。 */
  const helps = (id: string, who: string): boolean => {
    const def = itemUse(id, 'field');
    const now = members.get(who);
    if (!def || !now) return false;
    return wouldHelp(now, memberStats(who, now.level), def);
  };

  const remember = (id: string) => {
    backTo.current = { id, row: rows.findIndex(([at]) => at === id) };
  };

  const use = (id: string, who: string) => {
    lastWho.current = who;
    setNote(onUse(id, who));
    // 使い切ったら一覧へ戻る。残っていれば小窓のまま続けて使える。
    if ((items.get(id) ?? 0) <= 0) {
      remember(id);
      setAsking(null);
    }
    setTick(tick + 1);
  };

  const choose = (id: string) => {
    if (!itemUse(id, 'field')) {
      setNote(`${itemName(id)}は ここでは つかえない`);
      return;
    }
    setNote('');
    lastWho.current = '';
    setAsking(id);
  };

  const cancel = () => {
    if (asking) remember(asking);
    setAsking(null);
  };

  return (
    <div className="item-page">
      <ul className="menu-items item-list" ref={listRef} data-tick={tick}>
        {rows.map(([id, count]) => {
          const ready = Boolean(itemUse(id, 'field'));
          return (
            <li key={id}>
              <button
                type="button"
                data-pick
                data-item={id}
                className={`item-row${asking === id ? ' on' : ''}`}
                aria-disabled={!ready}
                onClick={() => choose(id)}
              >
                <span className="item-name">{itemName(id)}</span>
                <span className="item-count">{count}</span>
                <span className="item-text">{itemText(id)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* 使い先を選ぶ小窓（GS-208）。取り消し・使い切りで一覧の同じ行へ戻る。 */}
      {asking ? (
        <div className="equip-modal-backdrop" onClick={cancel}>
          <section
            ref={askRef}
            className="equip-chooser item-target"
            role="dialog"
            aria-modal="true"
            data-layer
            onClick={(event) => event.stopPropagation()}
          >
            <h2>
              {itemName(asking)}
              <span className="item-target-count">のこり {items.get(asking) ?? 0}</span>
              <span className="item-target-ask">
                {/* 全員に効かないときは理由を出す（カーソルは「やめる」に居る）。 */}
                {alive.some((who) => helps(asking, who)) ? 'だれに つかう？' : 'いまは だれにも 効き目がない'}
              </span>
            </h2>
            <ul className="item-target-list">
              {alive.map((who) => {
                const member = members.get(who)!;
                const full = memberStats(who, member.level);
                const icon = characterIcon(who);
                return (
                  <li key={who}>
                    <button
                      type="button"
                      data-pick
                      data-who={who}
                      className="item-target-member"
                      disabled={!helps(asking, who)}
                      onClick={() => use(asking, who)}
                    >
                      {icon ? <img src={icon} alt="" /> : <span className="condition-face-empty" />}
                      <span className="item-target-info">
                        <span className="item-target-name">
                          {characterName(who)}
                          <span className="item-target-level">Lv {member.level}</span>
                          <span className="condition-state">
                            {member.ailments.length ? member.ailments.map((id) => ailmentDef(id)?.name ?? id).join('・') : '正常'}
                          </span>
                        </span>
                        <span className="item-target-gauges">
                          <span>HP</span>
                          <Gauge value={member.hp} max={full.hp} />
                          <span>MP</span>
                          <Gauge value={member.mp} max={full.mp} mp />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {note ? <p className="menu-note">{note}</p> : null}
            <button type="button" data-pick data-cancel onClick={cancel}>
              やめる
            </button>
          </section>
        </div>
      ) : null}

      {note && !asking ? <p className="menu-note">{note}</p> : null}
    </div>
  );
}
