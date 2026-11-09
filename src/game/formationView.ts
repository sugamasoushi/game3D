// メニュー「作戦」→ 隊列（2026-11-07）で見せる、コマンド戦闘の味方の並び。**数と決まりだけ**（画面を知らない）。
//
// 並べ方は戦闘と同じ `cells.ts` の `partyLineCells`（横一列の前衛から。寄せる隊形なら真ん中へ寄せる）、
// 前衛・後衛と「守られる」は `cover.ts` の `shields`、かばえる近さは `COVER_COLS`・`COVER_ROWS`。
// 戦闘はマップごとの候補から隊形をくじで選ぶので、ここは既定の隊形（`battleFormations.json` の `default`）で見せる。
// 地形（高台・空）はマップで変わるので見ない。隊列の入れ替えはまだ無い（見せるだけ）。

import type { BattleFormationDef } from './battle/book';
import { partyLineCells } from './battle/cells';
import { COVER_COLS, COVER_ROWS, shields } from './battle/cover';
import type { Fighter } from './battle/rules';

/** 隊列の 1 人ぶん。 */
export interface FormationSeat {
  who: string;
  col: number;
  row: number;
  /** 前衛（並んだうちでいちばん前の行）か後衛か。 */
  line: 'front' | 'back';
  /** この人を前で守っている人（いれば単体の技・通常攻撃で狙われない）。 */
  guardedBy: string[];
  /** 「かばう」を使えばこの人がかばえる仲間（横 `COVER_COLS`・前後 `COVER_ROWS` 以内）。 */
  covers: string[];
}

/** 決まりの関数に渡すための、最低限の 1 人（生きている味方）。 */
function seatFighter(who: string, cell: { col: number; row: number }): Fighter {
  return {
    id: who,
    name: who,
    side: 'party',
    stats: { level: 1, hp: 1, mp: 0, attack: 0, guard: 0, speed: 1 },
    hp: 1,
    mp: 0,
    guarding: 0,
    avoiding: false,
    ailments: [],
    cell: { col: cell.col, row: cell.row },
  };
}

/**
 * 隊列の並び。並べられない（隊形が無い・枠が足りない）なら空。並びは隊列の順のまま。
 */
export function formationSeats(party: readonly string[], formation: BattleFormationDef | null): FormationSeat[] {
  if (!formation || party.length === 0) return [];
  const cells = partyLineCells(formation.party, party.length, formation.center !== false);
  if (!cells) return [];
  const fighters = party.map((who, at) => seatFighter(who, cells[at]!));
  const front = Math.min(...cells.map((cell) => Math.abs(cell.row)));
  return fighters.map((one, at) => {
    const cell = cells[at]!;
    return {
      who: one.id,
      col: cell.col,
      row: cell.row,
      line: Math.abs(cell.row) === front ? 'front' : 'back',
      guardedBy: fighters.filter((other) => shields(other, one)).map((other) => other.id),
      covers: fighters
        .filter((other) => other !== one && Math.abs(other.cell!.col - cell.col) <= COVER_COLS && Math.abs(other.cell!.row - cell.row) <= COVER_ROWS)
        .map((other) => other.id),
    };
  });
}

/** 並びを格子に置くときの範囲（横の列・奥の行）。前の行（敵に近い）が先。 */
export function seatGrid(seats: readonly FormationSeat[]): { cols: number[]; rows: number[] } {
  if (!seats.length) return { cols: [], rows: [] };
  const minCol = Math.min(...seats.map((one) => one.col));
  const maxCol = Math.max(...seats.map((one) => one.col));
  const cols = Array.from({ length: maxCol - minCol + 1 }, (_, at) => minCol + at);
  const rows = [...new Set(seats.map((one) => one.row))].sort((a, b) => Math.abs(a) - Math.abs(b));
  return { cols, rows };
}
