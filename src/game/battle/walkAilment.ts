// 歩いているあいだの状態異常（GS-71）。**いまのところ毒だけ**。
//
// 数え方は出会い頭（GS-61）と同じ**歩いた距離**。歩数だと走る人が得をするし、
// 距離なら道のりの長さがそのまま重みになる——2 つの仕掛けで数え方を変えない。
//
// **フィールドでは倒れない（HP 1 で止まる）。** 歩いているだけで全滅すると、
// 戦闘画面も無いままゲームオーバーへ落ちることになり、何が起きたのか分からない。
// 「毒のまま宿へ急ぐ」緊張は HP が 1 まで削れれば十分に出る。

import type { GameState } from '../state';
import { ailmentDef } from './book';

/** これ以上の移動は「歩いた」ではない（マス）。マップ移動やイベントの場所替え。 */
const JUMP = 3;

/** 1 人ぶんの被害。**画面に出す文はこれを見て作る。** */
export interface WalkHurt {
  who: string;
  /** どの状態異常で減ったか。 */
  ailment: string;
  /** 実際に減った量。 */
  amount: number;
}

/**
 * 歩いた距離を数えて、頃合いなら毒を効かせる道具。
 * **状態異常ごとに別々に数える**——毒と別の何かで間隔が違っても混ざらない。
 */
export function createWalkAilments(random: () => number = Math.random) {
  /** 状態異常 id → 次に効くまでの残り距離。 */
  const left = new Map<string, number>();
  let last: { x: number; z: number } | null = null;

  /** その状態異常の間隔（マス）。少しだけばらつかせる（出会い頭と同じ考え）。 */
  const span = (id: string): number => {
    const walk = ailmentDef(id)?.walk ?? 0;
    return walk > 0 ? walk * (0.8 + random() * 0.4) : Number.POSITIVE_INFINITY;
  };

  return {
    /** 場所が飛んだので数え直す（マップを移った、イベントで動かされた）。 */
    reset() {
      last = null;
      left.clear();
    },
    /**
     * いまの場所を渡す。減らす人が居れば返す。
     * `counting` が false のときは**場所だけ覚えて数えない**（会話中・戦闘中・メニュー）。
     */
    at(state: GameState, now: { x: number; z: number }, counting: boolean): WalkHurt[] {
      const before = last;
      last = { x: now.x, z: now.z };
      if (!counting || !before) return [];
      const moved = Math.hypot(now.x - before.x, now.z - before.z);
      if (moved >= JUMP || moved <= 0) return [];

      // いま誰かがかかっている物だけを数える（誰も毒でなければ何もしない）。
      const active = new Set<string>();
      for (const who of state.party) {
        for (const id of state.members.get(who)?.ailments ?? []) {
          if ((ailmentDef(id)?.walk ?? 0) > 0) active.add(id);
        }
      }
      // かかっていない物の数えは捨てる（治した後に持ち越さない）。
      for (const id of [...left.keys()]) if (!active.has(id)) left.delete(id);

      const out: WalkHurt[] = [];
      for (const id of active) {
        const rest = (left.get(id) ?? span(id)) - moved;
        if (rest > 0) {
          left.set(id, rest);
          continue;
        }
        left.set(id, span(id));
        const damage = ailmentDef(id)?.turnDamage ?? 0;
        for (const who of state.party) {
          const member = state.members.get(who);
          if (!member || !member.ailments.includes(id)) continue;
          // **1 で止める。** 歩いているだけで倒れさせない。
          const done = Math.min(damage, Math.max(0, member.hp - 1));
          if (done <= 0) continue;
          member.hp -= done;
          out.push({ who, ailment: id, amount: done });
        }
      }
      return out;
    },
  };
}
