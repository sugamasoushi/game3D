// 開発中だけ外へ出す口（2026-10-06）。**ゲームが外へ出している物は、ここに全部並べる。**
//
// ゲームは起動するだけで、エディタの事情は持たない——ただしエディタのプレビューは
// **ゲーム本体の描画をそのまま使う**約束なので、その入口だけは残す。ここに無い口は無い。
//
// `next dev`（`NODE_ENV === 'development'`）のときだけ出す。書き出した製品には出ない。
// 中身（何をするか）は `GameCanvas.tsx` が組む——画面の状態（ref）に触るので、ここへは持って来ない。

import type * as audio from '../game/audio';
import type * as dev from '../game/devMode';
import type * as gameOptions from '../game/options';
import type { BattleOutcome } from '../game/battle/flow';
import type { EffectDef, EffectEntry } from '../game/battle/book';
import type { CameraCueBook } from '../game/cameraCues';
import type { GameView, RestageOptions, RestageResult } from '../game/GameView';
import type { BattleStageSource } from '../game/battleStageMarker';
import type { EventBridge } from '../game/uiEventContext';
import type { EventDef, MapMoveDef } from '../event/types';
import type { useUi } from '../ui/store';

/** イベントエディタ（5927）が使う口（GS-37 / GS-206 / GS-211）。保存していない下書きをそのまま受ける。 */
export interface PreviewWindow {
  play(event: EventDef, npc?: string, carry?: { owner?: string }): Promise<void>;
  flags(): Record<string, boolean>;
  setFlag(key: string, value: boolean | null): void;
  /** 物語の段階（GS-254）。最後に済ませた段階の id（'' は何も済んでいない）。 */
  story(): string;
  /** 物語の段階を確認のために合わせる（GS-254）。**戻すこともできる**（命令の `story` と違い、確かめるための口）。 */
  setStory(step: string): void;
  mapMove(destinations: string[], def?: MapMoveDef): Promise<string>;
}

/** カメラエディタ（5929）が使う口。 */
export interface CameraEditorWindow {
  prepare(file: string): Promise<void>;
  setBook(next: CameraCueBook): void;
  play(id: string): number;
  cameraState(): ReturnType<GameView['cameraCueState']>;
  seek(ms: number): void;
  pause(paused: boolean): void;
  stop(): void;
  grid(on: boolean): void;
  pickCell(handler: ((cell: { x: number; y: number; z: number }) => void) | null): void;
  event(id: string): Promise<void>;
}

/** 戦闘演出エディタ（5930。技の絵）が使う口（GS-105 / GS-219）。 */
export interface BattleEffectEditorWindow {
  /** マップを読む。背景の戦闘を出していれば先に片付ける。 */
  prepare(file: string): Promise<void>;
  setEffects(next: Record<string, EffectEntry>): void;
  /**
   * いまのマップで**背景だけの戦闘**を出す（GS-219）。戦いは進めない——命令も文も出さず、キーも受けない。
   * 舞台はふつうの戦闘と同じ決め方（`BattleStage=true` の点 → `default` の点 → マップの原点。2026-10-29）。どれを基準にしたかを返す。
   */
  backdrop(enemies: string[]): Promise<BattleStageSource>;
  /** 背景の戦闘を片付ける。出していなければ何もしない。 */
  clearBackdrop(): void;
  /** 戦闘中（背景の戦闘を含む）なら先頭の敵へ絵を出す。戦闘中でなければ偽。 */
  playEffect(def: EffectDef): boolean;
  /** 戦闘の舞台の台帳（`battleStages.json`）の下書きで差し替える（2026-10-19 / BPE-30）。次に舞台を組むときから効く。 */
  setStages(next: unknown): void;
  /** 隊形の台帳（`battleFormations.json`）の下書きで差し替える。 */
  setFormations(next: unknown): void;
  /**
   * 出している背景の舞台を組み直す（下書きのマス・隊形・構図を当て直し、戦闘開始の構図を流し直す）。
   * `formation` は見る隊形、`party` / `enemy` は立たせる人数（今の面子の絵をくり返して使う）、`showParty` は味方の板を見せるか。
   * 床の無い所に立った人を返す。3D の舞台を出していなければ null。
   */
  restage(options: RestageOptions & {
    /** 味方の何人目にどの人の絵を使うか（キャラクターの台帳のキー。GS-282）。戦闘の絵 → 立ち絵の順で引く。`partyImages` より先に効く。 */
    partyArt?: Array<string | null>;
  }): RestageResult | null;
  /** 味方の板に使える人（キャラクターの台帳で、戦闘の絵か立ち絵がある人。GS-282）。仲間（player）が先。 */
  partyArtChoices(): Array<{ id: string; name: string; kind: string; battle: boolean }>;
  /** 戦闘のマスの線を出す・消す。 */
  showCells(on: boolean): void;
  /** 戦闘開始の構図を流し直す。返すのは長さ（ミリ秒）。 */
  replayStart(): number;
  /**
   * 組んでいる舞台の、マスの範囲ぜんぶの地形（2026-10-29 / GS-285）。舞台の点の床からの高さ（フィールドのマス。床が無ければ null）と
   * 分け方（床・高台・空）。舞台を組み直したら聞き直す。舞台が無ければ空。
   */
  cellTerrain(): Array<{ col: number; row: number; ground: 'floor' | 'high' | 'sky'; height: number | null }>;
  /**
   * コマンド選択の見本（2026-10-29 / GS-281）。背景の戦闘で `member` 人目（0 始まり）が手を聞かれている形にする
   * （板が左端へ寄り、命令の窓が出る。手は決めない）。null で戻す。舞台を組み直したら、もう一度呼ぶ。背景の戦闘でなければ偽。
   */
  previewCommand(member: number | null): boolean;
}

export interface DevWindow {
  // ── エディタが使う口。**変えるときは相手のエディタも直す。** ──
  /** イベントエディタ。 */
  __preview: PreviewWindow;
  /** カメラエディタ。 */
  __cameraEditor: CameraEditorWindow;
  /** 戦闘演出エディタ。 */
  __battleEffectEditor: BattleEffectEditorWindow;
  /** 3D の本体。イベントエディタ・カメラエディタがマップの読み込みに使う。Console からも。 */
  __game: GameView;
  /** 画面の状態（`busy` など）。エディタが「いま試せるか」を見る。Console からも。 */
  __ui: typeof useUi;

  // ── Console で試すための口（エディタは使っていない）。 ──
  __audio: typeof audio;
  __options: typeof gameOptions;
  /** 開発中のつまみ（GS-126）。`__dev.setDevOptions({ muteBgm: false })`。 */
  __dev: typeof dev;
  /** イベントを 1 命令ずつ試す。 */
  __event: EventBridge;
  /** 居る場所や向きを外から聞く。 */
  __view: () => GameView | null;
  /** 戦闘を 1 回試す（GS-60）。負けても話は終わらせない。 */
  __battle: (ids: string[]) => Promise<BattleOutcome>;
}

/** 口を出すか。`next dev` のときだけ。 */
export const DEV_WINDOW = process.env.NODE_ENV === 'development';

/** 口を出す。開発中でなければ何もしない。 */
export function expose<K extends keyof DevWindow>(key: K, value: DevWindow[K]): void {
  if (!DEV_WINDOW) return;
  (window as unknown as Partial<DevWindow>)[key] = value;
}

/** 口を引っ込める（画面を畳むとき）。 */
export function withdraw(...keys: (keyof DevWindow)[]): void {
  for (const key of keys) delete (window as unknown as Partial<DevWindow>)[key];
}
