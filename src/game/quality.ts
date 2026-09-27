// 描画モード（GS-173）。**重い描画を出すか出さないかを決める道は、ここ 1 本だけ。**
//
// 旧作にも「描画モード（ＰＣ（高負荷）／ＳＰ（低負荷））」があり、重い絵の手前で
// `isHighDraw` を見て PC 版と SP 版を切り替えていた（`WaterReflectionShader` など）。
// 同じ考え方をこちらにも置く——**判断の場所を散らさない**のが要点で、
// 各所で `navigator.userAgent` を見に行くと、切り替えたつもりの所だけ古いままになる。
//
// ## 重い描画を足すときの手順
//
//   1. 下の `HEAVY_DRAWS` に 1 行足す（名前・説明・低負荷でも出すか）
//   2. その描画の**手前**で `heavyOn('<名前>')` を見て、偽なら素通りする
//   3. 設定を変えたその場で効くようにする（`onOptionsChanged` で組み直す。`GameView` が例）
//
// **やってはいけないのは「重いから」と黙って消すこと。** 表に載っていない間引きは、
// 遊ぶ人にも書く人にも見えない——「この端末だけ水面が映らない」の理由が誰にも分からなくなる。
//
// ## 予定（2026-09-27 の相談）
//
// シェーダを**外部の TS ファイル**として足せるようにし、そのときに
// 「この描画モードでは出さない」の判定を**シェーダ側の入口**に持たせる。
// 出す・出さないの設定は**マップエディタ**で決め、台帳エディタはマップ構成の値として
// **見せるだけ**にする（登録の窓口を 1 つに保つ。DEC-394 と同じ考え）。

import { options } from './options';

/** 解いたあとの描画モード。**判断に使うのはこの 2 つだけ。** */
export type DrawMode = 'high' | 'light';

/** 設定に持つ値。`auto` は端末から見当を付ける（旧作と同じ入り口）。 */
export type DrawModeSetting = 'auto' | DrawMode;

/** 画面に出す名前。設定画面と、開発中の口（`__quality`）で使う。 */
export const DRAW_MODE_LABELS: Record<DrawModeSetting, string> = {
  auto: '自動',
  high: '高負荷（PC）',
  light: '低負荷（スマホ）',
};

/**
 * 重い描画の一覧（GS-173）。**ここに載っている物だけが間引かれる。**
 * `light` が真なら低負荷でも出す——「重いが無いと話が成り立たない」物のための逃げ道。
 */
export const HEAVY_DRAWS = {
  /**
   * 配置光源（点・スポット・面）。**画素ごとに光源の数だけ回る**——
   * 届く光源はさらに遮光体（1 光源あたり最大 48 個・1 個につきテクスチャ 3 回読み）を払う。
   * 0101 のような屋内は光が重なるので、スマホではここが一番効く。
   * 低負荷では**光そのものと光の玉を出さない**（環境光だけで照らす）。
   */
  pointLights: { label: '配置光源', note: '画素ごとに光源と遮光体をなめる。屋内ほど重い', light: false },
  /**
   * 水面・鏡面の映り込み（DEC-303）。**シーンをもう 1 回描く**ので、
   * draw call も塗る面積もほぼ倍になる。低負荷では映さない（水面の波は出る）。
   */
  mirror: { label: '水面の映り込み', note: 'シーンをもう 1 回描く。水面の波は低負荷でも出る', light: false },
} as const;

export type HeavyDraw = keyof typeof HEAVY_DRAWS;

/**
 * 端末から見当を付ける（旧作の `ExecutionEnvironment.updateHighDraw` と同じ判断）。
 * **触れる画面か、ホーム画面から開いた PWA なら低負荷。** 外すことはあるので、
 * 設定で必ず上書きできるようにしてある（自動だけに任せない）。
 */
export function guessDrawMode(): DrawMode {
  if (typeof window === 'undefined') return 'high';
  try {
    const pwa = window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    if (pwa) return 'light';
    // 触れる画面 ＋ 細い画面を「スマホ」と見る。触れる画面だけだと
    // タッチ対応のノート PC まで低負荷になる。
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const narrow = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) <= 820;
    return touch && narrow ? 'light' : 'high';
  } catch {
    // 見当が付かないなら重いほうで出す。**絵が出ないより重いほうがまし。**
    return 'high';
  }
}

/**
 * いまの描画モード。`auto` はそのつど端末から解く（窓の大きさが変わっても付いていける）。
 *
 * **知っている値でなければ高負荷に倒す。** 覚えていた設定が壊れていたり、
 * 開発中の口（`window.__options`）から綴り違いを入れたときに、
 * 「間引く側」へ倒れると**画面が真っ暗になって理由が分からない**——
 * 重いほうへ倒れるぶんには、遅いだけで見えてはいる。
 */
export function drawMode(): DrawMode {
  const set = options.drawMode;
  if (set === 'auto') return guessDrawMode();
  return set === 'light' ? 'light' : 'high';
}

/**
 * その重い描画を出すか（GS-173）。**重い処理の手前で必ずこれを見る。**
 * 知らない名前を渡したら出す側に倒す——表に足し忘れて絵が消えるより、重いほうがまし。
 */
export function heavyOn(kind: HeavyDraw): boolean {
  if (drawMode() === 'high') return true;
  return HEAVY_DRAWS[kind]?.light ?? true;
}
