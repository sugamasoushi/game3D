'use client';

import { useEffect, useRef } from 'react';
import type { CameraIllustrationSample } from '../game/cameraCues';
import { illustrationImage } from '../game/illustrations';

/**
 * カメラ演出の画面イラスト。毎フレームの位置は一過性なのでReact stateへ入れず、
 * GameViewと同じ描画周期でこの層のimgだけを更新する。
 */
export function CameraIllustrationLayer({ probe }: { probe(): CameraIllustrationSample[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(new Map<string, HTMLImageElement>());

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const root = rootRef.current;
      if (!root) return;
      const active = new Set<string>();
      for (const sample of probe()) {
        active.add(sample.key);
        let image = nodesRef.current.get(sample.key);
        if (!image) {
          const src = illustrationImage(sample.asset);
          if (!src) continue;
          image = document.createElement('img');
          image.alt = '';
          image.draggable = false;
          image.src = src;
          root.append(image);
          nodesRef.current.set(sample.key, image);
        }
        image.style.left = `${sample.x}%`;
        image.style.top = `${sample.y}%`;
        image.style.height = `${sample.height}%`;
        image.style.opacity = String(sample.opacity);
        image.style.transform = `translate(-50%, -100%) translate(${sample.offsetX}vw, ${sample.offsetY}vh)`;
      }
      for (const [key, image] of nodesRef.current) {
        if (active.has(key)) continue;
        image.remove();
        nodesRef.current.delete(key);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      nodesRef.current.clear();
    };
  }, [probe]);

  return <div ref={rootRef} className="camera-illustrations" aria-hidden />;
}
