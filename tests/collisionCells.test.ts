// マスを丸ごと塞ぐか（`solidCellAt`。GS-116）。**薄い壁チップと区別できること**を見る。
//
// キャラの当たりはマス 1 つぶんの四角だが、四角を当てるのは**丸ごと塞がるマス**だけ。
// 薄い壁チップ（辺・対角の帯）まで丸ごと扱いにすると、壁ぎわの床マスに立てなくなり、
// 実際のマップでは通れなくなる所が出る（実測: 0102 / 0104 / 0106 で行き止まり）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCollision } from '../src/mep3d/collision';
import type { MapDef } from '../src/mep3d/types';

const map = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'public', 'mapdata', '0101_home.json'), 'utf8'),
) as MapDef;

test('マスを丸ごと塞ぐのはブロックだけ。薄い壁チップの帯は丸ごとにしない', () => {
  const collision = buildCollision(map);
  /** マスごとの塞ぎ方。`full` は四角 1 枚（帯でも線でもない）。 */
  const cells = new Map<string, { full: boolean; band: boolean }>();
  for (const blocker of collision.blockers()) {
    const key = `${blocker.x},${blocker.y},${blocker.z}`;
    const [x0, z0, x1, z1] = blocker.foot;
    const full = !blocker.line && x0 === 0 && z0 === 0 && x1 === 1 && z1 === 1;
    const found = cells.get(key) ?? { full: false, band: false };
    cells.set(key, { full: found.full || full, band: found.band || !full });
  }
  let solid = 0;
  let thin = 0;
  for (const [key, kind] of cells) {
    const [x, y, z] = key.split(',').map(Number);
    assert.equal(collision.solidCellAt(x + 0.5, y, z + 0.5), kind.full, `${key} の丸ごと塞ぎ`);
    if (kind.full) solid += 1;
    else thin += 1;
  }
  // 両方が在るマップで見ていること。どちらか片方だと差を見ていない。
  assert.ok(solid > 0, 'ブロックのマスがある');
  assert.ok(thin > 0, '薄い壁チップだけのマスがある');
});

test('薄い壁チップのマスは、帯の外なら体が入れる（壁ぎわの床に立てる）', () => {
  const collision = buildCollision(map);
  const thin = collision
    .blockers()
    .find((blocker) => !blocker.line && blocker.foot[3] === 1 && blocker.foot[1] === 0.8);
  assert.ok(thin, '南の辺に立つ壁チップがある');
  // 帯（南の 0.2）は塞ぎ、マスの真ん中は空いている。丸ごとではない。
  assert.equal(collision.blockedAt(thin.x + 0.5, thin.y, thin.z + 0.9), true);
  assert.equal(collision.blockedAt(thin.x + 0.5, thin.y, thin.z + 0.5), false);
  assert.equal(collision.solidCellAt(thin.x + 0.5, thin.y, thin.z + 0.5), false);
});
