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
// **開いたときはタブを選ばずにコンディション（仲間のカード）を見せる（2026-11-04）。** コンディションはタブではなく
// メニューの「最初の画面」。カーソルはタブの列に居るが、どのタブも開いていない。←→ でタブを選び、決定（↓）で開いて中身へ入る。
//
// **取り消しは「小窓 → 最初の画面 → 閉じる」（2026-11-04）。** タブを開いていれば、中身に居てもタブに居ても
// 1 回の取り消しで最初の画面へ戻り、もう 1 回で閉じる。✕ はいつでもすぐ閉じる。
// タブを開いている間の ←→ は今までどおり：タブに居ればタブを移り、中身の中では同じ行の隣へ動く
// （セーブの「書く／読む」、装備の「変更／外す」）。つまみと選ぶ箱は値を動かし、仲間の切り替え（`data-lr`）は人を替える。
// ↑↓ は画面の上の位置で辿る（同じ列の真下へ）。中身の一番上で ↑ を押すとタブへ戻る。
//
// ページが守る約束は 3 つだけ:
//   `data-pick`   カーソルが止まる所。押せないが選べる物は `aria-disabled`（決定しても何も起きない）
//   `data-layer`  小窓。開いている間は中だけを辿り、取り消しで `data-cancel` を押す
//   `data-lr`     ←→ で `data-step="-1" / "1"` の子を押す（仲間の切り替え）

import { useEffect, useRef, useState } from 'react';
import { characterName } from '../../game/characters';
import type { MemberState } from '../../game/state';
import type { QuestProgress } from '../../game/quests';
import { QuestsPage } from './QuestsPage';
import { ItemsPage } from './ItemsPage';
import { EquipPage } from './EquipPage';
import { SkillsPage } from './SkillsPage';
import { StatusPage } from './StatusPage';
import { SavePage } from './SavePage';
import { SettingsPage } from './SettingsPage';
import { ConditionPage } from './ConditionPage';
import { CodexPage } from './CodexPage';
import { RacePage } from './RacePage';
import { TacticsPage } from './TacticsPage';
import type { Tactic } from '../../game/partyTactics';
import type { FoeRecord } from '../../game/codex';
import { PICK, nearest, nudge } from './menuNav';

/**
 * タブの並び（2026-11-04）。コンディションはタブにせず、開いたときの最初の画面にした。
 * 装備・スキル・ステータスは「仲間」にまとめ、中の種類のタブで分ける（クエストと同じ形）。
 * 中身の無いタブは並べない——押せるのに何も起きない場所を作らないため（GS-54）。
 * 「作戦」（2026-11-07）はフィールドの作戦の切り替えと、コマンド戦闘の隊列（見せるだけ）。
 */
const PAGES = ['アイテム', '仲間', '作戦', 'クエスト', '図鑑', 'セーブ', '設定'] as const;
type Page = (typeof PAGES)[number];
/**
 * 「仲間」の中の種類（2026-11-04）。「スキル」は**見せるだけ**：いまある技はどれも戦闘中にしか意味がない（GS-67）。
 * 「種族特性」（2026-11-07）はステータスの右に出していた種族と特性を移した物。
 */
const MEMBER_KINDS = ['装備', 'スキル', 'ステータス', '種族特性'] as const;
type MemberKind = (typeof MEMBER_KINDS)[number];

export function Menu({
  story,
  substories,
  quests,
  questExp,
  items,
  found,
  foes,
  party,
  members,
  gold,
  playSeconds,
  place,
  tactic,
  onTactic,
  onUseItem,
  onCraftItem,
  onEquip,
  onUnequip,
  onSave,
  onLoad,
  onTitle,
  onClose,
}: {
  /** クエスト（2026-11-02）。本筋の最後に済ませた段階・サブストーリーの段階・討伐依頼の進捗。 */
  story: string;
  substories: Map<string, string>;
  quests: Map<string, QuestProgress>;
  /** 依頼経験値（2026-11-02）。クエストの「依頼」に依頼レベルを出す。 */
  questExp: number;
  /** いま持っている物（GS-46）。数はここ、名前と説明は台帳から。 */
  items: Map<string, number>;
  /** 図鑑（2026-11-04）。手に入れたことのある持ち物と、魔物の記録。 */
  found: ReadonlySet<string>;
  foes: ReadonlyMap<string, FoeRecord>;
  /** 隊列（GS-60）。**先頭が左の柱に出る人。** */
  party: string[];
  /** 仲間のいまの状態。満タンの値は台帳から引く。 */
  members: Map<string, MemberState>;
  /** 所持金。 */
  gold: number;
  /** 遊んだ秒（コンディションに出す）。 */
  playSeconds: number;
  /** いまいるマップの名前（コンディションの「現在地」）。 */
  place: string;
  /** 仲間の作戦（2026-11-07。「作戦」で見せて切り替える）。 */
  tactic: Tactic;
  onTactic(next: Tactic): void;
  /** 持ち物を使う（GS-64）。返り値は画面に出す一言。 */
  onUseItem(id: string, who: string): string;
  /** 道具から道具を作る（2026-11-03）。返り値は画面に出す一言。 */
  onCraftItem(id: string): string;
  /** 身に着ける・外す（GS-67）。 */
  onEquip(who: string, id: string): boolean;
  onUnequip(who: string, slot: string): boolean;
  onSave(slot: number): Promise<void>;
  onLoad(slot: number): Promise<void>;
  onTitle(): void;
  onClose(): void;
}) {
  /** 開いているタブ。null は最初の画面（コンディション）。 */
  const [page, setPage] = useState<Page | null>(null);
  /** 最初の画面でカーソルを置くタブ（最後に開いていたタブ）。 */
  const [homeTab, setHomeTab] = useState<Page>(PAGES[0]);
  /** 「仲間」の中の種類。 */
  const [memberKind, setMemberKind] = useState<MemberKind>('装備');
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
  /** 最初の画面で決定してタブを開いたら、描いた後で中身へ入る。 */
  const enterNext = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /** タブの列へカーソルを置く。開いているタブ、最初の画面なら最後に開いていたタブ。 */
  const focusTab = () =>
    (tabsRef.current?.querySelector<HTMLButtonElement>('button.on') ?? tabsRef.current?.querySelector<HTMLButtonElement>('button.home'))?.focus();

  /** タブを開く。最初の画面へ戻ったときにカーソルを置く所も覚える。 */
  const openPage = (name: Page) => {
    setHomeTab(name);
    setPage(name);
  };

  // 開いたときと、タブに居るままタブが替わったときは、タブの列にカーソルを置く。
  // 中身に居るときは動かさない。開いた瞬間の焦点はゲームの画面（canvas）に居る。
  // 最初の画面から決定で開いたときは、描いた後で中身の先頭へ入る。
  useEffect(() => {
    if (enterNext.current) {
      enterNext.current = false;
      const first = [bodyRef.current, footRef.current].flatMap((root) => [...(root?.querySelectorAll<HTMLElement>(PICK) ?? [])])[0];
      if (first) {
        first.focus();
        return;
      }
    }
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
        // 取り消し: 小窓 → 最初の画面 → 閉じる（2026-11-04）。中身に居てもタブに居ても 1 回で最初の画面へ。
        const open = layer();
        if (open) open.querySelector<HTMLElement>('[data-cancel]')?.click();
        // 開いていたタブにカーソルを残すのは、タブが替わったときの描き直し（上の useEffect）が `home` の印で探してする。
        // ここで 1 こま待って置くと、その間に決定でタブを開いたときにカーソルをタブへ引き戻してしまう。
        else if (pageRef.current) setPage(null);
        else closeRef.current();
        return;
      }

      // 最初の画面（2026-11-04）。←→ はタブの上でカーソルを動かすだけ、決定（↓）で開いて中身へ入る。
      if (!pageRef.current) {
        const tabs = [...(tabsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const at = Math.max(0, tabs.indexOf(active as HTMLButtonElement));
        if (!inTabs) {
          focusTab();
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
          const next = (at + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next]?.focus();
          setHomeTab(PAGES[next]);
        } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
          enterNext.current = true;
          openPage(PAGES[at]);
        }
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
          openPage(PAGES[(at + delta + PAGES.length) % PAGES.length]);
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
  /** 「仲間」で見ている種類。ほかのタブでは null。 */
  const memberPage = page === '仲間' ? memberKind : null;
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
                className={name === page ? 'on' : !page && name === homeTab ? 'home' : ''}
                onClick={() => openPage(name)}
              >
                {name}
              </button>
            ))}
          </nav>

          <div className="gmenu-body" ref={bodyRef}>
            {/* 最初の画面（2026-11-04）。タブを選んでいない間は仲間のカードを見せる。 */}
            {!page ? <ConditionPage party={party} members={members} gold={gold} playSeconds={playSeconds} place={place} /> : null}
            {/* 「仲間」の種類（2026-11-04）。中身の先頭の行（←→ で隣へ、決定で切り替え）。クエストの種類と同じ形。 */}
            {page === '仲間' ? (
              <div className="quest-kinds" role="tablist" aria-label="仲間の見るもの">
                {MEMBER_KINDS.map((one) => (
                  <button key={one} type="button" role="tab" data-pick aria-selected={one === memberKind} className={one === memberKind ? 'on' : ''} onClick={() => setMemberKind(one)}>
                    {one}
                  </button>
                ))}
              </div>
            ) : null}
            {/*
             * 誰を見るか（GS-70）。**中身の側に置く**——枠の外に置くと、
             * ↑↓ で辿れる並び（`data-pick`）から外れてキーで選べなくなる。
             * カーソルを置いて ←→ で人を替える（GS-206）。◀▶ はマウス用。
             */}
            {party.length > 1 && memberPage ? (
              <div className="menu-who" data-pick data-lr tabIndex={0} role="group" aria-label="見る仲間">
                <button type="button" tabIndex={-1} data-step="-1" aria-label="前の仲間" disabled={at <= 0} onClick={() => setPickAt(at - 1)}>◀</button>
                <span className="menu-who-name">{characterName(hero)}</span>
                <span className="menu-who-count">{at + 1} / {party.length}</span>
                <button type="button" tabIndex={-1} data-step="1" aria-label="次の仲間" disabled={at >= party.length - 1} onClick={() => setPickAt(at + 1)}>▶</button>
              </div>
            ) : null}
            {page === 'クエスト' ? <QuestsPage story={story} substories={substories} quests={quests} questExp={questExp} items={items} /> : null}
            {page === 'アイテム' ? (
              <ItemsPage
                items={items}
                found={found}
                party={party}
                members={members}
                onUse={(id, who) => {
                  const line = onUseItem(id, who);
                  redraw((tick) => tick + 1);
                  return line;
                }}
                onCraft={(id) => {
                  const line = onCraftItem(id);
                  redraw((tick) => tick + 1);
                  return line;
                }}
              />
            ) : null}
            {memberPage === '装備' ? (
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
            {memberPage === 'スキル' ? <SkillsPage who={hero} member={now} /> : null}
            {memberPage === 'ステータス' ? <StatusPage who={hero} member={now} /> : null}
            {memberPage === '種族特性' ? <RacePage who={hero} member={now} /> : null}
            {page === '作戦' ? <TacticsPage tactic={tactic} onTactic={onTactic} party={party} members={members} /> : null}
            {page === '図鑑' ? <CodexPage found={found} foes={foes} members={members} /> : null}
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
