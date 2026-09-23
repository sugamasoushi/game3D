// イベントの実行機（`src/event/interpreter.ts`）に渡す道具立ての実装。
//
// **実行機はここに在るものしか動かせない。** だから「まだ無い機能」は
// 黙って無視せず、印を出して分かるようにしておく（`todo()`）。

import type { EventContext } from '../event/interpreter';
import type { ActorRef, PlaceAt, PlaceAxis, Step } from '../event/types';
import type { GameView, WalkDir } from './GameView';
import { selfKey, switchOn, type GameState } from './state';
import { commonEvent } from './commons';
import { scriptFn } from './scriptBook';
import { itemName, knownItem } from './items';
import { joinParty, leaveParty, memberStats } from './battle/party';
import { applyUse } from './battle/heal';
import { assetUrl } from './assets';
import { playBgm, playSe, stopBgm } from './audio';
import { PORTRAIT_MS, useUi } from '../ui/store';
import { PLAYER_CHARACTER, type CharacterBook } from './characters';

/** 立ち絵の置き場所（GS-20）。絵は `assets/img/CharaStand/<名前>.png`。 */
const STAND_DIR = 'assets/img/CharaStand';
/** 顔アイコンの置き場所（GS-23）。吹き出しの左に出す。 */
const ICON_DIR = 'assets/img/charIcon';
/**
 * 表情を省いたときに使う顔（GS-23）。
 * **会話用の絵（`talk`）があればそちら**——立ち絵は全身とバストアップで別に用意されている。
 */
const DEFAULT_FACES = ['talk', 'normal'];
export type { CharacterBook };

/** 会話が「次へ」を待つための約束。UI 側から `advance()` で解く。 */
interface Waiter {
  advance(): void;
  pick(index: number): void;
}

/** 画面（DOM）と実行機をつなぐ橋。1 本のイベント中ずっと同じものを使う。 */
export interface EventBridge {
  ctx: EventContext;
  /** メッセージを読み終えた合図。ウィンドウのクリック／決定キーから呼ぶ。 */
  advance(): void;
  /** 選択肢を選んだ合図。 */
  pick(index: number): void;
  /**
   * いま動かしているイベントの持ち主（GS-16 / GS-27）。
   * `this` は `npc` を指し、セルフスイッチは `map` と `event` で決まる。
   * **イベントを動かす前に必ず入れる**——条件を見るときにも要る。
   */
  setScene(scene: { npc?: string; map?: string; event?: string; item?: string; num?: number; owner?: string }): void;
}

export interface EventBridgeOptions {
  characters: CharacterBook;
  /** 3D 側。歩かせる・向かせるのに使う。読み込み前は null が返ってよい。 */
  getView(): GameView | null;
  /** 遊んだ記録（GS-27）。スイッチ・変数・セルフスイッチはここに入る。 */
  state: GameState;
  /** マップ移動。マップの読み直しと着地の解き方は画面側が持つ（GS-14 / GS-17）。 */
  transfer(map: string, at: { x: number; y: number; z: number } | null, face?: WalkDir): Promise<void>;
  /**
   * 戦闘を始めて、決着が付くまで待つ（GS-60）。画面（`BattleView`）を出すのは
   * 呼ぶ側の仕事——ここは「始めてくれ」と言うだけ。
   */
  battle(enemies: string[], canLose: boolean, formation?: string): Promise<'win' | 'lose' | 'escape'>;
  /** 店を開いて、閉じるまで待つ（GS-66）。画面を出すのは呼ぶ側。 */
  shop(items: string[], sell: boolean): Promise<void>;
  /** まだ無い機能を踏んだときの知らせ先。 */
  onTodo?(what: string): void;
  /**
   * スイッチ（`setSwitch` / `setSelfSwitch`）が動いた合図（GS-136）。
   * **見た目をその場で合わせるため**——出す条件と、スイッチで変わるコマは記録から導くので、
   * 見張りの周期（100ms）を待つと「開けたのにメッセージのほうが先」に見える。
   */
  onSwitch?(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** イベントの向き（画面基準）はそのまま 3D 側の向きになる。 */
const DIR: Record<Step, WalkDir> = { up: 'up', down: 'down', left: 'left', right: 'right' };

/** 速さの目安。これ以上なら走る。歩き／走りの 2 段だけ持つ。 */
const RUN_SPEED = 6;

/**
 * 行き先の 1 軸を解く（GS-154）。数はそのまま、`"player"` は**プレイヤーと同じ座標**。
 * 自分を動かすときの `"player"` は「その軸は動かさない」になる。
 */
function solveAxis(value: PlaceAxis, from: number | undefined): number {
  return value === 'player' ? (from ?? 0) : value;
}

/** 行き先 3 軸ぶん。`place` と `move`（`routeTo`）で同じ解き方を通す。 */
function solveAt(at: PlaceAt, me: { x: number; y: number; z: number } | null): { x: number; y: number; z: number } {
  return { x: solveAxis(at.x, me?.x), y: solveAxis(at.y, me?.y), z: solveAxis(at.z, me?.z) };
}

export function createEventBridge(options: EventBridgeOptions): EventBridge {
  const ui = useUi.getState;
  let waiter: Waiter | null = null;
  /** `this` が指す相手。話しかけて始まったイベントの持ち主。 */
  let self = '';
  /** いま見ているイベント（セルフスイッチの宛先）。 */
  let sceneMap = '';
  let sceneEvent = '';
  /**
   * 起こしたオブジェクトが持っていた中身（GS-132。マップの `Item` / `Num`）。
   * 宝箱のように**中身だけマップが決める**物のためのもので、無ければ空。
   */
  let sceneItem = '';
  let sceneNum: number | undefined;
  /**
   * 起こした物の名前（GS-134。マップの `Id`）。**覚えの行き先**になる——
   * 同じイベントを何個の宝箱で使っても、`setSelfSwitch` が混ざらない。
   * 物の名前とイベント id がぶつからないよう、頭に `@` を付けて分ける。
   */
  let sceneOwner = '';
  /** 覚えの宛先。物に名前が付いていればそちら、無ければイベント自身。 */
  const selfScope = (): string => (sceneOwner ? `@${sceneOwner}` : sceneEvent);

  /**
   * 持ち物の id を決める（GS-132）。**空ならマップの `Item`**。
   * どちらも無ければ何もしない——知らせだけ出す。黙って通すと「開けたのに増えない」になる。
   */
  const itemOf = (id: string): string => {
    const what = id || sceneItem;
    if (!what) console.warn('[event] 持ち物が決まらない（命令の id も、マップの Item も空）');
    return what;
  };
  /** 個数。書いてあればそれ、無ければマップの `Num`、それも無ければ 1。 */
  const countOf = (count: number | undefined): number => count ?? sceneNum ?? 1;
  /**
   * 文の中の合言葉を差し替える（GS-132）。いまは `{アイテム}` だけ——
   * **中身をマップが決める**物に、名前を書かずに文を書けるようにするためのもの。
   */
  const fill = (text: string): string =>
    sceneItem ? text.replaceAll('{アイテム}', itemName(sceneItem) || sceneItem) : text;

  const todo = (what: string) => {
    options.onTodo?.(what);
    console.warn(`[event] まだ無い機能: ${what}`);
  };

  /**
   * 動かす相手を名前にする。プレイヤーなら null。
   * `this` はイベントの持ち主——誰の物か分からなければ動かさない。
   */
  const actorId = (target: ActorRef): string | null => {
    if (target === 'player') return null;
    if (target === 'this') return self || null;
    return target.slice('npc:'.length) || null;
  };

  /** 話者キー → 名前。`characterdata.json` を引く（無ければキーをそのまま出す）。 */
  const nameOf = (who?: string): string => {
    if (!who) return '';
    const entry = options.characters[who];
    if (entry && typeof entry === 'object' && typeof entry.name === 'string') return entry.name;
    return who;
  };

  /** 話者キー → `characterdata.json` の 1 人ぶん（字引きしやすい形で）。 */
  const bookOf = (who?: string): Record<string, unknown> | null => {
    if (!who) return null;
    const entry = options.characters[who];
    return entry && typeof entry === 'object' ? (entry as unknown as Record<string, unknown>) : null;
  };

  /** 顔アイコンの URL（GS-23）。無い人は絵なしで出す。 */
  const iconOf = (who?: string): string | undefined => {
    const icon = bookOf(who)?.icon;
    return typeof icon === 'string' && icon ? assetUrl(`${ICON_DIR}/${icon}.png`) : undefined;
  };

  /**
   * 吹き出しを誰の頭の上に出すか（GS-23）。
   * 主人公が喋っていればプレイヤー、それ以外は**話しかけた相手**。
   * 話し相手が分からない場面（`this` が無い）は吹き出しにできないので、下のウィンドウへ落とす。
   */
  const bubbleAnchor = (who?: string): string => {
    if (who === PLAYER_CHARACTER) return 'player';
    return self || '';
  };

  /** 1 メッセージ出して、読み終わるまで待つ。 */
  const showTalk = (name: string, lines: string[], bubble?: string, icon?: string) =>
    new Promise<void>((resolve) => {
      ui().setTalk({ name, lines, bubble, icon });
      waiter = {
        advance() {
          waiter = null;
          resolve();
        },
        pick() {
          /* 選択肢ではない */
        },
      };
    });

  const ctx: EventContext = {
    async message(talk, _face, style) {
      for (const line of talk) {
        // 吹き出しは喋る人の頭の上（GS-23）。相手が分からなければウィンドウで出す。
        const anchor = style === 'bubble' ? bubbleAnchor(line.who) : '';
        await showTalk(nameOf(line.who), line.lines.map(fill), anchor || undefined, anchor ? iconOf(line.who) : undefined);
      }
      ui().setTalk(null);
    },

    scroll(lines, speed, dim) {
      return new Promise<void>((resolve) => {
        ui().setScroll({ lines, speed, dim });
        waiter = {
          advance() {
            waiter = null;
            ui().setScroll(null);
            resolve();
          },
          pick() {
            /* 選択肢ではない */
          },
        };
      });
    },

    choice(choices) {
      return new Promise<number>((resolve) => {
        ui().setChoices(choices);
        waiter = {
          advance() {
            /* 選ぶまでは進まない */
          },
          pick(index) {
            waiter = null;
            ui().setChoices(null);
            resolve(index);
          },
        };
      });
    },

    async step(target: ActorRef, dir: Step, speed?: number, slide?: boolean) {
      const view = options.getView();
      if (!view) return;
      const run = (speed ?? 0) >= RUN_SPEED;
      const id = actorId(target);
      if (id === null) {
        await (target === 'player' ? view.walk(DIR[dir], run, slide) : Promise.resolve(false));
        if (target !== 'player') todo(`歩く（${target}）——誰を指すか決まらない`);
        return;
      }
      // 居ない相手でもイベントは止めない（ビュー側が印を出す）。
      await view.walkNpc(id, DIR[dir], run, slide);
    },

    turn(target, dir) {
      const view = options.getView();
      if (!view) return;
      const id = actorId(target);
      if (id === null) {
        if (target === 'player') view.face(DIR[dir]);
        else todo(`向く（${target}）——誰を指すか決まらない`);
        return;
      }
      view.faceNpc(id, DIR[dir]);
    },

    /**
     * 置き直す（GS-137）。**プレイヤーは受けない**——立ち位置を飛ばすのはマップ移動の仕事で、
     * 同じマップの中で瞬間移動させると、追うカメラと記録（`transfer`）の辻褄が合わなくなる。
     */
    place(target, at, face) {
      const view = options.getView();
      if (!view) return;
      const id = actorId(target);
      if (id === null) {
        todo(`置き直す（${target}）——${target === 'player' ? 'プレイヤーはマップ移動で動かす' : '誰を指すか決まらない'}`);
        return;
      }
      const spot = solveAt(at, view.playerAt());
      view.placeNpc(id, spot.x, spot.y, spot.z, face ? DIR[face] : undefined);
    },

    /** 行き先までの道順（GS-138）。**いまどこに立っているか**から組むので、途中で呼び直せば組み直る。 */
    routeTo(target, at, first) {
      const view = options.getView();
      if (!view) return [];
      const id = actorId(target);
      const now = id === null ? (target === 'player' ? view.playerAt() : null) : view.npcAt(id);
      if (!now) {
        todo(`行き先まで歩く（${target}）——誰を指すか決まらない`);
        return [];
      }
      // 行き先も `place` と同じ書き方（GS-154）。
      // 自分を動かすときの `"player"` は「その軸は動かさない」になる。
      return view.routeTo(now, solveAt(at, view.playerAt()), first);
    },

    async portrait(spec) {
      const { slot, who, face, image, from, flip, ms } = spec;
      // このイベントの中での名前（GS-143）。付けなければ**画面位置がそのまま名前**になるので、
      // 今までの書き方（左の絵・右の絵）はそのまま通る。
      const id = spec.id || slot;
      // 入り方。書かなければ**置いた側から**滑り込む（左の絵は左から）。
      // `instant` は昔の書き方——滑らせない、と同じ意味。
      const side = spec.instant ? 'none' : (from ?? (slot === 'right' ? 'right' : 'left'));
      const show = (file: string) =>
        ui().showPortrait({ id, slot, src: assetUrl(`${STAND_DIR}/${file}.png`), from: side, flip, ms });
      // フリーイラスト（GS-142）。**台帳を引かない**——人に結び付かない一枚絵を名前で直に出す。
      // 名前を間違えても絵が出ないだけなので、届かなかったことは画面側（`img` の読み込み）に任せる。
      if (image) {
        show(image);
        return;
      }
      // 名前が無ければその絵を引っ込める（`hide` もここへ来る）。
      if (!who) {
        ui().hidePortrait(id, spec.instant ? 'none' : undefined);
        return;
      }
      const book = bookOf(who);
      // 表情は `characterdata.json` のキー（normal / smile / unger）。
      // **空欄は「その表情は無い」**ので、既定の顔へ落とす——絵が消えるより分かりやすい。
      const picked = face ? book?.[face] : undefined;
      // 表情を書かなければ会話用（`talk`）→ 立ち絵（`normal`）の順に落とす。
      const fallback = DEFAULT_FACES.map((key) => book?.[key]).find((value) => typeof value === 'string' && value);
      const name = typeof picked === 'string' && picked ? picked : ((fallback as string) ?? '');
      if (!name) {
        todo(`キャライラスト（${who} / ${face ?? '既定'}）——${who} の絵が characterdata.json に無い`);
        return;
      }
      show(name);
    },

    /**
     * 出ている絵に効果をかける（GS-143）。**名前で指す**ので、同じ場所に重ねた絵も 1 枚ずつ動かせる。
     * 既定では動き終わるまで待つ——待たないと、次のせりふが効果の途中で出る。
     */
    async imageFx(id, fx) {
      const ms = fx.ms ?? PORTRAIT_MS;
      const known = ui().portraits.some((entry) => entry.id === id);
      if (!known) {
        // 出ていない絵を指したら知らせる。黙って通すと「効かない」だけで理由が分からない。
        todo(`イラスト効果（${id}）——その名前の絵は出ていない`);
        return;
      }
      if (fx.kind === 'out') ui().hidePortrait(id, fx.to);
      else if (fx.kind === 'fade') ui().fxPortrait(id, { opacity: Math.min(1, Math.max(0, fx.opacity ?? 0)), ms });
      // 大きさは**効果でだけ変える**（GS-145）。素の大きさは画面側が決めているので触らない。
      else if (fx.kind === 'zoom') ui().fxPortrait(id, { scale: Math.min(8, Math.max(0.1, fx.scale ?? 1)), ms });
      else ui().fxPortrait(id, { shake: Math.max(0, fx.power ?? 8), ms });
      if (fx.wait === false) return;
      await sleep(ms);
      // 揺れは**かけっぱなしにしない**。終わったら止めて、元の場所へ戻す。
      if (fx.kind === 'shake') ui().fxPortrait(id, { shake: 0, ms: 0 });
    },

    async fade(to, ms) {
      // 暗さは CSS の遷移に任せる。ここでは値と時間を置いて、同じだけ待つ。
      ui().setFade(to === 'out' ? 1 : 0, ms);
      await sleep(ms);
    },

    wait: (ms) => sleep(ms),

    async transfer(map, at, face) {
      // 暗転は入れない。入れるならイベント側に `fade` を書く（見え方を data で決める）。
      await options.transfer(map, at, face && DIR[face]);
    },

    // 音は台帳（`sounds.json`）を引く（GS-21）。知らない名前は `audio.ts` が印を出す。
    playSe: (key, volume) => playSe(key, volume ?? 1),
    playBgm: (key, volume) => playBgm(key, volume ?? 1),
    stopBgm: (fade) => stopBgm(fade ?? 0),

    // 書いていないフラグは**まだ動ける**（GS-147）。旧作と同じ向き。
    getSwitch: (key) => switchOn(options.state, key),
    setSwitch: (key, value) => {
      options.state.switches.set(key, value);
      options.onSwitch?.();
    },
    // セルフスイッチは**そのイベントの覚え**（GS-27）。宛先が無いときは false のまま。
    getSelfSwitch: (key) =>
      selfScope() ? (options.state.self.get(selfKey(sceneMap, selfScope(), key)) ?? false) : false,
    setSelfSwitch: (key, value) => {
      if (!selfScope()) {
        todo(`セルフスイッチ（${key}）——どのイベントの話か決まっていない`);
        return;
      }
      options.state.self.set(selfKey(sceneMap, selfScope(), key), value);
      options.onSwitch?.();
    },
    getVariable: (key) => options.state.variables.get(key) ?? 0,
    setVariable: (key, value) => {
      options.state.variables.set(key, value);
    },

    /**
     * マスの絵（GS-53）。**空振りは黙って通さない**——座標を 1 つ間違えただけで
     * 「変わらない」だけの結果になり、原因を探せなくなる。
     */
    block: (at, faces, layer) => {
      const view = options.getView();
      if (!view) return false;
      const ok = view.setCellChip(at, faces, layer);
      if (!ok) console.warn('[event] そのマスに差し替えられるブロックがありません: ' + JSON.stringify(at));
      return ok;
    },

    /**
     * 静止コマ（GS-47）。**知らない名前は黙って通さない**——絵が変わらない理由が
     * 分からなくなるので、台帳に無ければコンソールに出す。
     */
    pose: (target, name) => {
      const view = options.getView();
      if (!view) return false;
      const id = actorId(target);
      const ok = id === null ? view.posePlayer(name) : view.poseNpc(id, name);
      if (!ok) console.warn('[event] その姿は台帳にありません: ' + target + ' / ' + name);
      return ok;
    },

    /**
     * 持ち物（GS-46）。**0 個になったら消す**——「0 個持っている」を記録に残さない。
     * 台帳に無い id でも受ける（台帳から消しただけで持ち物が飛ぶと、記録が読めなくなる）。
     */
    countItem: (id) => options.state.items.get(id) ?? 0,
    getItem: (id, count) => {
      const what = itemOf(id);
      if (!what) return;
      const next = (options.state.items.get(what) ?? 0) + Math.max(0, Math.trunc(countOf(count)));
      if (next > 0) options.state.items.set(what, next);
      if (!knownItem(what)) console.warn('[event] 台帳に無い持ち物: ' + what);
    },
    loseItem: (id, count) => {
      const what = itemOf(id);
      if (!what) return;
      const next = (options.state.items.get(what) ?? 0) - Math.max(0, Math.trunc(countOf(count)));
      if (next > 0) options.state.items.set(what, next);
      else options.state.items.delete(what);
    },

    /** カメラ演出（GS-73）。3D 側が持つ——絵の話なのでビューの仕事。 */
    shot(shot, release) {
      const view = options.getView();
      if (!view) return 0;
      if (release) {
        view.releaseShot();
        return 0;
      }
      if (shot.id) return view.playCameraCue(shot.id);
      // 種類を書かなければ光らせる（いちばん使う物を既定にする）。
      return view.playShot({ ...shot, kind: shot.kind ?? 'flash' });
    },

    /** 仲間の出入り（GS-70）。台帳に居ない人は入らない（`party.ts` が印を出す）。 */
    party: (op, who) => {
      if (op === 'join') joinParty(options.state, who);
      else leaveParty(options.state, who);
    },

    /** 店（GS-66）。閉じるまで返らない。 */
    shop: (items, sell) => options.shop(items, sell),

    /** 所持金（GS-65）。**器はセーブが持つ**ので、ここは読み書きするだけ。 */
    getGold: () => options.state.gold,
    setGold: (value) => {
      options.state.gold = Math.max(0, Math.round(value));
    },

    /**
     * 回復（GS-64）。**アイテムと同じ式**（`applyUse`）を通す。
     * 満タンの値はレベルで変わるので、そのつど台帳から出す（GS-63）。
     */
    heal(hp, mp, cure, who) {
      const state = options.state;
      const targets = who ? [who] : state.party;
      for (const one of targets) {
        const now = state.members.get(one);
        if (!now) continue;
        // `"all"` はいまかかっている物ぜんぶ（GS-71）。宿はこれ。
        const list = cure === 'all' ? now.ailments.slice() : cure;
        applyUse(now, memberStats(one, now.level), { hp, mp, cure: list });
      }
    },

    /** 戦闘（GS-60）。決着が付くまで返らない。 */
    battle: (enemies, canLose, formation) => options.battle(enemies, canLose ?? false, formation),

    /**
     * 共通イベント（GS-44）。台帳（`data/commonEvents.json`）から名前で引く。
     * **無ければ黙らずに知らせる**——呼んだのに動かない理由が分からなくなる。
     */
    common: (id) => {
      const list = commonEvent(id);
      if (!list) console.warn('[event] 共通イベントが見つかりません: ' + id);
      return list;
    },

    /**
     * 逃げ道（GS-45）。**登録してある関数だけ**を名前で呼ぶ。JSON にコードは入らない。
     * 無ければ共通イベントと同じで、止めずに知らせる——書き間違い 1 つで先へ進めなくなるより、
     * 何も起きないことに気づけるほうがよい。
     */
    async script(id, args) {
      const fn = scriptFn(id);
      if (!fn) {
        console.warn('[event] script が登録されていません: ' + id);
        return;
      }
      await fn(args ?? {}, ctx);
    },
  };

  return {
    ctx,
    advance: () => waiter?.advance(),
    pick: (index) => waiter?.pick(index),
    setScene: (scene) => {
      self = scene.npc ?? '';
      sceneMap = scene.map ?? '';
      sceneEvent = scene.event ?? '';
      sceneItem = scene.item ?? '';
      sceneNum = scene.num;
      sceneOwner = scene.owner ?? '';
    },
  };
}
