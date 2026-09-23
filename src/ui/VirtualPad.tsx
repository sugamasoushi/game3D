'use client';

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { canWalk, useUi } from './store';

export const DIRECTION_BUTTONS = [
  { label: '↖', name: '左上', codes: ['ArrowUp', 'ArrowLeft'] },
  { label: '↑', name: '上', codes: ['ArrowUp'] },
  { label: '↗', name: '右上', codes: ['ArrowUp', 'ArrowRight'] },
  { label: '←', name: '左', codes: ['ArrowLeft'] },
  { label: '', name: '', codes: [] },
  { label: '→', name: '右', codes: ['ArrowRight'] },
  { label: '↙', name: '左下', codes: ['ArrowDown', 'ArrowLeft'] },
  { label: '↓', name: '下', codes: ['ArrowDown'] },
  { label: '↘', name: '右下', codes: ['ArrowDown', 'ArrowRight'] },
] as const;

export const FACE_BUTTONS = [
  { label: '△', name: 'メニュー', code: 'Escape', place: 'triangle' },
  { label: '✕', name: '取り消し', code: 'Escape', place: 'cross' },
  { label: '□', name: '走る', code: 'ShiftLeft', place: 'square' },
  { label: '○', name: '決定', code: 'Enter', place: 'circle' },
] as const;

const keyValue = (code: string) => {
  if (code.startsWith('Arrow') || code === 'Enter' || code === 'Escape') return code;
  if (code.startsWith('Shift')) return 'Shift';
  return code;
};

function sendKey(type: 'keydown' | 'keyup', code: string) {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      code,
      key: keyValue(code),
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 選択画面では斜めの2キーを上下1キーへ絞り、カーソルが2回動くのを防ぐ。 */
export function directionKeys(codes: readonly string[], walking: boolean): readonly string[] {
  return walking || codes.length <= 1 ? codes : codes.slice(0, 1);
}

/** 旧作の左右パッド。合成キーへ変換し、キーボード・物理パッドと同じ入力経路へ流す。 */
export function VirtualPad() {
  const pointers = useRef(new Map<number, readonly string[]>());
  const held = useRef(new Map<string, number>());

  const release = (pointerId: number) => {
    const codes = pointers.current.get(pointerId);
    if (!codes) return;
    pointers.current.delete(pointerId);
    for (const code of codes) {
      const next = (held.current.get(code) ?? 1) - 1;
      if (next > 0) held.current.set(code, next);
      else {
        held.current.delete(code);
        sendKey('keyup', code);
      }
    }
  };

  const press = (pointerId: number, codes: readonly string[]) => {
    release(pointerId);
    pointers.current.set(pointerId, codes);
    for (const code of codes) {
      const before = held.current.get(code) ?? 0;
      held.current.set(code, before + 1);
      if (before === 0) sendKey('keydown', code);
    }
  };

  const down = (codes: readonly string[]) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    press(event.pointerId, codes);
  };
  const directionDown = (codes: readonly string[]) => (event: ReactPointerEvent<HTMLButtonElement>) =>
    down(directionKeys(codes, canWalk(useUi.getState())))(event);
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    release(event.pointerId);
  };
  /** Enter／Spaceや支援機能によるclick。通常のポインターclickは既に処理済みなので重ねない。 */
  const activate = (codes: readonly string[]) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    for (const code of codes) sendKey('keydown', code);
    for (const code of codes) sendKey('keyup', code);
  };
  /** 円の空白も入力面。背後のcanvasやボタンへ押下を通さない。 */
  const blockDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const blockUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const blockClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(
    () => () => {
      for (const code of held.current.keys()) sendKey('keyup', code);
      held.current.clear();
      pointers.current.clear();
    },
    [],
  );

  return (
    <div className="virtual-pad" aria-label="仮想パッド">
      <div
        className="virtual-control virtual-left"
        onPointerDown={blockDown}
        onPointerUp={blockUp}
        onPointerCancel={blockUp}
        onClick={blockClick}
        onContextMenu={blockClick}
      >
        <div className="virtual-dpad">
          {DIRECTION_BUTTONS.map((button, index) =>
            button.codes.length ? (
            <button
              key={button.name}
              type="button"
              className="virtual-button virtual-direction"
              aria-label={button.name}
              title={button.name}
              onPointerDown={directionDown(button.codes)}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              onClick={activate(button.codes)}
              onContextMenu={(event) => event.preventDefault()}
            >
              {button.label}
            </button>
            ) : (
              <span key={index} className="virtual-dpad-center" aria-hidden="true" />
            ),
          )}
        </div>
      </div>
      <div
        className="virtual-control virtual-right"
        onPointerDown={blockDown}
        onPointerUp={blockUp}
        onPointerCancel={blockUp}
        onClick={blockClick}
        onContextMenu={blockClick}
      >
        <div className="virtual-face">
          {FACE_BUTTONS.map((button) => (
            <button
              key={button.label}
              type="button"
              className={`virtual-button virtual-face-button ${button.place}`}
              aria-label={button.name}
              title={button.name}
              onPointerDown={down([button.code])}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              onClick={activate([button.code])}
              onContextMenu={(event) => event.preventDefault()}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
