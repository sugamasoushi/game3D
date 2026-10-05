'use client';

// メニュー（GS-54）。ゲーム中に Esc で開く。旧作の `Menu` シーンに当たる。
//
// **左に主人公、上にタブ、下に中身**——旧作と同じ並び。中身のページは
// 1 つずつ別ファイルに置く（`ItemsPage` / `SavePage` / `SettingsPage`）。
// 枠がページの中身を知らないので、タブを 1 つ足すのは `PAGES` に 1 行足すだけで済む。
//
// **キーは capture 段階で止める。** ここで止めないと、開いている間もプレイヤーが歩く
// （会話ウィンドウと同じ手口）。
//
// **カーソルは 3 段（GS-206）。** タブ → 中身 → 小窓（使い先・武具の選択）。
// 決定で 1 段深く、取り消し（Esc / ✕）で 1 段浅く戻る。タブで取り消すと閉じる。
// ←→ がタブを移るのは**タブに居るときだけ**——中身の中では同じ行の隣へ動く
// （セーブの「書く／読む」、装備の「変更／外す」）。つまみと選ぶ箱は値を動かし、
// 仲間の切り替え（`data-lr`）は人を替える。
// ↑↓ は画面の上の位置で辿る（同じ列の真下へ）。中身の一番上で ↑ を押すとタブへ戻る。
//
// ページが守る約束は 3 つだけ:
//   `data-pick`   カーソルが止まる所。押せないが選べる物は `aria-disabled`（決定しても何も起きない）
//   `data-layer`  小窓。開いている間は中だけを辿り、取り消しで `data-cancel` を押す
//   `data-lr`     ←→ で `data-step="-1" / "1"` の子を押す（仲間の切り替え）

import { useEffect, useRef, useState } from 'react';
import { characterName } from '../../game/characters';
import type { MemberState } from '../../game/state';
import { ItemsPage } from './ItemsPage';
import { EquipPage } from './EquipPage';
import { SkillsPage } from './SkillsPage';
import { StatusPage } from './StatusPage';
import { SavePage } from './SavePage';
import { SettingsPage } from './SettingsPage';
import { ConditionPage } from './ConditionPage';

/**
 * タブの並び。旧作と同じくコンディションから始める。
 * 中身の無いタブは並べない——押せるのに何も起きない場所を作らないため（GS-54）。
 * 「スキル」は**見せるだけ**：いまある技はどれも戦闘中にしか意味がない（GS-67）。
 */
const PAGES = ['コンディション', 'アイテム', '装備', 'スキル', 'ステータス', 'セーブ', '設定'] as const;
type Page = (typeof PAGES)[number];
/** 誰を見るかを選ぶページ（GS-70）。 */
const MEMBER_PAGES: readonly Page[] = ['装備', 'スキル', 'ステータス'];

const PICK = '[data-pick]:not(:disabled)';

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * `from` から `dir` の向きにいちばん近い物（GS-206）。
 * 上下は**まず一番近い行**、その中で横にいちばん近い物——列を保ったまま行を移る。
 * 左右は同じ行の中だけ。見つからなければ null（端で反対へ回り込ませない。GS-72 と同じ考え）。
 */
function nearest(from: HTMLElement, list: HTMLElement[], dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const found: { el: HTMLElement; main: number; cross: number }[] = [];
  for (const el of list) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const sameRow = Math.abs(by - ay) < Math.max(a.height, b.height) / 2;
    if (dir === 'left' || dir === 'right') {
      if (!sameRow) continue;
      const main = dir === 'right' ? bx - ax : ax - bx;
      if (main > 0) found.push({ el, main, cross: 0 });
    } else {
      if (sameRow) continue;
      const main = dir === 'down' ? by - ay : ay - by;
      if (main > 0) found.push({ el, main, cross: Math.abs(bx - ax) });
    }
  }
  if (found.length === 0) return null;
  const row = Math.min(...found.map((entry) => entry.main));
  // 同じ行と見なす幅。行の中で高さが少し違う物（ボタンと文字）を同じ行に数える。
  const inRow = found.filter((entry) => entry.main <= row + 8);
  inRow.sort((p, q) => p.cross - q.cross || p.main - q.main);
  return inRow[0].el;
}

/**
 * つまみ（range）・選ぶ箱（select）の値を動かす（GS-206）。
 * **ゲームパッドの合成イベントは既定動作をしない**（GS-58）ので、キーボードも含めて自分で動かす。
 * React が気づくよう、素の setter で書いてから `input` / `change` を流す。
 */
function nudge(el: HTMLInputElement | HTMLSelectElement, delta: number): void {
  if (el instanceof HTMLSelectElement) {
    const next = el.selectedIndex + delta;
    if (next < 0 || next >= el.options.length) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, el.options[next].value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const step = Number(el.step) || 1;
  const min = el.min === '' ? 0 : Number(el.min);
  const max = el.max === '' ? 100 : Number(el.max);
  const next = Math.min(max, Math.max(min, Number(el.value) + delta * step));
  if (next === Number(el.value)) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(next));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function Menu({
  items,
  party,
  members,
  gold,
  onUseItem,
  onEquip,
  onUnequip,
  onSave,
  onLoad,
  onTitle,
  onClose,
}: {
  /** いま持っている物（GS-46）。数はここ、名前と説明は台帳から。 */
  items: Map<string, number>;
  /** 隊列（GS-60）。**先頭が左の柱に出る人。** */
  party: string[];
  /** 仲間のいまの状態。満タンの値は台帳から引く。 */
  members: Map<string, MemberState>;
  /** 所持金。 */
  gold: number;
  /** 持ち物を使う（GS-64）。返り値は画面に出す一言。 */
  onUseItem(id: string, who: string): string;
  /** 身に着ける・外す（GS-67）。 */
  onEquip(who: string, id: string): boolean;
  onUnequip(who: string, slot: string): boolean;
  onSave(slot: number): Promise<void>;
  onLoad(slot: number): Promise<void>;
  onTitle(): void;
  onClose(): void;
}) {
  const [page, setPage] = useState<Page>('コンディション');
  /** 隊列の何人目を見ているか（GS-70）。 */
  const [pickAt, setPickAt] = useState(0);
  /**
   * 数が動いたら描き直す（GS-64）。**記録は入れ物のまま書き換わる**ので、
   * React は自分では気づかない——持ち物を使ったら左の柱の HP も変わる。
   */
  const [, redraw] = useState(0);
  const tabsRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  // キーの受け口は 1 度だけ付ける。いまの値は ref 越しに読む。
  const pageRef = useRef(page);
  pageRef.current = page;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const focusTab = () => tabsRef.current?.querySelector<HTMLButtonElement>('button.on')?.focus();

  // 開いたときと、タブに居るままタブが替わったときは、開いているタブにカーソルを置く。
  // 中身に居るときは動かさない。開いた瞬間の焦点はゲームの画面（canvas）に居る。
  useEffect(() => {
    const active = document.activeElement;
    if (!active || !(bodyRef.current?.contains(active) || footRef.current?.contains(active))) focusTab();
  }, [page]);

  useEffect(() => {
    /** 開いている小窓。重なっていれば一番上。 */
    const layer = (): HTMLElement | null => {
      const all = bodyRef.current?.querySelectorAll<HTMLElement>('[data-layer]');
      return all && all.length > 0 ? all[all.length - 1] : null;
    };
    /** いまカーソルが辿れる物。小窓が開いていればその中だけ。 */
    const picks = (): HTMLElement[] => {
      const open = layer();
      const roots = open ? [open] : [bodyRef.current, footRef.current];
      return roots.flatMap((root) => [...(root?.querySelectorAll<HTMLElement>(PICK) ?? [])]);
    };
    /** 中身に入る。小窓があればその中の先頭へ。 */
    const enter = () => picks()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement as HTMLElement | null;
      const list = picks();
      const inTabs = Boolean(active && tabsRef.current?.contains(active));
      const inBody = Boolean(active && list.includes(active));
      const key = event.key;

      if (key === 'Escape') {
        // 取り消しは 1 段ずつ戻る: 小窓 → 中身 → タブ → 閉じる。
        const open = layer();
        if (open) open.querySelector<HTMLElement>('[data-cancel]')?.click();
        else if (inBody) focusTab();
        else closeRef.current();
        return;
      }

      // タブ（とカーソルを見失ったとき）。
      if (!inBody) {
        if (layer()) {
          // 小窓が開いているのに外に居る（クリックで外れた等）。中へ戻す。
          if (key !== 'Enter' && key !== ' ') enter();
          return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          if (!inTabs) focusTab();
          const at = PAGES.indexOf(pageRef.current);
          const delta = key === 'ArrowRight' ? 1 : -1;
          setPage(PAGES[(at + delta + PAGES.length) % PAGES.length]);
        } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
          enter();
        } else if (key === 'ArrowUp' && !inTabs) {
          focusTab();
        }
        return;
      }

      // 中身・小窓。
      const now = active!;
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const delta = key === 'ArrowRight' ? 1 : -1;
        if (now instanceof HTMLSelectElement || (now instanceof HTMLInputElement && now.type === 'range')) {
          nudge(now, delta);
        } else if (now.hasAttribute('data-lr')) {
          now.querySelector<HTMLButtonElement>(`[data-step="${delta}"]:not(:disabled)`)?.click();
        } else {
          nearest(now, list, key === 'ArrowRight' ? 'right' : 'left')?.focus();
        }
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        const next = nearest(now, list, key === 'ArrowDown' ? 'down' : 'up');
        if (next) next.focus();
        else if (key === 'ArrowUp' && !layer()) focusTab(); // 一番上からはタブへ戻る。
      } else if (key === 'Enter' || key === ' ') {
        // 決定。**合成のキーイベントではボタンが押されない**（ゲームパッド。GS-58）ので、
        // 選んでいる物を自分で押す。押せない物（`aria-disabled`）は押した扱いをページに任せる。
        if (now.tagName === 'BUTTON' || (now instanceof HTMLInputElement && now.type === 'checkbox')) now.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 見ている人（GS-70）。**隊列が 1 人なら選ばせない**——押せるのに 1 つしか無い列を作らない。
  const at = Math.min(pickAt, Math.max(0, party.length - 1));
  const hero = party[at] ?? '';
  const now = members.get(hero) ?? null;

  return (
    <div className="gmenu-back" onClick={onClose}>
      <div className="gmenu" role="dialog" aria-modal="true" aria-label="メニュー" onClick={(event) => event.stopPropagation()}>
        <div className="gmenu-main">
          <button type="button" className="battle-close gmenu-close" tabIndex={-1} onClick={onClose} aria-label="とじる">
            ✖
          </button>
          <nav className="gmenu-tabs" ref={tabsRef}>
            {PAGES.map((name) => (
              <button
                key={name}
                type="button"
                className={name === page ? 'on' : ''}
                onClick={() => setPage(name)}
              >
                {name}
              </button>
            ))}
          </nav>

          <div className="gmenu-body" ref={bodyRef}>
            {/*
             * 誰を見るか（GS-70）。**中身の側に置く**——枠の外に置くと、
             * ↑↓ で辿れる並び（`data-pick`）から外れてキーで選べなくなる。
             * カーソルを置いて ←→ で人を替える（GS-206）。◀▶ はマウス用。
             */}
            {party.length > 1 && MEMBER_PAGES.includes(page) ? (
              <div className="menu-who" data-pick data-lr tabIndex={0} role="group" aria-label="見る仲間">
                <button type="button" tabIndex={-1} data-step="-1" aria-label="前の仲間" disabled={at <= 0} onClick={() => setPickAt(at - 1)}>◀</button>
                <span className="menu-who-name">{characterName(hero)}</span>
                <span className="menu-who-count">{at + 1} / {party.length}</span>
                <button type="button" tabIndex={-1} data-step="1" aria-label="次の仲間" disabled={at >= party.length - 1} onClick={() => setPickAt(at + 1)}>▶</button>
              </div>
            ) : null}
            {page === 'コンディション' ? <ConditionPage party={party} members={members} gold={gold} /> : null}
            {page === 'アイテム' ? (
              <ItemsPage
                items={items}
                party={party}
                members={members}
                onUse={(id, who) => {
                  const line = onUseItem(id, who);
                  redraw((tick) => tick + 1);
                  return line;
                }}
              />
            ) : null}
            {page === '装備' ? (
              <EquipPage
                key={hero}
                who={hero}
                member={now}
                items={items}
                onEquip={(...args) => {
                  const ok = onEquip(...args);
                  redraw((tick) => tick + 1);
                  return ok;
                }}
                onUnequip={(...args) => {
                  const ok = onUnequip(...args);
                  redraw((tick) => tick + 1);
                  return ok;
                }}
              />
            ) : null}
            {page === 'スキル' ? <SkillsPage who={hero} member={now} /> : null}
            {page === 'ステータス' ? <StatusPage who={hero} member={now} /> : null}
            {page === 'セーブ' ? <SavePage onSave={onSave} onLoad={onLoad} /> : null}
            {page === '設定' ? <SettingsPage /> : null}
          </div>

          <div className="gmenu-foot" ref={footRef}>
            {page === 'セーブ' ? <button type="button" data-pick onClick={onTitle}>タイトルへ戻る</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
