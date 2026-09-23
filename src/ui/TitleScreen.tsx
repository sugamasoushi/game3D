'use client';

// タイトル画面（GS-27）。**はじめから / つづきから**だけ。
//
// セーブの一覧はここで読む——タイトルに来るたびに読み直せば、
// セーブした直後に戻ってきても新しい記録が出る。
//
// オープニング（GS-126）もここが持つ。旧作も Title シーンが
// 「オープニング → 題名 → ボタン」の順に並べていた（`TitlePresenter.execute`）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { listSaves, playTimeLabel, savedAtLabel, slotLabel, type SaveSummary } from '../game/save';
import { assetUrl } from '../game/assets';
import { loadOpening, openingBackdrop, type OpeningBook } from '../game/opening';
import { showOpening } from '../game/devMode';
import { loadSoundBook, playBgm } from '../game/audio';
import { Opening } from './Opening';
import { preloadFonts, preloadImages } from '../game/preload';

/**
 * オープニングを見せたか（GS-126）。**1 回の起動で 1 度だけ。**
 * ゲームオーバーやメニューの「タイトルへ」で戻るたびに 3 秒見せられると煩わしい——
 * 見たい人は読み直せばもう一度出る。
 */
let opened = false;

export function TitleScreen({
  onStart,
  onContinue,
  onSettings,
}: {
  onStart(): void;
  onContinue(slot: number): void;
  onSettings(): void;
}) {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [book, setBook] = useState<OpeningBook | null>(null);
  /** オープニングの最中か。台帳を読み終えるまでは決まらないので `null` で待つ。 */
  const [playing, setPlaying] = useState<boolean | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void listSaves().then((list) => {
      if (alive) setSaves(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * オープニングの台帳と曲（GS-126）。**曲はオープニングを飛ばしても鳴らす**——
   * 旧作もタイトルの曲は同じ 1 本で、オープニングが終わってもそのまま続いていた。
   * （開発モードで「BGM を鳴らさない」にしているときは `playBgm` が止める）
   */
  useEffect(() => {
    let alive = true;
    // **音の台帳も待つ。** `opening.json` のほうが小さくて先に着くので、待たずに鳴らすと
    // 「台帳に無い音: opening」で黙って流れない（実際にそうなった）。
    void Promise.all([loadOpening(), loadSoundBook()]).then(async ([next]) => {
      // Web Animations が時刻を数え始める前に、画像の取得とデコードを終える。
      await Promise.all([
        preloadImages(next.cuts.flatMap((cut) => [cut.back, cut.chara])),
        preloadFonts(),
      ]).catch((error) => console.warn('[preload]', error));
      if (!alive) return;
      setBook(next);
      const show = showOpening() && !opened && next.cuts.length > 0;
      opened = true;
      setPlaying(show);
      if (next.bgm) playBgm(next.bgm);
    });
    return () => {
      alive = false;
    };
  }, []);

  const endOpening = useCallback(() => setPlaying(false), []);

  /**
   * キーとゲームパッドで選べるようにする（GS-58）。
   * **合成のキーイベントではボタンは押されない**（信用されないイベントは既定動作をしない）ので、
   * 決定は自分で `click()` する。マウスの道はそのまま。
   */
  useEffect(() => {
    // オープニングの最中は触らせない。押した分は「とばす」に使う。
    if (playing !== false) return;
    const buttons = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    // 開いた直後は先頭に合わせる。どこにも当たっていないと上下が効かない。
    buttons()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      const list = buttons();
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        list[at < 0 ? 0 : (at + delta + list.length) % list.length].focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        (at < 0 ? list[0] : list[at]).click();
        return;
      }
      // 記録を選んでいる途中なら、Esc は一覧を閉じるだけ。
      if (event.key === 'Escape' && picking) {
        event.preventDefault();
        setPicking(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, saves, playing]);

  // 読める記録だけ「つづきから」に出す。版が違うものは触らせない。
  const usable = (saves ?? []).filter((entry) => !entry.stale);
  // 最後の場面の背景がそのままタイトルの背になる（旧作と同じ）。飛ばしたときも同じ絵。
  const backdrop = book ? openingBackdrop(book) : '';

  return (
    // 背景は**オープニングが終わってから**敷く。頭から敷くと、滑り込む前の黒が無くなる。
    <div className="title" style={playing === false && backdrop ? { backgroundImage: `url(${assetUrl(backdrop)})` } : undefined}>
      {playing && book ? <Opening book={book} onDone={endOpening} /> : null}
      {/* 台帳を読んでいる間（`playing === null`）は何も出さない。題名だけ先に出ると間が抜ける。 */}
      {playing === false ? (
        <div className="title-in">
          <h1 className="title-name">{book?.title ?? 'ちょっとだけ RPG'}</h1>
          {!picking ? (
            <div className="title-menu" ref={menuRef}>
              <button type="button" onClick={onStart}>
                はじめから
              </button>
              <button type="button" disabled={usable.length === 0} onClick={() => setPicking(true)}>
                つづきから
              </button>
              <button type="button" onClick={onSettings}>
                設定
              </button>
            </div>
          ) : (
            <div className="title-menu" ref={menuRef}>
              {usable.map((entry) => (
                <button key={entry.slot} type="button" onClick={() => onContinue(entry.slot)}>
                  {`${slotLabel(entry.slot)} : ${entry.map}  ${playTimeLabel(entry.playSeconds)}  ${savedAtLabel(entry.savedAt)}`}
                </button>
              ))}
              <button type="button" onClick={() => setPicking(false)}>
                もどる
              </button>
            </div>
          )}
          {saves === null ? <p className="title-note">記録を読んでいます…</p> : null}
        </div>
      ) : null}
    </div>
  );
}
