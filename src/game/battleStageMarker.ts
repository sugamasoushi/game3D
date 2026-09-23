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
