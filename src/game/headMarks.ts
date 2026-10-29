// 頭の上のマーク（GS-267）。感情マーク（`emotes.ts`）を**キャラと同じ 3D の板**で立てる。
//
// 以前の話せる合図（GS-49）は画面に重ねた 32px の絵で、キャラの板は画面で何倍にも大きく映るのに
// 合図だけ素の大きさだったので小さく見えた。いまは**キャラの絵と同じ割合**（絵の画素 ÷ チップの画素 × マス
// × マップの `CharacterScale`）で板にし、キャラの板の子にして頭の上へ立てる——向き・ジャンプ・遠近がそのまま付いてくる。
//
// - 光は当てない（夜でも読めるように）。壁の向こうでも見える（深度を見ない。重ねていた頃と同じ）
// - 重なったら イベント ＞ 話せる合図 ＞ いつものマーク（`pickMark`）
// - 板は人ごとに 1 枚。人が消えた・作り直されたら付け直す

import {
  BufferAttribute,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three';
import { emote, emoteCell, emoteFrame, emotePop, pickMark, type MarkLayer } from './emotes';
import { sheetUrl, spriteSheet } from './spriteSheets';
import type { Player } from './player';

/** 頭の上のすき間（チップの画素で数える）。 */
const GAP_PX = 2;
/** キャラより手前に描く。 */
const MARK_RENDER_ORDER = 9000;

/** 1 つぶんの指示。 */
interface MarkSlot {
  id: string;
  /** 出した時刻（秒。`update` の時計）。 */
  since: number;
  /** 弾ませるか（イベントで出したときだけ）。 */
  pop: boolean;
  /** 消える時刻（秒）。無ければ出したまま。 */
  until?: number;
  /** 消えたら呼ぶ（イベントが待っている）。 */
  done?: (shown: boolean) => void;
}

interface Board {
  mesh: Mesh;
  owner: Player;
  sheet: string;
}

export interface HeadMarks {
  /**
   * イベントのマーク。`ms` が 0 なら出したまま（`null` か次の指示で消す）。
   * 消えたら返る（出したままなら すぐ返る）。台帳に無い id なら false で すぐ返る。
   */
  show(who: string, id: string | null, ms: number): Promise<boolean>;
  /** いつものマーク（`idleEmote`）。null で外す。 */
  setIdle(who: string, id: string | null): void;
  /** 話せる合図を出す相手（毎フレーム全員ぶん）。ここに居ない人の合図は消す。近づいても動きは止めない。 */
  setTalk(list: Array<{ who: string; id: string }>): void;
  /** その人のマークを全部外す（人が消えたとき）。 */
  forget(who: string): void;
  /** イベントのマークだけ全部外す（イベントの終わり）。 */
  clearEvent(): void;
  /** 全部外す（マップの読み直し）。 */
  clear(): void;
  /** 毎フレーム。`actorOf` で人を引く（居なければ null）。 */
  update(dt: number, actorOf: (who: string) => Player | null): void;
  dispose(): void;
}

export function createHeadMarks(options: {
  /** 1 マスのワールドの長さ。 */
  unit: () => number;
  /** マップの 1 マスの画素（`grid.tilePx`）。 */
  tilePx: () => number;
  /** マップの `CharacterScale`。 */
  scale: () => number;
}): HeadMarks {
  const slots = new Map<string, Partial<Record<MarkLayer, MarkSlot>>>();
  const boards = new Map<string, Board>();
  const textures = new Map<string, Texture>();
  const materials = new Map<string, MeshBasicMaterial>();
  const loader = new TextureLoader();
  /** 時計（秒）。 */
  let now = 0;
  /** 話せる合図はみんな同じ拍子で回す（GS-49）。 */
  const talkSince = 0;

  const materialOf = (sheet: string): MeshBasicMaterial => {
    let material = materials.get(sheet);
    if (material) return material;
    const texture = loader.load(sheetUrl(sheet));
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    textures.set(sheet, texture);
    material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
    });
    materials.set(sheet, material);
    return material;
  };

  const layersOf = (who: string) => {
    let layers = slots.get(who);
    if (!layers) {
      layers = {};
      slots.set(who, layers);
    }
    return layers;
  };

  /** 指示を外す。待っているイベントには知らせる。 */
  const drop = (who: string, layer: MarkLayer, shown: boolean) => {
    const layers = slots.get(who);
    const slot = layers?.[layer];
    if (!layers || !slot) return;
    delete layers[layer];
    slot.done?.(shown);
    if (!Object.keys(layers).length) slots.delete(who);
  };

  const removeBoard = (who: string) => {
    const board = boards.get(who);
    if (!board) return;
    board.mesh.removeFromParent();
    board.mesh.geometry.dispose();
    boards.delete(who);
  };

  return {
    show(who, id, ms) {
      drop(who, 'event', false);
      if (id === null) return Promise.resolve(true);
      if (!emote(id)) {
        console.warn(`[emote] 感情マークが台帳（emotes.json）にありません: ${id}`);
        return Promise.resolve(false);
      }
      const layers = layersOf(who);
      if (ms <= 0) {
        layers.event = { id, since: now, pop: true };
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        layers.event = { id, since: now, pop: true, until: now + ms / 1000, done: resolve };
      });
    },
    setIdle(who, id) {
      if (id === null) {
        drop(who, 'idle', false);
        return;
      }
      if (!emote(id)) console.warn(`[emote] 感情マークが台帳（emotes.json）にありません: ${id}`);
      layersOf(who).idle = { id, since: now, pop: false };
    },
    setTalk(list) {
      const seen = new Set<string>();
      for (const entry of list) {
        seen.add(entry.who);
        const layers = layersOf(entry.who);
        const before = layers.talk;
        // 近づいても**止めずに回し続ける**（2026-10-29。それまでは近づいたコマで止めていた）。
        layers.talk = before && before.id === entry.id ? before : { id: entry.id, since: talkSince, pop: false };
      }
      for (const [who, layers] of slots) if (layers.talk && !seen.has(who)) drop(who, 'talk', true);
    },
    forget(who) {
      for (const layer of ['event', 'talk', 'idle'] as const) drop(who, layer, false);
      removeBoard(who);
    },
    clearEvent() {
      for (const who of [...slots.keys()]) drop(who, 'event', false);
    },
    clear() {
      for (const who of [...slots.keys()]) for (const layer of ['event', 'talk', 'idle'] as const) drop(who, layer, false);
      for (const who of [...boards.keys()]) removeBoard(who);
    },
    update(dt, actorOf) {
      now += dt;
      // 時間の来たイベントのマークを外す。
      for (const [who, layers] of [...slots]) {
        const slot = layers.event;
        if (slot?.until !== undefined && now >= slot.until) drop(who, 'event', true);
      }
      const unit = options.unit();
      const tilePx = options.tilePx() || 32;
      const scale = options.scale() || 1;
      for (const who of new Set([...slots.keys(), ...boards.keys()])) {
        const picked = pickMark(slots.get(who) ?? {});
        const def = picked ? emote(picked.mark.id) : null;
        const cut = def ? spriteSheet(def.sheet) : null;
        const actor = picked ? actorOf(who) : null;
        if (!picked || !def || !cut || !actor) {
          removeBoard(who);
          continue;
        }
        let board = boards.get(who);
        if (board && (board.owner !== actor || board.sheet !== def.sheet)) {
          removeBoard(who);
          board = undefined;
        }
        if (!board) {
          const mesh = new Mesh(new PlaneGeometry(1, 1), materialOf(def.sheet));
          mesh.renderOrder = MARK_RENDER_ORDER;
          mesh.frustumCulled = false;
          mesh.name = 'headMark';
          actor.group.add(mesh);
          board = { mesh, owner: actor, sheet: def.sheet };
          boards.set(who, board);
        }
        const slot = picked.mark;
        const elapsed = (now - slot.since) * 1000;
        const frame = emoteFrame(def, elapsed);
        const { col, row } = emoteCell(frame, cut.columns);
        // コマの切り出し（UV）。画像の上が v=1。
        const u0 = col / cut.columns;
        const u1 = (col + 1) / cut.columns;
        const v1 = 1 - row / cut.rows;
        const v0 = 1 - (row + 1) / cut.rows;
        const uv = board.mesh.geometry.getAttribute('uv') as BufferAttribute;
        // PlaneGeometry の並びは 左上・右上・左下・右下。
        uv.setXY(0, u0, v1);
        uv.setXY(1, u1, v1);
        uv.setXY(2, u0, v0);
        uv.setXY(3, u1, v0);
        uv.needsUpdate = true;
        // 大きさはキャラの絵と同じ割合（画素 ÷ マップの 1 マスの画素 × マス × CharacterScale）。
        const pop = emotePop(elapsed, slot.pop);
        const width = (cut.frameWidth / tilePx) * unit * scale;
        const height = (cut.frameHeight / tilePx) * unit * scale;
        board.mesh.scale.set(width * pop, height * pop, 1);
        // 見えている頭の上（絵を下げたぶん・コマの上の透明なすき間を引く。GS-52 / GS-205）。跳ねている間も付いてくる。
        const foot = actor.boardFoot().y - actor.position.y;
        const head = foot + actor.size.height - actor.headPad();
        const gap = (GAP_PX / tilePx) * unit * scale;
        // 弾むときは下の端（角の先）を据えたまま膨らませる。
        board.mesh.position.set(0, head + gap + (height * pop) / 2, 0);
      }
    },
    dispose() {
      this.clear();
      for (const material of materials.values()) material.dispose();
      for (const texture of textures.values()) texture.dispose();
      materials.clear();
      textures.clear();
    },
  };
}
