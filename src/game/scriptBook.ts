// `script` の登録先（GS-45）。**イベントからの逃げ道**（構想 §4.1）。
//
// JSON にコードは書かない（GS-06）。書けるのは**ここに登録した関数の名前**だけ。
// 命令表（`types.ts` / `interpreter.ts`）を増やすほどではない**一度きりの演出**を、
// 型を触らずに置くための口。
//
//   { "type": "script", "id": "オープニングの演出", "args": { "ms": 3000 } }
//
// 逆に、**何度も使うもの・他でも使えるものはここへ書かない**。
//   - 命令の並びで書けるなら → 共通イベント（`data/commonEvents.json`。GS-44）
//   - どのイベントでも使うなら → 命令を 1 つ足す（`types.ts` と `interpreter.ts`）
//
// ここが太ってきたら、それは「命令にすべきものが混ざっている」合図。

import type { EventContext } from '../event/interpreter';

/**
 * 登録する関数の形。
 * `ctx` は**イベントから見える世界そのもの**（会話・歩き・スイッチ…）なので、
 * 命令でできることはここでもできる。`args` は JSON にそのまま書いた値。
 */
export type ScriptFn = (args: Record<string, unknown>, ctx: EventContext) => Promise<void> | void;

/**
 * 登録の表。**ここに 1 行足すだけ**で `script` から呼べるようになる。
 *
 * 名前は日本語でよい（スイッチや変数と同じ）。イベントエディタは
 * **この並びをそのまま読んで一覧に出す**ので、`'名前': 関数,` の形は崩さないこと。
 */
export const SCRIPTS: Record<string, ScriptFn> = {
  // 例（消してよい）。`{ "type": "script", "id": "ためし", "args": { "ms": 500 } }` で呼べる。
  ためし: async (args, ctx) => {
    const ms = typeof args.ms === 'number' ? args.ms : 300;
    await ctx.wait(ms);
    console.info(`[script] ためし: ${ms}ms 待った`);
  },
};

/** 名前で引く。無ければ null。 */
export function scriptFn(id: string): ScriptFn | null {
  return SCRIPTS[id] ?? null;
}

/** 登録してある名前。開発中に確かめるとき用。 */
export function scriptList(): string[] {
  return Object.keys(SCRIPTS);
}
