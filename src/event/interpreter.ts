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
  /**
   * 会話を出して、読み終わるまで待つ。`style` で吹き出しにできる（GS-23）。
   * `hold`（ミリ秒）を渡すと、**文字が出そろってからその時間で勝手に送る**（GS-172）。
   */
  message(talk: { who?: string; lines: string[] }[], face?: string, style?: TalkStyle, hold?: number): Promise<void>;
  /** 流れる文字。読み終わる（か飛ばされる）まで待つ。`speed` は 1 行ぶんの時間（GS-144）。 */
  scroll(lines: string[], speed: number, dim: number): Promise<void>;
  /**
   * テロップ（GS-171）。**画面を黒で覆って真ん中に一言**出し、薄れて消えるまで待つ。
   * `click` が偽なら押しても消えず、`hold`（ミリ秒）が経つと消え始める（GS-172）。
   */
  telop(lines: string[], look: { ms: number; dim: number; size?: number; click: boolean; hold?: number }): Promise<void>;
  /** 選択肢を出して、選ばれた番号を返す。 */
  choice(choices: string[], cancel?: number): Promise<number>;
  /** 1 マス歩く。歩き終わったら返る。`slide` は向きも足も動かさずに運ぶ（GS-155）。 */
  step(target: ActorRef, dir: Step, speed?: number, slide?: boolean): Promise<void>;
  /** 向きだけ変える。 */
  turn(target: ActorRef, dir: Step): void;
  /**
   * その場で足踏み（GS-168）。**進まない。** `dir` を省くと今の向きのまま踏む。
   * 踏み終わったら返る。居ない相手なら何もしない。
   */
  stepInPlace(target: ActorRef, dir: Step | undefined, steps: number, run: boolean): Promise<void>;
  /**
   * 足踏みを**止めるまで続ける**（GS-169）。数を数えないので**すぐ返る**。
   * 止めるのは `stopStepInPlace`（かイベントの終わり・マップの読み直し）。
   */
  keepStepInPlace(target: ActorRef, dir: Step | undefined, run: boolean): void;
  /** 足踏みを止める（GS-169）。踏んでいなければ何もしない。 */
  stopStepInPlace(target: ActorRef): void;
  /**
   * その場に置き直す（GS-137 / GS-163）。歩かず一瞬で移す。居ない相手なら何もしない。
   * **プレイヤーも受ける。** 軸に `"player"` と書けば**主人公と同じ座標**（GS-154）
   * ——プレイヤー自身を置くときは「その軸は動かさない」の意味になる。解くのは実行機側。
   */
  place(target: ActorRef, at: PlaceAt, face?: Step): void;
  /**
   * カメラが主人公を追うかどうか（GS-166）。**その時点から効く。**
   * 戻すのは `on: true` の書き直しか、イベントの終わり（マップの読み直しでも戻る）。
   */
  cameraFollow(on: boolean): void;
  /**
   * 消す（GS-157）。**その場ですぐ居なくなる。** `remember` が真なら、
   * そのキャラ自身の覚えに残してマップを読み直しても出さない。居ない相手なら何もしない。
   */
  hide(target: ActorRef, remember: boolean): void;
  /**
   * いま向いている方（GS-158）。**前後左右で歩かせる**ときだけ使う。
   * 居ない相手なら null。
   */
  facingOf(target: ActorRef): Step | null;
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
    /** 置き場所からのずれ（GS-170）。画面の幅・高さに対する％。 */
    x?: number;
    y?: number;
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

/**
 * テロップが消えるのにかける既定の時間（ミリ秒。GS-171）。
 * 旧作の「━ 翌朝 ━」と同じ 800ms——これより速いと場面が切り替わった感じが出ない。
 */
export const TELOP_MS = 800;

/**
 * 押さずに消すときの、出しておく時間（ミリ秒。GS-172）。
 * 旧作の「1 秒置いてから薄める」に合わせた。
 */
export const TELOP_HOLD = 1000;

/** 命令 1 つを動かす関数。 */
type Handler<T extends EventCommand = EventCommand> = (ctx: EventContext, cmd: T) => Promise<void>;

/** 画面の向きを時計回りに並べたもの（GS-158）。前後左右を解くのに使う。 */
const CLOCK: Step[] = ['up', 'right', 'down', 'left'];

/**
 * 向いている方から見た前後左右 → 画面の向き（GS-158）。
 * `up` が前、`right` がその人の右、`down` が後ろ、`left` が左。
 * 下を向いて立っている人の「前」は画面の下、というふうに回す。
 */
const turnFrom = (facing: Step, relative: Step): Step =>
  CLOCK[(CLOCK.indexOf(facing) + CLOCK.indexOf(relative)) % 4];

/**
 * 命令の表。**これがイベントエディタに出せる命令の一覧そのもの**。
 * 増やすときはここへ 1 行と、`types.ts` の型に 1 つ足す。
 */
const COMMANDS: { [K in EventCommand['type']]: Handler<Extract<EventCommand, { type: K }>> } = {
  message: async (ctx, cmd) => {
    await ctx.message(cmd.talk, cmd.face, cmd.style, cmd.hold);
  },

  scroll: async (ctx, cmd) => {
    await ctx.scroll(cmd.lines, cmd.speed ?? SCROLL_SPEED, cmd.dim ?? 0.5);
  },

  // テロップ（GS-171）。**押されるまで出したまま**、薄れ切ってから次へ。
  // 既定は旧作と同じ（真っ黒・800ms で薄れる）。
  telop: async (ctx, cmd) => {
    const click = cmd.click !== false;
    await ctx.telop(cmd.lines, {
      ms: cmd.ms ?? TELOP_MS,
      dim: cmd.dim ?? 1,
      size: cmd.size,
      click,
      // **押せないなら必ず時間で消す**（GS-172）。どちらも無いと、そこで話が止まる。
      hold: cmd.hold ?? (click ? undefined : TELOP_HOLD),
    });
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
    // **歩く前に道順を決める**（GS-158）。向きと歩数で書いた形は、
    // 進む方を向いてしまう前に 1 度だけ解く——でないと「後ろへ 3 マス」が折り返す。
    const route: Step[] = cmd.dir
      ? new Array(Math.max(1, Math.trunc(cmd.cells ?? 1))).fill(
          cmd.relative ? turnFrom(ctx.facingOf(cmd.target) ?? 'down', cmd.dir) : cmd.dir,
        )
      : // 道順はゲームが組む（GS-138）。カメラの方位で向きが回るので、
        // 「どの向きに何歩か」はイベントからは決められない。
        ctx.routeTo(cmd.target, cmd.to, cmd.first);
    const walk = async () => {
      for (const dir of route) {
        await ctx.step(cmd.target, dir, cmd.speed, cmd.slide);
      }
    };
    if (cmd.wait === false) void walk();
    else await walk();
  },

  turn: async (ctx, cmd) => {
    ctx.turn(cmd.target, cmd.to);
  },

  // その場で足踏み（GS-168）。既定は 4 歩、踏み終わるまで待つ。
  stepInPlace: async (ctx, cmd) => {
    // 止める（GS-169）。**歩数より先に見る**——「止める」に歩数が残っていても止まる。
    if (cmd.stop === true) {
      ctx.stopStepInPlace(cmd.target);
      return;
    }
    // ずっと踏む（GS-169）。終わりが無いので**待たない**。
    if (cmd.always === true) {
      ctx.keepStepInPlace(cmd.target, cmd.dir, cmd.run === true);
      return;
    }
    const march = ctx.stepInPlace(cmd.target, cmd.dir, Math.max(1, Math.trunc(cmd.steps ?? 4)), cmd.run === true);
    if (cmd.wait === false) void march;
    else await march;
  },

  place: async (ctx, cmd) => {
    ctx.place(cmd.target, cmd.at, cmd.face);
  },

  // カメラ追従（GS-166）。**書いた所だけが効く**——切ったら戻すまで画面は止まったまま。
  cameraFollow: async (ctx, cmd) => {
    ctx.cameraFollow(cmd.on);
  },

  // 消す（GS-157）。**覚えるのが既定**——見送った鶏が入り直すと戻っていたら話が合わない。
  hide: async (ctx, cmd) => {
    ctx.hide(cmd.target, cmd.remember ?? true);
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
      x: cmd.x,
      y: cmd.y,
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
