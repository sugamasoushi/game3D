// 依頼。内容は台帳、受注後の進捗はセーブに持つ。
//
// 目的の種類は `type`（省略は討伐。2026-11-02 に収集・配達・探索・選択を足した）。
// - 討伐 `hunt`: 受注後に倒した `enemy` を `count` 体。進捗は記録の `count`。
// - 収集 `collect`: 報告のときに `item` を `count` 個**持っていれば**達成（記録の `count` は使わない）。報告で渡して減る。
// - 配達 `deliver`: 受注のときに `item` を `count` 個受け取り、届け先で `quest` 命令（`mode: 'deliver'`）を呼ぶと渡す。
//   渡したら記録の `count` を必要数にして達成。報告は討伐と同じく依頼を受けた所の `quest` 命令（届け先に続けて置けばそこで報告）。
// - 探索 `explore`: `steps`（本筋と同じ形の段階）を `quest` 命令（`mode: 'step'`）で済ませて進め、最後の段階で達成。記録は `step`。
// - 選択 `choose`: `outcomes` の 1 つを `quest` 命令（`mode: 'result'`）で決めたら達成。記録は `result`。
//   報酬は結果の `gold`（書かなければ依頼の `gold`）。後の話は条件 `{ quest, result }` で分ける。
// 報告で報酬を受け取るのはどの種類も同じ。
//
// 依頼レベル（2026-11-02）: 仲間のレベルとは別の、依頼だけのレベル。報告で依頼の `exp`（依頼経験値）がたまり、
// 台帳の `levels`（レベル 2, 3, … に要る累計の経験値）でレベルが決まる。依頼の `level` に届かないうちは受けられない。
// 経験値はセーブの `questExp`、レベルはそこから毎回出す（持たない）。
import { assetUrl } from './assets';
import { advanceStory, doneCount, storyMeets, type StoryStep } from './story';
import type { GameState } from './state';
import type { QuestTalk } from '../event/interpreter';
import type { QuestIs, QuestScene, StoryIs, TalkLine } from '../event/types';

export type QuestType = 'hunt' | 'collect' | 'deliver' | 'explore' | 'choose';
export const QUEST_TYPES: readonly QuestType[] = ['hunt', 'collect', 'deliver', 'explore', 'choose'];
export const QUEST_TYPE_LABEL: Record<QuestType, string> = { hunt: '討伐', collect: '収集', deliver: '配達', explore: '探索', choose: '選択' };
/** 数（`count`）を使う種類。探索・選択は数を持たない。 */
export const COUNTED_TYPES: readonly QuestType[] = ['hunt', 'collect', 'deliver'];

/** 選択の依頼の結果 1 つ。 */
export interface QuestOutcome {
  /** 一覧・報告に出す結果の名前（例: 商人に渡した）。 */
  label: string;
  /** この結果の報酬金。書かなければ依頼の `gold`。 */
  gold?: number;
  /** この結果の依頼経験値。書かなければ依頼の `exp`。 */
  exp?: number;
  /** 報告した後の「これまでの話」に出す一言。 */
  log?: string;
}

export interface QuestDef {
  name: string;
  text?: string;
  /** 報告先の案内（例: リッカ村の受付）。 */
  client?: string;
  /** 目的の種類。省略は討伐。 */
  type?: QuestType;
  /** 討伐の敵（`enemies.json`）。 */
  enemy?: string;
  /** 収集・配達の品（`items.json`）。 */
  item?: string;
  /** 配達の届け先の案内（例: ガルド村の薬師）。 */
  to?: string;
  /** 討伐数・集める数・届ける数。探索・選択は書かない。 */
  count?: number;
  /** 選択の依頼の、決めるまでの目的（例: 拾った指輪を誰に渡すか決める）。 */
  goal?: string;
  /** 探索の段階。並びが順番。 */
  steps?: StoryStep[];
  /** 選択の結果。キーが結果の id。 */
  outcomes?: Record<string, QuestOutcome>;
  gold: number;
  /** 報告でもらう依頼経験値。書かなければ 0。 */
  exp?: number;
  /** 受けられる依頼レベル。書かなければ 1（いつでも受けられる）。 */
  level?: number;
}
export interface QuestBook {
  quests: Record<string, QuestDef>;
  /** 依頼レベルの表。`levels[0]` がレベル 2 に要る累計の依頼経験値、`levels[1]` がレベル 3 …（増えていく）。書かなければレベル 1 のまま。 */
  levels?: number[];
}
/**
 * `count` は討伐数（討伐）・渡した数（配達）。収集・探索・選択では使わない。
 * `step` は探索の最後に済ませた段階、`result` は選択の結果（2026-11-02。どちらも書かなければ無し）。
 */
export interface QuestProgress { count: number; completed: boolean; step?: string; result?: string }
/** 依頼の状態。受けていない／受注中・未達成／達成・報告待ち／報告済み。 */
export type QuestStatusNow = 'notTaken' | 'active' | 'ready' | 'done';
type QuestState = Pick<GameState, 'quests' | 'gold' | 'items' | 'questExp'>;

let book: QuestBook = { quests: {} };
let loading: Promise<void> | undefined;
export function loadQuestBook(): Promise<void> {
  return loading ??= (async () => {
    const response = await fetch(assetUrl('data/quests.json'));
    if (!response.ok) throw new Error('依頼の台帳を読み込めません');
    book = await response.json() as QuestBook;
  })().catch((error) => { loading = undefined; throw error; });
}
export const questBook = (): QuestBook => book;

export const questType = (def: QuestDef): QuestType => def.type ?? 'hunt';
/** 必要な数。数を持たない種類・書いていないときは 1。 */
export const questCount = (def: QuestDef): number => def.count ?? 1;
const stepIds = (def: QuestDef): string[] => (def.steps ?? []).map((step) => step.id);
const defOf = (source: QuestBook, id: string): QuestDef | undefined => (Object.hasOwn(source.quests, id) ? source.quests[id] : undefined);
const outcomeOf = (def: QuestDef, result: string | undefined): QuestOutcome | undefined =>
  result && def.outcomes && Object.hasOwn(def.outcomes, result) ? def.outcomes[result] : undefined;

const held = (state: Pick<GameState, 'items'>, id: string | undefined): number => (id ? state.items.get(id) ?? 0 : 0);

/** 持ち物を足す・減らす。0 個になったら消す（`state.ts` の決まり）。 */
function addItem(state: Pick<GameState, 'items'>, id: string, count: number): void {
  const next = held(state, id) + count;
  if (next > 0) state.items.set(id, next);
  else state.items.delete(id);
}

/** 依頼の今の状態。台帳から消えた依頼は、報告済みなら done、ほかは active（報酬の対象にしない）。 */
export function questStatus(state: Pick<GameState, 'quests' | 'items'>, id: string, source = book): QuestStatusNow {
  const progress = state.quests.get(id);
  if (!progress) return 'notTaken';
  if (progress.completed) return 'done';
  const def = defOf(source, id);
  if (!def) return 'active';
  const type = questType(def);
  if (type === 'explore') {
    const ids = stepIds(def);
    return ids.length > 0 && doneCount(ids, progress.step ?? '') >= ids.length ? 'ready' : 'active';
  }
  if (type === 'choose') return outcomeOf(def, progress.result) ? 'ready' : 'active';
  const now = type === 'collect' ? held(state, def.item) : progress.count;
  return now >= questCount(def) ? 'ready' : 'active';
}

/** 条件「依頼」。`taken` は受注中（未達成と報告待ちのどちらも）。 */
export function questMeets(state: Pick<GameState, 'quests' | 'items'>, id: string, is: QuestIs, source = book): boolean {
  const now = questStatus(state, id, source);
  return is === 'taken' ? now === 'active' || now === 'ready' : now === is;
}

/**
 * 条件「依頼の段階」（探索）。見方は本筋と同じ（次／済んだ／まだ）。
 * **受けていない依頼は、どの段階も「次」でも「済んだ」でもない**（受ける前に手がかりの人が話し出さないように）。
 * 報告済みなら全部済んだ扱い。台帳に無い依頼・段階はどれにも当たらない。
 */
export function questStepMeets(state: Pick<GameState, 'quests'>, id: string, step: string, is: StoryIs, source = book): boolean {
  const def = defOf(source, id);
  if (!def) return false;
  const ids = stepIds(def);
  if (!ids.includes(step)) return false;
  const progress = state.quests.get(id);
  if (!progress) return is === 'notDone';
  return storyMeets(ids, progress.completed ? ids[ids.length - 1] : progress.step ?? '', step, is);
}

/** 条件「依頼の結果」（選択）。決めた結果がこれか（報告の前後どちらでも）。 */
export function questResultIs(state: Pick<GameState, 'quests'>, id: string, result: string): boolean {
  return state.quests.get(id)?.result === result;
}

/** 受注。配達はここで届ける品を渡す。依頼レベルが足りなければ受けない。 */
export function acceptQuest(state: Pick<GameState, 'quests' | 'items' | 'questExp'>, id: string, source = book): boolean {
  const def = defOf(source, id);
  if (!def || state.quests.has(id) || questLocked(state, id, source)) return false;
  state.quests.set(id, { count: 0, completed: false });
  if (questType(def) === 'deliver' && def.item) addItem(state, def.item, questCount(def));
  return true;
}

/** 同じ敵を対象にする受注中の討伐依頼すべてへ、倒した実数を足す。 */
export function recordQuestKills(state: Pick<GameState, 'quests'>, enemies: readonly string[], source = book): void {
  const kills = new Map<string, number>();
  for (const enemy of enemies) kills.set(enemy, (kills.get(enemy) ?? 0) + 1);
  for (const [id, progress] of state.quests) {
    const def = source.quests[id];
    if (!def || progress.completed || questType(def) !== 'hunt' || !def.enemy) continue;
    progress.count = Math.min(questCount(def), progress.count + (kills.get(def.enemy) ?? 0));
  }
}

/**
 * 届け先で品を渡す。受注中・まだ渡していない配達だけ。
 * `delivered` 渡した／`missing` 品が足りない／`none` 渡す物が無い（受けていない・渡し済み・配達でない）。
 */
export function deliverQuest(state: Pick<GameState, 'quests' | 'items'>, id: string, source = book): 'delivered' | 'missing' | 'none' {
  const def = defOf(source, id);
  const progress = state.quests.get(id);
  if (!def || !progress || progress.completed || questType(def) !== 'deliver' || !def.item || progress.count >= questCount(def)) return 'none';
  if (held(state, def.item) < questCount(def)) return 'missing';
  addItem(state, def.item, -questCount(def));
  progress.count = questCount(def);
  return 'delivered';
}

/** 探索の段階を済ませる。受注中・報告前の探索だけ。**先へ進めるだけ**。進めたら true。 */
export function questStepDone(state: Pick<GameState, 'quests'>, id: string, step: string, source = book): boolean {
  const def = defOf(source, id);
  const progress = state.quests.get(id);
  if (!def || !progress || progress.completed || questType(def) !== 'explore' || !stepIds(def).includes(step)) return false;
  const next = advanceStory(stepIds(def), progress.step ?? '', step);
  if (next === (progress.step ?? '')) return false;
  progress.step = next;
  return true;
}

/** 選択の結果を決める。受注中・まだ決めていない選択だけ（**一度決めたら変えない**）。決めたら true。 */
export function questResultSet(state: Pick<GameState, 'quests'>, id: string, result: string, source = book): boolean {
  const def = defOf(source, id);
  const progress = state.quests.get(id);
  if (!def || !progress || progress.completed || questType(def) !== 'choose' || progress.result || !outcomeOf(def, result)) return false;
  progress.result = result;
  return true;
}

/** 依頼経験値 `exp` の依頼レベル。表の数を超えたら最後のレベルで止まる。 */
export function questLevelOf(exp: number, source = book): number {
  let level = 1;
  for (const need of source.levels ?? []) {
    if (exp < need) break;
    level += 1;
  }
  return level;
}

/** 今の依頼レベルと、次のレベルまで（最後のレベルなら `next` は null）。メニューの「クエスト」に出す。 */
export function questLevelInfo(exp: number, source = book): { level: number; exp: number; floor: number; next: number | null } {
  const level = questLevelOf(exp, source);
  const levels = source.levels ?? [];
  return { level, exp, floor: level >= 2 ? levels[level - 2] : 0, next: level - 1 < levels.length ? levels[level - 1] : null };
}

/** 受けるのに要る依頼レベル（書かなければ 1）。 */
export const questNeed = (def: QuestDef): number => def.level ?? 1;

/** 依頼レベルが足りずに受けられないか。受けた後は関係ない。 */
export function questLocked(state: Pick<GameState, 'questExp'>, id: string, source = book): boolean {
  const def = defOf(source, id);
  return !!def && questLevelOf(state.questExp, source) < questNeed(def);
}

/** 依頼経験値。選択は結果の `exp`（書かなければ依頼の `exp`）。 */
export function questExpReward(def: QuestDef, progress?: QuestProgress): number {
  return outcomeOf(def, progress?.result)?.exp ?? def.exp ?? 0;
}

/** 報酬金。選択は結果の `gold`（書かなければ依頼の `gold`）。 */
export function questReward(def: QuestDef, progress?: QuestProgress): number {
  return outcomeOf(def, progress?.result)?.gold ?? def.gold;
}

/** 受注中の目的の文。探索は次に起きる段階の目的（書いていなければ一つ前…と遡る）、選択は `goal`。無ければ ''。 */
export function questGoalText(def: QuestDef, progress?: QuestProgress): string {
  const type = questType(def);
  if (type === 'choose') return def.goal?.trim() ? def.goal : '';
  if (type !== 'explore') return '';
  const steps = def.steps ?? [];
  const done = Math.min(doneCount(stepIds(def), progress?.step ?? ''), steps.length - 1);
  for (let at = done; at >= 0; at -= 1) if (steps[at]?.goal?.trim()) return steps[at].goal!;
  return '';
}

/** 達成確認と報酬受取を同時に行う。収集はここで品を渡す。再報告・二重クリックでは増えない。 */
export function reportQuest(state: QuestState, id: string, source = book): boolean {
  if (questStatus(state, id, source) !== 'ready') return false;
  const def = source.quests[id];
  const progress = state.quests.get(id)!;
  if (questType(def) === 'collect' && def.item) addItem(state, def.item, -questCount(def));
  progress.completed = true;
  state.gold += questReward(def, progress);
  state.questExp += questExpReward(def, progress);
  return true;
}

const optional = (has: unknown, line: string): string[] => (has ? [line] : []);

/** 書かない場面の文。{…} は `fillQuestText` が依頼の値に置き換える。 */
export const QUEST_DEFAULT_TALK: Record<QuestScene, (def: QuestDef) => string[]> = {
  offer: (def) => {
    const type = questType(def);
    const goal = type === 'collect' ? ['{item}を {count} 個集める']
      : type === 'deliver' ? [questCount(def) > 1 ? '{item}を {count} 個、{to}へ届ける' : '{item}を {to}へ届ける']
        : type === 'explore' || type === 'choose' ? optional(questGoalText(def), '{goal}')
          : ['{enemy}を {count} 体討伐'];
    // 選択で結果ごとの報酬金があれば、受ける前は額を言わない（決めるまで分からない）。
    const varies = type === 'choose' && Object.values(def.outcomes ?? {}).some((one) => one.gold !== undefined && one.gold !== def.gold);
    const expVaries = type === 'choose' && Object.values(def.outcomes ?? {}).some((one) => one.exp !== undefined && one.exp !== (def.exp ?? 0));
    return ['【{name}】', ...optional(def.text, '{text}'), ...goal, varies ? '報酬：結果しだい' : '報酬：{gold} G',
      ...(expVaries ? ['依頼経験値：結果しだい'] : optional(questExpReward(def) > 0, '依頼経験値：{exp}')),
      ...optional(questNeed(def) > 1, '受けられる依頼レベル：{level}'), ...optional(def.client, '報告先：{client}')];
  },
  accepted: (def) => {
    const type = questType(def);
    if (type === 'collect') return ['依頼を受注しました。{item}が {count} 個そろったら報告してください。'];
    if (type === 'deliver') return ['依頼を受注しました。', questCount(def) > 1 ? '{item}を {count} 個受け取った。' : '{item}を受け取った。'];
    if (type === 'explore' || type === 'choose') return ['依頼を受注しました。'];
    return ['依頼を受注しました。受注後に倒した敵を数えます。'];
  },
  progress: (def) => {
    const type = questType(def);
    if (type === 'collect') return ['【{name}】', '{item}：{now} / {count} 個', 'そろったら報告してください。'];
    if (type === 'deliver') return ['【{name}】', '{item}を {to}へ届けてください。'];
    if (type === 'explore' || type === 'choose') return ['【{name}】', '{goal}'];
    return ['【{name}】', '{enemy}：{now} / {count} 体', '討伐が終わったら報告してください。'];
  },
  report: (def) => {
    const type = questType(def);
    if (type === 'collect') return ['「{name}」の品がそろいました。', '{item}を {count} 個渡して {gold} G を受け取りますか？'];
    if (type === 'deliver') return ['「{name}」の品を届けました。', '報告して {gold} G を受け取りますか？'];
    if (type === 'choose') return ['「{name}」：{result}', '報告して {gold} G を受け取りますか？'];
    if (type === 'explore') return ['「{name}」をやり遂げました。', '報告して {gold} G を受け取りますか？'];
    return ['「{name}」を達成しました。', '報告して {gold} G を受け取りますか？'];
  },
  reward: (def) => [...optional(questType(def) === 'collect', '{item}を {count} 個渡した。'), '報酬 {gold} G を受け取りました。'],
  done: () => ['「{name}」は報告済みです。'],
  handover: () => ['{to}に {item}を届けた。'],
  missing: () => ['届ける {item}を持っていません。'],
};

/** 依頼レベルが足りないとき（受注の説明の後に出す。イベントでは書き換えない）。 */
export const QUEST_LOCKED_TEXT = '依頼レベル {level} から受けられます。（今の依頼レベル {mylevel}）';
/** 報告で依頼経験値をもらったとき・依頼レベルが上がったとき（報酬の文の後に出す。イベントでは書き換えない）。 */
export const QUEST_EXP_TEXT = '依頼経験値 {exp} を得た。';
export const QUEST_LEVEL_UP_TEXT = '依頼レベルが {mylevel} に上がった！';

/** 文の中の {name} {text} {client} {enemy} {item} {to} {count} {now} {gold} {goal} {result} {exp} {level} {mylevel} を置き換える。知らない {…} はそのまま。 */
export function fillQuestText(line: string, values: Record<string, string>): string {
  return line.replace(/\{([a-z]+)\}/g, (all, key: string) => (Object.hasOwn(values, key) ? values[key] : all));
}

/** `quest` 命令の使い方。省略は依頼を受けた所（受注・進捗・報告）。 */
export type QuestMode = 'deliver' | 'step' | 'result';

/**
 * ゲーム本体の会話・選択肢を使う。受注と報告は同じイベント命令。
 * - `mode: 'deliver'` は配達の届け先——受注中で未配達なら品を渡し、それ以外は何もしない（イベントの条件「依頼」で分ける）。
 * - `mode: 'step'` は探索の段階 `value` を済ませる、`mode: 'result'` は選択の結果 `value` を決める。どちらも黙って記録だけ変える
 *   （会話はイベントに書く。受けていない・報告済み・種類違いなら何もしない）。
 */
export async function talkQuest(state: QuestState, id: string, ui: {
  message(talk: TalkLine[]): Promise<void>;
  choice(choices: string[], cancel?: number): Promise<number>;
  enemyName(id: string): string;
  itemName?(id: string): string;
}, source = book, talk: QuestTalk = {}, mode?: QuestMode, value = ''): Promise<void> {
  const def = defOf(source, id);
  if (!def) { await ui.message([{ lines: ['この依頼は見つかりません。'] }]); return; }
  if (mode === 'step') { questStepDone(state, id, value, source); return; }
  if (mode === 'result') { questResultSet(state, id, value, source); return; }
  const say = (scene: QuestScene) => {
    const progress = state.quests.get(id);
    const type = questType(def);
    const goal = questGoalText(def, progress);
    const values: Record<string, string> = {
      name: def.name, text: def.text ?? '', client: def.client ?? '', to: def.to ?? '',
      enemy: def.enemy ? ui.enemyName(def.enemy) : '', item: def.item ? (ui.itemName?.(def.item) ?? def.item) : '',
      count: String(questCount(def)), now: String(type === 'collect' ? held(state, def.item) : progress?.count ?? 0),
      gold: questReward(def, progress).toLocaleString('ja-JP'),
      goal: goal || '依頼の途中です。', result: outcomeOf(def, progress?.result)?.label ?? '',
      exp: questExpReward(def, progress).toLocaleString('ja-JP'), level: String(questNeed(def)), mylevel: String(questLevelOf(state.questExp, source)),
    };
    const written = talk[scene];
    const own = written && written.lines.some((line) => line.trim() !== '');
    const lines = (own ? written.lines : QUEST_DEFAULT_TALK[scene](def)).map((line) => fillQuestText(line, values));
    return ui.message([own ? { ...written, lines } : { lines }]);
  };
  /** 決まった 1 行（依頼レベルの知らせ）。 */
  const note = (line: string) => ui.message([{ lines: [fillQuestText(line, {
    exp: questExpReward(def, state.quests.get(id)).toLocaleString('ja-JP'), level: String(questNeed(def)), mylevel: String(questLevelOf(state.questExp, source)),
  })] }]);
  if (mode === 'deliver') {
    const result = deliverQuest(state, id, source);
    if (result === 'delivered') await say('handover');
    else if (result === 'missing') await say('missing');
    return;
  }
  const status = questStatus(state, id, source);
  if (status === 'done') { await say('done'); return; }
  if (status === 'notTaken') {
    await say('offer');
    if (questLocked(state, id, source)) { await note(QUEST_LOCKED_TEXT); return; }
    if (await ui.choice(['受注する', 'やめる'], 1) !== 0) return;
    if (acceptQuest(state, id, source)) await say('accepted');
    return;
  }
  if (status === 'active') { await say('progress'); return; }
  await say('report');
  if (await ui.choice(['報告する', 'あとで'], 1) !== 0) return;
  const before = questLevelOf(state.questExp, source);
  if (!reportQuest(state, id, source)) return;
  await say('reward');
  if (questExpReward(def, state.quests.get(id)) > 0) await note(QUEST_EXP_TEXT);
  if (questLevelOf(state.questExp, source) > before) await note(QUEST_LEVEL_UP_TEXT);
}
