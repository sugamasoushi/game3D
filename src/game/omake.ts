// おまけ（GS-212）とマニュアル（GS-213）。**旧作 `title/view/Omake.ts` / `Manual.ts` の作り直し。**
//
// マニュアルはクリアに関係なくタイトルに出る（旧作どおり右下で揺れるアイコン）。
// どちらも「タイトルから開く見物」なので、同じ台帳に置く。
//
// ゲームをクリアするとタイトルに「おまけ」が出て、絵・動画・めくる絵を見られる。
// 何を並べるかは**台帳**（`data/omake.json`）に置く——絵を足すのに TS を触らなくてよくするため
// （`opening.json` と同じ考え）。見せ方は `ui/Omake.tsx`。
//
// **クリアの覚えはセーブの枠ではなく端末に置く。** クリアのイベント（0101 の EVENT020201）は
// フラグ `ゲーム_クリア` を立てた直後にタイトルへ戻るので、枠には書かれない。
// 旧作も枠とは別の覚え（`GameClearFlg`）を見ていた。

import { assetUrl } from './assets';

/** クリアのフラグ。イベントの `setSwitch` で true にする（0101 の EVENT020201）。 */
export const CLEAR_SWITCH = 'ゲーム_クリア';

/** 見せ方。`image` は 1 枚、`video` は流し終わるまで、`pages` はめくる絵（GS-188 と同じ見せ方）。 */
export type OmakeKind = 'image' | 'video' | 'pages';

export interface OmakeItem {
  /** 一覧に出す名前。 */
  label: string;
  kind: OmakeKind;
  /** `public/` からの道。`image` と `video` は先頭の 1 つだけ使う。 */
  files: string[];
}

/** マニュアル（GS-213）。アイコンを押すと `pages` をめくる。 */
export interface ManualDef {
  /** タイトルに出すアイコン（`public/` からの道）。 */
  icon: string;
  pages: string[];
}

export interface OmakeBook {
  version: 1;
  items: OmakeItem[];
  /** 無ければタイトルにアイコンを出さない。 */
  manual?: ManualDef;
}

const KINDS: OmakeKind[] = ['image', 'video', 'pages'];

/** 台帳を読む。**読めなければ空**——おまけが無いだけで遊べなくなってはいけない。 */
export async function loadOmake(): Promise<OmakeBook> {
  try {
    const response = await fetch(assetUrl('data/omake.json'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return saneOmake(await response.json());
  } catch (error) {
    console.warn('[omake] 台帳を読めない', error);
    return { version: 1, items: [] };
  }
}

/** 知っている形の項目だけ通す。 */
export function saneOmake(raw: unknown): OmakeBook {
  const items = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [];
  const manualRaw = (raw as { manual?: Partial<ManualDef> })?.manual;
  const manualPages = Array.isArray(manualRaw?.pages)
    ? manualRaw.pages.filter((file) => typeof file === 'string' && file)
    : [];
  const manual =
    manualRaw && typeof manualRaw.icon === 'string' && manualRaw.icon && manualPages.length > 0
      ? { icon: manualRaw.icon, pages: manualPages }
      : undefined;
  if (manualRaw && !manual) console.warn('[omake] 読めないマニュアル', manualRaw);
  return {
    version: 1,
    ...(manual ? { manual } : {}),
    items: items.flatMap((one) => {
      const item = one as Partial<OmakeItem>;
      const files = Array.isArray(item.files) ? item.files.filter((file) => typeof file === 'string' && file) : [];
      if (typeof item.label !== 'string' || !KINDS.includes(item.kind as OmakeKind) || files.length === 0) {
        console.warn('[omake] 読めない項目', one);
        return [];
      }
      return [{ label: item.label, kind: item.kind as OmakeKind, files }];
    }),
  };
}

/** 端末の覚えの置き場所。設定（`samplegame.options`）と同じく localStorage。 */
const STORE_KEY = 'samplegame.cleared';

/** クリアしたことを覚える。`ゲーム_クリア` が true になったときに呼ぶ。 */
export function markCleared(): void {
  try {
    window.localStorage.setItem(STORE_KEY, '1');
  } catch {
    /* 覚えられなくても、クリアを含むセーブがあればタイトルは出す（`TitleScreen`）。 */
  }
}

/** この端末でクリアしたか。 */
export function clearedHere(): boolean {
  try {
    return window.localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}
