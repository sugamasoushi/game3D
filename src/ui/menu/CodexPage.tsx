'use client';

// メニュー「図鑑」（2026-11-04）。上に種類のタブ（道具／魔物）、左に台帳の並びの一覧、右にカーソルを置いた物のくわしく。
// 中身の決まり（何を伏せるか・並び・埋まり具合）は `codex.ts`。ここは見せるだけ。
//
//   道具: 手に入れた物は名前・種類・説明・値段・作り方・これを材料にする物。まだの物は「？？？」。
//   魔物: 出会った物は絵・名前・説明。倒したら能力・取り分・倒した数も。まだ出会っていない物は「？？？」。
//
// くわしくはカーソル（焦点）を置いた行の物を出す——↑↓ で辿るだけで読めるように、決定は要らない。
// 一覧は右と別に流す（長くてもくわしくが画面から逃げない）。

import { POWER_KEYS, STAT_NAMES, powerOf } from '../../game/battle/statNames';
import { useState } from 'react';
import { codexFoes, codexItems, codexRate, type CodexFoe, type CodexItem, type FoeRecord } from '../../game/codex';
import { itemBook, itemCraftsUsing, itemName, itemPrice, itemText } from '../../game/items';
import { enemyBook, enemyImage } from '../../game/battle/book';
import type { MemberState } from '../../game/state';

type Kind = '道具' | '魔物';
const KINDS: readonly Kind[] = ['道具', '魔物'];
const UNKNOWN = '？？？';

export function CodexPage({
  found,
  foes,
  members,
}: {
  found: ReadonlySet<string>;
  foes: ReadonlyMap<string, FoeRecord>;
  /** 身に着けている物も手に入れた扱いにする（はじめから着ている物は袋を通らない）。 */
  members: Map<string, MemberState>;
}) {
  const [kind, setKind] = useState<Kind>('道具');
  /** くわしくを出している物の id（種類ごと）。 */
  const [picked, setPicked] = useState<Record<Kind, string>>({ 道具: '', 魔物: '' });

  const equipped = [...members.values()].flatMap((one) => Object.values(one.equip ?? {}));
  const items = codexItems(itemBook(), found, equipped);
  const monsters = codexFoes(enemyBook(), foes);
  const rates: Record<Kind, ReturnType<typeof codexRate>> = {
    道具: codexRate(items.filter((entry) => entry.known).length, items.length),
    魔物: codexRate(monsters.filter((entry) => entry.state !== 'unknown').length, monsters.length),
  };
  const known = new Set(items.filter((entry) => entry.known).map((entry) => entry.id));
  const pick = (id: string) => setPicked((now) => (now[kind] === id ? now : { ...now, [kind]: id }));

  const rows: Array<{ id: string; no: number; label: string; mark?: string }> =
    kind === '道具'
      ? items.map((entry) => ({ id: entry.id, no: entry.no, label: entry.known ? itemName(entry.id) : UNKNOWN }))
      : monsters.map((entry) => ({
          id: entry.id,
          no: entry.no,
          label: entry.state === 'unknown' ? UNKNOWN : enemyBook()[entry.id]?.name ?? entry.id,
          mark: entry.state === 'beaten' ? '倒' : undefined,
        }));
  const at = rows.find((row) => row.id === picked[kind])?.id ?? rows[0]?.id ?? '';

  return (
    <div className="codex-page">
      <div className="quest-kinds" role="tablist" aria-label="図鑑の種類">
        {KINDS.map((one) => (
          <button key={one} type="button" role="tab" data-pick aria-selected={one === kind} className={one === kind ? 'on' : ''} onClick={() => setKind(one)}>
            {one}
            <small>
              {rates[one].known} / {rates[one].all}
            </small>
          </button>
        ))}
        <span className="codex-rate">埋まり具合 {rates[kind].rate}%</span>
      </div>

      {rows.length === 0 ? (
        <p className="menu-empty">まだ なにも 載っていない</p>
      ) : (
        <div className="codex-columns">
          <ul className="codex-list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-pick
                  className={`codex-row${row.id === at ? ' on' : ''}${row.label === UNKNOWN ? ' unknown' : ''}`}
                  onFocus={() => pick(row.id)}
                  onClick={() => pick(row.id)}
                >
                  <span className="codex-no">{String(row.no).padStart(3, '0')}</span>
                  <span className="codex-name">{row.label}</span>
                  {row.mark ? <span className="codex-mark" aria-label="倒した">{row.mark}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <section className="codex-detail" aria-live="polite">
            {kind === '道具' ? (
              <ItemDetail entry={items.find((entry) => entry.id === at)} known={known} />
            ) : (
              <FoeDetail entry={monsters.find((entry) => entry.id === at)} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ItemDetail({ entry, known }: { entry?: CodexItem; known: ReadonlySet<string> }) {
  if (!entry) return null;
  if (!entry.known) {
    return (
      <>
        <h3>{UNKNOWN}</h3>
        <p className="codex-hint">まだ 手に入れていない</p>
      </>
    );
  }
  const price = itemPrice(entry.id);
  const name = (id: string) => (known.has(id) ? itemName(id) : UNKNOWN);
  const uses = itemCraftsUsing(entry.id);
  return (
    <>
      <h3>
        {itemName(entry.id)}
        <small>{entry.kind}</small>
      </h3>
      {itemText(entry.id) ? <p>{itemText(entry.id)}</p> : null}
      <dl className="codex-facts">
        {price > 0 ? (
          <>
            <dt>値段</dt>
            <dd>{price.toLocaleString('ja-JP')} G</dd>
          </>
        ) : null}
        {entry.parts.length ? (
          <>
            <dt>作り方</dt>
            <dd>{entry.parts.map((part) => `${part.known ? itemName(part.id) : UNKNOWN} ${part.count}`).join('・')}</dd>
          </>
        ) : null}
        {uses.length ? (
          <>
            <dt>材料になる</dt>
            <dd>{uses.map(name).join('・')}</dd>
          </>
        ) : null}
      </dl>
    </>
  );
}

function FoeDetail({ entry }: { entry?: CodexFoe }) {
  if (!entry) return null;
  if (entry.state === 'unknown') {
    return (
      <>
        <h3>{UNKNOWN}</h3>
        <p className="codex-hint">まだ 出会っていない</p>
      </>
    );
  }
  const def = enemyBook()[entry.id];
  const image = enemyImage(entry.id);
  return (
    <div className="codex-foe">
      <div className="codex-foe-text">
        <h3>{def?.name ?? entry.id}</h3>
        {def?.text ? <p>{def.text}</p> : null}
        {entry.state === 'beaten' && def ? (
          <dl className="codex-facts codex-stats">
            <dt>Lv</dt>
            <dd>{def.level}</dd>
            <dt>HP</dt>
            <dd>{def.hp}</dd>
            <dt>MP</dt>
            <dd>{def.mp}</dd>
            {/* 物理攻撃力〜素早さ（呼び名は `statNames.ts`。2026-11-07）。 */}
            {POWER_KEYS.map((key) => [<dt key={`${key}-name`}>{STAT_NAMES[key]}</dt>, <dd key={`${key}-value`}>{powerOf(def, key)}</dd>])}
            <dt>経験</dt>
            <dd>{def.exp ?? 0}</dd>
            <dt>お金</dt>
            <dd>{def.gold ?? 0} G</dd>
            <dt>倒した数</dt>
            <dd>{entry.beaten}</dd>
          </dl>
        ) : (
          <p className="codex-hint">倒すと くわしく 分かる</p>
        )}
      </div>
      {image ? <img className="codex-foe-image" src={image} alt="" /> : null}
    </div>
  );
}
