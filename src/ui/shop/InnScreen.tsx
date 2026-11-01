'use client';

// 宿の窓（GS-290）。イベントの `inn` 命令から開き、閉じるまでイベントは待つ。
//
// 見せるのは **値段・所持金・仲間の HP / MP と状態異常**だけ——泊まる前に「いま泊まる意味があるか」が分かればよい。
// 選ぶのは「泊まる」「やめる」の 2 つ（値段 0 のベッドは「休む」）。払ってからの暗転・回復は命令の側（`interpreter.ts`）。
// **お金が足りないときは窓の中で断り、閉じない**（店と同じ。GS-66）。
// 挨拶やお礼は出さない（画面に決め打ちの台詞は書き換えられない。前後の会話か、命令の枝で書く）。
// キーは店の命令と同じ: ←→ で選び Enter で決める。Esc（ゲームパッドの ✕）は「やめる」。

import { useEffect, useState } from 'react';
import { memberStats } from '../../game/battle/party';
import { characterName } from '../../game/characters';
import type { MemberState } from '../../game/state';
import { playUi } from '../../game/audio';
import { AilTags } from '../AilTags';

export function InnScreen({
  price,
  gold: readGold,
  party,
  members,
  onClose,
}: {
  /** 一晩の値段。0 なら無料（家のベッド）。 */
  price: number;
  /** いまの所持金を読む（店と同じく、数ではなく関数）。 */
  gold(): number;
  party: string[];
  members: Map<string, MemberState>;
  /** 閉じる。泊まると決めたら true。 */
  onClose(stay: boolean): void;
}) {
  const free = price <= 0;
  const commands = [free ? '休む' : '泊まる', 'やめる'];
  const [at, setAt] = useState(0);
  const [note, setNote] = useState('');
  const gold = readGold();
  const short = gold < price;

  const choose = (index: number) => {
    if (index !== 0) {
      onClose(false);
      return;
    }
    if (short) {
      setNote('お金が 足りない。');
      playUi('cancel');
      return;
    }
    playUi('decide');
    onClose(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // **窓の間はキーを通さない**（後ろで人が歩かないように。店と同じ）。
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') onClose(false);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        setAt((now) => (now + 1) % 2);
      } else if (event.key === 'Enter' || event.key === ' ') choose(at);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, short, onClose]);

  return (
    <div className="shop inn">
      <div className="shop-box inn-box">
        <div className="shop-head">
          <span className="inn-title">{free ? '休む' : '宿屋'}</span>
          <span className="inn-price">{free ? '無料' : `一晩 ${price.toLocaleString('ja-JP')} G`}</span>
          <span className="shop-gold">
            <span className="shop-gold-label">所持金</span>
            {gold.toLocaleString('ja-JP')} G
          </span>
        </div>

        <ul className="inn-party">
          {party.map((who) => {
            const member = members.get(who);
            const full = memberStats(who, member?.level);
            return (
              <li key={who} className={member && member.hp <= 0 ? 'down' : ''}>
                <span className="shop-name">{characterName(who)}</span>
                <span className="inn-ail">{member && member.ailments.length > 0 ? <AilTags ids={member.ailments} /> : null}</span>
                <span className="inn-num">
                  <small>HP</small> {member?.hp ?? 0} / {full.hp}
                </span>
                <span className="inn-num">
                  <small>MP</small> {member?.mp ?? 0} / {full.mp}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="shop-foot inn-foot">
          <p className="shop-note">{note}</p>
          <nav className="shop-tabs inn-commands">
            {commands.map((name, index) => (
              <button
                key={name}
                type="button"
                tabIndex={-1}
                className={(index === at ? 'on' : '') + (index === 0 && short ? ' short' : '')}
                onMouseEnter={() => setAt(index)}
                onClick={() => choose(index)}
              >
                {name}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
