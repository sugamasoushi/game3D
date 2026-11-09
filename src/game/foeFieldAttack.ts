// 敵のフィールド攻撃（2026-11-05。フィールド戦闘の段階 1）。**気づいて追ってくる敵シンボルが、範囲の技でこちらを攻める。**
//
// - 使うのは敵の台帳（`enemies.json`）の `skills` のうち、技の `field` の形が `area`（範囲）の技だけ。
//   範囲のマス `cells`・予兆の秒数 `windup`・次に出すまでの秒数 `interval` は技の `field` に書く（`fieldAttack.ts`）。
// - 流れ: 追う → 範囲に仲間が入った（マスに着いたときだけ見る）→ 向きを決めて止まり、足元に範囲を出す（予兆）→
//   予兆が終わったら、**そのとき範囲にいる仲間みんな**に当てる → 少し止まる → 追うへ戻る。次は `interval` 秒後から。
// - 予兆のあいだに怯ませる（フィールドアタックを当てる）・歩けなくなる（会話・メニュー・戦闘）・見失うと取りやめ。
// - 当たった仲間のダメージは戦闘と同じ式（`damageOf`）。HP 0 で倒れ、先頭が倒れたら次の人が先頭、みんな倒れたらゲームオーバー。
//
// ここは**数と決まりだけ**（画面・乱数なし）。時間と見せ方は `GameView`、ダメージは `ui/useFieldAttack.tsx`。

import { areaHits, fieldAttackOf, type AreaCell, type FieldTarget, type FieldUseDef } from './fieldAttack';

/** 敵が使える範囲の技 1 つ（既定を埋めた形）。 */
export interface FoeArea {
  skill: string;
  cells: AreaCell[];
  windup: number;
  interval: number;
  /** 選ぶ重み（敵の台帳のその技の `chance`。書かなければ 1）。 */
  weight: number;
  effect: string;
  hitEffect: string;
  se: string;
}

/** 気づいてから最初の技までの秒数（気づいた瞬間に当てない）。 */
export const FOE_FIRST_DELAY_S = 0.6;
/** 当てたあと止まっている秒数。 */
export const FOE_RECOVER_S = 0.4;
/** 予兆を取りやめたとき、次に出せるまでの秒数。 */
export const FOE_CANCEL_DELAY_S = 1;

/**
 * 敵の技の並びから、フィールドで使える範囲の技を拾う。`skillOf` は技の台帳を引く口。
 * 技が台帳に無い・`field` が無い・形が範囲でない技は外す。見込みが 0 の技も外す。
 */
export function foeAreasOf(
  refs: readonly { id: string; chance?: number }[] | undefined,
  skillOf: (id: string) => { field?: FieldUseDef; effect?: string; se?: string } | null,
): FoeArea[] {
  const out: FoeArea[] = [];
  for (const ref of refs ?? []) {
    const skill = skillOf(ref.id);
    if (!skill?.field || skill.field.type !== 'area') continue;
    const weight = typeof ref.chance === 'number' && Number.isFinite(ref.chance) ? Math.max(0, ref.chance) : 1;
    if (weight <= 0) continue;
    const use = fieldAttackOf(skill.field, { effect: skill.effect, se: skill.se, skill: ref.id });
    out.push({
      skill: ref.id,
      cells: use.cells,
      windup: use.windup,
      interval: use.interval,
      weight,
      effect: use.effect,
      hitEffect: use.hitEffect,
      se: use.se,
    });
  }
  return out;
}

/**
 * いま出す技を選ぶ。**範囲に相手が 1 人でも入る技**のうちから、重みのくじで 1 つ（`roll` は 0 以上 1 未満）。
 * どの技にも入らなければ null（出さずに追い続ける）。
 */
export function pickFoeArea(
  areas: readonly FoeArea[],
  from: { x: number; y: number; z: number },
  aim: { x: number; z: number },
  targets: readonly FieldTarget[],
  roll: number,
): FoeArea | null {
  const able = areas.filter((one) => areaHits(from, aim, one.cells, targets).length > 0);
  if (able.length === 0) return null;
  const total = able.reduce((sum, one) => sum + one.weight, 0);
  let left = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const one of able) {
    left -= one.weight;
    if (left < 0) return one;
  }
  return able[able.length - 1]!;
}

/** 1 体ぶんの技の段取り。時間は `GameView` の経過秒。 */
export interface FoeClock {
  /** `ready` 出せるのを待つ／追っている、`windup` 予兆、`recover` 当てたあとの間。 */
  phase: 'ready' | 'windup' | 'recover';
  /** `windup` / `recover` の終わり。 */
  until: number;
  /** 次に技を出せる時刻。 */
  readyAt: number;
  /** 予兆中の技と、決めた向き・立つ所（マス）。 */
  area?: FoeArea;
  aim?: { x: number; z: number };
  from?: { x: number; y: number; z: number };
}

/** 気づいたとき（または初めて追い始めたとき）の段取り。 */
export function foeClockAt(now: number): FoeClock {
  return { phase: 'ready', until: 0, readyAt: now + FOE_FIRST_DELAY_S };
}

/** 予兆を始める。 */
export function beginWindup(clock: FoeClock, area: FoeArea, from: FoeClock['from'], aim: { x: number; z: number }, now: number): void {
  clock.phase = 'windup';
  clock.until = now + area.windup;
  clock.area = area;
  clock.from = from;
  clock.aim = aim;
}

/** 当てた。次に出せるのは `interval` 秒後（当てたあとの間より早くはしない）。 */
export function finishStrike(clock: FoeClock, now: number): void {
  const interval = clock.area?.interval ?? 0;
  clock.phase = 'recover';
  clock.until = now + FOE_RECOVER_S;
  clock.readyAt = now + Math.max(interval, FOE_RECOVER_S);
  delete clock.area;
  delete clock.from;
  delete clock.aim;
}

/** 予兆を取りやめた（怯んだ・歩けなくなった・見失った）。 */
export function cancelWindup(clock: FoeClock, now: number): void {
  clock.phase = 'ready';
  clock.until = 0;
  clock.readyAt = Math.max(clock.readyAt, now + FOE_CANCEL_DELAY_S);
  delete clock.area;
  delete clock.from;
  delete clock.aim;
}

/**
 * 仲間が倒れたあとの並び（2026-11-05）。先頭が倒れていたら、並びを回して**倒れていない人を先頭**にする
 * （L2・R2 と同じ回し方）。みんな倒れていれば null（ゲームオーバー）。元は変えない。
 */
export function leaderAfterDown<T>(party: readonly T[], alive: (who: T) => boolean): T[] | null {
  if (!party.some(alive)) return null;
  const order = party.slice();
  while (!alive(order[0]!)) order.push(order.shift()!);
  return order;
}
