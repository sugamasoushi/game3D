// マップのプロパティ → NPC（GS-130）。
//
// **絵が出ない・出るはずの物が出ないは、画面では原因が分からない。** 立たない理由は
// 「レイヤー名が違う」「id が重なった」「条件を満たしていない」のどれかで、
// どれも黙って 1 人減るだけなので、ここで読み方そのものを留める。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { npcShown, readNpcs } from '../src/game/npcs';
import type { MapDef, PropertyDef } from '../src/mep3d/types';

/** 点 1 つのオブジェクトを 1 枚のマップに仕立てる。 */
const mapOf = (layerName: string, objects: Array<{ name: string; properties: PropertyDef[] }>): MapDef =>
  ({
    layers: [
      {
        kind: 'object',
        name: layerName,
        objects: objects.map((entry, index) => ({
          id: `obj_${index}`,
          name: entry.name,
          kind: 'point',
          points: [[index, 0]],
          properties: entry.properties,
        })),
      },
    ],
  }) as unknown as MapDef;

const prop = (name: string, value: string | number): PropertyDef => ({ name, type: 'string', value }) as PropertyDef;

test('NPC になるのは `Npc` を書いたものか、`NPC` レイヤーのキャラ画像だけ', () => {
  // レイヤー名が違うと、キャラ画像を置いても**立たない**（実際に 0105 で 2 人消えていた）。
  strictEqual(readNpcs(mapOf('オブジェクト', [{ name: 'a', properties: [prop('Sprite', 'enemy02.png#32x32#1')] }])).length, 0);
  strictEqual(readNpcs(mapOf('NPC', [{ name: 'a', properties: [prop('Sprite', 'enemy02.png#32x32#1')] }])).length, 1);
  // `Npc` を書けばレイヤーはどこでもよい。
  strictEqual(readNpcs(mapOf('オブジェクト', [{ name: 'a', properties: [prop('Npc', 'grandpa')] }])).length, 1);
});

test('名前は `NpcId`、無ければ絵のファイル名。**同じ絵を 2 つ置くと id が重なる**', () => {
  // 読む側は 2 人返すが、**id が同じ**なので置く側（`GameView`）で後の 1 人が落ちる。
  // 別々に扱いたいなら `NpcId` を書く——0105 の スライムと熊で実際に重なっていた。
  const same = readNpcs(
    mapOf('NPC', [
      { name: 'a', properties: [prop('Sprite', 'enemy02.png#32x32#1')] },
      { name: 'b', properties: [prop('Sprite', 'enemy02.png#32x32#1')] },
    ]),
  );
  deepStrictEqual(
    same.map((npc) => npc.id),
    ['enemy02', 'enemy02'],
  );
  const split = readNpcs(
    mapOf('NPC', [
      { name: 'a', properties: [prop('Sprite', 'enemy02.png#32x32#1')] },
      { name: 'b', properties: [prop('Sprite', 'enemy02.png#32x32#1'), prop('NpcId', 'boss')] },
    ]),
  );
  deepStrictEqual(
    split.map((npc) => npc.id),
    ['enemy02', 'boss'],
  );
});

test('Scale は数でも文字でも読む。0 以下は受けない', () => {
  const read = (value: string | number) =>
    readNpcs(mapOf('NPC', [{ name: 'a', properties: [prop('Sprite', 'enemy02.png#32x32#1'), prop('Scale', value)] }]))[0]
      .scale;
  strictEqual(read(4), 4);
  strictEqual(read('4'), 4);
  // **消えてしまう値は受けない。** 上も程々で止める。
  strictEqual(read(0), 0.1);
  strictEqual(read(-2), 0.1);
  strictEqual(read(999), 16);
  // 書かなければ持たない（台帳のまま）。
  strictEqual(readNpcs(mapOf('NPC', [{ name: 'a', properties: [prop('Sprite', 'x.png')] }]))[0].scale, undefined);
});

test('Wander も数で書ける。**0 はその場から動かない**（書き忘れとは別物）', () => {
  const read = (value: string | number) =>
    readNpcs(mapOf('NPC', [{ name: 'a', properties: [prop('Sprite', 'x.png'), prop('Wander', value)] }]))[0].wander;
  strictEqual(read(2), 2);
  strictEqual(read('2'), 2);
  strictEqual(read(0), 0);
  strictEqual(readNpcs(mapOf('NPC', [{ name: 'a', properties: [prop('Sprite', 'x.png')] }]))[0].wander, undefined);
});

test('ShowIf / HideIf。**両方書いたら両方満たすときだけ**出す', () => {
  const on = (...keys: string[]) => (key: string) => keys.includes(key);
  strictEqual(npcShown({}, on()), true, '条件なしはいつでも出る');
  strictEqual(npcShown({ hideIf: 'EVENT020101' }, on()), true);
  strictEqual(npcShown({ hideIf: 'EVENT020101' }, on('EVENT020101')), false, '倒したら出ない');
  strictEqual(npcShown({ showIf: 'EVENT010401' }, on()), false);
  strictEqual(npcShown({ showIf: 'EVENT010401' }, on('EVENT010401')), true);
  strictEqual(npcShown({ showIf: 'EVENT010401', hideIf: 'EVENT020101' }, on('EVENT010401')), true);
  strictEqual(npcShown({ showIf: 'EVENT010401', hideIf: 'EVENT020101' }, on('EVENT010401', 'EVENT020101')), false);
});

test('`SPRITE` レイヤーは**物**。うろつかせず、話しかけても向かせない（GS-133）', () => {
  const [thing] = readNpcs(mapOf('SPRITE', [{ name: '宝箱', properties: [prop('Sprite', 'Chests.png#32x32#0')] }]));
  strictEqual(thing.thing, true);
  // `NPC` レイヤーは今までどおり人。
  strictEqual(readNpcs(mapOf('NPC', [{ name: 'a', properties: [prop('Sprite', 'x.png')] }]))[0].thing, undefined);
});

test('Pose / PoseIf。**見た目はイベントではなくマップが決める**（GS-133）', () => {
  const [chest] = readNpcs(
    mapOf('SPRITE', [
      { name: '宝箱', properties: [prop('Sprite', 'Chests.png#32x32#0'), prop('Pose', '開いた'), prop('PoseIf', '宝箱_家1_開けた')] },
    ]),
  );
  strictEqual(chest.pose, '開いた');
  strictEqual(chest.poseIf, '宝箱_家1_開けた');
  // 片方だけでは効かない（画面側が両方そろって初めて当てる）。
  const [half] = readNpcs(mapOf('SPRITE', [{ name: '宝箱', properties: [prop('Sprite', 'x.png'), prop('Pose', '開いた')] }]));
  strictEqual(half.poseIf, undefined);
});
