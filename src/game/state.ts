// 遊んでいる間の記録（GS-27）。**セーブに入るものは全部ここ**に集める。
//
// スイッチ・変数・セルフスイッチ・周回。ばらばらに持つと、書き出すときに
// 「どれを入れ忘れたか」が分からなくなる。1 つにしておけば `toSave` を見れば済む。
//
// 設定（`options.ts`）はここに**入れない**。あちらは端末の好みで、枠ごとに変わらない。

import type { SaveData } from './save';
import { SAVE_VERSION } from './save';
import type { WalkDir } from './GameView';

export interface GameState {
  /**
   * フラグ（GS-147）。**true＝まだ動ける／false＝もう動かない（済み）**。
   * 読むときは必ず `switchOn()` を通す——**書いていなければ true**（旧作と同じ向き）。
   */
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
}

/**
 * フラグを読む（GS-147）。**書いていなければ「まだ動ける」（true）**。
 *
 * 旧作（`EventFlagData.getFlag`）と同じ向き——`savedata.json` に書いていない物は
 * 実行可能、`false` と書いた物だけ止まる。イベントは**終わりに自分のフラグを `false`**にして
 * 「もう動かない」と覚える。
 *
 * **セルフフラグ（宝箱の「開けた」）はこの逆**で、未設定＝false（まだ開けていない）。
 * あちらは「済んだ覚え」で、こちらは「動いてよいか」。混ぜないこと。
 */
export function switchOn(state: Pick<GameState, 'switches'>, key: string): boolean {
  return state.switches.get(key) ?? true;
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
    switches: new Map(),
    variables: new Map(),
    self: new Map(),
    clear: { count: 0, lap: 1, carry: {} },
    items: new Map(),
    playSeconds: 0,
    party: [],
    members: new Map(),
    gold: 0,
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
    clear: { count: state.clear.count, lap: state.clear.lap, carry: { ...state.clear.carry } },
  };
}

export function fromSave(data: SaveData): { state: GameState; progress: Progress } {
  return {
    state: {
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
    },
    progress: { map: data.map, at: data.at, facing: data.facing },
  };
}
