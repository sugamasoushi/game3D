// クエストの一覧（2026-11-02）。本筋・サブストーリー・依頼を、メニュー「クエスト」に並べる共通の形へ直す。
//
// 3 つは持ち方が違う（本筋は `story.json` と最後に済ませた段階、サブストーリーは話ごとの段階、
// 依頼は受注と進み具合）。画面がそれぞれを知らずに済むよう、ここで「名前・状態・今の目的・詳しく」に揃える。
// 台帳と記録を引数で受け、画面にも Game Checker のテストにも同じ関数を使う。

import { doneCount, type StoryFile, type StoryStep } from './story';
import type { SubstoryBook } from './substories';
import { QUEST_TYPE_LABEL, questCount, questGoalText, questExpReward, questReward, questStatus, questType, type QuestBook, type QuestProgress } from './quests';

export type QuestKind = 'main' | 'sub' | 'request';
/** 進行中／達成して報告待ち（依頼だけ）／完了。始まっていないものは一覧に出さない。 */
export type QuestStatus = 'active' | 'ready' | 'done';

export const QUEST_KIND_LABEL: Record<QuestKind, string> = { main: 'メイン', sub: 'サブ', request: '依頼' };
export const QUEST_STATUS_LABEL: Record<QuestStatus, string> = { active: '進行中', ready: '達成・報告待ち', done: '完了' };

export interface QuestEntry {
  kind: QuestKind;
  id: string;
  title: string;
  status: QuestStatus;
  /** 今の目的。完了したものと、目的を書いていないものは無し。 */
  goal?: string;
  /** 本筋の今の章の名前。 */
  chapter?: string;
  /** サブストーリーの案内・依頼の報告先。 */
  client?: string;
  /** 依頼の説明。 */
  text?: string;
  /** 済んだ段階のあらすじ（古い順）。 */
  log: string[];
  /**
   * 依頼の目的と報酬。台帳から消えた依頼は無し。
   * `label` は種類、`target` は敵・品の名前（探索・選択は空）、`unit` は数の単位（配達・選択は数を出さない）、`result` は選択の決めた結果。
   */
  request?: { label: string; target: string; now: number; count: number; unit?: '体' | '個' | '段階'; to?: string; result?: string; gold: number; exp: number };
}

/**
 * 段階の並びと済んだ数から、目的とあらすじを取る。
 * 目的は**次に起きる段階**の `goal`。書いていなければ一つ前、さらに前…と遡る（内側の区切りやネタバレの段階で目的を消さない）。
 */
function stepsView(steps: readonly StoryStep[], done: number): { goal?: string; log: string[] } {
  const log = steps.slice(0, done).flatMap((step) => (step.log?.trim() ? [step.log] : []));
  if (done >= steps.length) return { log };
  for (let at = done; at >= 0; at -= 1) {
    const goal = steps[at]?.goal?.trim();
    if (goal) return { goal: steps[at].goal, log };
  }
  return { log };
}

/** 本筋。目的もあらすじも書いていない間（台帳を直す前）は出さない。 */
export function mainQuest(book: StoryFile, progress: string, title = 'メインストーリー'): QuestEntry | null {
  const steps = book.steps;
  if (!steps.length) return null;
  const done = doneCount(steps.map((step) => step.id), progress);
  const view = stepsView(steps, done);
  const status: QuestStatus = done >= steps.length ? 'done' : 'active';
  if (!view.goal && !view.log.length) return null;
  // 章は、次に起きる段階（済んでいれば最後の段階）が入っている章。
  const at = Math.min(done, steps.length - 1);
  let chapter: string | undefined;
  for (const one of book.chapters ?? []) {
    const from = steps.findIndex((step) => step.id === one.from);
    if (from >= 0 && from <= at) chapter = one.label;
  }
  return { kind: 'main', id: 'main', title, status, chapter, log: view.log, ...(view.goal ? { goal: view.goal } : {}) };
}

/** サブストーリー。始まった話だけ（記録に段階があり、台帳にある話）。台帳の並び順。 */
export function subQuests(book: SubstoryBook, progress: ReadonlyMap<string, string>): QuestEntry[] {
  const list: QuestEntry[] = [];
  for (const [id, def] of Object.entries(book.substories)) {
    const step = progress.get(id);
    if (!step) continue;
    const ids = def.steps.map((one) => one.id);
    if (!ids.includes(step)) continue;
    const done = doneCount(ids, step);
    const view = stepsView(def.steps, done);
    list.push({
      kind: 'sub',
      id,
      title: def.name,
      status: done >= ids.length ? 'done' : 'active',
      log: view.log,
      ...(view.goal ? { goal: view.goal } : {}),
      ...(def.client ? { client: def.client } : {}),
    });
  }
  return list;
}

/**
 * 依頼。受注した順。台帳から消えた依頼は名前を id で出し、数は出さない。
 * 収集の数と報告待ちは今の持ち物（`items`）で見る。
 */
export function requestQuests(
  book: QuestBook,
  progress: ReadonlyMap<string, QuestProgress>,
  enemyName: (id: string) => string = (id) => id,
  items: ReadonlyMap<string, number> = new Map(),
  itemName: (id: string) => string = (id) => id,
): QuestEntry[] {
  const state = { quests: progress as Map<string, QuestProgress>, items: items as Map<string, number> };
  return [...progress].map(([id, one]) => {
    const def = Object.hasOwn(book.quests, id) ? book.quests[id] : undefined;
    const now = questStatus(state, id, book);
    const status: QuestStatus = now === 'done' ? 'done' : now === 'ready' ? 'ready' : 'active';
    if (!def) return { kind: 'request', id, title: id, status, log: [] };
    const type = questType(def);
    const need = questCount(def);
    const item = def.item ? itemName(def.item) : '';
    const target = type === 'hunt' ? enemyName(def.enemy ?? '') : type === 'collect' || type === 'deliver' ? item : '';
    const doing = type === 'collect' ? `${item}を ${need} 個集める`
      : type === 'deliver' ? `${item}を${def.to ? ` ${def.to}へ` : ''}届ける`
        : type === 'explore' || type === 'choose' ? questGoalText(def, one)
          : `${target}を ${need} 体討伐`;
    const goal = status === 'active' ? doing || undefined : status === 'ready' ? (def.client ? `${def.client}に報告する` : '依頼を受けた相手に報告する') : undefined;
    const outcome = one.result && def.outcomes && Object.hasOwn(def.outcomes, one.result) ? def.outcomes[one.result] : undefined;
    // あらすじ: 探索は済んだ段階の log、選択は決めた結果の log。
    const steps = def.steps ?? [];
    const doneSteps = type === 'explore' ? (one.completed ? steps.length : doneCount(steps.map((step) => step.id), one.step ?? '')) : 0;
    const log = type === 'explore'
      ? steps.slice(0, doneSteps).flatMap((step) => (step.log?.trim() ? [step.log] : []))
      : outcome?.log?.trim() ? [outcome.log] : [];
    const meter = type === 'explore'
      ? { now: doneSteps, count: steps.length, unit: '段階' as const }
      : type === 'choose' ? { now: outcome ? 1 : 0, count: 1 }
        : type === 'deliver' ? { now: one.count, count: need }
          : { now: type === 'collect' ? Math.min(need, items.get(def.item ?? '') ?? 0) : one.count, count: need, unit: type === 'hunt' ? '体' as const : '個' as const };
    return {
      kind: 'request',
      id,
      title: def.name,
      status,
      log,
      request: {
        label: QUEST_TYPE_LABEL[type], target, ...meter, gold: questReward(def, one), exp: questExpReward(def, one),
        ...(type === 'deliver' && def.to ? { to: def.to } : {}),
        ...(outcome ? { result: outcome.label } : {}),
      },
      ...(goal ? { goal } : {}),
      ...(def.text ? { text: def.text } : {}),
      ...(def.client ? { client: def.client } : {}),
    };
  });
}

/** 並べる順。進行中・報告待ちを上に、完了を下に（同じ状態の中は元の並びのまま）。 */
export function sortQuests(list: readonly QuestEntry[]): QuestEntry[] {
  return list
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => Number(a.entry.status === 'done') - Number(b.entry.status === 'done') || a.at - b.at)
    .map(({ entry }) => entry);
}
