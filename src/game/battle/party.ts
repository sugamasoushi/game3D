// 仲間と戦う面子（GS-60）。**台帳とセーブを繋ぐ場所。**
//
// 満タンの値は台帳（`data/party.json` / `data/enemies.json`）、
// 減っているぶんはセーブ（`state.ts`）——この 2 つを 1 体（`Fighter`）に組むのがここ。
// 組む場所を 1 か所にしないと、「メニューの HP」と「戦闘の HP」が別々に育って食い違う。
//
// **戦闘の中では `Fighter` を直に触ってよい。** 終わったら `writeBack` で
// セーブへ戻す——途中の 1 発ごとにセーブを書き換えると、逃げたときに戻せない。

import type { GameState, MemberState } from '../state';
import { characterName } from '../characters';
import { ailmentDef, enemyDef, levelUpRule, memberDef, startingParty } from './book';
import { addExp, statsAt, type LevelNews } from './growth';
import { itemEquip } from '../items';
import type { Fighter, Stats } from './rules';

/** 台帳が読めていないときの数値。**0 にしない**——即死する仲間を作らないため。 */
const FALLBACK: Stats = { level: 1, hp: 10, mp: 0, attack: 1, guard: 0, speed: 1 };

/**
 * その人の満タンの値。`level` を渡すと**そのレベルまで育てた**値（GS-63）。
 * 台帳に無ければ最低限——0 にすると即死する仲間ができる。
 */
export function memberStats(who: string, level?: number): Stats {
  const def = memberDef(who);
  if (!def) return { ...FALLBACK };
  return statsAt(def, level ?? def.level);
}

/** はじめの状態（満タン）。装備も台帳のとおりに着ける（GS-67）。 */
function freshMember(who: string): MemberState {
  const stats = memberStats(who);
  return {
    level: stats.level,
    exp: 0,
    hp: stats.hp,
    mp: stats.mp,
    skills: (memberDef(who)?.skills ?? []).slice(),
    equip: { ...(memberDef(who)?.equip ?? {}) },
    ailments: [],
  };
}

/**
 * 台帳のとおりに隊列を作り直す。**はじめから**と、
 * 仲間を持たない古い記録（版 2 まで）を読んだときに呼ぶ。
 */
export function resetParty(state: GameState): void {
  state.party = startingParty();
  state.members = new Map(state.party.map((who) => [who, freshMember(who)]));
  state.gold = 0;
}

/**
 * 足りない仲間を満タンで足す。**古い記録を読んだ後**に呼ぶ——
 * 隊列が空のまま戦闘に入ると、始まった瞬間に負ける。
 */
export function ensureParty(state: GameState): void {
  if (state.party.length === 0) {
    resetParty(state);
    return;
  }
  for (const who of state.party) {
    if (!state.members.has(who)) state.members.set(who, freshMember(who));
  }
}

/** 仲間 1 人ぶんの、いまの状態。無ければ null。 */
export function memberOf(state: GameState, who: string): MemberState | null {
  return state.members.get(who) ?? null;
}

/** 味方の面子を組む。並びは隊列のまま。 */
export function partyFighters(state: GameState): Fighter[] {
  return state.party.map((who) => {
    const now = state.members.get(who);
    // 装備を足した値で戦う（GS-67）。メニューが出す数と同じ物を使う。
    const stats = statsOf(state, who);
    return {
      id: who,
      name: characterName(who),
      side: 'party' as const,
      stats,
      // 記録が壊れていても満タンで出す（0 で始めて即死させない）。
      hp: now ? Math.min(now.hp, stats.hp) : stats.hp,
      mp: now ? Math.min(now.mp, stats.mp) : stats.mp,
      guarding: 0,
      avoiding: false,
      // 歩いているあいだの状態異常を戦いへ持ち込む（GS-71）。
      ailments: (now?.ailments ?? []).slice(),
    };
  });
}

/**
 * 敵の面子を組む。同じ id が並んでも**別の 1 体**になるよう連番を振り、
 * 2 体目からは名前に「B」「C」を付ける——どちらを殴ったのか分かるように。
 */
export function enemyFighters(ids: string[]): Fighter[] {
  const seen = new Map<string, number>();
  const out: Fighter[] = [];
  for (const id of ids) {
    const def = enemyDef(id);
    if (!def) continue; // 知らない敵は出さない（GS-60。数値 0 の敵を作らない）。
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    const suffix = count > 1 ? ` ${String.fromCharCode(64 + count)}` : '';
    out.push({
      id: `${id}#${count}`,
      name: `${def.name}${suffix}`,
      side: 'enemy',
      stats: { level: def.level, hp: def.hp, mp: def.mp, attack: def.attack, guard: def.guard, speed: def.speed },
      hp: def.hp,
      mp: def.mp,
      guarding: 0,
      avoiding: false,
      ailments: [],
    });
  }
  return out;
}

/** 敵 1 体の id から台帳の id へ戻す（`enemy00#2` → `enemy00`）。 */
export function enemyIdOf(fighter: Fighter): string {
  return fighter.id.split('#')[0];
}

/**
 * 装備で増える数（GS-67）。**満タンの HP・MP は動かさない**——
 * 装備で最大値が変わると、外した瞬間に「いまの HP が満タンを超える」始末が要る。
 */
export function equipBonus(equip: Record<string, string> | undefined): Pick<Stats, 'attack' | 'guard' | 'speed'> {
  const out = { attack: 0, guard: 0, speed: 0 };
  for (const id of Object.values(equip ?? {})) {
    const gear = itemEquip(id);
    if (!gear) continue;
    out.attack += gear.attack ?? 0;
    out.guard += gear.guard ?? 0;
    out.speed += gear.speed ?? 0;
  }
  return out;
}

/**
 * いまの数値（レベル＋装備）。**戦うときもメニューもここを見る**——
 * 片方だけ装備を足すと、画面の数と実際の強さが食い違う。
 */
export function statsOf(state: GameState, who: string): Stats {
  const now = state.members.get(who);
  const base = memberStats(who, now?.level);
  const gear = equipBonus(now?.equip);
  return {
    ...base,
    attack: base.attack + gear.attack,
    guard: base.guard + gear.guard,
    // 速さは 1 より下げない（0 だと順番の考えが崩れる）。
    speed: Math.max(1, base.speed + gear.speed),
  };
}

/**
 * 身に着ける（GS-67）。**袋から出して置き場所へ移す**——
 * すでに何か着けていれば袋へ戻す。持っていなければ false。
 */
export function equipItem(state: GameState, who: string, id: string): boolean {
  const now = state.members.get(who);
  const gear = itemEquip(id);
  if (!now || !gear) return false;
  const have = state.items.get(id) ?? 0;
  if (have <= 0) return false;
  if (have > 1) state.items.set(id, have - 1);
  else state.items.delete(id);
  const before = now.equip[gear.slot];
  if (before) state.items.set(before, (state.items.get(before) ?? 0) + 1);
  now.equip[gear.slot] = id;
  return true;
}

/** 外して袋へ戻す。何も着けていなければ false。 */
export function unequipItem(state: GameState, who: string, slot: string): boolean {
  const now = state.members.get(who);
  const id = now?.equip[slot];
  if (!now || !id) return false;
  delete now.equip[slot];
  state.items.set(id, (state.items.get(id) ?? 0) + 1);
  return true;
}

/**
 * 経験を配る（GS-63）。**倒れた人にも入る**——旧作と同じで、
 * 「戦えなかったから置いていかれる」を作らない。
 * 返り値は「誰が何レベルになって、何を覚えたか」。**文にするのは画面の仕事。**
 */
export function gainExp(state: GameState, exp: number): Array<{ who: string; news: LevelNews[] }> {
  const rule = levelUpRule();
  const out: Array<{ who: string; news: LevelNews[] }> = [];
  for (const who of state.party) {
    const now = state.members.get(who);
    const def = memberDef(who);
    if (!now || !def) continue;
    const news = addExp(now, def, exp, rule);
    // 上がったら**満タンまで戻す**（旧作と同じ）。上がった実感と、次の戦いの支度を兼ねる。
    if (news.length > 0) {
      const stats = statsAt(def, now.level);
      now.hp = stats.hp;
      now.mp = stats.mp;
    }
    out.push({ who, news });
  }
  return out;
}

/**
 * 仲間に入れる（GS-70）。**台帳に居ない人は入れない**——
 * 数値の無い仲間は、戦闘に出た瞬間に無敵か即死になる。
 * すでに居れば何もしない。**一度出た人の育ち具合は残す**ので、入り直すとそのまま戻る。
 */
export function joinParty(state: GameState, who: string): boolean {
  if (!memberDef(who)) {
    console.warn('[party] 台帳に居ない人は仲間にできません: ' + who);
    return false;
  }
  if (state.party.includes(who)) return false;
  if (!state.members.has(who)) state.members.set(who, freshMember(who));
  state.party.push(who);
  return true;
}

/**
 * 隊列から外す（GS-70）。**記録は消さない**（また入るかもしれない）。
 * **最後の 1 人は外せない**——誰も居ない隊列は、次の戦いで即座に負ける。
 */
export function leaveParty(state: GameState, who: string): boolean {
  const at = state.party.indexOf(who);
  if (at < 0 || state.party.length <= 1) return false;
  state.party.splice(at, 1);
  return true;
}

/**
 * 隊列の並びを 1 つ動かす（GS-72）。`delta` は -1 で前、+1 で後ろ。
 * **端では何もしない**（回り込ませない）——一覧の端で押したときに
 * 反対の端へ飛ぶと、押し間違いに気づけない。
 *
 * 並びが効くのは**先頭が誰か**（メニューの左の柱・`heal` の既定・話の「この人」）と、
 * **速さが同じときの順番**（`turnOrder` は安定なのでこの並びが残る）。
 */
export function moveMember(state: GameState, who: string, delta: number): boolean {
  const at = state.party.indexOf(who);
  const to = at + (delta < 0 ? -1 : 1);
  if (at < 0 || to < 0 || to >= state.party.length) return false;
  const swap = state.party[to];
  state.party[to] = who;
  state.party[at] = swap;
  return true;
}

/**
 * 倒れた仲間を **HP 1** で起こす（GS-63）。
 * 使うのは「負けても話が続く」戦い（`battle` 命令の `lose`）の後だけ——
 * 倒れたまま歩けてしまうと、**次の出会い頭で必ず負けて**ゲームオーバーの輪から出られない。
 * ゲームオーバーのときは呼ばない（そのままタイトルへ帰る）。
 */
export function revive(state: GameState): void {
  for (const who of state.party) {
    const now = state.members.get(who);
    if (now && now.hp <= 0) now.hp = 1;
  }
}

/**
 * 戦いの結果をセーブへ戻す。**HP・MP だけ**——
 * 経験やお金は勝ったときにだけ足すので、呼ぶ側が決める。
 */
export function writeBack(state: GameState, fighters: Fighter[]): void {
  for (const who of fighters) {
    if (who.side !== 'party') continue;
    const now = state.members.get(who.id);
    if (!now) continue;
    now.hp = who.hp;
    now.mp = who.mp;
    // **続く物だけ**を持ち帰る（GS-71）。眠りは戦いが終われば覚める。
    now.ailments = who.ailments.filter((id) => ailmentDef(id)?.keep === true);
  }
}
