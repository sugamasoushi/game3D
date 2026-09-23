// 宝箱の中身をマップが持つ（GS-132）。
//
// **書き忘れても画面では「開いたのに増えない」だけ**で、原因が見えない。
// マップの読み方（`Item` / `Num`）と、イベント側の既定の決まり方をここで留める。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { readEventSpots } from '../src/game/eventSpots';
import { readNpcs } from '../src/game/npcs';
import type { MapDef, PropertyDef } from '../src/mep3d/types';

const prop = (name: string, value: string | number): PropertyDef => ({ name, type: 'string', value }) as PropertyDef;

/** 四角 1 つ（踏む枠）のマップ。 */
const spotMap = (layerName: string, properties: PropertyDef[]): MapDef =>
  ({
    layers: [
      {
        kind: 'object',
        name: layerName,
        objects: [
          {
            id: 'obj_1',
            name: '宝箱_家1',
            kind: 'rect',
            points: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            properties,
          },
        ],
      },
    ],
  }) as unknown as MapDef;

/** 点 1 つ（キャラ画像）のマップ。 */
const npcMap = (properties: PropertyDef[]): MapDef =>
  ({
    layers: [
      { kind: 'object', name: 'NPC', objects: [{ id: 'obj_1', name: '宝箱', kind: 'point', points: [[0, 0]], properties }] },
    ],
  }) as unknown as MapDef;

test('踏む・調べる枠は `Item` / `Num` を持てる', () => {
  const [spot] = readEventSpots(spotMap('CLICKEVENT', [prop('Item', 'やくそう'), prop('Num', 2)]));
  strictEqual(spot.item, 'やくそう');
  strictEqual(spot.num, 2);
  strictEqual(spot.examine, true, 'CLICKEVENT レイヤーは調べ物');
});

test('数は数でも文字でも読む。書かなければ持たない（イベント側で 1 になる）', () => {
  strictEqual(readEventSpots(spotMap('EVENT', [prop('Item', 'やくそう'), prop('Num', '3')]))[0].num, 3);
  strictEqual(readEventSpots(spotMap('EVENT', [prop('Item', 'やくそう')]))[0].num, undefined);
  // 負の数は受けない（減ってしまう）。
  strictEqual(readEventSpots(spotMap('EVENT', [prop('Item', 'やくそう'), prop('Num', -5)]))[0].num, 0);
});

test('`Item` を書かなければ空。**イベント側の id が要る**', () => {
  strictEqual(readEventSpots(spotMap('EVENT', []))[0].item, '');
});

test('キャラ画像（NPC）にも書ける。話しかけて開ける宝箱用', () => {
  const [npc] = readNpcs(npcMap([prop('Sprite', 'Chests.png#32x32#0'), prop('Item', 'ばんそうこう'), prop('Num', 1)]));
  strictEqual(npc.item, 'ばんそうこう');
  strictEqual(npc.num, 1);
  // 書かなければ持たない。
  const [bare] = readNpcs(npcMap([prop('Sprite', 'Chests.png#32x32#0')]));
  deepStrictEqual([bare.item, bare.num], [undefined, undefined]);
});
