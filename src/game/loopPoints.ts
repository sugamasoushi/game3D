// BGM のループ点（GS-317）。台帳 `sounds.json` の `loopStart` / `loopEnd` の決まり。
//
// ファイルの中身は「冒頭 → ループ本体 → 尻尾」（ComfyUI_試作 の書き出しの決まり）。
// 0 秒から鳴らし、loopEnd に来たら loopStart へ戻る。尻尾は鳴らない（圧縮で最後に乱れが出ても聞こえないように置く）。
// 値は **48kHz のサンプル数（整数）**。秒で書くと小数の誤差でつなぎ目がずれるため。
// 端末の出力が 44.1kHz でも、秒に直してから渡すのでずれない。

/** ループ点のサンプル数の基準。書き出しの道具は 48kHz で書く。 */
export const LOOP_RATE = 48000;

/** ループ点を持てる行（`SoundDef` の一部）。 */
export interface LoopPoints {
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
}

/** 鳴らすときの区間（秒）。 */
export interface LoopWindow {
  start: number;
  end: number;
}

/** ループ点を書いた行か（片方だけでも書いてあれば、書いたつもりの行として扱う）。 */
export const hasLoopPoints = (def: LoopPoints): boolean => def.loopStart !== undefined || def.loopEnd !== undefined;

/** 台帳の書き方の誤り。正しければ null。検査（Game Checker）もこれを使う。 */
export function loopPointsProblem(def: LoopPoints): string | null {
  if (!hasLoopPoints(def)) return null;
  const { loopStart, loopEnd } = def;
  if (loopStart === undefined || loopEnd === undefined) return 'ループ点は loopStart と loopEnd の両方を書きます';
  if (!Number.isInteger(loopStart) || !Number.isInteger(loopEnd)) return 'ループ点はサンプル数（整数）です';
  if (loopStart < 0) return 'loopStart は 0 以上です';
  if (loopEnd <= loopStart) return 'loopEnd は loopStart より後ろです';
  if (!def.loop) return 'ループ点を書いた音は loop: true にします';
  return null;
}

/**
 * 鳴らす区間（秒）。ループ点が無い・書き方が誤り・曲の長さ（秒）を越える時は null（ファイル全体を繰り返す）。
 * 長さの比べは 10 ミリ秒ゆるめる（読み込み時の変換で長さがわずかに変わることがある）。
 */
export function loopWindow(def: LoopPoints, durationSeconds: number): LoopWindow | null {
  if (!hasLoopPoints(def) || loopPointsProblem(def)) return null;
  const start = (def.loopStart as number) / LOOP_RATE;
  const end = (def.loopEnd as number) / LOOP_RATE;
  if (end > durationSeconds + 0.01) return null;
  return { start, end };
}

/** 鳴らし始めてから `elapsed` 秒たった時に、曲のどこを鳴らしているか（秒）。 */
export function loopPosition(elapsed: number, window: LoopWindow | null, durationSeconds: number): number {
  const at = Math.max(0, elapsed);
  if (!window) return durationSeconds > 0 ? at % durationSeconds : 0;
  if (at < window.end) return at;
  return window.start + ((at - window.start) % (window.end - window.start));
}
