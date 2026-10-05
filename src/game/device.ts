// 端末の見当（GS-173 / GS-214）。**スマホらしいかの判断はここ 1 か所。**
//
// 描画モードの「自動」（`quality.ts`）と仮想パッドの「自動」（`options.ts`）が同じ物差しを使う。
// 別々に `navigator` を見ると、片方だけ「スマホ」と見る端末ができる。

/**
 * スマホとして扱うか（旧作の `ExecutionEnvironment.updateHighDraw` と同じ判断）。
 * **ホーム画面から開いた PWA か、触れる画面 ＋ 細い画面。** 触れる画面だけだと
 * タッチ対応のノート PC までスマホになる。外すことはあるので、使う側は必ず設定で上書きできるようにする。
 */
export function looksLikePhone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const pwa = window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    if (pwa) return true;
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const narrow = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) <= 820;
    return touch && narrow;
  } catch {
    // 見当が付かないなら PC として扱う。
    return false;
  }
}
