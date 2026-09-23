'use client';

// 「話せるよ」の合図（GS-49）。話しかけると動くイベントを持つ NPC の頭の上に出す。
//
// **近づくと出て、もっと近づくと動きが止まる。** 止まるだけで消さないのは、
// 「ここで押せる」という合図をいちばん必要な距離で引っ込めてしまわないため。
//
// 置き方は会話の吹き出し（GS-23）と同じで、3D 側に頭の画面位置を聞いて重ねる。
// 3D の中に板を足さないのは、**絵を 1 枚重ねるだけの話**に材質と影の面倒を持ち込まないため。
//
// コマ送りは**ほかのスプライトシートと同じやり方**（GS-122）。以前は CSS の `@keyframes` に
// 「96×32 の絵を 0 / -32px / -64px」と直に書いていたので、この絵だけ台帳（`spriteSheets.json`）の
// 外に居た。いまは台帳から区切りを読み、JS がコマを進める（攻撃の絵の `EffectSprite` と同じ）。

import { useEffect, useRef, useState } from 'react';
import { loadSpriteSheets, sheetUrl, spriteSheet, type SpriteSheetDef } from '../game/spriteSheets';

/** 合図の絵。台帳に区切りを書く（横 3 コマ）。 */
const MARK_SHEET = 'bubble.png';
/** 台帳に無いときの区切り。**合図が消えるより、既定で出すほうがまし。** */
const MARK_FALLBACK: SpriteSheetDef = { frameWidth: 32, frameHeight: 32, columns: 3, rows: 1 };
/** 1 秒にめくるコマ数。3 コマを 0.9 秒で回していた頃と同じ速さ。 */
const MARK_FPS = 10 / 3;

/** 出す相手 1 人ぶん。 */
export interface TalkMark {
  id: string;
  /** 画面の座標（頭の上）。 */
  x: number;
  y: number;
  /** 話せる距離まで来ているか。**来ていたら動きを止める。** */
  near: boolean;
}

export function TalkMarks({ probe }: { probe(): TalkMark[] }) {
  const [marks, setMarks] = useState<TalkMark[]>([]);
  const [cut, setCut] = useState<SpriteSheetDef>(MARK_FALLBACK);
  const probeRef = useRef(probe);
  probeRef.current = probe;
  /** いま出しているコマ。**近づいた相手は止める**ので、相手ごとに覚える。 */
  const frames = useRef(new Map<string, number>());
  const spin = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadSpriteSheets().then(() => {
      if (!alive) return;
      const found = spriteSheet(MARK_SHEET);
      if (found) setCut(found);
      else console.warn(`[talk-mark] 画像の区切りが台帳にありません: ${MARK_SHEET}（既定で出す）`);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // NPC はうろつくので、会話の吹き出しより細かく追う。
    let alive = true;
    const start = performance.now();
    const tick = (now: number) => {
      if (!alive) return;
      const next = probeRef.current();
      // コマは全員で共通に進める。**近づいた相手だけ**そのときのコマで止める（GS-49）。
      spin.current = Math.floor(((now - start) * MARK_FPS) / 1000);
      const held = frames.current;
      const seen = new Set<string>();
      for (const mark of next) {
        seen.add(mark.id);
        if (!mark.near) held.delete(mark.id);
        else if (!held.has(mark.id)) held.set(mark.id, spin.current);
      }
      for (const id of [...held.keys()]) if (!seen.has(id)) held.delete(id);
      setMarks(next);
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
    return () => {
      alive = false;
    };
  }, []);

  const total = Math.max(1, cut.columns * cut.rows);
  return (
    <>
      {marks.map((mark) => {
        const at = (frames.current.get(mark.id) ?? spin.current) % total;
        return (
          <div
            key={mark.id}
            className="talk-mark"
            style={{
              left: `${mark.x}px`,
              top: `${mark.y}px`,
              width: `${cut.frameWidth}px`,
              height: `${cut.frameHeight}px`,
              marginLeft: `${-cut.frameWidth / 2}px`,
              backgroundImage: `url("${sheetUrl(MARK_SHEET)}")`,
              backgroundSize: `${cut.columns * cut.frameWidth}px ${cut.rows * cut.frameHeight}px`,
              backgroundPosition: `${-(at % cut.columns) * cut.frameWidth}px ${-Math.floor(at / cut.columns) * cut.frameHeight}px`,
            }}
          />
        );
      })}
    </>
  );
}
