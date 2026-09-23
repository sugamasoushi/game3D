// 戦闘の決まり（GS-60）。**数だけを扱う。**
//
// ここには画面も音も乱数の種も無い。入れると「この一撃はいくつか」を
// 確かめるのに画面を開く必要が出て、直したいのが式なのか描画なのか分からなくなる。
// **迷う数字はここで完結する**——外（`BattleView`）は結果を見せるだけ。
//
// 式は旧作そのまま（`PlayerAttack.ts`）:
//
//     ダメージ = max(攻撃力 + 技の効き目 - 相手の守り, 1)
//
// **必ず 1 は通る。** 0 が出ると「効いていないのか、当たっていないのか」が
// 見ている側に分からず、詰まったのかどうかも判断できない。

/** 台帳に載る数値。味方も敵も同じ形にしておく——式を 2 本持たないため。 */
export interface Stats {
  level: number;
  /** 満タンの HP。**いまいくつあるか**は `Fighter.hp`。 */
  hp: number;
  mp: number;
  attack: number;
  guard: number;
  /** 行動順。大きいほうが先。 */
  speed: number;
}

/** 戦っている 1 体。台帳の数値（`stats`）と、その場の状態を分けて持つ。 */
export interface Fighter {
  /** 味方は人のキー（`meina`）、敵は台帳の id + 連番（`enemy00#1`）。 */
  id: string;
  name: string;
  side: 'party' | 'enemy';
  stats: Stats;
  /** いまの HP・MP。 */
  hp: number;
  mp: number;
  /** このターンだけ上がる守り（防御を選んだぶん）。ターンの頭で 0 に戻す。 */
  guarding: number;
  /** 次の 1 発を避ける（回避）。当たり判定に使ったら降ろす。 */
  avoiding: boolean;
  /**
   * かかっている状態異常（GS-69）。`data/ailments.json` の id。
   * **戦いのあいだだけ**——終われば消えるので、セーブには入らない。
   */
  ailments: string[];
}

/** 技 1 つぶん。台帳（`data/skills.json`）の行と同じ形。 */
export interface SkillDef {
  name: string;
  /** 「特技」か「魔法」。並べる場所が違うだけで、式は同じ。 */
  kind: string;
  /** `attack`（殴る）/ `guard`（守る）/ `avoid`（避ける）。 */
  type: string;
  text?: string;
  /** 使うと減る MP。 */
  mp: number;
  /** 効き目。attack なら攻撃力に足す、guard なら守りに足す。 */
  value: number;
  /**
   * 敵が攻めかかるときの音（`data/sounds.json` のキー）。無ければ重いパンチ。
   * 味方の技の音は**絵（`effect`）の側**が持つ（GS-83）。当たった瞬間の音はどれも同じ打撃。
   */
  se?: string;
  /** 味方が使うときの絵（`data/effects.json` のキー。GS-83）。無ければ素手と同じ絵。 */
  effect?: string;
  /** 与える状態異常（GS-69）。`type` が `ailment` でなくても付けられる（毒のキバ）。 */
  ailment?: string;
  /** その状態異常が当たる見込み（0〜1）。省略は 1。 */
  chance?: number;
  /** 消す状態異常（`type` が `cure` の技）。 */
  cure?: string[];
}

/** 生きているか。**0 以下は死んでいる**（負の HP を持ち回らない）。 */
export function alive(who: Fighter): boolean {
  return who.hp > 0;
}

/** その技を払えるか。MP が足りないものは選ばせない。 */
export function canPay(who: Fighter, skill: SkillDef | null): boolean {
  return !skill || who.mp >= skill.mp;
}

/** いまの守り。台帳の値＋このターンぶん。 */
export function guardOf(who: Fighter): number {
  return who.stats.guard + who.guarding;
}

/**
 * 一撃でいくつ減るか。`skill` が無ければ素手（効き目 0）。
 * **避けているときは 0**——「当たらなかった」は「1 も通らない」ではなく、
 * そもそも殴っていないので、最低 1 の決まりの外に置く。
 */
export function damageOf(attacker: Fighter, defender: Fighter, skill?: SkillDef | null): number {
  if (defender.avoiding) return 0;
  const value = skill && skill.type === 'attack' ? skill.value : 0;
  return Math.max(attacker.stats.attack + value - guardOf(defender), 1);
}

/**
 * 行動の順。**速さの大きい順**、同じなら並んでいた順のまま
 * （`sort` は安定なので、味方 → 敵の並びがそのまま残る）。
 * 毎ターン呼び直す——速さを変える技を後で足しても、ここは触らずに済む。
 */
export function turnOrder(fighters: Fighter[]): Fighter[] {
  return fighters.filter(alive).slice().sort((a, b) => b.stats.speed - a.stats.speed);
}

/** ターンの頭。**1 ターンだけの効果を降ろす。** 降ろし忘れるとずっと硬い。 */
export function beginTurn(fighters: Fighter[]): void {
  for (const who of fighters) {
    who.guarding = 0;
    who.avoiding = false;
  }
}

/** 減らす。返り値は**実際に減った量**（見せる数はこれ）。 */
export function hurt(who: Fighter, amount: number): number {
  const done = Math.min(Math.max(amount, 0), who.hp);
  who.hp -= done;
  return done;
}

/** 回復。満タンを超えない。 */
export function heal(who: Fighter, amount: number): number {
  const done = Math.min(Math.max(amount, 0), who.stats.hp - who.hp);
  who.hp += done;
  return done;
}

/** 技を使ったぶんの MP を払う。足りなければ false（減らさない）。 */
export function payMp(who: Fighter, skill: SkillDef | null): boolean {
  if (!skill) return true;
  if (who.mp < skill.mp) return false;
  who.mp -= skill.mp;
  return true;
}

/** どちらが決まったか。まだなら null——**引き分けは無い**（両方倒れたら負け）。 */
export function battleResult(fighters: Fighter[]): 'win' | 'lose' | null {
  const party = fighters.filter((who) => who.side === 'party');
  const enemy = fighters.filter((who) => who.side === 'enemy');
  if (!party.some(alive)) return 'lose';
  if (!enemy.some(alive)) return 'win';
  return null;
}

/** 勝ったときの取り分。**倒した敵ぶんだけ**（逃げた敵は数えない）。 */
export function goldOf(enemies: Array<{ gold?: number }>): number {
  return enemies.reduce((sum, entry) => sum + (entry.gold ?? 0), 0);
}
