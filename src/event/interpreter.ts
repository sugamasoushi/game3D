// イベントの実行機（インタプリタ）。**JSON をどう「関数を動かす」に変えるか**の中身。
//
// 仕掛けは 2 つだけ。
//   1. 命令の名前（`type`）→ 実際に動く関数、の**表**を持つ
//   2. その表を `for` で回して **`await`** する
// これで「歩き終わってから喋る」が素直に書ける。ジェネレータより読みやすい。
//
// **JSON にコードは入らない。** 入るのは名前と引数だけなので、
// 読み込んだデータが勝手なことをできない（`eval` を使わない）。
// 逃げ道の `script` も、動かすのは**先に TS 側で登録した関数**だけ。

import type { ActorRef, BlockFace, EventCommand, EventDef, PlaceAt, Step, TalkStyle } from './types';

/**
 * ランタイムが用意する道具（イベントから見える世界）。
 * **ここに無いことはイベントにはできない**——コマンド表を増やすときは、まずここへ足す。
 */
export interface EventContext {
  /** 会話を出して、読み終わるまで待つ。`style` で吹き出しにできる（GS-23）。 */
  message(talk: { who?: string; lines: string[] }[], face?: string, style?: TalkStyle): Promise<void>;
  /** 流れる文字。読み終わる（か飛ばされる）まで待つ。`speed` は 1 行ぶんの時間（GS-144）。 */
  scroll(lines: string[], speed: number, dim: number): Promise<void>;
  /** 選択肢を出して、選ばれた番号を返す。 */
  choice(choices: string[], cancel?: number): Promise<number>;
  /** 1 マス歩く。歩き終わったら返る。`slide` は向きも足も動かさずに運ぶ（GS-155）。 */
  step(target: ActorRef, dir: Step, speed?: number, slide?: boolean): Promise<void>;
  /** 向きだけ変える。 */
  turn(target: ActorRef, dir: Step): void;
  /**
   * その場に置き直す（GS-137）。歩かず一瞬で移す。居ない相手なら何もしない。
   * 軸に `"player"` と書けば**主人公と同じ座標**（GS-154）。解くのは実行機側。
   */
  place(target: ActorRef, at: PlaceAt, face?: Step): void;
  /**
   * いまの場所から行き先のマスまでの道順（GS-138 / GS-139）。**歩かせはしない**——
   * 1 歩ずつ `step` に渡すのは呼ぶ側。居ない相手なら空。
   * `first` はどちらの向きから先に詰めるか（既定は画面の横）。
   */
  routeTo(target: ActorRef, at: PlaceAt, first?: 'leftRight' | 'upDown'): Step[];
  /**
   * キャライラスト。`who` も `image` も無ければその絵を引っ込める。
   * `id` はこのイベントの中だけの名前（GS-143）。省くと `slot` が名前になる。
   */
  portrait(spec: {
    slot: string;
    id?: string;
    who?: string;
    face?: string;
    image?: string;
    from?: 'left' | 'right' | 'top' | 'bottom' | 'none';
    flip?: boolean;
    ms?: number;
    instant?: boolean;
  }): Promise<void>;
  /** 出ているキャライラストに効果をかける（GS-143）。知らない `id` なら何もしない。 */
  imageFx(
    id: string,
    fx: {
      kind: 'out' | 'shake' | 'fade' | 'zoom';
      to?: 'left' | 'right' | 'top' | 'bottom';
      opacity?: number;
      power?: number;
      scale?: number;
      ms?: number;
      wait?: boolean;
    },
  ): Promise<void>;
  fade(to: 'out' | 'in', ms: number): Promise<void>;
  wait(ms: number): Promise<void>;
  /**
   * マップ移動。`at` が null なら行き先マップの `default` へ置く
   * （オブジェクトのプロパティ `MapMove` だけを書いた近道。GS-14）。
   */
  transfer(map: string, at: { x: number; y: number; z: number } | null, face?: Step, fade?: boolean): Promise<void>;
  playSe(key: string, volume?: number): void;
  playBgm(key: string, volume?: number): void;
  stopBgm(fade?: number): void;
  /** スイッチと変数。セーブに入る。 */
  getSwitch(key: string): boolean;
  setSwitch(key: string, value: boolean): void;
  /** セルフスイッチ（GS-27）。動かしているイベント自身の覚え。 */
  getSelfSwitch(key: string): boolean;
  setSelfSwitch(key: string, value: boolean): void;
  getVariable(key: string): number;
  setVariable(key: string, value: number): void;
  /** マスの絵を差し替える（GS-53）。そのマスに差し替える物が無ければ false。 */
  block(
    at: { x: number; y: number; z: number },
    faces: Partial<Record<BlockFace, number>>,
    layer?: string,
  ): boolean;
  /** 静止コマを指名する（GS-47）。知らない名前なら false。 */
  pose(target: ActorRef, name: string | null): boolean;
  /** 持ち物（GS-46）。数を足す・引く・数える。 */
  /** `id` を空にすると、起こしたオブジェクトの `Item`（GS-132）。`count` は undefined で `Num`。 */
  getItem(id: string, count: number | undefined): void;
  loseItem(id: string, count: number | undefined): void;
  countItem(id: string): number;
  /**
   * 戦闘（GS-60）。**決着が付くまで返らない。**
   * 負けたときに話を続けるかどうかは呼ぶ側（`battle` 命令の `lose`）が決める。
   */
  battle(enemies: string[], canLose?: boolean, formation?: string): Promise<'win' | 'lose' | 'escape'>;
  /**
   * カメラ演出（GS-73）。鳴らして**長さ（ミリ秒）**を返す。
   * `release` は残している演出を戻す。
   */
  shot(
    shot: { id?: string; kind?: string; ms?: number; power?: number; color?: string; hold?: boolean },
    release: boolean,
  ): number;
  /** 仲間の出入り（GS-70）。 */
  party(op: 'join' | 'leave', who: string): void;
  /** 店（GS-66）。**閉じるまで返らない。** */
  shop(items: string[], sell: boolean): Promise<void>;
  /** 所持金（GS-65）。 */
  getGold(): number;
  setGold(value: number): void;
  /** 回復（GS-64）。`who` を省くと隊列ぜんぶ。 */
  heal(
    hp: number | 'full' | undefined,
    mp: number | 'full' | undefined,
    cure: string[] | 'all' | undefined,
    who?: string,
  ): void;
  /** 共通イベントを引く。無ければ null。 */
  common(id: string): EventCommand[] | null;
  /** 逃げ道。TS 側で登録した関数を名前で引く。 */
  script(id: string, args?: Record<string, unknown>): Promise<void>;
}

/**
 * 流れる文字の既定の速さ（1 行ぶんが流れるミリ秒。GS-144）。
 * **1 行が現れる間隔がそのまま読む時間**なので、30 字を超える行があるなら 1.2 秒では追えない。
 * 1800（1 行 1.8 秒）を既定にして、短い行が並ぶエンドロールだけ台帳側で速めている。
 * 遊ぶ人の側は設定の「流れる文字」で 0.5〜4 倍に変えられる。
 */
export const SCROLL_SPEED = 1800;

/** 命令 1 つを動かす関数。 */
type Handler<T extends EventCommand = EventCommand> = (ctx: EventContext, cmd: T) => Promise<void>;

/**
 * 命令の表。**これがイベントエディタに出せる命令の一覧そのもの**。
 * 増やすときはここへ 1 行と、`types.ts` の型に 1 つ足す。
 */
const COMMANDS: { [K in EventCommand['type']]: Handler<Extract<EventCommand, { type: K }>> } = {
  message: async (ctx, cmd) => {
    await ctx.message(cmd.talk, cmd.face, cmd.style);
  },

  scroll: async (ctx, cmd) => {
    await ctx.scroll(cmd.lines, cmd.speed ?? SCROLL_SPEED, cmd.dim ?? 0.5);
  },

  choice: async (ctx, cmd) => {
    if (cmd.prompt) await ctx.message([cmd.prompt]);
    const picked = await ctx.choice(cmd.choices, cmd.cancel);
    const branch = cmd.branches[picked];
    if (branch) await runCommands(branch, ctx);
  },

  wait: async (ctx, cmd) => {
    await ctx.wait(cmd.ms);
  },

  fade: async (ctx, cmd) => {
    await ctx.fade(cmd.to, cmd.ms ?? 400);
  },

  // ここが質問の核心。JSON の `route` を 1 歩ずつ関数呼び出しに変える。
  // `wait: false` なら待たずに次の命令へ進む（歩かせながら喋る、ができる）。
  move: async (ctx, cmd) => {
    const walk = async () => {
      // 道順はゲームが組む（GS-138）。カメラの方位で向きが回るので、
      // 「どの向きに何歩か」はイベントからは決められない。
      for (const dir of ctx.routeTo(cmd.target, cmd.to, cmd.first)) {
        await ctx.step(cmd.target, dir, cmd.speed, cmd.slide);
      }
    };
    if (cmd.wait === false) void walk();
    else await walk();
  },

  turn: async (ctx, cmd) => {
    ctx.turn(cmd.target, cmd.to);
  },

  place: async (ctx, cmd) => {
    ctx.place(cmd.target, cmd.at, cmd.face);
  },

  portrait: async (ctx, cmd) => {
    // 消すときは誰も絵も渡さない。フリーイラスト（GS-142）は台帳を引かずそのまま出す。
    const clear = cmd.hide === true;
    await ctx.portrait({
      slot: cmd.slot,
      id: cmd.id,
      who: clear ? undefined : cmd.who,
      face: cmd.face,
      image: clear ? undefined : cmd.image,
      from: cmd.from,
      flip: cmd.flip,
      ms: cmd.ms,
      instant: cmd.instant,
    });
  },

  imageFx: async (ctx, cmd) => {
    await ctx.imageFx(cmd.id, cmd);
  },

  setSwitch: async (ctx, cmd) => {
    ctx.setSwitch(cmd.key, cmd.value);
  },

  setSelfSwitch: async (ctx, cmd) => {
    ctx.setSelfSwitch(cmd.key, cmd.value);
  },

  setVariable: async (ctx, cmd) => {
    const now = ctx.getVariable(cmd.key);
    const next = cmd.op === 'add' ? now + cmd.value : cmd.op === 'sub' ? now - cmd.value : cmd.value;
    ctx.setVariable(cmd.key, next);
  },

  if: async (ctx, cmd) => {
    const hit =
      // フラグは `is` と突き合わせる（GS-147）。省けば「立っているとき」＝今までどおり。
      'switch' in cmd.when
        ? ctx.getSwitch(cmd.when.switch) === (cmd.when.is ?? true)
        : 'self' in cmd.when
          ? ctx.getSelfSwitch(cmd.when.self) === (cmd.when.is ?? true)
          : 'item' in cmd.when
            ? ctx.countItem(cmd.when.item) >= (cmd.when.count ?? 1)
            : 'gold' in cmd.when
              ? ctx.getGold() >= cmd.when.gold
              : compare(ctx.getVariable(cmd.when.variable), cmd.when.op, cmd.when.value);
    const branch = hit ? cmd.then : cmd.else;
    if (branch) await runCommands(branch, ctx);
  },

  transfer: async (ctx, cmd) => {
    await ctx.transfer(cmd.map, cmd.at, cmd.face, cmd.fade);
  },

  playSe: async (ctx, cmd) => {
    ctx.playSe(cmd.key, cmd.volume);
  },

  playBgm: async (ctx, cmd) => {
    ctx.playBgm(cmd.key, cmd.volume);
  },

  stopBgm: async (ctx, cmd) => {
    ctx.stopBgm(cmd.fade);
  },

  block: async (ctx, cmd) => {
    // `chip` は「全部の面をこれ 1 枚に」の書き方。`faces` があればそちらが勝つ。
    const all =
      cmd.chip === undefined
        ? {}
        : { top: cmd.chip, bottom: cmd.chip, front: cmd.chip, back: cmd.chip, left: cmd.chip, right: cmd.chip };
    ctx.block(cmd.at, { ...all, ...(cmd.faces ?? {}) }, cmd.layer);
  },

  pose: async (ctx, cmd) => {
    ctx.pose(cmd.target, cmd.name);
  },

  getItem: async (ctx, cmd) => {
    ctx.getItem(cmd.id ?? '', cmd.count);
  },

  loseItem: async (ctx, cmd) => {
    ctx.loseItem(cmd.id ?? '', cmd.count);
  },

  // 戦闘（GS-60）。**終わるまで待つ**ので、続きは勝ってから動く。
  battle: async (ctx, cmd) => {
    // 戦闘中のカメラ演出はイベントでは指定しない（GS-98）。戦闘演出の割り当てが決める。
    const outcome = await ctx.battle(cmd.enemies, Boolean(cmd.lose), cmd.formation);
    const branch = outcome === 'win' ? cmd.win : outcome === 'lose' ? cmd.lose : cmd.escape;
    if (branch) await runCommands(branch, ctx);
  },

  // カメラ演出（GS-73）。**既定は待つ**（`move` と同じ約束）。
  shot: async (ctx, cmd) => {
    const ms = ctx.shot(cmd, cmd.release === true);
    if (cmd.wait === false || ms <= 0) return;
    await ctx.wait(ms);
  },

  // 仲間の出入り（GS-70）。
  party: async (ctx, cmd) => {
    ctx.party(cmd.op, cmd.who);
  },

  // 店（GS-66）。**閉じるまで待つ**ので、続きは店を出てから動く。
  shop: async (ctx, cmd) => {
    await ctx.shop(cmd.items, cmd.sell !== false);
  },

  // 所持金（GS-65）。**0 より下へは行かない**——借金の考えを持たない。
  gold: async (ctx, cmd) => {
    const now = ctx.getGold();
    const next = cmd.op === 'set' ? cmd.value : cmd.op === 'sub' ? now - cmd.value : now + cmd.value;
    ctx.setGold(Math.max(0, Math.round(next)));
  },

  // 回復（GS-64）。**戦闘と同じ式**を通るので、宿とアイテムで効き方が食い違わない。
  heal: async (ctx, cmd) => {
    ctx.heal(cmd.hp, cmd.mp, cmd.cure, cmd.who);
  },

  callCommon: async (ctx, cmd) => {
    const list = ctx.common(cmd.id);
    if (list) await runCommands(list, ctx);
  },

  script: async (ctx, cmd) => {
    await ctx.script(cmd.id, cmd.args);
  },
};

function compare(left: number, op: '==' | '!=' | '>=' | '<=' | '>' | '<', right: number): boolean {
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  if (op === '>=') return left >= right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  return left < right;
}

/** 命令の並びを頭から動かす。分岐の中もここへ戻ってくる。 */
export async function runCommands(list: EventCommand[], ctx: EventContext): Promise<void> {
  for (const cmd of list) {
    const run = COMMANDS[cmd.type] as Handler | undefined;
    // 知らない命令は**飛ばす**。古いセーブや新しいデータで止まらないように。
    if (!run) continue;
    await run(ctx, cmd);
  }
}

/**
 * 起動条件を満たすか。スイッチでもセルフスイッチでも書ける（GS-27）。
 * **セルフスイッチを見るときは、そのイベントを動かす前提**——
 * 呼ぶ側が「どのイベントの話か」を `ctx` に伝えてから聞く。
 */
export function canRun(event: EventDef, ctx: EventContext): boolean {
  if (!event.when) return true;
  return event.when.every((cond) => {
    const now = cond.self !== undefined ? ctx.getSelfSwitch(cond.self) : ctx.getSwitch(cond.switch ?? '');
    return now === (cond.is ?? true);
  });
}

/** イベント 1 本を動かす。条件を満たさなければ何もしない。 */
export async function runEvent(event: EventDef, ctx: EventContext): Promise<boolean> {
  if (!canRun(event, ctx)) return false;
  await runCommands(event.commands, ctx);
  return true;
}
