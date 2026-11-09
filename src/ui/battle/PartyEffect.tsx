// 味方に当たった技の絵（GS-328。2026-11-08）。コマンド戦闘では、味方への技の絵（コマ絵）を**隊列の窓のその人の行の上**に
// HTML の重ね絵で出す（舞台の味方の板には出さない）。窓より手前に描くので、命令・隊列の窓に隠れない。
//
// 置き方（`effects.json` の `place`）はそのまま使う: 当てる点（顔の真ん中／顔の下端）・基準点・「戦闘: 味方に」のずらし・
// 「味方に出すときの大きさ」（書かなければコマンド戦闘の大きさ）。大きさは画面の画素。出す場所は顔か画面の真ん中（GS-330）。
// 並べ方の計算は `effectPlace.ts` の `partyFxBox`。コマのめくり方は 3D の板と同じ `fieldFxFrame`。

import { useEffect, useState, type CSSProperties } from 'react';
import type { SpriteEffectDef } from '../../game/battle/book';
import { effectImage } from '../../game/battle/book';
import { fieldFxFrame } from '../../game/fieldFx';
import { partyFxBox } from '../../game/effectPlace';

export function PartyEffect({ def, guide = false }: { def: SpriteEffectDef; guide?: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = () => {
      setT(performance.now() - start);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const { frame, scale } = fieldFxFrame(def, t);
  // 出す場所（顔／画面の真ん中。GS-330）は置き方から。土台はそれぞれ隊列の窓の行・画面いっぱいの層。
  const box = partyFxBox({ width: def.frameWidth, height: def.frameHeight }, scale, def.place);
  const columns = Math.max(1, def.columns);
  const rows = Math.max(1, def.rows ?? 1);
  const col = frame % columns;
  const row = Math.floor(frame / columns);
  const url = effectImage(def);
  const style: CSSProperties = {
    left: `${box.left}px`,
    bottom: `${box.bottom}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    ...(url ? { backgroundImage: `url("${url}")` } : {}),
    backgroundSize: `${columns * box.width}px ${rows * box.height}px`,
    backgroundPosition: `${-col * box.width}px ${-row * box.height}px`,
  };
  return (
    <span className={guide ? 'battle-party-fx guide' : 'battle-party-fx'} style={style} aria-hidden="true">
      {guide ? (
        <>
          {/* 基準点を通る縦横の線（戦闘演出エディタの「絵の枠」）。 */}
          <i className="fx-guide-h" style={{ top: `${box.pivot[1] * 100}%` }} />
          <i className="fx-guide-v" style={{ left: `${box.pivot[0] * 100}%` }} />
        </>
      ) : null}
    </span>
  );
}
