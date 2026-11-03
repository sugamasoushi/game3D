// 技の絵のフィールドエフェクト（GS-297）。マップのフィールドエフェクト（爆発・光の柱など）を、相手の所へ 1 回出す。
//
// 描き方はマップと同じ物（`mep3d/fieldEffects.ts` の `createFieldEffects`）を、出すたびに 1 つ借りて使う。
// 借りた物は時間 0 から流すので、くり返す種類（爆発は 3 秒ごと）でも出した瞬間が始まりになる。
// ここは置き場所の箱と濃さの決め方だけ（three を描かないのでテストできる）。借りる・返すのは `fieldFx.ts`。

import { readFieldPreset, type FieldEffectVolume } from '../mep3d/fieldEffects';
import type { FieldEffectEntry, SkillFieldCell } from './battle/book';
import { STAGE_ROW_STEP, stageFigureOrder } from './battle/stage';

/** 終わりぎわに薄くする長さ（ミリ秒）。出しておく時間の 3 割より長くはしない。 */
const FADE_MS = 300;

/** 置き場所の点（マス）。`at` は絵の真ん中、`foot` は足元の高さ。 */
export interface SkillFieldSpot {
  at: { x: number; y: number; z: number };
  foot: number;
}

/**
 * 置き場所の箱（マス）。`grow` はマップの `CharacterScale` × 技の倍率。
 * - 爆発: 真ん中（`at`）に、幅の立方体（球の直径＝幅）。`lift` は上下へずらす。
 * - 衝撃波: 足元に寝かせた板（幅 × 幅）。
 * - 光の柱・炎・雷・フラッシュ: 足元から `thick` の高さの箱。
 */
export function skillFieldVolume(def: FieldEffectEntry, spot: SkillFieldSpot, grow = 1): FieldEffectVolume | null {
  const look = readFieldPreset({ id: 'skill-fx', name: def.name ?? '', ...def.field, on: true });
  if (!look) return null;
  const k = grow > 0 ? grow : 1;
  const half = (Math.max(0.05, def.size) * k) / 2;
  const lift = look.lift * k;
  const { x, z } = spot.at;
  const box = (minY: number, maxY: number): FieldEffectVolume => ({
    look,
    plane: 'xz',
    baseY: minY,
    minX: x - half,
    maxX: x + half,
    minY,
    maxY,
    minZ: z - half,
    maxZ: z + half,
  });
  if (look.kind === 'explosion') return box(spot.at.y + lift - half, spot.at.y + lift + half);
  const floor = spot.foot + lift;
  if (look.kind === 'shockwave') return box(floor, floor + Math.max(0.05, look.thick * k));
  return box(floor, floor + Math.max(0.2, look.thick * k));
}

/**
 * 戦闘で出すマス（GS-298）。`target` は相手のマス、`side` は相手の陣の真ん中（`side` に渡したマスの平均。
 * 空なら相手のマス）、`stage` は舞台の点（0,0）。そこから `col` / `row` ずらす。小数のマスもそのまま返す。
 */
export function skillFieldCell(
  cell: SkillFieldCell | undefined,
  target: { col: number; row: number },
  side: ReadonlyArray<{ col: number; row: number }> = [],
): { col: number; row: number } {
  const from = cell?.from ?? 'target';
  let base = target;
  if (from === 'stage') base = { col: 0, row: 0 };
  else if (from === 'side' && side.length > 0) {
    base = {
      col: side.reduce((sum, one) => sum + one.col, 0) / side.length,
      row: side.reduce((sum, one) => sum + one.row, 0) / side.length,
    };
  }
  return { col: base.col + (cell?.col ?? 0), row: base.row + (cell?.row ?? 0) };
}

/**
 * 戦闘で描く順（GS-298）。舞台の板は深度を書かず描く順で前後を決める（`stageFigureOrder`）ので、エフェクトも
 * **そのマスの列の板より後、手前の列の板より前**に描く。同じ列の相手より手前に見え、手前の列の人には隠れる。
 */
export function skillFieldOrder(row: number): number {
  return stageFigureOrder(Math.floor(row + 1e-6), STAGE_ROW_STEP - 1) + 0.5;
}

/** 出してから `t` ミリ秒の濃さ（0..1）。終わりぎわに薄くする。 */
export function skillFieldWeight(t: number, ms: number): number {
  const fade = Math.min(FADE_MS, Math.max(1, ms) * 0.3);
  const left = ms - t;
  if (left <= 0) return 0;
  return Math.min(1, left / fade);
}
