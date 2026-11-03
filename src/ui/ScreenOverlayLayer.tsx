'use client';

import { SCREEN_OVERLAYS, type ScreenOverlayScene } from '../game/screenOverlays';
import { useUi } from './store';

/**
 * 画面の重ね表示（GS-300。`game/screenOverlays.ts`）。種類ごとに板を 1 枚ずつ**いつも置いておき**、
 * 出す／消すは `data-on` で切り替える——置いたり外したりすると、薄れて消える途中が描けない。
 * 出すのは**旗が立っていて、いまの場面（`scene`）がその種類の場面のとき**だけ。
 * タイトルなど場面が無いとき（null）は全部消す。旗そのものは残るので、戻れば元どおり出る。
 *
 * 戦闘の画面（`.battle`）は地が透明なので、この層は戦闘中も窓の後ろに透けて見える。
 */
export default function ScreenOverlayLayer({ scene }: { scene: ScreenOverlayScene | null }) {
  const overlays = useUi((s) => s.screenOverlays);
  return (
    <>
      {SCREEN_OVERLAYS.map(({ kind, scene: where }) => (
        <div
          key={kind}
          className={`screen-overlay screen-overlay--${kind}`}
          data-on={scene === where && overlays[kind] ? '' : undefined}
          aria-hidden
        />
      ))}
    </>
  );
}
