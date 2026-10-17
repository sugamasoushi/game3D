// 話しかけられた人がこちらを向くか（GS-118 / GS-252）。
//
// - 人は向く。
// - イベントに **`noTurn: true`** と書けば向かない（GS-252）。おままごとの姉妹のように、
//   話しかけても相手の方を向いたまま喋らせたいとき（0202 の ev_1）。
// - 向いたあと、イベントの `turn` が向きを指せばそちらが上書きする（今までどおり）。

import type { EventDef } from '../event/types';

export function facesOnTalk(event: Pick<EventDef, 'noTurn'>): boolean {
  return event.noTurn !== true;
}
