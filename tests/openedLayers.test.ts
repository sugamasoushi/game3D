// 開けたら入れ替わる見た目（GS-179）。
//
// **画面では確かめにくい所を留める。** 閉じた形・開いた形はマップに重ねて置き、
// 開けた覚えで出し入れする。読み方を間違えると「開けたのに閉じたまま」や
// 「閉じた形しか無い宝箱が、開けたら消えた」が静かに起きる。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openedLayerShown, readOpenedLayers, withOpenedLayersBuilt } from '../src/game/openedLayers';
import type { MapDef } from '../src/mep3d/types';

type Prop = { name: string; type: string; value: string | boolean };

function layer(id: string, props: Prop[], extra: Record<string, unknown> = {}) {
  return { id, name: id, kind: 'tile', visible: true, properties: props, batches: [], ...extra };
}
const idOf = (value: string): Prop => ({ name: 'Id', type: 'string', value });
const OPENED: Prop = { name: 'Opened', type: 'boolean', value: true };

const map = {
  layers: [
    layer('閉じた箱', [idOf('宝箱_A')]),
    layer('開いた箱', [idOf('宝箱_A'), OPENED]),
    layer('閉じた箱だけ', [idOf('宝箱_B')]),
    layer('壁', []),
  ],
} as unknown as MapDef;

test('Opened のレイヤーを持つ Id だけ出し入れする（閉じた形だけの物は触らない）', () => {
  deepStrictEqual(readOpenedLayers(map), [
    { id: '閉じた箱', owner: '宝箱_A', opened: false },
    { id: '開いた箱', owner: '宝箱_A', opened: true },
  ]);
});

test('開けていなければ閉じた形、開けたら開いた形', () => {
  const [closed, opened] = readOpenedLayers(map);
  const before = () => false;
  const after = (key: string, owner: string) => key === 'self:開けた' && owner === '宝箱_A';
  strictEqual(openedLayerShown(closed, before), true);
  strictEqual(openedLayerShown(opened, before), false);
  strictEqual(openedLayerShown(closed, after), false);
  strictEqual(openedLayerShown(opened, after), true);
});

test('エディタで目を閉じた開いた形も組む（親の入れ物ごと）。ほかの閉じた目は触らない', () => {
  const hidden = {
    layers: [
      { id: '箱', name: '箱', kind: 'prefab', visible: false, properties: [] },
      layer('開いた箱', [idOf('宝箱_A'), OPENED], { parent: '箱', visible: false }),
      layer('下書き', [], { visible: false }),
    ],
  } as unknown as MapDef;
  const built = withOpenedLayersBuilt(hidden);
  deepStrictEqual(
    built.layers.map((one) => [one.id, one.visible]),
    [
      ['箱', true],
      ['開いた箱', true],
      ['下書き', false],
    ],
  );
  // 起こす物が無ければ元のまま（写しを作らない）。
  strictEqual(withOpenedLayersBuilt(map), map);
});

test('プレハブ「宝箱(開)」は Opened を持っている（置けば付く）', () => {
  const file = join(import.meta.dirname, '..', '..', '3D Map Editor', 'public', 'assets', 'prefab', '宝箱(開).json');
  const prefab = JSON.parse(readFileSync(file, 'utf8')) as { layers?: Array<{ properties?: Prop[] }> };
  const props = prefab.layers?.flatMap((one) => one.properties ?? []) ?? [];
  strictEqual(props.some((one) => one.name === 'Opened' && one.value === true), true);
});
