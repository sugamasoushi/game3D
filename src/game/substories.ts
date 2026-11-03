// サブストーリー（2026-11-02）。本筋とは別に進む小さな話を、**本筋と同じ「順番付きの段階」**で持つ。
//
// - 台帳 `data/substories.json` の `substories` は id → `{ name, client?, steps }`。段階の形は本筋（`story.ts`）と同じ。
// - 記録は話ごとに「最後に済ませた段階の id」だけ（`GameState.substories`）。**最初の段階を済ませたら始まり**、
//   最後の段階を済ませたら完了。まだ何も済んでいない話は記録に無く、一覧にも出さない。
// - 条件は `{ substory: "<話>", step: "<段階>", is: "next" | "done" | "notDone" }`、
//   済ませる命令は `{ type: "substory", id: "<話>", done: "<段階>" }`（先へ進めるだけ）。
//   見方と進め方は本筋の `storyMeets` / `advanceStory` をそのまま使う。

import { assetUrl } from './assets';
import { advanceStory, storyMeets, type StoryStep } from './story';
import type { StoryIs } from '../event/types';

/** サブストーリー 1 つ。 */
export interface SubstoryDef {
  /** 一覧に出す名前。 */
  name: string;
  /** 誰の話か・どこの話かの案内（例: リッカ村の鶏小屋の主人）。 */
  client?: string;
  steps: StoryStep[];
}

/** 台帳 `data/substories.json`。 */
export interface SubstoryBook {
  substories: Record<string, SubstoryDef>;
}

let book: SubstoryBook = { substories: {} };
let pending: Promise<SubstoryBook> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**（条件は同期で見るので、遊ぶ前に読んでおく）。無ければ空。 */
export function loadSubstoryBook(): Promise<SubstoryBook> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/substories.json'))
    .then((response) => (response.ok ? (response.json() as Promise<SubstoryBook>) : null))
    .catch((error) => {
      console.warn('[substory] 台帳を読めなかった', error);
      return null;
    })
    .then((file) => {
      book = { substories: file?.substories ?? {} };
      return book;
    });
  return pending;
}

/** 読み終えた台帳。読む前は空。 */
export function substoryBook(): SubstoryBook {
  return book;
}

/** 話の段階の id を並び順で。台帳に無い話は空。 */
function stepIds(source: SubstoryBook, id: string): string[] {
  return Object.hasOwn(source.substories, id) ? source.substories[id].steps.map((step) => step.id) : [];
}

/** サブストーリーの条件を満たすか。台帳に無い話・段階はどれにも当たらない（Game Checker が知らせる）。 */
export function substoryMeets(
  progress: ReadonlyMap<string, string>,
  id: string,
  step: string,
  is: StoryIs,
  source = book,
): boolean {
  return storyMeets(stepIds(source, id), progress.get(id) ?? '', step, is);
}

/** 話の段階を済ませる。**先へ進めるだけ**。台帳に無い話・段階なら変えない。 */
export function advanceSubstory(progress: Map<string, string>, id: string, step: string, source = book): void {
  if (!Object.hasOwn(source.substories, id)) {
    console.warn(`[substory] 台帳に無い話です: ${id}`);
    return;
  }
  const next = advanceStory(stepIds(source, id), progress.get(id) ?? '', step);
  if (next) progress.set(id, next);
}
