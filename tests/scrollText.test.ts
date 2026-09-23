// 流れる文字の速さ（GS-144）。
//
// **総時間ではなく 1 行ぶんの時間で決める。** 総時間で決めていたころは、
// 5 行のエンディング（9 秒）が 16 行のオープニング（40 秒）の 3 倍の速さで
// 流れていた——どちらも「時間どおり」なのに、読めるのは片方だけだった。
// 画面では「なんとなく速い」しか分からないので、ここで数字を留める。

import { strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SCROLL_SPEED } from '../src/event/interpreter';
import { DEFAULT_OPTIONS } from '../src/game/options';
import { scrollMs } from '../src/ui/store';

/** 画面（1280×720。DEC-162）と文字の行送り（font 20px × line-height 2）。 */
const SCREEN_H = 720;
const LINE_H = 40;

const msFor = (lines: number, speed = SCROLL_SPEED) => scrollMs(SCREEN_H, lines * LINE_H, LINE_H, speed);

test('行が増えれば時間も増える。**1 行ぶんの速さは変わらない**', () => {
  const short = msFor(5);
  const long = msFor(16);
  strictEqual(long > short, true);
  // 1 行が流れる時間はどちらも同じ＝読む速さが同じ。
  const per = (ms: number, lines: number) => ms / (SCREEN_H / LINE_H + lines);
  strictEqual(Math.round(per(short, 5)), SCROLL_SPEED);
  strictEqual(Math.round(per(long, 16)), SCROLL_SPEED);
});

test('既定（1 行 1.8 秒）ならオープニング 16 行は 61 秒', () => {
  strictEqual(SCROLL_SPEED, 1800);
  strictEqual(msFor(16), 61200);
  // エンディング 5 行は 41.4 秒。総時間指定のころは 9 秒で、速すぎて読めなかった。
  strictEqual(msFor(5), 41400);
});

test('速さを倍にすれば時間も倍', () => {
  strictEqual(msFor(16, SCROLL_SPEED * 2), msFor(16) * 2);
});

test('設定の倍率は台帳の速さに掛かる。**既定は台帳どおり（×1）**', () => {
  strictEqual(DEFAULT_OPTIONS.scrollScale, 1);
  // 設定で 2 倍にすれば、流れる時間も 2 倍（`MessageWindow` が掛ける）。
  strictEqual(msFor(16, SCROLL_SPEED * DEFAULT_OPTIONS.scrollScale), 61200);
});

test('行の高さが 0 でも落ちない（測れなかったとき）', () => {
  strictEqual(Number.isFinite(scrollMs(SCREEN_H, 640, 0, 1200)), true);
});

// ---- 台帳のほう。`ms` が残っていると**既定の速さで流れてしまう** ----------

test('イベントの `scroll` は `speed` で書く。`ms` は残っていない', () => {
  const dir = join(import.meta.dirname, '..', 'public', 'data', 'events');
  for (const name of ['0101_home.json', '0102_HomeForest.json']) {
    const text = readFileSync(join(dir, name), 'utf8');
    const book = JSON.parse(text) as { events: { id: string; commands: unknown[] }[] };
    const walk = (cmds: unknown[], where: string) => {
      for (const one of cmds as Record<string, unknown>[]) {
        if (one.type === 'scroll') {
          strictEqual('ms' in one, false, `${where} の scroll に古い ms が残っている`);
          strictEqual(typeof one.speed, 'number', `${where} の scroll に speed が無い`);
        }
        for (const branch of (one.branches as unknown[][]) ?? []) walk(branch, where);
        for (const key of ['then', 'else']) if (Array.isArray(one[key])) walk(one[key] as unknown[], where);
      }
    };
    for (const event of book.events) walk(event.commands, `${name}:${event.id}`);
  }
});
