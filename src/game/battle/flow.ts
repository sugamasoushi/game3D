// 戦闘の流れ（GS-60）。**待つのは呼ぶ側、決めるのはここ。**
//
// 作りはイベントの実行機（`event/interpreter.ts`）と同じ——
// **`await` で 1 手ずつ進める**。旧作は状態機械（`BATTLE_SELECT` → `ATTACK_SELECT` →
// `ENEMY_SELECT` を push/pop）だったが、あれは「次に何を出すか」を状態の名前で持つ作りで、
// 途中に 1 手足すたびに遷移表を読み直すことになる。await なら**上から下に読める**。
//
// **画面も音も乱数もここには無い**（`io` 越しに呼ぶ）。乱数を外から渡すのは、
// 「逃げられなかった」が運なのか式の間違いなのかを、種を固定して確かめられるようにするため。

import {
  alive,
  battleResult,
  beginTurn,
  damageOf,
  hurt,
  payMp,
  turnOrder,
  type Fighter,
  type SkillDef,
} from './rules';
import { ailmentDef, enemyDef, skillDef } from './book';
import { enemyIdOf } from './party';
import { applyUse, healLine } from './heal';
import { itemName, itemUse } from '../items';
import { battleSettings } from './settings';

/**
 * ゲームオーバーの合図（GS-60）。**エラーではなく「ここで話は終わり」の印。**
 * 負けたときに `lose` の枝が書かれていなければ、これを投げてイベントを止める——
 * 止めないと、倒れたまま続きの会話が進んでしまう。
 */
export class GameOver extends Error {
  constructor() {
    super('game over');
    this.name = 'GameOver';
  }
}

/** 味方が選ぶ 1 手。 */
export type BattleAction =
  | { kind: 'attack'; target: string }
  | { kind: 'skill'; skill: string; target?: string }
  /** 持ち物を使う（GS-64）。`target` は味方の id。 */
  | { kind: 'item'; id: string; target: string }
  | { kind: 'run' };

/** 決着。 */
export type BattleOutcome = 'win' | 'lose' | 'escape';

/** 勝ったときの取り分。 */
export interface BattleSpoils {
  /** 溜まる経験（GS-63）。 */
  exp: number;
  gold: number;
}

/** 画面と繋ぐ口。**ここに無いことは戦闘からはできない**（`EventContext` と同じ考え）。 */
export interface BattleIo {
  /** 1 行出して、読み終わる（か飛ばされる）まで待つ。 */
  say(line: string): Promise<void>;
  /**
   * 味方の手を**全員ぶんまとめて**選ばせる（GS-81）。返すのは id → 手。
   * 1 人ずつ受け取ると、画面は受け取った手を取り消せない——旧作のように
   * 「✖ で前の人の選択へ戻る」には、**選び終わるまで画面が手を持っている**必要がある。
   * 渡すのは手を聞く人だけ（倒れている人・眠っている人は除いてある）。
   * 「逃げる」「オート」のように 1 つの命令で決まることもあるので、**手の無い人は動かない**。
   */
  commands(members: Fighter[]): Promise<Map<string, BattleAction>>;
  /** 数が動いたので描き直す。**待つ**——減り方が見えないと何が起きたか分からない。 */
  update(): Promise<void>;
  /**
   * 攻めかかる見せ場（GS-83）。**当たる前に**呼んで、終わるまで待つ。
   * 味方なら相手の上に技の絵、敵なら攻めかかる動きと画面ゆれ（旧作 `PlayerAttack` / `EnemyAttack`）。
   * 何を見せるかは画面が決める——式は「誰が誰に何で」だけを渡す。無い画面では飛ばす。
   */
  act?(attacker: Fighter, defender: Fighter, skill: SkillDef | null): Promise<void>;
  /**
   * 勝ち負けが決まった（GS-85）。**決まった瞬間に**呼ぶ——曲を止めるのはここ。
   * 逃げたときは呼ばない（決着ではないので、マップの曲へそのまま戻る）。
   */
  decided?(outcome: BattleOutcome): void;
  /** 音を 1 つ鳴らす（`data/sounds.json` のキー）。鳴らない画面もあるので任意。 */
  se?(key: string): void;
  /**
   * 持ち物を 1 つ減らす（GS-64）。**記録を持っているのは画面**なので、ここでは頼むだけ。
   * 持っていなければ false。
   */
  spendItem?(id: string): boolean;
  /**
   * 誰に何が起きたか（GS-68）。**見せ方は画面に任せる**——
   * ここは「この人に 12 のダメージ」とだけ言い、点滅や揺れの長さは決めない。
   * **待つ**（GS-85）——点滅が終わってから帯を動かし、それから文を出す。
   * 待たずに進めると、点滅・帯・文が同時に始まって何が起きたか追えない。
   */
  hit?(id: string, amount: number, kind: 'damage' | 'heal' | 'miss' | 'ailment'): Promise<void> | void;
  /** 0 以上 1 未満。**外から渡す**ので、確かめるときは固定できる。 */
  random(): number;
}

// 当たった音・かわした音・勝った音・持ち物の既定の音は戦闘共通の台帳（`battleSettings.json`。GS-106）が持つ。
// **技の音は技の台帳（`skills.json` の `se`）が持つ**——どの技がどう鳴るかはデータの話で、流れの都合ではない。

/** 逃げられる見込み。速さの差で上下し、**必ず 1 割は失敗する**（確実な逃げは緊張が消える）。 */
export function escapeChance(party: Fighter[], enemies: Fighter[]): number {
  const ours = party.filter(alive);
  const theirs = enemies.filter(alive);
  if (ours.length === 0 || theirs.length === 0) return 1;
  const fast = (list: Fighter[]) => list.reduce((sum, who) => sum + who.stats.speed, 0) / list.length;
  return Math.min(0.9, Math.max(0.25, 0.5 + (fast(ours) - fast(theirs)) / 40));
}

/** かかっているか。 */
function hasAilment(who: Fighter, id: string): boolean {
  return who.ailments.includes(id);
}

/** 付ける。**すでに付いていれば重ねない**（同じ毒を 2 つ持っても意味が無い）。 */
function addAilment(who: Fighter, id: string): boolean {
  if (hasAilment(who, id)) return false;
  who.ailments.push(id);
  return true;
}

/** 外す。 */
function dropAilment(who: Fighter, id: string): boolean {
  const at = who.ailments.indexOf(id);
  if (at < 0) return false;
  who.ailments.splice(at, 1);
  return true;
}

/** 行動できない状態異常にかかっているか（ねむりなど）。 */
function asleep(who: Fighter): boolean {
  return who.ailments.some((id) => ailmentDef(id)?.skip === true);
}

/**
 * 状態異常を与える（GS-69）。**外れることもある**——
 * 必ず当たると「眠らせて殴るだけ」の戦いになる。
 */
async function inflict(defender: Fighter, skill: SkillDef, io: BattleIo): Promise<void> {
  if (!skill.ailment || !alive(defender)) return;
  const def = ailmentDef(skill.ailment);
  if (!def || io.random() >= (skill.chance ?? 1) || !addAilment(defender, skill.ailment)) {
    await io.say('しかし 効かなかった！');
    return;
  }
  await io.hit?.(defender.id, 0, 'ailment');
  await io.update();
  await io.say(`${defender.name} は ${def.hit ?? `${def.name}に なった！`}`);
}

/**
 * 眠りから覚めるか（GS-69）。**ターンの頭で、手を選ばせる前に**回す——
 * 選ばせた後だと「起きたのに今回は休み」になり、2 手ぶん取られたように感じる。
 * **`recover` を書いていない状態異常は自然には抜けない**（治す手立てが要る）。
 */
async function wakeUp(fighters: Fighter[], io: BattleIo): Promise<void> {
  for (const who of fighters) {
    if (!alive(who)) continue;
    for (const id of [...who.ailments]) {
      const def = ailmentDef(id);
      if (!def?.skip || io.random() >= (def.recover ?? 0)) continue;
      dropAilment(who, id);
      await io.say(`${who.name} は ${def.gone ?? `${def.name}が 消えた。`}`);
    }
  }
}

/** 生きている相手を 1 体。**選ぶのは呼ぶ側の乱数**。 */
function pickTarget(list: Fighter[], random: () => number): Fighter | null {
  const living = list.filter(alive);
  if (living.length === 0) return null;
  return living[Math.min(living.length - 1, Math.floor(random() * living.length))];
}

/** 一撃。減った数を出して、倒れたら言う。 */
async function strike(attacker: Fighter, defender: Fighter, skill: SkillDef | null, io: BattleIo): Promise<void> {
  // 見せ場は**かわす前に**（旧作も攻めかかってから「回避した」と出す）。
  await io.act?.(attacker, defender, skill);
  if (defender.avoiding) {
    io.se?.(battleSettings().se.dodge);
    await io.hit?.(defender.id, 0, 'miss');
    await io.say(`${defender.name} は ひらりとかわした！`);
    // **避けは 1 回きり。** 降ろさないと、そのターンずっと当たらない。
    defender.avoiding = false;
    return;
  }
  // 当たった瞬間の音は**どれも同じ打撃**（旧作 `SE_attack`）。技ごとの音は見せ場で鳴っている。
  io.se?.(battleSettings().se.hit);
  const done = hurt(defender, damageOf(attacker, defender, skill));
  await io.hit?.(defender.id, done, 'damage');
  await io.update();
  await io.say(`${defender.name} に ${done} のダメージ！`);
  if (!alive(defender)) {
    await io.say(`${defender.name} は たおれた！`);
    // 倒れた人の状態異常は持ち回らない（起こすときに毒だけ残っているのは分かりにくい）。
    defender.ailments.length = 0;
    return;
  }
  // **殴られて起きる**（ねむり）。起こしてから毒を付ける——順番が逆だと
  // 「眠ったまま毒になった」ように読める。
  for (const id of [...defender.ailments]) {
    const def = ailmentDef(id);
    if (!def?.wakeOnHit) continue;
    dropAilment(defender, id);
    await io.say(`${defender.name} は ${def.gone ?? `${def.name}が 消えた。`}`);
  }
  if (skill?.ailment) await inflict(defender, skill, io);
}

/** 味方 1 人ぶんの手を実行する。返り値は「逃げ切ったか」。 */
async function actParty(
  who: Fighter,
  action: BattleAction,
  enemies: Fighter[],
  party: Fighter[],
  io: BattleIo,
): Promise<boolean> {
  if (action.kind === 'run') {
    await io.say(`${who.name} は にげだした！`);
    if (io.random() < escapeChance(party, enemies)) return true;
    await io.say('しかし まわりこまれてしまった！');
    return false;
  }

  if (action.kind === 'item') {
    const use = itemUse(action.id, 'battle');
    // **減らせてから効かせる。** 逆にすると、無い物で回復できてしまう。
    if (!use || !io.spendItem?.(action.id)) {
      await io.say('しかし 何も 起きなかった……');
      return false;
    }
    await io.say(`${who.name} は ${itemName(action.id)} を つかった！`);
    io.se?.(use.se ?? battleSettings().se.item);
    const target = party.find((one) => one.id === action.target) ?? who;
    const healed = applyUse(target, target.stats, use);
    await io.hit?.(target.id, healed.hp + healed.mp, 'heal');
    await io.update();
    if (use.say) await io.say(use.say);
    for (const id of healed.cured) {
      const def = ailmentDef(id);
      await io.say(`${target.name} は ${def?.gone ?? `${def?.name ?? id}が 消えた。`}`);
    }
    const line = healLine(target.name, healed);
    if (line) await io.say(line);
    return false;
  }

  const skill = action.kind === 'skill' ? skillDef(action.skill) : null;
  if (action.kind === 'skill') {
    // **払えなければ何もしない。** 選ばせる側で止めているが、
    // 選んでから減った（MP を使う敵の技など）ときのために、ここでも見る。
    if (!skill || !payMp(who, skill)) {
      await io.say(`${who.name} は MP が たりない！`);
      return false;
    }
    await io.update();
    await io.say(`${who.name} の ${skill.name}！`);
    if (skill.type === 'guard') {
      who.guarding = skill.value;
      await io.say(`${who.name} は 身を かためた！`);
      return false;
    }
    if (skill.type === 'avoid') {
      who.avoiding = true;
      await io.say(`${who.name} は 身がまえた！`);
      return false;
    }
    if (skill.type === 'cure') {
      // 治すのは**自分たちの誰か**。相手を選んでいなければ、かかっている人を先に。
      const named = party.find((one) => one.id === action.target && alive(one));
      const target = named ?? party.find((one) => alive(one) && one.ailments.length > 0) ?? who;
      const gone = (skill.cure ?? []).filter((id) => dropAilment(target, id));
      await io.hit?.(target.id, 0, gone.length > 0 ? 'heal' : 'miss');
      await io.update();
      if (gone.length === 0) await io.say('しかし 何も 起きなかった……');
      for (const id of gone) {
        const def = ailmentDef(id);
        await io.say(`${target.name} は ${def?.gone ?? `${def?.name ?? id}が 消えた。`}`);
      }
      return false;
    }
    if (skill.type === 'ailment') {
      const named = enemies.find((one) => one.id === action.target && alive(one));
      const target = named ?? pickTarget(enemies, io.random);
      if (target) await inflict(target, skill, io);
      return false;
    }
  } else {
    await io.say(`${who.name} の こうげき！`);
  }

  const named = enemies.find((one) => one.id === action.target);
  // 選んだ相手が先に倒れていたら、生きている別の相手へ回す（空振りで 1 手損させない）。
  const target = named && alive(named) ? named : pickTarget(enemies, io.random);
  if (!target) return false;
  await strike(who, target, skill, io);
  return false;
}

/**
 * 敵が出す技を選ぶ（GS-69）。**上から順に見て、`chance` で決める**——
 * 重みで 1 つ選ぶ形にすると「必ず何かの技を出す」ことになり、素手の一撃が消える。
 */
function enemySkill(who: Fighter, io: BattleIo): SkillDef | null {
  const def = enemyDef(enemyIdOf(who));
  for (const entry of def?.skills ?? []) {
    const skill = skillDef(entry.id);
    if (!skill || who.mp < skill.mp) continue;
    if (io.random() < (entry.chance ?? 1)) return skill;
  }
  return null;
}

/** 敵 1 体ぶん。技を持っていれば出し、なければ殴る。 */
async function actEnemy(who: Fighter, party: Fighter[], io: BattleIo): Promise<void> {
  const target = pickTarget(party, io.random);
  if (!target) return;
  const skill = enemySkill(who, io);
  if (!skill) {
    await io.say(`${who.name} の こうげき！`);
    await strike(who, target, null, io);
    return;
  }
  payMp(who, skill);
  await io.update();
  await io.say(`${who.name} の ${skill.name}！`);
  if (skill.type === 'attack') {
    await strike(who, target, skill, io);
    return;
  }
  await inflict(target, skill, io);
}

/**
 * 1 戦。**終わるまで返らない。**
 * `fighters` は直に書き換える——終わったら呼ぶ側が `writeBack` でセーブへ戻す。
 */
export async function runBattle(fighters: Fighter[], io: BattleIo): Promise<{ outcome: BattleOutcome; spoils: BattleSpoils }> {
  const party = fighters.filter((who) => who.side === 'party');
  const enemies = fighters.filter((who) => who.side === 'enemy');
  const names = [...new Set(enemies.map((who) => who.name))].join('と');
  await io.say(`${names} が あらわれた！`);

  // 空回りしない止め（データが壊れていても画面が固まらない）。
  for (let turn = 0; turn < 200; turn += 1) {
    beginTurn(fighters);
    await io.update();
    // 眠りから覚めるのはここ（GS-69）。**手を選ばせる前**なので、起きたその手番から動ける。
    await wakeUp(fighters, io);

    // **先に全員ぶん選ばせてから動かす。** 選んでいる途中に敵が動くと、
    // 「殴ろうとした相手がもう居ない」が毎回起きる。
    // **眠っている人には聞かない**（GS-69）。聞いてから「動けなかった」と出すのは、
    // 選ばせておいて無かったことにするのと同じで、操作した意味が消える。
    const askable = party.filter((who) => alive(who) && !asleep(who));
    const orders = askable.length > 0 ? await io.commands(askable) : new Map<string, BattleAction>();

    // **守りは速さより先。** 順番どおりだと、足の遅い者の「防御」は
    // 殴られた後に効くことになり、選んだ意味が無い。
    const order = turnOrder(fighters);
    const defends = (who: Fighter) => {
      const action = orders.get(who.id);
      if (!action || action.kind !== 'skill') return false;
      const type = skillDef(action.skill)?.type;
      return type === 'guard' || type === 'avoid';
    };
    for (const who of [...order.filter(defends), ...order.filter((one) => !defends(one))]) {
      if (!alive(who)) continue; // この順番を待つ間に倒れた者は動かない。
      // まだ眠っているなら動けない（覚めるかどうかはターンの頭で決まっている）。
      if (asleep(who)) {
        await io.say(`${who.name} は ぐっすり ねむっている……`);
        continue;
      }
      if (who.side === 'party') {
        const action = orders.get(who.id);
        if (!action) continue;
        if (await actParty(who, action, enemies, party, io)) {
          return { outcome: 'escape', spoils: { exp: 0, gold: 0 } };
        }
      } else {
        await actEnemy(who, party, io);
      }
      const decided = battleResult(fighters);
      if (decided) return await finish(decided, enemies, io);
    }

    // ターンの終わりに毒（GS-69）。**行動の途中ではなく終わりにまとめる**——
    // 手番ごとに削ると、速さの順しだいで受ける回数が変わってしまう。
    for (const who of fighters) {
      if (!alive(who)) continue;
      for (const id of who.ailments) {
        const def = ailmentDef(id);
        if (!def?.turnDamage) continue;
        const done = hurt(who, def.turnDamage);
        await io.hit?.(who.id, done, 'damage');
        await io.update();
        await io.say(`${who.name} は ${def.name}で ${done} の ダメージ！`);
        if (!alive(who)) await io.say(`${who.name} は たおれた！`);
      }
    }

    const decided = battleResult(fighters);
    if (decided) return await finish(decided, enemies, io);
  }
  // ここへ来るのは決着が付かない作りになっているとき。**負けにはしない。**
  return { outcome: 'escape', spoils: { exp: 0, gold: 0 } };
}

/**
 * 決着の一言と取り分。**負けの一言はここで言う**——
 * 画面側で言わせると、戦闘を別の画面から始めたときに言い忘れる。
 */
async function finish(
  outcome: BattleOutcome,
  enemies: Fighter[],
  io: BattleIo,
): Promise<{ outcome: BattleOutcome; spoils: BattleSpoils }> {
  // 決着の合図（GS-85）。**一言より先**——曲が鳴ったまま「かった！」と言うと締まらない。
  io.decided?.(outcome);
  await io.update();
  if (outcome === 'win') io.se?.(battleSettings().se.win);
  if (outcome === 'lose') await io.say('目のまえが まっくらに なった……');
  const spoils = spoilsOf(outcome, enemies);
  if (outcome === 'win' && spoils.exp > 0) await io.say(`けいけんち ${spoils.exp} を かくとく！`);
  if (outcome === 'win' && spoils.gold > 0) await io.say(`${spoils.gold} G を てにいれた！`);
  return { outcome, spoils };
}

/** 取り分。**勝ったときだけ**（逃げても負けても 0）。 */
function spoilsOf(outcome: BattleOutcome, enemies: Fighter[]): BattleSpoils {
  if (outcome !== 'win') return { exp: 0, gold: 0 };
  let exp = 0;
  let gold = 0;
  for (const who of enemies) {
    const def = enemyDef(enemyIdOf(who));
    exp += def?.exp ?? 0;
    gold += def?.gold ?? 0;
  }
  return { exp, gold };
}
