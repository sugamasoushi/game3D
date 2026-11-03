// 敵シンボルが自分から動く（2026-11-01 / GS-296）。**気づく → 追う／逃げる → 見失う → 帰る**。
// ここは数だけ（向き・距離・気づいたか）。時間・マーク・歩かせるのは `GameView` が持つ。
//
// 位置はマス単位のワールド座標（x, z）。進むのは**マスの軸に沿って 1 マスずつ**——
// 半端に進むとマスの端に立ち、塞ぐマスと絵の立ち位置が食い違う（うろつきと同じ。GS-117）。
// 経路探し（回り込み）はしない。塞がれたら諦めるので、追われる側は物陰で撒ける。

/** 気づいたときにどうするか。 */
export type NoticeAct =
  /** 追ってくる。 */
  | 'chase'
  /** 逃げる。 */
  | 'flee'
  /** 仲間の方が格上（レベル差 `gap` 以上）なら逃げ、そうでなければ追ってくる。 */
  | 'fleeWeak';

/** 敵シンボルの気づき方（`mapNpcs.json` のその 1 体の `notice`）。 */
export interface NoticeDef {
  act: NoticeAct;
  /** 気づく距離（マス）。 */
  see?: number;
  /** 見える向き。`front` は向いている側の前方（左右 60° ずつ）、`around` は全方向。 */
  view?: 'front' | 'around';
  /** 追う・逃げる速さ（マス／秒）。主人公の歩きは 4.2、走りは 8。 */
  speed?: number;
  /** 置いた場所から離れてよい距離（マス）。越えたら諦めて帰る。 */
  leash?: number;
  /** `fleeWeak` で逃げるレベル差（仲間の最高レベル − 敵のレベル がこれ以上なら逃げる）。 */
  gap?: number;
  /**
   * 見失ったあと（追う敵も逃げる敵も）。`return` は置いた場所へ帰る（既定）、
   * `stay` はその場をうろつく（そこが新しい置き場になる）、`vanish` は薄れて消える（入り直せば戻る）。
   */
  after?: NoticeAfter;
}

/** 見失ったあとの動き。 */
export type NoticeAfter = 'return' | 'stay' | 'vanish';
export const NOTICE_AFTERS: readonly NoticeAfter[] = ['return', 'stay', 'vanish'];

/** 書かなかった項目に入る値。 */
export const NOTICE_DEFAULT: Required<Omit<NoticeDef, 'act'>> = {
  see: 4,
  view: 'front',
  speed: 3,
  leash: 6,
  gap: 5,
  after: 'return',
};

/** 気づいてからこれだけ離れたら見失う（気づく距離に足すマス）。 */
export const NOTICE_LOSE_EXTRA = 3;
/** 前方と見なす角度の半分（度）。 */
export const NOTICE_FRONT_HALF_DEG = 60;

/** 既定で埋める。書いていなければ null。 */
export function noticeWithDefaults(def: NoticeDef | null | undefined): Required<NoticeDef> | null {
  if (!def || (def.act !== 'chase' && def.act !== 'flee' && def.act !== 'fleeWeak')) return null;
  const full = { ...NOTICE_DEFAULT, ...def };
  // 知らない値は既定（帰る）。
  if (!NOTICE_AFTERS.includes(full.after)) full.after = NOTICE_DEFAULT.after;
  return full;
}

type Point = { x: number; z: number };
/** マスの軸に沿った 1 歩（どれか 1 つが ±1）。 */
export type Step = { x: -1 | 0 | 1; z: -1 | 0 | 1 };
const STEPS: Step[] = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];

const span = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * 見えるか（壁ごしかどうかは呼ぶ側が見る）。距離が `see` 以内で、`front` なら向いている側の前方。
 * 重なっている（距離ほぼ 0）ときは見えているとする。
 */
export function inSight(me: Point, aim: Point, target: Point, see: number, view: 'front' | 'around'): boolean {
  const d = span(me, target);
  if (d > see) return false;
  if (view === 'around' || d < 1e-6) return true;
  const len = Math.hypot(aim.x, aim.z);
  if (len < 1e-6) return true;
  const cos = ((target.x - me.x) * aim.x + (target.z - me.z) * aim.z) / (d * len);
  return cos >= Math.cos((NOTICE_FRONT_HALF_DEG * Math.PI) / 180) - 1e-9;
}

/** 見失ったか（気づく距離＋`NOTICE_LOSE_EXTRA` より離れた）。 */
export function lostSight(me: Point, target: Point, see: number): boolean {
  return span(me, target) > see + NOTICE_LOSE_EXTRA;
}

/**
 * 気づいたときに逃げるか。`gap` は「仲間の最高レベル − 敵のレベル」（分からなければ null）。
 * `fleeWeak` で差が分からないときは逃げない（追う）。
 */
export function fleesNow(def: Pick<Required<NoticeDef>, 'act' | 'gap'>, gap: number | null): boolean {
  if (def.act === 'flee') return true;
  if (def.act === 'chase') return false;
  return gap !== null && gap >= def.gap;
}

/** 置いた場所から `leash` マス以内か。 */
export function withinLeash(at: Point, home: Point, leash: number): boolean {
  return span(at, home) <= leash + 1e-6;
}

/**
 * 相手へ近づく 1 歩の候補（良い順）。離れている軸の大きい方を先に、もう片方の軸を次に。
 * 差が 0 の軸は入れない（横へずれるだけで近づかない）。重なっていれば空。
 */
export function chaseSteps(from: Point, to: Point): Step[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const sx = Math.abs(dx) < 0.5 ? 0 : (Math.sign(dx) as -1 | 1);
  const sz = Math.abs(dz) < 0.5 ? 0 : (Math.sign(dz) as -1 | 1);
  const ax: Step | null = sx ? { x: sx, z: 0 } : null;
  const az: Step | null = sz ? { x: 0, z: sz } : null;
  const list = Math.abs(dx) >= Math.abs(dz) ? [ax, az] : [az, ax];
  return list.filter((one): one is Step => one !== null);
}

/**
 * 相手から離れる 1 歩の候補（良い順）。進んだ先が相手から遠いほど先。
 * **今より近づく向きは入れない**。置いた場所から `leash` を越える向きも入れない。
 * 空なら追い詰められている。
 */
export function fleeSteps(from: Point, threat: Point, home: Point, leash: number): Step[] {
  const now = span(from, threat);
  return STEPS
    .map((step) => ({ step, to: { x: from.x + step.x, z: from.z + step.z } }))
    .filter(({ to }) => span(to, threat) >= now - 1e-6 && withinLeash(to, home, leash))
    .sort((a, b) => span(b.to, threat) - span(a.to, threat))
    .map(({ step }) => step);
}

/**
 * 帰り道の 1 歩の候補（良い順）。置いた場所へ近づく向き。
 * 着いている（両方の軸で半マス未満）なら空。
 */
export function homeSteps(from: Point, home: Point): Step[] {
  return chaseSteps(from, home);
}

/**
 * 後ろから触れたか（敵の先制。GS-296）。主人公の向き `aim` に対して、相手が真後ろから左右 60° 以内に居る。
 * 真横や斜め前から触れたのは数えない。
 */
export function touchedFromBehind(me: Point, aim: Point, it: Point): boolean {
  const dx = it.x - me.x;
  const dz = it.z - me.z;
  const len = Math.hypot(dx, dz) * Math.hypot(aim.x, aim.z);
  if (len < 1e-6) return false;
  return (dx * aim.x + dz * aim.z) / len < -0.5;
}
