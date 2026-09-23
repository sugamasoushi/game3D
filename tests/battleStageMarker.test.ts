import test from 'node:test';
import assert from 'node:assert/strict';
import { battleStageMarker, battleStageMarkers } from '../src/game/battleStageMarker';
import type { MapDef } from '../src/mep3d/types';

const point = (name: string, properties: Array<{ name: string; type: 'boolean'; value: boolean }>) => ({
  id: name, name, kind: 'point' as const, collision: false, properties, y: 3, points: [[4, 5] as [number, number]],
});
const map = (objects: ReturnType<typeof point>[]) => ({ layers: [{ id: 'objects', name: 'objects', kind: 'object' as const,
  parent: '', visible: true, opacity: 1, collision: false, properties: [], batches: [], objects }] }) as Pick<MapDef, 'layers'>;

test('戦闘舞台は表示名ではなく BattleStage=true で検出する', () => {
  const value = map([
    point('戦闘の舞台', []),
    point('任意の表示名', [{ name: 'BattleStage', type: 'boolean', value: true }]),
  ]);
  assert.deepEqual(battleStageMarker(value), { id: '任意の表示名', name: '任意の表示名', x: 4, y: 3, z: 5 });
});

test('BattleStageが無い場合は3D舞台を作らず、複数候補は一覧化できる', () => {
  assert.equal(battleStageMarker(map([point('戦闘の舞台', [])])), null);
  assert.equal(battleStageMarkers(map([
    point('A', [{ name: 'BattleStage', type: 'boolean', value: true }]),
    point('B', [{ name: 'battlestage', type: 'boolean', value: true }]),
  ])).length, 2);
});
