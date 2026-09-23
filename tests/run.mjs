// テストをまとめて走らせる（`npm test`）。
//
// 中身は **Node に入っている `node:test`** で、枠組みは足していない（GS-30 と同じ考え）。
// TypeScript を読ませるために `tsx` だけ通す。
//
// この 1 枚が要るのは、Node 20 の `--test` が**フォルダを渡しても `.ts` を拾わない**ため
// （拾うのは `*.test.js` など）。並べてから渡すだけの間に合わせで、Node を上げたら消せる。

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(here, name));

if (files.length === 0) {
  console.error('テストが 1 つもありません（tests/*.test.ts）');
  process.exit(1);
}

const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
