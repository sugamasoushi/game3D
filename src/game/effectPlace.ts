// 技の絵（コマ絵）の置き方（GS-318。2026-11-08）。`effects.json` の行の `place`。
//
// **画面ごと・出し先ごとに別々に持つ**（GS-332・GS-335）:
//   place.battle.foe   … コマンド戦闘で敵に出すとき（舞台の敵の板の所。3D の板）
//   place.battle.party … コマンド戦闘で味方に出すとき（隊列の窓のアイコンか画面の真ん中に重ねる。HTML。GS-328）
//   place.field.foe    … フィールドで敵に出すとき（フィールドアタックが敵シンボルに当たった）
//   place.field.party  … フィールドで味方に出すとき（敵の技が仲間に当たった。GS-324）
// どれにも、当てる点・基準点・大きさ・ずらしを書ける（書かない値は既定）。どれかの値がほかへ効くことは無い。
// 両方の画面に効くのは行の方の めくるコマ・出しておく時間・大きさの変化（`scale`）・音だけ。
//
// 絵は、相手の「当てる点」に絵の「基準点」を合わせて出し、そこからずらす。
// - 当てる点 `aim`: 体の真ん中（既定。コマンド戦闘の敵は板の真ん中、味方はアイコンの顔の真ん中、フィールドは足元から 0.6 マス上）／足元。
// - 基準点 `pivot`: 絵の中の点（0〜1。左上が [0, 0]、既定は真ん中 [0.5, 0.5]）。下の真ん中 [0.5, 1] にすると足元から上へ伸びる。
// - 大きさ `scale`（既定 1）: コマンド戦闘の敵は 1 で絵の 1 画素 ＝ 倍率 1 の板の 1 画素、コマンド戦闘の味方は 1 で画面の 1 画素、
//   フィールドは 1 で マップの 1 画素。
// - ずらし `offset` `[X, Y]`: CSS と同じ向き（X は右・Y は下が正）で、大きさを掛けない。単位は大きさと同じ（戦闘の絵の画素／画面の画素／マップの画素）。
// - 出す場所 `at`（コマンド戦闘の味方だけ。GS-330）: `icon`＝隊列の窓のその人の顔（既定）／`screen`＝画面の真ん中。
// 範囲は `EFFECT_PLACE_LIMITS`（Game Checker の `values.ts` と戦闘演出エディタの `validate.mjs` が使う）。

export type EffectAim = 'middle' | 'foot';
export const EFFECT_AIMS: readonly EffectAim[] = ['middle', 'foot'];

/** 味方に出す絵の出す場所（GS-330）。 */
export type PartyFxAt = 'icon' | 'screen';
export const PARTY_FX_AT: readonly PartyFxAt[] = ['icon', 'screen'];

/** 1 つの出し先の置き方。 */
export interface TargetPlace {
  aim?: EffectAim;
  /** 絵の中の基準点 `[横, 縦]`（0〜1。左上が 0）。 */
  pivot?: [number, number];
  /** 大きさの倍率。 */
  scale?: number;
  /** ずらし `[X, Y]`（X は右・Y は下が正。大きさを掛けない）。 */
  offset?: [number, number];
}

/** コマンド戦闘で味方に出すとき（画面に重ねる）。 */
export interface PartyTargetPlace extends TargetPlace {
  /** 出す場所（GS-330）。書かなければ顔。 */
  at?: PartyFxAt;
}

/** 置き方（`effects.json` の行の `place`）。 */
export interface EffectPlace {
  battle?: { foe?: TargetPlace; party?: PartyTargetPlace };
  field?: { foe?: TargetPlace; party?: TargetPlace };
}

/** どの画面か。 */
export type PlaceMode = 'battle' | 'field';
/** 敵に出すか味方に出すか。 */
export type PlaceTarget = 'foe' | 'party';

export const EFFECT_PLACE_LIMITS = {
  pivot: { min: 0, max: 1 },
  offset: { min: -2000, max: 2000 },
  scale: { min: 0.05, max: 10 },
} as const;

/** 置き方の項目（GS-335）。画面 → 出し先 → 値。 */
export const EFFECT_PLACE_KEYS = ['battle', 'field'] as const;
export const PLACE_TARGET_KEYS = ['foe', 'party'] as const;
export const TARGET_PLACE_KEYS = ['aim', 'pivot', 'scale', 'offset'] as const;
/** コマンド戦闘で味方に出すときだけ書ける項目。 */
export const PARTY_TARGET_PLACE_KEYS = ['aim', 'pivot', 'scale', 'offset', 'at'] as const;

/** 板に当てる形（`fieldFx` が使う）。 */
export interface PlaneAnchor {
  pivot: [number, number];
  /** ずらし（`fieldFx` の絵の 1 画素の長さで数える。右・上が正）。 */
  shift: [number, number];
}

/** その画面・出し先の置き方。 */
export const targetOf = (place: EffectPlace | undefined, mode: PlaceMode, target: PlaceTarget): PartyTargetPlace | undefined =>
  place?.[mode]?.[target];

const positive = (value: number | undefined, fallback: number) => (value && value > 0 ? value : fallback);

/** その画面・出し先の大きさ（書かなければ 1）。 */
export const scaleOf = (place: EffectPlace | undefined, mode: PlaceMode, target: PlaceTarget): number =>
  positive(targetOf(place, mode, target)?.scale, 1);

/** 足元を当てる点にするか。 */
export const aimsFoot = (place: EffectPlace | undefined, mode: PlaceMode, target: PlaceTarget): boolean =>
  targetOf(place, mode, target)?.aim === 'foot';

/**
 * 置き方から、その画面・出し先の基準点とずらしを決める（3D の板。`fieldFx` が使う）。
 * `fieldFx` は絵の 1 画素の長さ（大きさ込み）でずらしを数えるので、大きさを掛けないよう `size` で割っておく。
 * Y は CSS と同じ下が正なので、上が正へ返す。
 */
export function planeAnchor(place: EffectPlace | undefined, mode: PlaceMode, target: PlaceTarget, size = 1): PlaneAnchor {
  const one = targetOf(place, mode, target);
  const pivot: [number, number] = one?.pivot ? [one.pivot[0], one.pivot[1]] : [0.5, 0.5];
  const offset = one?.offset;
  const k = size > 0 ? size : 1;
  return { pivot, shift: offset ? [offset[0] / k, -offset[1] / k] : [0, 0] };
}

/** めくる回数の範囲（GS-336。`effects.json` の行の `loops`）。 */
export const EFFECT_LOOPS_RANGE = { min: 1, max: 99 } as const;

/** めくるコマ 1 回の長さ（ミリ秒）。コマ数 ÷ 1 秒にめくるコマ数。 */
export function effectCycleMs(def: { frames: [number, number]; fps: number }): number {
  const count = Math.max(1, def.frames[1] - def.frames[0] + 1);
  return def.fps > 0 ? (count * 1000) / def.fps : 0;
}

/** 回数を書いたときの出しておく時間（ミリ秒。1 回の長さ × 回数を整数へ切り上げ。1 以上）。 */
export function effectLoopsMs(def: { frames: [number, number]; fps: number }, loops: number): number {
  return Math.max(1, Math.ceil(effectCycleMs(def) * loops - 1e-6));
}

/**
 * フィールドアタックで、相手の足元から絵の置き場所（体の真ん中）までの高さ（マス）。
 * フィールドアタック（`useFieldAttack.tsx`）と戦闘演出エディタの見本で同じ値を使う。
 */
export const FIELD_FX_RISE = 0.6;

/** 行の置き方（フィールドエフェクトの行は持たない）。 */
export const placeOf = (def: { place?: EffectPlace } | object): EffectPlace | undefined =>
  'place' in def ? (def as { place?: EffectPlace }).place : undefined;

/**
 * コマンド戦闘の技の絵の大きさの倍率（GS-325）。`fieldFx` はマップの 1 マスの画素（`tilePx`）で数えるので、
 * 戦闘の絵の 1 マスの画素（`figurePx`）で数えるように `tilePx ÷ figurePx` を掛ける。
 * これで技の絵の 1 画素 ＝ 倍率 1 の敵・味方の板の 1 画素（1：1）。
 */
export function battleFxScale(tilePx: number, figurePx: number): number {
  const tile = tilePx > 0 ? tilePx : 32;
  return figurePx > 0 ? tile / figurePx : 1;
}

/**
 * 隊列の窓の行で、当てる点を置く所（GS-328。行の左下からの画素）。顔（80×80。行の左下）の真ん中と下端。
 * 当てる点が「体の真ん中」なら (x, middle)、「足元」なら (x, 0)。
 */
export const PARTY_FX_FACE = { x: 40, middle: 40 } as const;
/** 画面の真ん中に出すとき（GS-330）の当てる点。戦闘画面（1280×720）の左下からの画素。当てる点の「足元」は使わない。 */
export const PARTY_FX_SCREEN = { x: 640, middle: 360 } as const;

/** コマンド戦闘で味方に出す絵の出す場所（書かなければ顔。GS-330）。 */
export const partyAtOf = (place: EffectPlace | undefined): PartyFxAt => (place?.battle?.party?.at === 'screen' ? 'screen' : 'icon');

/**
 * コマンド戦闘で味方に出す技の絵の箱（GS-328・GS-330）。`face` の左下からの画素で、`left`・`bottom`・幅・高さ。
 * 出す場所が顔なら隊列の窓の行（`PARTY_FX_FACE`）、画面の真ん中なら戦闘画面（`PARTY_FX_SCREEN`。当てる点はいつも真ん中）。
 * 大きさは画面の画素: 絵の 1 画素 × 大きさの変化（`size`）× `battle.party.scale`。基準点を当てる点に合わせ、
 * `battle.party.offset`（画面の画素。X は右・Y は下が正）を足す。
 */
export function partyFxBox(
  frame: { width: number; height: number },
  size: number,
  place: EffectPlace | undefined,
  face: { x: number; middle: number } = partyAtOf(place) === 'screen' ? PARTY_FX_SCREEN : PARTY_FX_FACE,
): { left: number; bottom: number; width: number; height: number; pivot: [number, number] } {
  const one = place?.battle?.party;
  const k = scaleOf(place, 'battle', 'party');
  const width = frame.width * size * k;
  const height = frame.height * size * k;
  const [dx, dy] = one?.offset ?? [0, 0];
  const x = face.x + dx;
  // 下からの画素で数えるので、Y（下が正）は引く。
  const y = (aimsFoot(place, 'battle', 'party') && partyAtOf(place) === 'icon' ? 0 : face.middle) - dy;
  const [px, py] = one?.pivot ?? [0.5, 0.5];
  return { left: x - px * width, bottom: y - (1 - py) * height, width, height, pivot: [px, py] };
}

/**
 * 板の真ん中を、当てる点からどれだけ動かすか（画面の右・上へ、ワールドの長さ）。
 * `width` / `height` は今の板の大きさ（大きさの変化込み）、`perPx` は絵の 1 画素あたりの長さ（大きさの変化は入れない）。
 */
export function planeCenterShift(anchor: PlaneAnchor, width: number, height: number, perPx: number): { right: number; up: number } {
  const [px, py] = anchor.pivot;
  return {
    right: (0.5 - px) * width + anchor.shift[0] * perPx,
    up: (py - 0.5) * height + anchor.shift[1] * perPx,
  };
}
