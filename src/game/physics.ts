// 当たり（GS-237 / GS-239）。物理エンジン Rapier の世界と、キャラクターの体。
//
// 当たりの形は `mep3d/hitShapes.ts`（描く形そのもの）。ここはそれを Rapier の世界に入れ、
// プレイヤーと NPC の体（四角い柱。GS-241）を Rapier のキャラクター制御で動かす。
// ゲームが地形に聞くこと（足場の高さ・体が入るか・はしご・登れる段差）も、この世界が答える（`Terrain`）。
// はしごと `Climb` の範囲はオブジェクトから読む（`mep3d/collision.ts`）。

import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { CLIMB_PROPERTY, LADDER_PROPERTY, readZones, zoneAt, type LadderSpot } from '../mep3d/collision';
import { buildHitMeshes, type HitMesh, type HitRole } from '../mep3d/hitShapes';
import type { MapDef } from '../mep3d/types';

type Rapier = typeof RAPIER_NS;

/** 落下の加速と上限（マス毎秒）。今の体（`player.ts`）と同じ。 */
const GRAVITY = 24;
const FALL_MAX = 20;
/** これより下は奈落。落ち続けないように止める（今の体と同じ）。 */
const VOID_Y = -32;
/** 地面への吸い付き（マス）。下り坂・段差の下りで浮かない。 */
const SNAP = 0.5;
/** 上れる坂の上限（度）。 */
const SLOPE_CLIMB = 50;
/** 当たりの面との隙間（マス）。小さすぎると面にめり込みやすい。 */
const SKIN = 0.02;
/** 接地中に下へ押す量（マス毎フレーム）。地面を見つけるためだけの量。 */
const GROUND_PRESS = 0.01;
/** 歩いているあいだの押し。大きいと上る向きの動きが削られて坂で遅くなる。 */
const GROUND_PRESS_MOVING = 0.002;
/** 置き直すときに浮かせる高さ（マス）。 */
const TELEPORT_LIFT = 0.05;
/** 足が離れてからも、足元の高さに合わせ続けるフレーム数（GS-253）。坂の頂上で 1 フレーム浮いても落ちない。 */
const GROUND_GRACE = 2;
/** 立ち止まってから、その場に留めるまでのフレーム数（GS-244）。着地の直後は床へ沈みきるまで動かす。 */
const SETTLE_FRAMES = 10;
/**
 * 体の足先（GS-241）。体は**マス目に揃った四角い柱**だが、底だけは細くすぼめる。
 * 底まで四角いと、坂では上り側の角だけが坂に乗って体の真ん中が浮く（45 度の坂で半マス近く）。
 * すぼめた面の傾き（`FOOT_STEEP`）は**坂（45 度）より急で、上れる坂の上限（`SLOPE_CLIMB`）より急**——
 * 坂には足先が先に着き、ブロックの縁はすぼめた面で「上れる坂」と取り違えない（段差を勝手に上らない）。
 */
const FOOT_HALF = 0.06;
const FOOT_STEEP = 58;

/**
 * 体の形（中心からの頂点。凸包にする）。上は幅 `half * 2` の四角、底は `FOOT_HALF` の小さな四角。
 * `half` と `height` はワールド。
 */
function bodyHull(half: number, height: number, unit: number): Float32Array {
  const foot = Math.min(FOOT_HALF * unit, half);
  const taper = Math.min((half - foot) * Math.tan((FOOT_STEEP * Math.PI) / 180), height * 0.6);
  const h = height / 2;
  const points: number[] = [];
  for (const [w, y] of [[foot, -h], [half, -h + taper], [half, h]] as const) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) points.push(sx * w, y, sz * w);
  }
  return new Float32Array(points);
}

let rapierPromise: Promise<Rapier> | null = null;

/** Rapier を読む（初回だけ wasm を起こす）。マップを読む前に待つ。 */
export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import('@dimforge/rapier3d-compat').then(async (module) => {
    const rapier = (module.default ?? module) as Rapier;
    await rapier.init();
    return rapier;
  });
  return rapierPromise;
}

/**
 * 当たりの組（Rapier の InteractionGroups。上位 16bit が所属、下位 16bit が相手）。
 * 地形は 1、人は 2。人どうしは当たる——イベント中だけ外す（GS-157）。
 */
const GROUP_MAP = 0x0001;
const GROUP_CHARACTER = 0x0002;
const groups = (membership: number, filter: number) => (membership << 16) | filter;
/** 地形だけに当てる問い合わせ。 */
const MAP_ONLY = groups(0xffff, GROUP_MAP);

export interface PhysicsBody {
  /** 足元のワールド座標。 */
  readonly feet: { x: number; y: number; z: number };
  readonly grounded: boolean;
  /** 外から置き直されたとき（イベント・マップ移動・はしご）。落下の勢いも消す。 */
  teleport(x: number, y: number, z: number): void;
  /**
   * 横へ `dx` / `dz`（ワールド）動かし、重力で落とす。`stepUp` は自動で上れる段差（マス。0 で上らない）。
   * 動いたあとの足元を返す。
   */
  move(dx: number, dz: number, dt: number, stepUp: number): { x: number; y: number; z: number; grounded: boolean };
  /** 世界から外す（NPC を消したとき）。 */
  dispose(): void;
}

/**
 * ゲームが地形に聞くこと（GS-239）。座標の `x` / `z` は**マス**（整数）、`fx` / `fz` はマスの中の位置、
 * 高さ（`feetY`）はワールド。以前のマス単位の当たり（`CollisionMap`）と同じ聞き方にしてある。
 */
export interface Terrain {
  /** 1 マスのワールド単位。 */
  unit: number;
  /** その柱で `feetY` 以下にある一番高い足場のワールド Y。無ければ null。 */
  surfaceUnder(x: number, z: number, feetY: number, fx?: number, fz?: number): number | null;
  /** その足元（ワールド）に体（幅の半分・背丈はマス）が地形と重ならずに入るか。人は見ない。 */
  fits(wx: number, wy: number, wz: number, half: number, tall: number): boolean;
  /** そこで登れる段差（マス。DEC-237）。`Climb` の範囲の外は `fallback`。座標はセル（小数可）。 */
  climbAt(x: number, y: number, z: number, fallback: number): number;
  /** そこがはしごなら、その範囲と掴まる筒（セル）。無ければ null（DEC-237）。 */
  ladderAt(x: number, y: number, z: number): LadderSpot | null;
}

export interface PhysicsWorld extends Terrain {
  /** 人の体（マス目に揃った四角い柱。GS-241）。幅の半分・背丈はマス。 */
  createBody(half: number, tall: number): PhysicsBody;
  /** 人どうしを当てるか。イベント中は外す（GS-157）。 */
  setCharactersSolid(on: boolean): void;
  /** 当たりの数（三角形）。 */
  stats: Record<HitRole, number>;
  dispose(): void;
}

/** マップから Rapier の世界を作る。`map` は**元のマップ**（`Hidden` のレイヤーも当てるため）。 */
export function createPhysicsWorld(rapier: Rapier, map: MapDef): PhysicsWorld {
  const unit = map.grid?.unit ?? 1;
  const world = new rapier.World({ x: 0, y: 0, z: 0 });
  const meshes: HitMesh[] = buildHitMeshes(map);
  const stats: Record<HitRole, number> = { ground: 0, wall: 0, solid: 0 };
  const flags = rapier.TriMeshFlags.MERGE_DUPLICATE_VERTICES | rapier.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES;
  for (const mesh of meshes) {
    if (mesh.indices.length < 3) continue;
    stats[mesh.role] += mesh.indices.length / 3;
    world.createCollider(
      rapier.ColliderDesc.trimesh(mesh.vertices, mesh.indices, flags).setCollisionGroups(groups(GROUP_MAP, 0xffff)),
    );
  }
  // **問い合わせの索引を作る。** Rapier は `step` のときに作り直すので、作った直後は空——
  // 最初の 1 回の移動が床を素通りした（実測 0101 で −0.24）。
  world.step();

  const climbZones = readZones(map, CLIMB_PROPERTY);
  const ladderZones = readZones(map, LADDER_PROPERTY);
  /** 人どうしを当てるか（GS-157）。外すときは地形だけに当てて動かす。 */
  let charactersSolid = true;
  /**
   * 人の体（GS-242）。**人どうしの当たりは Rapier に任せず、ここで箱どうしで止める。**
   * 体はマス目に揃った四角い柱なので、軸ごとに縮めるだけで足りる。Rapier のキャラクター制御に人を見せると、
   * 面との隙間（`SKIN`）を保とうとしてぶつかられた側が押し出され（NPC が滑っていった）、
   * 触れたまま横へ歩くと止まった（面に沿って動けない）。
   */
  interface Person {
    feet: { x: number; y: number; z: number };
    /** 幅の半分・背丈（ワールド）。 */
    r: number;
    height: number;
  }
  const people = new Set<Person>();
  /**
   * 人に当たるまで縮めた横の動き。x を先に、そのあと z。**触れているだけなら面に沿って動ける**
   * （横の重なりは「隙間 0 より深い」ときだけ見る）。もう重なっている相手は見ない（離れる向きも塞がないため）。
   */
  const clampByPeople = (self: Person, mx: number, mz: number): { x: number; z: number } => {
    const eps = 1e-6 * unit;
    const { feet: at, r } = self;
    const block = (axisX: boolean, move: number, crossAt: number): number => {
      if (move === 0) return 0;
      for (const other of people) {
        if (other === self) continue;
        const o = other.feet;
        if (at.y >= o.y + other.height - eps || o.y >= at.y + self.height - eps) continue;
        const reach = r + other.r;
        const cross = axisX ? crossAt - o.z : crossAt - o.x;
        if (Math.abs(cross) >= reach - eps) continue;
        const gap = axisX ? o.x - at.x : o.z - at.z;
        // もう重なっている（置き直した直後など）なら塞がない。触れているだけ（誤差で少し食い込む）は塞ぐ。
        if (Math.abs(gap) < reach - 0.01 * unit) continue;
        if (move > 0 && gap > 0) move = Math.min(move, gap - reach);
        else if (move < 0 && gap < 0) move = Math.max(move, gap + reach);
      }
      return move;
    };
    const x = block(true, mx, at.z);
    const z = block(false, mz, at.x + x);
    return { x, z };
  };

  /** 体の形。同じ大きさなら使い回す（`fits` は毎フレーム何度も呼ぶ）。 */
  const hulls = new Map<string, RAPIER_NS.ColliderDesc>();
  const hullOf = (width: number, height: number): RAPIER_NS.ColliderDesc => {
    const key = `${width},${height}`;
    let desc = hulls.get(key);
    if (!desc) {
      desc = rapier.ColliderDesc.convexHull(bodyHull(width, height, unit)) ?? rapier.ColliderDesc.cuboid(width, height / 2, width);
      hulls.set(key, desc);
    }
    return desc;
  };

  const createBody = (halfWidth: number, tall: number): PhysicsBody => {
    const r = halfWidth * unit;
    const height = Math.max(tall * unit, r * 2 + 0.01);
    const half = height / 2;
    const rigid = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    const collider = world.createCollider(
      rapier.ColliderDesc.convexHull(bodyHull(r, height, unit))!.setCollisionGroups(groups(GROUP_CHARACTER, 0xffff)),
      rigid,
    );
    const controller = world.createCharacterController(SKIN * unit);
    controller.setUp({ x: 0, y: 1, z: 0 });
    // 壁に沿って滑る（斜めに押し当てても止まらない）。**重力で坂を滑り落ちるのとは別**——
    // 接地中は下へ押さないので、入力が無ければ坂の上でも動かない。
    controller.setSlideEnabled(true);
    controller.enableSnapToGround(SNAP * unit);
    controller.setMaxSlopeClimbAngle((SLOPE_CLIMB * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((89 * Math.PI) / 180);
    let fallSpeed = 0;
    let grounded = false;
    let step = -1;
    /** 入力が無く接地しているフレームが続いた数（GS-244）。 */
    let still = 0;
    /** 接地していないフレームが続いた数（GS-253）。置き直した直後は空中とみなす。 */
    let airFrames = GROUND_GRACE + 1;
    const feet = { x: 0, y: 0, z: 0 };
    const person: Person = { feet, r, height };
    people.add(person);
    const body: PhysicsBody = {
      get feet() {
        return feet;
      },
      get grounded() {
        return grounded;
      },
      teleport(x, y, z) {
        feet.x = x;
        feet.y = y;
        feet.z = z;
        // **床から少し浮かせて置く。** 床とちょうど同じ高さに置くと、Rapier は「もう当たっている」と見て
        // その面を素通りさせることがある（最初のフレームが長いと床を抜けて落ちた。実測 0101 で −0.24）。
        // 浮かせたぶんは次のフレームで着地する。
        rigid.setTranslation({ x, y: y + half + (SKIN + TELEPORT_LIFT) * unit, z }, true);
        // 置いた位置を当たりの問い合わせへ反映する（同じく `step` まで古い位置のまま）。
        world.step();
        fallSpeed = 0;
        grounded = false;
        still = 0;
        airFrames = GROUND_GRACE + 1;
      },
      move(dx, dz, dt, stepUp) {
        // 段差の自動の上り（`Climb` の範囲だけ。既定は 0 で上らない。DEC-256）。
        if (stepUp !== step) {
          step = stepUp;
          if (stepUp > 0) controller.enableAutostep(stepUp * unit, 0.1 * unit, false);
          else controller.disableAutostep();
        }
        fallSpeed = grounded ? 0 : Math.min(fallSpeed + GRAVITY * unit * dt, FALL_MAX * unit);
        // 接地中も**ほんの少しだけ**下へ押す。押さないと Rapier が地面を見つけられず、
        // 接地と空中が 1 フレームおきに入れ替わる。坂で滑り落ちないのは滑り出す角度（89 度）で止めている。
        const moving = dx !== 0 || dz !== 0;
        let dy = grounded ? -(moving ? GROUND_PRESS_MOVING : GROUND_PRESS) * unit : -fallSpeed * dt;
        // 坂では**足元の面に沿った向き**で動かす。水平に押すと Rapier が斜面へ削り、
        // 坂だけ横の速さが半分ほどに落ちる（今の体は坂でも横の速さが変わらない）。
        // **上り**は面の傾きを**進む先の足元**で測る。体の真下で測ると、坂の入り口で足先が先に坂へ当たり、
        // 真下はまだ平らなので削られる（入り口だけ 3 分の 1 の速さになった）。
        let climbing = false;
        if (grounded && moving) {
          const at = rigid.translation();
          const len = Math.hypot(dx, dz);
          const ahead = Math.min(r, 0.25 * unit);
          const ray = new rapier.Ray(
            { x: at.x + (dx / len) * ahead, y: at.y - half + 0.4 * unit, z: at.z + (dz / len) * ahead },
            { x: 0, y: -1, z: 0 },
          );
          const hit = world.castRayAndGetNormal(ray, 0.9 * unit, true, undefined, MAP_ONLY, collider);
          if (hit) {
            // 三角形の表裏は揃っていないので、上を向くほうへそろえる。
            const sign = hit.normal.y < 0 ? -1 : 1;
            const nx = hit.normal.x * sign;
            const ny = hit.normal.y * sign;
            const nz = hit.normal.z * sign;
            if (ny > 0.2) {
              const along = -(nx * dx + nz * dz) / ny;
              if (along > 0) {
                dy = along - GROUND_PRESS_MOVING * unit;
                climbing = true;
              }
            }
          }
        }
        // **下り・平ら**は**進む先の足元の高さ**へ合わせる（GS-253）。傾きから出すと、頂上の平らな所に
        // まだ足がある間に下りを始めて平らな所に止められ、遅れたまま足が離れて浮いて落ちた
        // （0106 を走って下ると最大 1.4 マス浮いた）。離れた直後（`GROUND_GRACE` フレーム）も同じに扱う。
        // 上げるのは上れる坂の傾き（`SLOPE_CLIMB`）まで——段差を勝手に上らない（DEC-256）。
        if (moving && !climbing && airFrames <= GROUND_GRACE) {
          const at = rigid.translation();
          const bottom = at.y - half - SKIN * unit;
          const from = bottom + 0.4 * unit;
          const down = (wx: number, wz: number) =>
            world.castRayAndGetNormal(new rapier.Ray({ x: wx, y: from, z: wz }, { x: 0, y: -1, z: 0 }), (0.4 + SNAP) * unit, true, undefined, MAP_ONLY, collider);
          const hit = down(at.x + dx, at.z + dz);
          if (hit && hit.timeOfImpact > 0 && Math.abs(hit.normal.y) > 0.2) {
            // 坂では足先（`FOOT_HALF`）の角が面に乗るので、体は面より少し上で止まる（45 度で 0.06）。
            // そこを狙わないと、届かない下向きの分を Rapier が坂に沿った横の動きへ流し、下りだけ速くなった。
            // 傾きは**今の足元**で測る——進む先で測ると、頂上の平らな所に居るうちから浮かせてしまう。
            const below = down(at.x, at.z);
            const ny = below ? Math.abs(below.normal.y) : 1;
            const rest = ny > 0 ? FOOT_HALF * unit * (Math.sqrt(Math.max(0, 1 - ny * ny)) / ny) : 0;
            const rise = from - hit.timeOfImpact + rest - bottom;
            const run = Math.hypot(dx, dz);
            if (rise <= run * Math.tan((SLOPE_CLIMB * Math.PI) / 180) + 0.001 * unit) {
              dy = rise - GROUND_PRESS_MOVING * unit;
              fallSpeed = 0;
            }
          }
        }
        // Rapier には地形だけを見せる。人どうしは `clampByPeople`（GS-242）。
        controller.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, undefined, MAP_ONLY);
        const moved = controller.computedMovement();
        grounded = controller.computedGrounded();
        airFrames = grounded ? 0 : airFrames + 1;
        // 立ち止まって接地しているなら**その場から動かさない**（GS-244）。地面を見つけるための押し（`GROUND_PRESS`）を
        // Rapier が坂に沿った向きへ流すので、坂の上で 10 秒に 0.04 マスずつ滑り落ちていた。
        // 着地の直後（`SETTLE_FRAMES` まで）は動かす——すぐ留めると、接地とみなされた高さ（床から 0.01）に浮いたまま残る。
        still = !moving && grounded ? still + 1 : 0;
        if (still > SETTLE_FRAMES) {
          moved.x = 0;
          moved.y = 0;
          moved.z = 0;
        }
        const side = charactersSolid && moving ? clampByPeople(person, moved.x, moved.z) : { x: moved.x, z: moved.z };
        const at = rigid.translation();
        const next = { x: at.x + side.x, y: at.y + moved.y, z: at.z + side.z };
        if (next.y - half < VOID_Y * unit) next.y = VOID_Y * unit + half;
        rigid.setNextKinematicTranslation(next);
        world.step();
        // 足元は体の底から**面との隙間（SKIN）を引いた所**。Rapier は面から SKIN だけ離して止めるので、
        // そのまま返すと床から 0.02 マス浮いて見え、高さで比べる処理（イベント・影）もずれる。
        feet.x = next.x;
        feet.y = next.y - half - SKIN * unit;
        feet.z = next.z;
        return { ...feet, grounded };
      },
      dispose() {
        people.delete(person);
        world.removeCharacterController(controller);
        world.removeRigidBody(rigid);
      },
    };
    return body;
  };

  /** 足場の高さ（ワールド）。上から下へ光線を当てる。地形だけを見る。 */
  const surfaceUnder = (x: number, z: number, feetY: number, fx = 0.5, fz = 0.5): number | null => {
    const from = feetY + 0.001 * unit;
    const ray = new rapier.Ray({ x: (x + fx) * unit, y: from, z: (z + fz) * unit }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 256 * unit, false, undefined, MAP_ONLY);
    return hit ? from - hit.timeOfImpact : null;
  };

  const fits = (wx: number, wy: number, wz: number, halfWidth: number, tall: number): boolean => {
    const r = halfWidth * unit;
    const height = Math.max(tall * unit, r * 2 + 0.01);
    const half = height / 2;
    const shape = hullOf(r, height).shape;
    const at = { x: wx, y: wy + half + SKIN * unit, z: wz };
    return world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, MAP_ONLY) === null;
  };

  /** マスの中心の小さな箱が地形と重なるか（はしごの筒の空きを見る）。 */
  const cellBlocked = (cx: number, cy: number, cz: number): boolean => {
    const shape = new rapier.Cuboid(0.2 * unit, 0.45 * unit, 0.2 * unit);
    const at = { x: (cx + 0.5) * unit, y: (cy + 0.5) * unit, z: (cz + 0.5) * unit };
    return world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, MAP_ONLY) !== null;
  };

  return {
    unit,
    surfaceUnder,
    fits,
    climbAt(x, y, z, fallback) {
      const zone = zoneAt(climbZones, x, y, z);
      return zone ? Math.max(fallback, zone.value) : fallback;
    },
    ladderAt(x, y, z) {
      const zone = zoneAt(ladderZones, x, y, z);
      if (!zone) return null;
      // 掴まる筒（DEC-237）。範囲の中で**上から下まで空いている**マスを選ぶ。
      // 壁に立てかけたはしごは、壁のマスと手前のマスの両方を含めて描く。
      // **床が途中や上端にあるマスは筒ではない**（段の上のマスを選ぶと床の裏を降りる）。
      let shaftX: number | null = null;
      let shaftZ: number | null = null;
      let best = Infinity;
      const eps = 0.001 * unit;
      for (let cz = Math.floor(zone.minZ); cz < Math.ceil(zone.maxZ); cz += 1) {
        for (let cx = Math.floor(zone.minX); cx < Math.ceil(zone.maxX); cx += 1) {
          let free = true;
          for (let cy = Math.floor(zone.minY); cy < Math.ceil(zone.maxY) && free; cy += 1) {
            if (cellBlocked(cx, cy, cz)) free = false;
          }
          if (!free) continue;
          const floor = surfaceUnder(cx, cz, zone.maxY * unit);
          if (floor !== null && floor > zone.minY * unit + eps) continue;
          const d = (cx + 0.5 - x) ** 2 + (cz + 0.5 - z) ** 2;
          if (d >= best) continue;
          best = d;
          shaftX = cx;
          shaftZ = cz;
        }
      }
      return { minY: zone.minY, maxY: zone.maxY, minX: zone.minX, maxX: zone.maxX, minZ: zone.minZ, maxZ: zone.maxZ, shaftX, shaftZ };
    },
    createBody,
    setCharactersSolid(on) {
      charactersSolid = on;
    },
    stats,
    dispose() {
      world.free();
    },
  };
}
