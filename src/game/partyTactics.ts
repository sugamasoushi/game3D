// 仲間の作戦（2026-11-05 / GS-305。フィールド戦闘の段階 3）。**一緒に行動するか、離れて行動するか。**
//
// - 作戦は隊列ぜんぶで 1 つ（名前は 2026-11-07 に ついてくる／自由に戦う／その場で待つ から変えた）。キー C（ゲームパッドの Select）で 「戦わない → 移動・迎撃 → 移動・攻撃 → 自由に戦闘 → 待機・迎撃」 と回す（移動・攻撃と自由に戦闘は 2026-11-07 に足した）。
//   - 戦わない（`follow`）: 今までどおり主人公の通った道をたどる。攻めない。離れていた仲間は道へ歩いて戻る。
//   - 移動・迎撃（`fight`）: 近く（`ALLY_SIGHT` マス）で**こちらに気づいている**敵シンボルがいれば、列を離れて近づき、
//     自分のフィールドアタック（`party.json` の `fieldAttack`。無ければ素手）で攻める。いなくなれば道へ戻る。
//   - 移動・攻撃（`attack`）: 移動・迎撃と同じく近く（`ALLY_SIGHT` マス）の敵へ向かうが、**気づいていない敵も**攻める。
//     狙うのは先頭からも `ALLY_SIGHT` マス以内の敵だけ（隊列の近くで戦う）。いなくなれば道へ戻る。
//   - 自由に戦闘（`free`）: 自分から `FREE_SIGHT` マス以内の敵を見つけたら（気づいていなくても）、先頭から離れても攻め続ける。
//     倒したら今の所から次の敵を探す。見つからなくなったら道へ戻る。
//   - 待機・迎撃（`stay`）: 今いる所に留まる。届く敵シンボルは（気づいていなくても）攻める。
// - 仲間の攻撃は `ALLY_COOLDOWN_S` 秒に 1 回。倒れている仲間は動かない（道をたどるだけ）。イベントの最中は作戦を止める。
// - 戦闘が始まった時点で、先頭から `fieldBattle.together` マスより離れている仲間は、そのコマンド戦闘に入らない。
//
// ここは数と決まりだけ（画面・乱数なし）。歩かせるのは `GameView`、ダメージは `ui/useFieldAttack.tsx`。

export type Tactic = 'follow' | 'fight' | 'attack' | 'free' | 'stay';
export const TACTICS: readonly Tactic[] = ['follow', 'fight', 'attack', 'free', 'stay'];
export const TACTIC_NAMES: Record<Tactic, string> = { follow: '戦わない', fight: '移動・迎撃', attack: '移動・攻撃', free: '自由に戦闘', stay: '待機・迎撃' };

/** 移動・迎撃・移動・攻撃のとき、敵を探す距離（マス。仲間から。移動・攻撃は先頭からも）。 */
export const ALLY_SIGHT = 6;
/** 自由に戦闘のとき、敵を探す距離（マス。仲間から。先頭からの距離は見ない）。 */
export const FREE_SIGHT = 10;
/** 仲間が攻める間隔（秒）。 */
export const ALLY_COOLDOWN_S = 1.2;
/** 仲間が歩く速さ（マス／秒。主人公の歩きは 4.2）。 */
export const ALLY_SPEED = 4.2;

/** 仲間の攻撃の届き方（その人のフィールドアタック。`fieldAttack.ts` の `FieldAttack` から）。 */
export interface AllyReach {
  type: 'melee' | 'shot' | 'area';
  range: number;
  width: number;
  cells: readonly [number, number][];
}

/** 届く長さのめやす（マス）。近接は届くマス数に体の半分、飛ばすは飛ぶ長さ、範囲は一番遠いマス。 */
export function reachLength(reach: AllyReach): number {
  if (reach.type === 'area') return Math.max(1, ...reach.cells.map(([x, y]) => Math.hypot(x, y)));
  if (reach.type === 'shot') return reach.range;
  return reach.range + 0.5;
}

/** 次の作戦（回す）。 */
export function nextTactic(now: Tactic): Tactic {
  return TACTICS[(TACTICS.indexOf(now) + 1) % TACTICS.length]!;
}

type Point = { x: number; z: number };
const span = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** 狙える敵 1 体。 */
export interface AllyFoe {
  id: string;
  at: { x: number; y: number; z: number };
  half: number;
  /** こちらに気づいているか。 */
  engaged: boolean;
}

/**
 * 狙う敵を選ぶ（一番近い敵）。移動・迎撃: 気づいていて `ALLY_SIGHT` 以内。移動・攻撃: `ALLY_SIGHT` 以内で、先頭（`leader`）からも
 * `ALLY_SIGHT` 以内（気づいていなくても）。自由に戦闘: `FREE_SIGHT` 以内（気づいていなくても）。待機・迎撃: `reach` 以内（体の幅込み）。
 * 戦わないなら狙わない。`leader` を渡さなければ先頭からの距離は見ない。
 */
export function allyTarget(tactic: Tactic, from: Point, foes: readonly AllyFoe[], reach: number, leader?: Point): AllyFoe | null {
  if (tactic === 'follow') return null;
  let best: AllyFoe | null = null;
  for (const one of foes) {
    const d = span(from, one.at);
    const ok = tactic === 'fight'
      ? one.engaged && d <= ALLY_SIGHT
      : tactic === 'attack'
        ? d <= ALLY_SIGHT && (!leader || span(leader, one.at) <= ALLY_SIGHT)
        : tactic === 'free'
          ? d <= FREE_SIGHT
          : d <= reach + one.half + 0.5;
    if (ok && (!best || d < span(from, best.at))) best = one;
  }
  return best;
}

/**
 * 近づく先。相手から `reach` の 8 割だけ手前（自分の側）。すでにその内なら今の所。
 * 近接の届く長さは体の前端からなので、少し入り込むくらいで当たる。
 */
export function standoff(from: Point, target: Point, reach: number): Point {
  const d = span(from, target);
  const keep = Math.max(0.6, reach * 0.8);
  if (d <= keep) return { x: from.x, z: from.z };
  const k = (d - keep) / d;
  return { x: from.x + (target.x - from.x) * k, z: from.z + (target.z - from.z) * k };
}

/** 1 フレームぶん進んだ所（`speed` マス／秒）。着けばその点。 */
export function stepToward(from: Point, goal: Point, speed: number, dt: number): Point {
  const d = span(from, goal);
  const move = speed * dt;
  if (d <= move || d < 1e-6) return { x: goal.x, z: goal.z };
  return { x: from.x + ((goal.x - from.x) / d) * move, z: from.z + ((goal.z - from.z) / d) * move };
}

/** 先頭から `together` マスより離れている仲間（コマンド戦闘に入らない）。先頭は入れない。 */
export function awayMembers(leader: Point, members: readonly { id: string; at: Point }[], together: number): string[] {
  return members.filter((one) => span(leader, one.at) > together + 1e-6).map((one) => one.id);
}
