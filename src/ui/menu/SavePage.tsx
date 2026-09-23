'use client';

// セーブのページ（GS-27 / GS-54）。**枠 3 つ**に書く・読む。オート枠は読むだけ（GS-33）。

import { useEffect, useState } from 'react';
import {
  AUTO_SLOT,
  SAVE_SLOTS,
  listSaves,
  playTimeLabel,
  savedAtLabel,
  slotLabel,
  type SaveSummary,
} from '../../game/save';

export function SavePage({
  onSave,
  onLoad,
}: {
  onSave(slot: number): Promise<void>;
  onLoad(slot: number): Promise<void>;
}) {
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => void listSaves().then(setSaves);
  useEffect(refresh, []);

  // オート枠（GS-33）を先頭に、手で書く 3 枠を続ける。
  const rows = [AUTO_SLOT, ...Array.from({ length: SAVE_SLOTS }, (_, i) => i + 1)].map((slot) => ({
    slot,
    data: saves.find((entry) => entry.slot === slot) ?? null,
  }));

  return (
    <ul className="menu-slots">
      {rows.map(({ slot, data }) => (
        <li key={slot}>
          <span className="menu-slot">{slotLabel(slot)}</span>
          <span className="menu-info">
            {data
              ? `${data.map}  ${playTimeLabel(data.playSeconds)}  ${savedAtLabel(data.savedAt)}${data.stale ? '（古い形式）' : ''}`
              : '空き'}
          </span>
          {/* オート枠は読むだけ（GS-33）。押せる形で置いておくと、手で書けると思ってしまう。 */}
          <button
            type="button"
            data-pick
            disabled={busy || slot === AUTO_SLOT}
            onClick={async () => {
              setBusy(true);
              await onSave(slot);
              refresh();
              setBusy(false);
            }}
          >
            書く
          </button>
          <button
            type="button"
            data-pick
            disabled={busy || !data || data.stale}
            onClick={async () => {
              setBusy(true);
              await onLoad(slot);
              setBusy(false);
            }}
          >
            読む
          </button>
        </li>
      ))}
    </ul>
  );
}
