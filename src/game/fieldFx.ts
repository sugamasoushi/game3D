// フィールドの技の絵（GS-295。2026-10-31）。フィールドアタックの絵を**3D の板**で立てる。
//
// 以前は戦闘と同じ DOM の重ね絵で、いつも画面の手前に出ていた（壁や人の後ろでも見えた）。
// 板は**深度を見る**（`depthTest`）ので、手前に物があれば隠れる。深度は書かない（重なった絵どうしで欠けない）。
// 向きはいつもカメラの正面（キャラの板と違い、上下にも向ける）。光は当てない（夜でも見える）。
//
// 大きさは 2 通り:
// - フィールド: キャラの絵と同じ割合（絵の画素 ÷ マップの 1 マスの画素 × マス × マップの `CharacterScale`）× 技の `field.fxScale`。
// - 戦闘（`pixel`）: **画面の上で絵の画素どおり**（1280×720 の画面で）。出した時点のカメラからの距離で決める——
//   戦闘のカメラは寄っているので、マスの割合にすると絵がずっと大きく見えてしまう（前の DOM の重ね絵と同じ大きさにそろえる）。
// 置き場所から**カメラの方へ少し寄せる**（`TOWARD_CAMERA`）。狙った相手の板に半分埋もれないように。手前に別の物があれば隠れる。
// コマのめくり方・大きさの変化は `effects.json` の行（`fieldFxFrame`）。
// 戦闘の攻撃の絵もこれを使う（2026-10-31。それまで戦闘は DOM の重ね絵でいつも手前に出ていた）。
//
// フィールドエフェクトの技の絵（GS-297。爆発・光の柱など）も同じ口で出す。マップと同じ描き方（`createFieldEffects`）を
// 1 つ借りて相手の所へ置き、時間 0 から流す（置き場所の箱は `skillFieldFx.ts`）。大きさはいつもマス × `CharacterScale`
// （戦闘の `pixel` は使わない。戦闘のマスはフィールドのマス × `CharacterScale` なので、舞台の上でも同じ割合になる）。

import {
  BufferAttribute,
  Vector3,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Camera,
  type Object3D,
  type Texture,
} from 'three';
import { sheetUrl } from './spriteSheets';
import { isFieldEffect, type EffectDef, type FieldEffectEntry, type SpriteEffectDef } from './battle/book';
import { createFieldEffects, type FieldEffects } from '../mep3d/fieldEffects';
import { skillFieldVolume, skillFieldWeight } from './skillFieldFx';

/** キャラより後に描く（深度は見るので、手前の物には隠れる）。 */
const FX_RENDER_ORDER = 8000;
/** 置き場所からカメラの方へ寄せる距離（マス）。 */
const TOWARD_CAMERA = 0.4;
/** 画面の高さ（戦闘の大きさの基準。ゲームの画面 1280×720）。 */
const SCREEN_HEIGHT = 720;

/** カメラからその点までの、画面 1 画素あたりのワールドの長さ。 */
export function worldPerPixel(camera: Camera, at: Vector3): number {
  const cam = camera as Camera & { isPerspectiveCamera?: boolean; isOrthographicCamera?: boolean; fov?: number; zoom?: number; top?: number; bottom?: number };
  if (cam.isOrthographicCamera) return ((cam.top ?? 1) - (cam.bottom ?? -1)) / (cam.zoom ?? 1) / SCREEN_HEIGHT;
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const depth = Math.max(0.01, at.clone().sub(camera.getWorldPosition(new Vector3())).dot(forward));
  const fov = ((cam.fov ?? 50) * Math.PI) / 180;
  return (2 * depth * Math.tan(fov / 2)) / (cam.zoom ?? 1) / SCREEN_HEIGHT;
}

/** 出し方。 */
export interface FieldFxOptions {
  /** 長さが来ても消さない（飛ぶ物。呼ぶ側が `end` で消す）。 */
  hold?: boolean;
  /** 大きさの倍率（技の `field.fxScale`）。 */
  scale?: number;
  /** 画面の上で絵の画素どおりの大きさにする（戦闘）。そのときのカメラを渡す。 */
  pixel?: Camera;
  /** 足元の高さ（マス）。フィールドエフェクトの柱・炎などを床から立てるのに使う（GS-297）。無ければ `at` の高さ。 */
  foot?: number;
  /**
   * フィールドエフェクトを描く順（GS-298）。戦闘では出すマスの列から決める（`skillFieldOrder`）——舞台の板は深度を書かないので、
   * 順番が板より前だと板に塗りつぶされて後ろに出たように見える。無ければコマ絵と同じ（キャラより後）。
   */
  order?: number;
  /**
   * 描く層（three.js の `layers`）。戦闘では舞台の板と同じ「ぼかさない層」にする——板はチルトシフトのぼかしの後に
   * 描くので、ほかの層に置くと板に塗りつぶされる（板どうしの前後は深度で決まる）。
   */
  layer?: number;
}

/** コマの番号と大きさの倍率（`t` は出してからのミリ秒）。前の戦闘の DOM の絵（`EffectSprite`）と同じ決め方。 */
export function fieldFxFrame(def: Pick<SpriteEffectDef, 'frames' | 'fps' | 'scale' | 'scaleMs' | 'yoyo'>, t: number): { frame: number; scale: number } {
  const [first, last] = def.frames;
  const count = Math.max(1, last - first + 1);
  const frame = first + (Math.floor((Math.max(0, t) * def.fps) / 1000) % count);
  let scale = 1;
  if (def.scale && def.scaleMs) {
    const [from, to] = def.scale;
    const leg = (Math.max(0, t) % (def.yoyo ? def.scaleMs * 2 : def.scaleMs)) / def.scaleMs;
    const k = def.yoyo && leg > 1 ? 2 - leg : leg;
    scale = from + (to - from) * k;
  }
  return { frame, scale };
}

interface Fx {
  mesh: Mesh;
  def: SpriteEffectDef;
  /** 出してからのミリ秒。 */
  t: number;
  /** 長さで消さない（飛ぶ物。呼ぶ側が `end` で消す）。 */
  hold: boolean;
  /** 置き場所（ワールド）。カメラの方へ寄せる前。 */
  base: Vector3;
  /** 絵の 1 画素あたりのワールドの長さ（倍率込み）。 */
  perPx: number;
}

export interface FieldFx {
  /** 絵を 1 つ出す。`at` はマス（小数。絵の真ん中）。返すのは番号（コマ絵とフィールドエフェクトで通し番号）。 */
  play(def: EffectDef, at: { x: number; y: number; z: number }, options?: FieldFxOptions): number;
  /** 出している絵を動かす（飛ぶ物）。 */
  move(id: number, at: { x: number; y: number; z: number }): void;
  /** 消す。 */
  end(id: number): void;
  /** 全部消す（マップの読み直し）。 */
  clear(): void;
  /** 毎フレーム。コマを進め、カメラの正面へ向けて少し寄せる。 */
  update(dt: number, camera: Camera): void;
  dispose(): void;
}

export function createFieldFx(options: {
  /** 板を足す先（シーン）。 */
  parent: Object3D;
  unit: () => number;
  tilePx: () => number;
  scale: () => number;
}): FieldFx {
  const loader = new TextureLoader();
  const textures = new Map<string, Texture>();
  const materials = new Map<string, MeshBasicMaterial>();
  const list = new Map<number, Fx>();
  let next = 1;

  /** フィールドエフェクトの技の絵（GS-297）。出している物と、返された物（使い回す。シェーダと材質を作り直さない）。 */
  interface Burst {
    effects: FieldEffects;
    def: FieldEffectEntry;
    t: number;
    hold: boolean;
    /** 出した所（ワールド）。動かすときは入れ物ごとずらす（板を組み直さない）。 */
    base: Vector3;
  }
  const bursts = new Map<number, Burst>();
  const idle: FieldEffects[] = [];
  const weightKey = 'skill-fx';
  const playBurst = (def: FieldEffectEntry, at: { x: number; y: number; z: number }, how: FieldFxOptions): number => {
    const grow = (options.scale() || 1) * (how.scale && how.scale > 0 ? how.scale : 1);
    const volume = skillFieldVolume(def, { at, foot: how.foot ?? at.y }, grow);
    if (!volume) return 0;
    const unit = options.unit();
    const effects = idle.pop() ?? createFieldEffects();
    effects.setVolumes([volume], unit);
    effects.setClock(0);
    effects.setPresetWeights(new Map([[weightKey, 1]]));
    effects.setVisible(true);
    effects.group.position.set(0, 0, 0);
    const order = how.order ?? FX_RENDER_ORDER;
    // 入れ物（Group）の順は 0 のまま。three は Group の順を先に比べるので、ここへ入れると板の順と比べられなくなる。
    effects.group.renderOrder = 0;
    effects.group.traverse((child) => {
      if (how.layer !== undefined) child.layers.set(how.layer);
      else child.layers.set(0);
      // 板ごとの並び（元の 8 + i）は小さな差として残す。
      if (child !== effects.group) child.renderOrder = order + child.renderOrder * 0.001;
    });
    options.parent.add(effects.group);
    const id = next++;
    bursts.set(id, { effects, def, t: 0, hold: how.hold === true, base: new Vector3(at.x * unit, at.y * unit, at.z * unit) });
    return id;
  };
  const endBurst = (id: number) => {
    const burst = bursts.get(id);
    if (!burst) return;
    burst.effects.group.removeFromParent();
    burst.effects.setVolumes([], options.unit());
    idle.push(burst.effects);
    bursts.delete(id);
  };

  const materialOf = (image: string): MeshBasicMaterial => {
    let material = materials.get(image);
    if (material) return material;
    const texture = loader.load(sheetUrl(image));
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    textures.set(image, texture);
    material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
    });
    materials.set(image, material);
    return material;
  };

  const place = (fx: Fx, at: { x: number; y: number; z: number }) => {
    const unit = options.unit();
    fx.base.set(at.x * unit, at.y * unit, at.z * unit);
    fx.mesh.position.copy(fx.base);
  };
  const toCamera = new Vector3();

  /** コマ（UV）と大きさを当てる。 */
  const draw = (fx: Fx) => {
    const { def } = fx;
    const { frame, scale } = fieldFxFrame(def, fx.t);
    const rows = Math.max(1, def.rows ?? 1);
    const col = frame % def.columns;
    const row = Math.floor(frame / def.columns);
    const u0 = col / def.columns;
    const u1 = (col + 1) / def.columns;
    const v1 = 1 - row / rows;
    const v0 = 1 - (row + 1) / rows;
    const uv = fx.mesh.geometry.getAttribute('uv') as BufferAttribute;
    // PlaneGeometry の並びは 左上・右上・左下・右下。
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    fx.mesh.scale.set(def.frameWidth * fx.perPx * scale, def.frameHeight * fx.perPx * scale, 1);
  };

  const end = (id: number) => {
    if (bursts.has(id)) {
      endBurst(id);
      return;
    }
    const fx = list.get(id);
    if (!fx) return;
    fx.mesh.removeFromParent();
    fx.mesh.geometry.dispose();
    list.delete(id);
  };

  return {
    play(def, at, how = {}) {
      if (isFieldEffect(def)) return playBurst(def, at, how);
      const mesh = new Mesh(new PlaneGeometry(1, 1), materialOf(def.image));
      mesh.renderOrder = FX_RENDER_ORDER;
      mesh.frustumCulled = false;
      mesh.name = 'fieldFx';
      if (how.layer !== undefined) mesh.layers.set(how.layer);
      const fx: Fx = { mesh, def, t: 0, hold: how.hold === true, base: new Vector3(), perPx: 0 };
      place(fx, at);
      const grow = how.scale && how.scale > 0 ? how.scale : 1;
      fx.perPx = how.pixel
        ? worldPerPixel(how.pixel, fx.base) * grow
        : ((options.unit() * (options.scale() || 1)) / (options.tilePx() || 32)) * grow;
      draw(fx);
      options.parent.add(mesh);
      const id = next++;
      list.set(id, fx);
      return id;
    },
    move(id, at) {
      const burst = bursts.get(id);
      if (burst) {
        const unit = options.unit();
        burst.effects.group.position.set(at.x * unit - burst.base.x, at.y * unit - burst.base.y, at.z * unit - burst.base.z);
        return;
      }
      const fx = list.get(id);
      if (fx) place(fx, at);
    },
    end,
    clear() {
      for (const id of [...list.keys()]) end(id);
      for (const id of [...bursts.keys()]) endBurst(id);
    },
    update(dt, camera) {
      const eye = camera.getWorldPosition(new Vector3());
      const toward = TOWARD_CAMERA * options.unit();
      for (const [id, fx] of [...list]) {
        fx.t += dt * 1000;
        if (!fx.hold && fx.t >= fx.def.ms) {
          end(id);
          continue;
        }
        fx.mesh.quaternion.copy(camera.quaternion);
        toCamera.copy(eye).sub(fx.base);
        const far = toCamera.length();
        fx.mesh.position.copy(fx.base).addScaledVector(toCamera.normalize(), Math.min(toward, far * 0.5));
        draw(fx);
      }
      for (const [id, burst] of [...bursts]) {
        burst.t += dt * 1000;
        if (!burst.hold && burst.t >= burst.def.ms) {
          endBurst(id);
          continue;
        }
        burst.effects.setPresetWeights(new Map([[weightKey, burst.hold ? 1 : skillFieldWeight(burst.t, burst.def.ms)]]));
        burst.effects.update(dt);
      }
    },
    dispose() {
      this.clear();
      for (const effects of idle) effects.dispose();
      idle.length = 0;
      for (const material of materials.values()) material.dispose();
      for (const texture of textures.values()) texture.dispose();
      materials.clear();
      textures.clear();
    },
  };
}
