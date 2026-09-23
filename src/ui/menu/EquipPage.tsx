'use client';

// そうび（GS-67）。**袋と置き場所のあいだで物を動かすだけ。**
//
// 身に着けた物は袋から出る（`equipItem`）。両方に置くと「装備している剣を売る」が
// できてしまい、店とメニューのどちらが正しいのか分からなくなる。
//
// **増えるのは攻撃・守り・速さだけ**（GS-67）。満タンの HP を装備で変えると、
// 外した瞬間に「いまの HP が満タンを超える」始末を毎回することになる。

import { useState } from 'react';
import { itemEquip, itemName, itemText } from '../../game/items';
import { equipBonus, memberStats } from '../../game/battle/party';
import type { MemberState } from '../../game/state';

/**
 * 置き場所の呼び名。**台帳（`items.json` の `slot`）が正**で、ここは見せ方だけ。
 * 知らない置き場所はそのまま出す——増やしたときに黙って消えないように。
 */
const SLOT_LABEL: Record<string, string> = { weapon: 'ぶき', armor: 'よろい' };
/** 並べる順。ここに無い置き場所は後ろにまとめる。 */
const SLOT_ORDER = ['weapon', 'armor'];

export function EquipPage({
  who,
  member,
  items,
  onEquip,
  onUnequip,
}: {
  /** 着せる人。いまは隊列の先頭だけ（仲間が増えたら選ぶ段を足す）。 */
  who: string;
  member: MemberState | null;
  items: Map<string, number>;
  onEquip(who: string, id: string): boolean;
  onUnequip(who: string, slot: string): boolean;
}) {
  // 着け外しで袋も数も動く。**記録は入れ物のまま書き換わる**ので描き直しを促す。
  const [tick, setTick] = useState(0);

  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;

  /** 袋にある、その置き場所の物。 */
  const owned = (slot: string) =>
    [...items.entries()].filter(([id, count]) => count > 0 && itemEquip(id)?.slot === slot);

  // 台帳と、いま着けている物から置き場所を集める（`weapon` / `armor` 以外も拾う）。
  const slots = [...new Set([...SLOT_ORDER, ...Object.keys(member.equip)])];

  const base = memberStats(who, member.level);
  const gear = equipBonus(member.equip);

  return (
    <div className="equip" data-tick={tick}>
      {/* いまの合計。**着け替えたその場で変わる**ので、選ぶ手がかりになる。 */}
      <dl className="equip-sum">
        <dt>こうげき</dt>
        <dd>
          {base.attack + gear.attack}
          {gear.attack ? <span className="equip-plus">（{gear.attack > 0 ? '+' : ''}{gear.attack}）</span> : null}
        </dd>
        <dt>まもり</dt>
        <dd>
          {base.guard + gear.guard}
          {gear.guard ? <span className="equip-plus">（{gear.guard > 0 ? '+' : ''}{gear.guard}）</span> : null}
        </dd>
        <dt>すばやさ</dt>
        <dd>
          {Math.max(1, base.speed + gear.speed)}
          {gear.speed ? <span className="equip-plus">（{gear.speed > 0 ? '+' : ''}{gear.speed}）</span> : null}
        </dd>
      </dl>

      {slots.map((slot) => {
        const now = member.equip[slot];
        const list = owned(slot);
        return (
          <div key={slot} className="equip-slot">
            <p className="equip-head">
              <span className="equip-kind">{SLOT_LABEL[slot] ?? slot}</span>
              <span className="equip-now">{now ? itemName(now) : '—'}</span>
              {now ? (
                <button
                  type="button"
                  data-pick
                  onClick={() => {
                    onUnequip(who, slot);
                    setTick(tick + 1);
                  }}
                >
                  はずす
                </button>
              ) : null}
            </p>
            {list.length === 0 ? (
              <p className="equip-none">持っていない</p>
            ) : (
              <ul className="equip-list">
                {list.map(([id, count]) => (
                  <li key={id}>
                    <button
                      type="button"
                      data-pick
                      onClick={() => {
                        onEquip(who, id);
                        setTick(tick + 1);
                      }}
                    >
                      <span className="equip-name">{itemName(id)}</span>
                      <span className="equip-count">{count > 1 ? `×${count}` : ''}</span>
                      <span className="equip-text">{itemText(id)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
