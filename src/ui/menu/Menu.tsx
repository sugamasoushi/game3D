'use client';

// メニュー（GS-54）。ゲーム中に Esc で開く。旧作の `Menu` シーンに当たる。
//
// **左に主人公、上にタブ、下に中身**——旧作と同じ並び。中身のページは
// 1 つずつ別ファイルに置く（`ItemsPage` / `SavePage` / `SettingsPage`）。
// 枠がページの中身を知らないので、タブを 1 つ足すのは `PAGES` に 1 行足すだけで済む。
//
// **キーは capture 段階で止める。** ここで止めないと、開いている間もプレイヤーが歩く
// （会話ウィンドウと同じ手口）。ただし**つまみ（range）に居るときの ←→ は通す**
// ——タブ移動に取られると音量が動かせなくなる。

import { useEffect, useRef, useState } from 'react';
import { characterIcon, characterName } from '../../game/characters';
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('.gmenu-tabs button.on')?.focus();
  }, []);

  useEffect(() => {
    /** いま手が置かれているのがつまみか。←→ を横取りしてよいかの判断に使う。 */
    const onSlider = () => {
      const active = document.activeElement as HTMLInputElement | null;
      return active?.tagName === 'INPUT' && active.type === 'range';
    };

    /** 中身の中で選べる物（`data-pick`）を順に辿る。↑↓ 用。 */
    const step = (delta: number) => {
      const picks = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-pick]:not(:disabled)') ?? [])];
      if (picks.length === 0) return;
      const at = picks.indexOf(document.activeElement as HTMLElement);
      // どこにも居なければ、下キーで先頭・上キーで末尾から入る。
      const next = at < 0 ? (delta > 0 ? 0 : picks.length - 1) : (at + delta + picks.length) % picks.length;
      picks[next].focus();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (onSlider()) return; // つまみに任せる。
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const at = PAGES.indexOf(page);
        setPage(PAGES[(at + delta + PAGES.length) % PAGES.length]);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowDown') step(1);
      else if (event.key === 'ArrowUp') step(-1);
      // 決定。**合成のキーイベントではボタンが押されない**（ゲームパッド。GS-58）ので、
      // 選んでいる物を自分で押す。つまみ（range）は Enter で何も起きなくてよい。
      else if (event.key === 'Enter' || event.key === ' ') {
        const now = document.activeElement as HTMLElement | null;
        if (now && bodyRef.current?.contains(now) && now.tagName === 'BUTTON') now.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [page, onClose]);

  // 見ている人（GS-70）。**隊列が 1 人なら選ばせない**——押せるのに 1 つしか無い列を作らない。
  const hero = party[Math.min(pickAt, Math.max(0, party.length - 1))] ?? '';
  const now = members.get(hero) ?? null;

  return (
    <div className="gmenu-back" onClick={onClose}>
      <div className="gmenu" ref={menuRef} role="dialog" aria-modal="true" aria-label="メニュー" onClick={(event) => event.stopPropagation()}>
        <div className="gmenu-main">
          <button type="button" className="battle-close gmenu-close" onClick={onClose} aria-label="とじる">
            ✖
          </button>
          <nav className="gmenu-tabs">
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
            {page === 'アイテム' ? (
              <ItemsPage
                items={items}
                party={party}
                members={members}
                onUse={(id, who) => {
                  const line = onUseItem(id, who);
                  redraw((now) => now + 1);
                  return line;
                }}
              />
            ) : null}
            {/*
             * 誰を見るか（GS-70）。**中身の側に置く**——枠の外に置くと、
             * ↑↓ で辿れる並び（`data-pick`）から外れてキーで選べなくなる。
             */}
            {party.length > 1 && ['装備', 'スキル', 'ステータス'].includes(page) ? (
              <div className="menu-pick">
                <button type="button" data-pick aria-label="前の仲間" disabled={pickAt <= 0} onClick={() => setPickAt(pickAt - 1)}>▲</button>
                <span>{characterName(hero)}</span>
                <button type="button" data-pick aria-label="次の仲間" disabled={pickAt >= party.length - 1} onClick={() => setPickAt(pickAt + 1)}>▼</button>
                {['ステータス', '装備', 'スキル'].includes(page) && characterIcon(hero) ? <img className="menu-member-icon" src={characterIcon(hero)!} alt="" /> : null}
              </div>
            ) : null}
            {page === 'コンディション' ? <ConditionPage party={party} members={members} gold={gold} /> : null}
            {page === '装備' ? (
              <EquipPage
                who={hero}
                member={now}
                items={items}
                onEquip={(...args) => {
                  const ok = onEquip(...args);
                  redraw((at) => at + 1);
                  return ok;
                }}
                onUnequip={(...args) => {
                  const ok = onUnequip(...args);
                  redraw((at) => at + 1);
                  return ok;
                }}
              />
            ) : null}
            {page === 'スキル' ? <SkillsPage who={hero} member={now} /> : null}
            {page === 'ステータス' ? <StatusPage who={hero} member={now} /> : null}
            {page === 'セーブ' ? <SavePage onSave={onSave} onLoad={onLoad} /> : null}
            {page === '設定' ? <SettingsPage /> : null}
          </div>

          <div className="gmenu-foot">
            {page === 'セーブ' ? <button type="button" onClick={onTitle}>タイトルへ戻る</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
