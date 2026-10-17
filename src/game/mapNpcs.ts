// マップに置いた NPC の設定（2026-10-08。GS-229 / GS-230）。**マップ＋1 体（`Id`）ごと**に、
// 出し方（最初は出さない・出す条件）と動き（うろつき・その場の足踏み）を持つ台帳（`public/data/mapNpcs.json`）。
//
// それまでは、出し方をマップのプロパティ（`Standby` / `ShowIf` / `HideIf` / `ShowWhile`）、うろつき方を立ち姿の台帳（絵ごと）が
// 持っていた。条件が増えてマップエディタでは追えないので、**台帳エディタの「マップ構成」で 1 体ずつ**決める形にした
// （GS-229 で動き、GS-230 で出し方を移した。台帳の名前も `npcMotions.json` から改めた）。
// 上書きの段は持たない（書いてあればそのとおり、無ければいつでも出て立ち止まる）。
// 時間帯で出す（`ShowIn`）と、エディタだけの目印（`Hidden`）はマップに残る——マップの見た目の話なので。
//
// 1 体の名前はマップの `Id`（マップエディタが置いたときに書く。同じキャラクターの 2 体目からは番号付き）。

import { assetUrl } from './assets';
import type { NpcRouteMotion } from './npcRoutes';
import type { IfCondition } from '../event/types';
import { knownMapKeyForFile } from './mapIndex';

/**
 * うろつき方（GS-48 / GS-50）。**マス単位では動かない。**
 * 旧作は ±20px（チップ 32px の 0.6 マスぶん）を 1 秒かけて動いていた。
 * マス単位で 1 歩ずつ動かすと、歩幅も速さも大きすぎて「うろつき」に見えない。
 */
export interface WanderDef {
  /** 立ち止まっている時間（ミリ秒）。`[最短, 最長]` から毎回抽選する。 */
  ms?: [number, number];
  /** 置いた場所から離れてよい距離（マス）。0 で動かない。 */
  range?: number;
  /** 1 回に動く距離の上限（マス）。毎回 0 とこの間で抽選する。 */
  step?: number;
  /** その距離を歩くのにかける時間（ミリ秒）。速さはここから決まる。 */
  walkMs?: number;
}

/** うろつきの既定（GS-50）。旧作の「±20px を 1 秒、1.7〜3.3 秒休む」に合わせた。書かなかった項目に入る。 */
export const WANDER_DEFAULT: Required<WanderDef> = {
  ms: [1700, 3300],
  range: 2,
  // 一度に歩くマス数（GS-117）。**1 マス単位**——半端に歩くとマスの端に立ち、
  // 塞ぐマス（人はマス 1 つ。GS-35）と絵の立ち位置が食い違って、話しかけられなくなる。
  step: 1,
  walkMs: 1000,
};

/** 1 体ぶんの設定。 */
export interface MapNpcDef {
  /** 立ち止まり・常時足踏みの配置時の向き。省略時はマップの Face。 */
  facing?: 'up' | 'down' | 'left' | 'right';
  /** 常時足踏みの1コマの時間（ms）。省略時は画像の歩行設定。 */
  stepMs?: number;
  /** マップに置いた NpcMotion の点を順にたどる。 */
  route?: NpcRouteMotion;
  /**
   * **最初は出さない**（GS-157）。イベントの「置き直す」で出すまで居ない。
   * 「イベントで初めて現れる人」はこれ 1 つで足りる——イベント名は要らない。
   */
  standby?: boolean;
  /**
   * **この条件を満たす間だけ出す**（GS-230）。書き方はイベントの条件（`if` / 起動条件）と同じで、並べれば全部満たすとき。
   * スイッチ（`is: false` なら「入ったら出さない」）・覚え（その 1 体自身の）・変数・持ち物・所持金・時間帯。
   * 古い `ShowIf` / `HideIf` / `showWhile`（イベントが動ける間だけ）はここへ移した。**イベントの起動条件とは結び付けない**——
   * イベントと合わせたいときは、設定者が同じフラグを書く（GS-231）。
   */
  showWhen?: IfCondition[];
  /** うろつく。書かなければ立ち止まったまま。 */
  wander?: WanderDef;
  /**
   * **常時その場で足踏みする**（GS-169）。進まず足だけ動く（揺れる旗・回る風車・じっとしていない人）。
   * 踏んでいるあいだ**うろつきは入らない**。
   */
  stepInPlace?: boolean;
}

/** `mapNpcs.json` の中身。マップの番号（`maps.json` のキー）→ 1 体の名前（`Id`）→ 設定。 */
export interface MapNpcFile {
  maps: Record<string, Record<string, MapNpcDef>>;
}

let book: MapNpcFile['maps'] = {};
let pending: Promise<void> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**。読めなければ誰もが出て立ち止まる（止めはしない）。 */
export function loadMapNpcs(): Promise<void> {
  pending ??= fetch(assetUrl('data/mapNpcs.json'))
    .then((response) => (response.ok ? (response.json() as Promise<MapNpcFile>) : null))
    .then((file) => {
      book = file?.maps ?? {};
    })
    .catch((error) => {
      console.warn('[mapNpcs] 台帳を読めなかった', error);
      book = {};
    });
  return pending;
}

/** そのマップの NPC の設定（1 体の名前 → 設定）。台帳を読んでから呼ぶ。無ければ空。 */
export function mapNpcSettings(mapKey: string | null): Record<string, MapNpcDef> {
  return (mapKey && book[mapKey]) || {};
}

/** マップのファイル名から引く（台帳の番号はマップの台帳から。どちらも読んでから呼ぶ）。 */
export function mapNpcSettingsForFile(file: string): Record<string, MapNpcDef> {
  return mapNpcSettings(knownMapKeyForFile(file));
}

/** うろつき方を既定で埋める。うろつかない（書いていない・範囲 0）なら null。 */
export function wanderWithDefaults(setting: MapNpcDef | null | undefined): Required<WanderDef> | null {
  if (!setting?.wander) return null;
  const wander = { ...WANDER_DEFAULT, ...setting.wander };
  return wander.range > 0 ? wander : null;
}
