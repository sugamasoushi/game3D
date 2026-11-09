'use client';

// フィールドアタックと先頭の入れ替え（GS-295）。**☐（キー X）で先頭の仲間が攻撃し、L2・R2（キー Q・E）で先頭を回す。**
// 数と当たりは `game/fieldAttack.ts`、ここは入力・見せ方・取り分を受け持つ。
//
// 技の絵は **3D の板**（`GameView.playFx`。`game/fieldFx.ts`）。深度を見るので、壁や人の後ろでは隠れる
// （2026-10-31。最初は DOM の重ね絵で、いつも手前に出ていた）。ダメージの数字だけは画面に重ねる（読む物なので隠さない）。

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { GameView } from '../game/GameView';
import type { GameState } from '../game/state';
import { canWalk, useUi } from './store';
import { effectDef, effectImage, enemyDef, memberDef, skillDef, type EffectDef } from '../game/battle/book';
import { recordQuestKills } from '../game/quests';
import { noteFoesBeaten } from '../game/codex';
import { battleSettings, fieldEngagedExpRate, fieldKillRate, normalAttackOf } from '../game/battle/settings';
import { enemyFighters, gainExp, memberTraits, partyFighters } from '../game/battle/party';
import { damageOf } from '../game/battle/rules';
import { scaledDamage } from '../game/battle/cover';
import { powerRateOf, scaledMp } from '../game/battle/races';
import { itemEquip } from '../game/items';
import { characterName } from '../game/characters';
import { playSe, playUi } from '../game/audio';
import {
  FIELD_ATTACK_RECOVER_MS,
  FIELD_STUN_MS,
  resolveFieldAttack,
  areaHits,
  axisOf,
  fieldSpoils,
  meleeHit,
  rotateLeader,
  shotHit,
  woundSymbol,
  type FieldAttack,
  type FieldTarget,
  type FieldWound,
} from '../game/fieldAttack';
import { leaderAfterDown, type FoeArea } from '../game/foeFieldAttack';
import { partyEngaged } from '../game/fieldBattle';
import type { AllyReach } from '../game/partyTactics';
import { allySkills, guestFighter, guestNpc } from '../game/allyNpc';
import type { Fighter } from '../game/battle/rules';
import { FIELD_FX_RISE } from '../game/effectPlace';

/** 攻撃のキー（☐）。ゲームパッドの 2 番も `gamepad.ts` でこれになる。 */
export const FIELD_ATTACK_KEY = 'KeyX';
/** 先頭を前の人へ（L2）・次の人へ（R2）。 */
export const LEADER_PREV_KEY = 'KeyQ';
export const LEADER_NEXT_KEY = 'KeyE';
/** 仲間の作戦を切り替える（GS-305。ゲームパッドの Select）。 */
export const TACTIC_KEY = 'KeyC';

/** 絵を出す高さ（足元から。マス）。体の真ん中あたり。戦闘演出エディタの見本と同じ値（`effectPlace.ts`）。 */
const FX_RISE = FIELD_FX_RISE;
/** 当たった数字を出しておく時間（ミリ秒）。 */
const HIT_NUMBER_MS = 800;
/** 先頭が光る時間（ミリ秒）。 */
const LEADER_FLASH_MS = 300;

type Spot = { x: number; y: number; z: number };

interface Shot {
  /** 3D の板の番号（`GameView.playFx`）。絵が無ければ 0。 */
  fx: number;
  attack: FieldAttack;
  leader: string;
  at: Spot;
  dir: { x: number; z: number };
  travelled: number;
}

interface HitNumber {
  seq: number;
  /** 頭の上に出す人（`GameView.headAt` の名前。敵は NPC の id、仲間は `player`・`follower:<id>`）。 */
  id: string;
  amount: number;
  /** 仲間が受けたダメージ（赤い字）。 */
  hurt?: boolean;
}

/** 交戦中かを見直す間隔（ミリ秒）。HP の帯の出し入れ。 */
const ENGAGED_POLL_MS = 250;

export interface FieldAttackDeps {
  viewRef: MutableRefObject<GameView | null>;
  stateRef: MutableRefObject<GameState>;
  /** 敵シンボル（NPC の id → 敵の台帳のキー）。倒したらここから外す。 */
  symbolsRef: MutableRefObject<Map<string, string>>;
  /** いまのマップの NPC の id ぜんぶ（敵でない人も。飛ぶ物は人に当たると消える）。 */
  npcIds(): string[];
  /** このマップでフィールドアタックを使えるか（`maps.json` の `fieldAttack`）。 */
  allowed(): boolean;
  /** 上に一瞬だけ出す札（歩いているあいだの毒と同じ）。 */
  note(text: string): void;
  /** 仲間がみんな倒れた（敵のフィールド攻撃。2026-11-05）。ゲームオーバーへ。 */
  wiped(): void;
  /** 仲間の作戦を次へ回す（GS-305。キー C）。 */
  cycleTactic(): void;
  /** 撤退したあと追ってくる NPC（2026-11-05）。いなければ空。フィールドで倒したら取り分は全額。 */
  hunted?(): string;
  /** 敵シンボルをフィールドで倒した（2026-11-05。追ってくるボスならイベントの続きへ）。 */
  beaten?(npc: string): void;
}

/** 減らした HP と怯み（NPC の id → 覚え）を持ち、重ね絵を返す。覚えはマップが変わったら `reset` で捨てる。 */
export function useFieldAttack(deps: FieldAttackDeps): {
  overlay: ReactNode;
  wounds: MutableRefObject<Map<string, FieldWound>>;
  reset(): void;
  /** 敵の範囲の技が当たった（`GameView` の `foeStrike`。2026-11-05）。 */
  foeStrike(npc: string, area: FoeArea, hits: { id: string; at: Spot }[], center: Spot): void;
  /** 仲間の攻撃の届き方（GS-305。`GameView` の `allyReach`）。 */
  allyReach(member: string): AllyReach | null;
  /** 仲間が敵シンボルを攻めた（GS-305。`GameView` の `allyStrike`）。 */
  allyStrike(member: string, npc: string): void;
  /** 加勢する NPC（GS-306。`GameView` の `allyNpcReach`・`allyNpcStrike`・`allyNpcAlive`）。 */
  allyNpcReach(npc: string): AllyReach | null;
  allyNpcStrike(npc: string, foe: string): void;
  allyNpcAlive(npc: string): boolean;
  /** コマンド戦闘に客として入る加勢 NPC（`near` はその居場所が先頭の近くか）。 */
  guestsFor(near: (at: { x: number; z: number }) => boolean): Fighter[];
  /** 戦闘のあと、客の HP・MP を持ち帰る。 */
  takeGuests(list: Array<{ id: string; hp: number; mp: number }>): void;
  /** 隊列が交戦中か（2026-11-05。`fieldBattle.ts` の `partyEngaged`）。HP の帯が出ているあいだ。 */
  engaged(): boolean;
} {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const wounds = useRef(new Map<string, FieldWound>());
  const readyAt = useRef(0);
  const seq = useRef(0);
  const shots = useRef<Shot[]>([]);
  const [numbers, setNumbers] = useState<HitNumber[]>([]);
  /** 最後の攻撃のやり取り（`performance.now()`。2026-11-05）。0 ならやり取りが無い（交戦中でない）。 */
  const exchangeAt = useRef(0);
  /** 隊列の HP の帯を出しているか（交戦中で、歩けるとき）。 */
  const [bar, setBar] = useState(false);
  const [, setFrame] = useState(0);
  /** 出している数字があるか。あるあいだは毎フレーム描き直す（カメラが動いても付いてくる）。 */
  const live = useRef(false);

  /** 飛んでいる物を全部消す（板も）。 */
  const dropShots = useCallback(() => {
    const view = depsRef.current.viewRef.current;
    for (const shot of shots.current) if (shot.fx) view?.endFx(shot.fx);
    shots.current = [];
  }, []);

  const reset = useCallback(() => {
    wounds.current.clear();
    dropShots();
    setNumbers([]);
    exchangeAt.current = 0;
    setBar(false);
    // 加勢する NPC の減った HP もマップごと（入り直すと満タン。GS-306）。
    allyHp.current.clear();
  }, [dropShots]);

  /** 隊列が交戦中か（2026-11-05）。終わったらやり取りの時刻を捨てる（気づかれただけでは入り直さない）。 */
  const engaged = useCallback((): boolean => {
    const { viewRef, symbolsRef } = depsRef.current;
    const view = viewRef.current;
    const noticing = !!view && [...symbolsRef.current.keys()].some((id) => view.symbolEngaged(id));
    const on = partyEngaged(exchangeAt.current, performance.now(), noticing, !!depsRef.current.hunted?.());
    if (!on) exchangeAt.current = 0;
    return on;
  }, []);
  /** 攻撃のやり取りがあった（交戦中になる）。 */
  const markExchange = useCallback(() => {
    exchangeAt.current = performance.now();
    if (canWalk(useUi.getState())) setBar(true);
  }, []);
  // HP の帯は交戦中のあいだ出し続ける（2026-11-05）。会話・メニュー・戦闘のあいだは下げる。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const on = engaged() && canWalk(useUi.getState());
      setBar((before) => (before === on ? before : on));
    }, ENGAGED_POLL_MS);
    return () => window.clearInterval(timer);
  }, [engaged]);

  /**
   * 仲間 1 人のフィールドアタック（GS-295 の決め方）。選んだ技の MP が足りなければ素手にする（仲間が勝手に使うときの話。
   * 先頭の ☐ は足りなければ撃てない）。倒れていれば null。
   */
  const memberAttack = useCallback((who: string, fallBack: boolean): { attack: FieldAttack; cost: number } | null => {
    const state = depsRef.current.stateRef.current;
    const member = state.members.get(who);
    if (!member || member.hp <= 0) return null;
    const plain = normalAttackOf('party', member.equip.weapon ? itemEquip(member.equip.weapon)?.strike : null);
    const chosen = memberDef(who)?.fieldAttack;
    const attack = resolveFieldAttack({ chosen, known: member.skills, skill: chosen ? skillDef(chosen) : null, normal: plain });
    const cost = scaledMp(attack.mp, attack.skill ? skillDef(attack.skill) : null, memberTraits(who, member.level));
    if (cost > member.mp && fallBack) return { attack: resolveFieldAttack({ known: [], skill: null, normal: plain }), cost: 0 };
    return { attack, cost };
  }, []);

  // --- 加勢する NPC（GS-306。`game/allyNpc.ts`） ------------------------------------------------
  /** 加勢する NPC の減った HP・MP（NPC の id → 値）。そのマップに居るあいだだけ（`reset` で捨てる）。 */
  const allyHp = useRef(new Map<string, { hp: number; mp: number }>());

  /** 加勢する NPC の、客としての `Fighter`（いまの HP 込み）。設定や借りる仲間が無ければ null。 */
  const allyFighterOf = useCallback((npc: string): Fighter | null => {
    const one = depsRef.current.viewRef.current?.allyNpcs().find((entry) => entry.id === npc);
    const def = one ? memberDef(one.ally.member) : null;
    if (!one || !def) return null;
    return guestFighter(npc, one.ally, def, characterName(one.ally.member), allyHp.current.get(npc));
  }, []);

  /** 加勢する NPC のフィールドアタック（借りた仲間の `fieldAttack`。そのレベルまでに覚えた技から。MP は使わない）。 */
  const allyNpcAttack = useCallback((npc: string): { attack: FieldAttack; fighter: Fighter } | null => {
    const fighter = allyFighterOf(npc);
    const one = depsRef.current.viewRef.current?.allyNpcs().find((entry) => entry.id === npc);
    const def = one ? memberDef(one.ally.member) : null;
    if (!fighter || fighter.hp <= 0 || !one || !def) return null;
    const chosen = def.fieldAttack;
    const attack = resolveFieldAttack({ chosen, known: allySkills(def, one.ally.level), skill: chosen ? skillDef(chosen) : null, normal: normalAttackOf('party') });
    return { attack, fighter };
  }, [allyFighterOf]);

  /** 加勢する NPC の攻撃の届き方（GS-306）。 */
  const allyNpcReach = useCallback((npc: string): AllyReach | null => {
    if (!depsRef.current.allowed()) return null;
    const use = allyNpcAttack(npc);
    return use ? { type: use.attack.type, range: use.attack.range, width: use.attack.width, cells: use.attack.cells } : null;
  }, [allyNpcAttack]);

  /** 加勢する NPC が倒れていないか。 */
  const allyNpcAlive = useCallback((npc: string) => (allyHp.current.get(npc)?.hp ?? 1) > 0, []);

  /**
   * コマンド戦闘に客として入る加勢 NPC（GS-306）。`battle` が false でなく、倒れておらず、`near` が true の人。
   */
  const guestsFor = useCallback((near: (at: { x: number; z: number }) => boolean): Fighter[] => {
    const view = depsRef.current.viewRef.current;
    if (!view) return [];
    const out: Fighter[] = [];
    for (const one of view.allyNpcs()) {
      if (!one.ally.battle || !near(one.at)) continue;
      const fighter = allyFighterOf(one.id);
      if (fighter && fighter.hp > 0) out.push(fighter);
    }
    return out;
  }, [allyFighterOf]);

  /** 戦闘のあと、客の HP・MP を持ち帰る（GS-306）。 */
  const takeGuests = useCallback((list: Array<{ id: string; hp: number; mp: number }>) => {
    for (const one of list) {
      const npc = guestNpc(one.id);
      if (npc) allyHp.current.set(npc, { hp: Math.max(0, one.hp), mp: Math.max(0, one.mp) });
    }
  }, []);

  /** 仲間の攻撃の届き方（GS-305）。 */
  const allyReach = useCallback((who: string): AllyReach | null => {
    if (!depsRef.current.allowed()) return null;
    const use = memberAttack(who, true);
    return use ? { type: use.attack.type, range: use.attack.range, width: use.attack.width, cells: use.attack.cells } : null;
  }, [memberAttack]);

  /** 頭の上に数字を出す（しばらくで消える）。 */
  const showNumber = useCallback((id: string, amount: number, hurt = false) => {
    seq.current += 1;
    const number: HitNumber = { seq: seq.current, id, amount, ...(hurt ? { hurt } : {}) };
    setNumbers((list) => [...list, number]);
    window.setTimeout(() => setNumbers((list) => list.filter((one) => one.seq !== number.seq)), HIT_NUMBER_MS);
  }, []);

  /** 絵を 1 つ、その長さだけ出す（3D の板。長さが来たら GameView が消す）。 */
  const flash = useCallback((def: EffectDef | null, at: Spot, side: 'foe' | 'party' = 'foe') => {
    if (!def) return;
    // 足元はいつも絵の真ん中から `FX_RISE` 下（フィールドエフェクトの柱や炎を床から立てる。GS-297）。
    // 大きさは技の絵の「フィールドの大きさ」（`effects.json` の `place.field.scale`。戦闘演出エディタ。GS-320）。
    // 味方に当たった絵は「フィールド: 味方に」のずらし（GS-324）。
    depsRef.current.viewRef.current?.playFx(def, at, { foot: at.y - FX_RISE, side });
  }, []);

  /** 当たりを見る相手。敵シンボルも、敵でない人も（飛ぶ物は人に当たると消える）。 */
  const targets = useCallback((): FieldTarget[] => {
    const view = depsRef.current.viewRef.current;
    if (!view) return [];
    const out: FieldTarget[] = [];
    for (const id of depsRef.current.npcIds()) {
      if (!view.hasNpc(id)) continue;
      const at = view.npcAt(id);
      if (at) out.push({ id, at, half: at.half });
    }
    return out;
  }, []);

  /** 敵シンボルに当てた。HP を減らし、怯ませ、倒したら取り分を入れる。 */
  const strikeSymbol = useCallback(
    (id: string, attack: FieldAttack, leader: string | Fighter) => {
      const { viewRef, stateRef, symbolsRef } = depsRef.current;
      const view = viewRef.current;
      const enemy = symbolsRef.current.get(id);
      const def = enemy ? enemyDef(enemy) : null;
      if (!view || !enemy || !def) return;
      const state = stateRef.current;
      // 攻める人は隊列の人（id）か、加勢する NPC（GS-306。客の `Fighter`）。
      const attacker = typeof leader === 'string' ? partyFighters(state).find((one) => one.id === leader) : leader;
      const defender = enemyFighters([enemy])[0];
      if (!attacker || !defender) return;
      const skill = attack.skill ? skillDef(attack.skill) : null;
      // 種族特性の威力（2026-11-03）も戦闘と同じく掛ける（必ず 1 は通す）。
      const damage = scaledDamage(damageOf(attacker, defender, skill), powerRateOf(skill, attacker.traits));
      const now = performance.now();
      const { wound, defeated } = woundSymbol(wounds.current.get(id), def.hp, damage, now);
      markExchange();
      playSe(battleSettings().se.hit);
      showNumber(id, damage);
      if (!defeated) {
        // まだ気づいていない敵は怯みが短い（すぐ追ってくる。2026-11-06）。先制になる間も怯みに合わせる。
        const left = view.stunNpc(id, FIELD_STUN_MS, 'hit');
        wounds.current.set(id, { ...wound, stunUntil: Math.min(wound.stunUntil, now + left) });
        void view.jump(`npc:${id}`, 1, 0.2, 200);
        return;
      }
      // 倒した。**触れても戦わないように先に外す**。消えるのは薄れてから（入り直せば戻る）。
      // 交戦中（こちらに気づいていた）なら経験は `rates.fieldEngaged` 倍（既定 1。2026-11-05）。消す前に見る。
      const engaged = view.symbolEngaged(id);
      wounds.current.delete(id);
      symbolsRef.current.delete(id);
      void view.vanishNpc(id, 400).then(() => view.removeNpc(id));
      // 撤退したあと追ってくるボス（2026-11-05）は、イベントの戦闘で勝ったのと同じ全額。
      const boss = depsRef.current.hunted?.() === id;
      const spoils = boss
        ? fieldSpoils(def.exp ?? 0, def.gold ?? 0, { kill: 1, engagedExp: 1 }, true)
        : fieldSpoils(def.exp ?? 0, def.gold ?? 0, { kill: fieldKillRate(), engagedExp: fieldEngagedExpRate() }, engaged);
      recordQuestKills(state, [enemy]);
      noteFoesBeaten(state, [enemy]);
      state.gold += spoils.gold;
      const lines = [`${def.name} を たおした！`];
      if (spoils.exp > 0 || spoils.gold > 0) {
        lines.push(
          [spoils.exp > 0 ? `けいけんち ${spoils.exp}` : '', spoils.gold > 0 ? `${spoils.gold} G` : ''].filter(Boolean).join(' と ') + ' を てにいれた！',
        );
      }
      let levelled = false;
      for (const { who, news } of gainExp(state, spoils.exp)) {
        for (const step of news) {
          levelled = true;
          lines.push(`${characterName(who)} は レベル ${step.level} に あがった！`);
        }
      }
      if (levelled) playSe(battleSettings().se.levelUp);
      depsRef.current.note(lines.join('　'));
      depsRef.current.beaten?.(id);
    },
    [showNumber, markExchange],
  );

  /**
   * 敵の範囲の技が当たった（2026-11-05）。範囲にいた仲間それぞれに戦闘と同じ式でダメージ。
   * HP 0 で倒れる。先頭が倒れたら倒れていない人を先頭へ回し、みんな倒れたらゲームオーバー（`wiped`）。
   */
  const foeStrike = useCallback(
    (npc: string, area: FoeArea, hits: { id: string; at: Spot }[], center: Spot) => {
      const { viewRef, stateRef, symbolsRef } = depsRef.current;
      const view = viewRef.current;
      const enemy = symbolsRef.current.get(npc);
      if (!view || !enemy || !canWalk(useUi.getState())) return;
      const attacker = enemyFighters([enemy])[0];
      if (!attacker) return;
      const skill = skillDef(area.skill);
      const def = area.effect ? effectDef(area.effect) : null;
      flash(def, center, 'party');
      const sound = area.se || def?.se || battleSettings().se.enemyAttack;
      if (sound) playSe(sound);
      const state = stateRef.current;
      const fighters = partyFighters(state);
      const leaderBefore = state.party[0];
      const fallen: string[] = [];
      let struck = false;
      for (const hit of hits) {
        // 加勢する NPC（GS-306。id は `npc:<id>`）。
        if (hit.id.startsWith('npc:')) {
          const npcId = hit.id.slice(4);
          const guest = allyFighterOf(npcId);
          if (!guest || guest.hp <= 0) continue;
          const damage = damageOf(attacker, guest, skill);
          const left = Math.max(0, guest.hp - damage);
          allyHp.current.set(npcId, { hp: left, mp: guest.mp });
          flash(area.hitEffect ? effectDef(area.hitEffect) : null, { x: hit.at.x, y: hit.at.y + FX_RISE, z: hit.at.z }, 'party');
          showNumber(npcId, damage, true);
          if (left <= 0) depsRef.current.note(`${guest.name} は たおれた！`);
          continue;
        }
        const member = state.members.get(hit.id);
        const defender = fighters.find((one) => one.id === hit.id);
        if (!member || !defender || member.hp <= 0) continue;
        const damage = damageOf(attacker, defender, skill);
        member.hp = Math.max(0, member.hp - damage);
        struck = true;
        flash(area.hitEffect ? effectDef(area.hitEffect) : null, { x: hit.at.x, y: hit.at.y + FX_RISE, z: hit.at.z }, 'party');
        showNumber(hit.id === leaderBefore ? 'player' : `follower:${hit.id}`, damage, true);
        if (member.hp <= 0) fallen.push(hit.id);
      }
      if (hits.length) markExchange();
      if (!struck) return;
      playSe(battleSettings().se.hit);
      void view.jump('player', 1, 0.15, 160);
      if (fallen.length === 0) return;
      const lines = fallen.map((who) => `${characterName(who)} は たおれた！`);
      const order = leaderAfterDown(state.party, (who) => (state.members.get(who)?.hp ?? 0) > 0);
      if (!order) {
        depsRef.current.note(lines.join('　'));
        depsRef.current.wiped();
        return;
      }
      if (order[0] !== state.party[0]) {
        state.party.splice(0, state.party.length, ...order);
        view.flashLeader(LEADER_FLASH_MS);
        lines.push(`${characterName(order[0]!)} が 先頭に なった`);
      }
      depsRef.current.note(lines.join('　'));
    },
    [allyFighterOf, flash, showNumber, markExchange],
  );

  /**
   * 仲間が敵シンボルを攻めた（GS-305）。届くのは `GameView` が確かめている。飛ばす技も飛ぶ物は出さず、相手の所へ絵を出して当てる。
   * MP は選んだ技を使えたときだけ払う（足りなければ素手）。ダメージ・怯み・取り分は先頭の ☐ と同じ。
   */
  const allyStrike = useCallback((who: string, npc: string) => {
    const { viewRef, stateRef, symbolsRef } = depsRef.current;
    const view = viewRef.current;
    if (!view || !symbolsRef.current.has(npc) || !canWalk(useUi.getState())) return;
    const use = memberAttack(who, true);
    const member = stateRef.current.members.get(who);
    const target = view.npcAt(npc);
    if (!use || !member || !target) return;
    member.mp = Math.max(0, member.mp - use.cost);
    const def = use.attack.effect ? effectDef(use.attack.effect) : null;
    const sound = use.attack.se || def?.se || '';
    if (sound) playSe(sound);
    const spot = { x: target.x, y: target.y + FX_RISE, z: target.z };
    flash(def, spot);
    flash(use.attack.hitEffect ? effectDef(use.attack.hitEffect) : null, spot);
    strikeSymbol(npc, use.attack, who);
  }, [flash, memberAttack, strikeSymbol]);

  /** 加勢する NPC が敵シンボルを攻めた（GS-306）。仲間の攻め方と同じで、攻める人は客の `Fighter`。 */
  const allyNpcStrike = useCallback((npc: string, foe: string) => {
    const { viewRef, symbolsRef } = depsRef.current;
    const view = viewRef.current;
    if (!view || !symbolsRef.current.has(foe) || !canWalk(useUi.getState())) return;
    const use = allyNpcAttack(npc);
    const target = view.npcAt(foe);
    if (!use || !target) return;
    const def = use.attack.effect ? effectDef(use.attack.effect) : null;
    const sound = use.attack.se || def?.se || '';
    if (sound) playSe(sound);
    const spot = { x: target.x, y: target.y + FX_RISE, z: target.z };
    flash(def, spot);
    flash(use.attack.hitEffect ? effectDef(use.attack.hitEffect) : null, spot);
    strikeSymbol(foe, use.attack, use.fighter);
  }, [allyNpcAttack, flash, strikeSymbol]);

  // 飛ぶ物を進める。**歩けないあいだ（会話・戦闘・メニュー）は消す**——触れて戦闘が始まったら残さない。
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!shots.current.length) {
        if (live.current) setFrame((n) => n + 1);
        return;
      }
      const view = depsRef.current.viewRef.current;
      if (!view || !canWalk(useUi.getState())) {
        dropShots();
        return;
      }
      const list = targets();
      const keep: Shot[] = [];
      for (const shot of shots.current) {
        let left = shot.attack.speed * dt;
        let done = false;
        while (left > 0 && !done) {
          const step = Math.min(0.25, left, shot.attack.range - shot.travelled);
          left -= step;
          const next = { x: shot.at.x + shot.dir.x * step, y: shot.at.y, z: shot.at.z + shot.dir.z * step };
          const hit = shotHit(shot.at, next, list, shot.attack.width);
          if (hit) {
            const target = list.find((one) => one.id === hit)!;
            flash(shot.attack.hitEffect ? effectDef(shot.attack.hitEffect) : null, { x: target.at.x, y: target.at.y + FX_RISE, z: target.at.z });
            if (depsRef.current.symbolsRef.current.has(hit)) strikeSymbol(hit, shot.attack, shot.leader);
            done = true;
            break;
          }
          if (view.shotBlocked(next)) {
            flash(shot.attack.hitEffect ? effectDef(shot.attack.hitEffect) : null, shot.at);
            done = true;
            break;
          }
          shot.at = next;
          shot.travelled += step;
          if (shot.travelled >= shot.attack.range - 1e-6) done = true;
        }
        if (done) {
          if (shot.fx) view.endFx(shot.fx);
        } else {
          if (shot.fx) view.moveFx(shot.fx, shot.at);
          keep.push(shot);
        }
      }
      shots.current = keep;
      if (live.current) setFrame((n) => n + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dropShots, flash, strikeSymbol, targets]);

  /** 攻撃する（☐）。 */
  const attack = useCallback(() => {
    const { viewRef, stateRef, allowed } = depsRef.current;
    const view = viewRef.current;
    if (!view || !canWalk(useUi.getState()) || view.timeShifting()) return;
    const now = performance.now();
    if (now < readyAt.current) return;
    if (!allowed()) return;
    const state = stateRef.current;
    const leader = state.party[0];
    const member = leader ? state.members.get(leader) : null;
    const from = view.playerAt();
    const aim = view.facingVector();
    if (!leader || !member || !from || !aim) return;
    // 使い方は技ごと（技の `field`）。仲間は覚えている技から 1 つ選ぶ。無ければ素手（武器の `strike` の絵も見る）。
    const plain = normalAttackOf('party', member.equip.weapon ? itemEquip(member.equip.weapon)?.strike : null);
    const chosen = memberDef(leader)?.fieldAttack;
    const attack = resolveFieldAttack({ chosen, known: member.skills, skill: chosen ? skillDef(chosen) : null, normal: plain });
    // MP が足りなければ撃てない（GS-295）。硬直もかけない。消費 MP は種族特性で減る（2026-11-03）。
    const cost = scaledMp(attack.mp, attack.skill ? skillDef(attack.skill) : null, memberTraits(leader, member.level));
    if (cost > member.mp) {
      playUi('cancel');
      depsRef.current.note('MPが たりない！');
      return;
    }
    member.mp -= cost;
    readyAt.current = now + FIELD_ATTACK_RECOVER_MS;
    view.strike(FIELD_ATTACK_RECOVER_MS);
    // 絵と音。絵は技の `field.effect`、無ければその技（素手）の戦闘の絵。音は `field.se`、無ければ絵の音。
    const def = attack.effect ? effectDef(attack.effect) : null;
    const url = def ? effectImage(def) : null;
    if (url) void preloadImage(url);
    const sound = attack.se || def?.se || '';
    if (sound) playSe(sound);
    const half = view.playerRadius();
    if (attack.type === 'shot') {
      const start = { x: from.x + aim.x * half, y: from.y + FX_RISE, z: from.z + aim.z * half };
      const fx = def ? view.playFx(def, start, { hold: true, foot: from.y }) : 0;
      shots.current = [...shots.current, { fx, attack, leader, at: start, dir: aim, travelled: 0 }];
      return;
    }
    const list = targets();
    if (attack.type === 'area') {
      // 範囲（2026-11-05）。味方は予兆を待たずに、範囲にいる敵シンボルみんなに当てる。絵は範囲の真ん中。
      const axis = axisOf(aim);
      const hits = areaHits(from, axis, attack.cells, list).filter((id) => depsRef.current.symbolsRef.current.has(id));
      let cx = 0;
      let cz = 0;
      for (const [side, ahead] of attack.cells) {
        cx += axis.x * ahead - axis.z * side;
        cz += axis.z * ahead + axis.x * side;
      }
      const count = Math.max(1, attack.cells.length);
      flash(def, { x: from.x + cx / count, y: from.y + FX_RISE, z: from.z + cz / count });
      for (const id of hits) {
        const target = list.find((one) => one.id === id)!;
        flash(attack.hitEffect ? effectDef(attack.hitEffect) : null, { x: target.at.x, y: target.at.y + FX_RISE, z: target.at.z });
        strikeSymbol(id, attack, leader);
      }
      return;
    }
    const hit = meleeHit(from, aim, half, attack.range, list, attack.width);
    const target = hit ? list.find((one) => one.id === hit) : null;
    const spot = target
      ? { x: target.at.x, y: target.at.y + FX_RISE, z: target.at.z }
      : { x: from.x + aim.x * (half + attack.range * 0.6), y: from.y + FX_RISE, z: from.z + aim.z * (half + attack.range * 0.6) };
    flash(def, spot);
    if (hit && depsRef.current.symbolsRef.current.has(hit)) {
      flash(attack.hitEffect ? effectDef(attack.hitEffect) : null, spot);
      strikeSymbol(hit, attack, leader);
    }
  }, [flash, strikeSymbol, targets]);

  /** 先頭を回す（L2・R2）。並びは**中身を入れ替える**（入れ物はイベントの道具立ても握っている）。 */
  const rotate = useCallback((delta: -1 | 1) => {
    const { viewRef, stateRef } = depsRef.current;
    const view = viewRef.current;
    if (!view || !canWalk(useUi.getState()) || view.timeShifting()) return;
    const state = stateRef.current;
    if (state.party.length <= 1) return;
    state.party.splice(0, state.party.length, ...rotateLeader(state.party, delta));
    playUi('decide');
    view.flashLeader(LEADER_FLASH_MS);
    depsRef.current.note(`${characterName(state.party[0]!)} が 先頭に なった`);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === FIELD_ATTACK_KEY) attack();
      else if (event.code === LEADER_PREV_KEY) rotate(-1);
      else if (event.code === LEADER_NEXT_KEY) rotate(1);
      else if (event.code === TACTIC_KEY) depsRef.current.cycleTactic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attack, rotate]);

  live.current = numbers.length > 0;
  const view = deps.viewRef.current;
  const state = deps.stateRef.current;
  const overlay = (
    <>
      {numbers.map((one) => {
        const spot = view?.headAt(one.id);
        return spot ? (
          <div key={`hit${one.seq}`} className={one.hurt ? 'field-hit hurt' : 'field-hit'} style={{ left: spot.x, top: spot.y }}>
            {one.amount}
          </div>
        ) : null;
      })}
      {bar ? (
        // 仲間の HP（交戦中のあいだ。2026-11-05）。
        <div className="field-party-hp">
          {state.party.map((who) => {
            const member = state.members.get(who);
            const max = member ? Math.max(1, partyFighters(state).find((one) => one.id === who)?.stats.hp ?? member.hp) : 1;
            const hp = member?.hp ?? 0;
            return (
              <div key={who} className={hp <= 0 ? 'row down' : 'row'}>
                <span className="name">{characterName(who)}</span>
                <span className="bar"><span style={{ width: `${Math.min(100, (hp / max) * 100)}%` }} className={hp / max < 0.4 ? 'low' : ''} /></span>
                <span className="num">{hp}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
  return { overlay, wounds, reset, foeStrike, allyReach, allyStrike, allyNpcReach, allyNpcStrike, allyNpcAlive, guestsFor, takeGuests, engaged };
}

/** 絵を先に読んでおく（初めての絵でも 1 コマ目から出す）。 */
function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}
