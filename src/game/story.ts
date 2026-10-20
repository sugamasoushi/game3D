// 物語の段階（GS-254）。本筋の進み具合を、順番付きの台帳 `data/story.json` で持つ。
//
// それまでは `EVENT010101` のようなスイッチを段階ごとに 1 つずつ持ち、
// 「010302 は済んで 010401 はまだ」と 2 つ並べて順番を表していた。番号はマップと結び付けるつもりだったが
// 合わなくなり、段階を途中に足すと振り直しになった。**順番は台帳の並びが持つ**ようにした。
//
// - 記録が持つのは「最後に済ませた段階の id」だけ（`GameState.story`。'' は何も済んでいない）。
//   台帳の途中に段階を足しても、記録を書き直さずに済む。
// - 条件は `{ story: "<段階>", is: "next" | "done" | "notDone" }`。`next` は「次に起きるのがこの段階」。
// - 命令 `{ type: "story", done: "<段階>" }` は**先へ進めるだけ**。済んだ段階より前を渡しても戻らない。
// 本筋と関係ない、その場かぎりの覚えはスイッチ（`setSwitch`）で持つ。

import type { StoryIs } from '../event/types';
import { assetUrl } from './assets';

/** 台帳の 1 段階。 */
export interface StoryStep {
  id: string;
  /** エディタに出す名前。ゲームは読まない。 */
  label: string;
}

/**
 * 章（2026-10-19）。段階の並びを、続いた段階ごとに見出しで区切る。**エディタだけが読む**（台帳エディタの一覧・
 * イベントエディタの選択肢）。ゲームは読まない。並びは変えないので、章を足しても消しても本筋の順番は同じ。
 */
export interface StoryChapter {
  /** 章が始まる段階の id。次の章の `from` の前までがこの章。 */
  from: string;
  /** 章の名前。 */
  label: string;
}

/** 台帳 `data/story.json`。 */
export interface StoryFile {
  /** 章。段階の並びの順に書く。最初の章より前の段階は章なし。 */
  chapters?: StoryChapter[];
  steps: StoryStep[];
}

/** 段階の id を並び順で。読む前は空。 */
let order: string[] = [];
let pending: Promise<string[]> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**（条件は同期で見るので、遊ぶ前に読んでおく）。 */
export function loadStoryBook(): Promise<string[]> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/story.json'))
    .then((response) => (response.ok ? (response.json() as Promise<StoryFile>) : null))
    .then((file) => (file?.steps ?? []).map((step) => step.id))
    .catch((error) => {
      console.warn('[story] 台帳を読めなかった', error);
      return [];
    })
    .then((ids) => {
      order = ids;
      return ids;
    });
  return pending;
}

/** 読み終えた段階の並び。 */
export function storyOrder(): readonly string[] {
  return order;
}

/** 済んだ段階の数。`progress` は最後に済ませた段階（'' は無し）。台帳に無い段階なら 0 として扱う。 */
export function doneCount(steps: readonly string[], progress: string): number {
  if (!progress) return 0;
  const at = steps.indexOf(progress);
  if (at < 0) {
    console.warn(`[story] 記録の段階が台帳にありません: ${progress}`);
    return 0;
  }
  return at + 1;
}

/** 段階の条件を満たすか。台帳に無い段階はどれにも当たらない（Game Checker が知らせる）。 */
export function storyMeets(steps: readonly string[], progress: string, step: string, is: StoryIs): boolean {
  const at = steps.indexOf(step);
  if (at < 0) return false;
  const done = doneCount(steps, progress);
  if (is === 'next') return at === done;
  if (is === 'done') return at < done;
  return at >= done;
}

/** 段階を済ませた後の記録。**先へ進めるだけ**——済んだ段階より前なら変えない。台帳に無ければ変えない。 */
export function advanceStory(steps: readonly string[], progress: string, step: string): string {
  const at = steps.indexOf(step);
  if (at < 0) {
    console.warn(`[story] 台帳に無い段階です: ${step}`);
    return progress;
  }
  return at + 1 > doneCount(steps, progress) ? step : progress;
}
