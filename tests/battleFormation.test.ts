import test from 'node:test';
import assert from 'node:assert/strict';
import { battleFormationSlots, chooseBattleFormation, loadBattleBook } from '../src/game/battle/book';

test('戦闘隊形は人数別スロットを読み、配列順と高さを保つ', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = String(input);
    const value = path.endsWith('battleFormations.json')
      ? { default: 'twoRows', formations: {
        alternate: { party: {} },
        twoRows: { party: { '3': [
        { across: -1, depth: 2, height: 0 },
        { across: 1, depth: 2, height: 0 },
        { across: 0, depth: 4, height: 0.5 },
      ] } },
      } }
      : {};
    return new Response(JSON.stringify(value), { status: 200 });
  }) as typeof fetch;
  try {
    await loadBattleBook();
    assert.deepEqual(battleFormationSlots('twoRows', 'party', 3), [
      { across: -1, depth: 2, height: 0 },
      { across: 1, depth: 2, height: 0 },
      { across: 0, depth: 4, height: 0.5 },
    ]);
    assert.equal(battleFormationSlots('twoRows', 'party', 2), null);
    assert.equal(battleFormationSlots('missing', 'party', 3), null);
    assert.equal(chooseBattleFormation('alternate', ['twoRows'], () => 0), 'alternate');
    assert.equal(chooseBattleFormation(undefined, ['twoRows', 'alternate'], () => 0.99), 'alternate');
    assert.equal(chooseBattleFormation('missing', ['missing'], () => 0), 'twoRows');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
