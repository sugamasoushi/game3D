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
import { looksLikePhone } from './device';

/** 解いたあとの描画モード。**判断に使うのはこの 2 つだけ。** */
export type DrawMode = 'high' | 'light';

/**
 * 設定に持つ値。`auto` は端末から見当を付ける（旧作と同じ入り口）。
 * `custom` は描画ごとのチェック（`options.heavyDraws`）で決める（2026-11-04）。
 */
export type DrawModeSetting = 'auto' | DrawMode | 'custom';

/** 画面に出す名前。設定画面と、開発中の口（`__quality`）で使う。 */
export const DRAW_MODE_LABELS: Record<DrawModeSetting, string> = {
  auto: '自動',
  high: '高負荷（PC）',
  light: '低負荷（スマホ）',
  custom: 'カスタム',
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
  /**
   * 風による木の揺れ（GS-274）。`Sway` のレイヤーの頂点ごとに、風の数だけ範囲と波を計算する。
   * 低負荷では**風を渡さない**（木は止まる。シェーダは風 0 個なら先頭で抜ける）。フィールドエフェクトの「風」そのものの絵は出る。
   */
  windSway: { label: '風による木の揺れ', note: '揺れるレイヤーの頂点ごとに風を計算する。風の絵は低負荷でも出る', light: false },
  /**
   * 画面エフェクトの木漏れ日（`dapple`「差し込む光」。DEC-390）。**画面全体をもう 1 枚塗る**。
   * 低負荷では出さない（画面の霧・揺れは出る。フィールドエフェクトの木漏れ日も出る）。
   */
  screenDapple: { label: '木漏れ日（画面）', note: '画面全体に光の筋をもう 1 枚重ねる。画面の霧・揺れは低負荷でも出る', light: false },
  /**
   * 雲の影（DEC-218）。**画素ごとに雲のノイズを 2 枚読む**（マップ・人・置いた 3D のどれも）。
   * 低負荷では光の設定の `cloudShadow` を切って渡す（`lightingForDrawMode`）。太陽の影は出る。
   */
  /**
   * 太陽の影（DEC-145）。影そのもの——マップの影・キャラクターの足元の影・建物の影を受ける面のすべて。
   * 焼くのは変わったときだけだが、受ける画素ごとに毎フレーム読む。**低負荷でも出す**（カスタムでだけ切れる）。
   * 切るときは光の設定の `blockShadow` を切って渡す（`lightingForDrawMode`）。旧方式の塗りも出ない。
   */
  sunShadow: { label: '影', note: '太陽の影とキャラクターの足元の影。切ると影を焼かず、読まない', light: true },
  cloudShadow: { label: '雲の影', note: '画素ごとに雲の模様を読む。太陽の影は低負荷でも出る', light: false },
  /**
   * 太陽の影の縁のなめらかさ（DEC-145）。影を受ける画素ごとに焼いた影を **4×4＝16 回**読む。
   * 低負荷では 1 回だけ読む（縁はギザギザになるが、影は出る）。焼く回数は変わらない。
   */
  softShadow: { label: '影の縁のなめらかさ', note: '画素ごとに影を 16 回読む。低負荷は 1 回（影そのものは出る）', light: false },
  /**
   * キャラクターの足元の影（DEC-157）。焼かずに、**画素ごとに人数ぶん**計算する（最大 `MAX_SUN_ACTORS`）。
   * 低負荷ではカメラに近い `LIGHT_SUN_ACTORS` 人だけにする（`sunActorLimit`）。
   */
  actorShadows: { label: 'キャラクターの影（全員）', note: '画素ごとに人数ぶん計算する。低負荷は近い 2 人だけ', light: false },
  /**
   * チルトシフト（ぼかし）。**毎フレーム画面を 1 枚写して、もう 1 回描く**。
   * 低負荷では出さない（マップ・戦闘の構図・カメラ演出でオンでも切る。`cameraFxForDrawMode`）。色被せは出る。
   */
  tiltShift: { label: 'チルトシフト', note: '毎フレーム画面を写してぼかす。色被せは低負荷でも出る', light: false },
  /**
   * 全画面で拡大しているときの細かさ（`GameView` の `renderRatio`）。倍率に合わせて最大 1.5 倍で描く。
   * 低負荷ではいつも 1280×720 で描く。
   */
  highRes: { label: '全画面を細かく描く', note: '全画面で拡大したとき最大 1.5 倍の細かさで描く。切ると 1280×720 のまま', light: false },
} as const;

export type HeavyDraw = keyof typeof HEAVY_DRAWS;

/**
 * 端末から見当を付ける（旧作の `ExecutionEnvironment.updateHighDraw` と同じ判断）。
 * **触れる画面か、ホーム画面から開いた PWA なら低負荷。** 外すことはあるので、
 * 設定で必ず上書きできるようにしてある（自動だけに任せない）。
 */
export function guessDrawMode(): DrawMode {
  // 判断は `device.ts`（仮想パッドの「自動」と同じ物差し）。見当が付かなければ重いほうで出す。
  return looksLikePhone() ? 'light' : 'high';
}

/**
 * いまの描画モード。`auto` はそのつど端末から解く（窓の大きさが変わっても付いていける）。
 *
 * **知っている値でなければ高負荷に倒す。** 覚えていた設定が壊れていたり、
 * 開発中の口（`window.__options`）から綴り違いを入れたときに、
 * 「間引く側」へ倒れると**画面が真っ暗になって理由が分からない**——
 * 重いほうへ倒れるぶんには、遅いだけで見えてはいる。
 */
export function drawMode(): DrawMode | 'custom' {
  const set = options.drawMode;
  if (set === 'auto') return guessDrawMode();
  if (set === 'custom') return 'custom';
  return set === 'light' ? 'light' : 'high';
}

/** そのモードで出す物の一覧（GS-173）。カスタムを初めて選んだときのチェックの始まりに使う。 */
export function heavyDrawsOf(mode: DrawMode): Record<HeavyDraw, boolean> {
  const out = {} as Record<HeavyDraw, boolean>;
  for (const kind of Object.keys(HEAVY_DRAWS) as HeavyDraw[]) out[kind] = mode === 'high' ? true : HEAVY_DRAWS[kind].light;
  return out;
}

/**
 * その重い描画を出すか（GS-173）。**重い処理の手前で必ずこれを見る。**
 * 知らない名前を渡したら出す側に倒す——表に足し忘れて絵が消えるより、重いほうがまし。
 */
export function heavyOn(kind: HeavyDraw): boolean {
  const mode = drawMode();
  if (mode === 'high') return true;
  // カスタムはチェックのとおり。書いていない物は出す（表に足したばかりの物が黙って消えないように）。
  if (mode === 'custom') return options.heavyDraws?.[kind] ?? true;
  return HEAVY_DRAWS[kind]?.light ?? true;
}

/**
 * 光の設定を描画モードに合わせる（GS-173）。雲の影（`cloudShadow`）と影（`blockShadow`）を切る。
 * ほかの値は触らない。切る物が無ければ同じ物をそのまま返す（ローダが組み直さないように）。
 * `blockShadow` は書いていなければ出す扱い（`LIGHTING_DEFAULTS`）なので、切るときは false を書く。
 */
export function lightingForDrawMode<T extends { cloudShadow?: boolean; blockShadow?: boolean }>(lighting: T): T {
  const cutCloud = lighting.cloudShadow === true && !heavyOn('cloudShadow');
  const cutShadow = lighting.blockShadow !== false && !heavyOn('sunShadow');
  if (!cutCloud && !cutShadow) return lighting;
  return { ...lighting, ...(cutCloud ? { cloudShadow: false } : {}), ...(cutShadow ? { blockShadow: false } : {}) };
}

/** 低負荷で足元の影を出す人数（カメラに近い順）。 */
export const LIGHT_SUN_ACTORS = 2;

/** 足元の影を出す人数の上限（GS-173）。低負荷では `LIGHT_SUN_ACTORS` 人まで。 */
export function sunActorLimit(max: number): number {
  return heavyOn('actorShadows') ? max : Math.min(max, LIGHT_SUN_ACTORS);
}

/** カメラの見た目を描画モードに合わせる（GS-173）。低負荷ではチルトシフトを切る。ほかの値は触らない。 */
export function cameraFxForDrawMode<T extends { tilt?: boolean }>(fx: T): T {
  if (!fx.tilt || heavyOn('tiltShift')) return fx;
  return { ...fx, tilt: false };
}
