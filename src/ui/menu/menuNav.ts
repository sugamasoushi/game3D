// メニューのカーソル（GS-206）。**ゲーム中のメニューとタイトルの設定画面で同じ動き**にするため、ここに置く。
// カーソルが止まる所は `data-pick`。ゲームパッドの合成キー（GS-58）も同じ道を通る。

export const PICK = '[data-pick]:not(:disabled)';

export type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * `from` から `dir` の向きにいちばん近い物（GS-206）。
 * 上下は**まず一番近い行**、その中で横にいちばん近い物——列を保ったまま行を移る。
 * 左右は同じ行の中だけ。見つからなければ null（端で反対へ回り込ませない。GS-72 と同じ考え）。
 */
export function nearest(from: HTMLElement, list: HTMLElement[], dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const found: { el: HTMLElement; main: number; cross: number }[] = [];
  for (const el of list) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const sameRow = Math.abs(by - ay) < Math.max(a.height, b.height) / 2;
    if (dir === 'left' || dir === 'right') {
      if (!sameRow) continue;
      const main = dir === 'right' ? bx - ax : ax - bx;
      if (main > 0) found.push({ el, main, cross: 0 });
    } else {
      if (sameRow) continue;
      const main = dir === 'down' ? by - ay : ay - by;
      if (main > 0) found.push({ el, main, cross: Math.abs(bx - ax) });
    }
  }
  if (found.length === 0) return null;
  const row = Math.min(...found.map((entry) => entry.main));
  // 同じ行と見なす幅。行の中で高さが少し違う物（ボタンと文字）を同じ行に数える。
  const inRow = found.filter((entry) => entry.main <= row + 8);
  inRow.sort((p, q) => p.cross - q.cross || p.main - q.main);
  return inRow[0].el;
}

/**
 * つまみ（range）・選ぶ箱（select）の値を動かす（GS-206）。
 * **ゲームパッドの合成イベントは既定動作をしない**（GS-58）ので、キーボードも含めて自分で動かす。
 * React が気づくよう、素の setter で書いてから `input` / `change` を流す。
 */
export function nudge(el: HTMLInputElement | HTMLSelectElement, delta: number): void {
  if (el instanceof HTMLSelectElement) {
    const next = el.selectedIndex + delta;
    if (next < 0 || next >= el.options.length) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, el.options[next].value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const step = Number(el.step) || 1;
  const min = el.min === '' ? 0 : Number(el.min);
  const max = el.max === '' ? 100 : Number(el.max);
  const next = Math.min(max, Math.max(min, Number(el.value) + delta * step));
  if (next === Number(el.value)) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(next));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
