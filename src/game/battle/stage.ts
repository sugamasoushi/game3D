// 戦闘の舞台（3D）の台帳（2026-10-19 / Battle Presentation Editor BPE-30）。`public/data/battleStages.json`。
// **コードに直書きしていた戦闘開始のカメラ（旧 `BATTLE_START_CAMERA`）とコマンド選択の左端の板（旧 `STAGE_COMMAND_FIGURE`）を台帳へ出し、
// マップごとに差し替えられるようにした。** 戦闘のマスの範囲と敵の数の最大も持つ。書くのは戦闘演出エディタだけ。
//
// `default` に共通の値を置き、`maps.<マップのid>` には差し替える項目だけを書く。構図（`start` / `command`）は**その欄専用**で、
// 差し替えるときは構図ごと書く（2026-10-19。構図の一覧から選ぶ形はやめた）。拡縮はマップの `CharacterScale` に準ずる。
// 台帳が読めない・値が壊れているときは、ここの既定値（直書きしていた値）を使う（1 つの書き間違いで戦闘を止めない）。

import { assetUrl } from '../assets';
import type { BattleCamera, BattleCameraKey } from './battleCamera';

/**
 * コマンドを選んでいる味方を画面の左端へ立たせる値（GS-103 / GS-108。旧 `STAGE_COMMAND_FIGURE`）。
 * - `x`: 板の中心の横位置。画面の幅に対する割合（0 が左端、1 が右端）。
 * - `depth`: カメラからの距離（マス）。小さいほど大きく、画面の下の方に立つ。
 * - `scale`: 板の大きさの倍率（1 で絵のまま）。
 * - `moveS`: 隊形の位置と左端を行き来する秒数（0 で瞬時）。
 * - `offsetX` / `offsetY` / `offsetZ`: 位置の微調整（マス）。カメラから見て右・上・奥へ。
 */
export interface BattleCommandFigure {
  x: number;
  depth: number;
  scale: number;
  moveS: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

/**
 * 戦闘のマス（隊形の `col` / `row` の 1 マス）。**味方と敵で 1 枚を共有する正方形**。
 * 1 マス = フィールドの 1 マス × マップの `CharacterScale`。フィールドのマスの区切りとは関係ない。
 * 向きはカメラから見た横（右が正）と奥（手前が正）。**原点は舞台の点（`BattleStage`）そのもの**——舞台の場所はマップエディタが決める。
 * `across` / `depth` は使ってよい番号の範囲（`[最小, 最大]`。エディタの表と検査が見る）。
 */
export interface BattleStageGrid {
  across: [number, number];
  depth: [number, number];
  /**
   * 床を探し始める高さ（2026-10-29 / GS-285）。舞台の点より何マス上から下へ探すか（フィールドのマス。0〜20）。
   * 書かなければ 0（舞台の点の 1 段上から。今までと同じ）。上げると崖の上にも立てる（屋根のある所では屋根に乗るので、マップごとに上げる）。
   */
  climb?: number;
  /** 高台とみなす高さ（舞台の点の床から何マス以上高いか。フィールドのマス。0.25〜20。書かなければ 1。GS-285）。 */
  highStep?: number;
}

/** 床を探し始める高さの既定（GS-285）。 */
export const DEFAULT_GRID_CLIMB = 0;
/** 高台とみなす高さの既定（GS-285）。 */
export const DEFAULT_HIGH_STEP = 1;
/** 書いていなければ既定を入れた高さの値。 */
export function gridHeights(grid: BattleStageGrid): { climb: number; highStep: number } {
  return { climb: grid.climb ?? DEFAULT_GRID_CLIMB, highStep: grid.highStep ?? DEFAULT_HIGH_STEP };
}

/** 構図 1 つ。台帳を読む人向けの名前を持てる。 */
export interface NamedBattleCamera extends BattleCamera {
  name?: string;
}

/** 1 つのマップの戦闘の舞台（共通の値に差し替えを重ねた後の形）。 */
export interface BattleStageSettings {
  /** 戦闘開始の構図（この欄専用）。舞台のカメラはこの構図で決まる（BattleStage から直接。`battleCamera.ts`）。 */
  start: NamedBattleCamera;
  /** コマンド選択の構図（この欄専用）。null なら無し。**今は再生しない**（味方の板を出すようになったら使う）。 */
  command: NamedBattleCamera | null;
  commandFigure: BattleCommandFigure;
  /**
   * このマップの戦闘に出る敵の数の最大（1〜6）。台帳エディタは敵シンボルのお供をこの範囲で決める
   * （触った 1 体と合わせて最大まで）。隊形の敵の枠はこの数以上要る。ゲームは数を切り詰めない（決めるのは台帳と検査）。
   */
  maxEnemies: number;
  grid: BattleStageGrid;
}

/** マップごとの差し替え。書いた項目だけ共通の値を差し替える（構図は構図ごと）。 */
export interface BattleStageOverride {
  start?: NamedBattleCamera;
  command?: NamedBattleCamera | null;
  commandFigure?: Partial<BattleCommandFigure>;
  maxEnemies?: number;
  grid?: Partial<BattleStageGrid>;
}

export interface BattleStageBook {
  version: 1;
  default: BattleStageSettings;
  maps?: Record<string, BattleStageOverride>;
}

/** 既定値。戦闘開始は直書きしていた見え方（元のカメラエディタの「戦闘開始！」`cue_1`）を BattleStage から直接の値に置き直した物。 */
export const DEFAULT_BATTLE_STAGES: BattleStageBook = {
  version: 1,
  default: {
    start: {
      name: '戦闘開始',
      duration: 1000,
      hold: true,
      keys: [
        { at: 0, yaw: 0, x: 0, y: 1.2, z: -1.2, distance: 8.5, height: 4.3 },
        { at: 500, x: 0, y: 1.2, z: -6.2, distance: 9, height: 2, tilt: false },
      ],
    },
    command: null,
    commandFigure: { x: 0.10, depth: 2, scale: 1, moveS: 0.25, offsetX: 0, offsetY: 0, offsetZ: 0 },
    maxEnemies: 3,
    grid: { across: [-6, 6], depth: [-5, 5] },
  },
  maps: {},
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const pair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n)) && value[0] <= value[1];

const FIGURE_KEYS = ['x', 'depth', 'scale', 'moveS', 'offsetX', 'offsetY', 'offsetZ'] as const;
const KEY_NUMBERS = ['yaw', 'x', 'y', 'z', 'distance', 'height'] as const;

function readFigure(raw: unknown, base: BattleCommandFigure): BattleCommandFigure {
  const next = { ...base };
  if (!object(raw)) return next;
  for (const key of FIGURE_KEYS) if (finite(raw[key])) next[key] = raw[key];
  return next;
}

function readGrid(raw: unknown, base: BattleStageGrid): BattleStageGrid {
  const next: BattleStageGrid = { across: [...base.across], depth: [...base.depth] };
  if (base.climb !== undefined) next.climb = base.climb;
  if (base.highStep !== undefined) next.highStep = base.highStep;
  if (!object(raw)) return next;
  if (pair(raw.across)) next.across = [raw.across[0], raw.across[1]];
  if (pair(raw.depth)) next.depth = [raw.depth[0], raw.depth[1]];
  if (finite(raw.climb) && raw.climb >= 0 && raw.climb <= 20) next.climb = raw.climb;
  if (finite(raw.highStep) && raw.highStep >= 0.25 && raw.highStep <= 20) next.highStep = raw.highStep;
  return next;
}

function readCamera(raw: unknown): NamedBattleCamera | null {
  if (!object(raw) || !finite(raw.duration) || raw.duration < 0 || !Array.isArray(raw.keys)) return null;
  const keys: BattleCameraKey[] = [];
  for (const key of raw.keys) {
    if (!object(key) || !finite(key.at)) continue;
    const next: BattleCameraKey = { at: key.at };
    for (const name of KEY_NUMBERS) if (finite(key[name])) next[name] = key[name];
    if (typeof key.tilt === 'boolean') next.tilt = key.tilt;
    keys.push(next);
  }
  keys.sort((a, b) => a.at - b.at);
  return { ...(typeof raw.name === 'string' ? { name: raw.name } : {}), duration: raw.duration, hold: raw.hold === true, keys };
}

/** 1 つのマップの値。共通の値（`base`）に差し替え（`raw`）を重ねる。 */
function readSettings(raw: unknown, base: BattleStageSettings): BattleStageSettings {
  if (!object(raw)) return structuredClone(base);
  return {
    start: readCamera(raw.start) ?? structuredClone(base.start),
    command: !('command' in raw) ? structuredClone(base.command) : raw.command === null ? null : readCamera(raw.command) ?? structuredClone(base.command),
    commandFigure: readFigure(raw.commandFigure, base.commandFigure),
    maxEnemies: Number.isInteger(raw.maxEnemies) && (raw.maxEnemies as number) >= 1 && (raw.maxEnemies as number) <= 6 ? raw.maxEnemies as number : base.maxEnemies,
    grid: readGrid(raw.grid, base.grid),
  };
}

/** 台帳の値を受ける。**知らない項目・型の違う値は捨てて既定値を使う。** */
export function readBattleStageBook(raw: unknown): BattleStageBook {
  const next = structuredClone(DEFAULT_BATTLE_STAGES);
  if (!object(raw)) return next;
  next.default = readSettings(raw.default, DEFAULT_BATTLE_STAGES.default);
  next.maps = {};
  if (object(raw.maps)) for (const [id, value] of Object.entries(raw.maps)) if (object(value)) next.maps[id] = value as BattleStageOverride;
  return next;
}

/** マップの値（共通の値に、そのマップの差し替えを重ねた物）。 */
export function battleStageSettingsOf(book: BattleStageBook, mapKey: string | null | undefined): BattleStageSettings {
  return readSettings(mapKey ? book.maps?.[mapKey] : undefined, book.default);
}

/**
 * 戦闘のマスの番号を、舞台の点からの横・奥（フィールドのマス）へ直す。
 * `characterScale` はマップの `CharacterScale`（マスの大きさに掛ける）。
 */
export function stageCellOffset(cell: { col: number; row: number }, characterScale: number): { across: number; depth: number } {
  return { across: cell.col * characterScale, depth: cell.row * characterScale };
}

let book: BattleStageBook = structuredClone(DEFAULT_BATTLE_STAGES);
/** 戦闘演出エディタの下書きを受けた。後から台帳を読み終えても上書きしない。 */
let previewed = false;
let pending: Promise<void> | null = null;

/** 台帳を読む。2 回目以降は同じ約束を返す。読めなければ既定値のまま。 */
export function loadBattleStages(): Promise<void> {
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(assetUrl('data/battleStages.json'), { cache: 'no-store' });
        if (!response.ok) return;
        const raw: unknown = await response.json();
        if (!previewed) book = readBattleStageBook(raw);
      } catch {
        /* 既定値のまま */
      }
    })();
  }
  return pending;
}

/** いまの台帳。 */
export function battleStageBook(): BattleStageBook {
  return book;
}

/** 戦闘演出エディタの下書きで差し替える（開発中だけ）。 */
export function previewBattleStages(next: unknown): void {
  previewed = true;
  book = readBattleStageBook(next);
}
