// マップ移動の行き先を決める（GS-211）。
//
// **どこへ行けるか**はマップが持ち（MAPMOVE レイヤーの物の `MapMove`。`0201,0106` のようにカンマ区切り）、
// **どの条件で・どこに立つか**はイベント JSON の `mapMoves` が持つ（イベントエディタの「マップ移動」）。
// マップエディタのプロパティを増やさないための分け方。

import type { IfWhen, MapMoveDef } from '../event/types';
import type { WalkDir } from './GameView';
import type { Landing } from './eventSpots';

/** 決まった行き先。 */
export interface MapMoveChoice {
  map: string;
  landing: Landing;
  face: WalkDir | '';
}

/** `MapMove` の値を行き先の並びにする。空の項目は捨てる。 */
export function parseMapMoves(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 行き先を 1 つに決める。**`MapMove` に書いた順**に上から見て、最初に当たったもの。
 *
 * - **最後の行き先は条件を見ない**（上記以外）。どこにも行けない入口を作らない
 * - それより前は、イベント側に定義があり、その条件（`when`）を満たしたときだけ当たり。
 *   条件を書いていない定義は常に当たり。定義が無ければ飛ばす
 * - 立ち位置・向きが無ければ、行き先マップの `default` に立ち、向きはそのまま
 */
export function pickMapMove(
  destinations: string[],
  def: MapMoveDef | undefined,
  meets: (when: IfWhen) => boolean,
): MapMoveChoice | null {
  for (const [index, map] of destinations.entries()) {
    const entry = def?.to.find((one) => one.map === map);
    const last = index === destinations.length - 1;
    if (!last && (!entry || (entry.when !== undefined && !meets(entry.when)))) continue;
    return {
      map,
      landing: {
        marker: entry?.marker ?? '',
        at: entry?.at ?? null,
        ...(entry?.px ? { px: entry.px } : {}),
      },
      face: entry?.face ?? '',
    };
  }
  return null;
}
