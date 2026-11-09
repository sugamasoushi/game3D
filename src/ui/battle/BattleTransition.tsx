'use client';

import type { CSSProperties } from 'react';
import { BATTLE_WIPE_MS, battleWipeBars } from '../../game/battle/transition';
import { useUi } from '../store';

const BARS = battleWipeBars();

/**
 * 戦闘へ入る・出るときの場面転換（2026-11-09。`game/battle/transition.ts`）。
 * 段（`battleWipe`）を進めるのは `GameCanvas` の `startBattle` / `endBattle`。ここは段ごとの絵だけ。
 * 戦闘の画面（`.battle`）より上に重ねる。押しても何も起きない（クリックは素通し）。
 */
export function BattleTransition() {
  const wipe = useUi((s) => s.battleWipe);
  if (!wipe) return null;
  if (wipe === 'exit' || wipe === 'return') {
    return (
      <div
        className="battle-fade"
        data-wipe={wipe}
        style={{ animationDuration: `${wipe === 'exit' ? BATTLE_WIPE_MS.exitFade : BATTLE_WIPE_MS.exitReturn}ms` }}
        aria-hidden
      />
    );
  }
  return (
    <div className="battle-wipe" data-wipe={wipe} aria-hidden>
      {wipe === 'cover' ? (
        <>
          <div className="battle-wipe-flash" style={{ animationDuration: `${BATTLE_WIPE_MS.flash}ms` }} />
          <div className="battle-wipe-lines" />
        </>
      ) : null}
      <div className="battle-wipe-bars">
        {BARS.map((bar, index) => (
          <div
            key={index}
            className="battle-wipe-bar"
            style={{
              '--dir': bar.from === 'left' ? -1 : 1,
              animationDuration: `${wipe === 'cover' ? BATTLE_WIPE_MS.barIn : BATTLE_WIPE_MS.barOut}ms`,
              animationDelay: `${wipe === 'cover' ? bar.delayIn : bar.delayOut}ms`,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
