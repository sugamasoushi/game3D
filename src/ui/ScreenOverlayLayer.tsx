'use client';

import { SCREEN_OVERLAY_KINDS } from '../game/screenOverlays';
import { useUi } from './store';

/**
 * 画面の重ね表示（GS-300。`game/screenOverlays.ts`）。種類ごとに板を 1 枚ずつ**いつも置いておき**、
 * 出す／消すは `data-on` で切り替える——置いたり外したりすると、薄れて消える途中が描けない。
 * `shown` が false のあいだ（戦闘・タイトル）は全部消す。出す旗そのものは残るので、戻れば元どおり出る。
 */
export default function ScreenOverlayLayer({ shown }: { shown: boolean }) {
  const overlays = useUi((s) => s.screenOverlays);
  return (
    <>
      {SCREEN_OVERLAY_KINDS.map((kind) => (
        <div
          key={kind}
          className={`screen-overlay screen-overlay--${kind}`}
          data-on={shown && overlays[kind] ? '' : undefined}
          aria-hidden
        />
      ))}
    </>
  );
}
