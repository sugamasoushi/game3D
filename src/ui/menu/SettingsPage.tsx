'use client';

// 設定の中身（GS-32）。**枠は持たない**——メニューのタブ（GS-54）と、
// タイトルから開く単独の画面（`SettingsMenu`）の**両方が同じ中身を出す**ため。
//
// 設定はセーブとは別物で、端末に覚える（`options.ts`）。枠を読み替えても好みは変わらない。

import { useState } from 'react';
import { DEFAULT_OPTIONS, options, setOptions, type Options } from '../../game/options';
import { DEV_MODE, devOptions, setDevOptions, type DevOptions } from '../../game/devMode';
import { stopBgm, stopBgs } from '../../game/audio';

/** 文字送りの目盛り。**小さいほど速い**ので、見せ方は左が速い。 */
const CHAR_MIN = 10;
const CHAR_MAX = 100;

/** 流れる文字の目盛り（％。GS-144）。100 が台帳どおり、大きいほどゆっくり。 */
const SCROLL_MIN = 50;
const SCROLL_MAX = 400;

/** `extra` は「既定に戻す」と同じ行に並べる物（タイトルから開いたときの「とじる」）。 */
export function SettingsPage({ extra }: { extra?: React.ReactNode }) {
  // 設定は React の外（`options`）に居るので、画面用に写しを持つ。
  const [now, setNow] = useState<Options>({ ...options });
  // 開発中のつまみ（GS-126）。**本番では下の欄ごと出さない。**
  const [dev, setDev] = useState<DevOptions>({ ...devOptions });

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
          {/* 流れる文字（オープニングやエンドロール）の速さ（GS-144）。文字送りとは別物。 */}
          <span className="menu-label">流れる文字</span>
          {/* ここは**大きいほどゆっくり**。左が速いのは文字送りと同じなので裏返さない。 */}
          <input
            className="menu-range"
            type="range"
            min={SCROLL_MIN}
            max={SCROLL_MAX}
            step={10}
            value={Math.round(now.scrollScale * 100)}
            data-pick
            onChange={(event) => change({ scrollScale: Number(event.currentTarget.value) / 100 })}
          />
          <span className="menu-value">×{now.scrollScale.toFixed(1)}</span>
        </li>
        {volume('全体', 'masterVolume')}
        {volume('BGM', 'bgmVolume')}
        {volume('効果音', 'seVolume')}
      </ul>
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
      <div className="menu-actions">
        <button type="button" data-pick onClick={() => change({ ...DEFAULT_OPTIONS })}>
          既定に戻す
        </button>
        {extra}
      </div>
    </>
  );
}
