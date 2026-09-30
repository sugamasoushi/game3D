'use client';

// そうび（GS-67）。**袋と置き場所のあいだで物を動かすだけ。**
//
// 身に着けた物は袋から出る（`equipItem`）。両方に置くと「装備している剣を売る」が
// できてしまい、店とメニューのどちらが正しいのか分からなくなる。
//
// **増えるのは攻撃・守り・速さだけ**（GS-67）。満タンの HP を装備で変えると、
// 外した瞬間に「いまの HP が満タンを超える」始末を毎回することになる。

import { useEffect, useRef, useState } from 'react';
import { itemEquip, itemName, itemText } from '../../game/items';
import { characterIcon } from '../../game/characters';
import type { MemberState } from '../../game/state';

/**
 * 置き場所の呼び名。**台帳（`items.json` の `slot`）が正**で、ここは見せ方だけ。
 * 知らない置き場所はそのまま出す——増やしたときに黙って消えないように。
 */
const SLOT_LABEL: Record<string, string> = { weapon: '武器', armor: '鎧' };
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
  const [choosingSlot, setChoosingSlot] = useState<string | null>(null);
  const chooserRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (choosingSlot) chooserRef.current?.querySelector<HTMLButtonElement>('[data-pick]')?.focus();
  }, [choosingSlot]);

  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;

  // 台帳と、いま着けている物から置き場所を集める（`weapon` / `armor` 以外も拾う）。
  const slots = [...new Set([...SLOT_ORDER, ...Object.keys(member.equip)])];
  const owned = (slot: string) => [...items.entries()].filter(([id, count]) => count > 0 && itemEquip(id)?.slot === slot);
  const image = characterIcon(who);

  if (choosingSlot) {
    const list = owned(choosingSlot);
    return (
      <div className="equip-modal-backdrop" onClick={() => setChoosingSlot(null)}>
      <section ref={chooserRef} className="equip-chooser" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2>{`${SLOT_LABEL[choosingSlot] ?? choosingSlot}を選択`}</h2>
        <ul className="equip-list">
            {list.map(([id, count]) => (
              <li key={id}><button type="button" data-pick onClick={() => { if (onEquip(who, id)) { setTick(tick + 1); setChoosingSlot(null); } }}>
                <span className="equip-name">{itemName(id)}</span><span className="equip-count">{count > 1 ? `×${count}` : ''}</span><span className="equip-text">{itemText(id)}</span>
              </button></li>
            ))}
            {list.length === 0 ? <li className="menu-empty">装備できる武具がありません</li> : null}
        </ul>
        <button type="button" onClick={() => setChoosingSlot(null)}>閉じる</button>
        {image ? <img className="equip-character-icon" src={image} alt="" /> : null}
      </section>
      </div>
    );
  }

  return (
    <div className="equip" data-tick={tick}>
      <div className="equip-current">
       <div>{slots.map((slot) => {
        const now = member.equip[slot];
        return (
          <div key={slot} className="equip-slot">
            <p className="equip-head">
              <span className="equip-kind">{SLOT_LABEL[slot] ?? slot}</span>
              <span className="equip-now">{now ? itemName(now) : '—'}</span>
              <button type="button" data-pick onClick={() => setChoosingSlot(slot)}>変更</button>
              {now ? <button type="button" data-pick onClick={() => { onUnequip(who, slot); setTick(tick + 1); }}>外す</button> : null}
            </p>
          </div>
        );
       })}</div>
       {image ? <img className="equip-character-icon" src={image} alt="" /> : null}
      </div>
    </div>
  );
}
