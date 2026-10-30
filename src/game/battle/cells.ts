// 戦闘のマスの割り当て（2026-10-29 / GS-280）。隊形の枠から、この戦闘で誰がどのマスに立つかを決める。
//
// - 味方は**横一列の前衛**: 前の行（`|row|` がいちばん小さい行）の枠を並び順に使う。足りなければ次に近い行へ。
// - 敵は**くじ**: 枠の中から人数ぶんを選ぶ。前の行から先に埋めることはしない（並びのばらつきを残す）。
// どちらも、隊形が寄せないと書いていなければ横の真ん中へ寄せる。
// 画面にも乱数にも触らない（乱数は呼ぶ側から渡す）。隊列のメニューで前後を選ぶ形は後で足す。

import type { BattleFormationDef, BattleFormationSlot } from './book';
import type { CellGround } from './height';
import type { Fighter } from './rules';

/** マスの地形（2026-10-29 / GS-285）。舞台の点の床からの高さ（フィールドのマス）と分け方。地形を知らなければ null。 */
export interface CellTerrain {
  ground: CellGround;
  height: number | null;
}
/** マスの地形を聞く口（GameView が地形から拾う）。 */
export type TerrainOf = (cell: { col: number; row: number }) => CellTerrain | null;

/** 前衛に出る確率の既定（GS-286）。前と後ろで同じ重み＝今までの一様なくじ。 */
export const DEFAULT_FRONT = 0.5;

/** 敵のくじを引き直す回数の上限（空のマスを避ける。GS-285）。引き切れなければ最後のくじのまま。 */
const SKY_RETRIES = 24;

/**
 * この戦闘のマスを決めて `Fighter.cell` に入れる。味方は横一列・敵はくじ。
 * 枠が足りない陣営は入れない（その人たちは前衛・後衛の決まりの外。画面は隊形の並び順で立たせる）。
 * 返すのは id → マス（高さ込み。舞台の板に渡す）。
 */
export function assignBattleCells(
  fighters: Fighter[],
  formation: BattleFormationDef | null,
  random: () => number,
  options: {
    /** マスの地形（GS-285）。渡すと、敵は空のマスを避けてくじを引き直し、`Fighter.cell` に高さと分け方を入れる。 */
    terrainOf?: TerrainOf;
    /** 敵ごとの前衛に出る確率（0〜1。GS-286。台帳の `front`）。書かない・null なら 0.5。 */
    frontOf?: (who: Fighter) => number | null | undefined;
  } = {},
): Map<string, BattleFormationSlot> {
  const { terrainOf, frontOf } = options;
  const out = new Map<string, BattleFormationSlot>();
  if (!formation) return out;
  const center = formation.center !== false;
  const party = fighters.filter((who) => who.side === 'party');
  const enemies = fighters.filter((who) => who.side === 'enemy');
  const sides: Array<[Fighter[], BattleFormationSlot[] | null]> = [
    [party, partyLineCells(formation.party, party.length, center)],
    [enemies, enemyCells(formation.enemy, enemies.length, random, center, terrainOf, frontOf ? enemies.map((who) => frontOf(who) ?? DEFAULT_FRONT) : undefined)],
  ];
  for (const [list, cells] of sides) {
    if (!cells) continue;
    list.forEach((who, at) => {
      const cell = cells[at]!;
      const terrain = terrainOf?.(cell) ?? null;
      who.cell = { col: cell.col, row: cell.row, ...(terrain ? { ground: terrain.ground, ...(terrain.height !== null ? { height: terrain.height } : {}) } : {}) };
      out.set(who.id, cell);
    });
  }
  return out;
}

/**
 * 敵のくじ（GS-285）。空のマス（床が無い）に当たったら引き直す。飛ぶ敵はまだ無いので、空には誰も立たせない。
 * 引き直しても避けられなければ、最後のくじのまま（その敵は宙に立つ。戦闘演出エディタが ⚠ で知らせる）。
 */
export function enemyCells(
  slots: BattleFormationSlot[] | undefined,
  count: number,
  random: () => number,
  center: boolean,
  terrainOf?: TerrainOf,
  /** 敵ごとの前衛に出る確率（GS-286）。並び順。 */
  fronts?: number[],
): BattleFormationSlot[] | null {
  let cells = randomCells(slots, count, random, center, fronts);
  if (!terrainOf) return cells;
  for (let round = 0; cells && round < SKY_RETRIES && cells.some((cell) => terrainOf(cell)?.ground === 'sky'); round += 1) {
    cells = randomCells(slots, count, random, center, fronts);
  }
  return cells;
}

/** 前から近い順（`|row|` の小さい順）。同じ近さなら書いた順のまま。 */
function nearFirst(slots: BattleFormationSlot[]): BattleFormationSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => Math.abs(a.slot.row) - Math.abs(b.slot.row) || a.index - b.index)
    .map((one) => one.slot);
}

/** 横の真ん中へ寄せる量（列の平均の逆を整数に丸める）。 */
function shiftOf(slots: Array<{ col: number }>): number {
  if (!slots.length) return 0;
  const mean = slots.reduce((sum, slot) => sum + slot.col, 0) / slots.length;
  return -Math.round(mean) || 0;
}

/** 使える枠か（マスの番号は整数・高さは数）。 */
function usable(slots: BattleFormationSlot[] | undefined): slots is BattleFormationSlot[] {
  return Array.isArray(slots) && slots.every((slot) => Number.isInteger(slot.col) && Number.isInteger(slot.row)
    && (slot.height === undefined || Number.isFinite(slot.height)));
}

/**
 * 味方の並び。前の行の枠を並び順に使い、**行ごとに**真ん中へ寄せる。枠が足りなければ null。
 * 返す順は並び順（`party:1` が先頭の人）。
 */
export function partyLineCells(slots: BattleFormationSlot[] | undefined, count: number, center = true): BattleFormationSlot[] | null {
  if (!usable(slots) || count < 1 || slots.length < count) return null;
  const picked = nearFirst(slots).slice(0, count).map((slot) => ({ ...slot }));
  if (!center) return picked;
  for (const row of new Set(picked.map((slot) => slot.row))) {
    const line = picked.filter((slot) => slot.row === row);
    const shift = shiftOf(line);
    for (const slot of line) slot.col += shift;
  }
  return picked;
}

/**
 * 敵の並び。枠から人数ぶんをくじで選び（同じ枠は 2 度使わない）、全体を横の真ん中へ寄せる。枠が足りなければ null。
 * 返す順は敵の並び順（`enemy:1` が先頭の敵）。
 * `fronts` を渡すと、その敵が前の行（`|row|` がいちばん小さい行）の枠に入る重みを `front`、後ろの枠を `1 - front` にする（GS-286）。
 * 0.5 なら一様なくじと同じ。重みが全部 0 になった（例: 1 なのに前が埋まった）ら、残りから一様に選ぶ。
 */
export function randomCells(
  slots: BattleFormationSlot[] | undefined,
  count: number,
  random: () => number,
  center = true,
  fronts?: number[],
): BattleFormationSlot[] | null {
  if (!usable(slots) || count < 1 || slots.length < count) return null;
  const pool = slots.map((slot) => ({ ...slot }));
  const nearest = Math.min(...slots.map((slot) => Math.abs(slot.row)));
  const picked: BattleFormationSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const front = fronts?.[i];
    const r = random();
    let at = Math.min(pool.length - 1, Math.max(0, Math.floor(r * pool.length)));
    if (front !== undefined && front !== DEFAULT_FRONT) {
      const p = Math.min(1, Math.max(0, front));
      const weights = pool.map((slot) => (Math.abs(slot.row) === nearest ? p : 1 - p));
      const total = weights.reduce((sum, one) => sum + one, 0);
      if (total > 0) {
        // 同じくじを重み付きの位置へ読み替える（くじの回数を変えない）。
        let left = r * total;
        at = weights.findIndex((one) => (left -= one) < 0);
        if (at < 0) at = pool.length - 1;
      }
    }
    picked.push(pool.splice(at, 1)[0]!);
  }
  if (!center) return picked;
  const shift = shiftOf(picked);
  return picked.map((slot) => ({ ...slot, col: slot.col + shift }));
}
