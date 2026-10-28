// セーブ（GS-04 / GS-05 / GS-27）。**遊んだ記録**を書き出して読み戻す。
//
// 決めごと（note §3）
//   - **初期データとセーブは別物**。初期値は `public/data/`、記録はこの入れ物
//   - スイッチ・変数は**文字列キー**（`"home_出発した"`）。番号は破綻する
//   - **セルフスイッチ**を最初から持つ（「この宝箱は開けた」を後から足せない）
//   - **クリア後**はスイッチ 1 個で済ませない。周回数・クリア回数・引き継ぎの器を先に置く
//   - **版番号**を持つ。読めない古い記録を黙って壊さない
//
// 置き場所は IndexedDB。localStorage でも入る大きさだが、
// **後で持ち物や隊列が増える**ことを見込んでいる（容量と型の自由が要る）。
// 設定（`options.ts`）はここに入れない——**端末の好み**であって遊んだ記録ではない。

import type { WalkDir } from './GameView';
import { CLEAR_SWITCH } from './omake';
import { loadMapIndex, mapLabel } from './mapIndex';

/** セーブの形の版（GS-27）。形を変えたらここを上げ、読む側で古い版を判別する。 */
export const SAVE_VERSION = 6;
/**
 * 読める版（GS-46）。**欄を足しただけなら古い版も読む**——足りない欄は `fromSave` が既定で埋める。
 * 読めなくなる変え方（欄の意味を変えるなど）をしたときだけ、ここから外す。
 *
 *   6 …… マップの id を名前にし（`0101` → `home`）、本筋の進み具合を物語の段階（`story`）で持つ版（GS-254）。
 *        スイッチの向きも変えた（書いていなければ false）。**5 までの記録は読まない**（場所もスイッチも意味が変わった）。
 */
const READABLE = new Set([6]);

/** その記録は読めるか。 */
export function readableSave(version: number): boolean {
  return READABLE.has(version);
}
/** 手で書く枠の数。 */
export const SAVE_SLOTS = 3;
/**
 * オートセーブの枠（GS-33）。**手で書く枠とは別に 1 つ**持つ。
 * 同じ 3 枠に混ぜると、大事に取っておいた記録を勝手に上書きしてしまう。
 */
export const AUTO_SLOT = 0;

/** 枠の名前。一覧に出す。 */
export function slotLabel(slot: number): string {
  return slot === AUTO_SLOT ? 'オート' : String(slot);
}

/** 1 枠ぶん。 */
export interface SaveData {
  version: number;
  /** 書いた時刻（一覧に出す）。 */
  savedAt: number;
  /** 遊んだ秒。 */
  playSeconds: number;
  /** どこに居たか。マップは台帳の id（`home`）、位置はマス。 */
  map: string;
  at: { x: number; y: number; z: number };
  facing: WalkDir;
  /** 物語の段階（GS-254）。最後に済ませた段階の id。'' は何も済んでいない。 */
  story: string;
  /** スイッチ・変数・セルフスイッチ。キーは文字列。スイッチは書いていなければ false（GS-254）。 */
  switches: Record<string, boolean>;
  variables: Record<string, number>;
  /**
   * 持ち物（GS-46。版 2 から）。**id → 個数**。0 個になったものは持たない。
   * 名前と説明は台帳（`data/items.json`）が持つので、ここには数だけ。
   */
  items?: Record<string, number>;
  /**
   * 隊列と仲間のいまの状態（GS-60。版 3 から）。**満タンの値は台帳**
   * （`data/party.json`）が持つので、ここには減っているぶんと覚えた技だけ。
   */
  party?: string[];
  members?: Record<
    string,
    {
      level?: number;
      exp?: number;
      hp?: number;
      mp?: number;
      skills?: string[];
      equip?: Record<string, string>;
      ailments?: string[];
    }
  >;
  /** 所持金（版 3 から）。 */
  gold?: number;
  /** いまの時間帯（GS-222）。光のプリセットの id。'' は時間帯なし。無い記録は台帳の始まりで埋める。 */
  time?: string;
  /** 時計（GS-222）。 */
  clock?: { running: boolean; ms: number };
  /** セルフスイッチ。キーは `<マップ>/<イベント>/<名前>`。 */
  self: Record<string, boolean>;
  /**
   * クリア後・周回（GS-05）。**まだ使わないが器は置く**——
   * 後から足すと、それまでのセーブが読めなくなる。
   */
  clear: {
    /** クリアした回数。 */
    count: number;
    /** 何周目か。1 が初回。 */
    lap: number;
    /** 次の周へ持ち越すもの。名前と値だけ。 */
    carry: Record<string, number | boolean | string>;
  };
}

/** 一覧に出す 1 行。中身は読まない。 */
export interface SaveSummary {
  slot: number;
  savedAt: number;
  playSeconds: number;
  map: string;
  /** 画面に出すマップの名前（台帳 `maps.json` の `name`。無ければ `map` の id）。 */
  mapName: string;
  /** 読めない版（未来のセーブなど）。 */
  stale: boolean;
  /** クリアのフラグ（`ゲーム_クリア`）が立っている記録か（GS-212。タイトルの「おまけ」）。 */
  cleared: boolean;
}

const DB_NAME = 'samplegame';
const DB_VERSION = 1;
const STORE = 'saves';

/** 開く。無ければ作る。 */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function writeSave(slot: number, data: SaveData): Promise<void> {
  await run('readwrite', (store) => store.put(data, slot));
}

export async function readSave(slot: number): Promise<SaveData | null> {
  const data = await run<SaveData | undefined>('readonly', (store) => store.get(slot));
  if (!data) return null;
  // **読めない版は渡さない。** 中途半端に読むと、遊べるように見えて壊れる。
  // ただし「欄が足りないだけ」の古い版は読む（GS-46）——`fromSave` が既定で埋める。
  if (!readableSave(data.version)) return null;
  return data;
}

export async function eraseSave(slot: number): Promise<void> {
  await run('readwrite', (store) => store.delete(slot));
}

/** 枠の一覧。空き枠は入らない。 */
export async function listSaves(): Promise<SaveSummary[]> {
  const out: SaveSummary[] = [];
  const maps = await loadMapIndex();
  for (let slot = AUTO_SLOT; slot <= SAVE_SLOTS; slot += 1) {
    const data = await run<SaveData | undefined>('readonly', (store) => store.get(slot)).catch(() => undefined);
    if (!data) continue;
    out.push({
      slot,
      savedAt: data.savedAt ?? 0,
      playSeconds: data.playSeconds ?? 0,
      map: data.map ?? '',
      mapName: mapLabel(maps, data.map ?? ''),
      stale: !readableSave(data.version),
      cleared: data.switches?.[CLEAR_SWITCH] === true,
    });
  }
  return out;
}

/** 「1 時間 02 分」。一覧に出す。 */
export function playTimeLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} 時間 ${String(minutes).padStart(2, '0')} 分` : `${minutes} 分`;
}

/** 「9/6 12:34」。 */
export function savedAtLabel(savedAt: number): string {
  if (!savedAt) return '';
  const at = new Date(savedAt);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getMonth() + 1}/${at.getDate()} ${two(at.getHours())}:${two(at.getMinutes())}`;
}
