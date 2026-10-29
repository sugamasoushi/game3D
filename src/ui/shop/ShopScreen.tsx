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
// **はじめは「買う」「売る」「店を出る」だけを選ぶ**（2026-10-29）。買う・売るを決めると一覧へ進み、
// Esc（ゲームパッドの ✕）で一覧から戻る。戻った所で Esc か「店を出る」で閉じる。
// キー: 命令は ←→ で選び、Enter か ↓（買う・売るの上）で一覧へ。一覧は ↑↓ で選び Enter で決める。Esc で戻る。
//
// **枠の大きさは中身で変えない**（2026-10-29）。買う・売るを切り替えるたびに枠が伸び縮みすると、
// 目で追う場所が毎回動く。一覧は決まった行数ぶんの高さを取り、説明と一言も決まった場所に出す。
// 選んでいる命令と行は**番号で持ち、▶ と枠で見せる**（GS-77 と同じ。焦点だとゲームパッドで見えない）。
// 買えない物も選べる——説明は読めて、押すと「足りない」と言う。
// 開いたときの挨拶は出さない（画面に決め打ちの台詞は書き換えられない。挨拶は前の会話でする）。

import { useEffect, useMemo, useRef, useState } from 'react';
import { itemName, itemPrice, itemSellPrice, itemText } from '../../game/items';
import { playUi } from '../../game/audio';

/** 並べ方。売らない店では「買う」だけになる。 */
type Tab = '買う' | '売る';
/** はじめに選ぶ命令。 */
type Command = Tab | '店を出る';

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
  const commands: Command[] = canSell ? ['買う', '売る', '店を出る'] : ['買う', '店を出る'];
  /** `command` は命令を選んでいるところ、`list` は品物を選んでいるところ。 */
  const [mode, setMode] = useState<'command' | 'list'>('command');
  /** 選んでいる命令の番号。 */
  const [cmd, setCmd] = useState(0);
  /** 一覧に出している並べ方。命令で「店を出る」を選んでいるあいだは、直前の並べ方を出しておく。 */
  const [tab, setTab] = useState<Tab>('買う');
  /** 買った・売ったの一言。開いたときは空（挨拶は出さない）。 */
  const [note, setNote] = useState('');
  /** 選んでいる行の番号。 */
  const [at, setAt] = useState(0);
  // 買うと所持金も持ち物も動く。**記録は入れ物のまま書き換わる**ので描き直しを促す。
  const [tick, setTick] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // 描き直すたびに読み直す。`tick` が動けばここも新しくなる。
  const gold = readGold();

  /** いま並べる行。 */
  const rows = useMemo(() => {
    if (tab === '買う') {
      return goods
        .filter((id) => itemPrice(id) > 0)
        .map((id) => ({
          id,
          price: itemPrice(id),
          have: items.get(id) ?? 0,
          // 買えないのは**お金が足りないときだけ**。並べたまま沈めて出す。
          short: gold < itemPrice(id),
        }));
    }
    return [...items.entries()]
      .filter(([id, count]) => count > 0 && itemSellPrice(id) > 0)
      .map(([id, count]) => ({ id, price: itemSellPrice(id), have: count, short: false }));
    // `tick` は「数が動いた」の合図。並びを作り直すために要る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, goods, items, gold, tick]);

  const listing = mode === 'list';
  // 売って行が減ったら、はみ出した番号を最後の行へ戻す。
  const pick = !listing || rows.length === 0 ? -1 : Math.min(at, rows.length - 1);
  const picked = pick >= 0 ? rows[pick] : null;

  /** 命令にカーソルを置く。買う・売るなら、その一覧を先に見せておく。 */
  const hover = (index: number) => {
    setCmd(index);
    const name = commands[index];
    if (name !== '店を出る') setTab(name);
  };

  /** 命令を決める。 */
  const choose = (index: number) => {
    const name = commands[index];
    if (!name) return;
    if (name === '店を出る') {
      onClose();
      return;
    }
    playUi('decide');
    setCmd(index);
    setTab(name);
    setAt(0);
    setNote('');
    setMode('list');
  };

  /** 一覧から命令へ戻る。 */
  const back = () => {
    playUi('cancel');
    setMode('command');
  };

  const act = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setAt(index);
    if (tab === '買う') {
      if (!onBuy(row.id)) {
        setNote('お金が 足りない。');
        playUi('cancel');
        return;
      }
      setNote(`${itemName(row.id)} を 買った。`);
    } else {
      if (!onSell(row.id)) {
        setNote('それは 売れない。');
        playUi('cancel');
        return;
      }
      setNote(`${itemName(row.id)} を 売った。`);
    }
    playUi('decide');
    setTick((now) => now + 1);
  };

  // 選んでいる行が見えるところまで一覧を送る（行が多い店）。
  useEffect(() => {
    if (pick >= 0) listRef.current?.children[pick]?.scrollIntoView({ block: 'nearest' });
    else if (listRef.current) listRef.current.parentElement?.scrollTo({ top: 0 });
  }, [pick, tab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // **店の間はキーを通さない。** 通すと後ろで人が歩く（GS-59 と同じ穴）。
      event.preventDefault();
      event.stopPropagation();
      const enter = event.key === 'Enter' || event.key === ' ';
      if (mode === 'command') {
        // 命令は横に並ぶので ←→ で動く（↑↓ では動かさない）。
        if (event.key === 'Escape') onClose();
        else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          hover((cmd + (event.key === 'ArrowRight' ? 1 : -1) + commands.length) % commands.length);
        }
        // 買う・売るの上で ↓ を押すと、下の一覧へ降りる（決めたのと同じ）。「店を出る」の上では何もしない。
        else if (event.key === 'ArrowDown') {
          if (commands[cmd] !== '店を出る') choose(cmd);
        }
        // **合成のキーイベントでも効くよう、ボタンは押さずに直に決める**（ゲームパッド。GS-58）。
        else if (enter) choose(cmd);
        return;
      }
      if (event.key === 'Escape') {
        back();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (rows.length === 0) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setAt((pick + delta + rows.length) % rows.length);
        return;
      }
      if (enter) act(pick);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cmd, tab, canSell, onClose, rows, pick]);

  return (
    <div className="shop" data-tick={tick}>
      <div className={'shop-box' + (listing ? ' listing' : '')}>
        <div className="shop-head">
          <nav className="shop-tabs">
            {commands.map((name, index) => (
              <button
                key={name}
                type="button"
                tabIndex={-1}
                className={index === cmd ? 'on' : ''}
                onMouseEnter={() => {
                  if (!listing) hover(index);
                }}
                onClick={() => choose(index)}
              >
                {name}
              </button>
            ))}
          </nav>
          <span className="shop-gold">
            <span className="shop-gold-label">所持金</span>
            {gold.toLocaleString('ja-JP')} G
          </span>
        </div>

        <div className="shop-columns" aria-hidden="true">
          <span className="shop-name">品物</span>
          <span className="shop-price">{tab === '買う' ? '値段' : '売値'}</span>
          <span className="shop-have">所持</span>
        </div>

        <div className="shop-body">
          {rows.length === 0 ? (
            <p className="shop-empty">{tab === '買う' ? '並んでいる品物が ない。' : '売れる物を 持っていない。'}</p>
          ) : (
            <ul className="shop-list" ref={listRef}>
              {rows.map((row, index) => (
                <li key={row.id}>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={!listing}
                    className={(index === pick ? 'on' : '') + (row.short ? ' short' : '')}
                    onMouseEnter={() => setAt(index)}
                    onClick={() => act(index)}
                  >
                    <span className="shop-name">{itemName(row.id)}</span>
                    <span className="shop-price">{row.price.toLocaleString('ja-JP')} G</span>
                    <span className="shop-have">{row.have}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="shop-text">{picked ? itemText(picked.id) : ''}</p>

        <div className="shop-foot">
          <p className="shop-note">{note}</p>
          {/* 一覧から戻る。キーは Esc（ゲームパッドは ✕）。マウス・タッチのために押せる形でも置く。 */}
          {listing ? (
            <button type="button" tabIndex={-1} onClick={back}>
              もどる
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
