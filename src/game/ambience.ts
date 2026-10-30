// マップの環境音（GS-278）。台帳 `maps.json` の `bgs` は**行の並び**で、1 行が 1 つの音。
//
// - `effect` の無い行: 入っているあいだずっと流す（滝・洞窟）。
// - `effect` の有る行: そのマップのエフェクトのプリセット（id）の**今の濃さ**に音量を合わせる。
//   命令「マップのエフェクト」（GS-270）で出し入れすれば音もついてくる——`ms` で薄れれば音も同じ時間で薄れ、
//   時間帯で消えるエフェクトなら音も消える。音のための覚えは持たない（エフェクトの覚えがそのまま効く）。
// - `on: "strike"` の行（雷だけ）: 流しっぱなしにせず、**光るたびに 1 回**鳴らす。`delay` ミリ秒遅らせられる（遠くの雷）。
//
// ここは決めるだけ（音は鳴らさない）。鳴らすのは `audio.ts` の `updateAmbience`。

/** 台帳の 1 行。 */
export interface AmbienceDef {
  /** 音（`sounds.json` のキー）。流す行はループする音、`strike` の行はループしない音。 */
  key: string;
  /** 台帳の音量に掛ける倍率（0〜1。書いていなければ 1）。 */
  volume?: number;
  /** 合わせるエフェクトのプリセット id（フィールドエフェクトか画面エフェクト）。書いていなければずっと流す。 */
  effect?: string;
  /** `strike`: 雷が光るたびに 1 回鳴らす（`effect` は雷のプリセット）。書いていなければ流しっぱなし。 */
  on?: 'strike';
  /** `strike` の行だけ。光ってから鳴らすまでのミリ秒（書いていなければ 0）。 */
  delay?: number;
  /**
   * `strike` の行だけ。同時に鳴らす数の上限（1〜4。書いていなければ 2。GS-279）。
   * 超えたら一番古い音を薄れさせて消す（長い雷の音が積み重ならないように）。
   */
  overlap?: number;
}

/** 雷の音の重ね数の既定と上限（GS-279）。 */
export const STRIKE_OVERLAP_DEFAULT = 2;
export const STRIKE_OVERLAP_MAX = 4;
/** 重ね数（1〜上限の整数。書いていなければ既定）。 */
export function strikeOverlap(row: Pick<AmbienceDef, 'overlap'>): number {
  const value = row.overlap;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(STRIKE_OVERLAP_MAX, Math.round(value))) : STRIKE_OVERLAP_DEFAULT;
}

/** エフェクト 1 つの今の濃さ。`strike` は雷の今が何回目の光か、`lit` はその回に光るか（休む回は false）。 */
export interface EffectLevel {
  level: number;
  strike?: number;
  lit?: boolean;
}

const unit = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/** 台帳の `bgs` を行の並びとして読む。形の崩れた行は飛ばす。 */
export function readAmbience(raw: unknown): AmbienceDef[] {
  if (!Array.isArray(raw)) return [];
  const out: AmbienceDef[] = [];
  for (const one of raw) {
    if (!one || typeof one !== 'object') continue;
    const row = one as Record<string, unknown>;
    if (typeof row.key !== 'string' || !row.key) continue;
    const def: AmbienceDef = { key: row.key };
    if (row.volume !== undefined) def.volume = unit(row.volume, 1);
    if (typeof row.effect === 'string' && row.effect) def.effect = row.effect;
    if (row.on === 'strike') def.on = 'strike';
    if (typeof row.delay === 'number' && Number.isFinite(row.delay)) def.delay = Math.max(0, row.delay);
    if (typeof row.overlap === 'number' && Number.isFinite(row.overlap)) def.overlap = strikeOverlap({ overlap: row.overlap });
    out.push(def);
  }
  return out;
}

/**
 * 流す行の今の倍率（台帳の音量に掛ける）。`effect` の無い行は `volume`、有る行は `volume × 濃さ`。
 * そのエフェクトが今出ていない（置き場所が無い・その時間帯に無い）なら 0。
 */
export function ambienceGain(row: AmbienceDef, levels: ReadonlyMap<string, EffectLevel>): number {
  const base = unit(row.volume, 1);
  if (!row.effect) return base;
  return base * unit(levels.get(row.effect)?.level, 0);
}

/**
 * 雷の行を今鳴らすか。`last` は前に見た光の回数（初めて見たときは undefined）で、呼んだあと新しい回数を返す。
 * **初めて見たときは鳴らさない**（入った瞬間に光の途中を拾って鳴らさないため）。回数が増えて、その回に光り（休む回でない。GS-279）、
 * 濃さが 0 より大きいときだけ鳴らす。
 */
export function strikeDue(
  row: AmbienceDef,
  levels: ReadonlyMap<string, EffectLevel>,
  last: number | undefined,
): { play: boolean; gain: number; seen: number | undefined } {
  const level = row.effect ? levels.get(row.effect) : undefined;
  const seen = level?.strike;
  const gain = unit(row.volume, 1) * unit(level?.level, 0);
  const play = seen !== undefined && last !== undefined && seen > last && level?.lit !== false && gain > 0;
  return { play, gain, seen };
}
