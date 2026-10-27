// マップに入るたびに戻るイベント（GS-233。元は宝箱の台帳の `respawn` / `chance`。GS-180）。
//
// イベントに `respawn: true` と書くと、マップに入るたびに
//   - **このイベントを起こす物の覚えを消す**（`<マップ>/@<Id>/…`。物に `Id` が無ければ `<マップ>/<イベント id>/…`）。
//   - **このイベントの「レイヤーの出し入れ」で変えた形を最初へ戻す**（`<マップ>/#<Id>/出す`）。
//   ——宝箱なら、出て戻ればまた閉じて中身が入っている。
//   - `chance`（0〜1）を書くと、**入るたびにその確率で出る**。外れたら、物を調べられなくし、
//     「レイヤーの出し入れ」が指すレイヤーを全部組まない（見た目も当たりも無い）。
//
// **決めるのはマップを組む前**（`GameView` の `prepareMap`）。組んだ後に隠すと、
// 出なかった宝箱の当たりが見えない壁として残る。
//
// 以前の「同じ `Id` を何か所にも置くと 1 か所にだけ出る」（置き場所の抽選）はやめた。

import type { EventCommand, EventDef } from '../event/types';
import type { MapDef } from '../mep3d/types';
import type { EventSpot } from './eventSpots';
import { layerKey, layersOfId } from './layerSwitch';
import { mapEffectKey } from './mapEffectSwitch';


/** 入ったときに決めたこと。 */
export interface EventVisit {
  /** 組まない（居ないことにする）タイルレイヤー。 */
  removed: Set<string>;
  /** 出なかった（確率で外れた）イベントの id。その物は調べられない。 */
  absent: Set<string>;
}

export const NO_VISIT: EventVisit = { removed: new Set(), absent: new Set() };

/** 命令の並びを、枝の中までたどる（`if` / 選択肢 / 戦闘の結果など）。 */
function* walk(commands: EventCommand[]): Generator<EventCommand> {
  for (const command of commands) {
    yield command;
    for (const value of Object.values(command)) {
      if (!Array.isArray(value)) continue;
      // 枝は命令の並び、選択肢の枝は並びの並び。
      for (const item of value) {
        if (Array.isArray(item)) yield* walk(item as EventCommand[]);
        else if (item && typeof item === 'object' && 'type' in item) yield* walk([item as EventCommand]);
      }
    }
  }
}

/** そのイベントの「レイヤーの出し入れ」が指す `Id`。 */
export function layerIdsOf(event: EventDef): string[] {
  const out: string[] = [];
  for (const command of walk(event.commands)) {
    if (command.type === 'layer' && command.id && !out.includes(command.id)) out.push(command.id);
  }
  return out;
}

/** そのイベントの「マップのエフェクト」が指す id（GS-270）。 */
export function mapEffectIdsOf(event: EventDef): string[] {
  const out: string[] = [];
  for (const command of walk(event.commands)) {
    if (command.type === 'mapEffect' && command.id && !out.includes(command.id)) out.push(command.id);
  }
  return out;
}

/**
 * 入ったときの抽選。`respawn` のイベントだけを見る。
 * `random` は `Math.random` の差し替え口（テスト用）。
 */
export function rollEventVisit(map: MapDef, events: EventDef[], random: () => number = Math.random): EventVisit {
  const removed = new Set<string>();
  const absent = new Set<string>();
  for (const event of events) {
    if (!event.respawn) continue;
    const chance = typeof event.chance === 'number' ? Math.max(0, Math.min(1, event.chance)) : 1;
    if (random() < chance) continue;
    absent.add(event.id);
    for (const id of layerIdsOf(event)) for (const layer of layersOfId(map, id)) removed.add(layer);
  }
  return { removed, absent };
}

/** 抽選の結果どおりに、組まないレイヤーを抜いたマップ。抜く物が無ければ元のまま。 */
export function applyEventVisit(map: MapDef, visit: EventVisit): MapDef {
  if (!visit.removed.size) return map;
  return { ...map, layers: map.layers.filter((layer) => !visit.removed.has(layer.id)) };
}

/**
 * 入るたびに戻るイベントの覚えを消す（そのマップの分だけ）。`mapKey` は覚えの頭（`selfKey` の `map`）。
 * `spots` はそのマップの起動場所（どの物がどのイベントを起こすか）。消した数を返す。
 */
export function forgetRespawn(self: Map<string, boolean>, mapKey: string, events: EventDef[], spots: EventSpot[]): number {
  const scopes = new Set<string>();
  const layerKeys = new Set<string>();
  for (const event of events) {
    if (!event.respawn) continue;
    scopes.add(event.id);
    for (const spot of spots) if (spot.event === event.id && spot.owner) scopes.add(`@${spot.owner}`);
    for (const id of layerIdsOf(event)) layerKeys.add(layerKey(mapKey, id));
    // マップのエフェクトの出し入れ（GS-270）も、入るたびに最初の形へ戻す。
    for (const id of mapEffectIdsOf(event)) layerKeys.add(mapEffectKey(mapKey, id));
  }
  let count = 0;
  for (const key of [...self.keys()]) {
    // キーは `<マップ>/<宛先>/<名前>`（`selfKey`）。
    const scope = key.startsWith(`${mapKey}/`) ? key.slice(mapKey.length + 1).split('/')[0] : '';
    if ((scope && scopes.has(scope)) || layerKeys.has(key)) {
      self.delete(key);
      count += 1;
    }
  }
  return count;
}
