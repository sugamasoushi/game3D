// 音（GS-21）。**BGM・環境音・効果音**の 3 系統。
//
// どの音をどの名前で呼ぶかは `public/data/sounds.json` が持つ。
// 音を増やすのに TS を触らなくてよくする——ファイルを `public/assets/sound/` へ置いて
// 台帳に 1 行足せば、イベントの `playBgm` / `playSe` から呼べる（GS-21）。
//
// 鳴らす仕掛けは `HTMLAudioElement` 1 枚ずつ。WebAudio で組むと音量やループの
// 細かい制御はできるが、**mp3 を流すだけ**ならこれで足りるし、読み込みも要らない。

import { assetUrl } from './assets';
import { bgmAllowed, seAllowed } from './devMode';
import { onOptionsChanged, options } from './options';

/** 台帳の 1 行。 */
interface SoundDef {
  /** `public/assets/sound/` の中のファイル名。日本語のままでよい。 */
  file: string;
  /** 台帳が決める既定の音量（0〜1）。イベント側で上書きできる。 */
  volume?: number;
  /** 繰り返すか。BGM と環境音は true。 */
  loop?: boolean;
}

interface SoundFile {
  sounds: Record<string, SoundDef>;
  /** 画面が自分で鳴らす音（GS-21）。**どれを使うかも台帳で決める**。 */
  ui?: Partial<Record<UiSound, string>>;
}

/** 画面が鳴らす音の種類。 */
export type UiSound = 'message' | 'decide' | 'cancel';

/** 音の置き場所。 */
const SOUND_DIR = 'assets/sound';
/** 消えるまでの刻み（ミリ秒）。細かすぎても粗すぎても気になる。 */
const FADE_STEP = 40;

let book: Record<string, SoundDef> = {};
let ui: Partial<Record<UiSound, string>> = {};
let pending: Promise<void> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**。 */
export function loadSoundBook(): Promise<void> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/sounds.json'))
    .then((response) => (response.ok ? (response.json() as Promise<SoundFile>) : null))
    .then((file) => {
      book = file?.sounds ?? {};
      ui = file?.ui ?? {};
    })
    .catch((error) => {
      console.warn('[sound] 台帳を読めなかった', error);
    });
  return pending;
}

const urlOf = (file: string): string => assetUrl(`${SOUND_DIR}/${encodeURIComponent(file)}`);

/** 音量は設定（`options.ts`）が持つ（GS-25）。ここでは掛けるだけ。 */
const volumeOf = (kind: 'bgm' | 'se'): number =>
  (kind === 'bgm' ? options.bgmVolume : options.seVolume) * options.masterVolume;

/**
 * **ブラウザは操作があるまで音を出さない。** 最初のキー・クリックまで待って、
 * そのとき鳴らすはずだったものを鳴らす。これを忘れると「無音だが誰も気づかない」になる。
 */
let unlocked = false;

/** 流しっぱなしの 1 本（BGM か環境音）。 */
interface Channel {
  el: HTMLAudioElement | null;
  key: string;
  /** 台帳の音量に掛ける倍率（イベントが指定したぶん）。 */
  gain: number;
  fade: number | null;
}

const bgm: Channel = { el: null, key: '', gain: 1, fade: null };
const bgs: Channel = { el: null, key: '', gain: 1, fade: null };

const levelOf = (def: SoundDef, gain: number, kind: 'bgm' | 'se'): number =>
  Math.max(0, Math.min(1, (def.volume ?? 1) * gain * volumeOf(kind)));

/** 流し始める。同じ音が既に鳴っていれば何もしない（マップを移っても切れない）。 */
function start(channel: Channel, key: string, gain: number): void {
  const def = book[key];
  if (!def) {
    console.warn(`[sound] 台帳に無い音: ${key}`);
    return;
  }
  if (channel.key === key && channel.el) {
    channel.gain = gain;
    channel.el.volume = levelOf(def, gain, 'bgm');
    return;
  }
  stop(channel, 0);
  const el = new Audio(urlOf(def.file));
  el.loop = def.loop ?? true;
  el.volume = levelOf(def, gain, 'bgm');
  channel.el = el;
  channel.key = key;
  channel.gain = gain;
  if (unlocked) void el.play().catch(() => undefined);
}

/** 止める。`ms` を渡すと薄れて消える。 */
function stop(channel: Channel, ms: number): void {
  const el = channel.el;
  if (channel.fade !== null) {
    window.clearInterval(channel.fade);
    channel.fade = null;
  }
  channel.el = null;
  channel.key = '';
  if (!el) return;
  if (ms <= 0) {
    el.pause();
    return;
  }
  const from = el.volume;
  const steps = Math.max(1, Math.round(ms / FADE_STEP));
  let at = 0;
  const timer = window.setInterval(() => {
    at += 1;
    el.volume = Math.max(0, from * (1 - at / steps));
    if (at >= steps) {
      window.clearInterval(timer);
      el.pause();
    }
  }, FADE_STEP);
}

// 設定で音量が変わったら、**いま鳴っているもの**にもすぐ効かせる（GS-25）。
// 次の曲から、では設定画面で動かしても手応えが無い。
onOptionsChanged(() => {
  for (const channel of [bgm, bgs]) {
    const def = channel.key ? book[channel.key] : null;
    if (channel.el && def) channel.el.volume = levelOf(def, channel.gain, 'bgm');
  }
});

/** 最初の操作で呼ぶ。止まっていた BGM をここから鳴らす。 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  for (const channel of [bgm, bgs]) {
    if (channel.el) void channel.el.play().catch(() => undefined);
  }
}

export function playBgm(key: string, gain = 1): void {
  // 開発モードで「BGM を鳴らさない」にしているときは**何も鳴らさない**（GS-126）。
  // 呼ぶ側（マップの音・戦闘・タイトル）に条件を撒かないよう、入口のここ 1 か所で止める。
  if (!bgmAllowed()) {
    stop(bgm, 0);
    return;
  }
  start(bgm, key, gain);
}

export function stopBgm(ms = 0): void {
  stop(bgm, ms);
}

/** 環境音（滝・洞窟など）。BGM と別に流すので、曲を変えても続く。 */
export function playBgs(key: string, gain = 1): void {
  // 環境音は BGM と同じつまみで止める（GS-129）。音量の設定も両者を 1 つとして扱っている。
  if (!bgmAllowed()) {
    stop(bgs, 0);
    return;
  }
  start(bgs, key, gain);
}

export function stopBgs(ms = 0): void {
  stop(bgs, ms);
}

/**
 * もう音を出せるか（GS-128）。**ブラウザは操作があるまで音を出さない**ので、
 * 「最初の 1 回の操作」を音のために使いたい画面がこれを見る。
 */
export function audioUnlocked(): boolean {
  return unlocked;
}

/** いま鳴っているもの（開発中の確認用）。 */
export function nowPlaying(): { bgm: string; bgs: string; playing: boolean; unlocked: boolean } {
  return {
    bgm: bgm.key,
    bgs: bgs.key,
    playing: Boolean(bgm.el && !bgm.el.paused),
    unlocked,
  };
}

/**
 * 効果音の器（GS-24）。**音ごとに数本を使い回す。**
 *
 * 文字送りの音は 1 文字ごとに鳴らすので、1 秒に 40 回ほど呼ばれる。
 * 毎回 `new Audio()` を作ると、その数だけ器と読み込みが増えて重くなる。
 * 数本を順に回せば、重なりは保てて作り直しも起きない。
 */
const VOICES = 6;
const voices = new Map<string, { list: HTMLAudioElement[]; at: number }>();

function voiceOf(key: string, def: SoundDef): HTMLAudioElement {
  let pool = voices.get(key);
  if (!pool) {
    pool = { list: [], at: 0 };
    voices.set(key, pool);
  }
  if (pool.list.length < VOICES) {
    const born = new Audio(urlOf(def.file));
    pool.list.push(born);
    return born;
  }
  const el = pool.list[pool.at];
  pool.at = (pool.at + 1) % VOICES;
  return el;
}

/** 効果音。同じ音が重なって鳴るのが普通なので、器を数本まわして使う。 */
export function playSe(key: string, gain = 1): void {
  const def = book[key];
  if (!def) {
    console.warn(`[sound] 台帳に無い音: ${key}`);
    return;
  }
  if (!unlocked) return;
  // 開発モードで「効果音を鳴らさない」にしているとき（GS-129）。台帳に無い音の印は先に出す。
  if (!seAllowed()) return;
  const el = voiceOf(key, def);
  el.loop = def.loop ?? false;
  el.volume = levelOf(def, gain, 'se');
  // 鳴っている途中でも頭から鳴らし直す。文字送りはこれで連打になる。
  try {
    el.currentTime = 0;
  } catch {
    /* まだ読めていないときは頭のまま */
  }
  void el.play().catch(() => undefined);
}

/**
 * 画面の音（GS-21）。会話が出た・選んだ、のような**決まった場面**で鳴らす。
 * どの音かは台帳の `ui` が決めるので、差し替えにコードは触らない。
 * 台帳に載っていなければ**鳴らさない**（無音は普通のことなので印も出さない）。
 */
export function playUi(kind: UiSound): void {
  const key = ui[kind];
  if (key) playSe(key);
}

/** マップが決める音（GS-21）。曲と環境音をまとめて切り替える。 */
export function applyMapSound(next: { bgm?: string; bgs?: string }): void {
  if (next.bgm) playBgm(next.bgm);
  else stopBgm(400);
  if (next.bgs) playBgs(next.bgs);
  else stopBgs(400);
}
