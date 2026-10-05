// マップ移動の行き先の決め方（GS-211）。
//
// 行き先の候補はマップの `MapMove`（カンマ区切り）、条件・立ち位置・向きはイベント JSON の `mapMoves`。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { IfWhen, MapMoveDef } from '../src/event/types';
import { parseMapMoves, pickMapMove } from '../src/game/mapMoves';

/** フラグの表で条件を見る（`interpreter.ts` の `meets` のフラグだけ）。書いていないフラグは true。 */
function flags(table: Record<string, boolean>) {
  return (when: IfWhen) =>
    (Array.isArray(when) ? when : [when]).every((one) => 'switch' in one && (table[one.switch] ?? true) === (one.is ?? true));
}

const def: MapMoveDef = {
  object: 'obj_4',
  to: [
    {
      map: '0201',
      when: [{ switch: 'EVENT010401', is: false }, { switch: 'EVENT020301', is: true }],
      at: { x: 5, y: 5, z: -3 },
      face: 'left',
    },
    { map: '0106', at: { x: 17, y: 11, z: 3 }, px: { x: 8, z: 0 }, face: 'left' },
  ],
};

test('MapMove はカンマ区切り。空は捨てる', () => {
  deepStrictEqual(parseMapMoves(' 0201 , 0106 ,'), ['0201', '0106']);
  deepStrictEqual(parseMapMoves(''), []);
});

test('条件を満たせば前の行き先', () => {
  const pick = pickMapMove(['0201', '0106'], def, flags({ EVENT010401: false }));
  strictEqual(pick?.map, '0201');
  deepStrictEqual(pick?.landing, { marker: '', at: { x: 5, y: 5, z: -3 } });
  strictEqual(pick?.face, 'left');
});

test('満たさなければ最後の行き先（上記以外）', () => {
  strictEqual(pickMapMove(['0201', '0106'], def, flags({}))?.map, '0106');
  strictEqual(pickMapMove(['0201', '0106'], def, flags({ EVENT010401: false, EVENT020301: false }))?.map, '0106');
  deepStrictEqual(pickMapMove(['0201', '0106'], def, flags({}))?.landing.px, { x: 8, z: 0 });
});

test('最後の行き先は条件を書いても見ない', () => {
  const only: MapMoveDef = { object: 'obj_1', to: [{ map: '0102', when: { switch: 'X', is: false } }] };
  strictEqual(pickMapMove(['0102'], only, flags({}))?.map, '0102');
});

test('定義が無ければ最後の行き先の default へ。向きはそのまま', () => {
  deepStrictEqual(pickMapMove(['0201', '0106'], undefined, flags({})), {
    map: '0106',
    landing: { marker: '', at: null },
    face: '',
  });
});

test('目印の名前で立つ', () => {
  const marker: MapMoveDef = { object: 'obj_1', to: [{ map: '0102', marker: '入口' }] };
  deepStrictEqual(pickMapMove(['0102'], marker, flags({}))?.landing, { marker: '入口', at: null });
});

test('行き先が無ければ動かない', () => {
  strictEqual(pickMapMove([], def, flags({})), null);
});
