'use client';

// 状態異常の札（GS-69 / GS-71）。**戦闘の中でも外でも同じ物**を出す。
//
// **名前ではなく 1 文字**（毒・眠）。名前を並べると HP の数が押し出されるし、
// 2 つ以上かかったときに行が折り返す。読み方はホバーで出す（`title`）。

import { ailmentDef } from '../game/battle/book';

export function AilTags({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="ail-tags">
      {ids.map((id) => (
        <span key={id} className="ail-tag" title={ailmentDef(id)?.name ?? id}>
          {ailmentDef(id)?.short ?? '？'}
        </span>
      ))}
    </span>
  );
}
