// 使った物の効き目（GS-64）。**数だけ。** 記録も画面も触らない（`rules.ts` と同じ立ち位置）。
//
// 戦闘中の 1 体（`Fighter`）にも、歩いているときの仲間（`MemberState`）にも同じ式を使う。
// **式を 2 本持たない**——戦闘で 30 戻る薬がメニューでは 25 になる、が起きないように。

import type { ItemUse } from '../items';
import type { Stats } from './rules';

/** 実際に戻った量。**0 なら何も起きなかった**（満タンに使った）。 */
export interface Healed {
  hp: number;
  mp: number;
  /** 消せた状態異常（GS-69）。 */
  cured: string[];
}

/** `"full"` は満タンまで。数はそのぶんだけ。 */
function amount(want: number | 'full' | undefined, now: number, max: number): number {
  if (want === undefined) return 0;
  const room = Math.max(0, max - now);
  if (want === 'full') return room;
  return Math.min(room, Math.max(0, Math.trunc(want)));
}

/** 効き目を入れる相手。戦っている 1 体（`Fighter`）にも、記録の仲間にも合う形。 */
export interface HealTarget {
  hp: number;
  mp: number;
  /** かかっている状態異常（GS-69）。戦闘中だけ持つので、無くてもよい。 */
  ailments?: string[];
}

/**
 * 効き目を入れる。**渡した入れ物を書き換え**、戻った量を返す。
 * `max` はそのときの満タン——レベルで変わるので、呼ぶ側が渡す（GS-63）。
 * 状態異常を消す物（GS-69）は、消せた物の id を `cured` に入れて返す。
 */
export function applyUse(now: HealTarget, max: Stats, use: ItemUse): Healed {
  const hp = amount(use.hp, now.hp, max.hp);
  const mp = amount(use.mp, now.mp, max.mp);
  now.hp += hp;
  now.mp += mp;
  const cured: string[] = [];
  for (const id of use.cure ?? []) {
    const at = now.ailments?.indexOf(id) ?? -1;
    if (at < 0) continue;
    now.ailments?.splice(at, 1);
    cured.push(id);
  }
  return { hp, mp, cured };
}

/** 何かしら効いたか。**効かない物は使わせない**——数を減らして何も起きないのが一番困る。 */
export function wouldHelp(now: HealTarget, max: Stats, use: ItemUse): boolean {
  if (amount(use.hp, now.hp, max.hp) > 0 || amount(use.mp, now.mp, max.mp) > 0) return true;
  return (use.cure ?? []).some((id) => now.ailments?.includes(id));
}

/** 「HP が 30 もどった！」のような一言。戻らなかったほうは出さない。 */
export function healLine(name: string, healed: Healed): string {
  const parts: string[] = [];
  if (healed.hp > 0) parts.push(`HP が ${healed.hp}`);
  if (healed.mp > 0) parts.push(`MP が ${healed.mp}`);
  if (parts.length === 0) {
    // 状態異常だけを消したときは、消した側（呼ぶ側）が名前を出す。
    return healed.cured.length > 0 ? '' : `${name} には 何も 起きなかった……`;
  }
  return `${name} の ${parts.join(' と ')} もどった！`;
}
