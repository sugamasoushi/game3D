'use client';

import { playTimeLabel, savedAtParts, type SaveSummary } from '../game/save';

/**
 * セーブ 1 枠の中身（メニューのセーブ・タイトルの「つづきから」で共通）。
 * 1 行目に本筋の章、2 行目にマップ名・遊んだ時間・書いた日付・時刻。
 * **欄はどれも幅を決めてある**——数字の桁が変わっても（9/6 → 10/16、5 分 → 1 時間 02 分）後ろの欄が動かない。
 * 日付は月を右寄せ・日を左寄せにして、「/」の位置を揃える。
 */
export function SaveDetail({ data, note = '' }: { data: SaveSummary; note?: string }) {
  const at = savedAtParts(data.savedAt);
  return (
    <span className="save-body">
      {/* 章が無い記録でも行の高さを揃えるため、空の行を置く。 */}
      <span className="save-chapter">{data.chapter || ' '}</span>
      <span className="save-line">
        <span className="save-map">{data.mapName}</span>
        <span className="save-time">{playTimeLabel(data.playSeconds)}</span>
        {at ? (
          <span className="save-at">
            <span className="save-date">
              <span className="save-month">{at.month}</span>/<span className="save-day">{at.day}</span>
            </span>
            <span className="save-clock">{at.clock}</span>
          </span>
        ) : null}
        {note ? <span className="save-note">{note}</span> : null}
      </span>
    </span>
  );
}
