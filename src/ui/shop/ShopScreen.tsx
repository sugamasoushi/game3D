'use client';

// 店（GS-66）。イベントの `shop` 命令から開き、閉じるまでイベントは待つ。
//
// **値段は台帳**（`data/items.json` の `price`）。店ごとに値段を変えられるようにすると、
// 同じ薬が村ごとに違う値段になり、書く人が全部覚えていることになる。
// 店が決めるのは「何を並べるか」だけ——**値段は物の性質**として 1 か所に置く。
//
// 売値は買値の半分（`itemSellPrice`）。**買い直すと損をする**ぶんが、
// 何を持っておくかを選ぶ重みになる。値段の無い物（鍵や手紙）は並ばないし売れない。
//
// キーはメニュー・戦闘と同じ約束: ↑↓ で選ぶ／←→ でタブ／Enter 決定／Esc で閉じる。

import { useEffect, useMemo, useRef, useState } from 'react';
import { itemName, itemPrice, itemSellPrice, itemText } from '../../game/items';
import { playUi } from '../../game/audio';

/** 並べ方。売らない店では「かう」だけになる。 */
type Tab = 'かう' | 'うる';

export function ShopScreen({
  items,
  gold: readGold,
  goods,
  canSell,
  onBuy,
  onSell,
  onClose,
}: {
  /** いま持っている物（id → 個数）。 */
  items: Map<string, number>;
  /**
   * いまの所持金を読む。**数ではなく関数**——記録は入れ物のまま書き換わるので、
   * 数で受け取ると買った後も古い額を出し続ける（買えない物も押せたままになる）。
   */
  gold(): number;
  /** 店に並ぶ物（`items.json` のキー）。 */
  goods: string[];
  canSell: boolean;
  /** 買う。買えたら true。 */
  onBuy(id: string): boolean;
  /** 売る。売れたら true。 */
  onSell(id: string): boolean;
  onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>('かう');
  const [note, setNote] = useState('いらっしゃい。何にする？');
  // 買うと所持金も持ち物も動く。**記録は入れ物のまま書き換わる**ので描き直しを促す。
  const [tick, setTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const tabs: Tab[] = canSell ? ['かう', 'うる'] : ['かう'];
  // 描き直すたびに読み直す。`tick` が動けばここも新しくなる。
  const gold = readGold();

  /** いま並べる行。 */
  const rows = useMemo(() => {
    if (tab === 'かう') {
      return goods
        .filter((id) => itemPrice(id) > 0)
        .map((id) => ({
          id,
          price: itemPrice(id),
          have: items.get(id) ?? 0,
          // 買えないのは**お金が足りないときだけ**。並べたまま押せなくする。
          disabled: gold < itemPrice(id),
        }));
    }
    return [...items.entries()]
      .filter(([id, count]) => count > 0 && itemSellPrice(id) > 0)
      .map(([id, count]) => ({ id, price: itemSellPrice(id), have: count, disabled: false }));
    // `tick` は「数が動いた」の合図。並びを作り直すために要る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, goods, items, gold, tick]);

  const act = (id: string) => {
    if (tab === 'かう') {
      if (!onBuy(id)) {
        setNote('お金が 足りないよ。');
        return;
      }
      setNote(`${itemName(id)} を 買った。ありがとう！`);
    } else {
      if (!onSell(id)) {
        setNote('それは 買い取れないな。');
        return;
      }
      setNote(`${itemName(id)} を 売った。`);
    }
    playUi('decide');
    setTick((now) => now + 1);
  };

  // タブが変わったら先頭へ。**移さないと**押した場所に焦点が残る。
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [tab]);

  useEffect(() => {
    const step = (delta: number) => {
      const list = [...(bodyRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
      list[next].focus();
    };

    const onKey = (event: KeyboardEvent) => {
      // **店の間はキーを通さない。** 通すと後ろで人が歩く（GS-59 と同じ穴）。
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (tabs.length < 2) return;
        const at = tabs.indexOf(tab);
        setTab(tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]);
        return;
      }
      if (event.key === 'ArrowDown') step(1);
      else if (event.key === 'ArrowUp') step(-1);
      else if (event.key === 'Enter' || event.key === ' ') {
        // **合成のキーイベントではボタンが押されない**（ゲームパッド。GS-58）。
        const now = document.activeElement as HTMLElement | null;
        if (now && bodyRef.current?.contains(now) && now.tagName === 'BUTTON') now.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canSell, onClose]);

  return (
    <div className="shop" data-tick={tick}>
      <div className="shop-box">
        <div className="shop-head">
          <nav className="shop-tabs">
            {tabs.map((name) => (
              <button key={name} type="button" className={name === tab ? 'on' : ''} onClick={() => setTab(name)}>
                {name}
              </button>
            ))}
          </nav>
          <span className="shop-gold">{gold} G</span>
        </div>

        <p className="shop-note">{note}</p>

        <div className="shop-body" ref={bodyRef}>
          {rows.length === 0 ? (
            <p className="menu-empty">{tab === 'かう' ? '今日は 何も 置いてないんだ。' : '売れる物を 持っていない。'}</p>
          ) : (
            <ul className="shop-list">
              {rows.map((row) => (
                <li key={row.id}>
                  <button type="button" disabled={row.disabled} onClick={() => act(row.id)}>
                    <span className="shop-name">{itemName(row.id)}</span>
                    <span className="shop-price">{row.price} G</span>
                    <span className="shop-have">持 {row.have}</span>
                    <span className="shop-text">{itemText(row.id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shop-foot">
          <span className="gmenu-hint">←→ かう／うる　↑↓ 選ぶ　Enter 決定　Esc おわり</span>
          <button type="button" onClick={onClose}>
            おわり（Esc）
          </button>
        </div>
      </div>
    </div>
  );
}
