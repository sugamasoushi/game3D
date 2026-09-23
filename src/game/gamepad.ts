// ゲームパッド（GS-58）。旧作にあってこちらに無かった入力（§5.4）。
//
// **キーボードと同じ道を通す。** パッドの押した／離したを**合成のキーイベント**にして
// `window` へ流すだけで、歩き（`input.ts`）・会話の送り・メニュー・Esc が
// **そのまま**動く。入力の受け口をもう 1 本作ると、「決定とは何か」を決める場所が
// 2 つになり、片方だけ直す事故が起きる（GS-13 と同じ考え）。
//
// 割り当ては**旧作と同じ**（`InputManager.stepCallback`）:
//   ○(1)=決定 / ✕(0)=キャンセル / △(3)=メニュー / 十字 12〜15 / L・R=走る
// ✕ と △ はどちらも Esc にしてある——このゲームの「閉じる」と「メニュー」は同じキー。
//
// **繋がっていなければ何もしない。** 毎フレームの `getGamepads()` は繋がっていないとき
// ほぼ無料で、繋いだ瞬間から効き始める（`gamepadconnected` を待たなくてよい）。

/** 倒したと見なす傾き。これ未満は手を離しているものとして扱う。 */
const DEADZONE = 0.35;
/** 押しっぱなしの連射（ミリ秒）。**メニューの上下に要る**——歩きには影響しない。 */
const REPEAT_FIRST = 400;
const REPEAT_NEXT = 120;

/**
 * ボタン番号 → キーの `code`。**同じキーに複数のボタンを割ってよい**。
 * 押している数を数えるので、片方を離しても離した扱いにならない。
 */
const BUTTON_KEYS: Record<number, string> = {
  0: 'Escape', // ✕ キャンセル
  1: 'Enter', // ○ 決定
  3: 'Escape', // △ メニュー
  4: 'ShiftLeft', // L1 走る
  5: 'ShiftLeft', // R1 走る
  6: 'ShiftLeft', // L2
  7: 'ShiftLeft', // R2
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

/** 連射させるキー。移動と一覧の上下だけ——決定を連射すると会話が飛ぶ。 */
const REPEATS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** いま押している `code` ごとの状態。 */
interface Held {
  /** その `code` を押しているボタン・スティックの数。 */
  count: number;
  /** 次に連射する時刻（ミリ秒）。 */
  repeatAt: number;
}

function keyEvent(type: 'keydown' | 'keyup', code: string, repeat: boolean): KeyboardEvent {
  // `key` も入れる。会話ウィンドウやメニューは `key`、歩きは `code` を見る。
  const key = code.startsWith('Arrow') || code === 'Enter' || code === 'Escape' ? code : 'Shift';
  return new KeyboardEvent(type, { code, key, repeat, bubbles: true });
}

/**
 * パッドを見張り始める。返り値を呼ぶと止まる。
 * 画面が隠れている間は `requestAnimationFrame` が止まるので、そのぶんは動かない。
 */
export function startGamepad(): () => void {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return () => undefined;
  }
  const held = new Map<string, Held>();
  let frame = 0;
  let stopped = false;

  /** その `code` を押している数を `next` にする。0 になったら離す。 */
  const setCount = (code: string, next: number, now: number) => {
    const found = held.get(code);
    const before = found?.count ?? 0;
    if (next === before) return;
    if (next > 0) {
      held.set(code, { count: next, repeatAt: found?.repeatAt ?? now + REPEAT_FIRST });
      if (before === 0) window.dispatchEvent(keyEvent('keydown', code, false));
      return;
    }
    held.delete(code);
    window.dispatchEvent(keyEvent('keyup', code, false));
  };

  const tick = () => {
    if (stopped) return;
    frame = window.requestAnimationFrame(tick);
    const pads = navigator.getGamepads();
    const now = performance.now();
    // `code` ごとに「いくつ押されているか」を数え直す。
    const counts = new Map<string, number>();
    const bump = (code: string) => counts.set(code, (counts.get(code) ?? 0) + 1);

    let any = false;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      any = true;
      pad.buttons.forEach((button, index) => {
        if (!button.pressed && button.value < 0.5) return;
        const code = BUTTON_KEYS[index];
        if (code) bump(code);
      });
      // 左スティック。十字キーと同じ扱いにする（速さは向きだけで決まる）。
      const [x = 0, y = 0] = pad.axes;
      if (x <= -DEADZONE) bump('ArrowLeft');
      if (x >= DEADZONE) bump('ArrowRight');
      if (y <= -DEADZONE) bump('ArrowUp');
      if (y >= DEADZONE) bump('ArrowDown');
    }

    // 繋がっていないなら、押しっぱなしを残さず全部離す。
    if (!any && held.size === 0) return;

    for (const code of new Set([...counts.keys(), ...held.keys()])) {
      setCount(code, counts.get(code) ?? 0, now);
    }
    // 連射。`repeat` を立てるので `input.ts` は無視し、一覧のキー操作だけが受け取る。
    for (const [code, state] of held) {
      if (!REPEATS.has(code) || now < state.repeatAt) continue;
      state.repeatAt = now + REPEAT_NEXT;
      window.dispatchEvent(keyEvent('keydown', code, true));
    }
  };

  frame = window.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    // 止めるときに押しっぱなしを残さない。残すと歩き続ける。
    for (const code of held.keys()) window.dispatchEvent(keyEvent('keyup', code, false));
    held.clear();
  };
}
