import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyTrail } from '../src/game/partyTrail';

test('追従は曲がり角をショートカットせず、通った道で間隔を保つ', () => {
  const trail = new PartyTrail();
  trail.reset({ x: 0, y: 0, z: 0 });
  trail.advance({ x: 2, y: 0, z: 0 }, 3);
  trail.advance({ x: 2, y: 0, z: 2 }, 3);
  assert.deepEqual(trail.behind(1), { x: 2, y: 0, z: 1 });
  assert.deepEqual(trail.behind(3), { x: 1, y: 0, z: 0 });
  trail.advance({ x: 2, y: 0, z: 2 }, 3);
  assert.deepEqual(trail.behind(3), { x: 1, y: 0, z: 0 });
});

test('坂の高さも通過地点から補間する', () => {
  const trail = new PartyTrail();
  trail.reset({ x: 0, y: 0, z: 0 });
  trail.advance({ x: 2, y: 2, z: 0 }, 3);
  assert.deepEqual(trail.behind(Math.SQRT2), { x: 1, y: 1, z: 0 });
});

test('マップ入場・置き直し・長距離移動では新しい地点から隊列を作る', () => {
  const trail = new PartyTrail();
  trail.reset({ x: 0, y: 0, z: 0 });
  trail.advance({ x: 1, y: 0, z: 0 }, 3);
  assert.deepEqual(trail.behind(2), { x: 0, y: 0, z: 0 });
  trail.advance({ x: 20, y: 3, z: 0 }, 3);
  assert.deepEqual(trail.behind(2), { x: 20, y: 3, z: 0 });
  trail.reset({ x: -1, y: 2, z: 3 });
  assert.deepEqual(trail.behind(1), { x: -1, y: 2, z: 3 });
});

test('長く歩いて古い道を捨てても直近の隊列位置は変わらない', () => {
  const trail = new PartyTrail();
  trail.reset({ x: 0, y: 0, z: 0 });
  for (let x = 1; x <= 1000; x++) trail.advance({ x, y: 0, z: 0 }, 2.2);
  assert.deepEqual(trail.behind(1.1), { x: 998.9, y: 0, z: 0 });
  assert.deepEqual(trail.behind(2.2), { x: 997.8, y: 0, z: 0 });
});

// GS-185: 仲間は**主人公がそこを通ったときの向き**を使う。斜めに歩いたとき縦横を行き来しない。
test('道の点は主人公の向きを持ち、後ろの点はその向きを返す', () => {
  const trail = new PartyTrail();
  trail.reset({ x: 0, y: 0, z: 0, facing: 'south' });
  trail.advance({ x: 0, y: 0, z: 1, facing: 'south' }, 3);
  trail.advance({ x: 1, y: 0, z: 1, facing: 'east' }, 3);
  assert.equal(trail.behind(0.5).facing, 'east');
  assert.equal(trail.behind(1.5).facing, 'south');
});

// GS-184: イベントで置いた仲間を隊列へ戻すときは、離れていても道をつなぐ。
test('extend は 3 マスを超えても道を切らない', () => {
  const trail = new PartyTrail();
  trail.reset({ x: 0, y: 0, z: 0 });
  trail.extend({ x: 5, y: 0, z: 0 });
  assert.deepEqual(trail.behind(1), { x: 4, y: 0, z: 0 });
});
