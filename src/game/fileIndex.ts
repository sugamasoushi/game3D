// 置いてある物の台帳（GS-26 / DEC-374）。**探して確かめない。**
//
// 「この絵の法線マップは在るか」「このマップにイベントは在るか」を、
// 取りに行って 404 かどうかで判断していた。**Next の開発サーバは 404 に HTML を組み立てて返す**ので
// 1 本 100〜500ms かかり、マップ 1 枚の組み立てが 32 秒になっていた。
// 台帳を 1 枚配れば、無駄な要求は 0 本になる（本番の配信でも同じだけ減る）。
//
// 台帳は `npm run index:files` で作る。**ファイルを足したら回すこと。**

import { assetUrl } from './assets';

interface FileList {
  /** 在る法線マップ（`public/` からの相対）。 */
  normals: string[];
  /** イベント JSON が在るマップ名（`0101_home` のように拡張子なし）。 */
  events: string[];
}

export interface FileIndex {
  /** その絵が在るか。`buildMep3DScene` の `hasFile` に渡す形。 */
  has(path: string): boolean;
  /** そのマップにイベント JSON が在るか。 */
  hasEvents(map: string): boolean;
}

let pending: Promise<FileIndex> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**。 */
export function loadFileIndex(): Promise<FileIndex> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/files.json'))
    .then((response) => (response.ok ? (response.json() as Promise<FileList>) : null))
    .then((file) => build(file))
    .catch((error) => {
      // 読めなければ**空の台帳**。法線マップとイベントは出ないが、絵は出るし止まらない。
      console.warn('[files] 台帳を読めなかった', error);
      return build(null);
    });
  return pending;
}

function build(file: FileList | null): FileIndex {
  const normals = new Set(file?.normals ?? []);
  const events = new Set(file?.events ?? []);
  return {
    has: (path) => normals.has(path.replace(/^\.?\//, '')),
    hasEvents: (map) => events.has(map),
  };
}
