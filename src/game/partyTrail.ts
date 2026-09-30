/** 主人公が通った道。距離で遅らせるので停止中は隊列の間隔を保つ。座標はマス単位。 */
export interface TrailPoint {
  x: number;
  y: number;
  z: number;
  /** 主人公がそこを通ったときの向き（GS-185）。仲間はこの向きを使う。 */
  facing?: string;
}

export class PartyTrail {
  private points: Array<TrailPoint & { distance: number }> = [];

  reset(at: TrailPoint): void {
    this.points = [{ ...at, distance: 0 }];
  }

  advance(at: TrailPoint, keep: number): void {
    const last = this.points[this.points.length - 1];
    if (!last) { this.reset(at); return; }
    const distance = Math.hypot(at.x - last.x, at.y - last.y, at.z - last.z);
    // 瞬間移動を横断する道は作らない。
    if (distance > 3) { this.reset(at); return; }
    if (distance < 0.001) return;
    this.points.push({ ...at, distance: last.distance + distance });
    const before = last.distance + distance - keep;
    while (this.points.length > 2 && this.points[1].distance < before) this.points.shift();
  }

  /**
   * 離れていても**つないで**道を延ばす（GS-184）。`advance` は 3 マスを超える移動を瞬間移動とみなして
   * 道を切るが、イベントで置いた仲間を隊列へ戻すときは、仲間の場所から主人公まで道を引きたい。
   */
  extend(at: TrailPoint): void {
    const last = this.points[this.points.length - 1];
    if (!last) { this.reset(at); return; }
    const distance = Math.hypot(at.x - last.x, at.y - last.y, at.z - last.z);
    if (distance < 0.001) return;
    this.points.push({ ...at, distance: last.distance + distance });
  }

  behind(gap: number): TrailPoint {
    const last = this.points[this.points.length - 1];
    if (!last) throw new Error('PartyTrail must be initialized');
    const target = last.distance - gap;
    for (let i = this.points.length - 1; i > 0; i--) {
      const a = this.points[i - 1];
      const b = this.points[i];
      if (target < a.distance) continue;
      const t = Math.min(1, (target - a.distance) / (b.distance - a.distance));
      return withFacing({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, b.facing ?? a.facing);
    }
    const first = this.points[0];
    return withFacing({ x: first.x, y: first.y, z: first.z }, first.facing);
  }
}

/** 向きは**入っているときだけ**付ける。向きを持たない道（テスト・古い呼び方）の形を変えない。 */
function withFacing(point: TrailPoint, facing: string | undefined): TrailPoint {
  return facing === undefined ? point : { ...point, facing };
}
