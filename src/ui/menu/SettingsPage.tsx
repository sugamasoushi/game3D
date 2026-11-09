'use client';

// 設定の中身（GS-32）。**枠は持たない**——メニューのタブ（GS-54）と、
// タイトルから開く単独の画面（`SettingsMenu`）の**両方が同じ中身を出す**ため。
//
// 設定はセーブとは別物で、端末に覚える（`options.ts`）。枠を読み替えても好みは変わらない。

import { useEffect, useState } from 'react';
import {
  DEFAULT_OPTIONS,
  FONT_LABELS,
  VIRTUAL_PAD_LABELS,
  options,
  setOptions,
  virtualPadShown,
  type FontSetting,
  type Options,
  type VirtualPadSetting,
} from '../../game/options';
import { DRAW_MODE_LABELS, drawMode, guessDrawMode, heavyDrawsOf, heavyOn, HEAVY_DRAWS, type DrawModeSetting, type HeavyDraw } from '../../game/quality';
import { DEV_MODE, devOptions, setDevOptions, type DevOptions } from '../../game/devMode';
import { stopBgm, stopBgs } from '../../game/audio';
import { fullscreenSupported, isFullscreen, onFullscreenChange, setFullscreen } from '../../game/fullscreen';

/** 文字送りの目盛り。**小さいほど速い**ので、見せ方は左が速い。 */
const CHAR_MIN = 10;
const CHAR_MAX = 100;

/** `extra` は「既定に戻す」と同じ行に並べる物（タイトルから開いたときの「とじる」）。 */
export function SettingsPage({ extra }: { extra?: React.ReactNode }) {
  // 設定は React の外（`options`）に居るので、画面用に写しを持つ。
  const [now, setNow] = useState<Options>({ ...options });
  // 開発中のつまみ（GS-126）。**本番では下の欄ごと出さない。**
  const [dev, setDev] = useState<DevOptions>({ ...devOptions });

  // フルスクリーン。**設定ではなく今の状態**を映す（Esc や F11 で抜けても印が合うように）。
  // 切り替えられない端末（iPhone の Safari など）では行ごと出さない。
  const [canFull] = useState(fullscreenSupported);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!canFull) return;
    let alive = true;
    void isFullscreen().then((on) => alive && setFull(on));
    const stop = onFullscreenChange((on) => setFull(on));
    return () => {
      alive = false;
      stop();
    };
  }, [canFull]);

  const change = (next: Partial<Options>) => {
    setOptions(next);
    setNow({ ...options });
  };

  const changeDev = (next: Partial<DevOptions>) => {
    setDevOptions(next);
    setDev({ ...devOptions });
    // 「鳴らさない」に倒した瞬間に黙らせる。次の曲まで鳴り続けると、切れたのか分からない。
    // 効果音は鳴らしっぱなしにならない（1 回ずつ鳴る物）ので、止める先は BGM と環境音だけ。
    if (next.muteBgm) {
      stopBgm(200);
      stopBgs(200);
    }
  };

  /** 開発中のつまみ 1 本。 */
  const devSwitch = (label: string, key: keyof DevOptions, note: string) => (
    <li key={key}>
      {/* つまみの名が長いので、音量の行より広く取る。折り返すと 3 行になって読みにくい。 */}
      <span className="menu-label menu-label-wide">{label}</span>
      <input
        className="menu-check"
        type="checkbox"
        checked={dev[key]}
        data-pick
        onChange={(event) => changeDev({ [key]: event.currentTarget.checked })}
      />
      <span className="menu-hint">{note}</span>
    </li>
  );

  /** 描画ごとのチェック（2026-11-04）。表（`HEAVY_DRAWS`）に足せば行も増える。 */
  const heavyKinds = Object.keys(HEAVY_DRAWS) as HeavyDraw[];
  /** 低負荷で減らす物の数。説明に出す。 */
  const lightCuts = heavyKinds.filter((kind) => !HEAVY_DRAWS[kind].light).length;

  /** 描画モードを変える。**初めてカスタムにしたときは、そのとき描いていた形から始める。** */
  const changeDrawMode = (next: DrawModeSetting) => {
    if (next === 'custom' && Object.keys(now.heavyDraws ?? {}).length === 0) {
      const base = drawMode();
      change({ drawMode: next, heavyDraws: heavyDrawsOf(base === 'light' ? 'light' : 'high') });
      return;
    }
    change({ drawMode: next });
  };

  /** 音量 1 本。値は 0〜1、見せるのは %。 */
  const volume = (label: string, key: 'masterVolume' | 'bgmVolume' | 'seVolume') => (
    <li key={key}>
      <span className="menu-label">{label}</span>
      <input
        className="menu-range"
        type="range"
        min={0}
        max={100}
        value={Math.round(now[key] * 100)}
        data-pick
        onChange={(event) => change({ [key]: Number(event.currentTarget.value) / 100 } as Partial<Options>)}
      />
      <span className="menu-value">{Math.round(now[key] * 100)}%</span>
    </li>
  );

  return (
    <>
      <ul className="menu-slots">
        <li>
          <span className="menu-label">文字送り</span>
          {/* 目盛りは左が速い。中の値（ミリ秒）は**大きいほど遅い**ので裏返す。 */}
          <input
            className="menu-range"
            type="range"
            min={CHAR_MIN}
            max={CHAR_MAX}
            step={5}
            value={CHAR_MIN + CHAR_MAX - now.charMs}
            data-pick
            onChange={(event) => change({ charMs: CHAR_MIN + CHAR_MAX - Number(event.currentTarget.value) })}
          />
          <span className="menu-value">{now.charMs}ms</span>
        </li>
        <li>
          {/*
            描画モード（GS-173）。旧作と同じ「ＰＣ（高負荷）／ＳＰ（低負荷）」に、
            端末から見当を付ける「自動」を足した。**変えたその場で効く**（マップは読み直さない）。
          */}
          <span className="menu-label">描画モード</span>
          <select
            className="menu-pick"
            value={now.drawMode}
            data-pick
            onChange={(event) => changeDrawMode(event.currentTarget.value as DrawModeSetting)}
          >
            {(['auto', 'high', 'light', 'custom'] as DrawModeSetting[]).map((key) => (
              <option key={key} value={key}>
                {DRAW_MODE_LABELS[key]}
              </option>
            ))}
          </select>
          {/* **いまどちらで描いているか**を必ず出す。「自動」だけだと、重いのか軽いのか分からない。 */}
          <span className="menu-hint">
            {now.drawMode === 'auto'
              ? `いまは ${DRAW_MODE_LABELS[guessDrawMode()]}`
              : now.drawMode === 'custom'
                ? `${heavyKinds.filter((kind) => heavyOn(kind)).length} / ${heavyKinds.length} 個を出します（下で選ぶ）`
                : drawMode() === 'light'
                  ? `重い描画 ${lightCuts} 個を減らします`
                  : '全部出します'}
          </span>
        </li>
        <li>
          {/* 仮想パッド（GS-214）。「自動」はスマホなら出す。描画モードと同じく**いまどちらか**を必ず出す。 */}
          <span className="menu-label">仮想パッド</span>
          <select
            className="menu-pick"
            value={now.virtualPad}
            data-pick
            onChange={(event) => change({ virtualPad: event.currentTarget.value as VirtualPadSetting })}
          >
            {(['auto', 'on', 'off'] as VirtualPadSetting[]).map((key) => (
              <option key={key} value={key}>
                {VIRTUAL_PAD_LABELS[key]}
              </option>
            ))}
          </select>
          <span className="menu-hint">
            {now.virtualPad === 'auto' ? `いまは ${virtualPadShown('auto') ? '表示' : '非表示'}` : ''}
          </span>
        </li>
        <li>
          {/* 文字の形。変えたその場で画面の文字すべてが替わる。 */}
          <span className="menu-label">文字</span>
          <select
            className="menu-pick"
            value={now.font}
            data-pick
            onChange={(event) => change({ font: event.currentTarget.value as FontSetting })}
          >
            {(['mplus', 'pixel'] as FontSetting[]).map((key) => (
              <option key={key} value={key}>
                {FONT_LABELS[key]}
              </option>
            ))}
          </select>
          <span className="menu-hint" />
        </li>
        {canFull ? (
          <li>
            <span className="menu-label">全画面</span>
            <input
              className="menu-check"
              type="checkbox"
              checked={full}
              data-pick
              onChange={(event) => {
                const on = event.currentTarget.checked;
                void setFullscreen(on).then((now) => setFull(now));
              }}
            />
          </li>
        ) : null}
        {volume('全体', 'masterVolume')}
        {volume('BGM', 'bgmVolume')}
        {volume('効果音', 'seVolume')}
      </ul>
      {/* カスタムのときだけ、描画ごとのチェック（2026-11-04）。変えたその場で効く。 */}
      {now.drawMode === 'custom' ? (
        <>
          <h3 className="menu-sub">描画（カスタム）</h3>
          <ul className="menu-slots">
            {heavyKinds.map((kind) => (
              <li key={kind}>
                <span className="menu-label menu-label-wide">{HEAVY_DRAWS[kind].label}</span>
                <input
                  className="menu-check"
                  type="checkbox"
                  checked={now.heavyDraws?.[kind] ?? true}
                  data-pick
                  onChange={(event) => change({ heavyDraws: { ...now.heavyDraws, [kind]: event.currentTarget.checked } })}
                />
                <span className="menu-hint">{HEAVY_DRAWS[kind].note}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {/* 開発モードのときだけ（GS-126）。書き出した物には最初から出ない。 */}
      {DEV_MODE ? (
        <>
          <h3 className="menu-sub">開発用</h3>
          <ul className="menu-slots">
            {devSwitch('オープニングを飛ばす', 'skipOpening', '読み直すたびに待たない')}
            {devSwitch('BGM を鳴らさない', 'muteBgm', '環境音（滝など）も止まる')}
            {devSwitch('効果音を鳴らさない', 'muteSe', '文字送り・決定・技の音')}
          </ul>
        </>
      ) : null}
      <div className="menu-actions settings-actions">
        <button type="button" data-pick onClick={() => change({ ...DEFAULT_OPTIONS })}>
          既定に戻す
        </button>
        {extra}
      </div>
    </>
  );
}
