// 音（GS-21）。**BGM・環境音・効果音**の 3 系統。
//
// どの音をどの名前で呼ぶかは `public/data/sounds.json` が持つ。
// 音を増やすのに TS を触らなくてよくする——ファイルを `public/assets/sound/` へ置いて
// 台帳に 1 行足せば、イベントの `playBgm` / `playSe` から呼べる（GS-21）。
//
// BGM・環境音は `HTMLAudioElement` で流し、短い効果音は Web Audio へ事前デコードする。
// モバイルで効果音を鳴らすたびに MP3 の読み込み・デコードを待たないため。
// **ループ点（`loopStart` / `loopEnd`）を書いた曲だけ**は Web Audio で丸ごと読んで鳴らす（GS-317）。
// `HTMLAudioElement` の繰り返しは折り返しで途切れ、途中の点へは戻れないため。

import { assetUrl } from './assets';
import { bgmAllowed, seAllowed } from './devMode';
import { onOptionsChanged, options } from './options';
import { ambienceGain, readAmbience, strikeDue, strikeOverlap, type AmbienceDef, type EffectLevel } from './ambience';
import { hasLoopPoints, loopPosition, loopWindow, type LoopWindow } from './loopPoints';

/** 台帳の 1 行。 */
export interface SoundDef {
  /** `public/assets/sound/` からの道（フォルダの中なら `bgm/field.mp3`。GS-259）。日本語のままでよい。 */
  file: string;
  /** 台帳が決める既定の音量（0〜1）。イベント側で上書きできる。 */
  volume?: number;
  /** 繰り返すか。BGM と環境音は true。 */
  loop?: boolean;
  /**
   * ループの戻り先（GS-317）。**48kHz のサンプル数**。0 秒から鳴らし、`loopEnd` に来たらここへ戻る。
   * 冒頭のある曲のための値で、`loopEnd` と組で書く。決まりは `loopPoints.ts`。
   */
  loopStart?: number;
  /** ループの終わり（GS-317）。48kHz のサンプル数。ここから後ろ（尻尾）は鳴らない。 */
  loopEnd?: number;
}

export interface SoundFile {
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
let effectContext: AudioContext | null = null;
const effectBuffers = new Map<string, AudioBuffer>();
let effectsPending: Promise<void> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**。 */
export function loadSoundBook(): Promise<void> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/sounds.json'))
    .then((response) => (response.ok ? (response.json() as Promise<SoundFile>) : null))
    .then((file) => {
      book = file?.sounds ?? {};
      ui = file?.ui ?? {};
      void preloadSoundEffects();
    })
    .catch((error) => {
      console.warn('[sound] 台帳を読めなかった', error);
    });
  return pending;
}

// 音はフォルダに分けてよい（GS-259。`bgm/field.mp3`）。`/` は残して 1 段ずつ符号化する。
export const urlOf = (file: string): string => assetUrl(`${SOUND_DIR}/${file.split('/').map(encodeURIComponent).join('/')}`);

function audioContext(): AudioContext | null {
  if (effectContext || typeof window === 'undefined' || !window.AudioContext) return effectContext;
  effectContext = new AudioContext({ latencyHint: 'interactive' });
  return effectContext;
}

/** ループしない短い音だけを先に取得・デコードする。BGM類はストリーミングのまま。 */
function preloadSoundEffects(): Promise<void> {
  if (effectsPending) return effectsPending;
  const context = audioContext();
  if (!context) return Promise.resolve();
  effectsPending = Promise.all(
    Object.entries(book).filter(([, def]) => !def.loop).map(async ([key, def]) => {
      const response = await fetch(urlOf(def.file));
      if (!response.ok) throw new Error(`効果音を読めません: ${key}`);
      effectBuffers.set(key, await context.decodeAudioData(await response.arrayBuffer()));
    }),
  ).then(() => undefined).catch((error) => {
    effectsPending = null;
    console.warn('[sound] 効果音の事前読み込みに失敗', error);
  });
  return effectsPending;
}

/** 音量は設定（`options.ts`）が持つ（GS-25）。ここでは掛けるだけ。 */
const volumeOf = (kind: 'bgm' | 'se'): number =>
  (kind === 'bgm' ? options.bgmVolume : options.seVolume) * options.masterVolume;

/**
 * **ブラウザは操作があるまで音を出さない。** 最初のキー・クリックまで待って、
 * そのとき鳴らすはずだったものを鳴らす。これを忘れると「無音だが誰も気づかない」になる。
 */
let unlocked = false;

/**
 * 流しっぱなしの音を鳴らす器（GS-317）。ふつうの曲は `HTMLAudioElement`、ループ点のある曲は Web Audio。
 * 呼ぶ側（チャンネル）はどちらかを気にしない。
 */
interface Player {
  /** 音量（0〜1。設定と台帳を掛けた後）。 */
  setLevel(level: number): void;
  /** 鳴らす。読み込み中なら、済んだら鳴らす。 */
  play(): void;
  /** 止める。`ms` を渡すと薄れて消える。止めた器は使い回さない。 */
  stop(ms: number): void;
  playing(): boolean;
  /** 開発中の確認用。ループ点で回しているなら区間と今の位置（秒）。 */
  loop(): { start: number; end: number; position: number } | null;
}

/** ふつうの曲（ファイル全体を繰り返す）。 */
function elementPlayer(def: SoundDef, level: number): Player {
  const el = new Audio(urlOf(def.file));
  el.loop = def.loop ?? true;
  el.volume = level;
  let timer: number | null = null;
  return {
    setLevel(next) {
      if (timer === null) el.volume = next;
    },
    play() {
      void el.play().catch(() => undefined);
    },
    stop(ms) {
      if (timer !== null) return;
      if (ms <= 0) {
        el.pause();
        return;
      }
      const from = el.volume;
      const steps = Math.max(1, Math.round(ms / FADE_STEP));
      let at = 0;
      timer = window.setInterval(() => {
        at += 1;
        el.volume = Math.max(0, from * (1 - at / steps));
        if (at >= steps) {
          if (timer !== null) window.clearInterval(timer);
          el.pause();
        }
      }, FADE_STEP);
    },
    playing: () => !el.paused,
    loop: () => null,
  };
}

/**
 * ループ点の曲の読み込み（GS-317）。丸ごとデコードするので 1 曲 30MB ほど使う。
 * **新しい 2 曲だけ覚えておく**（フィールドの曲と戦闘の曲を行き来しても、読み直しで待たせない）。
 */
const loopBuffers = new Map<string, Promise<AudioBuffer>>();
const KEEP_LOOP_BUFFERS = 2;

function loopBuffer(context: AudioContext, key: string, def: SoundDef): Promise<AudioBuffer> {
  const id = `${key}\n${def.file}`;
  const known = loopBuffers.get(id);
  if (known) {
    loopBuffers.delete(id);
    loopBuffers.set(id, known);
    return known;
  }
  const loading = fetch(urlOf(def.file))
    .then((response) => {
      if (!response.ok) throw new Error(`曲を読めません: ${key}（${def.file}）`);
      return response.arrayBuffer();
    })
    .then((data) => context.decodeAudioData(data));
  loading.catch(() => loopBuffers.delete(id));
  loopBuffers.set(id, loading);
  while (loopBuffers.size > KEEP_LOOP_BUFFERS) {
    const oldest = loopBuffers.keys().next().value;
    if (oldest === undefined) break;
    loopBuffers.delete(oldest);
  }
  return loading;
}

/**
 * ループ点のある曲（GS-317）。0 秒から鳴らし、`loopEnd` で `loopStart` へ戻る（Web Audio がサンプル単位で戻す）。
 * 読めない・デコードできない（その端末が形式に対応していない）時は、ふつうの曲として鳴らす。
 * ループ点が曲より後ろなら、知らせてファイル全体を繰り返す。
 */
function bufferPlayer(context: AudioContext, key: string, def: SoundDef, level: number): Player {
  const volume = context.createGain();
  volume.gain.value = level;
  volume.connect(context.destination);
  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let window_: LoopWindow | null = null;
  let startedAt = 0;
  let wanted = false;
  let stopped = false;
  let fallback: Player | null = null;
  const begin = () => {
    if (!buffer || !wanted || stopped || source) return;
    window_ = loopWindow(def, buffer.duration);
    if (!window_) console.warn(`[sound] ループ点が曲の長さを越えています。全体を繰り返します: ${key}`);
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    if (window_) {
      source.loopStart = window_.start;
      source.loopEnd = window_.end;
    }
    source.connect(volume);
    if (context.state === 'suspended') void context.resume();
    startedAt = context.currentTime;
    source.start();
  };
  loopBuffer(context, key, def).then(
    (ready) => {
      buffer = ready;
      begin();
    },
    (error: unknown) => {
      console.warn(`[sound] ループ点の曲を読めないので、ふつうに繰り返します: ${key}`, error);
      volume.disconnect();
      if (stopped) return;
      fallback = elementPlayer(def, volume.gain.value);
      if (wanted) fallback.play();
    },
  );
  return {
    setLevel(next) {
      if (stopped) return;
      if (fallback) fallback.setLevel(next);
      volume.gain.cancelScheduledValues(context.currentTime);
      volume.gain.value = next;
    },
    play() {
      wanted = true;
      if (fallback) fallback.play();
      else begin();
    },
    stop(ms) {
      if (stopped) return;
      stopped = true;
      if (fallback) {
        fallback.stop(ms);
        return;
      }
      const now = context.currentTime;
      const end = now + Math.max(0, ms) / 1000;
      volume.gain.cancelScheduledValues(now);
      volume.gain.setValueAtTime(volume.gain.value, now);
      if (ms > 0) volume.gain.linearRampToValueAtTime(0, end);
      try {
        source?.stop(ms > 0 ? end + 0.02 : now);
      } catch {
        /* もう止まっている */
      }
      window.setTimeout(() => volume.disconnect(), Math.max(0, ms) + 100);
    },
    playing: () => (fallback ? fallback.playing() : source !== null && !stopped && context.state === 'running'),
    loop() {
      if (!source || !buffer || !window_) return null;
      return { ...window_, position: loopPosition(context.currentTime - startedAt, window_, buffer.duration) };
    },
  };
}

/** 曲に合った器を作る。ループ点のある曲は Web Audio（使えない環境ならふつうの器）。 */
function playerOf(key: string, def: SoundDef, level: number): Player {
  const context = hasLoopPoints(def) ? audioContext() : null;
  return context ? bufferPlayer(context, key, def, level) : elementPlayer(def, level);
}

/** 流しっぱなしの 1 本（BGM か環境音）。 */
interface Channel {
  player: Player | null;
  key: string;
  /** 台帳の音量に掛ける倍率（イベントが指定したぶん）。 */
  gain: number;
}

const bgm: Channel = { player: null, key: '', gain: 1 };
/**
 * 環境音（GS-278）。**何本でも同時に流す**。キーは音の名前（同じ音を 2 行に書かない。検査で止める）。
 * `ambienceRows` はいまのマップの台帳の行。`strikes` は雷の行ごとの前に見た光の回数。
 */
const bgsChannels = new Map<string, Channel>();
let ambienceRows: AmbienceDef[] = [];
let strikes = new Map<number, number | undefined>();
const channels = (): Channel[] => [bgm, ...bgsChannels.values()];

const levelOf = (def: SoundDef, gain: number, kind: 'bgm' | 'se'): number =>
  Math.max(0, Math.min(1, (def.volume ?? 1) * gain * volumeOf(kind)));

/** 流し始める。同じ音が既に鳴っていれば何もしない（マップを移っても切れない）。 */
function start(channel: Channel, key: string, gain: number): void {
  const def = book[key];
  if (!def) {
    console.warn(`[sound] 台帳に無い音: ${key}`);
    return;
  }
  if (channel.key === key && channel.player) {
    channel.gain = gain;
    channel.player.setLevel(levelOf(def, gain, 'bgm'));
    return;
  }
  stop(channel, 0);
  const player = playerOf(key, def, levelOf(def, gain, 'bgm'));
  channel.player = player;
  channel.key = key;
  channel.gain = gain;
  if (unlocked) player.play();
}

/** 止める。`ms` を渡すと薄れて消える。 */
function stop(channel: Channel, ms: number): void {
  const player = channel.player;
  channel.player = null;
  channel.key = '';
  player?.stop(ms);
}

// 設定で音量が変わったら、**いま鳴っているもの**にもすぐ効かせる（GS-25）。
// 次の曲から、では設定画面で動かしても手応えが無い。
onOptionsChanged(() => {
  for (const channel of channels()) {
    const def = channel.key ? book[channel.key] : null;
    if (channel.player && def) channel.player.setLevel(levelOf(def, channel.gain, 'bgm'));
  }
});

/** 最初の操作で呼ぶ。止まっていた BGM をここから鳴らす。 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const context = audioContext();
  if (context?.state === 'suspended') void context.resume();
  for (const channel of channels()) channel.player?.play();
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

/**
 * 環境音を差し替える（GS-278。マップの台帳の `bgs` の行）。流す行（`strike` でない行）を 1 本ずつ流し、
 * 行から消えた音は薄れて止まる。**同じ音は切らずに続ける**（マップを移っても滝の音が途切れない）。
 * エフェクトに合わせる行は、次の `updateAmbience` までは今の音量のまま（新しく始める物は 0 から）。
 */
export function setAmbience(rows: readonly AmbienceDef[], ms = 400): void {
  ambienceRows = [...rows];
  strikes = new Map();
  // 前のマップの雷は薄れさせて消す（行の番号が別の行を指すことになるため。GS-279）。
  for (const list of strikeVoices.values()) for (const voice of list) fadeVoice(voice, ms);
  strikeVoices.clear();
  // 環境音は BGM と同じつまみで止める（GS-129）。音量の設定も両者を 1 つとして扱っている。
  const allowed = bgmAllowed();
  const wanted = new Map<string, number>();
  if (allowed) {
    for (const row of ambienceRows) {
      if (row.on === 'strike' || wanted.has(row.key)) continue;
      wanted.set(row.key, row.effect ? (bgsChannels.get(row.key)?.gain ?? 0) : ambienceGain(row, new Map()));
    }
  }
  for (const [key, channel] of bgsChannels) {
    if (wanted.has(key)) continue;
    stop(channel, ms);
    bgsChannels.delete(key);
  }
  for (const [key, gain] of wanted) {
    let channel = bgsChannels.get(key);
    if (!channel) {
      channel = { player: null, key: '', gain };
      bgsChannels.set(key, channel);
    }
    start(channel, key, gain);
    if (!channel.player) bgsChannels.delete(key);
  }
}

/**
 * 毎フレーム（GS-278）。エフェクトの今の濃さ（プリセット id → 濃さと雷の回数）で、合わせる行の音量を動かし、
 * 雷が光ったら鳴らす。マップの音が止まっている（戦闘中・タイトルへ）あいだは行が空なので何もしない。
 */
export function updateAmbience(levels: ReadonlyMap<string, EffectLevel>): void {
  // 「BGM を鳴らさない」（GS-129）は環境音も黙らせる。雷も環境音の行なので一緒に止める。
  if (!bgmAllowed()) return;
  ambienceRows.forEach((row, index) => {
    if (row.on === 'strike') {
      const due = strikeDue(row, levels, strikes.get(index));
      strikes.set(index, due.seen);
      if (!due.play) return;
      const key = row.key;
      const gain = due.gain;
      const limit = strikeOverlap(row);
      if (row.delay && row.delay > 0) window.setTimeout(() => playStrike(index, key, gain, limit), row.delay);
      else playStrike(index, key, gain, limit);
      return;
    }
    if (!row.effect) return;
    const channel = bgsChannels.get(row.key);
    const def = book[row.key];
    if (!channel?.player || !def) return;
    const gain = ambienceGain(row, levels);
    if (Math.abs(gain - channel.gain) < 0.001) return;
    channel.gain = gain;
    channel.player.setLevel(levelOf(def, gain, 'bgm'));
  });
}

/** 環境音を全部止める。`ms` を渡すと薄れて消える。行も空にする（戻すときは `applyMapSound` で台帳から）。 */
export function stopBgs(ms = 0): void {
  ambienceRows = [];
  strikes = new Map();
  for (const channel of bgsChannels.values()) stop(channel, ms);
  bgsChannels.clear();
  for (const list of strikeVoices.values()) for (const voice of list) fadeVoice(voice, ms);
  strikeVoices.clear();
}

/** 雷の行ごとの鳴っている音（GS-279）。古い順。 */
interface StrikeVoice {
  source: AudioBufferSourceNode;
  volume: GainNode;
}
const strikeVoices = new Map<number, StrikeVoice[]>();
/** 上限を超えて消す古い雷の音が薄れる時間（ミリ秒）。ぷつっと切れないように。 */
const STRIKE_FADE_MS = 300;

function fadeVoice(voice: StrikeVoice, ms: number): void {
  const context = voice.source.context;
  const now = context.currentTime;
  const end = now + Math.max(0, ms) / 1000;
  try {
    voice.volume.gain.cancelScheduledValues(now);
    voice.volume.gain.setValueAtTime(voice.volume.gain.value, now);
    voice.volume.gain.linearRampToValueAtTime(0, end);
    voice.source.stop(end + 0.02);
  } catch {
    /* もう止まっている */
  }
}

/**
 * 雷を 1 回鳴らす（GS-279）。行ごとに鳴っている数を数え、`limit` を超えたら一番古い音を薄れさせて消す。
 * 事前のデコードが済んでいなければ、ふつうの効果音として鳴らす（数えない）。
 */
function playStrike(row: number, key: string, gain: number, limit: number): void {
  const def = book[key];
  const context = audioContext();
  const buffer = effectBuffers.get(key);
  if (!def || !context || !buffer || !unlocked || !seAllowed()) {
    playSe(key, gain);
    return;
  }
  if (context.state === 'suspended') void context.resume();
  const list = strikeVoices.get(row) ?? [];
  while (list.length >= limit) {
    const old = list.shift();
    if (old) fadeVoice(old, STRIKE_FADE_MS);
  }
  const source = context.createBufferSource();
  const volume = context.createGain();
  source.buffer = buffer;
  volume.gain.value = levelOf(def, gain, 'se');
  source.connect(volume).connect(context.destination);
  const voice: StrikeVoice = { source, volume };
  source.onended = () => {
    const at = list.indexOf(voice);
    if (at >= 0) list.splice(at, 1);
  };
  list.push(voice);
  strikeVoices.set(row, list);
  source.start();
}

/**
 * もう音を出せるか（GS-128）。**ブラウザは操作があるまで音を出さない**ので、
 * 「最初の 1 回の操作」を音のために使いたい画面がこれを見る。
 */
export function audioUnlocked(): boolean {
  return unlocked;
}

/**
 * いま鳴っているもの（開発中の確認用）。`loop` はループ点で回している曲の区間と今の位置（秒。GS-317）。
 * ふつうに繰り返している曲では null。
 */
export function nowPlaying(): {
  bgm: string;
  bgs: string[];
  playing: boolean;
  unlocked: boolean;
  loop: { start: number; end: number; position: number } | null;
} {
  return {
    bgm: bgm.key,
    bgs: [...bgsChannels.keys()],
    playing: Boolean(bgm.player?.playing()),
    unlocked,
    loop: bgm.player?.loop() ?? null,
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
  const context = audioContext();
  const buffer = effectBuffers.get(key);
  if (context && buffer) {
    // iOS は別アプリから戻ったあと context を再び止めることがある。
    if (context.state === 'suspended') void context.resume();
    const source = context.createBufferSource();
    const volume = context.createGain();
    source.buffer = buffer;
    source.loop = def.loop ?? false;
    volume.gain.value = levelOf(def, gain, 'se');
    source.connect(volume).connect(context.destination);
    source.start();
    return;
  }
  // 初回のデコードがまだ終わっていない場合だけ、従来の器で鳴らす。
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

/** マップが決める音（GS-21）。曲と環境音をまとめて切り替える。環境音は行の並び（GS-278）。 */
export function applyMapSound(next: { bgm?: string; bgs?: readonly AmbienceDef[] }): void {
  if (next.bgm) playBgm(next.bgm);
  else stopBgm(400);
  setAmbience(readAmbience(next.bgs));
}
