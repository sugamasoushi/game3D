// カメラ演出（DEC-388）。**一度だけ走る画作り**——光る・揺れる・寄る・暗くする。
//
// 恒常の画作り（`CameraFxDef`：フォグ・チルト・空）と分けてあるのは、こちらが
// **時間を持つ**ため。フォグは「いまいくつか」で足りるが、フラッシュは
// 「何ミリ秒で消えるか」が要る。値だけの設定と、時間を進める入れ物は形が違う。
//
// **ここは数を作るだけ。** カメラを動かすのも veil を塗るのも呼ぶ側（`applyCameraShot` と
// `tiltshift` の veil）で、3 つのプロジェクト（エディタ・ゲームビュー・ゲーム）が
// **同じ計算**を通す。見え方が食い違わないように、式は 1 か所に置く。
//
// 揺れと寄りは**カメラの `position` と `zoom`** で出す（リグには触らない）。
// リグは向き・距離・止め位置をマップの決まりで組み立てているので、
// 演出がそこへ書き込むと「戻したつもりが戻っていない」が起きる。

import { Color, type Camera, type OrthographicCamera, type PerspectiveCamera } from 'three';

/**
 * 演出 1 つぶん（DEC-391）。**マップには持たせない**——
 * イベントの `shot` 命令がそのまま値を書く（ゲーム全体で使える）。
 * 一覧にして持たせると、同じ演出をマップごとに作り直すことになる。
 */
export interface CameraShot {
  /** `flash`（光る）/ `shake`（揺れる）/ `zoom`（寄る）/ `veil`（暗転）。 */
  kind: string;
  /** 長さ（ミリ秒）。省略時は種類ごとの既定。 */
  ms?: number;
  /**
   * 強さ。`flash` / `veil` は濃さ（0〜1）、`shake` は揺れ幅（マス）、
   * `zoom` は倍率（1 より大きいと寄る）。
   */
  power?: number;
  /** 色（`flash` / `veil`）。6 桁 hex。 */
  color?: string;
  /** 効果を**残す**か（`zoom` / `veil`）。省略時は戻す。 */
  hold?: boolean;
}

export const CAMERA_SHOT_KINDS = ['flash', 'shake', 'zoom', 'veil'] as const;
export type CameraShotKind = (typeof CAMERA_SHOT_KINDS)[number];

export const CAMERA_SHOT_LABELS: Record<CameraShotKind, string> = {
  flash: 'フラッシュ',
  shake: 'シェイク',
  zoom: 'ズーム',
  veil: '暗転',
};

/** 種類ごとの既定。**書かなくても「それらしく」動く**ようにしておく。 */
export const CAMERA_SHOT_DEFAULTS: Record<CameraShotKind, { ms: number; power: number; color: string }> = {
  // 光は短く。長いと「点いている」に見えて驚きが消える。
  flash: { ms: 320, power: 0.85, color: 'ffffff' },
  shake: { ms: 480, power: 0.35, color: 'ffffff' },
  zoom: { ms: 600, power: 1.25, color: 'ffffff' },
  veil: { ms: 500, power: 1, color: '000000' },
};

/** 揺れの速さ（1 秒あたりの往復）。速すぎると点滅に見え、遅いと酔う。 */
const SHAKE_HZ = 18;

/** 1 フレームぶんの結果。**呼ぶ側はこれを画面へ写すだけ。** */
export interface CameraShotFrame {
  /** カメラを右へずらす量（ワールド）。 */
  shakeX: number;
  /** 上へずらす量（ワールド）。 */
  shakeY: number;
  /** 倍率。1 で素のまま。 */
  zoom: number;
  /** 画面をおおう色。`alpha` が 0 なら塗らない。 */
  veil: Color;
  veilAlpha: number;
  /** 何か走っているか（イベントの待ちに使う）。 */
  busy: boolean;
}

/** その種類か。知らない綴りは `flash` として扱わない——**何も起きない**ほうが安全。 */
function kindOf(def: CameraShot): CameraShotKind | null {
  return (CAMERA_SHOT_KINDS as readonly string[]).includes(def.kind) ? (def.kind as CameraShotKind) : null;
}

/** 走っている 1 本。 */
interface Running {
  kind: CameraShotKind;
  /** 経過（秒）。 */
  at: number;
  /** 長さ（秒）。 */
  span: number;
  power: number;
  color: Color;
  hold: boolean;
}

export interface CameraShots {
  /**
   * 1 本鳴らす。**同じ種類は重ねない**（後から鳴らしたほうが勝つ）——
   * フラッシュを 2 枚重ねても明るさが 2 倍になるだけで、形は伝わらない。
   */
  play(def: CameraShot): void;
  /** 全部止めて元へ戻す。マップを移るときなどに呼ぶ。 */
  stop(): void;
  /** 残している物（`hold` の暗転・寄り）を戻す。 */
  release(): void;
  /** 時間を進めて、いまのフレームを返す。 */
  update(deltaSeconds: number): CameraShotFrame;
  /** いまのフレーム（時間は進めない）。 */
  frame(): CameraShotFrame;
}

export function createCameraShots(): CameraShots {
  /** 種類ごとに 1 本だけ持つ。 */
  const running = new Map<CameraShotKind, Running>();
  const out: CameraShotFrame = { shakeX: 0, shakeY: 0, zoom: 1, veil: new Color(1, 1, 1), veilAlpha: 0, busy: false };

  const build = (): CameraShotFrame => {
    out.shakeX = 0;
    out.shakeY = 0;
    out.zoom = 1;
    out.veilAlpha = 0;
    out.busy = false;

    for (const shot of running.values()) {
      // 進み具合（0〜1）。長さ 0 は「すぐ終わり」＝残す物だけが残る。
      const t = shot.span > 0 ? Math.min(1, shot.at / shot.span) : 1;
      if (t < 1) out.busy = true;

      if (shot.kind === 'flash') {
        // 立ち上がりは速く、消えるのはゆっくり。**同じ速さで出入りすると鈍く見える。**
        const rise = 0.12;
        const level = t < rise ? t / rise : 1 - (t - rise) / (1 - rise);
        out.veil.copy(shot.color);
        out.veilAlpha = Math.max(out.veilAlpha, Math.max(0, level) * shot.power);
        continue;
      }

      if (shot.kind === 'veil') {
        // 暗転は**濃くなって、そのまま**（`hold`）か、濃くなって戻るか。
        const level = shot.hold ? t : t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2;
        out.veil.copy(shot.color);
        out.veilAlpha = Math.max(out.veilAlpha, level * shot.power);
        continue;
      }

      if (shot.kind === 'shake') {
        // 振れ幅は最後に向かって細る。**終わりが急に止まると弾かれたように見える。**
        const fade = 1 - t;
        const wave = Math.sin(shot.at * SHAKE_HZ * Math.PI * 2);
        const cross = Math.sin(shot.at * SHAKE_HZ * Math.PI * 2 * 0.73 + 1.1);
        out.shakeX += wave * shot.power * fade;
        // 縦は横の半分。横だけだと首を振っているように見え、同じだと回って見える。
        out.shakeY += cross * shot.power * fade * 0.5;
        continue;
      }

      // zoom。寄って戻る（`hold` なら寄ったまま）。
      const level = shot.hold ? t : t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2;
      out.zoom *= 1 + (shot.power - 1) * level;
    }
    return out;
  };

  return {
    play(def) {
      const kind = kindOf(def);
      if (!kind) {
        console.warn('[shot] 知らない種類: ' + def.kind);
        return;
      }
      const fallback = CAMERA_SHOT_DEFAULTS[kind];
      running.set(kind, {
        kind,
        at: 0,
        span: Math.max(0, (def.ms ?? fallback.ms) / 1000),
        power: def.power ?? fallback.power,
        color: new Color(`#${String(def.color ?? fallback.color).replace(/^#/, '')}`),
        hold: def.hold === true,
      });
    },

    stop() {
      running.clear();
    },

    release() {
      for (const [kind, shot] of [...running]) if (shot.hold) running.delete(kind);
    },

    update(deltaSeconds) {
      for (const [kind, shot] of [...running]) {
        shot.at += Math.max(0, deltaSeconds);
        // 終わった物は捨てる。**残す物（`hold`）だけ**は置いたままにする。
        if (shot.at >= shot.span && !shot.hold) running.delete(kind);
      }
      return build();
    },

    frame() {
      return build();
    },
  };
}

/**
 * カメラへ写す。**`rig.apply()` の後**に呼ぶ——リグが組み立てた位置と投影に、
 * 演出のぶんだけ足す。戻すのは次のフレームの `rig.apply()` がやってくれる。
 */
export function applyCameraShot(camera: Camera, frame: CameraShotFrame, unit = 1): void {
  if (frame.shakeX !== 0 || frame.shakeY !== 0) {
    // カメラの右と上へずらす。世界の軸で動かすと、向きによって揺れの向きが変わる。
    const right = { x: camera.matrixWorld.elements[0], y: camera.matrixWorld.elements[1], z: camera.matrixWorld.elements[2] };
    const up = { x: camera.matrixWorld.elements[4], y: camera.matrixWorld.elements[5], z: camera.matrixWorld.elements[6] };
    camera.position.x += (right.x * frame.shakeX + up.x * frame.shakeY) * unit;
    camera.position.y += (right.y * frame.shakeX + up.y * frame.shakeY) * unit;
    camera.position.z += (right.z * frame.shakeX + up.z * frame.shakeY) * unit;
    camera.updateMatrixWorld();
  }
  // `zoom` は正射でも透視でも効く（three が投影に掛ける）。リグの距離には触らない。
  const lens = camera as PerspectiveCamera | OrthographicCamera;
  if (typeof lens.zoom === 'number') {
    const next = Math.max(0.05, frame.zoom);
    if (lens.zoom !== next) {
      lens.zoom = next;
      lens.updateProjectionMatrix();
    }
  }
}
