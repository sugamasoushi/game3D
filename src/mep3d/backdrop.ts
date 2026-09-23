import {
  BackSide,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MirroredRepeatWrapping,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three';
import { skyUrl } from './camera';
import type { BackdropDef } from './types';

/**
 * 背景の絵（DEC-274）。**組み直しをまたいで使い回す。**
 * 中身の変わらない画像なので、URL で憶えて持ち回す。捨てない。
 */
const skyCache = new Map<string, Texture>();

/**
 * 背景の書き割り（DEC-148）。マップの北端に立てる縦板 1 枚。
 * 無限遠のパノラマ（`CameraFxDef.sky`）と違い**世界に置く板**で、カメラが動けば一緒に流れる。
 * 光は受けない。絵をそのまま出す。
 */

export interface Backdrop {
  mesh: Mesh;
  /** 定義を差し替える。絵が同じなら読み直さない。 */
  update(def: BackdropDef | undefined, widthCells: number, depthCells: number, unit: number): void;
  /** 今出している絵（DEC-316）。「うねり」が環境として引く。読み込み前は null。 */
  texture(): Texture | null;
  dispose(): void;
}

/** マップの北端に立てる。幅はマップの東西いっぱい。 */
/**
 * 背景の板のマテリアル（DEC-277）。中身は絵と明るさだけなのでモジュールで持ち回す。
 * シーンごとに作って捨てると、組み直しのたびにプログラムのリンクが 1 本増える。
 * 背景は同時に 1 枚しか映らないので、共有して困らない。
 */
let sharedMaterial: MeshBasicMaterial | null = null;

type BackdropShape = NonNullable<BackdropDef['shape']>;

/**
 * 囲む球（DEC-313）。**絵の貼り方は筒と同じにする。**
 *
 * 素の `SphereGeometry` の縦 UV は**緯度に比例**するので、横長の空の絵を貼ると
 * 地平線の近くが潰れて上へ伸びる——筒と並べたときに絵が変わって見える。
 * 縦 UV を **y に比例**させ直すと、赤道のまわりは筒とまったく同じ見えになり、
 * 天頂へ近づくぶんだけ絵が縮む（円筒図法を球へ巻いたのと同じ）。
 *
 * `v = y * 2` なので **赤道が絵の下端・北極が上端**。南半球は v が負になり、
 * 縦は `ClampToEdgeWrapping` なので**絵の一番下の行がそのまま伸びる**。
 * 地平線より下は空の絵の下端色で埋まる。
 */
function domeGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(0.5, 64, 48);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, position.getY(i) * 2);
  uv.needsUpdate = true;
  return geometry;
}

export function createBackdrop(): Backdrop {
  const material = (sharedMaterial ??= new MeshBasicMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: true,
    toneMapped: false,
    color: new Color(1, 1, 1),
  }));
  const mesh: Mesh<BufferGeometry, MeshBasicMaterial> = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.name = 'backdrop';
  mesh.visible = false;
  // 背景なので一番先に描く。手前のタイルが上書きする。
  mesh.renderOrder = -2;

  const loader = new TextureLoader();
  let texture: Texture | null = null;
  /** 読み終わった絵。読み込み中は入れない（入れると古い絵のまま居座る）。 */
  let loadedSrc = '';
  /** 読み込み中の絵。同じものを何度も取りに行かないため。 */
  let pendingSrc = '';
  let gen = 0;
  /** 最後に渡された指定。絵が届いたときはこれで組む。 */
  let last: { def: BackdropDef; widthCells: number; depthCells: number; unit: number } | null = null;
  let shape: BackdropShape = 'plane';

  /** 板・筒・球でジオメトリを入れ替える。筒と球は内側から見るので裏面だけ描く。 */
  const setShape = (next: BackdropShape) => {
    if (next === shape) return;
    mesh.geometry.dispose();
    // 半径 0.5・高さ 1 で作り、scale で実寸にする。板と同じ扱いにできる。
    mesh.geometry =
      next === 'cylinder'
        ? new CylinderGeometry(0.5, 0.5, 1, 64, 1, true)
        : next === 'sphere'
          ? domeGeometry()
          : new PlaneGeometry(1, 1);
    material.side = next === 'plane' ? DoubleSide : BackSide;
    material.needsUpdate = true;
    shape = next;
  };

  /**
   * 板はマップ幅いっぱい。`tile` があれば絵だけ横に並べる。
   * 高さの指定が無ければ、絵 1 枚ぶんの幅と縦横比から出す。
   */
  const layout = (def: BackdropDef, widthCells: number, depthCells: number, unit: number) => {
    setShape(def.shape === 'cylinder' || def.shape === 'sphere' ? def.shape : 'plane');
    const wide = Math.max(1, widthCells);
    const deep = Math.max(1, depthCells);
    const image = texture?.image as { width?: number; height?: number } | undefined;
    const ratio = image?.width && image?.height ? image.height / image.width : 0.5;
    const count = Math.max(1, Math.round(def.count ?? 1));
    // 絵 1 枚が世界で何メートルになるか。高さの自動計算はこれを基準にする（引き伸ばさない）。
    const round = shape === 'cylinder' || shape === 'sphere';
    const span = round
      ? (Math.PI * (Math.hypot(wide, deep) + (def.offset ?? 0) * 2) * unit) / count
      : (wide * unit) / count;
    if (texture) {
      // 1 枚おきに反転して継ぎ目を消す（DEC-149）。反転しないと絵の左端と右端が接する。
      texture.wrapS = def.mirror === false ? RepeatWrapping : MirroredRepeatWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.repeat.set(count, 1);
      texture.needsUpdate = true;
    }
    const height = (def.height && def.height > 0 ? def.height * unit : span * ratio) || unit;
    const bottom = (def.y ?? 0) * unit;
    /*
     * 世界の Y 軸まわりに回す（DEC-330）。**原点を軸にする。**
     * 筒と球は原点に据えてあるので向きを変えるだけ。板は原点から離れて立っているので、
     * 位置も同じだけ回してマップの周りを回り込ませる。
     */
    const spin = (((def.spin ?? 0) % 360) * Math.PI) / 180;
    mesh.rotation.y = spin;
    if (round) {
      // マップの角まで入る半径。マップは原点中心なので位置は中央のまま。
      const radius = (Math.hypot(wide, deep) / 2 + (def.offset ?? 0)) * unit;
      if (shape === 'sphere') {
        /*
         * **赤道を「下端」に合わせる**（DEC-313）。筒は下端から高さぶん**上へ**壁が立つので、
         * 球も赤道から `height` だけ上が絵になるように縦半径を `height` にする。
         * 下半球は同じだけ下へ回り込み、**天も地も閉じる**——筒は上が開いていて、
         * 見上げると何も無かった。
         */
        mesh.scale.set(radius * 2, height * 2, radius * 2);
        mesh.position.set(0, bottom, 0);
        return;
      }
      mesh.scale.set(radius * 2, height, radius * 2);
      mesh.position.set(0, bottom + height / 2, 0);
      return;
    }
    const north = -(deep / 2) * unit - (def.offset ?? 0) * unit;
    mesh.scale.set(wide * unit, height, 1);
    // 板は (0, y, north) に立つ。回すぶんだけ原点まわりに位置も持っていく。
    mesh.position.set(north * Math.sin(spin), bottom + height / 2, north * Math.cos(spin));
  };

  return {
    mesh,

    texture() {
      return mesh.visible ? texture : null;
    },

    update(def, widthCells, depthCells, unit) {
      const src = def?.src ?? '';
      if (!src || !def) {
        gen += 1;
        loadedSrc = '';
        pendingSrc = '';
        last = null;
        mesh.visible = false;
        return;
      }
      last = { def, widthCells, depthCells, unit };
      material.color.setScalar(Math.max(0, def.gain ?? 1));
      if (src === loadedSrc && texture) {
        layout(def, widthCells, depthCells, unit);
        mesh.visible = true;
        return;
      }
      const url = skyUrl(src);
      // **一度読んだ絵は持ち回す（DEC-274）。**読み込みは非同期なので、シーンを
      // 組むたびに取り直すと、届くまで `mesh.visible = false` で**背景が消える**。
      // エディタはチップを 1 個置くたびに組み直すので、置くたびに空がちらつく。
      const cached = skyCache.get(url);
      if (cached) {
        gen += 1;
        texture = cached;
        material.map = cached;
        material.needsUpdate = true;
        loadedSrc = src;
        pendingSrc = '';
        layout(def, widthCells, depthCells, unit);
        mesh.visible = true;
        return;
      }
      // 同じ絵を取りに行っている最中なら待つ。届いたら `last` で組み直す。
      if (src === pendingSrc) return;
      const mine = (gen += 1);
      pendingSrc = src;
      mesh.visible = false;
      void loader
        .loadAsync(url)
        .then((next) => {
          next.colorSpace = SRGBColorSpace;
          next.magFilter = NearestFilter;
          next.minFilter = NearestFilter;
          next.generateMipmaps = false;
          next.needsUpdate = true;
          // 取り込みが競ったときは先に入ったほうを使い、余りだけ捨てる。
          const shared = skyCache.get(url);
          if (shared) next.dispose();
          else skyCache.set(url, next);
          const use = shared ?? next;
          if (mine !== gen) return;
          texture = use;
          material.map = use;
          material.needsUpdate = true;
          loadedSrc = src;
          pendingSrc = '';
          if (last) layout(last.def, last.widthCells, last.depthCells, last.unit);
          mesh.visible = true;
        })
        .catch(() => {
          if (mine !== gen) return;
          pendingSrc = '';
          mesh.visible = false;
        });
    },

    dispose() {
      gen += 1;
      mesh.geometry.dispose();
      // マテリアルと絵はモジュールの持ち物（DEC-274 / DEC-277）。ここでは捨てない。
      texture = null;
    },
  };
}
