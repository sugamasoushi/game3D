// 時間帯と時計（GS-222）。**いまの時間帯**（光のプリセットの id。'' は時間帯なし＝基準）を記録に持ち、
// イベントの命令「時間帯」で切り替える。加えて**時計**が実時間（ミリ秒）で 朝 → 昼 → 夕 → 夜 → 朝… と進める。
//
// 長さ・順番・切り替えにかける時間は台帳 `data/timeSettings.json`（ゲーム全体で 1 つ）。
// 時計は歩ける間だけ進む（会話・イベント・戦闘・メニューの間は止まる。呼ぶ側が決める）。

import { assetUrl } from './assets';

export interface TimeSettings {
  /** 時計が回す順番（光のプリセットの id）。最後の次は先頭へ戻る。 */
  order: string[];
  /** それぞれの時間帯の長さ（ミリ秒）。0 か書いていない時間帯は時計では進まない（命令でだけ動く）。 */
  durations: Record<string, number>;
  /** 切り替えにかける時間（ミリ秒）。暗転せず、この間に見た目を混ぜて移る。 */
  shiftMs: number;
  /** 「はじめから」の時間帯。'' は時間帯なし（基準）。 */
  start: string;
  /**
   * 時計を使うか（ゲーム全体。GS-223）。切っているあいだは**どこでも進まない**（記録の時計の状態は残る）。
   * 入れているとき、「はじめから」は時計を動かして始める。
   */
  clock: boolean;
}

export const TIME_SETTINGS_DEFAULTS: TimeSettings = {
  order: ['morning', 'day', 'evening', 'night'],
  durations: { morning: 120000, day: 300000, evening: 120000, night: 300000 },
  shiftMs: 1500,
  start: '',
  clock: false,
};

/** 台帳の形（`timeSettings.json`）。書かない値・壊れた値は既定へ。 */
export type TimeSettingsFile = Partial<TimeSettings>;

/** 台帳の値を整える。壊れた値は既定へ戻す（読めないと時間帯が動かなくなるので止めない）。 */
export function applyTimeSettings(raw: unknown): TimeSettings {
  const file = (raw && typeof raw === 'object' ? raw : {}) as TimeSettingsFile;
  const order = Array.isArray(file.order)
    ? file.order.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    : TIME_SETTINGS_DEFAULTS.order;
  const durations: Record<string, number> = {};
  const source = file.durations && typeof file.durations === 'object' ? file.durations : TIME_SETTINGS_DEFAULTS.durations;
  for (const [id, ms] of Object.entries(source)) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) durations[id] = Math.round(ms);
  }
  return {
    order: order.length ? order : TIME_SETTINGS_DEFAULTS.order,
    durations,
    shiftMs:
      typeof file.shiftMs === 'number' && Number.isFinite(file.shiftMs) && file.shiftMs >= 0
        ? Math.round(file.shiftMs)
        : TIME_SETTINGS_DEFAULTS.shiftMs,
    start: typeof file.start === 'string' ? file.start.trim() : TIME_SETTINGS_DEFAULTS.start,
    clock: typeof file.clock === 'boolean' ? file.clock : TIME_SETTINGS_DEFAULTS.clock,
  };
}

let settings: TimeSettings = TIME_SETTINGS_DEFAULTS;
let pending: Promise<TimeSettings> | null = null;

/** 台帳を読む（1 回だけ）。読めなければ既定。 */
export function loadTimeSettings(): Promise<TimeSettings> {
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(assetUrl('data/timeSettings.json'), { cache: 'no-store' });
        settings = applyTimeSettings(response.ok ? await response.json() : null);
      } catch {
        settings = applyTimeSettings(null);
      }
      return settings;
    })();
  }
  return pending;
}

/** 読んだ台帳（読む前は既定）。 */
export function timeSettings(): TimeSettings {
  return settings;
}

/** 時計の状態（記録に残す）。 */
export interface TimeClock {
  /** 進めているか。 */
  running: boolean;
  /** いまの時間帯に入ってから経ったミリ秒。 */
  ms: number;
}

/**
 * 時計を `dtMs` だけ進める。時間帯の長さを越えたら**次の時間帯**へ（越えたぶんは持ち越す）。
 * 止まっている・順番に無い時間帯・長さの無い時間帯では進めない。返すのは切り替わった先（無ければ null）。
 */
export function advanceClock(time: string, clock: TimeClock, config: TimeSettings, dtMs: number): string | null {
  // 台帳で時計を切っていれば、どこでも進めない（GS-223）。
  if (!config.clock || !clock.running || dtMs <= 0) return null;
  const at = config.order.indexOf(time);
  const length = config.durations[time] ?? 0;
  if (at < 0 || length <= 0) return null;
  clock.ms += dtMs;
  if (clock.ms < length) return null;
  clock.ms -= length;
  // 1 回で 1 つだけ進める（長い間を置いても一気に飛ばない）。越えすぎた分は次の長さで頭打ち。
  const next = config.order[(at + 1) % config.order.length]!;
  clock.ms = Math.min(clock.ms, Math.max(0, (config.durations[next] ?? 0) - 1));
  return next;
}
