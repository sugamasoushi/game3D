// キーボードの押下状態。押しっぱなしを毎フレーム読むため、イベントではなく集合で持つ。
// ゲームが使うキーはブラウザの既定動作を止める（矢印のスクロール、検索窓など）。

export interface Input {
  /** 押されているか。`KeyW` などの code で見る。 */
  down(code: string): boolean;
  /** このフレームで押し始めたか。読むと消える。 */
  pressed(code: string): boolean;
  shift(): boolean;
  /** 移動入力を -1..1 で返す。x は右、y は奥。 */
  axis(): { x: number; y: number };
  dispose(): void;
}

const MOVE_LEFT = ['KeyA', 'ArrowLeft'];
const MOVE_RIGHT = ['KeyD', 'ArrowRight'];
const MOVE_FORWARD = ['KeyW', 'ArrowUp'];
const MOVE_BACK = ['KeyS', 'ArrowDown'];

/**
 * ブラウザの既定動作を止めるキー。ゲームが使うものと、押すと検索窓が出るもの。
 * `/` と `'` はブラウザによってクイック検索を開く。
 */
const SWALLOW = new Set([
  ...MOVE_LEFT,
  ...MOVE_RIGHT,
  ...MOVE_FORWARD,
  ...MOVE_BACK,
  'Space',
  'KeyP',
  'KeyO',
  'KeyF',
  'KeyC',
  'KeyN',
  'KeyR',
  'KeyB',
  'KeyH',
  'Slash',
  'Quote',
]);

/** ブラウザの検索窓を開くキー。修飾つきなので code だけでは判定できない。 */
function opensFind(event: KeyboardEvent): boolean {
  if (event.code === 'F3') return true;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.code === 'KeyF' || event.code === 'KeyG';
}

/** 入力欄やドロップダウンを操作中か。ゲームのキーより文字入力を優先する。 */
function typingInField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function createInput(target: HTMLElement | Window = window): Input {
  const held = new Set<string>();
  const fresh = new Set<string>();
  let shiftHeld = false;

  const onDown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (typingInField(key.target)) return;
    if (opensFind(key)) {
      key.preventDefault();
      return;
    }
    // 既定動作の抑止はリピート判定より先に行う。押しっぱなしの 2 回目以降が
    // 素通りすると、ブラウザ側の動作（検索窓など）が出てしまう。
    if (SWALLOW.has(key.code)) key.preventDefault();
    if (key.repeat) return;
    shiftHeld = key.shiftKey;
    held.add(key.code);
    fresh.add(key.code);
  };
  const onUp = (event: Event) => {
    const key = event as KeyboardEvent;
    shiftHeld = key.shiftKey;
    held.delete(key.code);
  };
  const onBlur = () => {
    held.clear();
    fresh.clear();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);

  const anyOf = (codes: string[]) => codes.some((code) => held.has(code));

  return {
    down: (code) => held.has(code),
    pressed(code) {
      if (!fresh.has(code)) return false;
      fresh.delete(code);
      return true;
    },
    // ゲームパッドの「走る」は合成のキーイベントで来る（GS-58）。
    // 合成イベントに `shiftKey` は立てられないので、**押しているキーでも見る**。
    // 本物のキーボードの Shift も `ShiftLeft` / `ShiftRight` で入るので、扱いは同じ。
    shift: () => shiftHeld || held.has('ShiftLeft') || held.has('ShiftRight'),
    axis() {
      const x = (anyOf(MOVE_RIGHT) ? 1 : 0) - (anyOf(MOVE_LEFT) ? 1 : 0);
      const y = (anyOf(MOVE_BACK) ? 1 : 0) - (anyOf(MOVE_FORWARD) ? 1 : 0);
      const length = Math.hypot(x, y);
      if (length <= 1) return { x, y };
      return { x: x / length, y: y / length };
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
