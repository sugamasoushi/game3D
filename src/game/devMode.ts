// 開発モード（GS-91）。デバッグ用の道具（戦闘ボタンなど）を出すかどうか。
//
// **旧作と同じ決め方**——ふだんは開発モードで、`NEXT_PUBLIC_PRODUCTION=true` を付けて
// 書き出したときだけ切れる（旧作 `main.ts` の `isProd`）。`NODE_ENV` で決めると、
// 書き出した物を試しに遊ぶときにデバッグの道具まで消えてしまう。

import { clearedHere } from './omake';

/** 開発モードか。ビルドのときに値が埋め込まれる（`NEXT_PUBLIC_` の決まり）。 */
export const DEV_MODE = process.env.NEXT_PUBLIC_PRODUCTION !== 'true';

/**
 * デバッグの道具（フィールドの戦闘・パーティ・マップ・時間帯・アイテム）を出すか（2026-10-29）。
 * **クリア後の要素として本番でも開放する**——開発中か、この端末で一度でもクリアしていれば出す
 * （おまけと同じ決め方。`ゲーム_クリア` で `markCleared` が覚える）。
 * 設定画面の開発用のつまみ（`DevOptions`）は遊ぶ人には意味が無いので、`DEV_MODE` のままにする。
 */
export function debugToolsShown(): boolean {
  return DEV_MODE || clearedHere();
}

/**
 * 開発中だけのつまみ（GS-126）。**遊ぶ人の設定（`options.ts`）とは別に持つ。**
 *
 * 作っている最中は、直したい所へ行くまでにオープニングを 3 秒見て、曲を聞かされる。
 * 1 日に何十回も読み直すので、**既定で切っておく**——本番（`DEV_MODE` が false）では
 * この覚えは一切見ないので、遊ぶ人にはそのまま届く。
 */
export interface DevOptions {
  /** オープニングを飛ばす。 */
  skipOpening: boolean;
  /** BGM を鳴らさない。**環境音（滝など）も止まる**——音量の設定も両者を 1 つとして扱っている。 */
  muteBgm: boolean;
  /**
   * 効果音を鳴らさない。**既定は鳴らす**——文字送りの音は「どこまで進んだか」の手がかりで、
   * 消すと会話まわりの確認がしづらい。うるさいときだけ切る。
   */
  muteSe: boolean;
  /**
   * 3D の戦闘で**味方の**立ち絵の板（ビルボード）を出す（GS-247）。**既定は出さない**——しばらく味方の板を見せない。
   * 敵の板はいつも出す。出さなくても板の位置は測るので、敵の素手の攻撃の絵はその位置に出る。
   */
  battlePartyFigures: boolean;
}

export const DEFAULT_DEV_OPTIONS: DevOptions = { skipOpening: true, muteBgm: true, muteSe: false, battlePartyFigures: false };

/** いまのつまみ。**この 1 つを見に行く**（`options.ts` と同じ作り）。 */
export const devOptions: DevOptions = { ...DEFAULT_DEV_OPTIONS };

/** 置き場所。端末ごとの都合なので localStorage。 */
const STORE_KEY = 'samplegame.dev';

/** 端末に覚えているつまみを読む。**起動時に 1 回**呼ぶ。本番では読まない。 */
export function loadDevOptions(): void {
  if (!DEV_MODE || typeof window === 'undefined') return;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null') as Partial<DevOptions> | null;
    if (!saved) return;
    if (typeof saved.skipOpening === 'boolean') devOptions.skipOpening = saved.skipOpening;
    if (typeof saved.muteBgm === 'boolean') devOptions.muteBgm = saved.muteBgm;
    if (typeof saved.muteSe === 'boolean') devOptions.muteSe = saved.muteSe;
    if (typeof saved.battlePartyFigures === 'boolean') devOptions.battlePartyFigures = saved.battlePartyFigures;
  } catch {
    /* 読めなければ既定のまま。 */
  }
}

/** 変える。**変えたら覚える。** */
export function setDevOptions(next: Partial<DevOptions>): void {
  Object.assign(devOptions, next);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(devOptions));
  } catch {
    /* 覚えられなくてもその場では効く。 */
  }
}

/**
 * オープニングを見せるか。**本番では必ず見せる**——開発中のつまみが
 * 書き出した物に紛れ込まないよう、`DEV_MODE` を掛けてから見る。
 */
export function showOpening(): boolean {
  return !(DEV_MODE && devOptions.skipOpening);
}

/** BGM（と環境音）を鳴らしてよいか。同じく本番では必ず鳴る。 */
export function bgmAllowed(): boolean {
  return !(DEV_MODE && devOptions.muteBgm);
}

/** 効果音を鳴らしてよいか。同じく本番では必ず鳴る。 */
export function seAllowed(): boolean {
  return !(DEV_MODE && devOptions.muteSe);
}

/**
 * 3D の戦闘で味方の立ち絵の板を出すか（GS-247）。**本番では出さない**——しばらく板を見せない間は、
 * 書き出した物にも出さない。出すようにするときはここを変える。敵の板はこれを見ない。
 */
export function battlePartyFiguresShown(): boolean {
  return DEV_MODE && devOptions.battlePartyFigures;
}
