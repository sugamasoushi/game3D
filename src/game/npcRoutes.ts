import type { MapDef } from '../mep3d/types';

export interface NpcRouteMotion {
  /** NpcMotion レイヤーの Id。 */
  id: string;
  mode: 'loop' | 'pingpong' | 'once';
  /** 1 マスを進むミリ秒。 */
  walkMs: number;
  /** 最初に向かう点の名前（正の整数）。 */
  start: number;
}
export interface RoutePoint { order: number; x: number; y: number; z: number }
export interface NpcRoute { id: string; name: string; points: RoutePoint[] }

/** 座標はマップのマス。表示名では識別しない。 */
export function readNpcRoutes(map: Pick<MapDef, 'layers'>): NpcRoute[] {
  return map.layers.filter((layer) => layer.kind === 'object' &&
    layer.properties?.some((p) => p.name === 'NpcMotion' && p.value === true)).map((layer) => ({
    id: String(layer.properties?.find((p) => p.name === 'Id')?.value ?? '').trim(),
    name: layer.name ?? layer.id,
    points: (layer.objects ?? []).filter((p) => p.kind === 'point' && (p.plane ?? 'xz') === 'xz').map((p) => ({
      order: Number(p.name), x: p.points[0]?.[0] ?? NaN, y: p.y ?? 0, z: p.points[0]?.[1] ?? NaN,
    })).sort((a, b) => a.order - b.order),
  }));
}

export interface RouteState { index: number; direction: 1 | -1; done: boolean }
/** 会話中は動き続ける。メニューなど、イベント以外の操作停止だけに従う。 */
export function pauseNpcRoute(playable: boolean, eventBusy: boolean): boolean {
  return !playable && !eventBusy;
}
export function createRouteState(route: NpcRoute, start: number): RouteState {
  return { index: route.points.findIndex((p) => p.order === start), direction: 1, done: false };
}

/** 実際に着いた時だけ次へ進む。塞がれた時間では進めない。 */
export function routeInput(route: NpcRoute, motion: NpcRouteMotion, state: RouteState,
  position: { x: number; z: number }, dt: number, paused: boolean) {
  const stop = { move: { x: 0, z: 0 }, speed: 0 };
  if (paused || state.done || dt <= 0 || state.index < 0) return stop;
  let target = route.points[state.index];
  if (!target) return stop;
  if (Math.hypot(target.x - position.x, target.z - position.z) < 0.005) {
    const next = state.index + state.direction;
    if (next < 0 || next >= route.points.length) {
      if (motion.mode === 'once') { state.done = true; return stop; }
      if (motion.mode === 'loop') state.index = 0;
      else { state.direction = state.direction === 1 ? -1 : 1; state.index += state.direction; }
    } else state.index = next;
    target = route.points[state.index];
    if (!target) return stop;
  }
  const dx = target.x - position.x, dz = target.z - position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.000001) return stop;
  return { move: { x: dx / distance, z: dz / distance }, speed: Math.min(1000 / motion.walkMs, distance / dt) };
}
