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
import type { GameView, STAGE_COMMAND_FIGURE } from '../game/GameView';
import type { EventBridge } from '../game/uiEventContext';
import type { EventDef, MapMoveDef } from '../event/types';
import type { useUi } from '../ui/store';

/** イベントエディタ（5927）が使う口（GS-37 / GS-206 / GS-211）。保存していない下書きをそのまま受ける。 */
export interface PreviewWindow {
  play(event: EventDef, npc?: string, carry?: { item?: string; num?: number }): Promise<void>;
  flags(): Record<string, boolean>;
  setFlag(key: string, value: boolean | null): void;
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

/** 戦闘演出エディタ（5930。技の絵）が使う口（GS-105）。 */
export interface BattleEffectEditorWindow {
  prepare(file: string): Promise<void>;
  setEffects(next: Record<string, EffectEntry>): void;
  battle(enemies: string[]): Promise<void>;
  playEffect(def: EffectDef): boolean;
  forceBattle(): boolean;
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
  /** コマンド選択中の味方を左端へ立たせる値（GS-103）。書き換えてその場で試す。 */
  __stageCommandFigure: typeof STAGE_COMMAND_FIGURE;
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
