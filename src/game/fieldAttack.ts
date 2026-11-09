// フィールドアタック（GS-295。2026-10-31）。**歩いているときに ☐（キー X）で、先頭の仲間が攻撃する。**
//
// - 当てても戦闘は始まらない。始まるのは今までどおり敵シンボルに**触れたとき**だけ（GS-76）。
// - 当てた敵シンボルは HP が減り、少しのあいだ**怯む**（うろつきが止まる）。
// - フィールドで倒すと、経験とお金は `battleSettings.json` の `rates.fieldKill`（既定 0.5）倍。端数は切り捨て。
// - 当てた後に触れて戦闘になったら、その敵は**減った HP のまま**出る。**怯んでいるあいだに触れたら先制**
//   （1 ターン目は味方だけが動く）。
// - 減った HP はそのマップに居るあいだだけ覚える（セーブに入れない。入り直すとシンボルごと戻る）。
// - マップごとに禁止できる（`maps.json` の `fieldAttack: false`）。
// - **使い方は技ごと**（2026-10-31）: 技の台帳（`skills.json`）の 1 行に `field`（近接か飛ばすか・届く・速さ・当たりの幅・
//   絵の倍率・MP など）を書いた技だけフィールドで使える。仲間は `party.json` の `fieldAttack` で**覚えている技**を 1 つ選ぶ。
//   選んでいない・覚えていない・`field` の無い技なら素手の通常攻撃（`battleSettings.json` の `normalAttack.party.field`）。
//
// ここは**数と当たりだけ**を持つ（画面・音・乱数なし）。見せ方と台帳の読み込みは `ui/useFieldAttack.tsx`。

/**
 * 攻撃の形。`melee` 目の前を叩く / `shot` 向いた方へ飛ばす /
 * `area` 向きから見た範囲のマス（`cells`）にいる相手みんな（2026-11-05。敵のなぎはらいなど。敵が使えるのはこの形だけ）。
 */
export type FieldAttackType = 'melee' | 'shot' | 'area';
export const FIELD_ATTACK_TYPES: readonly FieldAttackType[] = ['melee', 'shot', 'area'];

/**
 * 範囲の 1 マス `[横, 前]`。使う人の立つマスが `[0, 0]`、向いた方へ `前` が増え、向いて右へ `横` が増える。
 * 向きに合わせて回すので、台帳には「上を向いたとき」の形だけを書く。
 */
export type AreaCell = [number, number];

/** 台帳に書く形（技の `field`・通常攻撃の `normalAttack.party.field`）。書かない項目は既定。 */
export interface FieldUseDef {
  type?: FieldAttackType;
  /** 出す絵（`effects.json` のキー）。近接は目の前、飛ばすときは飛ぶ物。書かなければその技（通常攻撃）の戦闘の絵。 */
  effect?: string;
  /** 当たったときの絵（`effects.json` のキー）。書かなければ出さない。 */
  hitEffect?: string;
  /** 届くマス数。近接は体の前端から、飛ばすときは飛ぶ長さ。 */
  range?: number;
  /** 飛ぶ速さ（マス／秒）。飛ばすときだけ。 */
  speed?: number;
  /** 当たりの幅（マス）。近接は帯の横幅（体の半幅に足す）、飛ばすときは飛ぶ物の太さ（半径）。 */
  width?: number;
  /** 1 回に使う MP（0 以上の整数）。既定 0——気軽に使えるのが良さなので、便利すぎる攻撃のときだけ付ける。技の戦闘の MP とは別。 */
  mp?: number;
  /** 出したときの音（`sounds.json` のキー）。書かなければ絵の側の音。 */
  se?: string;
  /** 範囲のマス（形が `area` のときだけ）。書かなければ目の前の 1 マス。 */
  cells?: AreaCell[];
  /** 予兆の秒数（形が `area` のときだけ。敵が使うとき、足元に範囲を出してから当てるまで）。味方は待たずに当てる。 */
  windup?: number;
  /** 次に出すまでの秒数（形が `area` のときだけ。敵が使うとき）。 */
  interval?: number;
}

/** 既定を埋めた形。`skill` はダメージの式に使う技（空なら素手）。 */
export interface FieldAttack {
  type: FieldAttackType;
  effect: string;
  hitEffect: string;
  range: number;
  speed: number;
  width: number;
  skill: string;
  mp: number;
  se: string;
  /** 範囲のマス（`area` のとき。ほかの形では空）。 */
  cells: AreaCell[];
  /** 予兆の秒数（`area` のとき）。 */
  windup: number;
  /** 次に出すまでの秒数（`area` のとき）。 */
  interval: number;
}

/** 書ける値の範囲（Game Checker の `values.ts` と台帳エディタも同じ値）。 */
export const FIELD_ATTACK_LIMITS = {
  range: { min: 0.5, max: 12 },
  speed: { min: 1, max: 40 },
  width: { min: 0.05, max: 3 },
  mp: { min: 0, max: 999 },
  /** 範囲のマスの横・前（整数）。 */
  cell: { min: -6, max: 6 },
  /** 範囲のマスの数。 */
  cells: { min: 1, max: 64 },
  windup: { min: 0, max: 5 },
  interval: { min: 0.5, max: 30 },
} as const;

/** 既定。近接は目の前の 1 マス少し、飛ばすときは 5 マスを 1 秒弱で。絵は呼ぶ側が技の戦闘の絵で埋める。 */
export const FIELD_ATTACK_DEFAULTS: Record<FieldAttackType, Omit<FieldAttack, 'effect' | 'skill' | 'se'>> = {
  melee: { type: 'melee', hitEffect: '', range: 1.2, speed: 0, width: 0.35, mp: 0, cells: [], windup: 0, interval: 0 },
  shot: { type: 'shot', hitEffect: '', range: 5, speed: 8, width: 0.25, mp: 0, cells: [], windup: 0, interval: 0 },
  // 範囲は目の前の 1 マス。予兆 0.8 秒・次まで 3 秒（敵が使うとき）。
  area: { type: 'area', hitEffect: '', range: 0, speed: 0, width: 0, mp: 0, cells: [[0, 1]], windup: 0.8, interval: 3 },
};

/** 範囲のマスを読む。整数で範囲内の `[横, 前]` だけを、重なりを除いて残す。1 つも残らなければ null。 */
export function areaCellsOf(raw: unknown): AreaCell[] | null {
  if (!Array.isArray(raw)) return null;
  const L = FIELD_ATTACK_LIMITS.cell;
  const seen = new Set<string>();
  const out: AreaCell[] = [];
  for (const one of raw) {
    if (!Array.isArray(one) || one.length !== 2) continue;
    const [x, y] = one;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < L.min || x > L.max || y < L.min || y > L.max) continue;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y]);
    if (out.length >= FIELD_ATTACK_LIMITS.cells.max) break;
  }
  return out.length ? out : null;
}

/** 振った（撃った）あと動けない時間（ミリ秒）。連打で怯みを取り続けられないように。 */
export const FIELD_ATTACK_RECOVER_MS = 400;
/** 当たった敵シンボルが怯む時間（ミリ秒）。**このあいだに触れると先制**。怯んでいるあいだに当てても延ばさない。 */
export const FIELD_STUN_MS = 2000;
/** 高さの差がこれを超える相手には当たらない（マス。話しかけの届く高さと同じ考え）。 */
export const FIELD_ATTACK_RISE = 1;

const within = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

/**
 * 台帳の `field` を既定で埋める。壊れた値・範囲外の値は既定へ（1 つの書き間違いで攻撃を止めない）。
 * `base` はその技（通常攻撃）の戦闘の絵・音と、ダメージの式に使う技。
 */
export function fieldAttackOf(raw: FieldUseDef | null | undefined, base: { effect?: string; se?: string; skill?: string } = {}): FieldAttack {
  const type: FieldAttackType = raw?.type === 'shot' || raw?.type === 'area' ? raw.type : 'melee';
  const fallback = FIELD_ATTACK_DEFAULTS[type];
  const L = FIELD_ATTACK_LIMITS;
  return {
    type,
    effect: text(raw?.effect, base.effect ?? ''),
    hitEffect: text(raw?.hitEffect, fallback.hitEffect),
    range: within(raw?.range, L.range.min, L.range.max) ? raw!.range! : fallback.range,
    speed: within(raw?.speed, L.speed.min, L.speed.max) ? raw!.speed! : fallback.speed,
    width: within(raw?.width, L.width.min, L.width.max) ? raw!.width! : fallback.width,
    skill: base.skill ?? '',
    mp: within(raw?.mp, L.mp.min, L.mp.max) && Number.isInteger(raw?.mp) ? raw!.mp! : fallback.mp,
    se: text(raw?.se, base.se ?? ''),
    cells: type === 'area' ? (areaCellsOf(raw?.cells) ?? fallback.cells.map((c) => [c[0], c[1]] as AreaCell)) : [],
    windup: type === 'area' && within(raw?.windup, L.windup.min, L.windup.max) ? raw!.windup! : fallback.windup,
    interval: type === 'area' && within(raw?.interval, L.interval.min, L.interval.max) ? raw!.interval! : fallback.interval,
  };
}

/**
 * 先頭の仲間のフィールドアタックを決める。`chosen` は仲間が選んだ技（`party.json` の `fieldAttack`）、`known` は**いま覚えている技**。
 * 選んだ技を覚えていて、その技に `field` があればそれ。そうでなければ素手の通常攻撃（`normal`）。
 */
export function resolveFieldAttack(options: {
  chosen?: string;
  known: readonly string[];
  skill: { field?: FieldUseDef; effect?: string } | null;
  normal: { field?: FieldUseDef; effect?: string; se?: string };
}): FieldAttack {
  const { chosen, known, skill, normal } = options;
  if (chosen && known.includes(chosen) && skill?.field) {
    return fieldAttackOf(skill.field, { effect: skill.effect, skill: chosen });
  }
  return fieldAttackOf(normal.field, { effect: normal.effect, se: normal.se });
}

/** 当たりを見る 1 体。位置はマス（小数）、`half` は体の半幅（マス）。 */
export interface FieldTarget {
  id: string;
  at: { x: number; y: number; z: number };
  half: number;
}

/**
 * 近接の当たり。向き `aim`（長さ 1。ワールド）の先、体の前端から `range` マスまでの帯に入った相手のうち、**いちばん近い 1 体**。
 * 帯の横幅は自分の半幅 + `width`（技の当たりの幅）。相手の体の幅も足すので、端に掛かっていれば当たる。高さの差が大きい相手は外す。
 */
export function meleeHit(
  from: { x: number; y: number; z: number },
  aim: { x: number; z: number },
  half: number,
  range: number,
  targets: readonly FieldTarget[],
  width: number = FIELD_ATTACK_DEFAULTS.melee.width,
): string | null {
  let best: { id: string; along: number } | null = null;
  for (const one of targets) {
    if (Math.abs(one.at.y - from.y) > FIELD_ATTACK_RISE) continue;
    const dx = one.at.x - from.x;
    const dz = one.at.z - from.z;
    const along = dx * aim.x + dz * aim.z;
    const across = Math.abs(dx * aim.z - dz * aim.x);
    if (along < 0) continue; // 背中側は叩かない。
    if (along - one.half > half + range) continue;
    if (across > half + width + one.half) continue;
    if (!best || along < best.along) best = { id: one.id, along };
  }
  return best?.id ?? null;
}

/**
 * 飛ぶ物の当たり。`from` から `to` へ進むあいだに触れた相手のうち、**先に触れた 1 体**（触れていなければ null）。
 * 相手は体の半幅 + `radius`（技の当たりの幅）の円として見る（XZ）。高さの差が大きい相手は外す。
 */
export function shotHit(
  from: { x: number; y: number; z: number },
  to: { x: number; z: number },
  targets: readonly FieldTarget[],
  radius: number = FIELD_ATTACK_DEFAULTS.shot.width,
): string | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  let best: { id: string; t: number } | null = null;
  for (const one of targets) {
    if (Math.abs(one.at.y - from.y) > FIELD_ATTACK_RISE) continue;
    const r = one.half + radius;
    // 線分上で相手に一番近い所。
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((one.at.x - from.x) * dx + (one.at.z - from.z) * dz) / len2)) : 0;
    const px = from.x + dx * t - one.at.x;
    const pz = from.z + dz * t - one.at.z;
    if (px * px + pz * pz > r * r) continue;
    if (!best || t < best.t) best = { id: one.id, t };
  }
  return best?.id ?? null;
}

// ---- 範囲（`area`。2026-11-05） -------------------------------------------------------------
// 向きはマスの軸 4 つに揃える（敵シンボルもマスの軸に沿って歩く）。前 = 向き、右 = 前を時計回りに 90°
// （ワールドは x が右・z が手前なので、上〈奥〉を向けば右は +x、右を向けば右は +z〈手前〉）。

/** 向きをマスの軸 4 つのどれかへ揃える（成分の大きい方。同じなら横）。長さ 0 なら奥向き。 */
export function axisOf(aim: { x: number; z: number }): { x: number; z: number } {
  if (Math.abs(aim.x) < 1e-9 && Math.abs(aim.z) < 1e-9) return { x: 0, z: -1 };
  return Math.abs(aim.x) >= Math.abs(aim.z) ? { x: Math.sign(aim.x), z: 0 } : { x: 0, z: Math.sign(aim.z) };
}

/** 範囲の 1 マス `[横, 前]` をワールドのずれ（マス）へ。`aim` は軸に揃えた向き。 */
export function areaOffset(cell: AreaCell, aim: { x: number; z: number }): { x: number; z: number } {
  const [side, ahead] = cell;
  // 右 = (-aim.z, aim.x)。
  return { x: aim.x * ahead - aim.z * side, z: aim.z * ahead + aim.x * side };
}

/** 相手が使う人から見てどのマス `[横, 前]` にいるか（いちばん近いマス）。 */
export function areaLocal(from: { x: number; z: number }, aim: { x: number; z: number }, at: { x: number; z: number }): AreaCell {
  const dx = at.x - from.x;
  const dz = at.z - from.z;
  const ahead = dx * aim.x + dz * aim.z;
  const side = -dx * aim.z + dz * aim.x;
  return [Math.round(side) + 0, Math.round(ahead) + 0];
}

/**
 * 範囲に入った相手みんな（並びは渡した順）。`aim` は軸に揃えた向き。高さの差が大きい相手は外す。
 */
export function areaHits(
  from: { x: number; y: number; z: number },
  aim: { x: number; z: number },
  cells: readonly AreaCell[],
  targets: readonly FieldTarget[],
): string[] {
  const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
  const out: string[] = [];
  for (const one of targets) {
    if (Math.abs(one.at.y - from.y) > FIELD_ATTACK_RISE) continue;
    const [x, y] = areaLocal(from, aim, one.at);
    if (keys.has(`${x},${y}`)) out.push(one.id);
  }
  return out;
}

/** フィールドで倒したときの取り分（`rate` 倍、端数は切り捨て）。 */
export function fieldKillSpoils(exp: number, gold: number, rate: number): { exp: number; gold: number } {
  const k = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0.5;
  return { exp: Math.floor(Math.max(0, exp) * k), gold: Math.floor(Math.max(0, gold) * k) };
}

/**
 * フィールドで倒したときの取り分（2026-11-05）。**交戦中**（その敵が主人公に気づいていた）なら経験は `engagedExp` 倍、
 * そうでなければ経験もお金も `kill` 倍（GS-295 のまま）。交戦中でもお金は `kill` 倍。端数は切り捨て。
 */
export function fieldSpoils(
  exp: number,
  gold: number,
  rates: { kill: number; engagedExp: number },
  engaged: boolean,
): { exp: number; gold: number } {
  const clamp = (rate: number, fallback: number) => (Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : fallback);
  const kill = clamp(rates.kill, 0.5);
  const expRate = engaged ? clamp(rates.engagedExp, 1) : kill;
  return { exp: Math.floor(Math.max(0, exp) * expRate), gold: Math.floor(Math.max(0, gold) * kill) };
}

/** 当てた敵シンボル 1 体の覚え。`stunUntil` は `performance.now()` のミリ秒。 */
export interface FieldWound {
  /** 残りの HP。 */
  hp: number;
  /** 怯みの終わり。 */
  stunUntil: number;
}

/**
 * 当てた結果を覚えに足す。**怯みは延ばさない**（怯んでいるあいだに当てても、終わりは最初に当てた時のまま）。
 * `maxHp` はその敵の満タンの HP（初めて当てたときに使う）。返すのは新しい覚えと、倒したか。
 */
export function woundSymbol(
  before: FieldWound | undefined,
  maxHp: number,
  damage: number,
  now: number,
): { wound: FieldWound; defeated: boolean } {
  const hp = Math.max(0, (before?.hp ?? maxHp) - Math.max(0, Math.floor(damage)));
  const stunned = before && now < before.stunUntil;
  const wound = { hp, stunUntil: stunned ? before.stunUntil : now + FIELD_STUN_MS };
  return { wound, defeated: hp <= 0 };
}

/** 触れて戦闘になるとき、先制か（怯んでいるあいだだけ）。 */
export function preemptiveOf(wound: FieldWound | undefined, now: number): boolean {
  return !!wound && now < wound.stunUntil;
}

/** 先頭を回す（L2 で前の人、R2 で次の人）。1 人なら何もしない。返すのは新しい並び（元は変えない）。 */
export function rotateLeader<T>(party: readonly T[], delta: -1 | 1): T[] {
  if (party.length <= 1) return party.slice();
  return delta > 0 ? [...party.slice(1), party[0]!] : [party[party.length - 1]!, ...party.slice(0, -1)];
}
