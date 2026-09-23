'use client';

// オープニングを動かす（GS-126）。**並びは台帳が決める**（`game/opening.ts`）。
//
// 動かし方は Web Animations（`element.animate`）。CSS の keyframes だと
// 「いつ・どれだけ」を台帳から渡せず、絵を 1 枚増やすたびに CSS を書き足すことになる。
//
// **飛ばせる。** キー・クリック・パッドのどれでも終わりまで進む——
// 旧作には無かったが、2 度目からは邪魔になるので付けた。
//
// ただし**最初の 1 回は「とばす」に使わない**（GS-128）。ブラウザは操作があるまで音を出さないので、
// 読み込み直後は無音で始まる。音を出そうとして画面を押した人が、そのままオープニングを
// 飛ばしてしまい**一度も見られない**——実際にそうなった。1 回目は音を出すためだけに使い、
// 2 回目からとばす。はじめから音が出せる状態（2 度目のタイトルなど）なら 1 回目からとばせる。

import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../game/assets';
import { audioUnlocked } from '../game/audio';
import { CHARA_DROP, offsetOf, openingLength, openingSteps, type OpeningBook } from '../game/opening';

/** 案内を出すまでの間（ミリ秒）。頭から出すと絵より先に字が目に入る。 */
const HINT_MS = 900;

export function Opening({ book, onDone }: { book: OpeningBook; onDone(): void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState(false);
  // 二重に終わらせない（時間切れと「とばす」が重なったとき）。
  const doneRef = useRef(false);
  /**
   * 押したら飛ばしてよいか。**音が出せない間は false**——その 1 回は音のために使う。
   * 動かすのは ref（イベントの中から読む）、見せるのは state（案内の文を変える）。
   */
  const skippableRef = useRef(false);
  const [skippable, setSkippable] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const animations: Animation[] = [];

    for (const step of openingSteps(book)) {
      const node = box.querySelector<HTMLElement>(`[data-part="${step.cut}-${step.part}"]`);
      if (!node) continue;
      const away = `translateX(${offsetOf(step.side)}px)`;
      animations.push(
        node.animate(step.kind === 'in' ? [{ transform: away }, { transform: 'none' }] : [{ transform: 'none' }, { transform: away }], {
          duration: step.ms,
          delay: step.at,
          easing: step.ease,
          // 入る絵は**始まる前も**端に置いておく（`both`）。抜ける絵は始まるまで手を出さない
          // （`forwards`）——`both` にすると、入っている最中に「抜ける前の位置」で固定してしまう。
          fill: step.kind === 'in' ? 'both' : 'forwards',
        }),
      );
    }

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      for (const animation of animations) animation.cancel();
      onDone();
    };

    // もう音が出せるなら、1 回目からとばせる。
    skippableRef.current = audioUnlocked();
    setSkippable(skippableRef.current);

    const onInput = () => {
      if (!skippableRef.current) {
        // **この 1 回は音のため。** 音を出す仕掛け（`unlockAudio`）は GameCanvas が
        // 同じ操作で動かすので、ここは「とばさない」と決めるだけでよい。
        skippableRef.current = true;
        setSkippable(true);
        return;
      }
      finish();
    };

    const timer = window.setTimeout(finish, openingLength(book));
    const hintTimer = window.setTimeout(() => setHint(true), HINT_MS);
    // どれで押しても同じ口に乗る。パッドは合成のキーイベントで来る（GS-58）。
    window.addEventListener('keydown', onInput);
    window.addEventListener('pointerdown', onInput);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hintTimer);
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('pointerdown', onInput);
      for (const animation of animations) animation.cancel();
    };
  }, [book, onDone]);

  return (
    <div className="opening" ref={boxRef}>
      {/* 背景はまとめて先に出す。**立ち絵は全部その上**（旧作の depth と同じ重なり）。 */}
      {book.cuts.map((cut, index) => (
        <img
          key={`back-${index}`}
          className="opening-back"
          data-part={`${index}-back`}
          src={assetUrl(cut.back)}
          alt=""
          style={{ transform: `translateX(${offsetOf(cut.from)}px)` }}
        />
      ))}
      {book.cuts.map((cut, index) => (
        <div
          key={`chara-${index}`}
          className="opening-stand"
          data-part={`${index}-chara`}
          style={{
            // 落ち着く側に貼り付ける。**入ってくる側とは逆**なので、画面を横切って見える。
            left: cut.stand === 'left' ? 0 : undefined,
            right: cut.stand === 'right' ? 0 : undefined,
            top: `calc(50% + ${CHARA_DROP}px)`,
            transform: `translateX(${offsetOf(cut.from)}px)`,
          }}
        >
          <img className="opening-chara" src={assetUrl(cut.chara)} alt="" />
        </div>
      ))}
      {hint ? <p className="opening-hint">{skippable ? 'おしてとばす' : 'おすと音が出ます'}</p> : null}
    </div>
  );
}
