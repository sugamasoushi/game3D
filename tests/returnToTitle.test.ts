import test from 'node:test';
import assert from 'node:assert/strict';
import { ReturnToTitle, runCommands, type EventContext } from '../src/event/interpreter';
import type { EventCommand } from '../src/event/types';

test('負けたらが未指定・空ならゲームオーバー、命令があれば敗北を許可する', async () => {
  const allowed: boolean[] = [];
  const ctx = {
    battle: async (_enemies: string[], canLose: boolean) => { allowed.push(canLose); return 'win'; },
  } as unknown as EventContext;
  await runCommands([
    { type: 'battle', enemies: ['enemy01'] },
    { type: 'battle', enemies: ['enemy01'], lose: [] },
    { type: 'battle', enemies: ['enemy01'], lose: [{ type: 'returnToTitle' }] },
  ], ctx);
  assert.deepEqual(allowed, [false, false, true]);
});

test('タイトルへの遷移完了を待ってイベントの後続を打ち切る', async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const ctx = {
    returnToTitle: () => new Promise<void>((resolve) => { calls.push('title'); finish = resolve; }),
    script: async (id: string) => { calls.push(id); },
  } as unknown as EventContext;
  const run = runCommands([{ type: 'returnToTitle' }, { type: 'script', id: 'after' }], ctx);
  const result = assert.rejects(run, ReturnToTitle);
  assert.deepEqual(calls, ['title']);
  finish();
  await result;
  assert.deepEqual(calls, ['title']);
});

test('共通イベント内でタイトルへ戻ると呼び出し元の続きも打ち切る', async () => {
  const calls: string[] = [];
  const ctx = {
    returnToTitle: async () => { calls.push('title'); },
    common: () => [{ type: 'returnToTitle' }, { type: 'script', id: 'inside' }] as EventCommand[],
    script: async (id: string) => { calls.push(id); },
  } as unknown as EventContext;
  await assert.rejects(runCommands([{ type: 'callCommon', id: 'ending' }, { type: 'script', id: 'outside' }], ctx), ReturnToTitle);
  assert.deepEqual(calls, ['title']);
});
