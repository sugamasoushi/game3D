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
import { battleSettings, fieldKillRate, normalAttackOf } from '../game/battle/settings';
import { enemyFighters, gainExp, partyFighters } from '../game/battle/party';
import { damageOf } from '../game/battle/rules';
import { itemEquip } from '../game/items';
import { characterName } from '../game/characters';
import { playSe, playUi } from '../game/audio';
import {
  FIELD_ATTACK_RECOVER_MS,
  FIELD_STUN_MS,
  resolveFieldAttack,
  fieldKillSpoils,
  meleeHit,
  rotateLeader,
  shotHit,
  woundSymbol,
  type FieldAttack,
  type FieldTarget,
  type FieldWound,
} from '../game/fieldAttack';

/** 攻撃のキー（☐）。ゲームパッドの 2 番も `gamepad.ts` でこれになる。 */
export const FIELD_ATTACK_KEY = 'KeyX';
/** 先頭を前の人へ（L2）・次の人へ（R2）。 */
export const LEADER_PREV_KEY = 'KeyQ';
export const LEADER_NEXT_KEY = 'KeyE';

/** 絵を出す高さ（足元から。マス）。体の真ん中あたり。 */
const FX_RISE = 0.6;
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
  id: string;
  amount: number;
}

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
}

/** 減らした HP と怯み（NPC の id → 覚え）を持ち、重ね絵を返す。覚えはマップが変わったら `reset` で捨てる。 */
export function useFieldAttack(deps: FieldAttackDeps): {
  overlay: ReactNode;
  wounds: MutableRefObject<Map<string, FieldWound>>;
  reset(): void;
} {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const wounds = useRef(new Map<string, FieldWound>());
  const readyAt = useRef(0);
  const seq = useRef(0);
  const shots = useRef<Shot[]>([]);
  const [numbers, setNumbers] = useState<HitNumber[]>([]);
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
  }, [dropShots]);

  /** 絵を 1 つ、その長さだけ出す（3D の板。長さが来たら GameView が消す）。 */
  const flash = useCallback((def: EffectDef | null, at: Spot, scale = 1) => {
    if (!def) return;
    // 足元はいつも絵の真ん中から `FX_RISE` 下（フィールドエフェクトの柱や炎を床から立てる。GS-297）。
    depsRef.current.viewRef.current?.playFx(def, at, { scale, foot: at.y - FX_RISE });
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
    (id: string, attack: FieldAttack, leader: string) => {
      const { viewRef, stateRef, symbolsRef } = depsRef.current;
      const view = viewRef.current;
      const enemy = symbolsRef.current.get(id);
      const def = enemy ? enemyDef(enemy) : null;
      if (!view || !enemy || !def) return;
      const state = stateRef.current;
      const attacker = partyFighters(state).find((one) => one.id === leader);
      const defender = enemyFighters([enemy])[0];
      if (!attacker || !defender) return;
      const skill = attack.skill ? skillDef(attack.skill) : null;
      const damage = damageOf(attacker, defender, skill);
      const now = performance.now();
      const { wound, defeated } = woundSymbol(wounds.current.get(id), def.hp, damage, now);
      playSe(battleSettings().se.hit);
      seq.current += 1;
      const number = { seq: seq.current, id, amount: damage };
      setNumbers((list) => [...list, number]);
      window.setTimeout(() => setNumbers((list) => list.filter((one) => one.seq !== number.seq)), HIT_NUMBER_MS);
      if (!defeated) {
        wounds.current.set(id, wound);
        view.stunNpc(id, FIELD_STUN_MS);
        void view.jump(`npc:${id}`, 1, 0.2, 200);
        return;
      }
      // 倒した。**触れても戦わないように先に外す**。消えるのは薄れてから（入り直せば戻る）。
      wounds.current.delete(id);
      symbolsRef.current.delete(id);
      void view.vanishNpc(id, 400).then(() => view.removeNpc(id));
      const spoils = fieldKillSpoils(def.exp ?? 0, def.gold ?? 0, fieldKillRate());
      recordQuestKills(state, [enemy]);
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
    },
    [],
  );

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
            flash(shot.attack.hitEffect ? effectDef(shot.attack.hitEffect) : null, { x: target.at.x, y: target.at.y + FX_RISE, z: target.at.z }, shot.attack.fxScale);
            if (depsRef.current.symbolsRef.current.has(hit)) strikeSymbol(hit, shot.attack, shot.leader);
            done = true;
            break;
          }
          if (view.shotBlocked(next)) {
            flash(shot.attack.hitEffect ? effectDef(shot.attack.hitEffect) : null, shot.at, shot.attack.fxScale);
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
    // MP が足りなければ撃てない（GS-295）。硬直もかけない。
    if (attack.mp > member.mp) {
      playUi('cancel');
      depsRef.current.note('MPが たりない！');
      return;
    }
    member.mp -= attack.mp;
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
      const fx = def ? view.playFx(def, start, { hold: true, scale: attack.fxScale, foot: from.y }) : 0;
      shots.current = [...shots.current, { fx, attack, leader, at: start, dir: aim, travelled: 0 }];
      return;
    }
    const list = targets();
    const hit = meleeHit(from, aim, half, attack.range, list, attack.width);
    const target = hit ? list.find((one) => one.id === hit) : null;
    const spot = target
      ? { x: target.at.x, y: target.at.y + FX_RISE, z: target.at.z }
      : { x: from.x + aim.x * (half + attack.range * 0.6), y: from.y + FX_RISE, z: from.z + aim.z * (half + attack.range * 0.6) };
    flash(def, spot, attack.fxScale);
    if (hit && depsRef.current.symbolsRef.current.has(hit)) {
      flash(attack.hitEffect ? effectDef(attack.hitEffect) : null, spot, attack.fxScale);
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attack, rotate]);

  live.current = numbers.length > 0;
  const view = deps.viewRef.current;
  const overlay = (
    <>
      {numbers.map((one) => {
        const spot = view?.headAt(one.id);
        return spot ? (
          <div key={`hit${one.seq}`} className="field-hit" style={{ left: spot.x, top: spot.y }}>
            {one.amount}
          </div>
        ) : null;
      })}
    </>
  );
  return { overlay, wounds, reset };
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
