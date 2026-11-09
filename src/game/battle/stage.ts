// 戦闘の舞台（3D）の台帳（2026-10-19 / Battle Presentation Editor BPE-30）。`public/data/battleStages.json`。
// **コードに直書きしていた戦闘開始のカメラ（旧 `BATTLE_START_CAMERA`）とコマンド選択の左端の板（旧 `STAGE_COMMAND_FIGURE`）を台帳へ出し、
// マップごとに差し替えられるようにした。** 戦闘のマスの範囲と敵の数の最大も持つ。書くのは戦闘演出エディタだけ。
//
// `default` に共通の値を置き、`maps.<マップのid>` には差し替える項目だけを書く。構図（`start` / `command`）は**その欄専用**で、
// 差し替えるときは構図ごと書く（2026-10-19。構図の一覧から選ぶ形はやめた）。拡縮はマップの `CharacterScale` に準ずる。
// 台帳が読めない・値が壊れているときは、ここの既定値（直書きしていた値）を使う（1 つの書き間違いで戦闘を止めない）。

import { assetUrl } from '../assets';
import type { BattleCamera, BattleCameraKey } from './battleCamera';
import { CELL_MARKS, type CellMark } from './height';

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
  /** 飛ぶ敵を床から浮かせる高さ（戦闘のマス。CharacterScale を掛ける。0〜10。書かなければ 1.5。2026-10-30 / GS-288）。 */
  flyHeight?: number;
}

/** 床を探し始める高さの既定（GS-285）。 */
export const DEFAULT_GRID_CLIMB = 0;
/** 高台とみなす高さの既定（GS-285）。 */
export const DEFAULT_HIGH_STEP = 1;
/** 飛ぶ敵を浮かせる高さの既定（GS-288）。 */
export const DEFAULT_FLY_HEIGHT = 1.5;
/** 書いていなければ既定を入れた高さの値。 */
export function gridHeights(grid: BattleStageGrid): { climb: number; highStep: number; flyHeight: number } {
  return { climb: grid.climb ?? DEFAULT_GRID_CLIMB, highStep: grid.highStep ?? DEFAULT_HIGH_STEP, flyHeight: grid.flyHeight ?? DEFAULT_FLY_HEIGHT };
}

/** 味方の板の大きさの倍率の範囲と既定（GS-309）。戦闘演出エディタの `validate.mjs` の `PARTY_SCALE_RANGE` と同じ。 */
export const PARTY_SCALE_RANGE = [0.25, 4] as const;
export const DEFAULT_PARTY_SCALE = 1;
/** 書いていなければ既定を入れた、味方の板の大きさの倍率。 */
export function partyScaleOf(settings: Pick<BattleStageSettings, 'partyScale'>): number {
  return settings.partyScale ?? DEFAULT_PARTY_SCALE;
}

/**
 * 戦闘の絵の 1 マスの画素（2026-11-08 / GS-322。`figurePx`。8〜1024）。舞台の板（敵・味方）の大きさは
 * 「絵の画素 ÷ これ × 倍率 × CharacterScale」。コマンド戦闘の絵はフィールドのドット絵より細かく描くので、マップの 1 マスの画素
 * （`tilePx`）とは別に持つ。書かなければマップの `tilePx`（前の決め方）。コマンド戦闘の技の絵もこれで数える（GS-325。フィールドの技の絵はマップの 1 マスの画素）。
 */
export const FIGURE_PX_RANGE = [8, 1024] as const;
/**
 * 敵の攻撃を受けたときの画面の揺れ（2026-11-09 / GS-337。`hitShake`）。カメラを揺らす（カメラエディタの演出「impact」と同じ揺れ。
 * `GameView.playShot` の `shake`）。`ms` は長さ（0〜3000）、`power` は揺れ幅（マス。0〜5。0 で揺らさない）。
 * 書かなければ前に使っていた impact と同じ 450ms・0.5。項目ごとに共通の値・マップで差し替える。
 * `timing`（GS-338・GS-339）は揺らす時: `impact`＝当たったとき（既定。技の絵が終わり、当たった音〈`se.hit`〉と隊列の窓のアイコンの点滅と同じ瞬間。
 * かわされたら揺らさない）／`lunge`＝攻めかかったとき（攻撃の音と同時。前の動き）。
 */
export type HitShakeTiming = 'impact' | 'lunge';
export const HIT_SHAKE_TIMINGS: readonly HitShakeTiming[] = ['impact', 'lunge'];
export interface BattleHitShake {
  ms: number;
  power: number;
  timing: HitShakeTiming;
}
export const HIT_SHAKE_RANGES = { ms: [0, 3000], power: [0, 5] } as const;
export const DEFAULT_HIT_SHAKE: BattleHitShake = { ms: 450, power: 0.5, timing: 'impact' };
/** 書いていなければ既定を入れた、被弾の揺れ。 */
export function hitShakeOf(settings: Pick<BattleStageSettings, 'hitShake'>): BattleHitShake {
  return {
    ms: settings.hitShake?.ms ?? DEFAULT_HIT_SHAKE.ms,
    power: settings.hitShake?.power ?? DEFAULT_HIT_SHAKE.power,
    timing: settings.hitShake?.timing ?? DEFAULT_HIT_SHAKE.timing,
  };
}
/**
 * 当たった印（`BattleIo.hit`）で揺らすか（GS-339）。揺らす時が「当たったとき」で、味方が実際に食らった（`damage`）ときだけ。
 * 攻めかかったときに揺らす設定なら、印では揺らさない（見せ場〈`act`〉で揺らしている）。
 */
export function shakesOnHit(timing: HitShakeTiming, side: 'party' | 'enemy' | undefined, kind: string): boolean {
  return timing === 'impact' && side === 'party' && kind === 'damage';
}

/**
 * 技が流れるあいだ（戦闘の場面 `action`。手を決め終えてそのターンの行動が終わるまで）、舞台の味方の板を隠すか（2026-11-09 / GS-340。
 * `hidePartyInAction`）。書かなければ隠す。行動選択の左端の板・味方に重ねる技の絵（隊列の窓・画面）には効かない。
 */
export function partyHiddenInActionOf(settings: Pick<BattleStageSettings, 'hidePartyInAction'>): boolean {
  return settings.hidePartyInAction ?? true;
}

/** 書いていなければマップの 1 マスの画素。 */
export function figurePxOf(settings: Pick<BattleStageSettings, 'figurePx'>, tilePx: number): number {
  return settings.figurePx ?? (tilePx > 0 ? tilePx : 32);
}

/** マスの印のキー（`"col,row"`。GS-288）。 */
export function cellKey(cell: { col: number; row: number }): string {
  return `${cell.col},${cell.row}`;
}
const CELL_KEY = /^-?\d+,-?\d+$/;

/** 構図 1 つ。台帳を読む人向けの名前を持てる。 */
export interface NamedBattleCamera extends BattleCamera {
  name?: string;
}

/** 1 つのマップの戦闘の舞台（共通の値に差し替えを重ねた後の形）。 */
export interface BattleStageSettings {
  /**
   * 戦闘待機の構図（この欄専用。2026-11-06 に「戦闘開始」から呼び名を替えた。キーは `start` のまま）。舞台を組むと流し、
   * 流し終えた見え方が待機の見え方（出だしの一文・コマンド選択や戦闘開始の構図が無いとき・それらから戻る先）。
   */
  start: NamedBattleCamera;
  /**
   * コマンド選択の構図（この欄専用）。null なら無し。手を聞いているあいだ（隊列の命令から相手を選ぶまで）流し、
   * 聞き終えたら前の見え方へ同じ長さで戻る（2026-11-06 / GS-310）。
   */
  command: NamedBattleCamera | null;
  /**
   * 戦闘開始の構図（この欄専用。2026-11-06 / GS-312）。手を決め終えて技や攻撃が流れるあいだ流し、そのターンの行動が終わる
   * （決着も）と戦闘待機の見え方へ戻る（GS-313）。null・書かなければ無し（技のあいだも待機の見え方）。戦いの進行はこの構図を待たない。
   */
  action?: NamedBattleCamera | null;
  commandFigure: BattleCommandFigure;
  /**
   * このマップの戦闘に出る敵の数の最大（1〜6）。台帳エディタは敵シンボルのお供をこの範囲で決める
   * （触った 1 体と合わせて最大まで）。隊形の敵の枠はこの数以上要る。ゲームは数を切り詰めない（決めるのは台帳と検査）。
   */
  maxEnemies: number;
  /**
   * 舞台に立つ味方の板の大きさの倍率（2026-11-06 / GS-309。0.25〜4。書かなければ 1）。左端の板（コマンド選択）の大きさは
   * `commandFigure.scale` のまま変えない。
   */
  partyScale?: number;
  /** 戦闘の絵の 1 マスの画素（GS-322。`figurePxOf`）。 */
  figurePx?: number;
  /** 敵の攻撃を受けたときの画面の揺れ（GS-337。`hitShakeOf`）。 */
  hitShake?: Partial<BattleHitShake>;
  /** 技が流れるあいだ味方の板を隠すか（GS-340。`partyHiddenInActionOf`）。 */
  hidePartyInAction?: boolean;
  grid: BattleStageGrid;
  /**
   * マスごとの手書きの印（2026-10-30 / GS-288。`"col,row"` → 分け方）。地形から拾った分け方を上書きする。
   * `block` は誰も立てない・`sky` は飛ぶ敵だけ・`high` は高台・`floor` は床。マップの差し替えに書く（共通の値には書かない）。
   */
  cells?: Record<string, CellMark>;
}

/** マップごとの差し替え。書いた項目だけ共通の値を差し替える（構図は構図ごと）。 */
export interface BattleStageOverride {
  start?: NamedBattleCamera;
  command?: NamedBattleCamera | null;
  action?: NamedBattleCamera | null;
  commandFigure?: Partial<BattleCommandFigure>;
  maxEnemies?: number;
  partyScale?: number;
  figurePx?: number;
  hitShake?: Partial<BattleHitShake>;
  hidePartyInAction?: boolean;
  grid?: Partial<BattleStageGrid>;
  cells?: Record<string, CellMark>;
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
    action: null,
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
  if (base.flyHeight !== undefined) next.flyHeight = base.flyHeight;
  if (!object(raw)) return next;
  if (pair(raw.across)) next.across = [raw.across[0], raw.across[1]];
  if (pair(raw.depth)) next.depth = [raw.depth[0], raw.depth[1]];
  if (finite(raw.climb) && raw.climb >= 0 && raw.climb <= 20) next.climb = raw.climb;
  if (finite(raw.highStep) && raw.highStep >= 0.25 && raw.highStep <= 20) next.highStep = raw.highStep;
  if (finite(raw.flyHeight) && raw.flyHeight >= 0 && raw.flyHeight <= 10) next.flyHeight = raw.flyHeight;
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
    if (typeof key.ortho === 'boolean') next.ortho = key.ortho;
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
    action: !('action' in raw) ? structuredClone(base.action ?? null) : raw.action === null ? null : readCamera(raw.action) ?? structuredClone(base.action ?? null),
    commandFigure: readFigure(raw.commandFigure, base.commandFigure),
    maxEnemies: Number.isInteger(raw.maxEnemies) && (raw.maxEnemies as number) >= 1 && (raw.maxEnemies as number) <= 6 ? raw.maxEnemies as number : base.maxEnemies,
    grid: readGrid(raw.grid, base.grid),
    ...(finite(raw.partyScale) && raw.partyScale >= PARTY_SCALE_RANGE[0] && raw.partyScale <= PARTY_SCALE_RANGE[1]
      ? { partyScale: raw.partyScale }
      : base.partyScale !== undefined ? { partyScale: base.partyScale } : {}),
    ...(finite(raw.figurePx) && raw.figurePx >= FIGURE_PX_RANGE[0] && raw.figurePx <= FIGURE_PX_RANGE[1]
      ? { figurePx: raw.figurePx }
      : base.figurePx !== undefined ? { figurePx: base.figurePx } : {}),
    ...readHitShake(raw.hitShake, base.hitShake),
    ...(typeof raw.hidePartyInAction === 'boolean'
      ? { hidePartyInAction: raw.hidePartyInAction }
      : base.hidePartyInAction !== undefined ? { hidePartyInAction: base.hidePartyInAction } : {}),
    ...(readCells(raw.cells) ?? (base.cells ? { cells: { ...base.cells } } : {})),
  };
}

/** 被弾の揺れ（GS-337）。項目ごとに差し替える（範囲の外・数でない値は共通の値のまま）。 */
function readHitShake(raw: unknown, base: Partial<BattleHitShake> | undefined): { hitShake?: Partial<BattleHitShake> } {
  const out: Partial<BattleHitShake> = { ...(base ?? {}) };
  if (object(raw)) {
    for (const key of ['ms', 'power'] as const) {
      const value = raw[key];
      const [min, max] = HIT_SHAKE_RANGES[key];
      if (finite(value) && value >= min && value <= max) out[key] = value;
    }
    if ((HIT_SHAKE_TIMINGS as readonly unknown[]).includes(raw.timing)) out.timing = raw.timing as HitShakeTiming;
  }
  return Object.keys(out).length ? { hitShake: out } : {};
}

/** 手書きの印（GS-288）。形の違うキー・知らない印は捨てる。書いていなければ null（共通の値のまま）。 */
function readCells(raw: unknown): { cells: Record<string, CellMark> } | null {
  if (!object(raw)) return null;
  const cells: Record<string, CellMark> = {};
  for (const [key, mark] of Object.entries(raw)) {
    if (CELL_KEY.test(key) && (CELL_MARKS as readonly unknown[]).includes(mark)) cells[key] = mark as CellMark;
  }
  return { cells };
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

/** 舞台の板を描く順の始まり。地形より後、左端の板（5000）より前。 */
export const STAGE_ROW_ORDER = 1000;
/** 1 列に使う順番の幅（1 列に並ぶ人数の上限）。 */
export const STAGE_ROW_STEP = 16;

/**
 * 舞台の板を描く順（2026-10-19 / BPE-30）。**前後関係は戦闘のマスの列（`row`）で決める**——手前の列（`row` が大きい）ほど後に描く。
 * 同じ列なら並び順（`index`。味方→敵、隊形の順）。板どうしは深度で争わせないので（`STAGE_FIGURE_MATERIAL`）、
 * 重なった所はこの順番だけで決まる。
 */
export function stageFigureOrder(row: number, index: number): number {
  return STAGE_ROW_ORDER + row * STAGE_ROW_STEP + Math.min(Math.max(0, index), STAGE_ROW_STEP - 1);
}

/**
 * 舞台の板の材質（2026-10-30 / GS-289）。**深度を書かない**。
 * 板はどれもカメラの向きへ回した縦の板なので、同じ列の板は同じ平面に重なり、深度が引き分けてフレームごとに前後が入れ替わる（チラつく）。
 * 板どうしの前後は描く順（`stageFigureOrder`）で決め、地形に隠れるのは深度を読む（`depthTest`）ことで今までどおり。
 * 材質そのものはフィールドのキャラと同じ `createActorMaterial`（2026-11-01）で、この値を上書きして使う。
 */
export const STAGE_FIGURE_MATERIAL = { transparent: true, alphaTest: 0.05, depthWrite: false } as const;

/**
 * 敵の板の頭の上に要る高さ（px）。体力の帯（間 8 + 帯 22）と状態の札（帯の上へ 12）に、画面の縁との間 4。
 * CSS の `.battle-foe .battle-bar` / `.ail-tags` の置き方と合わせる。
 */
export const FOE_HEAD_ROOM = 46;

/**
 * 体力の帯を画面に収めるために下げる量（px。2026-10-31）。
 * 高台の敵は板が画面の上端に寄り、頭の上の帯が画面の外へ出てしまうので、足りない分だけ下げる。
 */
export function foeHeadDrop(top: number): number {
  return Math.max(0, FOE_HEAD_ROOM - top);
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
