'use client';

// canvas と 3D の境界。**3D は React の再描画に巻き込まない**（構想 §5.3）。
// React が持つのは会話・選択肢・暗さだけ（`store.ts`）。
// イベントの起動（どこに立ったら何が動くか）もここが受け持つ（GS-14）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { createGameView, type GameStatus, type GameView, type WalkDir } from '../game/GameView';
import { START_MAP_ID, assetUrl, mapUrl } from '../game/assets';
import { mapEntryOf, entryForFile, knownMapLabel, knownSaveMapId, loadMapIndex, mapLabel } from '../game/mapIndex';
import { loadFileIndex } from '../game/fileIndex';
import { loadCommonBook } from '../game/commons';
import { loadItemBook } from '../game/items';
import { characterName, loadCharacterBook } from '../game/characters';
import { loadIllustrations } from '../game/illustrations';
import { startGamepad } from '../game/gamepad';
import { chooseBattleFormation, loadBattleBook, previewEffects, previewFormations, type EffectDef, type EffectEntry } from '../game/battle/book';
import { previewBattleStages } from '../game/battle/stage';
import { battleSettings } from '../game/battle/settings';
import type { BattlePresentationContext, BattlePresentationHook } from '../game/battle/presentation';
import { ensureParty, joinParty, resetParty, revive } from '../game/battle/party';
import * as dev from '../game/devMode';
import { DEV_WINDOW, expose, withdraw, type BattleEffectEditorWindow, type CameraEditorWindow } from '../dev/devWindow';
import { debugToolsShown, loadDevOptions } from '../game/devMode';
import { previewCameraCues, type CameraCueBook } from '../game/cameraCues';
import { GameOver, type BattleOutcome } from '../game/battle/flow';
import { createWalkAilments } from '../game/battle/walkAilment';
import { ailmentDef } from '../game/battle/book';
import { equipItem, memberStats, unequipItem } from '../game/battle/party';
import { applyUse, healLine, wouldHelp } from '../game/battle/heal';
import { itemList, itemName, itemPrice, itemSellPrice, itemUse } from '../game/items';
import { ShopScreen } from './shop/ShopScreen';
import { BattleView, type BattleStage } from './battle/BattleView';
import * as audio from '../game/audio';
import * as gameOptions from '../game/options';
import { applyMapSound, loadSoundBook, unlockAudio } from '../game/audio';
import { createEventBridge, type EventBridge } from '../game/uiEventContext';
import { readEventSpots, spotAhead, spotUnder, type EventSpot, type Landing } from '../game/eventSpots';
import { pickMapMove } from '../game/mapMoves';
import { readNpcs, npcShown, type NpcDef, TIME_PREFIX } from '../game/npcs';
import { facesOnTalk } from '../game/talkTurn';
import { layerKey, readSwitchLayers, switchLayerShown, type SwitchLayer } from '../game/layerSwitch';
import { mapEffectKey } from '../game/mapEffectSwitch';
import { applyEventVisit, forgetRespawn, NO_VISIT, rollEventVisit, type EventVisit } from '../game/eventVisit';
import { canRun, meets, runCommands, ReturnToTitle, timeMatches } from '../event/interpreter';
import type { EventCommand, EventDef, EventFile, IfCondition } from '../event/types';
import { mapNpcSettingsForFile, rollCompanions } from '../game/mapNpcs';
import type { MapDef } from '../mep3d/types';
import { MessageWindow } from './MessageWindow';
import { VirtualPad } from './VirtualPad';
import { Menu } from './menu/Menu';
import { CameraIllustrationLayer } from './CameraIllustrationLayer';
import { SettingsMenu } from './SettingsMenu';
import { TitleScreen } from './TitleScreen';
import { PwaInstall } from './PwaInstall';
import { fromSave, newState, resetState, restoreState, selfKey, spendItem, switchOn, toSave, type GameState } from '../game/state';
import { loadStoryBook, storyMeets, storyOrder } from '../game/story';
import { advanceClock, loadTimeSettings, timeSettings } from '../game/timeClock';
import { installFullscreenShortcut, isFullscreen, onFullscreenChange } from '../game/fullscreen';
import { AUTO_SLOT, readSave, writeSave } from '../game/save';
import { canWalk, useUi } from './store';
import { clearComic, useComic } from './comic';

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
/**
 * マップの名前（台帳の id。`village/home.json` → `home`）。イベントのファイル・その物の覚え・レイヤーの覚えはこれで引く。
 * **ファイル名から作らない**——フォルダ分け（GS-257）でファイルの道と id が別になった。台帳に無ければ `.json` を外したファイル名。
 * 台帳を読み終えてから呼ぶ（イベントを読む前に `loadMapIndex` を待つ）。
 */
const mapKey = (file: string) => knownSaveMapId(file);
/** 画面に出るのを待つ（GS-28）。React が描いた次の frame まで。 */
const painted = () =>
  new Promise<void>((done) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => done()));
  });
/** 歩いているあいだの毒の札を出しておく時間（ミリ秒。GS-71）。 */
const WALK_NOTE_MS = 2200;
/** 戦いの曲（GS-62）。`data/sounds.json` のキー。 */
// 戦闘の曲は戦闘共通の台帳（`battleSettings.json`。GS-106）が持つ。
/** デバッグの戦闘（GS-91）。味方が選択人数に足りなければこの順に足す。敵は 3 体。 */
const DEBUG_PARTY = ['meina', 'lamy', 'grandpa'];
/** デバッグの「アイテム」（GS-210）で 1 回に足す数。台帳の持ち物それぞれに。 */
const DEBUG_ITEM_COUNT = 2;
/** デバッグの「アイテム」で所持金をこの額にする（足すのではなく置き換える）。 */
const DEBUG_GOLD = 999999;
/** 開発用の時間帯ボタンの名前（GS-224）。ここに無い id（足したプリセット）はそのまま出す。 */
const DEBUG_TIME_LABELS: Record<string, string> = { '': '基準', morning: '朝', day: '昼', evening: '夕', night: '夜' };
const DEBUG_ENEMIES = ['enemy02', 'enemy00', 'enemy01'];
/** ゲームオーバーで黒くなるまで（ミリ秒）。**ゆっくり**——負けたことを飲み込む間を置く。 */
const GAME_OVER_FADE_MS = 1600;
/** 遊んだ秒を数える間隔（ミリ秒）。 */
// Alt+Enter でフルスクリーン（ブラウザ）。**どの受け手よりも先に**付ける（読み込んだときに 1 回）。
installFullscreenShortcut();

const CLOCK_MS = 1000;
/** タイトルから始めるとき、タイトルの曲を消していく時間（ミリ秒）。 */
const TITLE_BGM_FADE_MS = 400;

export default function GameCanvas() {
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GameView | null>(null);
  const cameraIllustrations = useCallback(() => viewRef.current?.cameraIllustrations() ?? [], []);
  const cameraPreviewRef = useRef(false);
  const bridgeRef = useRef<EventBridge | null>(null);
  const [notice, setNotice] = useState('');
  const [, refreshParty] = useState(0);
  /** デバッグのマップ移動（GS-216）。台帳（`maps.json`）の id と、セーブの一覧と同じ名前。クリア後にも出すので、いつも読んでおく（台帳は使い回し）。 */
  const [debugMaps, setDebugMaps] = useState<Array<{ key: string; label: string }>>([]);
  /** いま居るマップの番号。リストの選択に出す（`mapRef` は描き直しを起こさないので別に持つ）。 */
  const [debugMapAt, setDebugMapAt] = useState('');
  useEffect(() => {
    void loadMapIndex().then((index) =>
      setDebugMaps(Object.keys(index).map((key) => ({ key, label: mapLabel(index, key) }))),
    );
  }, []);
  /** 遊んだ記録（GS-27）。セーブに入るものはこの 1 つに集める。 */
  const stateRef = useRef<GameState>(newState());
  const phase = useUi((s) => s.phase);
  /** めくる絵を読ませている最中（GS-188）。仮想パッドを隠す。 */
  const comicReading = useComic((s) => Boolean(s.comic?.reading && !s.comic.closing));
  /** 仮想パッドを出すか（GS-214）。設定を変えたその場で効かせる。 */
  const [padShown, setPadShown] = useState(false);
  useEffect(() => {
    setPadShown(gameOptions.virtualPadShown());
    return gameOptions.onOptionsChanged(() => setPadShown(gameOptions.virtualPadShown()));
  }, []);
  const menu = useUi((s) => s.menu);
  /** イベントの最中か。デバッグの戦闘ボタンはこのあいだ出さない（GS-91）。 */
  const uiBusy = useUi((s) => s.busy);
  const settings = useUi((s) => s.settings);
  /** 画面に出している倍率（1280×720 の何倍か）。3D の描く細かさに渡す。 */
  const displayScaleRef = useRef(1);

  /**
   * 1280×720 の論理座標は変えず、端末に収まる倍率だけを外側へ適用する。
   * **拡大するのはフルスクリーンのときだけ**（縦横比は保ち、余りは黒い帯）。ふだんは 1280×720 を基準に作っているので
   * 等倍のまま出し、狭いときだけ縮める。ブラウザ自身の F11（Fullscreen API を通らない）も全画面として扱う。
   */
  useEffect(() => {
    let full = false;
    const fullMedia = window.matchMedia?.('(display-mode: fullscreen)');
    const fit = () => {
      const stage = stageRef.current;
      const screen = screenRef.current;
      if (!stage || !screen) return;
      const viewport = window.visualViewport;
      // visualViewport と CSS の表示領域が異なる端末でも、狭い方へ収める。
      const width = Math.min(stage.clientWidth, viewport?.width ?? stage.clientWidth);
      const height = Math.min(stage.clientHeight, viewport?.height ?? stage.clientHeight);
      const fits = Math.min(width / 1280, height / 720);
      const scale = full || fullMedia?.matches ? fits : Math.min(1, fits);
      screen.style.setProperty('--game-scale', String(scale));
      // 3D の描く細かさも合わせる（全画面で拡大しているときだけ上がる）。
      displayScaleRef.current = scale;
      viewRef.current?.setDisplayScale(scale);
    };
    fit();
    let alive = true;
    void isFullscreen().then((on) => {
      if (!alive) return;
      full = on;
      fit();
    });
    const stopFull = onFullscreenChange((on) => {
      full = on;
      fit();
    });
    fullMedia?.addEventListener('change', fit);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    observer.observe(stageRef.current!);
    return () => {
      alive = false;
      stopFull();
      fullMedia?.removeEventListener('change', fit);
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, []);

  /** 今のマップの起動場所とイベント。マップが変わるたび読み直す。 */
  const spotsRef = useRef<EventSpot[]>([]);
  const eventsRef = useRef<Map<string, EventDef>>(new Map());
  /** NPC の名前 → 話しかけたときのイベント id（GS-16）。 */
  const npcTalkRef = useRef<Map<string, string>>(new Map());
  /** いま立っている起動場所。**出るまで二度と起こさない**ための控え。 */
  const steppingRef = useRef('');
  const mapRef = useRef('');
  /** いまのマップでは時計を止めるか（GS-223。`maps.json` の `time.stopClock`）。 */
  const stopClockRef = useRef(false);
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
  /**
   * 背景だけの戦闘か（GS-219。戦闘演出エディタのプレビュー）。戦いは進めず、舞台と敵を出しておくだけ。
   * `backdropSeqRef` は出し直しの合図——同じ敵で出し直しても戦闘画面を作り直す。
   */
  const battleBackdropRef = useRef(false);
  const backdropSeqRef = useRef(0);
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
   * カメラ演出の割り当ては凍結した。**戦闘開始は戦闘の舞台の台帳の構図でカメラを動かす**（`battleStages.json` の `start`。
   * マップごと。2026-10-19 / BPE-30）——カメラエディタの台帳（イベント用）は引かない。
   */
  const presentBattle = useCallback((hook: BattlePresentationHook, context: BattlePresentationContext = {}) => {
    window.dispatchEvent(new CustomEvent('battle-presentation', { detail: { hook, key: hook, cue: '', subject: context.subject ?? '' } }));
    if (hook === 'battle.start') {
      try {
        return viewRef.current?.playBattleStart() ?? 0;
      } catch (error) {
        console.warn(`[battle-presentation] ${hook}:`, error);
        return 0;
      }
    }
    return 0;
  }, []);

  /**
   * 戦闘を始めて、決着が付くまで待つ（GS-60）。
   * `canLose` は「負けても話が続くか」——`battle` 命令に `lose` の枝が書いてあるか。
   * **書いていなければ負け＝ゲームオーバー**で、`GameOver` を投げてイベントを止める。
   */
  const startBattle = useCallback(
    async (enemies: string[], canLose: boolean, formation?: string) => {
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
            void gameOverRef.current().then(() => reject(new GameOver()), reject);
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
   * デバッグ用の戦闘（GS-91）。現在の編成で戦い、負けても続く。
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
    battleBackdropRef.current = false;
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
    audio.playSe(battleSettings().se.item);
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
  const titleTransitionRef = useRef<Promise<void> | null>(null);
  const returnToTitle = useCallback((ms = 0): Promise<void> => {
    if (titleTransitionRef.current) return titleTransitionRef.current;
    const transition = async () => {
      const ui = useUi.getState();
      ui.setBusy(true);
      ui.setMenu(false);
      ui.setFade(1, ms);
      audio.stopBgm(ms);
      audio.stopBgs(ms);
      autoPendingRef.current = false;
      if (ms > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, ms + 200));
      viewRef.current?.stopCameraCue();
      battleAbortRef.current?.abort();
      battleAbortRef.current = null;
      battleEndRef.current = null;
      battleFormationRef.current = undefined;
      battleBackdropRef.current = false;
      ui.setBattle(null);
      ui.setShop(null);
      ui.setSettings(false);
      ui.setTalk(null);
      ui.setScroll(null);
      ui.setTelop(null);
      ui.setChoices(null);
      ui.clearPortraits();
      ui.setFade(1, 0);
      ui.setPhase('title');
      ui.setBusy(false);
    };
    titleTransitionRef.current = transition().finally(() => { titleTransitionRef.current = null; });
    return titleTransitionRef.current;
  }, []);
  const gameOverRef = useRef(() => returnToTitle(GAME_OVER_FADE_MS));

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
   * いまのマップの NPC ぜんぶ（GS-130）。出す条件（台帳 `mapNpcs.json` の `showWhen` など）は
   * **スイッチが変わったら見直す**ので、条件を持ったまま控えておく。
   */
  const npcDefsRef = useRef<NpcDef[]>([]);
  /** もう消した NPC。二度消さないための覚え。 */
  const npcHiddenRef = useRef<Set<string>>(new Set());
  /** 時間帯（`ShowIn`。GS-222）だけで隠した NPC。時間帯が戻ったら出し直す。 */
  const npcTimeHiddenRef = useRef<Set<string>>(new Set());
  /** いま当てている見た目（GS-133）。同じものを毎回指し直さないための覚え。 */
  const npcPoseRef = useRef<Map<string, string>>(new Map());
  /**
   * 入ったときに決めた、入るたびに出るかが変わる物（イベントの `respawn` / `chance`。GS-233）。
   * `GameView` がマップを組む前に決め、起動場所を読むとき（`adopt`）にも同じ結果を使う——
   * 2 回引くと、見えている宝箱と調べられる宝箱がずれる。
   */
  const visitRef = useRef<{ name: string; visit: EventVisit }>({ name: '', visit: NO_VISIT });
  /**
   * いま組んでいる（組み終えた）マップのイベント（GS-195）。**3D 側がマップを組む前に読んでおく**——
   * 起動場所を読む `adopt`（`eventsRef`）はマップを組んだ後に動くので、先に読んだ物を渡す。
   */
  const eventBookRef = useRef<{ file: string; events: EventFile | null }>({ file: '', events: null });
  /** そのマップのイベントを読む。無いマップは台帳で分かるので取りに行かない（DEC-374）。 */
  const fetchEvents = async (file: string): Promise<EventFile | null> => {
    await loadMapIndex();
    const name = mapKey(file);
    const index = await loadFileIndex();
    if (!index.hasEvents(name)) return null;
    return fetch(assetUrl(`data/events/${name}.json`))
      .then((response) => (response.ok ? (response.json() as Promise<EventFile>) : null))
      .catch(() => null);
  };
  /** マップを組む前に呼ぶ（GS-195）。 */
  const readEventsAhead = async (file: string) => {
    // 物語の段階の台帳（GS-254）も一緒に。条件は同期で見るので、マップのイベントより先に読んでおく（2 回目からは読まない）。
    const [events] = await Promise.all([fetchEvents(file), loadStoryBook()]);
    eventBookRef.current = { file, events };
  };
  /**
   * スイッチを聞く口。3D 側（`GameView`）にも同じ物を渡す。
   * **`self:` で始めると「その物自身の覚え」**（GS-134）——同じイベントを何個の宝箱で使っても、
   * 開けた覚えは物ごとに分かれる。頭が無ければ今までどおり通しのスイッチ。
   */
  const switchOnRef = useRef((key: string, owner?: string) => {
    // `time:<id,id>` は**いまの時間帯がどれか**（GS-222。NPC の `ShowIn`）。見るのは画面が出し分けに
    // 使っている時間帯（切り替えの半分で移る）。時間帯なし（基準）ではすべて出す。
    if (key.startsWith(TIME_PREFIX)) {
      const now = viewRef.current?.shownTime() ?? '';
      if (!now) return true;
      return key.slice(TIME_PREFIX.length).split(',').map((part) => part.trim()).includes(now);
    }
    // 通しのフラグは**書いていなければ false**（GS-254）。
    if (!key.startsWith('self:')) return switchOn(stateRef.current, key);
    if (!owner) return false;
    return stateRef.current.self.get(selfKey(mapKey(mapRef.current), `@${owner}`, key.slice(5))) ?? false;
  });

  /**
   * NPC の出す条件（台帳 `mapNpcs.json` の `showWhen`。GS-230）を満たすか。**イベントの条件と同じ決まり**
   * （`interpreter.ts` の `meets`）——スイッチ・覚え（その 1 体自身の）・変数・持ち物・所持金・時間帯。全部満たせば当たり。
   * `ignoreTime` は時間帯の条件を満たした扱いにする（時間帯だけで隠した人を見分ける。`checkNpcShown`）。
   */
  const npcMeetsRef = useRef((when: IfCondition[], owner: string, ignoreTime = false): boolean => {
    const state = stateRef.current;
    return when.every((one) => {
      if ('story' in one) return storyMeets(storyOrder(), state.story, one.story, one.is);
      if ('switch' in one) return switchOn(state, one.switch) === (one.is ?? true);
      if ('self' in one) return (state.self.get(selfKey(mapKey(mapRef.current), `@${owner}`, one.self)) ?? false) === (one.is ?? true);
      if ('item' in one) return (state.items.get(one.item) ?? 0) >= (one.count ?? 1);
      if ('gold' in one) return state.gold >= one.gold;
      if ('time' in one) return ignoreTime || timeMatches(state.time, one.time);
      const left = state.variables.get(one.variable) ?? 0;
      const right = one.value;
      if (one.op === '==') return left === right;
      if (one.op === '!=') return left !== right;
      if (one.op === '>=') return left >= right;
      if (one.op === '<=') return left <= right;
      if (one.op === '>') return left > right;
      return left < right;
    });
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
  const BLOCKING = new Set(['message', 'choice', 'scroll', 'returnToTitle']);

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
          ...(command.elif
            ? { elif: command.elif.map((arm) => ({ ...arm, then: quietCommands(arm.then, dropped) })) }
            : {}),
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
    if (useUi.getState().phase !== 'play' || titleTransitionRef.current) return;
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
          if (!(error instanceof ReturnToTitle)) console.error('[event] 並行 ' + event.id + ' が止まりました', error);
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
   *
   * `soundAfterPaint` はタイトルから始めたとき。曲は**読み込み終えて画面が出始めてから**鳴らす
   * （黒い読み込みのあいだに鳴り出さないように）。ほかのマップ移動は今までどおり読み込んだところで替える
   * ——同じ曲なら切れずに続く。
   */
  const goTo = useCallback(async (map: string, landing: Landing, face: WalkDir | '', fade = true, soundAfterPaint = false) => {
    const view = viewRef.current;
    if (!view) return;
    // 入口をくぐるときは暗転を挟む（GS-21）。旧作と同じ間の取り方で、読み込みの間も隠せる。
    if (fade) {
      useUi.getState().setBusy(true);
      // 読み込みを隠せるよう、暗転の完了を待ってからマップを差し替える。
      // **もう暗転しきっていれば待たない**（セーブの読み込みは先に暗転してから記録を戻す）。
      if (useUi.getState().fade < 1) {
        useUi.getState().setFade(1, DOOR_FADE_MS);
        await new Promise((done) => window.setTimeout(done, DOOR_FADE_MS));
      }
    }
    try {
      // 行き先はマップの id（`home_forest`）。台帳で引き当てる（`.json` 付きのファイル名でもよい）。
      const entry = await mapEntryOf(map);
      const file = entry.file;
      await readEventsAhead(file);
      await view.load(file);
      // そのマップの曲と環境音（GS-21）。同じ曲なら切れずに続く。
      if (!soundAfterPaint) applyMapSound(entry);
      // 着地。座標が書いてあればそこ、目印の名前ならその点、どちらも無ければマップの `default`。
      if (landing.at) view.placePlayer(landing.at.x, landing.at.y, landing.at.z, landing.px);
      else if (landing.marker) view.placeAtMarker(landing.marker, landing.px);
      if (face) view.face(face);
      await adoptRef.current(file);
      if (fade) await view.waitForRenderedFrame();
      if (fade) {
        // 黒いうちに、踏んでいる場所のイベントを起こす。
        useUi.getState().setBusy(false);
        // 曲はイベントより先に当てる——踏んで起きるイベントが曲を指していれば、そちらが勝つ。
        if (soundAfterPaint) applyMapSound(entry);
        checkSpotsRef.current();
        await painted();
        useUi.getState().setFade(0, DOOR_FADE_MS);
      } else if (soundAfterPaint) {
        applyMapSound(entry);
      }
      setNotice('');
    } catch (error) {
      setNotice(`マップ移動に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      if (fade) {
        useUi.getState().setBusy(false);
        useUi.getState().setFade(0, DOOR_FADE_MS);
      }
    }
  }, []);

  /**
   * イベントを 1 本動かす。動いているあいだは歩けない。
   * `self` は話しかけた相手（GS-16）。イベントの `this` はこの人を指す。
   */
  const play = useCallback(async (event: EventDef, npc = '', carry: { owner?: string } = {}) => {
    const bridge = bridgeRef.current;
    if (!bridge || useUi.getState().busy || useUi.getState().phase !== 'play') return;
    useUi.getState().setBusy(true);
    // どのイベントを動かしているかを先に伝える（GS-27）。セルフスイッチの宛先になる。
    // `carry.owner` は起こした物の `Id`（GS-134）。物ごとの覚えの宛先。
    bridge.setScene({ npc, map: mapKey(mapRef.current), event: event.id, owner: carry.owner });
    try {
      await runCommands(event.commands, bridge.ctx);
    } catch (error) {
      // **ゲームオーバーはエラーではない**（GS-60）。ここで話が終わっただけなので、
      // 赤い印を出さずに片付けへ進む。
      if (!(error instanceof GameOver) && !(error instanceof ReturnToTitle)) throw error;
    } finally {
      viewRef.current?.stopCameraCue();
      // カメラ追従は既定へ戻す（GS-166）。切ったまま歩き出すと、画面が付いてこない。
      viewRef.current?.setCameraFollow(true);
      // 置いた仲間は隊列へ戻す（GS-184）。留めたままだと、歩き出しても付いて来ない。
      viewRef.current?.releaseFollowers();
      bridge.setScene({});
      useUi.getState().setTalk(null);
      useUi.getState().setChoices(null);
      // 立ち絵は**イベントと一緒に片付ける**（GS-20）。出しっぱなしで歩き出すと直せない。
      useUi.getState().clearPortraits();
      // めくる絵も同じ（GS-188）。閉じ忘れても次のイベントに残らない。
      clearComic();
      // 感情マーク（GS-267）も。出したままにしたマークを歩き出しに持ち越さない。
      viewRef.current?.clearEmotes();
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
      setDebugMapAt(knownSaveMapId(file));
      // 台帳は 1 回読んで使い回すので、ここは待っても速い。
      const mapEntry = await entryForFile(file);
      // このマップでは時計を止めるか（GS-223）。
      stopClockRef.current = mapEntry?.time?.stopClock === true;
      // イベントの有無は**台帳で決める**（DEC-374）。無いマップを取りに行かない。
      // 組む前に読んであればそれを使う（GS-195）。読み直すと、組んだ時と条件の元がずれる。
      const ahead = eventBookRef.current.file === file ? eventBookRef.current.events : undefined;
      const [rawMap, events] = await Promise.all([
        fetch(mapUrl(file)).then((response) => response.json() as Promise<MapDef>),
        ahead !== undefined ? ahead : fetchEvents(file),
      ]);
      eventBookRef.current = { file, events };
      // 入ったときに決めたこと（GS-233）と同じマップを見る。出なかった物の調べる枠を作らない。
      const visit = visitRef.current.name === file ? visitRef.current.visit : NO_VISIT;
      const map = applyEventVisit(rawMap, visit);
      spotsRef.current = readEventSpots(map).filter((spot) => !visit.absent.has(spot.event));
      // **着いた先が入口の上でも、そこからは動かさない**（DEC-247）。
      // 着いた立ち位置（イベント JSON の `mapMoves`。GS-211）が入口の枠に重なっていると、着いた瞬間にまた飛んで
      // 2 枚のマップを往復し続ける（実測: 家 ⇔ 森が止まらなくなった）。
      // いったんその枠から**出るまで**次の移動を受け付けない。踏んで動くイベントはこの限りではない
      // ——出発点がイベントの枠の中にあるマップ（家のオープニング）が動かなくなる。
      {
        const view = viewRef.current;
        const at = view?.playerAt();
        const here = view && at ? spotUnder(spotsRef.current, at, view.playerRadius()) : null;
        steppingRef.current = here?.mapMoves.length ? here.objectId : '';
      }
      // 出す条件（GS-130）を満たす人だけを相手にする。**3D 側も同じ条件で作らない**ので、
      // 話しかけ先も敵シンボルもここで揃えておかないと「居ないのに触れる」が起きる。
      // 最初は出さない・出す条件はそのマップの NPC の設定（台帳 `mapNpcs.json`。GS-230）から。
      npcDefsRef.current = readNpcs(map, mapNpcSettingsForFile(file));
      npcHiddenRef.current = new Set();
      npcTimeHiddenRef.current = new Set();
      // 見た目の覚えはマップごと（GS-133）。作り直した板には当て直す。
      npcPoseRef.current = new Map();
      // イベントで出し入れするレイヤー（GS-233）。**読み込み時の形は 3D 側が決めている**ので、
      // ここではどちらを出しているかを控え直すだけ。控えが無いと、次の見張りで全部当て直す。
      switchLayersRef.current = readSwitchLayers(map);
      switchShownRef.current = new Map();
      checkSwitchLayersRef.current();
      const npcList = npcDefsRef.current.filter((npc) =>
        npcShown(npc, (key) => switchOnRef.current(key, npc.id), (when) => npcMeetsRef.current(when, npc.id)),
      );
      npcTalkRef.current = new Map(npcList.map((npc) => [npc.id, npc.event]));
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
      // 出す条件（GS-230）を、イベントを読み終えたところでもう一度見る。
      checkNpcShownRef.current();

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
      party: () => stateRef.current.party,
      switchOn: (key, owner) => switchOnRef.current(key, owner),
      npcMeets: (when, owner) => npcMeetsRef.current(when, owner),
      // マップに入るたびに戻るイベント（GS-233）。**組む前に**覚えを消し、出るかを決める。
      // イベントは組む前に読んである（GS-195。`readEventsAhead`）。
      prepareMap: (name, map) => {
        const book = eventBookRef.current;
        const events = book.file === name ? (book.events?.events ?? []) : [];
        forgetRespawn(stateRef.current.self, mapKey(name), events, readEventSpots(map));
        const visit = rollEventVisit(map, events);
        visitRef.current = { name, visit };
        return applyEventVisit(map, visit);
      },
      // レイヤーの出し入れの覚え（GS-233）。組んでいるマップの分。
      layerState: (name, id) => stateRef.current.self.get(layerKey(mapKey(name), id)),
      // マップのエフェクトの出し入れの覚え（GS-270）。組んでいるマップの分。
      effectState: (name, id) => stateRef.current.self.get(mapEffectKey(mapKey(name), id)),
    });
    viewRef.current = view;
    view.setDisplayScale(displayScaleRef.current);
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
    // 敵・技・はじめの仲間の台帳（GS-60）。数値だけで、いまの HP はセーブが持つ。
    void loadBattleBook();
    // 時間帯と時計の台帳（GS-222 / GS-223）。**起動時に読む**——「はじめから」「つづきから」を通らない道
    // （エディタのプレビュー）でも、時計と切り替えの時間が台帳のとおりになるように。
    void loadTimeSettings();
    void loadIllustrations().catch((error) => console.warn('[illustrations]', error));
    const onFirstInput = () => unlockAudio();
    window.addEventListener('keydown', onFirstInput);
    window.addEventListener('pointerdown', onFirstInput);

    // 開発中だけ外へ出す口。一覧と型は `dev/devWindow.ts`（2026-10-06）。
    if (DEV_WINDOW) {
      expose('__game', view);
      expose('__audio', audio);
      expose('__options', gameOptions);
      expose('__dev', dev);
      // 画面の状態（`busy` など）も開発中に見たい。**見えないものは直せない**——
      // 「歩けないのはイベントの最中だからか、別の理由か」がこれで分かる。
      expose('__ui', useUi);
      /**
       * イベントエディタから 1 本走らせる口（GS-37）。
       *
       * 渡された命令をそのまま動かす——`when`（動く条件）は見ない。
       * 書いた中身を確かめるための口なので、スイッチの都合で動かないと役に立たない。
       * 保存していない下書きもそのまま渡せる（エディタが持っている JSON を送るだけ）。
       */
      expose('__preview', {
        // `carry.owner` は起こした物の `Id`（GS-233）。下書きを試すときに覚えの宛先を手で渡せる。
        play: (event, npc = '', carry = {}) => playRef.current(event, npc, carry),
        // フラグを確認のために書き換える（GS-206。イベントエディタの「フラグ（確認用）」）。
        // 書いてあるフラグだけ返す——書いていなければ false（`switchOn`）。`null` で書いていない状態へ戻す。
        // **ゲームの記録（遊んでいる間の状態）だけ**を変える。イベント JSON は触らない。
        flags: () => Object.fromEntries(stateRef.current.switches),
        setFlag: (key, value) => {
          if (value === null) stateRef.current.switches.delete(key);
          else stateRef.current.switches.set(key, value);
          // フラグで出る人（`showWhen`。GS-230）を見直す。
          checkNpcShownRef.current();
        },
        // 物語の段階を確認のために合わせる（GS-254。イベントエディタの「段階（確認用）」）。記録だけを変える。
        story: () => stateRef.current.story,
        setStory: (step) => {
          stateRef.current.story = step;
          checkNpcShownRef.current();
        },
        // マップ移動を試す（GS-211。イベントエディタの「マップ移動」）。**踏んだときと同じ決め方・同じ道**で移る。
        // 保存していない下書き（`def`）をそのまま受ける。行き先のマップ番号を返す（動かなければ空）。
        mapMove: async (destinations, def) => {
          const bridge = bridgeRef.current;
          if (!bridge) return '';
          const choice = pickMapMove(destinations, def, (when) => meets(bridge.ctx, when));
          if (!choice) return '';
          await goTo(choice.map, choice.landing, choice.face, true);
          return choice.map;
        },
      });
      const idle = () => {
        const ui = useUi.getState();
        if (!bridgeRef.current) throw new Error('ゲームの初期化を待ってください');
        if (ui.busy || ui.battle || ui.menu || ui.shop) throw new Error('実行中の場面を終了してください');
      };
      const cameraEditor: CameraEditorWindow = {
        async prepare(file: string) {
          idle();
          view.unstageBattle();
          cameraPreviewRef.current = true;
          autoPendingRef.current = false;
          await Promise.all([loadBattleBook(), loadCharacterBook(), loadIllustrations(), loadStoryBook()]);
          resetParty(stateRef.current);
          useUi.getState().setPhase('play');
          useUi.getState().setFade(0, 0);
          await readEventsAhead(file);
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
        // マス目と、押したマスの知らせ（GS-167）。**カメラエディタ専用**——
        // 遊ぶ画面では出ないし、拾い先を入れないかぎりクリックは今までどおり。
        grid: (on: boolean) => view.setEditorGrid(on),
        pickCell: (handler: ((cell: { x: number; y: number; z: number }) => void) | null) =>
          view.setCellPicker(handler),
        // 戦闘（ビルボード仮配置・戦闘の実行）はカメラエディタから削除した（GS-115。カメラ演出はイベント用）。
        async event(id: string) {
          idle(); view.unstageBattle();
          const event = eventsRef.current.get(id);
          if (!event) throw new Error(`イベントがありません: ${id}`);
          await playRef.current(event, event.npc ?? '');
        },
      };
      expose('__cameraEditor', cameraEditor);
      // 戦闘演出エディタ（アニメーション演出。GS-105）の開発用入口。技の絵（`effects.json`）の下書きを差し替えて試す。
      // プレビューは**背景だけの戦闘**（GS-219）——舞台と敵を出し、戦いは進めずに絵だけ重ねる。
      const clearBackdrop = () => {
        if (!battleBackdropRef.current) return;
        battleAbortRef.current?.abort();
        endBattle('escape');
      };
      const battleEffectEditor: BattleEffectEditorWindow = {
        async prepare(file: string) {
          clearBackdrop();
          await cameraEditor.prepare(file);
        },
        setEffects: (next: Record<string, EffectEntry>) => previewEffects(next),
        async backdrop(enemies: string[]) {
          clearBackdrop();
          idle();
          if (enemies.length === 0) throw new Error('背景に出す敵を選んでください');
          await loadBattleBook();
          // 舞台の決め方はふつうの戦闘と同じ（隊形はマップの候補から。場所は BattleStage → default → 原点）。
          const entry = await entryForFile(mapRef.current);
          battleFormationRef.current = chooseBattleFormation(undefined, entry?.battleStage?.formations);
          battleAbortRef.current = new AbortController();
          battleEndRef.current = null;
          battleBackdropRef.current = true;
          backdropSeqRef.current += 1;
          useUi.getState().setBattle(enemies);
          return view.battleStage(battleFormationRef.current)?.source ?? 'origin';
        },
        clearBackdrop,
        // 戦闘の舞台（2026-10-19 / BPE-30）。下書きの台帳を差し替え、出している背景の舞台を組み直す。
        setStages: (next: unknown) => previewBattleStages(next),
        setFormations: (next: unknown) => previewFormations(next),
        restage(options) {
          if (!battleBackdropRef.current) return null;
          return view.restageBattle(options);
        },
        showCells: (on: boolean) => view.showStageCells(on),
        replayStart: () => view.playBattleStart(),
        playEffect(def: EffectDef) {
          if (!useUi.getState().battle) return false;
          window.dispatchEvent(new CustomEvent('battle-effect-preview', { detail: { def } }));
          return true;
        },
      };
      expose('__battleEffectEditor', battleEffectEditor);
    }

    return () => {
      window.removeEventListener('keydown', onFirstInput);
      window.removeEventListener('pointerdown', onFirstInput);
      viewRef.current = null;
      withdraw('__cameraEditor', '__battleEffectEditor');
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
        transfer: (
          map: string,
          at: { x: number; y: number; z: number } | null,
          face?: WalkDir,
          fade?: boolean,
          px?: { x: number; y?: number; z: number },
        ) => goTo(map, { marker: '', at, ...(px ? { px } : {}) }, face ?? '', fade),
        battle: (enemies: string[], canLose: boolean, formation?: string) =>
          startBattleRef.current(enemies, canLose, formation),
        shop: (goods: string[], sell: boolean) => startShopRef.current(goods, sell),
        returnToTitle: () => returnToTitle(400),
        // スイッチが動いたら、見た目をその場で合わせる（GS-136）。見張り（100ms ごと）でも
        // 同じことをしているが、**宝箱は押したその瞬間に開いていてほしい**——
        // 待つと、開いた絵よりメッセージのほうが先に出る。
        onSwitch: () => {
          checkNpcShownRef.current();
          checkNpcPoseRef.current();
          checkSwitchLayersRef.current();
        },
        knownLayer: (id: string) => switchLayersRef.current.some((layer) => layer.ids.includes(id)),
      };
      bridgeRef.current = createEventBridge(options);
      /**
       * 並行イベント専用の橋（GS-43）。**手前のイベントと分ける。**
       * 橋は「いまどのイベントの話か」を自分の中に持つ（セルフスイッチの宛先）ので、
       * 1 本を two つの流れで使い回すと、**片方の覚えがもう片方へ書き込まれる**。
       */
      parallelBridgeRef.current = createEventBridge(options);
      // 開発中だけ外から叩けるようにする。イベントを 1 命令ずつ試すのに使う。
      expose('__event', bridgeRef.current);
      // 3D の口も出しておく。**居る場所や向きを外から聞ける**と、
      // 起動場所の当たり（入口・調べ物）を調べるのが速い。
      expose('__view', () => viewRef.current);
      // 戦闘を 1 回試す口（GS-60）。**負けても話は終わらせない**（`canLose`）——
      // 試している最中にタイトルへ戻されると、続けて試せない。
      expose('__battle', (ids) => startBattleRef.current(ids, true));
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
    if (!view || !bridge || useUi.getState().busy || useUi.getState().phase !== 'play') return;
    // 時間帯の切り替え中は踏むイベント・マップ移動を起こさない。踏んだ印も付けないので、
    // 立ったままなら切り替えが終わったところで起きる。
    if (view.timeShifting()) return;
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
    if (spot.mapMoves.length) {
      // 行き先の候補はマップ（`MapMove`）、条件・立ち位置・向きはイベント JSON の `mapMoves`（GS-211）。
      const book = eventBookRef.current;
      const def = book.file === mapRef.current ? book.events?.mapMoves?.find((one) => one.object === spot.moveObject) : undefined;
      const choice = pickMapMove(spot.mapMoves, def, (when) => meets(bridge.ctx, when));
      if (!choice) return;
      // **着いてから**覚える（GS-33）。移る前に書くと、戻したとき入口の上に立っていて、
      // またそのまま向こうへ吸い込まれてしまう。
      void goTo(choice.map, choice.landing, choice.face, true).then(() => {
        autoPendingRef.current = true;
      });
      return;
    }
    const event = eventsRef.current.get(spot.event);
    if (event && event.trigger === 'touch' && runnableRef.current(event, spot.owner)) void play(event, '', { owner: spot.owner });
  }, [play, goTo]);
  const checkSpotsRef = useRef(checkSpots);
  checkSpotsRef.current = checkSpots;

  /**
   * 敵シンボルに触ったら戦う（GS-76）。**歩けるときだけ見る**——
   * 会話や戦闘の最中に見ると、話し終わった瞬間に始まってしまう。
   *
   * 触った判定は**マスで数える**（`npcTouching`。GS-209）。体がマスの四角になり（GS-116）、
   * 相手のマスの手前で止まるので、中心どうしの距離（旧 0.9 マス）には届かなかった。
   * 踏ませる形にすると、うろつく相手（GS-48）の足元へ乗り込まないと当たらない。
   */
  const checkSymbols = useCallback(() => {
    const view = viewRef.current;
    const at = view?.playerAt();
    if (!view || !at) return;
    if (!canWalk(useUi.getState())) return;
    // 時間帯の切り替え中は戦闘を始めない（触ったままなら終わったところで始まる）。
    if (view.timeShifting()) return;

    let near = '';
    for (const [id] of symbolsRef.current) {
      if (view.npcTouching(id)) {
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
    // お供（GS-255）。台帳 `mapNpcs.json` のこの 1 体の `companions` を行ごとに抽選し、触った相手の後ろに並べる。
    const companions = rollCompanions(mapNpcSettingsForFile(mapRef.current)[near]?.companions);
    void startBattleRef.current([enemy, ...companions], false).catch((error) => {
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
    // イベント中は**時間帯による出し入れを保留する**。話の途中で時間帯が移っても、話し相手が消えたり
    // 誰かが湧いたりしない。終わった次の見回りでまとめて合わせる。スイッチなどで消すのは今までどおりその場で。
    const holdTime = useUi.getState().busy;
    for (const def of npcDefsRef.current) {
      const shown = npcShown(def, (key) => switchOnRef.current(key, def.id), (when) => npcMeetsRef.current(when, def.id));
      // 時間帯だけで隠した人（GS-222）。**時間帯が戻ればその場に出し直す**——ほかの条件（`showWhen` など）で
      // 現れるのはマップを読み直したときだけ（下の約束）だが、時間帯は歩いている間に移るので待てない。
      const otherwise = npcShown(
        def,
        (key) => (key.startsWith(TIME_PREFIX) ? true : switchOnRef.current(key, def.id)),
        (when) => npcMeetsRef.current(when, def.id, true),
      );
      // 時間帯だけで出入りが決まる人は、保留中は**いま居る・居ないのまま**にしておく。
      // 出し入れが要らない人（読み込み直後でまだ作っていない人など）は今までどおり控えを揃える。
      if (holdTime && otherwise && shown !== view.hasNpc(def.id)) continue;
      if (shown && npcTimeHiddenRef.current.has(def.id)) {
        npcTimeHiddenRef.current.delete(def.id);
        view.restoreNpc(def.id);
      }
      if (!shown && otherwise) npcTimeHiddenRef.current.add(def.id);
      if (npcHiddenRef.current.has(def.id)) {
        // **イベントが置き直して出した人**（`place`）は、話しかけ先も戻す（GS-193）。
        // 戻さないと、見えているのに吹き出しが出ず、話しかけても何も起きない。
        if (shown && view.hasNpc(def.id)) {
          npcHiddenRef.current.delete(def.id);
          // 読み込み時と同じ決め方——イベント側の結び付け（後に書いたもの）が勝つ。
          const bound = [...eventsRef.current.values()].filter((entry) => entry.npc === def.id).pop();
          const eventId = bound?.id ?? def.event;
          if (eventId) npcTalkRef.current.set(def.id, eventId);
          if (def.enemy) symbolsRef.current.set(def.id, def.enemy);
        }
        continue;
      }
      if (shown) continue;
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
   * イベントで出し入れするレイヤー（GS-233）。このマップのものと、いま出しているか。
   * **マップごと**——組み直したら読み込み時の形から始まる。
   */
  const switchLayersRef = useRef<SwitchLayer[]>([]);
  const switchShownRef = useRef(new Map<string, boolean>());

  /**
   * レイヤーの出し入れ（命令 `layer`。GS-233）を見た目に合わせる。**覚えから毎回決める**ので、
   * マップを読み直しても出し入れしたまま。
   */
  const checkSwitchLayers = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const map = mapKey(mapRef.current);
    for (const layer of switchLayersRef.current) {
      const shown = switchLayerShown(layer, (id) => stateRef.current.self.get(layerKey(map, id)));
      if (switchShownRef.current.get(layer.layer) === shown) continue;
      switchShownRef.current.set(layer.layer, shown);
      view.setLayerShown(layer.layer, shown);
    }
  }, []);
  const checkSwitchLayersRef = useRef(checkSwitchLayers);
  checkSwitchLayersRef.current = checkSwitchLayers;

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
      // 見た目の出し入れは**エディタのプレビュー中も見る**——時間帯を変えたら NPC がその場で
      // 出入りしてほしい（`ShowIn`。GS-222）。止めると、入り直すまで変わらない（GS-266）。
      // 出す条件が崩れた NPC（GS-130）。**`busy` でも見る**——イベントの中でスイッチが入り、
      // その場で消えてほしいことがある（倒したイベント敵）。
      checkNpcShownRef.current();
      // スイッチで変わる見た目（GS-133）。**`busy` でも見る**——開けたその場で絵が変わる。
      checkNpcPoseRef.current();
      // イベントで出し入れするレイヤーも同じ（GS-233）。
      checkSwitchLayersRef.current();
      // ここから下は遊ぶ画面だけ（起動場所・敵シンボル・毒・並行イベント・オートセーブ）。
      if (cameraPreviewRef.current) return;
      checkSpotsRef.current();
      // 敵シンボル（GS-76）。起動場所と同じ間隔で見る。
      checkSymbolsRef.current();
      // 歩いているあいだの毒（GS-71）。同じ間隔で見る。
      checkWalkAilmentsRef.current();
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
      // 時間帯を切り替えている途中は話しかけ・調べ物を受け付けない（歩くのは止めない）。
      // 途中で始めると、見た目の時間帯が半分で移ったときに話し相手が消えてしまう。
      if (viewRef.current?.timeShifting()) return;
      const view = viewRef.current;
      const bridge = bridgeRef.current;
      if (!view || !bridge) return;
      // まず**目の前の相手**（GS-16）。話しかけるのは足元ではなく向いた先。
      const who = view.npcInFront();
      const talk = who ? eventsRef.current.get(npcTalkRef.current.get(who) ?? '') : undefined;
      if (who && talk && talk.trigger === 'action' && runnableRef.current(talk, who)) {
        const def = npcDefsRef.current.find((npc) => npc.id === who);
        // 話しかけられた人はこちらを向く（GS-118）。イベントが `turn` で向きを指すなら、
        // そちらが後から上書きする。**`noTurn` のイベントは向かない**（GS-252）。
        if (facesOnTalk(talk)) view.faceNpcToPlayer(who);
        void play(talk, who, { owner: def?.id });
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
          // `Id` を**話し相手として**渡す（GS-55）。物の名前は目印なので使わない（GS-233）。
          // 人ではないので `walk` や `pose` の相手にはならない——やれば警告が出る。
          void play(found, look.owner, { owner: look.owner });
          return;
        }
      }
      const spot = spotUnder(spotsRef.current, at, view.playerRadius());
      if (!spot?.event) return;
      const event = eventsRef.current.get(spot.event);
      if (event && event.trigger === 'action' && runnableRef.current(event, spot.owner)) void play(event, '', { owner: spot.owner });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play]);

  /**
   * 時計（GS-222）。実時間で 朝 → 昼 → 夕 → 夜 → 朝… と進める。**歩ける間だけ**進む——
   * 会話・イベント・戦闘・メニューの間は止まる（話の途中で夜になると、書いた人の思った場面と変わる）。
   * 進んだら見た目は画面が混ぜて移す（`setTime`）。長さ・順番は台帳 `timeSettings.json`。
   */
  useEffect(() => {
    if (phase !== 'play') return;
    const timer = window.setInterval(() => {
      if (!canWalk(useUi.getState())) return;
      const state = stateRef.current;
      // このマップでは時計を止める（GS-223。`maps.json` の `time.stopClock`）。
      if (stopClockRef.current) return;
      const next = advanceClock(state.time, state.clock, timeSettings(), CLOCK_MS);
      if (next === null) return;
      state.time = next;
      viewRef.current?.setTime(next, timeSettings().shiftMs);
      // 開発用の時間帯ボタン（GS-224）の押された印を合わせる。
      if (debugToolsShown()) refreshParty((value) => value + 1);
    }, CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

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
      // 時間帯の切り替え中はメニューも開かない（決定キーと同じ扱い）。
      if (viewRef.current?.timeShifting()) return;
      event.preventDefault();
      useUi.getState().setMenu(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  /** はじめから（GS-27）。記録を新しくして出発点のマップへ。 */
  const startNew = useCallback(async () => {
    autoPendingRef.current = false;
    // タイトルの曲はここで止める。マップの曲は画面が出始めてから（下）。
    audio.stopBgm(TITLE_BGM_FADE_MS);
    audio.stopBgs(TITLE_BGM_FADE_MS);
    // 記録は**欄ごと全部**戻す（GS-265）。1 つずつ戻すと、欄を足したときに戻し忘れる
    // （物語の段階が残り、済ませたイベントが動かなかった）。入れ物は差し替えない——イベントの道具立てが握っている。
    resetState(stateRef.current);
    // 仲間を台帳のとおりに（GS-60）。台帳を読み終える前に押されても揃うよう待つ。
    await loadBattleBook();
    resetParty(stateRef.current);
    // 時間帯と時計（GS-222）。台帳の「はじめから」の時間帯で始める。暗転の裏なので混ぜずに当てる。
    const times = await loadTimeSettings();
    stateRef.current.time = times.start;
    // 時計は台帳で使うときだけ動かして始める（GS-223）。
    stateRef.current.clock = { running: times.clock, ms: 0 };
    viewRef.current?.setTime(times.start, 0);
    useUi.getState().setPhase('play');
    // **読み込みのあいだは黒のまま**（GS-28）。一瞬で覆い、オープニングの暗幕へそのまま渡す。
    useUi.getState().setFade(1, 0);
    // 最初のマップは id で決め、ファイルは台帳から引く（フォルダ分け GS-257）。
    const entry = await mapEntryOf(START_MAP_ID);
    const startFile = entry.file;
    await readEventsAhead(startFile);
    await viewRef.current?.load(startFile);
    await adoptRef.current(startFile);
    // 曲は**読み込み終えて画面が出始めるところで**鳴らす（黒い読み込みのあいだは鳴らさない）。
    // 明けるのは次の 2 フレーム後。イベントより先に当てる——踏んで起きるイベントが曲を指していれば、そちらが勝つ。
    await viewRef.current?.waitForRenderedFrame();
    applyMapSound(entry);
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
      // タイトルから始めたときだけ、タイトルの曲を止めて、マップの曲は画面が出始めてから鳴らす。
      // ゲーム中のメニューから読んだときは今までどおり（マップ移動と同じく読み込んだところで替える）。
      const fromTitle = useUi.getState().phase === 'title';
      if (fromTitle) {
        audio.stopBgm(TITLE_BGM_FADE_MS);
        audio.stopBgs(TITLE_BGM_FADE_MS);
      }
      // **先に暗転しきる。** 記録を戻すと、その場で見た目が変わる（宝箱の開け閉め・時間帯など）。
      // 暗くなりきる前に戻すと、読み込む前の画面のまま切り替わるのが見えてしまう。
      useUi.getState().setBusy(true);
      if (useUi.getState().fade < 1) {
        useUi.getState().setFade(1, DOOR_FADE_MS);
        await new Promise((done) => window.setTimeout(done, DOOR_FADE_MS));
      }
      const { state, progress } = fromSave(data);
      // **入れ物は差し替えず中身を移す**——イベントの道具立てが同じ入れ物を握っている。欄は全部 `restoreState` が移す。
      restoreState(stateRef.current, state);
      // 時間帯と時計（GS-222）。持っていない古い記録は台帳の「はじめから」で埋める。
      const times = await loadTimeSettings();
      if (data.time === undefined) stateRef.current.time = times.start;
      if (!data.clock) stateRef.current.clock = { running: times.clock, ms: 0 };
      viewRef.current?.setTime(stateRef.current.time, 0);
      // 仲間（GS-60）。**版 2 までの記録には無い**ので、台帳から入れ直す。
      await loadBattleBook();
      ensureParty(stateRef.current);
      useUi.getState().setPhase('play');
      useUi.getState().setMenu(false);
      // 読み直すあいだは黒のまま（GS-28）。暗転はもう済んでいるので、`goTo` は待たずに読み込む。
      await goTo(progress.map, { marker: '', at: progress.at }, progress.facing, true, fromTitle);
      canvasRef.current?.focus();
    },
    [goTo],
  );

  /**
   * 「話せるよ」の合図を出す相手（GS-49）。**毎フレーム聞かれる**ので、
   * 重い判定はしない——距離と、そのイベントが動くかだけ。
   * 絵は 3D の板で、キャラと同じ割合の大きさ（GS-267。`GameView.setTalkMarks`）。
   */
  const talkMarks = useCallback((): Array<{ id: string; near: boolean }> => {
    const view = viewRef.current;
    // 会話や暗転の最中は出さない。合図の役目は「押せば始まる」を伝えることなので。
    if (!view || useUi.getState().busy || useUi.getState().phase !== 'play') return [];
    const at = view.playerAt();
    if (!at) return [];
    const out: Array<{ id: string; near: boolean }> = [];
    for (const [npc, eventId] of npcTalkRef.current) {
      const event = eventsRef.current.get(eventId);
      if (!event || event.trigger !== 'action') continue;
      const spot = view.npcAt(npc);
      if (!spot) continue;
      const span = Math.hypot(spot.x - at.x, spot.z - at.z);
      if (span > TALK_MARK_SHOW) continue;
      // 条件を満たさないイベント（もう終わった話など）には出さない。
      if (!runnableRef.current(event)) continue;
      out.push({ id: npc, near: span <= TALK_MARK_NEAR });
    }
    return out;
  }, []);

  // 話せる合図を毎フレーム 3D へ渡す（GS-49 / GS-267）。NPC はうろつくので細かく見る。
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      viewRef.current?.setTalkMarks(talkMarks());
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
    return () => {
      alive = false;
    };
  }, [talkMarks]);

  /** いまの場所を記録に写す。 */
  const saveTo = useCallback(async (slot: number) => {
    const view = viewRef.current;
    const at = view?.playerAt();
    if (!view || !at) return;
    await writeSave(
      slot,
      toSave(stateRef.current, {
        map: knownSaveMapId(mapRef.current),
        at: { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) },
        facing: view.playerFacing() ?? 'down',
      }),
    );
  }, []);

  // オート枠へ書くのも同じ道を通る（GS-33）。**書き出しは 1 か所**にしておく。
  autoSaveRef.current = () => void saveTo(AUTO_SLOT);

  return (
    <div className="stage" ref={stageRef}>
      {/* 画面は 1280×720（DEC-162）。会話も暗転も**この中**に重ねる。 */}
      <div className="screen" ref={screenRef}>
        {/*
         * デバッグ用の戦闘ボタン（GS-91）。開発モードか、クリアした端末で（`debugToolsShown`）、フィールドにいるあいだだけ出す。
         * **マウスの左クリックだけ**——焦点を取らせない（Enter やパッドで押されると、歩いている最中に始まる）。
         */}
        {debugToolsShown() && phase === 'play' && !battle && !menu && !shop && !uiBusy ? (
          <div className="debug-tools">
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
            <div className="debug-party" role="group" aria-label="パーティ人数">
              <span>パーティ</span>
              {[1, 2, 3].map((size) => (
                <button
                  key={size}
                  type="button"
                  className="debug-battle"
                  tabIndex={-1}
                  aria-pressed={stateRef.current.party.length === size}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    const state = stateRef.current;
                    state.party.splice(size);
                    for (const who of DEBUG_PARTY) {
                      if (state.party.length >= size) break;
                      joinParty(state, who);
                    }
                    refreshParty((value) => value + 1);
                  }}
                >
                  {size}人
                </button>
              ))}
            </div>
            {/*
             * マップへ飛ぶ（GS-216）。台帳（`maps.json`）の全マップから選ぶ。着地はそのマップの `default`。
             * 選んだら焦点を canvas へ返す——リストに残ると、矢印キーで次のマップへ移ってしまう。
             */}
            <label className="debug-party">
              <span>マップ</span>
              <select
                className="debug-map"
                tabIndex={-1}
                value={debugMapAt}
                onChange={(event) => {
                  const key = event.target.value;
                  event.target.blur();
                  canvasRef.current?.focus();
                  void goTo(key, { marker: '', at: null }, '');
                }}
              >
                {debugMaps.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {/*
             * 時間帯を選ぶ（GS-224）。押したら切り替えの時間（`shiftMs`）で混ぜて移り、時計はそこから数え直す。
             * 「基準」は時間帯なし（マップの基準の光。時計は進まない）。
             */}
            <div className="debug-party" role="group" aria-label="時間帯">
              <span>時間帯</span>
              {['', ...timeSettings().order].map((id) => (
                <button
                  key={id || 'base'}
                  type="button"
                  className="debug-battle"
                  tabIndex={-1}
                  aria-pressed={stateRef.current.time === id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    const state = stateRef.current;
                    state.time = id;
                    state.clock.ms = 0;
                    viewRef.current?.setTime(id, timeSettings().shiftMs);
                    refreshParty((value) => value + 1);
                  }}
                >
                  {DEBUG_TIME_LABELS[id] ?? id}
                </button>
              ))}
            </div>
            {/* 台帳（`items.json`）の持ち物を全部 2 個ずつ足し（GS-210）、所持金を 999999 にする。 */}
            <button
              type="button"
              className="debug-battle"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                if (event.button !== 0) return;
                const state = stateRef.current;
                for (const { id } of itemList()) state.items.set(id, (state.items.get(id) ?? 0) + DEBUG_ITEM_COUNT);
                state.gold = DEBUG_GOLD;
              }}
            >
              アイテム
            </button>
          </div>
        ) : null}
        <canvas ref={canvasRef} className="viewport" tabIndex={0} />
        <CameraIllustrationLayer probe={cameraIllustrations} />
        <MessageWindow
          onAdvance={() => bridgeRef.current?.advance()}
          onPick={(index) => bridgeRef.current?.pick(index)}
          bubbleAt={(who) => viewRef.current?.bubbleAt(who) ?? null}
        />
        {/* 旧作の仮想パッド。会話窓が空けている左右の領域へ収める（GS-155）。 */}
        {/* めくる絵を読ませている間は隠す（GS-188。旧作も隠した）。絵の左右の矢印でめくる。 */}
        {/* 出すかは設定（GS-214。既定はスマホだけ）。 */}
        {phase === 'play' && !comicReading && padShown ? <VirtualPad /> : null}
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
        <PwaInstall visible={phase === 'title'} />
        {phase === 'play' && menu ? (
          <Menu
            items={stateRef.current.items}
            party={stateRef.current.party}
            members={stateRef.current.members}
            gold={stateRef.current.gold}
            playSeconds={stateRef.current.playSeconds}
            place={knownMapLabel(mapRef.current)}
            onUseItem={useItem}
            onEquip={(who, id) => equipItem(stateRef.current, who, id)}
            onUnequip={(who, slot) => unequipItem(stateRef.current, who, slot)}
            onSave={saveTo}
            onLoad={continueFrom}
            onTitle={() => { void returnToTitle(); }}
            onClose={() => useUi.getState().setMenu(false)}
          />
        ) : null}
        {/* 戦闘（GS-60）。マップの上に重ねる——3D はそのまま裏で動いている。 */}
        {phase === 'play' && battle ? (
          <BattleView
            key={`${battle.join(',')}#${backdropSeqRef.current}`}
            enemies={battle}
            backdrop={battleBackdropRef.current}
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
