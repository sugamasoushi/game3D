'use client';

// タイトル画面（GS-27）。**はじめから / つづきから / 設定**、クリアしていれば**おまけ**（GS-212）、
// 右下に**マニュアル**のアイコン（GS-213）。
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
import { DEV_MODE, showOpening } from '../game/devMode';
import { loadSoundBook, playBgm } from '../game/audio';
import { Opening } from './Opening';
import { preloadFonts, preloadImages } from '../game/preload';
import { clearedHere, loadOmake, type OmakeBook, type OmakeItem } from '../game/omake';
import { OmakeViewer, PageViewer } from './Omake';

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
  /** おまけの一覧を開いているか（GS-212）。 */
  const [omakeOpen, setOmakeOpen] = useState(false);
  /** おまけで見ている物。見ている間はタイトルのキーを止める（`OmakeViewer` が受ける）。 */
  const [viewing, setViewing] = useState<OmakeItem | null>(null);
  const [omake, setOmake] = useState<OmakeBook | null>(null);
  /** マニュアルを読んでいるか（GS-213）。見ている間はおまけと同じくタイトルのキーを止める。 */
  const [reading, setReading] = useState(false);
  /** 見終わったら、開いた項目にカーソルを戻す。 */
  const viewedRef = useRef(-1);
  const [book, setBook] = useState<OpeningBook | null>(null);
  /** オープニングの最中か。台帳を読み終えるまでは決まらないので `null` で待つ。 */
  const [playing, setPlaying] = useState<boolean | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void listSaves().then((list) => {
      if (alive) setSaves(list);
    });
    void loadOmake().then((book) => {
      if (alive) setOmake(book);
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
    if (playing !== false || viewing || reading) return;
    const buttons = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    // 開いた直後は先頭に合わせる。どこにも当たっていないと上下が効かない。
    // おまけを見終わったときは、見ていた項目へ戻す。
    (buttons()[viewedRef.current] ?? buttons()[0])?.focus();
    viewedRef.current = -1;
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
      // 記録・おまけを選んでいる途中なら、Esc は一覧を閉じるだけ。
      if (event.key === 'Escape' && (picking || omakeOpen)) {
        event.preventDefault();
        setPicking(false);
        setOmakeOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, omakeOpen, viewing, reading, saves, playing, omake]);

  // 読める記録だけ「つづきから」に出す。版が違うものは触らせない。
  const usable = (saves ?? []).filter((entry) => !entry.stale);
  // おまけは**クリアしてから**（GS-212。旧作の `GameClearFlg`）。端末の覚えか、クリアを含む記録があれば出す。
  // **開発モードでは必ず出す**（旧作も開発中は消さなかった）。
  const cleared = DEV_MODE || clearedHere() || usable.some((entry) => entry.cleared);
  const omakeItems = omake?.items ?? [];
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
          {omakeOpen ? (
            <div className="title-menu" ref={menuRef}>
              {omakeItems.map((item, index) => (
                <button
                  key={`${index}-${item.label}`}
                  type="button"
                  onClick={() => {
                    viewedRef.current = index;
                    setViewing(item);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button type="button" onClick={() => setOmakeOpen(false)}>
                もどる
              </button>
            </div>
          ) : !picking ? (
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
              {cleared && omakeItems.length > 0 ? (
                <button type="button" className="title-omake" onClick={() => setOmakeOpen(true)}>
                  おまけ
                </button>
              ) : null}
              {/* マニュアル（GS-213）。旧作どおり右下で揺れるアイコン。キーでも辿れるようボタンの並びの最後に置く。 */}
              {omake?.manual ? (
                <button
                  type="button"
                  className="title-manual"
                  aria-label="マニュアル"
                  onClick={() => {
                    viewedRef.current = [...(menuRef.current?.querySelectorAll('button:not(:disabled)') ?? [])].length - 1;
                    setReading(true);
                  }}
                >
                  <img src={assetUrl(omake.manual.icon)} alt="" draggable={false} />
                </button>
              ) : null}
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
      {reading && omake?.manual ? (
        <PageViewer pages={omake.manual.pages.map((file) => assetUrl(file))} mode="slide" onDone={() => setReading(false)} />
      ) : null}
      {viewing ? <OmakeViewer item={viewing} bgm={book?.bgm ?? ''} onDone={() => setViewing(null)} /> : null}
    </div>
  );
}
