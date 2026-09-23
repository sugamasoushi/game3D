import type { BatchDef, CellEncoding, Encoding } from './types';

/**
 * バッチ属性のデコード。base64 でも JSON 配列でも Int32Array に揃える。
 */

type Kind = 's16' | 'u16' | 'u8';

const BYTES_PER: Record<Kind, number> = { s16: 2, u16: 2, u8: 1 };

function base64ToBytes(text: string): Uint8Array {
  const decode = (globalThis as { atob?: (input: string) => string }).atob;
  if (!decode) throw new Error('mep3d: no base64 decoder available in this environment');
  const binary = decode(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeAttr(value: string | number[], kind: Kind, encoding: Encoding): Int32Array {
  if (encoding === 'json' || Array.isArray(value)) {
    return Int32Array.from(value as number[]);
  }

  const bytes = base64ToBytes(value as string);
  const stride = BYTES_PER[kind];
  const count = Math.floor(bytes.length / stride);
  const out = new Int32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < count; i += 1) {
    const at = i * stride;
    if (kind === 's16') out[i] = view.getInt16(at, true);
    else if (kind === 'u16') out[i] = view.getUint16(at, true);
    else out[i] = view.getUint8(at);
  }
  return out;
}

/** 軸ごとの差分を絶対セル座標に戻す。 */
function deltaDecodeCells(deltas: Int32Array): Int32Array {
  const out = new Int32Array(deltas.length);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i + 2 < deltas.length; i += 3) {
    x += deltas[i];
    y += deltas[i + 1];
    z += deltas[i + 2];
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

export function decodeCells(batch: BatchDef): Int32Array {
  const raw = decodeAttr(batch.attrs.cell, 's16', batch.enc);
  const cellEnc: CellEncoding = batch.cellEnc ?? 'abs';
  return cellEnc === 'delta' ? deltaDecodeCells(raw) : raw;
}

export function decodeProtoIndices(batch: BatchDef): Int32Array {
  return decodeAttr(batch.attrs.proto, 'u16', batch.enc);
}

export function decodeRotationFlags(batch: BatchDef): Int32Array {
  return decodeAttr(batch.attrs.rf, 'u8', batch.enc);
}

/** スタンプ影の組。無ければ全部 0（1 マス 1 枚）。 */
export function decodeStampGids(batch: BatchDef): Int32Array {
  const out = new Int32Array(batch.count);
  if (batch.attrs.gid == null) return out;
  const raw = decodeAttr(batch.attrs.gid, 'u16', batch.enc);
  const n = Math.min(raw.length, batch.count);
  for (let i = 0; i < n; i += 1) out[i] = raw[i] ?? 0;
  return out;
}
