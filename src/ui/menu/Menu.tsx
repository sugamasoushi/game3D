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
import { PLAYER_CHARACTER, characterMenuImage, characterName } from '../../game/characters';
import { memberStats } from '../../game/battle/party';
import { levelUpRule } from '../../game/battle/book';
import { expToNext } from '../../game/battle/growth';
import type { MemberState } from '../../game/state';
import { playTimeLabel } from '../../game/save';
import { AilTags } from '../AilTags';
import { ItemsPage } from './ItemsPage';
import { EquipPage } from './EquipPage';
import { SkillsPage } from './SkillsPage';
import { StatusPage } from './StatusPage';
import { SavePage } from './SavePage';
import { SettingsPage } from './SettingsPage';

/**
 * タブの並び。**旧作とほぼ同じ**（コンディションだけまだ無い）。
 * 中身の無いタブは並べない——押せるのに何も起きない場所を作らないため（GS-54）。
 * 「スキル」は**見せるだけ**：いまある技はどれも戦闘中にしか意味がない（GS-67）。
 */
const PAGES = ['アイテム', 'そうび', 'スキル', 'ステータス', 'セーブ', '設定'] as const;
type Page = (typeof PAGES)[number];

export function Menu({
  items,
  map,
  playSeconds,
  party,
  members,
  gold,
  onUseItem,
  onEquip,
  onUnequip,
  onMove,
  onSave,
  onLoad,
  onTitle,
  onClose,
}: {
  /** いま持っている物（GS-46）。数はここ、名前と説明は台帳から。 */
  items: Map<string, number>;
  /** いま居るマップ（拡張子なし）。 */
  map: string;
  /** 遊んだ秒。 */
  playSeconds: number;
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
  /** 隊列の並べ替え（GS-72）。`delta` は -1 で前、+1 で後ろ。 */
  onMove(who: string, delta: number): boolean;
  onSave(slot: number): Promise<void>;
  onLoad(slot: number): Promise<void>;
  onTitle(): void;
  onClose(): void;
}) {
  const [page, setPage] = useState<Page>('アイテム');
  /** 隊列の何人目を見ているか（GS-70）。 */
  const [pickAt, setPickAt] = useState(0);
  /**
   * 数が動いたら描き直す（GS-64）。**記録は入れ物のまま書き換わる**ので、
   * React は自分では気づかない——持ち物を使ったら左の柱の HP も変わる。
   */
  const [, redraw] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

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
  const hero = party[Math.min(pickAt, Math.max(0, party.length - 1))] ?? PLAYER_CHARACTER;
  const image = characterMenuImage(hero);
  const now = members.get(hero) ?? null;
  const full = memberStats(hero, now?.level);
  // 次のレベルまで（GS-63）。上限に届いていれば 0 で、その行は出さない。
  const toNext = now ? expToNext(now.exp, now.level, levelUpRule()) : 0;

  return (
    <div className="gmenu-back" onClick={onClose}>
      <div className="gmenu" onClick={(event) => event.stopPropagation()}>
        {/*
         * 左の柱（旧作の CharacterStatusWindow）。**いま分かっている事だけ**を出す。
         * HP・MP・レベルは戦闘の台帳（GS-60）から。まだ記録に仲間が無い古いセーブでは
         * `now` が null になるので、そのときは数値の行ごと出さない——
         * 「HP 0」と出ると死んでいるように見える。
         */}
        <aside className="gmenu-who">
          {image ? <img className="gmenu-face" src={image} alt="" /> : null}
          <p className="gmenu-name">
            {characterName(hero)}
            {/* かかっている状態異常（GS-71）。毒のまま歩いていることが分かるように。 */}
            <AilTags ids={now?.ailments ?? []} />
          </p>
          {now ? (
            <dl className="gmenu-facts">
              <dt>Lv</dt>
              <dd>{now.level}</dd>
              <dt>HP</dt>
              <dd>
                {now.hp} / {full.hp}
              </dd>
              <dt>MP</dt>
              <dd>
                {now.mp} / {full.mp}
              </dd>
              <dt>つぎまで</dt>
              <dd>{toNext > 0 ? `${toNext}` : '—'}</dd>
              <dt>おかね</dt>
              <dd>{gold} G</dd>
            </dl>
          ) : null}
          {/*
           * 隊列（GS-70）。**2 人以上のときだけ**出す（旧作の「コンディション」に当たる）。
           * 1 人なら上の数字と同じことしか言わないので、置くだけ場所を取る。
           */}
          {party.length > 1 ? (
            <ul className="gmenu-party">
              {party.map((one) => {
                const state = members.get(one);
                const max = memberStats(one, state?.level);
                return (
                  <li key={one} className={one === hero ? 'on' : ''}>
                    <span className="gmenu-party-name">
                      {characterName(one)}
                      <AilTags ids={state?.ailments ?? []} />
                    </span>
                    <span className="gmenu-party-num">
                      {state ? `${state.hp}/${max.hp}` : '—'}
                    </span>
                    <span className="gmenu-party-num">{state ? `${state.mp}/${max.mp}` : '—'}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <dl className="gmenu-facts">
            <dt>ばしょ</dt>
            <dd>{map || '—'}</dd>
            <dt>あそんだ時間</dt>
            <dd>{playTimeLabel(playSeconds)}</dd>
          </dl>
        </aside>

        <div className="gmenu-main">
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
            {party.length > 1 && page !== 'アイテム' && page !== 'セーブ' && page !== '設定' ? (
              <div className="menu-pick">
                {party.map((one, at) => (
                  <button
                    key={one}
                    type="button"
                    data-pick
                    className={one === hero ? 'on' : ''}
                    onClick={() => setPickAt(at)}
                  >
                    {characterName(one)}
                  </button>
                ))}
                {/*
                 * 並べ替え（GS-72）。**選んでいる人を動かす**——一覧の行ごとに
                 * ↑↓ を置くと、押す物が人数ぶん増えて ↑↓ で辿るのが長くなる。
                 */}
                <span className="menu-pick-gap" />
                {[-1, 1].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    data-pick
                    disabled={delta < 0 ? pickAt <= 0 : pickAt >= party.length - 1}
                    onClick={() => {
                      if (!onMove(hero, delta)) return;
                      // **選んだ人を追いかける**（その場に留まると別の人を動かし続けることになる）。
                      setPickAt(pickAt + delta);
                      redraw((at) => at + 1);
                    }}
                  >
                    {delta < 0 ? '前へ' : '後ろへ'}
                  </button>
                ))}
              </div>
            ) : null}
            {page === 'そうび' ? (
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
            {page === 'ステータス' ? <StatusPage who={hero} member={now} gold={gold} /> : null}
            {page === 'セーブ' ? <SavePage onSave={onSave} onLoad={onLoad} /> : null}
            {page === '設定' ? <SettingsPage /> : null}
          </div>

          <div className="gmenu-foot">
            <span className="gmenu-hint">←→ タブ／↑↓ 選ぶ／Enter 決定／Esc とじる</span>
            <button type="button" onClick={onTitle}>
              タイトルへ
            </button>
            <button type="button" onClick={onClose}>
              とじる（Esc）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
