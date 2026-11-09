// 戦闘のマスの割り当て（2026-10-29 / GS-280）。隊形の枠から、この戦闘で誰がどのマスに立つかを決める。
//
// - 味方は**横一列の前衛**: 前の行（`|row|` がいちばん小さい行）の枠を並び順に使う。足りなければ次に近い行へ。
//   隊形が寄せないと書いていなければ、行ごとに横の真ん中へ寄せる（中央配置の補正）。
// - 敵は**配置範囲と札**（2026-11-07 / GS-316）: 隊形の `enemy`（札＝優先して立たせるマス）から人数ぶんをくじで選び、
//   札より多ければ、残りは `enemyArea`（配置範囲）の札の無いマスからくじで選ぶ。範囲の外には立たない。敵は寄せない。
//   どの敵がどのマスに入るかは、前の行のマスほど「前衛に出る確率」（`front`）の高い敵が入りやすいくじ。
// 画面にも乱数にも触らない（乱数は呼ぶ側から渡す）。隊列のメニューで前後を選ぶ形は後で足す。

import type { BattleFormationDef, BattleFormationSlot } from './book';
import { canStand, type CellGround } from './height';
import type { Fighter } from './rules';

/** マスの地形（2026-10-29 / GS-285）。舞台の点の床からの高さ（フィールドのマス）と分け方。地形を知らなければ null。 */
export interface CellTerrain {
  ground: CellGround;
  height: number | null;
}
/** マスの地形を聞く口（GameView が地形から拾う）。 */
export type TerrainOf = (cell: { col: number; row: number }) => CellTerrain | null;

/** 前衛に出る確率の既定（GS-286）。前と後ろで同じ重み＝一様なくじ。 */
export const DEFAULT_FRONT = 0.5;

/** 敵のくじを引き直す回数の上限（立てないマスを避ける。GS-285 / GS-288）。引き切れなければ最後のくじのまま。 */
const SKY_RETRIES = 24;

/**
 * この戦闘のマスを決めて `Fighter.cell` に入れる。味方は横一列・敵は札と配置範囲からくじ。
 * 枠が足りない陣営は入れない（その人たちは前衛・後衛の決まりの外。画面は隊形の並び順で立たせる）。
 * 返すのは id → マス（高さ込み。舞台の板に渡す）。
 */
export function assignBattleCells(
  fighters: Fighter[],
  formation: BattleFormationDef | null,
  random: () => number,
  options: {
    /** マスの地形（GS-285）。渡すと、敵は立てないマスを避けてくじを引き直し、`Fighter.cell` に高さと分け方を入れる。 */
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
    [party, partyCells(formation.party, party.length, center, terrainOf)],
    [enemies, enemyCells(formation.enemy, formation.enemyArea, enemies.length, random, terrainOf,
      frontOf ? enemies.map((who) => frontOf(who) ?? DEFAULT_FRONT) : undefined, enemies.map((who) => !!who.flying))],
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
 * 味方の並び（GS-288）。横一列のマスが立てないマス（`block`・空）に掛かったら、そのマスの枠を除いて並べ直し、
 * それでも掛かれば寄せずに並べる。どうしても避けられなければ最初の並びのまま。
 */
export function partyCells(
  slots: BattleFormationSlot[] | undefined,
  count: number,
  center: boolean,
  terrainOf?: TerrainOf,
): BattleFormationSlot[] | null {
  const first = partyLineCells(slots, count, center);
  if (!terrainOf || !first || !slots) return first;
  const bad = (cell: { col: number; row: number }) => !canStand(terrainOf(cell)?.ground);
  if (!first.some(bad)) return first;
  const open = slots.filter((slot) => !bad(slot));
  for (const tryCenter of [center, false]) {
    const cells = partyLineCells(open, count, tryCenter);
    if (cells && !cells.some(bad)) return cells;
  }
  return first;
}

/**
 * 敵のマス（GS-316）。札と配置範囲から `enemyPlacement` で選び、立てないマスに当たったら引き直す——
 * `block` は誰も、空のマスは飛ばない敵が立てない。誰も立てない `block` のマスは先に除く（除くと足りなければ除かない）。
 * 引き直しても避けられなければ、最後のくじのまま（その敵は宙に立つ。戦闘演出エディタが ⚠ で知らせる）。
 */
export function enemyCells(
  slots: BattleFormationSlot[] | undefined,
  area: BattleFormationSlot[] | undefined,
  count: number,
  random: () => number,
  terrainOf?: TerrainOf,
  /** 敵ごとの前衛に出る確率（GS-286）。並び順。 */
  fronts?: number[],
  /** 敵ごとに飛ぶか（GS-288）。並び順。飛ぶ敵は空のマスに立てる。 */
  flyers?: boolean[],
): BattleFormationSlot[] | null {
  let useSlots = slots;
  let useArea = area;
  if (terrainOf && Array.isArray(slots)) {
    const open = (cell: { col: number; row: number }) => terrainOf(cell)?.ground !== 'block';
    const openSlots = slots.filter(open);
    const openArea = Array.isArray(area) ? area.filter(open) : undefined;
    if (enemyRoom(openSlots, openArea) >= count) { useSlots = openSlots; useArea = openArea; }
  }
  let cells = enemyPlacement(useSlots, useArea, count, random, fronts);
  if (!terrainOf) return cells;
  const bad = (list: BattleFormationSlot[]) => list.some((cell, at) => !canStand(terrainOf(cell)?.ground, !!flyers?.[at]));
  for (let round = 0; cells && round < SKY_RETRIES && bad(cells); round += 1) {
    cells = enemyPlacement(useSlots, useArea, count, random, fronts);
  }
  return cells;
}

/** 同じマスか。 */
const sameCell = (a: { col: number; row: number }, b: { col: number; row: number }) => a.col === b.col && a.row === b.row;

/** 敵が立てるマスの数（札と、範囲の札の無いマス。範囲が無ければ札だけ）。人数の上限。 */
export function enemyRoom(slots: BattleFormationSlot[] | undefined, area: BattleFormationSlot[] | undefined): number {
  if (!Array.isArray(slots)) return 0;
  const extra = Array.isArray(area) ? area.filter((cell) => !slots.some((slot) => sameCell(slot, cell))).length : 0;
  return slots.length + extra;
}

/**
 * 敵の並び（GS-316）。返す順は敵の並び順（`enemy:1` が先頭の敵）。立てるマスが足りなければ null。
 * 1. マスを選ぶ: 人数が札の数以下なら札の中からくじ。多ければ札を全部使い、残りを範囲の札の無いマスからくじ。
 * 2. 敵を入れる: 選んだマスを前の行（`|row|` の小さい行）から順に、残っている敵からくじで入れる。
 *    重みは、選んだマスのうちいちばん前の行なら `front`、ほかの行なら `1 - front`（`fronts` が無ければ全員 0.5 で一様）。
 *    重みが全部 0 なら一様に選ぶ。
 */
export function enemyPlacement(
  slots: BattleFormationSlot[] | undefined,
  area: BattleFormationSlot[] | undefined,
  count: number,
  random: () => number,
  fronts?: number[],
): BattleFormationSlot[] | null {
  if (!usable(slots) || count < 1) return null;
  const extra = usable(area) ? area.filter((cell) => !slots.some((slot) => sameCell(slot, cell))) : [];
  if (slots.length + extra.length < count) return null;
  const pick = (pool: BattleFormationSlot[], n: number) => {
    const rest = pool.map((cell) => ({ ...cell }));
    return Array.from({ length: n }, () => rest.splice(Math.min(rest.length - 1, Math.max(0, Math.floor(random() * rest.length))), 1)[0]!);
  };
  const chosen = count <= slots.length ? pick(slots, count) : [...slots.map((slot) => ({ ...slot })), ...pick(extra, count - slots.length)];
  const nearest = Math.min(...chosen.map((cell) => Math.abs(cell.row)));
  const order = [...chosen].sort((a, b) => Math.abs(a.row) - Math.abs(b.row));
  const left = Array.from({ length: count }, (_, index) => index);
  const out: BattleFormationSlot[] = new Array(count);
  for (const cell of order) {
    const front = Math.abs(cell.row) === nearest;
    const weights = left.map((index) => {
      const value = Math.min(1, Math.max(0, fronts?.[index] ?? DEFAULT_FRONT));
      return front ? value : 1 - value;
    });
    const total = weights.reduce((sum, one) => sum + one, 0);
    const r = random();
    let at = Math.min(left.length - 1, Math.max(0, Math.floor(r * left.length)));
    if (total > 0) {
      let rest = r * total;
      at = weights.findIndex((one) => (rest -= one) < 0);
      if (at < 0) at = left.length - 1;
    }
    out[left.splice(at, 1)[0]!] = cell;
  }
  return out;
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
