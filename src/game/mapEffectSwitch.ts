// マップのエフェクトの出し入れ（GS-270。命令「マップのエフェクト」= `mapEffect`）。
//
// **マップエディタで作ったエフェクトのプリセットを id で指して、出す・消す。**
// フィールドエフェクト（`fieldEffects`。置いた範囲に出る雨・霧など）と画面エフェクト（`screenEffects`）の
// どちらも同じ命令で指せる。範囲と見た目はマップのまま——命令は出す／消すだけ。
//
// - 最初の形: プリセットの `on`（マップエディタの「最初から出す」）。`on: false` なら消して始める。
// - 時間帯の出し分け（`Effect.<時間帯>` / `showIn`）とは別の段。**両方が「出す」のときだけ出る**
//   （レイヤーの出し入れと時間帯の関係と同じ）。
// - 出し入れした形は**セーブに残る**。覚えは `<マップ>/~<プリセット id>/出す`（`state.self` に同居。
//   レイヤーの `#<Id>`・物の `@<Id>` とは頭の字で分ける）。
// - 切り替えは `ms` かけて濃さを混ぜる。
// - 出し分けの単位はプリセット。同じプリセットを 2 か所に置けば 2 か所ともまとめて動く。

import type { MapDef } from '../mep3d/types';
import { selfKey } from './state';

/** 出し入れの覚えの名前（レイヤーと同じ）。 */
export const MAP_EFFECT_SHOWN = '出す';

/** 出し入れの覚えのキー。 */
export function mapEffectKey(map: string, id: string): string {
  return selfKey(map, `~${id}`, MAP_EFFECT_SHOWN);
}

/** 命令で指せるエフェクト 1 つ。 */
export interface MapEffectEntry {
  id: string;
  name: string;
  /** `field`（置いた範囲に出る）か `screen`（画面全体）。 */
  place: 'field' | 'screen';
  kind: string;
  /** 最初から出すか（プリセットの `on`。書いていなければ出す）。 */
  startOn: boolean;
}

/** そのマップで命令が指せるエフェクト。フィールド → 画面の順。同じ id は先の物だけ。 */
export function readMapEffects(map: Pick<MapDef, 'fieldEffects' | 'screenEffects'>): MapEffectEntry[] {
  const out: MapEffectEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: MapEffectEntry) => {
    if (!entry.id || seen.has(entry.id)) return;
    seen.add(entry.id);
    out.push(entry);
  };
  for (const one of map.fieldEffects ?? []) {
    push({ id: String(one.id ?? ''), name: String(one.name ?? one.id ?? ''), place: 'field', kind: String(one.kind ?? ''), startOn: one.on !== false });
  }
  for (const one of map.screenEffects ?? []) {
    push({ id: String(one.id ?? ''), name: String(one.name ?? one.id ?? ''), place: 'screen', kind: String(one.kind ?? ''), startOn: one.on !== false });
  }
  return out;
}

/**
 * 入ったときの濃さ（0 か 1）。覚え（`shownOf`。無ければ undefined）があればそれ、無ければ最初の形。
 * キーはプリセット id。
 */
export function mapEffectStartWeights(
  entries: readonly MapEffectEntry[],
  shownOf: (id: string) => boolean | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of entries) out.set(entry.id, (shownOf(entry.id) ?? entry.startOn) ? 1 : 0);
  return out;
}

/** 混ぜている途中の 1 つ。 */
export interface MapEffectFade {
  from: number;
  to: number;
  /** かける時間（秒）。0 ならすぐ。 */
  seconds: number;
  /** 経った時間（秒）。 */
  at: number;
}

/** 混ぜ始める。今の濃さから `shown` の側へ。 */
export function startMapEffectFade(now: number, shown: boolean, ms: number | undefined): MapEffectFade {
  const seconds = Math.max(0, Number.isFinite(ms) ? (ms as number) / 1000 : 0);
  return { from: now, to: shown ? 1 : 0, seconds, at: 0 };
}

/** 時間を進めて、今の濃さを返す。終わったかは `at >= seconds` で分かる。 */
export function stepMapEffectFade(fade: MapEffectFade, deltaSeconds: number): number {
  fade.at += Math.max(0, deltaSeconds);
  if (fade.seconds <= 0 || fade.at >= fade.seconds) return fade.to;
  return fade.from + (fade.to - fade.from) * (fade.at / fade.seconds);
}
