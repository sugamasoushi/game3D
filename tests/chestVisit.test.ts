// マップに入るたびに戻る宝箱（GS-180）。
//
// **画面では確かめにくい所を留める。** 置き場所の数え方（重ねた 2 枚が 1 か所）と、
// 抽選の結果どおりにレイヤーが抜けるか、開けた覚えが消えるか。
// ずれると「見えない宝箱に当たる」「開けたのに戻らない」が静かに起きる。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { applyChestVisit, forgetRespawnChests, readChestSpots, rollChestVisit } from '../src/game/chestVisit';
import type { ChestDef } from '../src/game/chests';
import type { MapDef } from '../src/mep3d/types';

/** マスを並べたタイルレイヤー 1 枚（マップが持つのと同じ形）。 */
function layer(id: string, owner: string, cells: number[]) {
  return {
    id,
    name: id,
    kind: 'tile',
    properties: owner ? [{ name: 'Id', type: 'string', value: owner }] : [],
    batches: [
      { id: `${id}-b`, shape: 'box', mat: 'm', ts: 't', mode: 'instanced', count: cells.length / 3, enc: 'json', cellEnc: 'abs', protos: ['p'], attrs: { cell: cells, proto: [], rf: [], gid: [] } },
    ],
  };
}

const map = {
  layers: [
    // 宝箱_森: 2 か所（それぞれ閉じた形と開いた形を重ねた 1 組）。
    layer('森A閉', '宝箱_森', [0, 0, 0]),
    layer('森A開', '宝箱_森', [0, 0, 0]),
    layer('森B閉', '宝箱_森', [5, 0, 5]),
    layer('森B開', '宝箱_森', [5, 0, 5]),
    // 宝箱_家: セーブに残る宝箱（抽選しない）。
    layer('家閉', '宝箱_家', [9, 0, 9]),
    layer('壁', '', [1, 0, 1]),
  ],
} as unknown as MapDef;

const book: Record<string, ChestDef> = {
  宝箱_森: { random: ['やくそう', 'どく消し'], respawn: true },
  宝箱_家: { item: 'やくそう' },
};
const chestOf = (id: string) => book[id] ?? null;
/** 決まった順に値を返す（抽選の差し替え）。 */
const sequence = (...values: number[]) => () => values.shift() ?? 0;

test('重ねた 2 枚は 1 か所、離れて置いた物は別の場所として数える', () => {
  deepStrictEqual(readChestSpots(map), [
    { owner: '宝箱_森', layers: ['森A閉', '森A開'] },
    { owner: '宝箱_森', layers: ['森B閉', '森B開'] },
    { owner: '宝箱_家', layers: ['家閉'] },
  ]);
});

test('入るたびに戻る宝箱は、どこか 1 か所にだけ出す（ほかは組まない）', () => {
  // 1 つ目の値は出る判定（確率 1 なので必ず出る）、2 つ目は場所（0.9 → 2 か所目）。
  const visit = rollChestVisit(map, chestOf, sequence(0.5, 0.9));
  deepStrictEqual([...visit.removed], ['森A閉', '森A開']);
  deepStrictEqual([...visit.absent], []);
  deepStrictEqual(applyChestVisit(map, visit).layers.map((one) => one.id), ['森B閉', '森B開', '家閉', '壁']);
});

test('確率で外れたら、どの場所にも出さない。セーブに残る宝箱は抽選しない', () => {
  const rare: Record<string, ChestDef> = { ...book, 宝箱_森: { ...book.宝箱_森, chance: 0.3 } };
  const visit = rollChestVisit(map, (id) => rare[id] ?? null, sequence(0.5));
  deepStrictEqual([...visit.absent], ['宝箱_森']);
  deepStrictEqual(applyChestVisit(map, visit).layers.map((one) => one.id), ['家閉', '壁']);
  // 当たれば出る。
  const hit = rollChestVisit(map, (id) => rare[id] ?? null, sequence(0.1, 0));
  deepStrictEqual([...hit.removed], ['森B閉', '森B開']);
});

test('抜く物が無ければ元のマップをそのまま返す（写しを作らない）', () => {
  const plain = { layers: [layer('家閉', '宝箱_家', [9, 0, 9])] } as unknown as MapDef;
  strictEqual(applyChestVisit(plain, rollChestVisit(plain, chestOf)), plain);
});

test('入るたびに戻る宝箱の覚えだけ消す（どのマップの分も）', () => {
  const self = new Map<string, boolean>([
    ['0102/@宝箱_森/開けた', true],
    ['0101/@宝箱_森/開けた', true],
    ['0101/@宝箱_家/開けた', true],
    ['0101/宝箱/A', true],
  ]);
  strictEqual(forgetRespawnChests(self, chestOf), 2);
  deepStrictEqual([...self.keys()], ['0101/@宝箱_家/開けた', '0101/宝箱/A']);
});
