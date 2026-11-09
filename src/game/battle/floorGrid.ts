// コマンド戦闘の床のマス（2026-11-09 / GS-342・GS-343）。戦闘のマスの境目に黒い線を敷き、奥行きの線を白い光が手前から奥へ走る。
// 敵の立つマスは赤く光らせる。ここは線の並び・出す決まり・描く順だけ（マスの番号で返す）。
// 床へ置く・光らせるのは `src/view/battleFloorGrid.ts`。
// 戦闘演出エディタの「マスを出す」の線（GameView の `createStageCells`）とは別物で、あちらは今の見た目のまま。

import { STAGE_ROW_ORDER, STAGE_ROW_STEP } from './stage';

/** 線 1 本。両端はマスの境目の番号（半マスずれた所。`row` は手前が正）。 */
export interface FloorGridLine {
  /** `depth` は手前から奥へ伸びる線（光が走る）、`across` は横の線。 */
  kind: 'depth' | 'across';
  from: { col: number; row: number };
  to: { col: number; row: number };
  /** 白い光の濃さ（0〜1）。舞台の外側ほど薄くして、縁を床へなじませる。黒い線はどこも同じ濃さ（GS-346）。 */
  weight: number;
}

/**
 * 光のくじ（GS-343）。奥行きの線ごとに `FLOOR_GRID_PERIOD_S` 秒で区切り、区切りごとに `FLOOR_GRID_RUN_CHANCE` の割合で走る。
 * 走るときは区切りのうち `FLOOR_GRID_RUN_SHARE`（の 0.75〜1.25 倍）の間で手前から奥へ抜け、走り出す時もくじ。
 */
export const FLOOR_GRID_PERIOD_S = 2.2;
export const FLOOR_GRID_RUN_CHANCE = 0.45;
export const FLOOR_GRID_RUN_SHARE = 0.55;
/** 線の幅と、光のにじみの幅（戦闘のマス）。 */
export const FLOOR_GRID_LINE_WIDTH = 0.06;
export const FLOOR_GRID_GLOW_WIDTH = 0.4;
/** 出し入れの速さ（1 秒あたりの濃さ）。行動の間は消し、手を聞く間・待機は出す。 */
export const FLOOR_GRID_FADE_PER_S = 4;
/** 敵のマスの赤い光の内側への縮め（マス）。線と重ならないよう少し内へ。 */
export const ENEMY_CELL_INSET = 0.06;

/** 外側ほど薄くする濃さ。真ん中は 1、いちばん外の線で `edge`。 */
function weightAt(at: number, low: number, high: number, edge = 0.45): number {
  const mid = (low + high) / 2;
  const half = (high - low) / 2 || 1;
  const k = Math.min(1, Math.abs(at - mid) / half);
  return 1 - (1 - edge) * k * k;
}

/**
 * 戦闘のマス `grid`（横 `across`・奥 `depth` の番号の範囲）の境目の線。奥行きの線は手前（`row` の大きい側）から奥へ向く。
 */
export function floorGridLines(grid: { across: [number, number]; depth: [number, number] }): FloorGridLine[] {
  const [c0, c1] = [grid.across[0] - 0.5, grid.across[1] + 0.5];
  const [r0, r1] = [grid.depth[0] - 0.5, grid.depth[1] + 0.5];
  const lines: FloorGridLine[] = [];
  for (let col = c0; col <= c1 + 1e-6; col += 1) {
    lines.push({ kind: 'depth', from: { col, row: r1 }, to: { col, row: r0 }, weight: weightAt(col, c0, c1) });
  }
  for (let row = r0; row <= r1 + 1e-6; row += 1) {
    lines.push({ kind: 'across', from: { col: c0, row }, to: { col: c1, row }, weight: weightAt(row, r0, r1) });
  }
  return lines;
}

/**
 * 床のマス（線・赤いマス）を描く順。**舞台の板（`stageFigureOrder`）のいちばん奥の行より前**にする（GS-343）。
 * 線は深度を見ずに描くので、板より後に描くと奥の敵の板の上に線が重なって見えた。返すのは線の順で、赤いマスはその次。
 */
export function floorGridOrder(depth: [number, number]): number {
  return STAGE_ROW_ORDER + (Math.min(depth[0], 0) - 2) * STAGE_ROW_STEP;
}

/** 敵のマスの四隅（手前左・手前右・奥右・奥左。マスの番号）。 */
export function enemyCellCorners(cell: { col: number; row: number }): Array<{ col: number; row: number }> {
  const half = 0.5 - ENEMY_CELL_INSET;
  return [
    { col: cell.col - half, row: cell.row + half },
    { col: cell.col + half, row: cell.row + half },
    { col: cell.col + half, row: cell.row - half },
    { col: cell.col - half, row: cell.row - half },
  ];
}

/** 床のマスを出すか。技や攻撃が流れる間（カメラの場面 `action`）と、エディタのマスの線を出している間は出さない。 */
export function floorGridShown(phase: 'command' | 'action' | null, editorCells: boolean): boolean {
  return phase !== 'action' && !editorCells;
}

/** 敵のマスの赤い光を出すか。技が流れる間と、倒れた敵のマスは出さない。エディタの線を出していても出す（GS-343）。 */
export function enemyCellShown(phase: 'command' | 'action' | null, gone: boolean): boolean {
  return phase !== 'action' && !gone;
}

/** 出し入れの濃さを 1 フレーム進める（0〜1）。 */
export function stepFloorGridFade(fade: number, shown: boolean, dt: number): number {
  const step = FLOOR_GRID_FADE_PER_S * Math.max(0, dt);
  return shown ? Math.min(1, fade + step) : Math.max(0, fade - step);
}
