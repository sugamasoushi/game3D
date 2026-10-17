// 吹き出しを誰の頭の上に出すか（GS-23 / GS-201 / GS-251）。
//
// - せりふに **`at`**（吹き出しの相手）を書けば、そのスプライトの上。マップの NPC の `Id` か `player`。
//   名前（`who`）と別に決められるので、話しかけた相手の隣に居る人のせりふも、その人を指せる
//   （0202 の ev_1 で、妹のせりふが姉の上に出ていた）。
//   **そのマップに居なければ**（出す条件で隠れているなど）書かなかったときと同じ決め方へ落とす——
//   居ない人を指すと吹き出しの置き所が決まらず、見えないまま止まる。
// - 書かなければ今までどおり。主人公はプレイヤー、隊列の仲間はその仲間、ほかは**話しかけた相手**。
// - 空を返したら吹き出しにできない（話し相手の居ないイベント）。下のウィンドウで出す。

import type { TalkLine } from '../event/types';

export interface TalkAnchorWorld {
  /** 話しかけた相手（NPC の `Id`）。居なければ空。 */
  self: string;
  /** 主人公の話者キー。 */
  player: string;
  /** そのマップに NPC が居るか。 */
  hasNpc(id: string): boolean;
  /** 隊列の何番目か。先頭はプレイヤー、付いて歩いていれば仲間。 */
  partyRole(who: string): 'leader' | 'follower' | null;
}

export function talkAnchor(line: Pick<TalkLine, 'who' | 'at'>, world: TalkAnchorWorld): string {
  if (line.at === 'player') return 'player';
  if (line.at && world.hasNpc(line.at)) return line.at;
  const who = line.who;
  if (who === world.player) return 'player';
  if (who) {
    const role = world.partyRole(who);
    if (role === 'leader') return 'player';
    if (role === 'follower') return `follower:${who}`;
  }
  return world.self || '';
}
