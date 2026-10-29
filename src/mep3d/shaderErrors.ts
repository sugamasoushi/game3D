// シェーダが組めなかったときの知らせ（2026-10-29）。ゲームとマップエディタで共通。
//
// 組めなかった材質の物は**丸ごと描かれず**、three はコンソールに出すだけで動き続ける。
// Electron 版（D3D11）で揺らす木と草が消えたとき、ブラウザでは出ていたので気づけなかった。
// 開発中は画面の隅にも出して、見落とさないようにする。

import type { WebGLRenderer } from 'three';

/** 組めなかった 1 件。 */
export interface ShaderFailure {
  /** 材質の見分け。シェーダの `#define`（`MEP_WALL` など）と `SHADER_NAME`。 */
  label: string;
  /** リンクとコンパイルの言い分。 */
  log: string;
}

/** シェーダのソースから材質の見分けを作る（`MEP_*` の印と three の `SHADER_NAME`）。 */
export function shaderLabel(source: string): string {
  const marks = [...source.matchAll(/^#define (MEP_\w+)/gm)].map((match) => match[1]);
  const name = /^#define SHADER_NAME (.+)$/m.exec(source)?.[1]?.trim() ?? '';
  return [name, ...marks].filter(Boolean).join(' ') || '(名前なし)';
}

const BANNER_ID = 'mep3d-shader-errors';

/** 画面の左上に出す。同じ言い分は 1 回だけ。 */
function showBanner(failure: ShaderFailure): void {
  if (typeof document === 'undefined') return;
  let banner = document.getElementById(BANNER_ID);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    Object.assign(banner.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      zIndex: '2147483647',
      maxWidth: 'min(640px, calc(100vw - 16px))',
      padding: '8px 10px',
      background: 'rgba(160, 20, 20, 0.92)',
      color: '#fff',
      font: '12px/1.5 monospace',
      whiteSpace: 'pre-wrap',
      borderRadius: '4px',
      pointerEvents: 'auto',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    banner.title = 'クリックで閉じる';
    banner.addEventListener('click', () => banner?.remove());
    banner.textContent = 'シェーダを組めません（その材質の物は描かれていません。詳しくはコンソール）';
    document.body.appendChild(banner);
  }
  const line = `\n・${failure.label}: ${failure.log.split('\n')[0]}`;
  if (!banner.textContent?.includes(line)) banner.textContent += line;
}

/**
 * シェーダが組めなかったら知らせる。`banner` が真なら画面にも出す（ゲームは開発中だけ）。
 * three の既定の出力（コンソール）の代わりになるので、コンソールにも同じだけ出す。
 */
export function watchShaderErrors(renderer: WebGLRenderer, options: { banner: boolean; onFailure?: (failure: ShaderFailure) => void }): void {
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const source = gl.getShaderSource(vertexShader) ?? '';
    const log = [
      gl.getProgramInfoLog(program),
      gl.getShaderInfoLog(vertexShader),
      gl.getShaderInfoLog(fragmentShader),
    ]
      .map((text) => (text ?? '').replace(/\0/g, '').trim())
      .filter(Boolean)
      .join('\n');
    const failure: ShaderFailure = { label: shaderLabel(source), log: log || '(言い分なし)' };
    console.error(`[mep3d] シェーダを組めません: ${failure.label}\n${failure.log}`);
    if (options.banner) showBanner(failure);
    options.onFailure?.(failure);
  };
}
