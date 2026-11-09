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
//
// **材料になる物は「つかう／つくる」を選ばせる（2026-11-03）。** 「つくる」で、その物を材料にする物
// （台帳の `craft`）を並べ、要る材料と持っている数を見せる。そろっていれば決定で 1 個作る。
// 作っても材料が残る間は小窓を開いたままにし、続けて作れるようにする。
// **作れるのは隊列に種族特性 `craft` の人（ノル族のメイナ）がいるときだけ（2026-11-03）。** いなければ
// 「つくる」を出さず、材料もただの持ち物として扱う。
//
// **上に種類のタブ（2026-11-04）: 道具／武具／大事な物／つくる。** 分け方は図鑑と同じ（`codexItemKind`）。
// 「つくる」は作り方の一覧で、作られる物か材料のどれかを手に入れたことがある作り方を並べ（`codexRecipes`）、
// 要る材料と持っている数を見せる。そろっていれば決定で 1 個作る。まだ手に入れていない物の名前は「？？？」。
// 「つくる」のタブも作れる人が隊列にいるときだけ出す。

import { useEffect, useRef, useState } from 'react';
import { itemBook, itemCanCraft, itemCraftNeeds, itemCraftsUsing, itemName, itemText, itemUse } from '../../game/items';
import { codexItemKind, codexRecipes, type CodexItemKind } from '../../game/codex';
import { memberStats, memberTraits } from '../../game/battle/party';
import { canCraftWith } from '../../game/battle/races';
import { wouldHelp } from '../../game/battle/heal';
import { characterIcon, characterName } from '../../game/characters';
import { ailmentDef } from '../../game/battle/book';
import { Gauge } from './ConditionPage';
import type { MemberState } from '../../game/state';

/** 種類のタブ。「つくる」は作れる人がいるときだけ並べる。 */
const KINDS: readonly CodexItemKind[] = ['道具', '武具', '大事な物'];
type Tab = CodexItemKind | 'つくる';
const UNKNOWN = '？？？';

export function ItemsPage({
  items,
  found,
  party,
  members,
  onUse,
  onCraft,
}: {
  items: Map<string, number>;
  /** 手に入れたことのある持ち物（2026-11-04）。「つくる」の一覧で名前を伏せるかを決める。 */
  found: ReadonlySet<string>;
  /** 隊列（GS-60）。使い先の小窓に並ぶ順。 */
  party: string[];
  members: Map<string, MemberState>;
  /** 使う。返り値は画面に出す一言（使えなければ空）。 */
  onUse(id: string, who: string): string;
  /** 作る（2026-11-03）。返り値は画面に出す一言（作れなければ空）。 */
  onCraft(id: string): string;
}) {
  // 使うと数が減る。**記録は入れ物のまま書き換わる**ので、描き直しはここで促す。
  const [tick, setTick] = useState(0);
  /** 開いている種類のタブ（2026-11-04）。 */
  const [tab, setTab] = useState<Tab>('道具');
  const [note, setNote] = useState('');
  /** 使い先を選んでいる物。null なら選んでいない。 */
  const [asking, setAsking] = useState<string | null>(null);
  /** 「つかう／つくる」を選んでいる物（材料になる物だけ）。 */
  const [acting, setActing] = useState<string | null>(null);
  /** 作る物を選んでいる材料。 */
  const [crafting, setCrafting] = useState<string | null>(null);
  const actRef = useRef<HTMLElement>(null);
  const craftRef = useRef<HTMLElement>(null);
  /** 作る小窓で最後に作った物。続けて作るときにカーソルを留める。 */
  const lastMade = useRef('');
  /** 小窓を閉じた・使い切ったあとにカーソルを戻す行（id と、その時の何行目か）。 */
  const backTo = useRef<{ id: string; row: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const askRef = useRef<HTMLElement>(null);
  /** 小窓で最後に使った人。続けて使うときにカーソルを留める。 */
  const lastWho = useRef('');

  const owned = [...items.entries()].filter(([, count]) => count > 0);
  /** 台帳に無い id は大事な物に数える（名前は id のまま出る）。 */
  const kindOf = (id: string) => codexItemKind(itemBook()[id]);
  const rows = owned.filter(([id]) => kindOf(id) === tab);

  useEffect(() => {
    if (acting) {
      actRef.current?.querySelector<HTMLElement>('[data-pick]:not(:disabled)')?.focus();
      return;
    }
    if (crafting) {
      const box = craftRef.current;
      const same = box?.querySelector<HTMLElement>(`[data-make="${lastMade.current}"]:not(:disabled)`);
      (same ?? box?.querySelector<HTMLElement>('[data-pick]:not(:disabled)'))?.focus();
      return;
    }
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
  }, [asking, acting, crafting, tick]);

  const alive = party.filter((who) => members.has(who));
  /** 隊列に道具を作れる人がいるか（種族特性 `craft`。2026-11-03）。 */
  const canMake = canCraftWith(alive.map((who) => memberTraits(who, members.get(who)?.level ?? 1)));
  const tabs: Tab[] = canMake ? [...KINDS, 'つくる'] : [...KINDS];
  // 作れる人が抜けたら「つくる」は無くなる。道具へ戻す。
  const at: Tab = tabs.includes(tab) ? tab : '道具';
  /** 身に着けている物も手に入れた扱い（はじめから着ている物は袋を通らない）。 */
  const equipped = alive.flatMap((who) => Object.values(members.get(who)?.equip ?? {}));
  const recipes = at === 'つくる' ? codexRecipes(itemBook(), found, equipped) : [];
  const knownName = (id: string, known: boolean) => (known ? itemName(id) : UNKNOWN);
  /** 「つかう／つくる」を選ばせる物（作れる人がいて、材料になる物）。 */
  const makes = (id: string) => canMake && itemCraftsUsing(id).length > 0;

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

  /** 使い先の小窓を開く。使えない物は理由だけ出す。 */
  const startUse = (id: string) => {
    if (!itemUse(id, 'field')) {
      setNote(`${itemName(id)}は ここでは つかえない`);
      return;
    }
    setNote('');
    lastWho.current = '';
    setActing(null);
    setAsking(id);
  };

  const choose = (id: string) => {
    if (makes(id)) {
      setNote('');
      setActing(id);
      return;
    }
    startUse(id);
  };

  const startCraft = (id: string) => {
    setNote('');
    lastMade.current = '';
    setActing(null);
    setCrafting(id);
  };

  const make = (result: string) => {
    if (!crafting) return;
    lastMade.current = result;
    setNote(onCraft(result));
    // 材料を使い切ったら一覧へ戻る。残っていれば小窓のまま続けて作れる。
    if ((items.get(crafting) ?? 0) <= 0) {
      remember(crafting);
      setCrafting(null);
    }
    setTick(tick + 1);
  };

  /** 「つくる」の一覧から作る（2026-11-04）。行は残るので、カーソルもそのまま。 */
  const makeHere = (result: string) => {
    if (!itemCanCraft(items, result)) {
      setNote('材料が たりない');
      return;
    }
    setNote(onCraft(result));
    setTick(tick + 1);
  };

  const cancel = () => {
    const open = asking ?? acting ?? crafting;
    if (open) remember(open);
    setAsking(null);
    setActing(null);
    setCrafting(null);
  };

  return (
    <div className="item-page">
      {/* 種類のタブ（2026-11-04）。中身の先頭の行（←→ で隣へ、決定で切り替え）。数は持っている種類の数。 */}
      <div className="quest-kinds" role="tablist" aria-label="持ち物の種類">
        {tabs.map((one) => {
          const count = one === 'つくる' ? 0 : owned.filter(([id]) => kindOf(id) === one).length;
          return (
            <button key={one} type="button" role="tab" data-pick aria-selected={one === at} className={one === at ? 'on' : ''} onClick={() => { setTab(one); setNote(''); }}>
              {one}
              {count ? <small>{count}</small> : null}
            </button>
          );
        })}
      </div>

      {at === 'つくる' ? (
        recipes.length === 0 ? (
          <p className="menu-empty">まだ 作り方を 知らない</p>
        ) : (
          <ul className="item-craft-list item-recipes" data-tick={tick}>
            {recipes.map((entry) => {
              const ready = itemCanCraft(items, entry.id);
              return (
                <li key={entry.id}>
                  <button type="button" data-pick className="item-craft-row" aria-disabled={!ready} onClick={() => makeHere(entry.id)}>
                    <span className="item-craft-name">
                      {knownName(entry.id, entry.known)}
                      <span className="item-craft-have">（持っている {items.get(entry.id) ?? 0}）</span>
                    </span>
                    <span className="item-craft-needs">
                      {entry.parts.map((part) => {
                        const have = items.get(part.id) ?? 0;
                        return (
                          <span key={part.id} className={have < part.count ? 'short' : ''}>
                            {knownName(part.id, part.known)} {part.count}（{have}）
                          </span>
                        );
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : rows.length === 0 ? (
        <p className="menu-empty">{owned.length === 0 ? 'なにも持っていない' : `${at}は 持っていない`}</p>
      ) : (
      <ul className="menu-items item-list" ref={listRef} data-tick={tick}>
        {rows.map(([id, count]) => {
          const ready = Boolean(itemUse(id, 'field')) || makes(id);
          return (
            <li key={id}>
              <button
                type="button"
                data-pick
                data-item={id}
                className={`item-row${[asking, acting, crafting].includes(id) ? ' on' : ''}`}
                aria-disabled={!ready}
                onClick={() => choose(id)}
              >
                {/* 「名前：個数」。個数は列をそろえ、コロンは左端・数は右端に置く。 */}
                <span className="item-name">{itemName(id)}</span>
                <span className="item-count">
                  <span>：</span>
                  <span>{count}</span>
                </span>
                <span className="item-text">{itemText(id)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      )}

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

      {/* 材料になる物の「つかう／つくる」（2026-11-03）。 */}
      {acting ? (
        <div className="equip-modal-backdrop" onClick={cancel}>
          <section
            ref={actRef}
            className="equip-chooser item-act"
            role="dialog"
            aria-modal="true"
            data-layer
            onClick={(event) => event.stopPropagation()}
          >
            <h2>
              {itemName(acting)}
              <span className="item-target-count">のこり {items.get(acting) ?? 0}</span>
            </h2>
            <button type="button" data-pick aria-disabled={!itemUse(acting, 'field')} onClick={() => startUse(acting)}>
              つかう
            </button>
            <button type="button" data-pick onClick={() => startCraft(acting)}>
              つくる
            </button>
            {note ? <p className="menu-note">{note}</p> : null}
            <button type="button" data-pick data-cancel onClick={cancel}>
              やめる
            </button>
          </section>
        </div>
      ) : null}

      {/* 作る物を選ぶ小窓（2026-11-03）。要る材料と持っている数を見せ、そろっていれば作れる。 */}
      {crafting ? (
        <div className="equip-modal-backdrop" onClick={cancel}>
          <section
            ref={craftRef}
            className="equip-chooser item-craft"
            role="dialog"
            aria-modal="true"
            data-layer
            onClick={(event) => event.stopPropagation()}
          >
            <h2>
              {itemName(crafting)}
              <span className="item-target-count">のこり {items.get(crafting) ?? 0}</span>
              <span className="item-target-ask">
                {itemCraftsUsing(crafting).some((id) => itemCanCraft(items, id)) ? 'なにを つくる？' : '材料が たりない'}
              </span>
            </h2>
            <ul className="item-craft-list">
              {itemCraftsUsing(crafting).map((result) => (
                <li key={result}>
                  <button
                    type="button"
                    data-pick
                    data-make={result}
                    className="item-craft-row"
                    disabled={!itemCanCraft(items, result)}
                    onClick={() => make(result)}
                  >
                    <span className="item-craft-name">
                      {itemName(result)}
                      <span className="item-craft-have">（持っている {items.get(result) ?? 0}）</span>
                    </span>
                    <span className="item-craft-needs">
                      {[...itemCraftNeeds(result)].map(([part, count]) => {
                        const have = items.get(part) ?? 0;
                        return (
                          <span key={part} className={have < count ? 'short' : ''}>
                            {itemName(part)} {count}（{have}）
                          </span>
                        );
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {note ? <p className="menu-note">{note}</p> : null}
            <button type="button" data-pick data-cancel onClick={cancel}>
              やめる
            </button>
          </section>
        </div>
      ) : null}

      {note && !asking && !acting && !crafting ? <p className="menu-note">{note}</p> : null}
    </div>
  );
}
