// 遊んでいる間の記録（GS-27）。**セーブに入るものは全部ここ**に集める。
//
// スイッチ・変数・セルフスイッチ・周回。ばらばらに持つと、書き出すときに
// 「どれを入れ忘れたか」が分からなくなる。1 つにしておけば `toSave` を見れば済む。
//
// 設定（`options.ts`）はここに**入れない**。あちらは端末の好みで、枠ごとに変わらない。

import type { TimeClock } from './timeClock';
import type { SaveData } from './save';
import { SAVE_VERSION } from './save';
import type { WalkDir } from './GameView';

export interface GameState {
  /** 物語の段階（GS-254）。最後に済ませた段階の id。'' は何も済んでいない。本筋の進み具合はここだけ。 */
  story: string;
  /** フラグ。本筋と関係ない、その場かぎりの覚え。**書いていなければ false**（GS-254）。読むときは `switchOn()` を通す。 */
  switches: Map<string, boolean>;
  variables: Map<string, number>;
  /** セルフスイッチ。キーは `<マップ>/<イベント>/<名前>`。 */
  self: Map<string, boolean>;
  clear: SaveData['clear'];
  /** 持ち物（GS-46）。**id → 個数**。0 個になったら消す（「0 個持っている」を残さない）。 */
  items: Map<string, number>;
  /** 遊んだ秒。読み込んだ記録の続きから数える。 */
  playSeconds: number;
  /** 隊列（GS-60）。人のキーを並び順で。**先頭がメニューの左に出る人。** */
  party: string[];
  /** 仲間のいまの状態。キーは人。**満タンの値は台帳**（`data/party.json`）。 */
  members: Map<string, MemberState>;
  /** 所持金。戦って増える（GS-60）。 */
  gold: number;
  /** いまの時間帯（GS-222）。光のプリセットの id。'' は時間帯なし（マップの基準の光）。 */
  time: string;
  /** 時計（GS-222）。実時間で時間帯を進める。 */
  clock: TimeClock;
}

/**
 * フラグを読む。**書いていなければ false**（GS-254。セルフフラグと同じ向き）。
 *
 * それまでは旧作と同じく「書いていなければ true＝まだ動ける」で、イベントが終わりに自分のフラグを
 * false にして本筋の順番を表していた（GS-147）。読むたびに頭の中で反転させることになり、
 * 順番は物語の段階（`story.ts`）が持つようにしたので、フラグは「起きたら立てる」覚えだけにした。
 */
export function switchOn(state: Pick<GameState, 'switches'>, key: string): boolean {
  return state.switches.get(key) ?? false;
}

/**
 * 仲間 1 人のいまの状態（GS-60）。**遊んだ結果だけ**を持つ。
 * 満タンの HP・攻撃力は台帳が持ち、ここには入れない——
 * 台帳の数字を直したときに、遊んでいる人だけ古い値のまま残らないように。
 */
export interface MemberState {
  level: number;
  /** 溜めた経験。**まだ使わないが器は置く**（`clear` と同じ理由）。 */
  exp: number;
  /** いまの HP・MP。 */
  hp: number;
  mp: number;
  /** 覚えている技（`data/skills.json` の id）。 */
  skills: string[];
  /**
   * かかっている状態異常（GS-71）。**戦いが終わっても続く物だけ**が入る
   * （毒は続き、眠りは覚める。どれが続くかは `data/ailments.json` の `keep`）。
   */
  ailments: string[];
  /**
   * 身に着けている物（GS-67）。**置き場所 → 持ち物の id**。
   * **身に着けた物は袋（`items`）から出す**——外すと戻る。
   * 両方に置くと「装備している剣を売る」ができてしまう。
   */
  equip: Record<string, string>;
}

/** どこに居るか。セーブのときに 3D から聞く。 */
export interface Progress {
  map: string;
  at: { x: number; y: number; z: number };
  facing: WalkDir;
}

/** はじめから。 */
export function newState(): GameState {
  return {
    story: '',
    switches: new Map(),
    variables: new Map(),
    self: new Map(),
    clear: { count: 0, lap: 1, carry: {} },
    items: new Map(),
    playSeconds: 0,
    party: [],
    members: new Map(),
    gold: 0,
    time: '',
    clock: { running: false, ms: 0 },
  };
}

/**
 * 持ち物を 1 つ減らす（GS-64）。**0 個になったら消す**（「0 個持っている」を残さない）。
 * 持っていなければ false——減らせなかったことを呼ぶ側が知れるようにする。
 */
export function spendItem(state: GameState, id: string, count = 1): boolean {
  const have = state.items.get(id) ?? 0;
  const take = Math.max(1, Math.trunc(count));
  if (have < take) return false;
  const next = have - take;
  if (next > 0) state.items.set(id, next);
  else state.items.delete(id);
  return true;
}

/** セルフスイッチのキー。イベントの中からは名前（`A`）だけ書く。 */
export function selfKey(map: string, event: string, name: string): string {
  return `${map}/${event}/${name}`;
}

export function toSave(state: GameState, progress: Progress): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    playSeconds: Math.round(state.playSeconds),
    map: progress.map,
    at: progress.at,
    facing: progress.facing,
    story: state.story,
    switches: Object.fromEntries(state.switches),
    variables: Object.fromEntries(state.variables),
    self: Object.fromEntries(state.self),
    items: Object.fromEntries(state.items),
    party: state.party.slice(),
    members: Object.fromEntries(
      [...state.members].map(([who, one]) => [
        who,
        { ...one, skills: one.skills.slice(), equip: { ...one.equip }, ailments: one.ailments.slice() },
      ]),
    ),
    gold: state.gold,
    time: state.time,
    clock: { running: state.clock.running, ms: Math.round(state.clock.ms) },
    clear: { count: state.clear.count, lap: state.clear.lap, carry: { ...state.clear.carry } },
  };
}

/**
 * 読んだ記録を、いま遊んでいる入れ物へ移す（つづきから）。
 * **入れ物は差し替えず中身を移す**——イベントの道具立てが同じ入れ物を握っている。
 * **`GameState` の欄は全部ここで移す**。画面の側で 1 つずつ書くと、欄を足したときに移し忘れる
 * （物語の段階 `story` を移し忘れ、読み直すとイベントが始めからになっていた）。
 */
export function restoreState(target: GameState, loaded: GameState): void {
  (Object.keys(loaded) as (keyof GameState)[]).forEach((key) => {
    (target as unknown as Record<string, unknown>)[key] = loaded[key];
  });
}

/**
 * はじめから（GS-265）。遊んでいる入れ物を**欄ごと全部** `newState()` に戻す。
 * 欄を 1 つずつ書いて戻していたころは物語の段階（`story`）が漏れ、
 * セーブ → タイトル → はじめからで、済ませたイベント（breakfast）が動かなかった。
 * 仲間・時間帯は台帳から入れ直すので、呼んだ側がこの後で埋める。
 */
export function resetState(target: GameState): void {
  restoreState(target, newState());
}

export function fromSave(data: SaveData): { state: GameState; progress: Progress } {
  return {
    state: {
      story: typeof data.story === 'string' ? data.story : '',
      switches: new Map(Object.entries(data.switches ?? {})),
      variables: new Map(Object.entries(data.variables ?? {})),
      self: new Map(Object.entries(data.self ?? {})),
      // 古い記録に器が無くても既定で埋める（読めなくしない）。
      clear: {
        count: data.clear?.count ?? 0,
        lap: data.clear?.lap ?? 1,
        carry: { ...(data.clear?.carry ?? {}) },
      },
      // 版 1 の記録には持ち物が無い。空で始める（GS-46）。
      items: new Map(Object.entries(data.items ?? {})),
      playSeconds: data.playSeconds ?? 0,
      // 版 2 までの記録には仲間が無い。空で読んでおき、台帳から入れ直す（GS-60）。
      party: (data.party ?? []).slice(),
      members: new Map(
        Object.entries(data.members ?? {}).map(([who, one]) => [
          who,
          {
            level: one.level ?? 1,
            exp: one.exp ?? 0,
            hp: one.hp ?? 0,
            mp: one.mp ?? 0,
            skills: (one.skills ?? []).slice(),
            // 版 3 の記録には装備が無い。空で始める（GS-67）。
            equip: { ...(one.equip ?? {}) },
            // 版 4 までの記録には状態異常が無い（GS-71）。
            ailments: (one.ailments ?? []).slice(),
          },
        ]),
      ),
      gold: data.gold ?? 0,
      // 時間帯と時計（GS-222）。古い記録には無い——時間帯なし・止まった時計で始める（呼ぶ側が台帳の始まりで埋める）。
      time: typeof data.time === 'string' ? data.time : '',
      clock: { running: data.clock?.running === true, ms: Math.max(0, data.clock?.ms ?? 0) },
    },
    progress: { map: data.map, at: data.at, facing: data.facing },
  };
}
