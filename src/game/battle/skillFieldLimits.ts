// 技の絵のフィールドエフェクトの決まり（GS-297）。種類・種類ごとに使う値・値の範囲。
// 何も読み込まない（Game Checker の値の検査と、台帳エディタの実行時の読み込みからも使う）。
// 戦闘演出エディタの `validate.mjs` に同じ物の写しがある（Game Checker が見比べる）。

/** 技に使える種類。**1 回出して終わる物**だけ——霧・雨・水面・風のような場の空気は外す。 */
export const SKILL_FIELD_KINDS = ['explosion', 'pillar', 'shockwave', 'lightning', 'flash', 'fire'] as const;
export type SkillFieldKind = (typeof SKILL_FIELD_KINDS)[number];

/**
 * 種類ごとに書ける見た目の値（`kind` のほか）。爆発と衝撃波は高さ（`thick`）を使わない
 * （爆発は幅が球の直径、衝撃波は床に寝かせる）。
 */
export const SKILL_FIELD_KEYS: Record<SkillFieldKind, readonly string[]> = {
  explosion: ['color', 'amount', 'speed', 'scale', 'lift', 'ringBlur'],
  pillar: ['color', 'amount', 'speed', 'scale', 'thick', 'lift', 'ringBlur'],
  shockwave: ['color', 'amount', 'speed', 'scale', 'lift', 'richness'],
  lightning: ['color', 'amount', 'speed', 'scale', 'thick', 'lift', 'lightningCount', 'lightningWidth', 'lightningGap'],
  flash: ['color', 'amount', 'speed', 'scale', 'thick', 'lift'],
  fire: ['color', 'amount', 'speed', 'scale', 'thick', 'lift', 'richness'],
};

/** 値の範囲（マップエディタの「エフェクト編集」と同じ）。`int` は整数だけ。 */
export const SKILL_FIELD_RANGES: Record<string, { min: number; max: number; int?: boolean }> = {
  amount: { min: 0, max: 1 },
  speed: { min: 0, max: 4 },
  scale: { min: 0.2, max: 3 },
  thick: { min: 0.5, max: 24 },
  lift: { min: -10, max: 10 },
  ringBlur: { min: 0, max: 1 },
  richness: { min: 0, max: 1 },
  lightningCount: { min: 1, max: 5, int: true },
  lightningWidth: { min: 0.2, max: 20 },
  lightningGap: { min: 0, max: 0.9 },
};

/** 出すマスの基準（GS-298）。相手の立つマス・相手の陣の真ん中・舞台の点。 */
export const SKILL_FIELD_FROM = ['target', 'side', 'stage'] as const;
export type SkillFieldFrom = (typeof SKILL_FIELD_FROM)[number];
/** 出すマスのずらし（戦闘のマス。`col` / `row`）の範囲。半マスも書ける。 */
export const SKILL_FIELD_SHIFT = { min: -10, max: 10 };

/** 幅（マス × マップの `CharacterScale`）の範囲。 */
export const SKILL_FIELD_SIZE = { min: 0.1, max: 30 };
