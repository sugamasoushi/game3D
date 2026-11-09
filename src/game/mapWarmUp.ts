/**
 * マップを見せる前の下ごしらえ（2026-11-09）。**暗転のうちに、描くのに要る重い仕事を済ませておく。**
 *
 * 読み込み（`load`）は絵・形・人を揃えて終わるが、three.js は
 * - 形の描き方（シェーダ）を**初めて画面に入ったとき**に組み立て、
 * - 絵を**初めて描くとき**に GPU へ送る。
 * そのままだと暗転が明けたあとに歩き出すたびに数フレーム固まり、そのあいだは 100ms ごとの見張り
 * （踏んだ場所・敵シンボルの接触）も止まるので、マップに入った直後の接触が遅れて見えた。
 *
 * ここでは画面の外にある物も含めてまとめて組み立て・送り（`warmUpScene`）、
 * そのあと 1 フレームの重さが落ち着くまで待ってから明ける（`createSettleWatch`）。
 */
import type { Camera, Material, Object3D, Scene, Texture, WebGLRenderer } from 'three';

/** 落ち着いたとみなす 1 フレームの重さ（ミリ秒）。60fps の 2 フレームぶん。 */
export const SETTLE_STEP_MS = 34;
/** 続けて軽いフレームがこれだけ来たら落ち着いた。 */
export const SETTLE_FRAMES = 3;
/** 待つのはここまで（ミリ秒）。重い端末でも明けないままにはしない。 */
export const SETTLE_MAX_MS = 1500;
/** シェーダの組み立てを待つのはここまで（ミリ秒）。 */
export const COMPILE_MAX_MS = 3000;

/**
 * 1 フレームずつ重さを渡し、「続けて `frames` 回軽かった」か「`maxMs` 過ぎた」で true を返す見張り。
 * 重いフレームが来たら数え直す。時刻は渡す（テストで決められるように）。
 */
export const createSettleWatch = (
  startMs: number,
  { stepMs = SETTLE_STEP_MS, frames = SETTLE_FRAMES, maxMs = SETTLE_MAX_MS } = {},
) => {
  let light = 0;
  return {
    /** フレームを 1 枚描き終えたところで呼ぶ。`spentMs` はそのフレームにかかった時間、`nowMs` はいまの時刻。 */
    push(spentMs: number, nowMs: number): boolean {
      light = spentMs < stepMs ? light + 1 : 0;
      return light >= frames || nowMs - startMs >= maxMs;
    },
    /** 時間切れだけを見る（フレームが来ないとき。隠れたタブなど）。 */
    timedOut(nowMs: number): boolean {
      return nowMs - startMs >= maxMs;
    },
  };
};

/** GPU へ送ってよい絵か。描画用の受け皿（レンダーターゲット）と、まだ中身の無い絵は送らない。 */
export const uploadable = (texture: Pick<Texture, 'image'> & { isRenderTargetTexture?: boolean }): boolean => {
  if (texture.isRenderTargetTexture) return false;
  const image = texture.image as { complete?: boolean; width?: number; data?: unknown } | null | undefined;
  if (!image) return false;
  // <img> は読み終えているものだけ。ImageBitmap・canvas・データの絵は中身があれば送れる。
  if (image.complete === false) return false;
  return !!(image.width || image.data);
};

const isTexture = (value: unknown): value is Texture => !!value && (value as Texture).isTexture === true;

/** 材質が持つ絵を集める（`map` などの欄と、自前のシェーダの uniforms）。 */
const texturesOf = (material: Material, into: Set<Texture>) => {
  for (const value of Object.values(material)) if (isTexture(value)) into.add(value);
  const uniforms = (material as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    const value = uniform?.value;
    if (isTexture(value)) into.add(value);
    else if (Array.isArray(value)) for (const one of value) if (isTexture(one)) into.add(one);
  }
};

/**
 * 場面の形を全部組み立て、絵を全部 GPU へ送る。**画面の外の物も**（歩いて初めて見える物で固まらないように）。
 * 見えない（`visible = false`）物は飛ばす——出したときに組む。失敗しても読み込みは止めない。
 */
export const warmUpScene = async (renderer: WebGLRenderer, scene: Scene, camera: Camera): Promise<void> => {
  const textures = new Set<Texture>();
  scene.traverseVisible((object: Object3D) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material;
    if (!material) return;
    for (const one of Array.isArray(material) ? material : [material]) texturesOf(one, textures);
  });
  for (const texture of textures) {
    if (!uploadable(texture)) continue;
    try {
      renderer.initTexture(texture);
    } catch {
      // 送れない絵は最初に描くときに任せる。
    }
  }
  try {
    await Promise.race([
      renderer.compileAsync(scene, camera),
      new Promise<void>((done) => window.setTimeout(done, COMPILE_MAX_MS)),
    ]);
  } catch {
    // 組み立てに失敗しても、最初に描くときにもう一度組む。
  }
};
