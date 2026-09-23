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

/** 立ち絵の置き場所。人の台帳（`characters.ts`）と同じ棚に敵も居る。 */
const STAND_DIR = 'assets/img/CharaStand';

/** 戦闘の背景の置き場所（GS-79）。 */
const BACK_DIR = 'assets/img/background';


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
  /** 絵の名前（拡張子なし）。無ければ絵なしで出す。 */
  image?: string;
  /** 倒したときに入る経験（GS-63）。 */
  exp?: number;
  /** 倒したときの取り分。 */
  gold?: number;
  /** 使う技（GS-69）。書かなければ殴るだけ。 */
  skills?: EnemySkillRef[];
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
}

/**
 * 戦闘の背景 1 つぶん（GS-79）。**絵を並べるだけ**——旧作の丘は 3 枚重ねだった。
 * 空（シェーダー）や霧は付けない。要るようになったら画面エフェクトの方から重ねる。
 */
export interface BattleFieldDef {
  /** 台帳を読む人向けの名前。画面には出さない。 */
  name?: string;
  /** `assets/img/background/` の中のファイル名。**奥から手前の順**。 */
  images?: string[];
  /**
   * 絵のうしろに敷く空（CSS の色かグラデーション）。
   * 旧作の丘は**絵の上側が透けている**（空はシェーダーで描いていた）ので、
   * ここで敷かないと上半分が黒くなる。1 枚で足りる絵には要らない。
   */
  sky?: string;
}

/** BattleStageを原点とする、カメラ基準の初期位置（マス）。 */
export interface BattleFormationSlot {
  /** カメラから見た左右。右が正。 */
  across: number;
  /** カメラから見た奥行き。手前が正。 */
  depth: number;
  /** その地点の床から持ち上げる高さ。 */
  height?: number;
}

/** 人数ごとのスロットを持つ再利用可能な戦闘隊形。 */
export interface BattleFormationDef {
  name?: string;
  party?: Record<string, BattleFormationSlot[]>;
  enemy?: Record<string, BattleFormationSlot[]>;
}

/**
 * 攻撃の絵の画像 1 枚の区切り（GS-121）。`data/spriteSheets.json` の `sheets` の 1 行（キーは画像のファイル名）。キャラの立ち姿と同じ台帳。
 * **区切りは画像ごと**——同じ画像を使う演出はみな同じ区切り。台帳エディタが編集する。
 */
export type EffectImageDef = SpriteSheetDef;

/**
 * 攻撃の絵 1 つぶん（`data/effects.json` の 1 行。GS-83）。**コマを並べた 1 枚絵**をめくる。
 * コマ割り（幅・高さ・1 行のコマ数・fps）は画像の台帳が持つ（GS-114）。戦闘演出エディタが編集する。
 */
export interface EffectEntry {
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
export type EffectDef = EffectEntry & EffectImageDef;

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
let battlefields: Record<string, BattleFieldDef> = {};
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
  const [e, s, p, a, f, x, r, g] = await Promise.all([
    readJson<{ enemies?: Record<string, EnemyDef> }>('data/enemies.json'),
    readJson<{ skills?: Record<string, SkillDef> }>('data/skills.json'),
    readJson<{ party?: string[]; members?: Record<string, MemberDef>; levelUp?: LevelUpDef }>('data/party.json'),
    readJson<{ ailments?: Record<string, AilmentDef> }>('data/ailments.json'),
    readJson<{ battlefields?: Record<string, BattleFieldDef> }>('data/battlefields.json'),
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
  if (f?.battlefields) battlefields = f.battlefields;
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

/** 一覧（id と名前）。道具やイベントエディタに渡す用。 */
export function enemyList(): Array<{ id: string; name: string }> {
  return Object.entries(enemies).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}

export function skillList(): Array<{ id: string; name: string }> {
  return Object.entries(skills).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}

/**
 * 戦闘の背景 1 つ（GS-79）。**台帳に無ければ null**——
 * 知らないキーは null。通常の未指定値は呼び出し側で既定の hill に解決する。
 */
export function battleFieldDef(key: string): BattleFieldDef | null {
  return battlefields[key] ?? null;
}

/** 背景のうしろに敷く空。無ければ空文字（下地の色のまま）。 */
export function battleFieldSky(key: string): string {
  return battlefields[key]?.sky ?? '';
}

/** 背景の絵の URL（奥から手前）。台帳に無いキーなら空。 */
export function battleFieldImages(key: string): string[] {
  const images = battlefields[key]?.images ?? [];
  return images.map((name) => assetUrl(`${BACK_DIR}/${name}`));
}

/** 一覧（キーと名前）。エディタや道具に渡す用。 */
export function battleFieldList(): Array<{ id: string; name: string }> {
  return Object.entries(battlefields).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}

/**
 * 指定人数の初期位置。人数とスロット数が一致しない定義は使わない。
 * 配列順が `party:1` / `enemy:1` の意味的な対象番号になる。
 */
export function battleFormationSlots(
  id: string | undefined,
  side: 'party' | 'enemy',
  count: number,
): BattleFormationSlot[] | null {
  if (!id || count < 1) return null;
  const slots = formations[id]?.[side]?.[String(count)];
  if (!Array.isArray(slots) || slots.length !== count) return null;
  if (!slots.every((slot) => Number.isFinite(slot.across) && Number.isFinite(slot.depth)
    && (slot.height === undefined || Number.isFinite(slot.height)))) return null;
  return slots.map((slot) => ({ ...slot }));
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

/** 攻撃の絵 1 つ（GS-83）。**台帳に無ければ null**——絵なしで仰け反りだけ見せる。 */
export function effectDef(key: string): EffectDef | null {
  const entry = effects[key];
  if (!entry) return null;
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

/** 攻撃の絵の URL。置き場はスプライトシートの棚 1 か所（GS-121）。 */
export function effectImage(def: Pick<EffectEntry, 'image'>): string {
  return sheetUrl(def.image);
}

/** 戦闘演出エディタの未保存の下書き（GS-105）。開発用プレビューからだけ渡す。読み直すと台帳へ戻る。 */
export function previewEffects(next: Record<string, EffectEntry>): void {
  effects = structuredClone(next);
  effectsPreviewed = true;
}

/** 敵の絵の URL。無ければ null。 */
export function enemyImage(id: string): string | null {
  const image = enemies[id]?.image;
  return image ? assetUrl(`${STAND_DIR}/${image}.png`) : null;
}
