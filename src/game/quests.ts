// 討伐依頼。内容は台帳、受注後の進捗はセーブに持つ。
import { assetUrl } from './assets';
import type { GameState } from './state';

export interface QuestDef {
  name: string;
  text?: string;
  /** 報告先の案内（例: リッカ村の受付）。 */
  client?: string;
  enemy: string;
  count: number;
  gold: number;
}
export interface QuestBook { quests: Record<string, QuestDef> }
export interface QuestProgress { count: number; completed: boolean }
type QuestState = Pick<GameState, 'quests' | 'gold'>;

let book: QuestBook = { quests: {} };
let loading: Promise<void> | undefined;
export function loadQuestBook(): Promise<void> {
  return loading ??= (async () => {
    const response = await fetch(assetUrl('data/quests.json'));
    if (!response.ok) throw new Error('討伐依頼の台帳を読み込めません');
    book = await response.json() as QuestBook;
  })().catch((error) => { loading = undefined; throw error; });
}
export const questBook = (): QuestBook => book;

export function acceptQuest(state: QuestState, id: string, source = book): boolean {
  if (!Object.hasOwn(source.quests, id) || state.quests.has(id)) return false;
  state.quests.set(id, { count: 0, completed: false });
  return true;
}

/** 同じ敵を対象にする受注中の依頼すべてへ、倒した実数を足す。 */
export function recordQuestKills(state: Pick<GameState, 'quests'>, enemies: readonly string[], source = book): void {
  const kills = new Map<string, number>();
  for (const enemy of enemies) kills.set(enemy, (kills.get(enemy) ?? 0) + 1);
  for (const [id, progress] of state.quests) {
    const def = source.quests[id];
    if (!def || progress.completed) continue;
    progress.count = Math.min(def.count, progress.count + (kills.get(def.enemy) ?? 0));
  }
}

/** 達成確認と報酬受取を同時に行う。再報告・二重クリックでは増えない。 */
export function reportQuest(state: QuestState, id: string, source = book): boolean {
  const def = source.quests[id];
  const progress = state.quests.get(id);
  if (!def || !progress || progress.completed || progress.count < def.count) return false;
  progress.completed = true;
  state.gold += def.gold;
  return true;
}

/** ゲーム本体の会話・選択肢を使う。受注と報告は同じイベント命令。 */
export async function talkQuest(state: QuestState, id: string, ui: {
  message(talk: { lines: string[] }[]): Promise<void>;
  choice(choices: string[], cancel?: number): Promise<number>;
  enemyName(id: string): string;
}, source = book): Promise<void> {
  const def = source.quests[id];
  const say = (...lines: string[]) => ui.message([{ lines }]);
  if (!def) { await say('この依頼は見つかりません。'); return; }
  const progress = state.quests.get(id);
  if (progress?.completed) { await say(`「${def.name}」は報告済みです。`); return; }
  if (!progress) {
    await say(`【${def.name}】`, ...(def.text ? [def.text] : []),
      `${ui.enemyName(def.enemy)}を ${def.count} 体討伐`, `報酬：${def.gold.toLocaleString('ja-JP')} G`,
      ...(def.client ? [`報告先：${def.client}`] : []));
    if (await ui.choice(['受注する', 'やめる'], 1) !== 0) return;
    if (acceptQuest(state, id, source)) await say('依頼を受注しました。受注後に倒した敵を数えます。');
    return;
  }
  if (progress.count < def.count) {
    await say(`【${def.name}】`, `${ui.enemyName(def.enemy)}：${progress.count} / ${def.count} 体`, '討伐が終わったら報告してください。');
    return;
  }
  await say(`「${def.name}」を達成しました。`, `報告して ${def.gold.toLocaleString('ja-JP')} G を受け取りますか？`);
  if (await ui.choice(['報告する', 'あとで'], 1) !== 0) return;
  if (reportQuest(state, id, source)) await say(`報酬 ${def.gold.toLocaleString('ja-JP')} G を受け取りました。`);
}
