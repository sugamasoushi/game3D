// 会話の窓の送り方（GS-199 / GS-210）。**画面から切り離した計算だけ**——測るのは呼ぶ側
// （`MessageWindow` が見えない写しに並べて丈を測る）。ここは「何文字で何行になるか」を受け取って、
// どこで止めて、送ったら何行目を窓の一番上に出すかを決める。

/** 窓 1 枚ぶんの区切り。 */
export interface MessagePage {
  /** ここまで打ったら止まる（文字数）。 */
  at: number;
  /** 送ったあと窓の一番上に出す行（0 始まり）。次の窓の 1 行目。 */
  top: number;
}

/**
 * 窓が埋まる所を探す（GS-199）。`page` は窓の行数（会話 3・吹き出し 2）。
 *
 * - `fit(count)`: 頭から `count` 文字を並べたときの行数。**止まったときの姿**で測る
 *   （会話ウィンドウは ▼ の印も付けて。行末ぴったりで止めると ▼ だけ次の行へ落ちるので）
 * - `plain(count)`: 印なしの行数。次の窓の 1 行目を決めるのに使う
 *
 * 止まるのは「`fit` が窓の行数に収まる一番長い所」。送ったあとは**次の行を窓の一番上へ**（GS-210）。
 * 書いた空行も 1 行として窓に出す。ただ、印なしで測る吹き出しは空行の手前で止まることがあり、
 * そのときは空行を飛ばして次に字がある行を一番上にする。
 */
export function splitPages(
  length: number,
  page: number,
  fit: (count: number) => number,
  plain: (count: number) => number,
): MessagePage[] {
  const pages: MessagePage[] = [];
  // 行数がこれを超えたら止まる。
  let edge = page;
  let low = 0;
  while (low < length && fit(length) > edge) {
    // low 文字では edge 行に収まり、high 文字ではあふれる。
    let high = length;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (fit(mid) > edge) high = mid;
      else low = mid;
    }
    // high 文字目が載る行。末尾の改行は行を増やさないので、印なしの丈から数える。
    const top = Math.max(edge, plain(high) - 1);
    if (low > (pages[pages.length - 1]?.at ?? 0)) pages.push({ at: low, top });
    // 次の窓は、その 1 行目から窓の行数ぶん。
    edge = top + page;
    low = high;
  }
  return pages;
}

/** 次に止まる所（文字数）。`from` より先の区切り、無ければ終わり（`end`）。 */
export function nextStop(pages: MessagePage[], from: number, end: number): number {
  return pages.find((one) => one.at > from)?.at ?? end;
}

/**
 * 窓の一番上に出す行（GS-210）。`limit`（ここまで打ってよい）が区切りを越えていれば、
 * その区切りの次の窓の 1 行目。まだ最初の窓なら 0。
 */
export function pageTop(pages: MessagePage[], limit: number): number {
  let top = 0;
  for (const one of pages) if (one.at < limit) top = Math.max(top, one.top);
  return top;
}
