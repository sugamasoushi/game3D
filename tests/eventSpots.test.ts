// 起動場所の読み取り（GS-14 / GS-17 / GS-19 / GS-34）。
//
// **ここで押さえたいのは「マップの書き方 → 起動場所」の対応**で、3D も画面も要らない。
// 実際に踏んで確かめると、マップを 1 枚読んでカメラを回して……となって割に合わない。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { parseLanding, readEventSpots, spotAhead, spotUnder } from '../src/game/eventSpots';
import type { MapDef } from '../src/mep3d/types';

/** 四角のオブジェクト 1 つ。`points` はマップが持つのと同じ形（角の並び）。 */
function rect(id: string, name: string, box: [number, number, number, number], properties: Array<[string, string]> = []) {
  const [x0, z0, x1, z1] = box;
  return {
    id,
    name,
    kind: 'rect',
    points: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    properties: properties.map(([key, value]) => ({ name: key, type: 'string', value })),
  };
}

function mapWith(layers: Array<{ name: string; objects: unknown[] }>): MapDef {
  return {
    layers: layers.map((layer, index) => ({ id: `layer${index}`, kind: 'object', ...layer })),
  } as unknown as MapDef;
}

/** ブロックを置いたタイルレイヤー 1 枚（GS-175）。マップが持つのと同じ形。 */
function blockLayer(name: string, cells: number[], properties: Array<[string, string]>) {
  return {
    id: name,
    name,
    kind: 'tile',
    properties: properties.map(([key, value]) => ({ name: key, type: 'string', value })),
    batches: [{ id: `${name}-0`, enc: 'json', cellEnc: 'abs', attrs: { cell: cells } }],
  };
}

test('レイヤーに Event を書くと、そのブロックのマスが調べる枠になる（GS-175）', () => {
  const map = { layers: [blockLayer('宝箱(閉)', [1, 0, -1, 4, 2, 5], [['Event', '宝箱'], ['Id', '宝箱_家2']])] } as unknown as MapDef;
  const spots = readEventSpots(map);
  strictEqual(spots.length, 2, 'マスごとに 1 枠');
  strictEqual(spots[0].event, '宝箱');
  strictEqual(spots[0].owner, '宝箱_家2');
  // **踏んでは起きない**。ブロックは当たりを持つので上に立てない。
  strictEqual(spots[0].examine, true);
  strictEqual(spotUnder(spots, { x: 1.5, z: -0.5 }), null);
  // 高さまで分かる——宝箱の開け閉め（マスの絵の差し替え）に要る。
  deepStrictEqual(spots[0].cell, { x: 1, y: 0, z: -1 });
  deepStrictEqual(spots[1].cell, { x: 4, y: 2, z: 5 });
  deepStrictEqual([spots[0].x0, spots[0].x1, spots[0].z0, spots[0].z1], [1, 2, -1, 0]);
});

test('Id だけのタイルレイヤーも枠になる（宝箱は台帳が動きを決める。GS-178）', () => {
  const map = { layers: [blockLayer('宝箱(閉)', [0, 0, 0], [['Id', '宝箱_森1']])] } as unknown as MapDef;
  const spots = readEventSpots(map);
  strictEqual(spots.length, 1);
  strictEqual(spots[0].owner, '宝箱_森1');
  strictEqual(spots[0].event, '', 'イベント id は空（台帳が決める）');
  strictEqual(spots[0].examine, true);
  // 枠ができても**向いて調べたときに拾えなければ**開けられない（宝箱_家3 で実際に起きた）。
  const look = spotAhead(spots, { x: 0.5, z: 1.5 }, { x: 0, z: -1 }, 1);
  strictEqual(look?.owner, '宝箱_森1', '向いた先の Id だけの枠を拾う');
});

test('Event も Id も無いタイルレイヤーは枠にならない', () => {
  const map = { layers: [blockLayer('壁', [0, 0, 0], [])] } as unknown as MapDef;
  deepStrictEqual(readEventSpots(map), []);
});

test('MapMove のプロパティが起動場所になる', () => {
  const spots = readEventSpots(
    mapWith([{ name: 'MAPMOVE', objects: [rect('obj_1', '0102', [5, 3, 6, 4], [['MapMove', '0102'], ['Direction', 'Down']])] }]),
  );
  strictEqual(spots.length, 1);
  strictEqual(spots[0].mapMove, '0102');
  strictEqual(spots[0].face, 'down');
  deepStrictEqual([spots[0].x0, spots[0].x1, spots[0].z0, spots[0].z1], [5, 6, 3, 4]);
});

test('EVENT レイヤーではオブジェクトの名前がそのままイベント id（GS-19）', () => {
  const spots = readEventSpots(mapWith([{ name: 'EVENT', objects: [rect('obj_1', 'EVENT010101', [-5, -3, -4, -2])] }]));
  strictEqual(spots.length, 1);
  strictEqual(spots[0].event, 'EVENT010101');
});

test('Npc を持つオブジェクトは踏み台にしない', () => {
  const spots = readEventSpots(
    mapWith([{ name: 'NPC', objects: [rect('obj_1', 'にわとり', [0, 0, 1, 1], [['Npc', 'chicken'], ['Event', 'talk']])] }]),
  );
  deepStrictEqual(spots, []);
});

test('見分けはレイヤー番号込み。別レイヤーの同じ id を混同しない（GS-34）', () => {
  // エディタはレイヤーごとに `obj_1` から振る。id だけで覚えると別物を同じと見なす。
  const spots = readEventSpots(
    mapWith([
      { name: 'MAPMOVE', objects: [rect('obj_1', '0102', [5, 3, 6, 4], [['MapMove', '0102']])] },
      { name: 'EVENT', objects: [rect('obj_1', 'EVENT010101', [-5, -3, -4, -2])] },
    ]),
  );
  strictEqual(spots.length, 2);
  strictEqual(spots[0].objectId === spots[1].objectId, false);
});

test('体が触れたら踏んだと見なす。中心だけでは見ない（DEC-247）', () => {
  const spots = readEventSpots(
    mapWith([{ name: 'MAPMOVE', objects: [rect('obj_1', '0102', [5, 3, 6, 4], [['MapMove', '0102']])] }]),
  );
  // 枠の外 0.2 マス。中心だけなら外れるが、体の太さ 0.28 なら届く。
  strictEqual(spotUnder(spots, { x: 5.5, z: 2.8 }, 0), null);
  strictEqual(spotUnder(spots, { x: 5.5, z: 2.8 }, 0.28)?.mapMove, '0102');
  // 遠すぎるところでは拾わない。
  strictEqual(spotUnder(spots, { x: 5.5, z: 1 }, 0.28), null);
});

test('MoveTo は「数 3 つ」ならマス、それ以外は目印の名前（GS-17）', () => {
  deepStrictEqual(parseLanding('6,10,-2'), { marker: '', at: { x: 6, y: 10, z: -2 } });
  deepStrictEqual(parseLanding(' 入口 '), { marker: '入口', at: null });
  deepStrictEqual(parseLanding(''), { marker: '', at: null });
  // 数が足りなければ名前として扱う。半端な指定で黙って原点へ飛ばさない。
  deepStrictEqual(parseLanding('6,10'), { marker: '6,10', at: null });
});
