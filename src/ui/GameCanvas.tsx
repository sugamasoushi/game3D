'use client';

// canvas と 3D の境界。**3D は React の再描画に巻き込まない**（構想 §5.3）。
// React が持つのは会話・選択肢・暗さだけ（`store.ts`）。
// イベントの起動（どこに立ったら何が動くか）もここが受け持つ（GS-14）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { createGameView, STAGE_COMMAND_FIGURE, type GameStatus, type GameView, type WalkDir } from '../game/GameView';
import { START_MAP, assetUrl, mapUrl } from '../game/assets';
import { mapEntryOf, entryForFile } from '../game/mapIndex';
import { loadFileIndex } from '../game/fileIndex';
import { loadCommonBook } from '../game/commons';
import { loadItemBook } from '../game/items';
import { characterName, loadCharacterBook } from '../game/characters';
import { loadIllustrations } from '../game/illustrations';
import { startGamepad } from '../game/gamepad';
import { chooseBattleFormation, loadBattleBook, previewEffects, type EffectDef, type EffectEntry } from '../game/battle/book';
import { BATTLE_START_CAMERA } from '../game/battle/battleCamera';
import { battleSettings } from '../game/battle/settings';
import {
  // [凍結 BPE-15] 戦闘演出エディタのカメラ割り当て。再開するときに戻す。
  // battlePresentationBinding,
  // loadBattlePresentation,
  // previewBattlePresentation,
  // type BattlePresentationBook,
  type BattlePresentationContext,
  type BattlePresentationHook,
} from '../game/battle/presentation';
import { ensureParty, joinParty, resetParty, revive } from '../game/battle/party';
import * as dev from '../game/devMode';
import { DEV_MODE, loadDevOptions } from '../game/devMode';
import { previewCameraCues, type CameraCueBook } from '../game/cameraCues';
import { GameOver, type BattleOutcome } from '../game/battle/flow';
import { createWalkAilments } from '../game/battle/walkAilment';
import { ailmentDef } from '../game/battle/book';
import { equipItem, memberStats, moveMember, unequipItem } from '../game/battle/party';
import { applyUse, healLine, wouldHelp } from '../game/battle/heal';
import { itemName, itemPrice, itemSellPrice, itemUse } from '../game/items';
import { ShopScreen } from './shop/ShopScreen';
import { BattleView, type BattleStage } from './battle/BattleView';
import * as audio from '../game/audio';
import * as gameOptions from '../game/options';
import { applyMapSound, loadSoundBook, unlockAudio } from '../game/audio';
import { createEventBridge, type EventBridge } from '../game/uiEventContext';
import { readEventSpots, spotAhead, spotUnder, type EventSpot, type Landing } from '../game/eventSpots';
import { readNpcs, npcShown, type NpcDef } from '../game/npcs';
import { CHEST_OPENED, chestOf, drawChest, loadChestBook } from '../game/chests';
import { canRun, runCommands } from '../event/interpreter';
import type { EventCommand, EventDef, EventFile } from '../event/types';
import type { MapDef } from '../mep3d/types';
import { MessageWindow } from './MessageWindow';
import { VirtualPad } from './VirtualPad';
import { TalkMarks, type TalkMark } from './TalkMarks';
import { Menu } from './menu/Menu';
import { CameraIllustrationLayer } from './CameraIllustrationLayer';
import { SettingsMenu } from './SettingsMenu';
import { TitleScreen } from './TitleScreen';
import { fromSave, newState, selfKey, spendItem, switchOn, toSave, type GameState } from '../game/state';
import { AUTO_SLOT, readSave, writeSave } from '../game/save';
import { canWalk, useUi } from './store';

/** 決定キー。会話ウィンドウと同じ割り当て。 */
const DECIDE = ['Enter', 'Space', 'KeyZ'];
/**
 * 調べ物に手が届く距離（マス。GS-55）。**体の中心から**これだけ先までを見る。
 * 1.25 マスは「目の前のマスの向こう端まで」——旧作の 40px と同じ届き方で、
 * 壁ぎわに立ったときも、マスの真ん中に立ったときも、目の前の物に届く。
 */
const EXAMINE_REACH = 1.25;

/** 起動場所を見に行く間隔（ミリ秒）。毎フレーム見る必要はない。 */
const WATCH_MS = 100;
/** 話せる合図を出す距離（マス。GS-49）。少し手前から見せて「近づけば話せる」と伝える。 */
const TALK_MARK_SHOW = 3.5;
/** 合図の動きを止める距離（マス）。話しかけが届く範囲（1.4）に少し余裕を足したもの。 */
const TALK_MARK_NEAR = 1.6;
/** 入口をくぐるときの暗転（ミリ秒）。CSS の `.fade` の遷移と同じ長さにする。 */
const DOOR_FADE_MS = 400;
/** マップ名（`home.json` → `home`）。 */
const mapKey = (file: string) => file.replace(/\.json$/i, '');
/** 画面に出るのを待つ（GS-28）。React が描いた次の frame まで。 */
const painted = () =>
  new Promise<void>((done) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => done()));
  });
/**
 * 敵シンボルに触ったと見なす距離（マス。GS-76）。
 * 話しかけの届く範囲（1.4）より**少し短く**——すれ違いで戦闘が始まらないように。
 */
const SYMBOL_REACH = 0.9;
/** 歩いているあいだの毒の札を出しておく時間（ミリ秒。GS-71）。 */
const WALK_NOTE_MS = 2200;
/** 戦いの曲（GS-62）。`data/sounds.json` のキー。 */
// 戦闘の曲は戦闘共通の台帳（`battleSettings.json`。GS-106）が持つ。
/** デバッグの戦闘（GS-91）。味方はこの順に足して 3 人、敵は 3 体。 */
const DEBUG_PARTY = ['meina', 'lamy', 'grandpa'];
const DEBUG_ENEMIES = ['enemy02', 'enemy00', 'enemy01'];
/** ゲームオーバーで黒くなるまで（ミリ秒）。**ゆっくり**——負けたことを飲み込む間を置く。 */
const GAME_OVER_FADE_MS = 1600;
/** 遊んだ秒を数える間隔（ミリ秒）。 */
const CLOCK_MS = 1000;
/** セーブに書くマップ番号。台帳の番号が分からなければファイル名。 */
const mapNumber = (file: string) => file.replace(/\.json$/i, '').split('_')[0];

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GameView | null>(null);
  const cameraIllustrations = useCallback(() => viewRef.current?.cameraIllustrations() ?? [], []);
  const cameraPreviewRef = useRef(false);
  const bridgeRef = useRef<EventBridge | null>(null);
  const [notice, setNotice] = useState('');
  /** 遊んだ記録（GS-27）。セーブに入るものはこの 1 つに集める。 */
  const stateRef = useRef<GameState>(newState());
  const phase = useUi((s) => s.phase);
  const menu = useUi((s) => s.menu);
  /** イベントの最中か。デバッグの戦闘ボタンはこのあいだ出さない（GS-91）。 */
  const uiBusy = useUi((s) => s.busy);
  const settings = useUi((s) => s.settings);

  /** 今のマップの起動場所とイベント。マップが変わるたび読み直す。 */
  const spotsRef = useRef<EventSpot[]>([]);
  const eventsRef = useRef<Map<string, EventDef>>(new Map());
  /** NPC の名前 → 話しかけたときのイベント id（GS-16）。 */
  const npcTalkRef = useRef<Map<string, string>>(new Map());
  /**
   * 人ではなく**物**（GS-136。`SPRITE` レイヤーに置いたもの。宝箱・立て札など）。
   * 「話せるよ」の合図は出さない——**物は話し相手ではない**ので、頭の上に吹き出しが
   * 浮くと人のように見えてしまう。調べられること自体は変わらない。
   */
  const npcThingRef = useRef<Set<string>>(new Set());
  /** いま立っている起動場所。**出るまで二度と起こさない**ための控え。 */
  const steppingRef = useRef('');
  const mapRef = useRef('');
  /**
   * いまのマップの戦闘背景（GS-79）。`battlefields.json` のキー。
   * **空なら既定の2D背景 hill**。BattleStage=true の点がある場合は3D舞台が優先される。
   * 戦闘が始まってから引きに行くと、絵が出るまで一瞬 3D が見えてしまう。
   */
  const battleFieldRef = useRef('');
  /** マップの読み直しを外の効果からも呼べるようにしておく。 */
  const adoptRef = useRef<(file: string) => Promise<void>>(async () => {});
  /**
   * オートセーブ（GS-33）。書くのは**入口をくぐって着いた所**だけ。
   * 着いた先でイベントが始まっていることがあるので、いったん札を立てて、
   * 手が空いてから書く（`autoSaveRef` は下で本体を入れる）。
   */
  const autoPendingRef = useRef(false);
  const autoSaveRef = useRef<() => void>(() => {});

  /**
   * 戦闘（GS-60）。**始めた人へ結果を返す**ための約束を握っておく。
   * 面子や HP はここに置かない——`BattleView` が `Fighter` を持ち、終わりに記録へ書き戻す。
   */
  const battleEndRef = useRef<((outcome: BattleOutcome) => void) | null>(null);
  /** デバッグ画面からの強制終了で、戦闘内部の待機や入力待ちも止める。 */
  const battleAbortRef = useRef<AbortController | null>(null);
  /** 今回の戦闘開始時に解決した隊形。イベント指定またはマップ候補から選ぶ。 */
  const battleFormationRef = useRef<string | undefined>(undefined);
  /**
   * 3D の舞台（GS-87）。戦闘画面から `GameView` の舞台を動かす口。
   * プレイヤーは動かさない——舞台はプレイヤーを隠して別の場所を写すだけなので、戻す手間が要らない。
   */
  const battleStageRef = useRef<BattleStage>({
    spec: () => viewRef.current?.battleStage(battleFormationRef.current) ?? null,
    show: (spec, figures) => {
      viewRef.current?.stageBattle(spec, figures);
    },
    hide: () => viewRef.current?.unstageBattle(),
    rect: (id) => viewRef.current?.figureRect(id) ?? null,
    pose: (id, pose) => viewRef.current?.figurePose(id, pose),
  });
  const battle = useUi((s) => s.battle);
  /**
   * 戦闘画面の契機の受け口。攻撃アクション等のアニメーション演出の契機に使う（Battle Presentation Editor BPE-14）。
   * カメラ演出の割り当ては凍結した。**戦闘開始だけはコードの値でカメラを動かす**（`BATTLE_START_CAMERA`。GS-104）——
   * カメラエディタの台帳（イベント用）は引かない。
   */
  const presentBattle = useCallback((hook: BattlePresentationHook, context: BattlePresentationContext = {}) => {
    window.dispatchEvent(new CustomEvent('battle-presentation', { detail: { hook, key: hook, cue: '', subject: context.subject ?? '' } }));
    if (hook === 'battle.start') {
      try {
        return viewRef.current?.playBattleCamera(BATTLE_START_CAMERA) ?? 0;
      } catch (error) {
        console.warn(`[battle-presentation] ${hook}:`, error);
        return 0;
      }
    }
    // [凍結 BPE-15] 戦闘演出エディタのカメラ割り当て。台帳の演出IDを引いてカメラ演出を再生していた。
    // const { key, cue } = battlePresentationBinding(hook, context.slot);
    // window.dispatchEvent(new CustomEvent('battle-presentation', { detail: { hook, key, cue, subject: context.subject ?? '' } }));
    // if (!cue) return 0;
    // try {
    //   return viewRef.current?.playCameraCue(cue, context.subject) ?? 0;
    // } catch (error) {
    //   console.warn(`[battle-presentation] ${hook}:`, error);
    //   return 0;
    // }
    return 0;
  }, []);

  /**
   * 戦闘を始めて、決着が付くまで待つ（GS-60）。
   * `canLose` は「負けても話が続くか」——`battle` 命令に `lose` の枝が書いてあるか。
   * **書いていなければ負け＝ゲームオーバー**で、`GameOver` を投げてイベントを止める。
   */
  const startBattle = useCallback(
    async (enemies: string[], canLose: boolean, formation?: string) => {
      // [凍結 BPE-15] 戦闘演出エディタのカメラ割り当て台帳は読まない。
      // await Promise.all([loadBattlePresentation(), loadBattleBook()]);
      await loadBattleBook();
      const mapEntry = await entryForFile(mapRef.current);
      battleFormationRef.current = chooseBattleFormation(formation, mapEntry?.battleStage?.formations);
      if (formation && battleFormationRef.current !== formation) {
        console.warn(`[battle-formation] 指定された隊形がありません: ${formation}`);
      }
      return new Promise<BattleOutcome>((resolve, reject) => {
        battleAbortRef.current = new AbortController();
        // 敵が 1 体も居なければ戦わない（台帳に無い id だけを書いたとき）。
        if (enemies.length === 0) {
          console.warn('[battle] 敵が指定されていません');
          resolve('win');
          return;
        }
        // 戦いの曲へ（GS-62）。**環境音は止める**——滝の音の上で戦うと落ち着かない（旧作も同じ）。
        audio.playBgm(battleSettings().bgm);
        audio.stopBgs(400);
        battleEndRef.current = (outcome) => {
          if (outcome === 'lose' && !canLose) {
            gameOverRef.current();
            reject(new GameOver());
            return;
          }
          // 負けても話が続くとき（`lose` の枝）は**倒れた人を起こす**——
          // 倒れたまま歩くと、次の出会い頭で必ず負けて抜け出せなくなる。
          if (outcome === 'lose') revive(stateRef.current);
          resolve(outcome);
        };
        useUi.getState().setBattle(enemies);
      });
    },
    [],
  );
  const startBattleRef = useRef(startBattle);
  startBattleRef.current = startBattle;

  /**
   * デバッグ用の戦闘（GS-91）。開発モードのときだけ。**敵も味方も 3 人**で戦い、負けても続く。
   * 終わったら**記録を戦う前へ戻す**——試しの戦いで仲間・経験・持ち物・お金が変わると、
   * 遊びの確認がずれる。**入れ物は差し替えず中身を戻す**（イベントの道具立てが同じ入れ物を握っている）。
   */
  const debugBattle = useCallback(async (enemies = DEBUG_ENEMIES) => {
    const state = stateRef.current;
    const saved = {
      party: [...state.party],
      members: structuredClone(state.members),
      items: new Map(state.items),
      gold: state.gold,
    };
    // 今の仲間の後ろへ足して 3 人にそろえる（もう居る人は `joinParty` が飛ばす）。
    for (const who of DEBUG_PARTY) {
      if (state.party.length >= 3) break;
      joinParty(state, who);
    }
    try {
      await startBattleRef.current(enemies, true);
    } finally {
      state.party.splice(0, state.party.length, ...saved.party);
      state.members.clear();
      for (const [who, value] of saved.members) state.members.set(who, value);
      state.items.clear();
      for (const [id, count] of saved.items) state.items.set(id, count);
      state.gold = saved.gold;
    }
  }, []);

  /** 戦いが終わった。取り分を足して、待っている人へ返す。 */
  const endBattle = useCallback((outcome: BattleOutcome) => {
    // 取り分（経験・お金）を入れるのは戦闘画面（GS-63）。ここは場面の後始末だけ。
    useUi.getState().setBattle(null);
    battleFormationRef.current = undefined;
    battleAbortRef.current = null;
    // マップの曲へ戻す（GS-62）。**負けたときは戻さない**——このあと暗転してタイトルへ行く。
    if (outcome !== 'lose') void entryForFile(mapRef.current).then((entry) => applyMapSound(entry ?? {}));
    const done = battleEndRef.current;
    battleEndRef.current = null;
    done?.(outcome);
    canvasRef.current?.focus();
  }, []);

  /** 店を開いて、閉じるまで待つ（GS-66）。 */
  const startShop = useCallback(
    (goods: string[], sell: boolean) =>
      new Promise<void>((resolve) => {
        // 並べる物が 1 つも無ければ開かない（値段の無い物だけを書いたとき）。
        const kept = goods.filter((id) => itemPrice(id) > 0);
        if (kept.length === 0 && !sell) {
          console.warn('[shop] 売る物がありません');
          resolve();
          return;
        }
        shopEndRef.current = resolve;
        useUi.getState().setShop({ items: kept, sell });
      }),
    [],
  );
  const startShopRef = useRef(startShop);
  startShopRef.current = startShop;

  /** 買う（GS-66）。**お金が足りなければ何も動かさない。** */
  const buyItem = useCallback((id: string): boolean => {
    const state = stateRef.current;
    const price = itemPrice(id);
    if (price <= 0 || state.gold < price) return false;
    state.gold -= price;
    state.items.set(id, (state.items.get(id) ?? 0) + 1);
    return true;
  }, []);

  /** 売る。売値は買値の半分（`itemSellPrice`）。 */
  const sellItem = useCallback((id: string): boolean => {
    const state = stateRef.current;
    const price = itemSellPrice(id);
    if (price <= 0 || !spendItem(state, id)) return false;
    state.gold += price;
    return true;
  }, []);

  /**
   * 歩いているときに持ち物を使う（GS-64）。**戦闘と同じ式**（`applyUse`）を通す——
   * 「戦闘で 30 戻る薬がメニューでは 25」が起きないように。
   * 返り値は画面に出す一言。**使えなければ何も減らさない。**
   */
  const useItem = useCallback((id: string, who: string): string => {
    const state = stateRef.current;
    const use = itemUse(id, 'field');
    const now = state.members.get(who);
    if (!use || !now) return '';
    const max = memberStats(who, now.level);
    if (!wouldHelp(now, max, use)) return `${characterName(who)} には 何も 起きなかった……`;
    if (!spendItem(state, id)) return '';
    audio.playSe(use.se ?? battleSettings().se.item);
    const healed = applyUse(now, max, use);
    // 消した状態異常も言う（GS-71）。**戦闘と同じ文**を台帳（`gone`）から出す。
    const cured = healed.cured.map(
      (one) => `${characterName(who)} は ${ailmentDef(one)?.gone ?? `${ailmentDef(one)?.name ?? one}が 消えた。`}`,
    );
    const line = healLine(characterName(who), healed);
    return [`${itemName(id)} を つかった。`, use.say ?? '', ...cured, line].filter(Boolean).join(' ');
  }, []);

  /**
   * ゲームオーバー（GS-60）。**ゆっくり黒くしてタイトルへ。**
   * 記録は書き換えない——最後にセーブしたところから、もう一度遊べる。
   */
  const gameOverRef = useRef(() => {
    useUi.getState().setFade(1, GAME_OVER_FADE_MS);
    audio.stopBgm(GAME_OVER_FADE_MS);
    window.setTimeout(() => {
      useUi.getState().setMenu(false);
      useUi.getState().setPhase('title');
      // タイトルは黒の上に出す（`onTitle` と同じ）。次に始めたとき前の画面が見えない。
      useUi.getState().setFade(1, 0);
    }, GAME_OVER_FADE_MS + 200);
  });

  /**
   * 敵シンボル（GS-76）。**NPC の id → 敵の台帳のキー**。
   * マップの NPC に `EnemyData` を書くとここへ入り、触ると戦闘が始まる。
   */
  const symbolsRef = useRef<Map<string, string>>(new Map());
  /**
   * いま触れているシンボル。触った時点で消す（GS-78）ので**ふだんは空**だが、
   * 消す前に 2 度見てしまわないための控えとして残す。
   */
  const symbolHeldRef = useRef('');
  /**
   * いまのマップの NPC ぜんぶ（GS-130）。出す条件（`ShowIf` / `HideIf`）は
   * **スイッチが変わったら見直す**ので、条件を持ったまま控えておく。
   */
  const npcDefsRef = useRef<NpcDef[]>([]);
  /** もう消した NPC。二度消さないための覚え。 */
  const npcHiddenRef = useRef<Set<string>>(new Set());
  /** いま当てている見た目（GS-133）。同じものを毎回指し直さないための覚え。 */
  const npcPoseRef = useRef<Map<string, string>>(new Map());
  /**
   * スイッチを聞く口。3D 側（`GameView`）にも同じ物を渡す。
   * **`self:` で始めると「その物自身の覚え」**（GS-134）——同じイベントを何個の宝箱で使っても、
   * 開けた覚えは物ごとに分かれる。頭が無ければ今までどおり通しのスイッチ。
   */
  const switchOnRef = useRef((key: string, owner?: string) => {
    // 通しのフラグは**書いていなければ「まだ動ける」**（GS-147）。
    if (!key.startsWith('self:')) return switchOn(stateRef.current, key);
    if (!owner) return false;
    return stateRef.current.self.get(selfKey(mapKey(mapRef.current), `@${owner}`, key.slice(5))) ?? false;
  });

  /**
   * 歩いているあいだの毒（GS-71）。出会い頭と同じく**歩いた距離**で数える。
   * 出す文は一瞬だけの札（`walkNote`）——会話ウィンドウを出すと歩きが止まる。
   */
  const walkAilmentsRef = useRef(createWalkAilments());
  const [walkNote, setWalkNote] = useState('');
  const walkNoteTimer = useRef(0);

  /**
   * 店（GS-66）。閉じたことを知らせる約束を握っておく。
   * 中身（何が並ぶか）は `useUi` に置く——**戦闘と違って数が動くのは記録のほう**で、
   * 店の画面はそれを読むだけ。
   */
  const shopEndRef = useRef<(() => void) | null>(null);
  const shop = useUi((s) => s.shop);

  /** 並行イベント（GS-43）。手前の流れとは別の橋で動かす。 */
  const parallelBridgeRef = useRef<EventBridge | null>(null);
  /** いま動いている並行イベント。二重に始めないための控え。 */
  const parallelBusyRef = useRef<Set<string>>(new Set());
  /**
   * すでに動かした並行イベント。**条件が満たされている間は動かし直さない**——
   * ぐるぐる回し続けると、書いた人の意図と関係なく音が鳴りっぱなしになる。
   * 条件が崩れたら控えから外し、また満たされたときにもう一度動く。
   */
  const parallelDoneRef = useRef<Set<string>>(new Set());

  /**
   * そのイベントは動かせるか（GS-27）。**条件を見る前に「どのイベントの話か」を伝える**——
   * セルフスイッチはイベントごとの覚えなので、宛先が無いと常に false になる。
   */
  const runnableRef = useRef((event: EventDef, owner = '') => {
    const bridge = bridgeRef.current;
    if (!bridge) return false;
    // `owner` は起こす物の名前（GS-134）。`when` が `self` を見るとき、**物ごとの覚え**を引くのに要る。
    bridge.setScene({ map: mapKey(mapRef.current), event: event.id, owner });
    return canRun(event, bridge.ctx);
  });

  /**
   * 並行イベントから外す命令（GS-43）。**画面を止めるものは動かさない。**
   *
   * 会話・選択肢・流れる文字は「返事を待つ」ので、歩いている最中に割り込むと
   * プレイヤーの操作と取り合いになる。並行イベントの持ち場は
   * スイッチ・変数・音・NPC の歩き・`script` で、**話は手前のイベントの仕事**。
   */
  const BLOCKING = new Set(['message', 'choice', 'scroll']);

  /** 止まる命令を落とす。`if` の枝の中も見る。落としたら 1 度だけ知らせる。 */
  const quietCommands = (list: EventCommand[], dropped: string[]): EventCommand[] => {
    const out: EventCommand[] = [];
    for (const command of list) {
      if (BLOCKING.has(command.type)) {
        dropped.push(command.type);
        continue;
      }
      if (command.type === 'if') {
        out.push({
          ...command,
          then: quietCommands(command.then, dropped),
          ...(command.else ? { else: quietCommands(command.else, dropped) } : {}),
        });
        continue;
      }
      out.push(command);
    }
    return out;
  };

  /**
   * 並行イベントを見て回る（GS-43）。**プレイヤーは止めない**（`busy` を触らない）。
   * 条件が満たされたら 1 回動かし、崩れるまでは動かし直さない。
   */
  const checkParallel = useCallback(() => {
    const bridge = parallelBridgeRef.current;
    if (!bridge) return;
    for (const event of eventsRef.current.values()) {
      if (event.trigger !== 'parallel') continue;
      // 条件を見るのも**この橋で**。手前の橋を使うと、話しかけている最中に
      // 「いまどのイベントの話か」を書き換えてしまう。
      bridge.setScene({ map: mapKey(mapRef.current), event: event.id });
      if (!canRun(event, bridge.ctx)) {
        parallelDoneRef.current.delete(event.id);
        continue;
      }
      if (parallelDoneRef.current.has(event.id) || parallelBusyRef.current.has(event.id)) continue;
      parallelDoneRef.current.add(event.id);
      parallelBusyRef.current.add(event.id);
      const dropped: string[] = [];
      const commands = quietCommands(event.commands, dropped);
      if (dropped.length > 0) {
        console.warn('[event] 並行 ' + event.id + ': ' + [...new Set(dropped)].join(' / ') + ' は動かしません（画面が止まるため）');
      }
      void (async () => {
        try {
          bridge.setScene({ map: mapKey(mapRef.current), event: event.id });
          await runCommands(commands, bridge.ctx);
        } catch (error) {
          console.error('[event] 並行 ' + event.id + ' が止まりました', error);
        } finally {
          parallelBusyRef.current.delete(event.id);
        }
      })();
    }
  }, []);
  const checkParallelRef = useRef(checkParallel);
  checkParallelRef.current = checkParallel;
  /**
   * マップを移る（GS-17）。**行き先の書き方と着地の解き方はここ 1 か所**に置く——
   * イベントの `transfer` も、マップに置いた `MapMove` も同じ道を通る。
   */
  const goTo = useCallback(async (map: string, landing: Landing, face: WalkDir | '', fade = false) => {
    const view = viewRef.current;
    if (!view) return;
    // 入口をくぐるときは暗転を挟む（GS-21）。旧作と同じ間の取り方で、読み込みの間も隠せる。
    if (fade) {
      useUi.getState().setBusy(true);
      // **黒は一瞬で出す**（GS-28）。かけて出すと、その間だけ素の画面が見えてしまう。
      useUi.getState().setFade(1, 0);
      await new Promise((done) => window.setTimeout(done, DOOR_FADE_MS));
    }
    // 行き先は番号（`0102`）でもファイル名でも書ける。台帳で引き当てる。
    const entry = await mapEntryOf(map);
    const file = entry.file;
    await view.load(file);
    // そのマップの曲と環境音（GS-21）。同じ曲なら切れずに続く。
    applyMapSound(entry);
    // 着地。座標が書いてあればそこ、目印の名前ならその点、どちらも無ければマップの `default`。
    if (landing.at) view.placePlayer(landing.at.x, landing.at.y, landing.at.z);
    else if (landing.marker) view.placeAtMarker(landing.marker);
    if (face) view.face(face);
    await adoptRef.current(file);
    if (fade) {
      // **黒いうちに、踏んでいる場所のイベントを起こす**（GS-28）。
      // 先に明けると、イベントが出るまでの一瞬だけ素の画面が見えてしまう。
      useUi.getState().setBusy(false);
      checkSpotsRef.current();
      await painted();
      useUi.getState().setFade(0, DOOR_FADE_MS);
    }
  }, []);

  /**
   * イベントを 1 本動かす。動いているあいだは歩けない。
   * `self` は話しかけた相手（GS-16）。イベントの `this` はこの人を指す。
   */
  /**
   * 起こした物が宝箱なら、中身を台帳から決める（GS-135）。**抽選はここで 1 回だけ**——
   * 文に出す名前と実際に増える物がずれないように。台帳に無ければマップの `Item` / `Num` のまま。
   */
  const chestCarry = useCallback((carry: { item?: string; num?: number; owner?: string }) => {
    const chest = carry.owner ? chestOf(carry.owner) : null;
    if (!chest) return carry;
    return { ...carry, ...drawChest(chest) };
  }, []);

  const chestCarryRef = useRef(chestCarry);
  chestCarryRef.current = chestCarry;

  const play = useCallback(async (event: EventDef, npc = '', carry: { item?: string; num?: number; owner?: string } = {}) => {
    const bridge = bridgeRef.current;
    if (!bridge || useUi.getState().busy) return;
    useUi.getState().setBusy(true);
    // どのイベントを動かしているかを先に伝える（GS-27）。セルフスイッチの宛先になる。
    // `carry` は起こした物が持っていた中身（GS-132。宝箱の `Item` / `Num`）。
    bridge.setScene({ npc, map: mapKey(mapRef.current), event: event.id, ...chestCarryRef.current(carry) });
    try {
      await runCommands(event.commands, bridge.ctx);
    } catch (error) {
      // **ゲームオーバーはエラーではない**（GS-60）。ここで話が終わっただけなので、
      // 赤い印を出さずに片付けへ進む。
      if (!(error instanceof GameOver)) throw error;
    } finally {
      viewRef.current?.stopCameraCue();
      bridge.setScene({});
      useUi.getState().setTalk(null);
      useUi.getState().setChoices(null);
      // 立ち絵は**イベントと一緒に片付ける**（GS-20）。出しっぱなしで歩き出すと直せない。
      useUi.getState().clearPortraits();
      useUi.getState().setBusy(false);
      canvasRef.current?.focus();
    }
  }, []);
  const playRef = useRef(play);
  playRef.current = play;

  /** マップが変わったら、そのマップの起動場所とイベントを読み直す。 */
  const adopt = useCallback(
    async (file: string) => {
      mapRef.current = file;
      const name = mapKey(file);
      // 戦闘の背景は台帳から（GS-79）。台帳は 1 回読んで使い回すので、ここは待っても速い。
      battleFieldRef.current = (await entryForFile(file))?.battleField ?? 'hill';
      // イベントの有無は**台帳で決める**（DEC-374）。無いマップを取りに行かない。
      const index = await loadFileIndex();
      const [map, events] = await Promise.all([
        fetch(mapUrl(file)).then((response) => response.json() as Promise<MapDef>),
        index.hasEvents(name)
          ? fetch(assetUrl(`data/events/${name}.json`))
              .then((response) => (response.ok ? (response.json() as Promise<EventFile>) : null))
              .catch(() => null)
          : null,
      ]);
      spotsRef.current = readEventSpots(map);
      // **着いた先が入口の上でも、そこからは動かさない**（DEC-247）。
      // 行き先の `MoveTo` が入口の枠に重なっていると、着いた瞬間にまた飛んで
      // 2 枚のマップを往復し続ける（実測: 家 ⇔ 森が止まらなくなった）。
      // いったんその枠から**出るまで**次の移動を受け付けない。踏んで動くイベントはこの限りではない
      // ——出発点がイベントの枠の中にあるマップ（家のオープニング）が動かなくなる。
      {
        const view = viewRef.current;
        const at = view?.playerAt();
        const here = view && at ? spotUnder(spotsRef.current, at, view.playerRadius()) : null;
        steppingRef.current = here?.mapMove ? here.objectId : '';
      }
      // 出す条件（GS-130）を満たす人だけを相手にする。**3D 側も同じ条件で作らない**ので、
      // 話しかけ先も敵シンボルもここで揃えておかないと「居ないのに触れる」が起きる。
      npcDefsRef.current = readNpcs(map);
      npcHiddenRef.current = new Set();
      // 見た目の覚えはマップごと（GS-133）。作り直した板には当て直す。
      npcPoseRef.current = new Map();
      const npcList = npcDefsRef.current.filter((npc) => npcShown(npc, (key) => switchOnRef.current(key, npc.id)));
      npcTalkRef.current = new Map(npcList.map((npc) => [npc.id, npc.event]));
      npcThingRef.current = new Set(npcList.filter((npc) => npc.thing).map((npc) => npc.id));
      // 敵シンボル（GS-76）。`EnemyData` を書いた NPC だけ。マップが変われば作り直す。
      symbolsRef.current = new Map(
        npcList.filter((npc) => npc.enemy).map((npc) => [npc.id, npc.enemy as string]),
      );
      symbolHeldRef.current = '';
      eventsRef.current = new Map((events?.events ?? []).map((entry) => [entry.id, entry]));
      // イベント側から NPC に結び付ける（GS-22）。マップに `Event` を書かなくても話せる——
      // **誰に話しかけると何が起きるかはイベントの都合**なので、イベント JSON で決められるほうがよい。
      for (const entry of eventsRef.current.values()) {
        if (entry.npc) npcTalkRef.current.set(entry.npc, entry.id);
      }

      // マップが変われば並行イベントの覚えも捨てる（GS-43）。前のマップの話。
      parallelDoneRef.current.clear();
      parallelBusyRef.current.clear();
      if (cameraPreviewRef.current) return;

      // 出会い頭の戦闘も入れ替える（GS-61）。**歩いた距離は持ち越さない**——
      // 前のマップで貯めたぶんで、入った途端に始まらないように。
      // 毒の数えも入れ替える（GS-71）。入口をくぐった瞬間に効かないように。
      walkAilmentsRef.current.reset();

      // マップに入ったら動くもの（`auto`）。条件を満たすものだけ。
      const bridge = bridgeRef.current;
      if (!bridge) return;
      for (const event of eventsRef.current.values()) {
        if (event.trigger !== 'auto' || !runnableRef.current(event)) continue;
        await play(event);
      }
      checkParallelRef.current();
    },
    [play],
  );
  adoptRef.current = adopt;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let previewLoadError = '';
    const onStatus = (status: GameStatus) => {
      previewLoadError = status.error;
      setNotice(status.error ? status.error : status.loading ? '読み込み中…' : '');
      // ビューが自分でマップを移したときも追いつく（DEC-247）。
      if (status.map && !status.loading && status.map !== mapRef.current) void adoptRef.current(status.map);
    };

    const view = createGameView(canvas, onStatus, {
      switchOn: (key, owner) => switchOnRef.current(key, owner),
      chestOf: (id) => chestOf(id),
    });
    viewRef.current = view;
    canvas.focus();
    // マップはタイトルで「はじめから／つづきから」を選んでから読む（GS-27）。
    // 端末に覚えている設定（GS-32）。文字送りと音量は起動のたびに読み直す。
    gameOptions.loadOptions();
    // 開発中のつまみ（GS-126。オープニングを飛ばす・BGM を鳴らさない）。**音より先に読む。**
    loadDevOptions();
    void loadSoundBook();
    // 共通イベントの台帳（GS-44）。無くても遊べるので、読めなければ空のまま進む。
    void loadCommonBook();
    // 持ち物の台帳（GS-46）。名前と説明だけ。持っている数はセーブが持つ。
    void loadItemBook();
    // 宝箱の台帳（GS-135）。中身と見た目のコマ。無くても遊べるので、読めなければ空のまま。
    void loadChestBook();
    // 敵・技・はじめの仲間の台帳（GS-60）。数値だけで、いまの HP はセーブが持つ。
    void loadBattleBook();
    void loadIllustrations().catch((error) => console.warn('[illustrations]', error));
    // [凍結 BPE-15] 戦闘演出エディタのカメラ割り当て台帳は読まない。
    // void loadBattlePresentation().catch((error) => console.warn('[battle-presentation]', error));
    const onFirstInput = () => unlockAudio();
    window.addEventListener('keydown', onFirstInput);
    window.addEventListener('pointerdown', onFirstInput);

    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __game?: GameView }).__game = view;
      // コマンド選択中の味方を左端へ立たせる値（GS-103）。Console で書き換えてその場で試す。
      (window as unknown as { __stageCommandFigure?: typeof STAGE_COMMAND_FIGURE }).__stageCommandFigure = STAGE_COMMAND_FIGURE;
      (window as unknown as { __audio?: typeof audio }).__audio = audio;
      (window as unknown as { __options?: typeof gameOptions }).__options = gameOptions;
      // 開発中のつまみ（GS-126）。Console から `__dev.setDevOptions({ muteBgm: false })` で試せる。
      (window as unknown as { __dev?: typeof dev }).__dev = dev;
      // 画面の状態（`busy` など）も開発中に見たい。**見えないものは直せない**——
      // 「歩けないのはイベントの最中だからか、別の理由か」がこれで分かる。
      (window as unknown as { __ui?: typeof useUi }).__ui = useUi;
      /**
       * イベントエディタから 1 本走らせる口（GS-37）。**道具のための窓口はここに集める。**
       *
       * 渡された命令をそのまま動かす——`when`（動く条件）は見ない。
       * 書いた中身を確かめるための口なので、スイッチの都合で動かないと役に立たない。
       * 保存していない下書きもそのまま渡せる（エディタが持っている JSON を送るだけ）。
       */
      (
        window as unknown as {
          __preview?: { play(event: EventDef, npc?: string, carry?: { item?: string; num?: number }): Promise<void> };
        }
      ).__preview = {
        // `carry` は宝箱の中身（GS-132）。ふだんはマップのオブジェクトが持つ物を、
        // 下書きを試すときは手で渡せるようにしておく。
        play: (event, npc = '', carry = {}) => playRef.current(event, npc, carry),
      };
      const idle = () => {
        const ui = useUi.getState();
        if (!bridgeRef.current) throw new Error('ゲームの初期化を待ってください');
        if (ui.busy || ui.battle || ui.menu || ui.shop) throw new Error('実行中の場面を終了してください');
      };
      const cameraEditor = {
        async prepare(file: string) {
          idle();
          view.unstageBattle();
          cameraPreviewRef.current = true;
          autoPendingRef.current = false;
          await Promise.all([loadBattleBook(), loadCharacterBook(), loadIllustrations()]);
          resetParty(stateRef.current);
          useUi.getState().setPhase('play');
          useUi.getState().setFade(0, 0);
          await view.load(file);
          if (previewLoadError) throw new Error(`マップを読み込めません: ${previewLoadError}`);
          await adoptRef.current(file);
        },
        setBook: (next: CameraCueBook) => previewCameraCues(next),
        play: (id: string) => view.playCameraCue(id),
        cameraState: () => view.cameraCueState(),
        seek: (ms: number) => view.seekCameraCue(ms),
        pause: (paused: boolean) => view.pauseCameraCue(paused),
        stop: () => view.stopCameraCue(),
        // 戦闘（ビルボード仮配置・戦闘の実行）はカメラエディタから削除した（GS-115。カメラ演出はイベント用）。
        async event(id: string) {
          idle(); view.unstageBattle();
          const event = eventsRef.current.get(id);
          if (!event) throw new Error(`イベントがありません: ${id}`);
          await playRef.current(event, event.npc ?? '');
        },
      };
      (window as unknown as { __cameraEditor?: typeof cameraEditor }).__cameraEditor = cameraEditor;
      // 戦闘演出エディタ（アニメーション演出。GS-105）の開発用入口。技の絵（`effects.json`）の下書きを差し替えて試す。
      const battleEffectEditor = {
        prepare: cameraEditor.prepare,
        setEffects: (next: Record<string, EffectEntry>) => previewEffects(next),
        async battle(enemies: string[]) { idle(); await debugBattle(enemies); },
        /** 戦闘中なら先頭の敵へ絵を出す。戦闘中でなければ偽。 */
        playEffect(def: EffectDef) {
          if (!useUi.getState().battle) return false;
          window.dispatchEvent(new CustomEvent('battle-effect-preview', { detail: { def } }));
          return true;
        },
        forceBattle() {
          if (!useUi.getState().battle) return false;
          battleAbortRef.current?.abort();
          endBattle('escape');
          return true;
        },
      };
      (window as unknown as { __battleEffectEditor?: typeof battleEffectEditor }).__battleEffectEditor = battleEffectEditor;
      // [凍結 BPE-15] 旧・戦闘演出エディタ（カメラ割り当て）の開発用入口。
      // const battlePresentationEditor = {
        // prepare: cameraEditor.prepare,
        // setBook: (next: BattlePresentationBook) => previewBattlePresentation(next),
        // // 味方ごとの割り当ては `契機@人数`（BPE-12）。何人目として試すかだけ渡す。
        // play: (key: string) => {
          // const [hook, slot] = key.split('@');
          // return presentBattle(hook as BattlePresentationHook, slot ? { slot: Number(slot) } : {});
        // },
        // async battle(enemies: string[]) { idle(); await debugBattle(enemies); },
        // forceBattle() {
          // if (!useUi.getState().battle) return false;
          // battleAbortRef.current?.abort();
          // endBattle('escape');
          // return true;
        // },
      // };
      // (window as unknown as { __battlePresentationEditor?: typeof battlePresentationEditor }).__battlePresentationEditor = battlePresentationEditor;
    }

    return () => {
      window.removeEventListener('keydown', onFirstInput);
      window.removeEventListener('pointerdown', onFirstInput);
      viewRef.current = null;
      delete (window as unknown as { __cameraEditor?: unknown }).__cameraEditor;
      delete (window as unknown as { __battleEffectEditor?: unknown }).__battleEffectEditor;
      // [凍結 BPE-15] 戦闘演出エディタの開発用入口。
      // delete (window as unknown as { __battlePresentationEditor?: unknown }).__battlePresentationEditor;
      view.dispose();
    };
  }, []);

  /**
   * ゲームパッド（GS-58）。**押した／離したを合成のキーイベントにして流すだけ**なので、
   * 歩き・会話・メニュー・Esc はどれも今までの道をそのまま通る。
   * タイトルでも効かせる——「はじめから」をパッドで選べないと入口で詰まる。
   */
  useEffect(() => startGamepad(), []);

  // イベントの道具立て。スイッチと変数はまだメモリだけ（セーブは GS-04 で）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 人の台帳（GS-54）。メニューも同じ表を引くので、読むのはここ 1 か所。
      const characters = await loadCharacterBook();
      if (cancelled) return;
      const options = {
        characters,
        getView: () => viewRef.current,
        state: stateRef.current,
        transfer: (map: string, at: { x: number; y: number; z: number } | null, face?: WalkDir) =>
          goTo(map, { marker: '', at }, face ?? ''),
        battle: (enemies: string[], canLose: boolean, formation?: string) =>
          startBattleRef.current(enemies, canLose, formation),
        shop: (goods: string[], sell: boolean) => startShopRef.current(goods, sell),
        // スイッチが動いたら、見た目をその場で合わせる（GS-136）。見張り（100ms ごと）でも
        // 同じことをしているが、**宝箱は押したその瞬間に開いていてほしい**——
        // 待つと、開いた絵よりメッセージのほうが先に出る。
        onSwitch: () => {
          checkNpcShownRef.current();
          checkNpcPoseRef.current();
        },
      };
      bridgeRef.current = createEventBridge(options);
      /**
       * 並行イベント専用の橋（GS-43）。**手前のイベントと分ける。**
       * 橋は「いまどのイベントの話か」を自分の中に持つ（セルフスイッチの宛先）ので、
       * 1 本を two つの流れで使い回すと、**片方の覚えがもう片方へ書き込まれる**。
       */
      parallelBridgeRef.current = createEventBridge(options);
      // 開発中だけ外から叩けるようにする。イベントを 1 命令ずつ試すのに使う。
      if (process.env.NODE_ENV === 'development') {
        (window as unknown as { __event?: EventBridge }).__event = bridgeRef.current;
        // 3D の口も出しておく。**居る場所や向きを外から聞ける**と、
        // 起動場所の当たり（入口・調べ物）を調べるのが速い。
        (window as unknown as { __view?: () => GameView | null }).__view = () => viewRef.current;
        // 戦闘を 1 回試す口（GS-60）。**負けても話は終わらせない**（`canLose`）——
        // 試している最中にタイトルへ戻されると、続けて試せない。
        (window as unknown as { __battle?: (ids: string[]) => Promise<BattleOutcome> }).__battle = (ids) =>
          startBattleRef.current(ids, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goTo]);

  /**
   * 踏んでいる場所を見て、起こすものがあれば起こす（`touch` と `MapMove`）。
   * ふだんは 0.1 秒ごとだが、**マップを読み終わった直後にも 1 回**呼ぶ（GS-28）——
   * 待つと、その間だけ**イベント前の画面**が見えてしまう。
   */
  const checkSpots = useCallback(() => {
    const view = viewRef.current;
    const bridge = bridgeRef.current;
    if (!view || !bridge || useUi.getState().busy) return;
    const at = view.playerAt();
    if (!at) return;
    const spot = spotUnder(spotsRef.current, at, view.playerRadius());
    if (!spot) {
      steppingRef.current = '';
      return;
    }
    // 立ちっぱなしで何度も起こさない。いったん出るまで黙る。
    if (steppingRef.current === spot.objectId) return;
    steppingRef.current = spot.objectId;
    if (spot.mapMove) {
      // 行き先・立ち位置・向きはすべてオブジェクトのプロパティが持つ（GS-17）。
      // **着いてから**覚える（GS-33）。移る前に書くと、戻したとき入口の上に立っていて、
      // またそのまま向こうへ吸い込まれてしまう。
      void goTo(spot.mapMove, spot.landing, spot.face, true).then(() => {
        autoPendingRef.current = true;
      });
      return;
    }
    const event = eventsRef.current.get(spot.event);
    if (event && event.trigger === 'touch' && runnableRef.current(event, spot.owner))
      void play(event, '', { item: spot.item, num: spot.num, owner: spot.owner });
  }, [play, goTo]);
  const checkSpotsRef = useRef(checkSpots);
  checkSpotsRef.current = checkSpots;

  /**
   * 敵シンボルに触ったら戦う（GS-76）。**歩けるときだけ見る**——
   * 会話や戦闘の最中に見ると、話し終わった瞬間に始まってしまう。
   *
   * 触った判定は**距離**（`SYMBOL_REACH`）。踏ませる形にすると、
   * うろつく相手（GS-48）の足元へ乗り込まないと当たらない。
   */
  const checkSymbols = useCallback(() => {
    const view = viewRef.current;
    const at = view?.playerAt();
    if (!view || !at) return;
    if (!canWalk(useUi.getState())) return;

    let near = '';
    for (const [id] of symbolsRef.current) {
      const spot = view.npcAt(id);
      if (!spot) continue;
      if (Math.hypot(spot.x - at.x, spot.z - at.z) <= SYMBOL_REACH) {
        near = id;
        break;
      }
    }
    // 離れたら控えを外す。**離れるまでは何もしない**（逃げた直後の戦い直しを防ぐ）。
    if (!near) {
      symbolHeldRef.current = '';
      return;
    }
    const enemy = symbolsRef.current.get(near);
    if (!enemy) return;
    // **触った時点でフィールドから消す**（GS-78）。戦闘の画は下地が透けるので、
    // 消さないと戦っている相手が背景にも立っていることになる。
    // マップは書き換えないので、入り直せば戻ってくる（逃げた相手も同じ）。
    symbolsRef.current.delete(near);
    symbolHeldRef.current = '';
    viewRef.current?.removeNpc(near);
    // **負けたらゲームオーバー**（`canLose` は false）。話の途中ではないので、
    // 続きを書いた人も居ない——`GameOver` はここで受け止めて終わりにする。
    void startBattleRef.current([enemy], false).catch((error) => {
      if (!(error instanceof GameOver)) throw error;
    });
  }, []);
  const checkSymbolsRef = useRef(checkSymbols);
  checkSymbolsRef.current = checkSymbols;

  /**
   * 歩いているあいだの毒（GS-71）。**歩けるときだけ数える**（会話・戦闘・メニューの間は止まる）。
   * **フィールドでは倒れない**（HP 1 で止まる）——`walkAilment.ts` を見よ。
   */
  const checkWalkAilments = useCallback(() => {
    const at = viewRef.current?.playerAt();
    if (!at) return;
    const hurt = walkAilmentsRef.current.at(stateRef.current, at, canWalk(useUi.getState()));
    if (hurt.length === 0) return;
    audio.playSe(battleSettings().se.walkPoison);
    const lines = hurt.map(
      (one) => `${characterName(one.who)} は ${ailmentDef(one.ailment)?.name ?? one.ailment}で ${one.amount} の ダメージ！`,
    );
    setWalkNote(lines.join('　'));
    window.clearTimeout(walkNoteTimer.current);
    walkNoteTimer.current = window.setTimeout(() => setWalkNote(''), WALK_NOTE_MS);
  }, []);
  const checkWalkAilmentsRef = useRef(checkWalkAilments);
  checkWalkAilmentsRef.current = checkWalkAilments;

  /**
   * 出す条件が崩れた NPC を消す（GS-130）。**イベントでスイッチが入った直後に効かせる**——
   * 倒したイベント敵がその場に残っていると、続けて触れてもう一度戦えてしまう。
   * 逆（条件が満たされて現れる）はマップを読み直したときだけ。話の途中で湧くと驚く。
   */
  const checkNpcShown = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const def of npcDefsRef.current) {
      if (npcHiddenRef.current.has(def.id)) continue;
      if (npcShown(def, (key) => switchOnRef.current(key, def.id))) continue;
      npcHiddenRef.current.add(def.id);
      view.removeNpc(def.id);
      npcTalkRef.current.delete(def.id);
      symbolsRef.current.delete(def.id);
      if (symbolHeldRef.current === def.id) symbolHeldRef.current = '';
    }
  }, []);
  const checkNpcShownRef = useRef(checkNpcShown);
  checkNpcShownRef.current = checkNpcShown;

  /**
   * スイッチで変わる見た目を合わせる（GS-133。マップの `Pose` / `PoseIf`）。
   * **イベントに「絵を変える」を書かなくてよくする**ためのもの——開けた覚え（スイッチ）を
   * 記録が持っているので、そこから毎回導く。マップを読み直しても同じ絵に戻る。
   */
  const checkNpcPose = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const def of npcDefsRef.current) {
      if (npcHiddenRef.current.has(def.id)) continue;
      // 宝箱は台帳のコマ（GS-135）。**開けたその場で絵が変わる。**
      const chest = chestOf(def.id);
      if (chest) {
        const frame = switchOnRef.current(`self:${CHEST_OPENED}`, def.id) ? chest.opened : chest.closed;
        const key = frame === undefined ? '' : String(frame);
        if (npcPoseRef.current.get(def.id) === key) continue;
        npcPoseRef.current.set(def.id, key);
        view.poseNpc(def.id, frame ?? null);
        continue;
      }
      if (!def.pose || !def.poseIf) continue;
      const want = switchOnRef.current(def.poseIf, def.id) ? def.pose : '';
      if (npcPoseRef.current.get(def.id) === want) continue;
      npcPoseRef.current.set(def.id, want);
      view.poseNpc(def.id, want || null);
    }
  }, []);
  const checkNpcPoseRef = useRef(checkNpcPose);
  checkNpcPoseRef.current = checkNpcPose;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (cameraPreviewRef.current) return;
      checkSpotsRef.current();
      // 敵シンボル（GS-76）。起動場所と同じ間隔で見る。
      checkSymbolsRef.current();
      // 歩いているあいだの毒（GS-71）。同じ間隔で見る。
      checkWalkAilmentsRef.current();
      // 出す条件が崩れた NPC（GS-130）。**`busy` でも見る**——イベントの中でスイッチが入り、
      // その場で消えてほしいことがある（倒したイベント敵）。
      checkNpcShownRef.current();
      // スイッチで変わる見た目（GS-133）。**`busy` でも見る**——開けたその場で絵が変わる。
      checkNpcPoseRef.current();
      // 並行イベント（GS-43）。**`busy` でも見る**——止めないのが持ち場なので、
      // 会話の裏でスイッチが入るのは正しい動き。
      checkParallelRef.current();
      // 札が立っていて手が空いていれば、そこで書く（GS-33）。
      // イベントの途中で書くと、読み戻したとき話が半分から始まってしまう。
      if (!autoPendingRef.current) return;
      const ui = useUi.getState();
      if (ui.busy || ui.phase !== 'play') return;
      autoPendingRef.current = false;
      autoSaveRef.current();
    }, WATCH_MS);
    return () => window.clearInterval(timer);
  }, []);

  /** 決定キーで動くもの（`action`）。目の前 → 調べ物 → 立っている場所、の順に見る。 */
  useEffect(() => {
    const onKey = (key: KeyboardEvent) => {
      // メニュー中は話しかけも調べ物も止める（GS-59）。以前は「メニューがキーを
      // 飲み込むから届かない」だけだったので、**ゲームパッドの合成イベント（GS-58）は素通り**していた。
      if (!DECIDE.includes(key.code) || !canWalk(useUi.getState())) return;
      const view = viewRef.current;
      const bridge = bridgeRef.current;
      if (!view || !bridge) return;
      // まず**目の前の相手**（GS-16）。話しかけるのは足元ではなく向いた先。
      const who = view.npcInFront();
      const talk = who ? eventsRef.current.get(npcTalkRef.current.get(who) ?? '') : undefined;
      if (who && talk && talk.trigger === 'action' && runnableRef.current(talk, who)) {
        const def = npcDefsRef.current.find((npc) => npc.id === who);
        // 話しかけられた人はこちらを向く（GS-118）。イベントが `turn` で向きを指すなら、
        // そちらが後から上書きする。**物（宝箱など）は向かない**（GS-133）。
        if (!def?.thing) view.faceNpcToPlayer(who);
        void play(talk, who, { item: def?.item, num: def?.num, owner: def?.id });
        return;
      }
      const at = view.playerAt();
      if (!at) return;
      // つぎに**調べ物**（GS-55）。向いた先の一歩先に在る物。
      const aim = view.facingVector();
      const look = aim ? spotAhead(spotsRef.current, at, aim, EXAMINE_REACH) : null;
      if (look) {
        const found = eventsRef.current.get(look.event);
        if (found && found.trigger === 'action' && runnableRef.current(found, look.owner)) {
          // 名前を**話し相手として**渡す（GS-55）。吹き出しがこの物の上に出る。
          // 人ではないので `walk` や `pose` の相手にはならない——やれば警告が出る。
          void play(found, look.name, { item: look.item, num: look.num, owner: look.owner });
          return;
        }
      }
      const spot = spotUnder(spotsRef.current, at, view.playerRadius());
      if (!spot?.event) return;
      const event = eventsRef.current.get(spot.event);
      if (event && event.trigger === 'action' && runnableRef.current(event, spot.owner))
        void play(event, '', { item: spot.item, num: spot.num, owner: spot.owner });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play]);

  /** 遊んだ秒を数える（GS-27）。タイトルに居る間とイベント中は数えない。 */
  useEffect(() => {
    if (phase !== 'play') return;
    const timer = window.setInterval(() => {
      stateRef.current.playSeconds += CLOCK_MS / 1000;
    }, CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  /**
   * Esc でメニュー（GS-54）。**開くのは「歩ける」ときだけ**——
   * 会話・イベント・戦闘の最中は開かない。旗を並べて数えず `canWalk()` に聞く（GS-59）。
   */
  useEffect(() => {
    if (phase !== 'play') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !canWalk(useUi.getState())) return;
      event.preventDefault();
      useUi.getState().setMenu(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  /** はじめから（GS-27）。記録を新しくして出発点のマップへ。 */
  const startNew = useCallback(async () => {
    autoPendingRef.current = false;
    const fresh = newState();
    stateRef.current.switches = fresh.switches;
    stateRef.current.variables = fresh.variables;
    stateRef.current.self = fresh.self;
    stateRef.current.clear = fresh.clear;
    // 持ち物も戻す。**戻し忘れると**「つづきから」の後の「はじめから」に前の荷物が残る。
    stateRef.current.items = fresh.items;
    stateRef.current.playSeconds = 0;
    // 仲間を台帳のとおりに（GS-60）。台帳を読み終える前に押されても揃うよう待つ。
    await loadBattleBook();
    resetParty(stateRef.current);
    useUi.getState().setPhase('play');
    // **読み込みのあいだは黒のまま**（GS-28）。一瞬で覆い、オープニングの暗幕へそのまま渡す。
    useUi.getState().setFade(1, 0);
    const entry = await entryForFile(START_MAP);
    if (entry) applyMapSound(entry);
    await viewRef.current?.load(START_MAP);
    await adoptRef.current(START_MAP);
    checkSpotsRef.current();
    await painted();
    useUi.getState().setFade(0, DOOR_FADE_MS);
    canvasRef.current?.focus();
  }, []);

  /** つづきから。記録を戻してから、そのマップへ置く。 */
  const continueFrom = useCallback(
    async (slot: number) => {
      autoPendingRef.current = false;
      const data = await readSave(slot);
      if (!data) return;
      const { state, progress } = fromSave(data);
      // **入れ物は差し替えず中身を移す**——イベントの道具立てが同じ入れ物を握っている。
      stateRef.current.switches = state.switches;
      stateRef.current.variables = state.variables;
      stateRef.current.self = state.self;
      stateRef.current.clear = state.clear;
      stateRef.current.playSeconds = state.playSeconds;
      stateRef.current.items = state.items;
      // 仲間（GS-60）。**版 2 までの記録には無い**ので、台帳から入れ直す。
      await loadBattleBook();
      stateRef.current.party = state.party;
      stateRef.current.members = state.members;
      stateRef.current.gold = state.gold;
      ensureParty(stateRef.current);
      useUi.getState().setPhase('play');
      useUi.getState().setMenu(false);
      // 読み直すあいだは黒のまま（GS-28）。
      await goTo(progress.map, { marker: '', at: progress.at }, progress.facing, true);
      canvasRef.current?.focus();
    },
    [goTo],
  );

  /**
   * 「話せるよ」の合図を出す相手（GS-49）。**毎フレーム聞かれる**ので、
   * 重い判定はしない——距離と、そのイベントが動くかだけ。
   */
  const talkMarks = useCallback((): TalkMark[] => {
    const view = viewRef.current;
    // 会話や暗転の最中は出さない。合図の役目は「押せば始まる」を伝えることなので。
    if (!view || useUi.getState().busy || useUi.getState().phase !== 'play') return [];
    const at = view.playerAt();
    if (!at) return [];
    const out: TalkMark[] = [];
    for (const [npc, eventId] of npcTalkRef.current) {
      // 物（宝箱・立て札など）には出さない（GS-136）。合図の役目は「話しかけられる」を
      // 伝えることで、**物は話し相手ではない**。
      if (npcThingRef.current.has(npc)) continue;
      const event = eventsRef.current.get(eventId);
      if (!event || event.trigger !== 'action') continue;
      const spot = view.npcAt(npc);
      if (!spot) continue;
      const span = Math.hypot(spot.x - at.x, spot.z - at.z);
      if (span > TALK_MARK_SHOW) continue;
      // 条件を満たさないイベント（もう終わった話など）には出さない。
      if (!runnableRef.current(event)) continue;
      const head = view.headAt(npc);
      if (!head) continue;
      out.push({ id: npc, x: head.x, y: head.y, near: span <= TALK_MARK_NEAR });
    }
    return out;
  }, []);

  /** いまの場所を記録に写す。 */
  const saveTo = useCallback(async (slot: number) => {
    const view = viewRef.current;
    const at = view?.playerAt();
    if (!view || !at) return;
    await writeSave(
      slot,
      toSave(stateRef.current, {
        map: mapNumber(mapRef.current),
        at: { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) },
        facing: view.playerFacing() ?? 'down',
      }),
    );
  }, []);

  // オート枠へ書くのも同じ道を通る（GS-33）。**書き出しは 1 か所**にしておく。
  autoSaveRef.current = () => void saveTo(AUTO_SLOT);

  return (
    <div className="stage">
      {/* 画面は 1280×720（DEC-162）。会話も暗転も**この中**に重ねる。 */}
      <div className="screen">
        {/*
         * デバッグ用の戦闘ボタン（GS-91）。開発モードのときだけ、フィールドにいるあいだだけ出す。
         * **マウスの左クリックだけ**——焦点を取らせない（Enter やパッドで押されると、歩いている最中に始まる）。
         */}
        {DEV_MODE && phase === 'play' && !battle && !menu && !shop && !uiBusy ? (
          <button
            type="button"
            className="debug-battle"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.button !== 0) return;
              void debugBattle();
            }}
          >
            Battle Start
          </button>
        ) : null}
        <canvas ref={canvasRef} className="viewport" tabIndex={0} />
        <CameraIllustrationLayer probe={cameraIllustrations} />
        <MessageWindow
          onAdvance={() => bridgeRef.current?.advance()}
          onPick={(index) => bridgeRef.current?.pick(index)}
          headAt={(who) => viewRef.current?.headAt(who) ?? null}
        />
        {/* 旧作の仮想パッド。会話窓が空けている左右の領域へ収める（GS-155）。 */}
        {phase === 'play' ? <VirtualPad /> : null}
        {/* 話せる合図（GS-49）。会話の裏では出さない。 */}
        <TalkMarks probe={talkMarks} />
        {notice ? <div className="notice">{notice}</div> : null}
        {/* 歩いているあいだの毒（GS-71）。**会話ウィンドウは使わない**——歩きが止まる。 */}
        {walkNote ? <div className="walk-note">{walkNote}</div> : null}
        {phase === 'title' ? (
          <TitleScreen
            onStart={() => void startNew()}
            onContinue={(slot) => void continueFrom(slot)}
            onSettings={() => useUi.getState().setSettings(true)}
          />
        ) : null}
        {phase === 'play' && menu ? (
          <Menu
            items={stateRef.current.items}
            map={mapKey(mapRef.current)}
            playSeconds={stateRef.current.playSeconds}
            party={stateRef.current.party}
            members={stateRef.current.members}
            gold={stateRef.current.gold}
            onUseItem={useItem}
            onEquip={(who, id) => equipItem(stateRef.current, who, id)}
            onUnequip={(who, slot) => unequipItem(stateRef.current, who, slot)}
            onMove={(who, delta) => moveMember(stateRef.current, who, delta)}
            onSave={saveTo}
            onLoad={continueFrom}
            onTitle={() => {
              useUi.getState().setMenu(false);
              // タイトルへ戻るときも黒くしておく（GS-28）。次に「はじめから」を押した瞬間、
              // 前のマップが見えないようにする。
              useUi.getState().setFade(1, 0);
              useUi.getState().setPhase('title');
            }}
            onClose={() => useUi.getState().setMenu(false)}
          />
        ) : null}
        {/* 戦闘（GS-60）。マップの上に重ねる——3D はそのまま裏で動いている。 */}
        {phase === 'play' && battle ? (
          <BattleView
            key={battle.join(',')}
            enemies={battle}
            field={battleFieldRef.current}
            scene3d={battleStageRef.current}
            state={stateRef.current}
            onPresentation={presentBattle}
            signal={battleAbortRef.current?.signal}
            onEnd={endBattle}
          />
        ) : null}
        {/* 店（GS-66）。イベントの最中に開くので、会話ウィンドウより上に重ねる。 */}
        {phase === 'play' && shop ? (
          <ShopScreen
            items={stateRef.current.items}
            gold={() => stateRef.current.gold}
            goods={shop.items}
            canSell={shop.sell}
            onBuy={buyItem}
            onSell={sellItem}
            onClose={() => {
              useUi.getState().setShop(null);
              const done = shopEndRef.current;
              shopEndRef.current = null;
              done?.();
              canvasRef.current?.focus();
            }}
          />
        ) : null}
        {/* 設定はタイトルからもゲーム中からも開く（GS-32）。いちばん上に重ねる。 */}
        {settings ? <SettingsMenu onClose={() => useUi.getState().setSettings(false)} /> : null}
      </div>
    </div>
  );
}
