// 遊ぶ人が変えられる設定（GS-25 / GS-32）。**1 か所に集める。**
//
// **セーブには入れない。** 文字送りや音量は「その人のその端末の好み」で、
// 冒険の記録（`save.ts`）とは別物——枠を読み替えても好みは変わらないほうがよい。
// 置き場所は localStorage（記録は IndexedDB）。
//
// 開発中は `window.__options`（`GameCanvas` が入れる）から触って試せる。

export interface Options {
  /**
   * 文字送りの速さ（1 文字あたりのミリ秒。GS-25）。**大きいほど遅い。**
   * 24 だと速すぎて読む前に出切るので、40 を既定にした。
   */
  charMs: number;
  /**
   * 流れる文字（`scroll`）の速さの倍率（GS-144）。**大きいほどゆっくり。**
   * イベント側の `speed`（1 行ぶんの時間）に掛ける——読む速さは人によって違うので、
   * 「話ごとの速さの差」は台帳、「その人に合う速さ」はここで持つ。
   */
  scrollScale: number;
  /** 音量（0〜1）。全体・BGM と環境音・効果音。 */
  masterVolume: number;
  bgmVolume: number;
  seVolume: number;
}

/** 既定の設定。セーブが無い状態はこれ。 */
export const DEFAULT_OPTIONS: Options = {
  charMs: 40,
  scrollScale: 1,
  masterVolume: 1,
  bgmVolume: 1,
  seVolume: 1,
};

/**
 * いまの設定。**この 1 つを見に行く**——コピーを配ると、変えたのに反映されない所ができる。
 */
export const options: Options = { ...DEFAULT_OPTIONS };

/** 置き場所（GS-32）。端末ごとの好みなので localStorage。 */
const STORE_KEY = 'samplegame.options';

/** 数として読めるものだけ受ける。壊れた値で画面が固まらないように。 */
function sane(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** 端末に覚えている設定を読む。無ければ既定のまま。**起動時に 1 回**呼ぶ。 */
export function loadOptions(): void {
  if (typeof window === 'undefined') return;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Options> | null;
    if (!saved) return;
    setOptions({
      charMs: sane(saved.charMs, DEFAULT_OPTIONS.charMs, 5, 200),
      scrollScale: sane(saved.scrollScale, DEFAULT_OPTIONS.scrollScale, 0.5, 4),
      masterVolume: sane(saved.masterVolume, DEFAULT_OPTIONS.masterVolume, 0, 1),
      bgmVolume: sane(saved.bgmVolume, DEFAULT_OPTIONS.bgmVolume, 0, 1),
      seVolume: sane(saved.seVolume, DEFAULT_OPTIONS.seVolume, 0, 1),
    });
  } catch {
    /* 読めなければ既定のまま。設定が壊れているだけで遊べなくならないように。 */
  }
}

/** 変える。設定画面もセーブの読み込みもここを通す。**変えたら覚える。** */
export function setOptions(next: Partial<Options>): void {
  Object.assign(options, next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(options));
    } catch {
      /* 覚えられなくても遊べる（プライベート窓など）。 */
    }
  }
  for (const listener of listeners) listener(options);
}

type Listener = (now: Options) => void;
const listeners = new Set<Listener>();

/** 変わったら知らせる（鳴っている BGM の音量を追わせるのに使う）。 */
export function onOptionsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
