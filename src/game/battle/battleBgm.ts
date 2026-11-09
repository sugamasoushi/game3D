// 戦闘の曲を決める（2026-11-09）。戦闘の曲は場面ごとに増やしていくので、**どの曲を流すかはここ 1 か所で決める**。
//
// 上から順に見て、最初に書いてあった曲を流す。
//   1. イベントの戦闘（`battle` 命令の `bgm`）……ボス戦など、その 1 回だけの曲
//   2. 敵（`enemies.json` の `battleBgm`）……並びの前の敵ほど優先（敵シンボルなら触った敵、巻き込んだ敵は後ろ）
//   3. マップ（`maps.json` の `battleBgm`）……そのマップで戦うときの曲
//   4. 戦闘共通（`battleSettings.json` の `bgm`）……どれにも書いていないとき
//
// **曲を選ぶ場所を足すときは、`BattleBgmSources` に 1 つ足して、下の並びの決めた位置に入れる。**
// 台帳を足したら、Game Checker の `src/references.ts`（BattleBGM フォルダの音だけ）と台帳エディタの音の使用箇所
// （`Ledger Editor/validate.mjs` の `soundUsage`）も合わせる。

/** 戦闘の曲を書ける所。空の文字は「書いていない」と同じ。 */
export interface BattleBgmSources {
  /** イベントの `battle` 命令の `bgm`。 */
  event?: string;
  /** 戦う敵それぞれの `battleBgm`（並びは戦闘の敵の並び）。 */
  enemies?: Array<string | undefined>;
  /** 戦うマップの `battleBgm`。 */
  map?: string;
  /** 戦闘共通の曲（`battleSettings().bgm`）。 */
  common: string;
}

/** 流す戦闘の曲（`sounds.json` のキー）。 */
export function battleBgmFor(sources: BattleBgmSources): string {
  const order = [sources.event, ...(sources.enemies ?? []), sources.map];
  return order.find((key): key is string => typeof key === 'string' && key !== '') ?? sources.common;
}
