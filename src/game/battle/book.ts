// 戦闘の台帳（GS-60）。**敵・技・はじめの仲間**を読む。
//
// ほかの台帳（`items` / `commons` / `characters`）と同じ形。増やすのは
// `public/data/` の JSON に 1 行足すだけで、TS は触らない。
//
// **3 つを 1 ファイルに置いた**のは、読むのが同じ場面（戦闘のはじめ）だから。
// 別々にすると「どれを読み忘れたか」を数える場所が要る。
//
// **いまの HP はここに入れない。** 台帳は満タンの値だけで、減っているぶんは
// セーブ（`state.ts`）が持つ——同じ物を 2 か所に置かないため（`items` と同じ考え）。

import { assetUrl } from '../assets';
import { loadSpriteSheets, sheetUrl, spriteSheet, type SpriteSheetDef } from '../spriteSheets';
import type { SkillDef, Stats } from './rules';
import { applyBattleSettings } from './settings';
import type { SkillFieldFrom, SkillFieldKind } from './skillFieldLimits';

/** 敵の絵の置き場所（2026-10-27）。人の立ち絵（`CharaStand`）とは棚を分けた。 */
const ENEMY_DIR = 'assets/img/Enemy';



/**
 * 状態異常 1 つぶん（GS-69）。**戦いのあいだだけ**続く。
 * フィールドまで持ち越すと、歩数ごとの毒処理とセーブの欄が要る——それは後で。
 */
export interface AilmentDef {
  name: string;
  /** 一覧に出す 1 文字。 */
  short?: string;
  /** ターンの終わりに減る HP。 */
  turnDamage?: number;
  /** 戦いが終わっても続く（GS-71）。書かなければ戦闘が終われば消える。 */
  keep?: boolean;
  /** 歩いて何マスごとに `turnDamage` を受けるか（GS-71）。0 や無しなら歩いても平気。 */
  walk?: number;
  /** 行動できない。 */
  skip?: boolean;
  /** 毎ターン これで抜ける（0〜1）。 */
  recover?: number;
  /** 殴られると抜ける。 */
  wakeOnHit?: boolean;
  /** かかったときの一言。 */
  hit?: string;
  /** 抜けたときの一言。 */
  gone?: string;
}

/** 敵が使う技 1 つ。 */
export interface EnemySkillRef {
  id: string;
  /** 出す見込み（0〜1）。省略は 1。 */
  chance?: number;
}

/** 敵 1 体ぶん。数値は `Stats` と同じ綴りにしてある——そのまま戦えるように。 */
export interface EnemyDef extends Stats {
  name: string;
  /** 絵の名前（`assets/img/Enemy` からの道。拡張子なし）。無ければ絵なしで出す。 */
  image?: string;
  /** 戦闘の絵の大きさの倍率（2026-10-17）。書かなければ 1（絵の高さから決めた大きさのまま）。 */
  scale?: number;
  /** 倒したときに入る経験（GS-63）。 */
  exp?: number;
  /** 倒したときの取り分。 */
  gold?: number;
  /** 使う技（GS-69）。書かなければ殴るだけ。 */
  skills?: EnemySkillRef[];
  /**
   * 前衛に出る確率（0〜1。2026-10-29 / GS-286）。戦闘のたびの並べ方のくじで、前の行の枠に入る見込み。
   * 書かなければ 0.5（前と後ろで同じ。前と後ろの枠の数が同じなら、ちょうどこの確率で前に出る）。1 でも前の枠が埋まっていれば後ろへ。
   */
  front?: number;
  /**
   * 飛ぶ（2026-10-30 / GS-288）。空のマスにも立て、床から浮いて立つ（`battleStages.json` の `grid.flyHeight`）。
   * 前衛・後衛の決まりの外。単体の攻撃で守られた後衛も狙える。飛ばない相手からの直接攻撃は `rates.flyGuard`（既定 0.5）倍。
   */
  flying?: boolean;
}

/** はじめの仲間 1 人ぶん。数値は**レベル 1 のとき**の値（GS-63）。 */
export interface MemberDef extends Stats {
  /** 覚えている技（`skills.json` の id）。 */
  skills?: string[];
  /** レベルが 1 上がるごとに増える量。書かなければ増えない。 */
  growth?: Partial<Omit<Stats, 'level'>>;
  /** そのレベルで覚える技。キーはレベルの数字。 */
  learn?: Record<string, string[]>;
  /** はじめから身に着けている物（GS-67）。置き場所 → 持ち物の id。 */
  equip?: Record<string, string>;
  /**
   * フィールドアタックに使う技（GS-295。`skills.json` のキー）。**覚えている技**で、`field` のある技だけ効く。
   * 書かない・覚えていない・`field` が無ければ素手の通常攻撃（`battleSettings.json` の `normalAttack.party.field`）。
   */
  fieldAttack?: string;
}

/**
 * 舞台に立つ 1 人の位置（2026-10-19 / BPE-30）。**戦闘のマスの番号**（整数）で書く。
 * マスの大きさと原点は戦闘の舞台の台帳（`battleStages.json` の `grid`。マップごと）が決める——フィールドのマスとは関係ない。
 * 前後関係は `row` で決まる（手前ほど後に描く）。同じ列なら並び順。
 */
export interface BattleFormationSlot {
  /** カメラから見た横のマス。右が正。 */
  col: number;
  /** カメラから見た奥のマス。手前が正（味方は正、敵は負に置く）。 */
  row: number;
  /** その地点の床（地形の起伏に沿う）から持ち上げる高さ（フィールドのマス × CharacterScale）。浮かせるときだけ書く。 */
  height?: number;
}

/**
 * 戦闘隊形（2026-10-19。**人数によらず共通の並び**）。陣営ごとに 6 人までの枠を並べ、N 人のときは前から N 個を使う。
 * `center` が偽でなければ、使う枠を横の真ん中へ寄せる（列の平均を舞台の点へ。マスの番号のまま整数でずらす）——
 * 1 人でも 4 人でも同じ並びのまま真ん中に立つ。
 */
export interface BattleFormationDef {
  name?: string;
  center?: boolean;
  party?: BattleFormationSlot[];
  enemy?: BattleFormationSlot[];
}

/**
 * 攻撃の絵の画像 1 枚の区切り（GS-121）。`data/spriteSheets.json` の `sheets` の 1 行（キーは画像のファイル名）。キャラの立ち姿と同じ台帳。
 * **区切りは画像ごと**——同じ画像を使う演出はみな同じ区切り。台帳エディタが編集する。
 */
export type EffectImageDef = SpriteSheetDef;

/**
 * 攻撃の絵 1 つぶん（`data/effects.json` の 1 行。GS-83）。形は 2 つ（GS-297）:
 * - コマ絵（`SpriteEffectEntry`）: **コマを並べた 1 枚絵**をめくる。
 * - フィールドエフェクト（`FieldEffectEntry`）: マップのフィールドエフェクト（爆発・光の柱など）を相手の所へ 1 回出す。
 * どちらも戦闘演出エディタが編集する。見分けは `field` があるか（`isFieldEffect`）。
 */
export type EffectEntry = SpriteEffectEntry | FieldEffectEntry;

/**
 * 技に使えるフィールドエフェクトの種類と値の範囲は `skillFieldLimits.ts`（GS-297）。
 * 描き方はマップと同じ（`mep3d/fieldEffects.ts`）。
 */
export { SKILL_FIELD_KINDS, type SkillFieldKind } from './skillFieldLimits';

/**
 * フィールドエフェクトの見た目（GS-297）。値の名前と意味はマップのプリセット（`FieldEffectPresetDef`）と同じ。
 * 書かない値は種類の既定。`thick` は高さ（マス。爆発は使わない）、`lift` は置く高さのずらし（マス）。
 */
export interface SkillFieldLook {
  kind: SkillFieldKind;
  color?: string;
  amount?: number;
  speed?: number;
  scale?: number;
  thick?: number;
  lift?: number;
  ringBlur?: number;
  richness?: number;
  lightningCount?: number;
  lightningWidth?: number;
  lightningGap?: number;
}

/** フィールドエフェクトの技の絵（GS-297）。相手の所へ、出した時から流す（くり返す種類も時間 0 から）。 */
export interface FieldEffectEntry {
  /** 台帳を読む人向けの名前。画面には出さない。 */
  name?: string;
  field: SkillFieldLook;
  /** 幅（マス × マップの `CharacterScale`）。爆発は球の直径、柱・炎は太さ、衝撃波は輪の広がり、雷とフラッシュは範囲の幅。 */
  size: number;
  /** 出すマス（GS-298）。書かなければ相手の立つマス。 */
  cell?: SkillFieldCell;
  /** 出しておく時間（ミリ秒）。終わりぎわに薄くして消す。 */
  ms: number;
  /** 出したときに鳴らす音（`sounds.json` のキー）。 */
  se?: string;
}

/**
 * 出すマス（GS-298）。`from` の所から、戦闘のマスで横 `col`（右が正）・奥行き `row`（手前が正）ずらす。
 * - `target`（既定）: 相手の立つマス
 * - `side`: 相手の陣の真ん中（倒れていない人のマスの平均）
 * - `stage`: 舞台の点（マス 0,0）。`col` / `row` がそのまま戦闘のマスの番号になる
 * フィールドアタックには戦闘のマスが無いので、いつも相手の所から（横は右、奥行きはカメラの方が正。CharacterScale を掛ける）。
 */
export interface SkillFieldCell {
  from?: SkillFieldFrom;
  col?: number;
  row?: number;
}

/** フィールドエフェクトの行か（GS-297）。 */
export function isFieldEffect(def: EffectEntry | EffectDef): def is FieldEffectEntry {
  return typeof (def as FieldEffectEntry).field === 'object' && (def as FieldEffectEntry).field !== null;
}

/**
 * コマ絵の技の絵（GS-83）。**コマを並べた 1 枚絵**をめくる。
 * コマ割り（幅・高さ・1 行のコマ数・fps）は画像の台帳が持つ（GS-114）。
 */
export interface SpriteEffectEntry {
  /** 台帳を読む人向けの名前。画面には出さない。 */
  name?: string;
  /** `assets/spritesheet/` の中のファイル名。コマの区切りは `spriteSheets.json` のこの名前の行（GS-121）。 */
  image: string;
  /** めくるコマ `[最初, 最後]`。最後まで行ったら最初へ戻る。 */
  frames: [number, number];
  /** 1 秒にめくるコマ数（GS-121。画像ごとではなく**演出ごと**）。 */
  fps: number;
  /** 出しておく時間（ミリ秒）。 */
  ms: number;
  /** 大きさ `[始め, 終わり]`。書かなければ等倍のまま。 */
  scale?: [number, number];
  /** 大きさを 1 回伸ばすのにかける時間。 */
  scaleMs?: number;
  /** 伸ばしたら戻す（真）／始めに戻って伸ばし直す（偽）。 */
  yoyo?: boolean;
  /** 出したときに鳴らす音（`sounds.json` のキー）。 */
  se?: string;
}

/** 描くときの形。演出の行に、その画像のコマ割りを重ねた物（GS-114）。値は旧作の `NormalAttack` / `MagicFrame` / `WindCutter` と同じ。 */
export type EffectDef = SpriteEffectDef | FieldEffectEntry;
/** コマ絵を描く形（区切りを重ねた物）。 */
export type SpriteEffectDef = SpriteEffectEntry & EffectImageDef;

/** レベル上げの決まり（GS-63）。次のレベルに要る経験 = `base × レベル ^ rate`。 */
export interface LevelUpDef {
  base: number;
  rate: number;
  /** これ以上は上がらない。 */
  max: number;
}

const DEFAULT_LEVEL_UP: LevelUpDef = { base: 8, rate: 1.7, max: 50 };

let enemies: Record<string, EnemyDef> = {};
let skills: Record<string, SkillDef> = {};
let ailments: Record<string, AilmentDef> = {};
let members: Record<string, MemberDef> = {};
let party: string[] = [];
let formations: Record<string, BattleFormationDef> = {};
let defaultFormation = '';
let effects: Record<string, EffectEntry> = {};
/** 戦闘演出エディタの下書きを受けた（GS-105）。後から台帳を読み終えても上書きしない。 */
let effectsPreviewed = false;
let levelUp: LevelUpDef = DEFAULT_LEVEL_UP;
/**
 * 読みかけの約束（GS-82）。**旗（済んだかどうか）ではなく約束を持つ**——
 * 旗を読み始めに立てると、読み終わる前の 2 人目がすぐ返ってしまい、
 * 空の台帳を見る（起動直後に「はじめから」を押すと仲間が 0 人で始まった）。
 */
let pending: Promise<void> | null = null;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(assetUrl(path), { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** 台帳を読む。**起動時に 1 回**でよい。読めなくてもフィールドは遊べる。 */
export function loadBattleBook(): Promise<void> {
  // 2 回目以降は**同じ約束**を返す。読み終わるまで、後から来た人も待つ。
  if (!pending) pending = readBattleBook();
  return pending;
}

async function readBattleBook(): Promise<void> {
  const [e, s, p, a, x, r, g] = await Promise.all([
    readJson<{ enemies?: Record<string, EnemyDef> }>('data/enemies.json'),
    readJson<{ skills?: Record<string, SkillDef> }>('data/skills.json'),
    readJson<{ party?: string[]; members?: Record<string, MemberDef>; levelUp?: LevelUpDef }>('data/party.json'),
    readJson<{ ailments?: Record<string, AilmentDef> }>('data/ailments.json'),
    readJson<{ effects?: Record<string, EffectEntry> }>('data/effects.json'),
    readJson<{ default?: string; formations?: Record<string, BattleFormationDef> }>('data/battleFormations.json'),
    readJson<unknown>('data/battleSettings.json'),
    // 絵の区切りは画像の台帳（GS-121）。キャラの立ち姿と同じ物を見る。
    loadSpriteSheets(),
  ]);
  // 戦闘共通の音と間（GS-106）。読めなければ既定値のまま。
  applyBattleSettings(g);
  if (e?.enemies) enemies = e.enemies;
  if (s?.skills) skills = s.skills;
  if (p?.members) members = p.members;
  if (p?.party) party = p.party;
  if (p?.levelUp) levelUp = { ...DEFAULT_LEVEL_UP, ...p.levelUp };
  if (a?.ailments) ailments = a.ailments;
  if (x?.effects && !effectsPreviewed) effects = x.effects;
  if (r?.formations) {
    formations = r.formations;
    defaultFormation = r.default && formations[r.default] ? r.default : Object.keys(formations)[0] ?? '';
  }
}

/** 敵 1 体。**台帳に無ければ null**——知らない敵を数値 0 で出すと無敵か即死になる。 */
export function enemyDef(id: string): EnemyDef | null {
  return enemies[id] ?? null;
}

/** 技 1 つ。無ければ null（素手として扱えばよい）。 */
export function skillDef(id: string): SkillDef | null {
  return skills[id] ?? null;
}

/** 状態異常 1 つ。**台帳に無ければ null**——知らない名前で動きを変えない。 */
export function ailmentDef(id: string): AilmentDef | null {
  return ailments[id] ?? null;
}

/** 状態異常の名前。台帳に無ければ id をそのまま。 */
export function ailmentName(id: string): string {
  return ailments[id]?.name ?? id;
}

/** 技の名前。**台帳に無くても id を返す**（何を覚えたか分からなくならないように）。 */
export function skillName(id: string): string {
  return skills[id]?.name ?? id;
}

/** はじめの仲間 1 人。 */
export function memberDef(who: string): MemberDef | null {
  return members[who] ?? null;
}

/** レベル上げの決まり。台帳に無ければ既定。 */
export function levelUpRule(): LevelUpDef {
  return levelUp;
}

/** はじめの並び。台帳が読めていなければ空。 */
export function startingParty(): string[] {
  return party.slice();
}

/** 仲間の台帳の人（`members` の並び）。デバッグの戦闘が足りない仲間をこの順に足す。 */
export function memberIds(): string[] {
  return Object.keys(members);
}

/** 一覧（id と名前）。道具やイベントエディタに渡す用。 */
export function enemyList(): Array<{ id: string; name: string }> {
  return Object.entries(enemies).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}

export function skillList(): Array<{ id: string; name: string }> {
  return Object.entries(skills).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}

/**
 * 指定人数の初期位置。並びの前から `count` 個（足りなければ null）。`center` なら横の真ん中へ寄せる。
 * 配列順が `party:1` / `enemy:1` の意味的な対象番号になる。
 */
export function battleFormationSlots(
  id: string | undefined,
  side: 'party' | 'enemy',
  count: number,
): BattleFormationSlot[] | null {
  if (!id || count < 1) return null;
  const formation = formations[id];
  const list = formation?.[side];
  if (!Array.isArray(list) || list.length < count) return null;
  const slots = list.slice(0, count);
  if (!slots.every((slot) => Number.isInteger(slot.col) && Number.isInteger(slot.row)
    && (slot.height === undefined || Number.isFinite(slot.height)))) return null;
  const shift = formation?.center === false ? 0 : centerShift(slots);
  return slots.map((slot) => ({ ...slot, col: slot.col + shift }));
}

/** 隊形 1 つ（2026-10-29 / GS-280。戦闘のマスの割り当て `cells.ts` が読む）。無ければ null。 */
export function battleFormationDef(id: string | undefined): BattleFormationDef | null {
  return (id && formations[id]) || null;
}

/** 横の真ん中へ寄せる量（マスの番号。列の平均の逆を整数に丸める）。 */
export function centerShift(slots: Array<{ col: number }>): number {
  if (!slots.length) return 0;
  const mean = slots.reduce((sum, slot) => sum + slot.col, 0) / slots.length;
  return -Math.round(mean) || 0;
}

/** イベント指定を優先し、それ以外はマップ候補からランダムに1つ選ぶ。最後は台帳のdefault。 */
export function chooseBattleFormation(
  explicit: string | undefined,
  candidates: string[] | undefined,
  random: () => number = Math.random,
): string {
  if (explicit && formations[explicit]) return explicit;
  const available = (candidates ?? []).filter((id, index, ids) => Boolean(formations[id]) && ids.indexOf(id) === index);
  if (available.length) {
    const index = Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)));
    return available[index];
  }
  return defaultFormation;
}

/** 隊形の台帳を戦闘演出エディタの下書きで差し替える（2026-10-19 / BPE-30。開発中だけ）。次に舞台を組むときから効く。 */
export function previewFormations(next: unknown): void {
  const book = next as { default?: string; formations?: Record<string, BattleFormationDef> } | null;
  if (!book?.formations || typeof book.formations !== 'object') return;
  formations = book.formations;
  defaultFormation = book.default && formations[book.default] ? book.default : Object.keys(formations)[0] ?? '';
}

/** 攻撃の絵 1 つ（GS-83）。**台帳に無ければ null**——絵なしで仰け反りだけ見せる。 */
export function effectDef(key: string): EffectDef | null {
  const entry = effects[key];
  if (!entry) return null;
  // フィールドエフェクトは画像を使わない（GS-297）。
  if (isFieldEffect(entry)) return entry;
  // 区切りは画像の台帳から（GS-121）。**区切りが無い画像は描かない**——幅も高さも分からない。
  const cut = spriteSheet(entry.image);
  if (!cut) {
    console.warn(`[effect] 画像の区切りが台帳（spriteSheets.json）にありません: ${entry.image}`);
    return null;
  }
  return { ...entry, ...cut };
}

/** 攻撃の絵の一覧（GS-85）。戦闘の頭で先に読んでおく用。 */
export function effectList(): EffectEntry[] {
  return Object.values(effects);
}

/** 攻撃の絵の URL。置き場はスプライトシートの棚 1 か所（GS-121）。フィールドエフェクトは画像が無いので null（GS-297）。 */
export function effectImage(def: EffectEntry | EffectDef): string | null {
  return isFieldEffect(def) ? null : sheetUrl(def.image);
}

/** 戦闘演出エディタの未保存の下書き（GS-105）。開発用プレビューからだけ渡す。読み直すと台帳へ戻る。 */
export function previewEffects(next: Record<string, EffectEntry>): void {
  effects = structuredClone(next);
  effectsPreviewed = true;
}

/** 敵の絵の URL。無ければ null。 */
export function enemyImage(id: string): string | null {
  const image = enemies[id]?.image;
  return image ? assetUrl(`${ENEMY_DIR}/${image}.png`) : null;
}

/** 敵の絵の大きさの倍率（2026-10-17）。書かない・0 以下・数でない値は 1。 */
export function enemyScale(id: string): number {
  const scale = enemies[id]?.scale;
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 戦闘の舞台の板の高さ（マス。GS-87）。`fixed` が 0 より大きければそれ、
 * 0 なら絵の高さから決める。**絵の 1 画素をマップの 1 画素にそろえる**（2026-11-01）——
 * 高さは「絵の画素 ÷ マップの 1 マスの画素（`tilePx`）」で、フィールドのキャラ（`createPlayer`）と同じ数え方。
 * それに倍率を掛ける。ドットを崩さないなら倍率は整数（か 1/2・1/4）にする。
 * **上限・下限で収めない**（2026-10-17）——元の大きさ × 倍率だけにして、大きさは倍率で直す。
 */
export function stageFigureCells(fixed: number, imagePx: number, tilePx: number, scale = 1): number {
  const cells = fixed > 0 ? fixed : imagePx / (tilePx > 0 ? tilePx : 32);
  return cells * scale;
}
