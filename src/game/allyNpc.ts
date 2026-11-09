// 加勢する NPC（2026-11-05 / GS-306。フィールド戦闘の段階 4）。**周りの敵を攻め、コマンド戦闘にも客として入る味方。**
//
// - マップの NPC の設定（`mapNpcs.json` の 1 体）に `ally` を書く。能力・技・戦闘の絵は仲間の台帳（`party.json` の
//   `members.<member>`）を借りる（`level` のレベルの数値。覚えている技もそのレベルまで）。
// - フィールド: 置き場から `range` マス以内の敵シンボル（気づいていなくても）へ近づいて、借りた仲間のフィールドアタックで攻める
//   （`partyTactics.ts` の近づき方・届き方と同じ。1.2 秒に 1 回。MP は使わない）。いなくなれば置き場へ戻る。
//   敵の範囲の技（GS-303）は加勢 NPC にも当たる。HP 0 で倒れ、そのマップにいるあいだは動かない（入り直すと満タン）。
// - コマンド戦闘: 戦闘が始まったとき先頭から `fieldBattle.together` マス以内にいて倒れていなければ、客として味方の側に入る
//   （`battle: false` なら入らない）。手は聞かず、毎ターン敵を殴る。経験は入らない。終わったら減った HP を持ち帰る。
//
// ここは数と決まりだけ（画面・乱数なし）。

import { statsAt } from './battle/growth';
import type { MemberDef } from './battle/book';
import type { Fighter } from './battle/rules';
import type { BattleAction } from './battle/flow';

/** 台帳に書く形（`mapNpcs.json` の 1 体の `ally`）。 */
export interface AllyNpcDef {
  /** 借りる仲間（`party.json` の `members` のキー）。 */
  member: string;
  /** そのレベルの数値で戦う（1〜99。既定 1）。 */
  level?: number;
  /** 置き場から敵を探す距離（マス。1〜16。既定 6）。 */
  range?: number;
  /** `false` ならコマンド戦闘には入らない（フィールドで戦うだけ）。 */
  battle?: boolean;
}

export const ALLY_NPC_DEFAULTS = { level: 1, range: 6, battle: true } as const;
export const ALLY_NPC_LIMITS = { level: { min: 1, max: 99 }, range: { min: 1, max: 16 } } as const;
/** 客として戦うときの id の頭（`ally:<NPC の id>`）。 */
export const GUEST_PREFIX = 'ally:';

/** 既定で埋める。借りる仲間が書かれていなければ null。範囲の外の値は既定へ。 */
export function allyWithDefaults(def: AllyNpcDef | null | undefined): Required<AllyNpcDef> | null {
  if (!def || typeof def.member !== 'string' || !def.member) return null;
  const L = ALLY_NPC_LIMITS;
  const level = Number.isInteger(def.level) && def.level! >= L.level.min && def.level! <= L.level.max ? def.level! : ALLY_NPC_DEFAULTS.level;
  const range = typeof def.range === 'number' && def.range >= L.range.min && def.range <= L.range.max ? def.range : ALLY_NPC_DEFAULTS.range;
  return { member: def.member, level, range, battle: def.battle !== false };
}

/** そのレベルまでに覚えている技（はじめから＋レベルで覚える）。 */
export function allySkills(def: Pick<MemberDef, 'skills' | 'learn'>, level: number): string[] {
  const out = [...(def.skills ?? [])];
  for (const [at, list] of Object.entries(def.learn ?? {})) if (Number(at) <= level) out.push(...list);
  return out;
}

/**
 * 客として戦う 1 人（味方の側）。HP・MP は渡した値（無ければ満タン）。`look` は絵を引く人のキー（借りた仲間）。
 */
export function guestFighter(
  npc: string,
  ally: Required<AllyNpcDef>,
  member: MemberDef,
  name: string,
  now?: { hp?: number; mp?: number },
): Fighter {
  const stats = statsAt(member, ally.level);
  return {
    id: `${GUEST_PREFIX}${npc}`,
    name,
    side: 'party',
    stats,
    hp: Math.max(0, Math.min(stats.hp, now?.hp ?? stats.hp)),
    mp: Math.max(0, Math.min(stats.mp, now?.mp ?? stats.mp)),
    guarding: 0,
    avoiding: false,
    ailments: [],
    guest: true,
    look: ally.member,
  };
}

/** 客の手（毎ターン）。倒れていない敵のうち HP が一番少ない相手を殴る（守られている相手は流れが狙える相手へ回す）。 */
export function guestAction(enemies: readonly Fighter[]): BattleAction | null {
  const alive = enemies.filter((one) => one.hp > 0);
  if (!alive.length) return null;
  const target = alive.reduce((best, one) => (one.hp < best.hp ? one : best));
  return { kind: 'attack', target: target.id };
}

/** 客の id から NPC の id（客でなければ null）。 */
export function guestNpc(id: string): string | null {
  return id.startsWith(GUEST_PREFIX) ? id.slice(GUEST_PREFIX.length) : null;
}
