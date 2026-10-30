// 戦闘の共通の演出（GS-106）。**コードに直書きしていた音と間を台帳へ出した**——`public/data/battleSettings.json`。
// 台帳エディタの「戦闘共通」で編集する。台帳が読めない・値が壊れているときは、ここの既定値（直書きしていた値）を使う。

import type { ItemStrike } from '../items';
import type { HeightRates } from './height';

/**
 * 通常攻撃（素手）の見せ方（GS-123）。**味方と敵で別に持つ。**
 * 技は `skills.json` の `effect` / `se` が決めるが、素手の攻撃は技の台帳に無い。
 */
export interface NormalAttackDef {
  /** 出す絵（`effects.json` のキー）。空なら絵を出さない。 */
  effect: string;
  /** 鳴らす音（`sounds.json` のキー）。空なら絵の側の音を使う。 */
  se: string;
}

export interface BattleSettings {
  /** 戦闘の曲（`sounds.json` のキー）。 */
  bgm: string;
  /** 通常攻撃の絵と音（GS-123）。 */
  normalAttack: { party: NormalAttackDef; enemy: NormalAttackDef };
  se: {
    /** 当たった音（素手・技とも。技の音は絵の側が持つ）。 */
    hit: string;
    /** かわした音。 */
    dodge: string;
    /** 勝った音。 */
    win: string;
    /** 敵が攻めかかる音（技に `se` が無いとき）。 */
    enemyAttack: string;
    /** 持ち物を使った音（持ち物に `se` が無いとき。フィールドでも使う）。 */
    item: string;
    /** レベルが上がった音。 */
    levelUp: string;
    /** 歩いているあいだの毒のダメージ音。 */
    walkPoison: string;
  };
  /** 間（ミリ秒）。 */
  ms: {
    /** 1 行を読ませておく時間。決定キーで飛ばせる。 */
    say: number;
    /** 数が動いたのを見せる間。 */
    beat: number;
    /** 当たった印（点滅・数字）が出ている時間。`beat` より長く。 */
    hit: number;
    /** 殴られた敵の仰け反り。 */
    lean: number;
    /** 敵が攻めかかる間。 */
    enemyAct: number;
    /** 「何も持ってない！」を出しておく時間。 */
    noItem: number;
  };
  /** 位置で変わるダメージの倍率（2026-10-29 / GS-280）。台帳に書かなければ既定（後衛 0.5）。 */
  rates?: {
    /** 貫通・全体の技が、前衛に守られた後衛に当たるときの倍率（0 より大きく 1 まで）。 */
    back: number;
    /** 高台から、高台でない相手を攻めたときの倍率（1〜5。既定 1.2。2026-10-29 / GS-285）。 */
    high?: number;
    /** 高台にいる人が、高台でない相手から直接攻撃を受けたときの倍率（0 より大きく 1 まで。既定 0.8。GS-285）。 */
    highGuard?: number;
  };
}

/** 既定値。直書きしていた値と同じ（敵の攻めかかる音は重いパンチ1＝punch。GS-112 で strike にして GS-113 で戻した）。 */
export const DEFAULT_BATTLE_SETTINGS: BattleSettings = {
  bgm: 'battle',
  // 味方は素手の絵（`normal`）を出し、音は絵の側（`effects.json` の `se`）。
  // 敵は絵を出さず、攻めかかる音だけ（今までと同じ見え方。GS-123）。
  normalAttack: { party: { effect: 'normal', se: '' }, enemy: { effect: '', se: 'punch' } },
  se: { hit: 'hit', dodge: 'dodge', win: 'fanfare', enemyAttack: 'punch', item: 'levelup', levelUp: 'levelup', walkPoison: 'hit' },
  ms: { say: 900, beat: 260, hit: 520, lean: 200, enemyAct: 500, noItem: 1200 },
  rates: { back: 0.5, high: 1.2, highGuard: 0.8 },
};

let settings: BattleSettings = structuredClone(DEFAULT_BATTLE_SETTINGS);

/** 後衛の倍率（GS-280）。台帳に無ければ既定の 0.5。 */
export function backRowRate(): number {
  return settings.rates?.back ?? DEFAULT_BATTLE_SETTINGS.rates!.back;
}

/** 高さの倍率（GS-285）。台帳に無ければ既定の 1.2・0.8。 */
export function heightRates(): HeightRates {
  const base = DEFAULT_BATTLE_SETTINGS.rates!;
  return { high: settings.rates?.high ?? base.high!, highGuard: settings.rates?.highGuard ?? base.highGuard! };
}

/** いまの設定。読み終わる前は既定値。 */
export function battleSettings(): BattleSettings {
  return settings;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** 台帳の値を受ける。**知らない項目・型の違う値は捨てて既定値を使う**（1 つの書き間違いで戦闘を止めない）。 */
export function applyBattleSettings(raw: unknown): BattleSettings {
  const next = structuredClone(DEFAULT_BATTLE_SETTINGS);
  if (object(raw)) {
    if (typeof raw.bgm === 'string' && raw.bgm) next.bgm = raw.bgm;
    if (object(raw.se)) {
      for (const key of Object.keys(next.se) as Array<keyof BattleSettings['se']>) {
        const value = raw.se[key];
        if (typeof value === 'string' && value) next.se[key] = value;
      }
    }
    if (object(raw.normalAttack)) {
      for (const side of ['party', 'enemy'] as const) {
        const value = raw.normalAttack[side];
        if (!object(value)) continue;
        // 空文字も意味がある（絵を出さない／絵の音を使う）ので、文字なら受ける。
        if (typeof value.effect === 'string') next.normalAttack[side].effect = value.effect;
        if (typeof value.se === 'string') next.normalAttack[side].se = value.se;
      }
    }
    if (object(raw.ms)) {
      for (const key of Object.keys(next.ms) as Array<keyof BattleSettings['ms']>) {
        const value = raw.ms[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60000) next.ms[key] = value;
      }
    }
    if (object(raw.rates)) {
      const within = (value: unknown, low: number, high: number, open = false): value is number =>
        typeof value === 'number' && Number.isFinite(value) && (open ? value > low : value >= low) && value <= high;
      const rates = { ...next.rates! };
      if (within(raw.rates.back, 0, 1, true)) rates.back = raw.rates.back;
      if (within(raw.rates.high, 1, 5)) rates.high = raw.rates.high;
      if (within(raw.rates.highGuard, 0, 1, true)) rates.highGuard = raw.rates.highGuard;
      next.rates = rates;
    }
  }
  settings = next;
  return next;
}

/**
 * 通常攻撃の見せ方（2026-10-28 / GS-273）。味方は**武器の `equip.strike`** に書いた項目だけ素手を差し替える
 * （短剣なら切りつけの絵）。武器が無い・`strike` が無い・敵は戦闘共通の素手のまま。
 */
export function normalAttackOf(side: 'party' | 'enemy', strike?: ItemStrike | null): NormalAttackDef {
  const base = settings.normalAttack[side];
  if (side !== 'party' || !strike) return base;
  return {
    effect: typeof strike.effect === 'string' && strike.effect ? strike.effect : base.effect,
    se: typeof strike.se === 'string' && strike.se ? strike.se : base.se,
  };
}
