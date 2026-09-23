import {
  Box3,
  DataTexture,
  DepthFormat,
  DepthTexture,
  InstancedMesh,
  Matrix4,
  Mesh,
  LinearFilter,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  RepeatWrapping,
  TextureLoader,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type ShaderMaterial,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * 太陽の影（DEC-145）。太陽から見た正射深度を 1 枚焼き、受け側は世界座標で引くだけにする。
 * 面・ブロック・ビルボードを区別しないので、遮る形 × 受ける形の場合分けが要らない。
 */

/** 影テクスチャの一辺の上限。超えるときはテクセルを粗くする。 */
const MAX_SIZE = 4096;

/** 遮蔽体が枠から出ないための余白（テクセル）。 */
const MARGIN_TEXELS = 4;

/** 焼く相手が無いときに読む 1x1。どこも影にしない。 */
let emptySun: DepthTexture | null = null;

/** 雲を切っているときに挿す 1x1。サンプラを空のままにすると WebGL が警告を出す。 */
let emptyCloud: DataTexture | null = null;
function emptyCloudMap(): DataTexture {
  if (emptyCloud) return emptyCloud;
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  texture.needsUpdate = true;
  emptyCloud = texture;
  return texture;
}

function emptySunMap(): DepthTexture {
  if (emptySun) return emptySun;
  const texture = new DepthTexture(1, 1, UnsignedIntType);
  texture.format = DepthFormat;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  emptySun = texture;
  return texture;
}

export const SUN_SHADOW_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D mepSunMap;
uniform mat4 mepSunMatrix;    // ワールド → 影テクスチャ（xy=UV, z=深度。0..1）
uniform vec3 mepSunDir;       // 面から太陽へ。陰影の lightDir とは別（嘘影）
uniform float mepSunOn;
uniform float mepSunStrength;
uniform float mepSunBias;     // 深度の遊び（0..1）
uniform float mepSunOffset;   // 法線方向へずらす量（ワールド）
uniform float mepSunQuant;    // 影を刻む格子（ワールド）。既定は絵の 1 画素
uniform float mepSunBlur;     // 縁をぼかす半径（絵の画素）。0 でベタ塗り 1 段
uniform vec2 mepSunTexel;     // 1 テクセルの UV 幅（縦横で違う）

// 雲の影（DEC-218）。深度パスとは別で、世界の XZ に敷いたノイズ。
uniform sampler2D mepCloudMap;
uniform float mepCloudOn;
uniform float mepCloudAmount;  // 直射をどれだけ削るか（0..1）
uniform float mepCloudScale;   // 大きさ。小さいほど雲が大きい
uniform vec2 mepCloudDrift;    // 1 秒あたりの流れ（世界 UV）
uniform float mepCloudTime;
uniform vec2 mepCloudSlope;    // 光の傾き（dir.xz / dir.y）。高さのぶん模様をずらす
`;

export const SUN_SHADOW_GLSL = /* glsl */ `
/** 影の中なら 1、日向なら 0。ぼかさない。ドット絵はベタ塗りのほうが合う。 */
float mepSunShadow(vec3 worldPos, vec3 normal) {
  if (mepSunOn < 0.5) return 0.0;
  // 光に背を向けた面は陰影で既に暗い。ここで重ねると面 1 枚が自分を影にする。
  float facing = dot(normal, mepSunDir);
  if (facing <= 0.0) return 0.0;
  // 引く場所を**絵の画素の格子**へ寄せる。深度は太陽から見た斜めの格子なので、
  // そのまま引くと縁が斜めに刻まれてギザギザに見える。ここで世界の格子に揃える。
  vec3 at = worldPos;
  if (mepSunQuant > 0.0) {
    vec3 snapped = (floor(worldPos / mepSunQuant) + 0.5) * mepSunQuant;
    // 面から浮かせない。ずれのうち法線方向の分だけ戻す。
    at = snapped - normal * dot(snapped - worldPos, normal);
  }
  vec4 sun = mepSunMatrix * vec4(at + normal * mepSunOffset, 1.0);
  vec3 uvz = sun.xyz / sun.w;
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) return 0.0;
  float near = uvz.z - mepSunBias;
  if (mepSunBlur <= 0.0) return near > texture2D(mepSunMap, uvz.xy).r ? 1.0 : 0.0;
  // 4x4 の 16 タップ。**ぼかしではなく、影に入っているタップの数を数えている**。
  // 引く場所は画素の格子へ寄せてあるので、1 画素の中は 1 色のまま。
  // 半径を広げると濃さの段が隣の画素へ伸びる＝ドット絵のアンチエイリアスが太くなる。
  vec2 spread = mepSunTexel * mepSunBlur;
  float sum = 0.0;
  for (int y = 0; y < 4; y += 1) {
    for (int x = 0; x < 4; x += 1) {
      vec2 at2 = vec2(float(x) - 1.5, float(y) - 1.5) / 1.5 * spread;
      sum += near > texture2D(mepSunMap, uvz.xy + at2).r ? 1.0 : 0.0;
    }
  }
  return sum / 16.0;
}

/**
 * 雲の影（DEC-218）。**形は落とす側を持たない**——世界の XZ に敷いた模様をそのまま影とみなす。
 * 深度パスと違って落とす物が要らないので、空に雲を置かなくても影だけ流せる。
 * 戻り値は「直射をどれだけ削るか」（0..1）。面の向きは見ない。呼ぶ側が直射に掛ける。
 */
float mepCloudShadow(vec3 worldPos) {
  if (mepCloudOn < 0.5) return 0.0;
  // 雲は頭上の一枚の膜。そこから**光の向きに**落ちてくる（DEC-262）。
  // 高さ y の点が拾うのは、光へ y / dir.y だけ進んだ先の模様。定数項は模様が
  // ずれるだけなので落とす。XZ だけで引くと、壁では高さが変わっても同じ所を
  // 拾い続ける——それが縦縞の正体だった。
  vec2 at = (worldPos.xz - worldPos.y * mepCloudSlope) * mepCloudScale;
  vec2 flow = mepCloudDrift * mepCloudTime;
  // 2 枚を別の速さで重ねる。1 枚だと模様の繰り返しが見える。
  float a = texture2D(mepCloudMap, at + flow).r;
  float b = texture2D(mepCloudMap, at * 0.53 - flow * 0.37).r;
  // 高いところで切って塊にする。薄くかけると曇りに見えて雲影にならない。
  return smoothstep(0.52, 0.80, a * 0.65 + b * 0.55) * mepCloudAmount;
}
`;

export interface SunShadowUniforms {
  mepSunMap: { value: Texture };
  mepSunMatrix: { value: Matrix4 };
  mepSunDir: { value: Vector3 };
  mepSunOn: { value: number };
  mepSunStrength: { value: number };
  mepSunBias: { value: number };
  mepSunOffset: { value: number };
  mepSunQuant: { value: number };
  mepSunBlur: { value: number };
  mepSunTexel: { value: Vector2 };
  mepCloudMap: { value: Texture };
  mepCloudOn: { value: number };
  mepCloudAmount: { value: number };
  mepCloudScale: { value: number };
  mepCloudDrift: { value: Vector2 };
  mepCloudTime: { value: number };
  mepCloudSlope: { value: Vector2 };
}

/** タイルとキャラで同じ形。既定はオフなので、渡さなければ従来どおり。 */
export function createSunShadowUniforms(): SunShadowUniforms {
  return {
    mepSunMap: { value: emptySunMap() },
    mepSunMatrix: { value: new Matrix4() },
    mepSunDir: { value: new Vector3(0, 1, 0) },
    mepSunOn: { value: 0 },
    mepSunStrength: { value: 1 },
    mepSunBias: { value: 0 },
    mepSunOffset: { value: 0 },
    mepSunQuant: { value: 0 },
    mepSunBlur: { value: 0.5 },
    mepSunTexel: { value: new Vector2() },
    mepCloudMap: { value: emptyCloudMap() },
    mepCloudOn: { value: 0 },
    mepCloudAmount: { value: 0 },
    mepCloudScale: { value: 0.02 },
    mepCloudDrift: { value: new Vector2() },
    mepCloudTime: { value: 0 },
    mepCloudSlope: { value: new Vector2() },
  };
}

/** 雲の影の設定（DEC-218）。 */
export interface CloudShadow {
  on: boolean;
  /** どれだけ削るか（0..2）。1 までは直射、1 超えは環境光も（DEC-220）。 */
  amount: number;
  /** 大きさ。小さいほど雲が大きい。 */
  scale: number;
  /** 流れる速さ（1 秒あたりの世界 UV）。 */
  speed: number;
  /**
   * 光の傾き `dir.xz / dir.y`（DEC-262）。雲の膜から光の向きに影を落とすための量。
   * 省略すると真下＝壁で縦縞になる。
   */
  slope?: [number, number];
}

/** 雲の模様。霧と同じものを使い回す（読み込みは 1 回）。 */
const CLOUD_NOISE = '/assets/noise/Super Perlin/Super Perlin 14 - 512x512.png';

/**
 * 雲の模様（DEC-274）。**組み直しをまたいで使い回す。入にするまで読み込まない。**
 * `TextureLoader.load` は非同期なので、シーンを組むたびに作り直すと、絵が届くまでの
 * 数フレームだけ模様が空になり、**雲の影が画面ごとちらつく**。
 * エディタはチップを 1 個置くたびにシーンを組み直すので、置くたびに光る。
 * 中身の変わらない 1 枚なので、ここで持ち回して捨てない。
 */
let sharedCloud: Texture | null = null;
function cloudNoise(): Texture {
  if (!sharedCloud) {
    const texture = new TextureLoader().load(CLOUD_NOISE);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    sharedCloud = texture;
  }
  return sharedCloud;
}

/** 焼く相手。動く物は枠の計算に入れない（DEC-155）。 */
export interface SunBakeRoot {
  object: Object3D;
  /**
   * 枠（正射カメラの範囲）の計算に入れるか。
   * **動く物を入れてはいけない。** 枠が動くとテクセルの格子ごとずれて、
   * マップ中の影が一斉に揺れる。
   */
  fit: boolean;
  /**
   * これが 1 枚も出せないフレームは**焼かない**（DEC-288）。マップに立てる。
   * 組み直しの途中はマップのメッシュが一瞬すべて非表示になる。そこで焼くと、
   * 枠が残りの遮蔽体（外部モデルなど）だけに縮み、マップ全体が影に沈む。
   */
  required?: boolean;
}

export interface SunBakeOptions {
  /** 面から太陽へ向かう単位ベクトル。 */
  direction: Vector3;
  /**
   * 影の向きだけ方位を 90 度の倍数へ丸める（DEC-145 の嘘影）。
   * 深度の格子が世界の格子と平行になるので、硬い縁でも段が規則正しく出る。
   * 面の明暗（`lightDir`）は丸めないので、光の見え方は変わらない。
   */
  snapAxis?: boolean;
  /** ワールド 1 マスの大きさ。 */
  unit: number;
  /**
   * 絵の 1 画素のワールド幅（`unit / tilePx`）。テクセルの目標値。
   * 影の縁をここへ載せるので、チップの画素と同じ刻みで階段になる。
   */
  artPixel: number;
  /**
   * 枠を計算し直すか（DEC-155）。マップか太陽が変わったときだけ true。
   * 動く遮蔽体が動いただけのときは false にして、枠と格子を据え置く。
   */
  refit?: boolean;
}

export interface SunShadow {
  /** 焼いた深度。受け側の uniform へ渡す。 */
  readonly texture: Texture;
  /** ワールド → 影テクスチャ。 */
  readonly matrix: Matrix4;
  /** 面から太陽へ向かう単位ベクトル。焼いた向き。 */
  readonly direction: Vector3;
  /** 焼けているか。遮蔽体が無ければ false。 */
  readonly ready: boolean;
  /**
   * 深度を焼く。`roots` の下の Mesh だけを、`depthFor` が返したマテリアルで描く。
   * 返さなかった Mesh は焼かない（旧方式の影メッシュや補助線を混ぜないため）。
   * `roots` にはマップのほかにキャラなど動く遮蔽体も渡せる（DEC-154）。
   */
  bake(
    renderer: WebGLRenderer,
    roots: SunBakeRoot[],
    options: SunBakeOptions,
    depthFor: (material: ShaderMaterial) => ShaderMaterial | null,
  ): boolean;
  /**
   * 縁をぼかす半径（絵の画素）。0 はベタ塗り 1 段。
   * 0.5 で 1 画素ぶんのアンチエイリアス、大きくすると段が隣の画素へ伸びる。
   */
  setBlur(radius: number): void;
  /** マテリアルへ現在の深度・行列・向きを書く。 */
  apply(material: ShaderMaterial, on: boolean, strength: number): void;
  /**
   * 雲の影の設定（DEC-218）。深度パスとは無関係で、模様を流すだけ。
   * `on` を切ると 1x1 のダミーに差し替えるので、テクスチャも読まない。
   */
  setCloud(look: CloudShadow): void;
  dispose(): void;
}

/**
 * 水平成分を近いほうの軸へ倒す。仰角と長さは変えない。
 * キャラの影（DEC-393）も同じ向きで落とすので外へ出す。
 */
export function snapAzimuth(direction: Vector3): void {
  const flat = Math.hypot(direction.x, direction.z);
  if (flat < 1e-6) return;
  if (Math.abs(direction.x) >= Math.abs(direction.z)) {
    direction.x = Math.sign(direction.x) * flat;
    direction.z = 0;
  } else {
    direction.x = 0;
    direction.z = Math.sign(direction.z) * flat;
  }
}

/** 太陽の影 1 枚。マップか太陽が変わったときだけ焼き直す。 */
export function createSunShadow(): SunShadow {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  let cloud: CloudShadow = { on: false, amount: 0, scale: 0.02, speed: 0.01 };
  const cloudMap = cloudNoise;
  const matrix = new Matrix4();
  const direction = new Vector3(0, 1, 0);
  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const bounds = new Box3();
  const corner = new Vector3();
  const swapped: Array<{ mesh: Mesh; material: ShaderMaterial | ShaderMaterial[] }> = [];
  const hidden: Object3D[] = [];

  let target: WebGLRenderTarget | null = null;
  let depth: DepthTexture | null = null;
  /** 床の上で 1 テクセルが占めるワールド幅。縦横とも同じにする（DEC-145）。 */
  let groundStep = 1;
  let mapWidth = 0;
  let mapHeight = 0;
  let blur = 0.5;
  let ready = false;
  /** 一度でも枠を組めたか。組めていなければ `refit` に関わらず組む。 */
  let fitted = false;
  let depthBias = 0;
  let normalOffset = 0;

  const resize = (width: number, height: number) => {
    if (target && target.width === width && target.height === height) return;
    target?.dispose();
    const next = new WebGLRenderTarget(width, height);
    const map = new DepthTexture(width, height, UnsignedIntType);
    map.format = DepthFormat;
    map.minFilter = NearestFilter;
    map.magFilter = NearestFilter;
    map.generateMipmaps = false;
    next.depthTexture = map;
    next.texture.generateMipmaps = false;
    target = next;
    depth = map;
  };

  /** 遮蔽体の AABB を光の座標系で囲む。テクセルは絵の画素の刻みに合わせる。 */
  const fit = (unit: number, artPixel: number): boolean => {
    if (bounds.isEmpty()) return false;
    const forward = direction.clone().negate();
    if (forward.lengthSq() < 1e-8) forward.set(0, -1, 0);
    forward.normalize();
    const up = Math.abs(forward.y) > 0.999 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);

    const center = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() * 0.5 + unit;
    camera.position.copy(center).addScaledVector(forward, -radius);
    camera.up.copy(up);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minDepth = Infinity;
    let maxDepth = 0;
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      );
      corner.applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
      minDepth = Math.min(minDepth, -corner.z);
      maxDepth = Math.max(maxDepth, -corner.z);
    }

    // 刻みは絵の 1 画素（DEC-145）。
    // 光の座標系の X はいつも水平なので、そのまま 1 画素で置ける。
    // Y は床へ落ちるとき `1 / sin(仰角)` に伸びるので、**先に sin をかけて縮めておく**。
    // こうすると床に落ちる格子が縦横とも 1 画素の正方形になり、段の長さが揃う。
    const pixel = artPixel > 0 ? artPixel : unit / 32;
    const rise = Math.max(Math.abs(direction.y), 0.05);
    let scale = 1;
    let width = 0;
    let height = 0;
    for (let guard = 0; guard < 8; guard += 1) {
      const stepX = pixel * scale;
      const stepY = pixel * rise * scale;
      width = Math.ceil((maxX - minX) / stepX) + MARGIN_TEXELS * 2;
      height = Math.ceil((maxY - minY) / stepY) + MARGIN_TEXELS * 2;
      if (width <= MAX_SIZE && height <= MAX_SIZE) break;
      scale *= 2;
    }
    const texelX = pixel * scale;
    const texelY = pixel * rise * scale;
    width = Math.min(Math.max(width, 64), MAX_SIZE);
    height = Math.min(Math.max(height, 64), MAX_SIZE);
    groundStep = texelX;

    // 枠の原点をテクセルの倍数へ落とす。カメラを動かしても影が這わない。
    const left = Math.floor((minX - texelX * MARGIN_TEXELS) / texelX) * texelX;
    const bottom = Math.floor((minY - texelY * MARGIN_TEXELS) / texelY) * texelY;
    camera.left = left;
    camera.right = left + width * texelX;
    camera.bottom = bottom;
    camera.top = bottom + height * texelY;
    camera.near = Math.max(minDepth - unit, 0.01);
    camera.far = maxDepth + unit;
    camera.updateProjectionMatrix();

    // 正射なので深度は near..far の線形。床のテクセル 1 つぶんを遊びに取る。
    const range = Math.max(camera.far - camera.near, 0.001);
    depthBias = (texelX * 1.5) / range;
    normalOffset = texelX * 1.5;

    mapWidth = width;
    mapHeight = height;
    resize(width, height);
    matrix.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    return true;
  };

  return {
    get texture() {
      return depth && ready ? depth : emptySunMap();
    },
    matrix,
    direction,
    get ready() {
      return ready;
    },

    bake(renderer, roots, options, depthFor) {
      ready = false;
      const { unit, artPixel } = options;
      direction.copy(options.direction);
      if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
      direction.normalize();
      if (options.snapAxis) snapAzimuth(direction);

      // 深度を書く相手だけ集める。返らなかった Mesh は焼かない。
      const refit = options.refit !== false || !fitted;
      if (refit) bounds.makeEmpty();
      swapped.length = 0;
      hidden.length = 0;
      /** `required` の根から出せた枚数。0 なら焼かずに次のフレームへ回す。 */
      let needed = 0;
      let wanted = 0;
      for (const root of roots) {
        if (root.required) wanted += 1;
        root.object.updateMatrixWorld(true);
        root.object.traverseVisible((object) => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const depth = depthFor(source as ShaderMaterial);
          if (!depth) {
            hidden.push(mesh);
            return;
          }
          swapped.push({ mesh, material: mesh.material as ShaderMaterial | ShaderMaterial[] });
          if (root.required) needed += 1;
          mesh.material = depth;
          if (!refit || !root.fit) return;
          const instanced = mesh as InstancedMesh;
          if (instanced.isInstancedMesh) instanced.computeBoundingBox();
          else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const box = (instanced.isInstancedMesh ? instanced.boundingBox : mesh.geometry.boundingBox)?.clone();
          if (box) bounds.union(box.applyMatrix4(mesh.matrixWorld));
        });
      }

      // マップが 1 枚も出ないフレームは焼かない（DEC-288）。呼び元が次のフレームで焼き直す。
      if (wanted > 0 && needed === 0) {
        for (const entry of swapped) entry.mesh.material = entry.material;
        swapped.length = 0;
        hidden.length = 0;
        return false;
      }
      for (const mesh of hidden) mesh.visible = false;
      if (swapped.length > 0 && (!refit || fit(unit, artPixel))) fitted = true;
      if (fitted && target) {
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        renderer.clear(true, true, true);
        // 2 つ目からは消さずに描き足す。キャラはマップと同じ深度へ入る。
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        for (const root of roots) renderer.render(root.object, camera);
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(previous);
        ready = true;
      }
      for (const mesh of hidden) mesh.visible = true;
      for (const entry of swapped) entry.mesh.material = entry.material;
      swapped.length = 0;
      hidden.length = 0;
      return true;
    },

    setBlur(radius) {
      blur = Math.max(0, radius);
    },

    setCloud(look) {
      cloud = { ...look };
    },

    apply(material, on, strength) {
      const uniforms = material.uniforms as unknown as SunShadowUniforms;
      if (!uniforms?.mepSunMap) return;
      const live = on && ready && depth !== null;
      uniforms.mepSunMap.value = live && depth ? depth : emptySunMap();
      uniforms.mepSunMatrix.value.copy(matrix);
      uniforms.mepSunDir.value.copy(direction);
      uniforms.mepSunOn.value = live ? 1 : 0;
      // 2 まで通す（DEC-220）。1 を超えたぶんは呼ぶ側が環境光から引く。
      uniforms.mepSunStrength.value = Math.min(Math.max(strength, 0), 2);
      uniforms.mepSunBias.value = depthBias;
      uniforms.mepSunOffset.value = normalOffset;
      // 刻みは床のテクセルと同じ大きさ。深度で解けない細かさに刻んでも縁が暴れるだけ。
      uniforms.mepSunQuant.value = live ? groundStep : 0;
      uniforms.mepSunBlur.value = live ? blur : 0;
      uniforms.mepSunTexel.value.set(mapWidth > 0 ? 1 / mapWidth : 0, mapHeight > 0 ? 1 / mapHeight : 0);
      // 雲の影は深度と無関係（DEC-218）。切っていればダミーを挿して読ませない。
      uniforms.mepCloudMap.value = cloud.on ? cloudMap() : emptyCloudMap();
      uniforms.mepCloudOn.value = cloud.on ? 1 : 0;
      // 太陽の影と同じ 0..2（DEC-220）。1 を超えたぶんは呼ぶ側が環境光から引く。
      uniforms.mepCloudAmount.value = Math.min(Math.max(cloud.amount, 0), 2);
      uniforms.mepCloudScale.value = Math.max(0.0005, cloud.scale);
      // 北東へ流す。1 方向だと縞に見えるので、少しだけ斜めにする。
      uniforms.mepCloudDrift.value.set(cloud.speed, cloud.speed * 0.37);
      // 光の傾き（DEC-262）。無ければ真下＝これまでの動き。
      uniforms.mepCloudSlope.value.set(cloud.slope?.[0] ?? 0, cloud.slope?.[1] ?? 0);
    },

    dispose() {
      target?.dispose();
      target = null;
      depth = null;
      ready = false;
      fitted = false;
    },
  };
}
