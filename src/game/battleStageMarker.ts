import type { MapDef } from '../mep3d/types';

export interface BattleStageMarker {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

/** `BattleStage=true` を持つ床向きの点を戦闘舞台として使う。表示名には依存しない。 */
export function battleStageMarkers(map: Pick<MapDef, 'layers'>): BattleStageMarker[] {
  const found: BattleStageMarker[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    for (const object of layer.objects ?? []) {
      if (object.kind !== 'point' || (object.plane ?? 'xz') !== 'xz') continue;
      const enabled = object.properties?.some((property) =>
        property.name.trim().toLowerCase() === 'battlestage' && property.value === true);
      const point = object.points?.[0];
      if (!enabled || !point) continue;
      found.push({ id: object.id, name: object.name, x: point[0], y: object.y ?? 0, z: point[1] });
    }
  }
  return found;
}

export function battleStageMarker(map: Pick<MapDef, 'layers'>): BattleStageMarker | null {
  return battleStageMarkers(map)[0] ?? null;
}

/** 戦闘の舞台を何を基準に組んだか（2026-10-29）。 */
export type BattleStageSource = 'stage' | 'default' | 'origin';

/** 出発点の目印の名前（`GameView` の `SPAWN_OBJECT` と同じ）。 */
const DEFAULT_MARKER = 'default';

/**
 * 戦闘の舞台の基準（2026-10-29。2D の背景の戦闘はやめ、いつも 3D の舞台で戦う）。
 * `BattleStage=true` の床向きの点 → 名前が `default` の床向きの点（出発点）→ マップの原点 (0, 0, 0) の順。
 */
export function battleStageAnchor(map: Pick<MapDef, 'layers'>): { x: number; y: number; z: number; source: BattleStageSource } {
  const marked = battleStageMarker(map);
  if (marked) return { x: marked.x, y: marked.y, z: marked.z, source: 'stage' };
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    for (const object of layer.objects ?? []) {
      if (object.kind !== 'point' || (object.plane ?? 'xz') !== 'xz') continue;
      if (object.name.trim().toLowerCase() !== DEFAULT_MARKER) continue;
      const point = object.points?.[0];
      if (point) return { x: point[0], y: object.y ?? 0, z: point[1], source: 'default' };
    }
  }
  return { x: 0, y: 0, z: 0, source: 'origin' };
}
