// レベル上げ（GS-63）。**数だけ。** 画面も記録も触らない（`rules.ts` と同じ立ち位置）。
//
// 台帳が持つのは**レベル 1 の値と、1 レベルぶんの伸び**（`growth`）。
// レベルごとの表を全部書かないのは、途中を 1 行直したときに
// 「そこから上が全部ずれる」直し方をしないため——**式なら 1 か所で済む**。
//
// 次のレベルに要る経験は `base × レベル ^ rate`。**溜めた経験は減らさない**——
// 「レベル 3 まであと 12」を出したいときに、引き算で持つと合計が分からなくなる。

import type { LevelUpDef, MemberDef } from './book';
import type { Stats } from './rules';

/** そのレベルでの満タンの数値。**レベル 1 なら台帳のまま。** */
export function statsAt(def: MemberDef, level: number): Stats {
  const steps = Math.max(0, level - 1);
  const up = def.growth ?? {};
  return {
    level,
    hp: def.hp + (up.hp ?? 0) * steps,
    mp: def.mp + (up.mp ?? 0) * steps,
    attack: def.attack + (up.attack ?? 0) * steps,
    guard: def.guard + (up.guard ?? 0) * steps,
    speed: def.speed + (up.speed ?? 0) * steps,
  };
}

/**
 * そのレベルから次へ上がるのに要る**通算**の経験。
 * レベル 1 → 2 が `base`、そこから `rate` 乗で増える。
 */
export function expForLevel(level: number, rule: LevelUpDef): number {
  if (level <= 1) return 0;
  let sum = 0;
  for (let step = 1; step < level; step += 1) sum += Math.round(rule.base * step ** rule.rate);
  return sum;
}

/** いまの経験で上がれるレベル。**上限は台帳の `max`**。 */
export function levelForExp(exp: number, rule: LevelUpDef): number {
  let level = 1;
  while (level < rule.max && exp >= expForLevel(level + 1, rule)) level += 1;
  return level;
}

/** 次のレベルまであといくつ。上限なら 0。 */
export function expToNext(exp: number, level: number, rule: LevelUpDef): number {
  if (level >= rule.max) return 0;
  return Math.max(0, expForLevel(level + 1, rule) - exp);
}

/** そのレベルで覚える技（`learn`）。 */
export function learnedAt(def: MemberDef, level: number): string[] {
  return def.learn?.[String(level)] ?? [];
}

/** レベルが上がったときの知らせ。**画面はこれを読んで文にする。** */
export interface LevelNews {
  /** 何レベルになったか。 */
  level: number;
  /** そこで覚えた技（`skills.json` の id）。 */
  learned: string[];
}

/**
 * 経験を足して、上がったぶんを返す。**渡した入れ物を書き換える。**
 * 覚えた技は `skills` の末尾へ足す（すでに持っていれば足さない）。
 */
export function addExp(
  member: { level: number; exp: number; skills: string[] },
  def: MemberDef,
  gained: number,
  rule: LevelUpDef,
): LevelNews[] {
  member.exp += Math.max(0, Math.trunc(gained));
  const next = levelForExp(member.exp, rule);
  const news: LevelNews[] = [];
  for (let level = member.level + 1; level <= next; level += 1) {
    const learned = learnedAt(def, level).filter((id) => !member.skills.includes(id));
    member.skills.push(...learned);
    news.push({ level, learned });
  }
  member.level = next;
  return news;
}
