// 感情マークの台帳（GS-267）。キャラの頭の上に出す吹き出しの絵（「…」・Zzz・！・？・音符など）。
//
// **絵の区切りは `spriteSheets.json` が持つ**。ここは「どのコマを・どの速さで・どれだけ出すか」だけ。
// コマ番号は左上から右へ 0, 1, 2…（横のコマ数で折り返す）——攻撃の絵（`effects.json`）と同じ数え方。
// シートを広げるときは**下に行を足す**（途中に差し込むと番号がずれて、台帳の全部が別の絵を指す）。
//
// 使い道は 3 つで、同じ人に重なったら上が勝つ（`pickMark`）。
//   1. イベントの命令 `emote`
//   2. 話せる合図（GS-49）。既定は `talk`、NPC ごとに `mapNpcs.json` の `talkEmote` で替えられる
//   3. NPC がいつも出しているマーク（`mapNpcs.json` の `idleEmote`。寝ている人の Zzz）

import { assetUrl } from './assets';

/** 1 つぶん。 */
export interface EmoteDef {
  /** エディタに出す名前。ゲームは読まない。 */
  name?: string;
  /** 絵（`spriteSheets.json` のキー）。 */
  sheet: string;
  /** 見せるコマの番号。1 つならそのコマで止まる。 */
  frames: number[];
  /** 1 秒にめくるコマ数。省略は 4。 */
  fps?: number;
  /** 最後まで行ったら頭へ戻るか。切ると最後のコマで止まる。 */
  loop?: boolean;
  /** イベントで出したときの長さ（ミリ秒）の既定。省略は 1200。 */
  ms?: number;
  /** 出たときに鳴らす音（`sounds.json` のキー）。 */
  se?: string;
}

/** 台帳のファイルの形。 */
export interface EmoteBook {
  emotes: Record<string, EmoteDef>;
}

/** 話せる合図の既定のマーク（GS-49）。**台帳に必ず置く**（Game Checker が見る）。 */
export const TALK_EMOTE = 'talk';
/** 省略したときの値。 */
export const EMOTE_FPS = 4;
export const EMOTE_MS = 1200;
/** 出るときに弾む長さ（ミリ秒）。 */
export const EMOTE_POP_MS = 180;

let book: Record<string, EmoteDef> = {};
let pending: Promise<void> | undefined;

/** 台帳を読む。**1 回だけ読んで使い回す**。読めなくても止めない（マークが出ないだけ）。 */
export function loadEmotes(): Promise<void> {
  return (pending ??= fetch(assetUrl('data/emotes.json'))
    .then((response) => (response.ok ? (response.json() as Promise<Partial<EmoteBook>>) : null))
    .then((file) => {
      if (file?.emotes) book = file.emotes;
    })
    .catch((error) => {
      console.warn('[emotes] 台帳を読めなかった', error);
      pending = undefined;
    }));
}

/** そのマーク。台帳に無ければ null。 */
export function emote(id: string): EmoteDef | null {
  return book[id] ?? null;
}

/** 台帳の中身（編集用の入口から差し替えるときだけ使う）。 */
export function previewEmotes(next: Record<string, EmoteDef>): void {
  book = structuredClone(next);
}

/**
 * 出してから `elapsedMs` 経ったときのコマ番号。
 * コマが無ければ 0。
 */
export function emoteFrame(def: Pick<EmoteDef, 'frames' | 'fps' | 'loop'>, elapsedMs: number): number {
  const frames = def.frames.length ? def.frames : [0];
  const fps = def.fps !== undefined && def.fps > 0 ? def.fps : EMOTE_FPS;
  const step = Math.max(0, Math.floor((Math.max(0, elapsedMs) * fps) / 1000));
  const at = def.loop ? step % frames.length : Math.min(step, frames.length - 1);
  return frames[at];
}

/** 何コマ目が何段目の何列目か（左上から右へ。横のコマ数で折り返す）。 */
export function emoteCell(frame: number, columns: number): { col: number; row: number } {
  const cols = Math.max(1, Math.floor(columns));
  const index = Math.max(0, Math.floor(frame));
  return { col: index % cols, row: Math.floor(index / cols) };
}

/**
 * 出るときの大きさ（1 が等倍）。最初の `EMOTE_POP_MS` で 0 から少し膨らんで 1 に戻る。
 * `pop` が偽なら最初から 1（話せる合図・いつものマークは弾ませない）。
 */
export function emotePop(elapsedMs: number, pop = true): number {
  if (!pop || elapsedMs >= EMOTE_POP_MS) return 1;
  const t = Math.max(0, elapsedMs) / EMOTE_POP_MS;
  // 0 → 1.2（60%）→ 1。
  return t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - ((t - 0.6) / 0.4) * 0.2;
}

/** 重なったときの順（上が勝つ）。 */
export const MARK_LAYERS = ['event', 'talk', 'idle'] as const;
export type MarkLayer = (typeof MARK_LAYERS)[number];

/** 同じ人に重なったマークのうち、出す 1 つ。どれも無ければ null。 */
export function pickMark<T>(layers: Partial<Record<MarkLayer, T>>): { layer: MarkLayer; mark: T } | null {
  for (const layer of MARK_LAYERS) {
    const mark = layers[layer];
    if (mark !== undefined) return { layer, mark };
  }
  return null;
}
