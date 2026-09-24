/**
 * Pure pixel operations on `FrameBuffer`s.
 *
 * Deliberately free of canvas/DOM so the whole render path can be unit-tested in
 * Node, moved into a Worker, or ported to WASM/server later. All maths is
 * integer or IEEE-754 elementary operations only — no `Math.sin/log/atan2` in
 * hot paths — so results do not drift between engines.
 */

import type { FrameBuffer } from './types.js';

export function createFrame(width: number, height: number): FrameBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneFrame(frame: FrameBuffer): FrameBuffer {
  return { width: frame.width, height: frame.height, data: frame.data.slice() };
}

export function copyInto(target: FrameBuffer, source: FrameBuffer): void {
  if (target.width !== source.width || target.height !== source.height) {
    throw new Error('copyInto: frame size mismatch');
  }
  target.data.set(source.data);
}

/** Area-average resample. Used for both downscaling and the pixel-block grid. */
export function resampleArea(
  source: FrameBuffer,
  targetWidth: number,
  targetHeight: number,
): FrameBuffer {
  if (targetWidth === source.width && targetHeight === source.height) return cloneFrame(source);
  const out = createFrame(targetWidth, targetHeight);
  const s = source.data;
  const d = out.data;
  const sw = source.width;
  const sh = source.height;
  const xRatio = sw / targetWidth;
  const yRatio = sh / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        let offset = (sy * sw + x0) * 4;
        for (let sx = x0; sx < x1; sx++) {
          r += s[offset]!;
          g += s[offset + 1]!;
          b += s[offset + 2]!;
          a += s[offset + 3]!;
          offset += 4;
          count++;
        }
      }
      const o = (y * targetWidth + x) * 4;
      d[o] = r / count;
      d[o + 1] = g / count;
      d[o + 2] = b / count;
      d[o + 3] = a / count;
    }
  }
  return out;
}

/** Nearest-neighbour scale-up (keeps pixel blocks crisp). */
export function upscaleNearest(
  source: FrameBuffer,
  targetWidth: number,
  targetHeight: number,
): FrameBuffer {
  const out = createFrame(targetWidth, targetHeight);
  upscaleNearestInto(out, source);
  return out;
}

/** In-place variant of {@link upscaleNearest}, to avoid a full-frame allocation per frame. */
export function upscaleNearestInto(target: FrameBuffer, source: FrameBuffer): void {
  if (target.width === source.width && target.height === source.height) {
    target.data.set(source.data);
    return;
  }
  const s = source.data;
  const d = target.data;
  const sw = source.width;
  const sh = source.height;
  const targetWidth = target.width;
  const targetHeight = target.height;

  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / targetHeight));
    const srcRow = sy * sw * 4;
    let dstOffset = y * targetWidth * 4;
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / targetWidth));
      const o = srcRow + sx * 4;
      d[dstOffset] = s[o]!;
      d[dstOffset + 1] = s[o + 1]!;
      d[dstOffset + 2] = s[o + 2]!;
      d[dstOffset + 3] = s[o + 3]!;
      dstOffset += 4;
    }
  }
}

/**
 * Separable box blur, run `passes` times for a near-Gaussian falloff.
 * Deterministic: every sample is an integer sum divided by an integer window.
 */
export function boxBlur(source: FrameBuffer, radius: number, passes = 2): FrameBuffer {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return cloneFrame(source);
  const win = 2 * r + 1;
  let front = cloneFrame(source);
  const back = createFrame(source.width, source.height);
  for (let pass = 0; pass < passes; pass++) {
    blurHorizontal(front, back, r, win);
    blurVertical(back, front, r, win);
  }
  return front;
}

function blurHorizontal(source: FrameBuffer, target: FrameBuffer, r: number, win: number): void {
  const w = source.width;
  const h = source.height;
  const s = source.data;
  const d = target.data;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let i = -r; i <= r; i++) {
      const x = i < 0 ? 0 : i >= w ? w - 1 : i;
      const o = row + x * 4;
      s0 += s[o]!;
      s1 += s[o + 1]!;
      s2 += s[o + 2]!;
      s3 += s[o + 3]!;
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      d[o] = s0 / win;
      d[o + 1] = s1 / win;
      d[o + 2] = s2 / win;
      d[o + 3] = s3 / win;
      const outX = x - r < 0 ? 0 : x - r;
      const inX = x + r + 1 >= w ? w - 1 : x + r + 1;
      const oOut = row + outX * 4;
      const oIn = row + inX * 4;
      s0 += s[oIn]! - s[oOut]!;
      s1 += s[oIn + 1]! - s[oOut + 1]!;
      s2 += s[oIn + 2]! - s[oOut + 2]!;
      s3 += s[oIn + 3]! - s[oOut + 3]!;
    }
  }
}

function blurVertical(source: FrameBuffer, target: FrameBuffer, r: number, win: number): void {
  const w = source.width;
  const h = source.height;
  const stride = w * 4;
  const s = source.data;
  const d = target.data;
  for (let x = 0; x < w; x++) {
    const column = x * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let i = -r; i <= r; i++) {
      const y = i < 0 ? 0 : i >= h ? h - 1 : i;
      const o = column + y * stride;
      s0 += s[o]!;
      s1 += s[o + 1]!;
      s2 += s[o + 2]!;
      s3 += s[o + 3]!;
    }
    for (let y = 0; y < h; y++) {
      const o = column + y * stride;
      d[o] = s0 / win;
      d[o + 1] = s1 / win;
      d[o + 2] = s2 / win;
      d[o + 3] = s3 / win;
      const outY = y - r < 0 ? 0 : y - r;
      const inY = y + r + 1 >= h ? h - 1 : y + r + 1;
      const oOut = column + outY * stride;
      const oIn = column + inY * stride;
      s0 += s[oIn]! - s[oOut]!;
      s1 += s[oIn + 1]! - s[oOut + 1]!;
      s2 += s[oIn + 2]! - s[oOut + 2]!;
      s3 += s[oIn + 3]! - s[oOut + 3]!;
    }
  }
}

/** Copy one pixel block from `source` into `target` (clipped at the frame edge). */
export function blitBlock(
  target: FrameBuffer,
  source: FrameBuffer,
  blockX: number,
  blockY: number,
  blockSize: number,
): void {
  const x0 = blockX * blockSize;
  const y0 = blockY * blockSize;
  const w = Math.min(blockSize, target.width - x0);
  const h = Math.min(blockSize, target.height - y0);
  if (w <= 0 || h <= 0) return;
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * source.width + x0) * 4;
    const to = ((y0 + y) * target.width + x0) * 4;
    target.data.set(source.data.subarray(from, from + rowBytes), to);
  }
}

/** Linear blend `target = target * (1 - alpha) + source * alpha`, per channel. */
export function blendInto(target: FrameBuffer, source: FrameBuffer, alpha: number): void {
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  const t = target.data;
  const s = source.data;
  if (a === 1) {
    t.set(s);
    return;
  }
  if (a === 0) return;
  const inv = 1 - a;
  for (let i = 0; i < t.length; i++) {
    t[i] = t[i]! * inv + s[i]! * a;
  }
}

/** Mean luminance per block (Rec. 601 weights), row-major, length `cols * rows`. */
export function blockLuminance(source: FrameBuffer, cols: number, rows: number): Float32Array {
  const small = resampleArea(source, cols, rows);
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = small.data[o]! * 0.299 + small.data[o + 1]! * 0.587 + small.data[o + 2]! * 0.114;
  }
  return out;
}

/**
 * Assign an evenly spaced 0..1 rank to each entry (0 = smallest) — used by
 * order-based effects. Ranks sit in `(0, 1]` — never exactly 0 — so the first
 * frame of an animation reveals nothing.
 */
export function normalizedRanks(values: ArrayLike<number>): Float32Array {
  const n = values.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => values[a]! - values[b]!);
  const out = new Float32Array(n);
  for (let rank = 0; rank < n; rank++) {
    out[sorted[rank]!] = (rank + 0.5) / n;
  }
  return out;
}

/** Block grid dimensions for a frame. */
export function gridFor(
  width: number,
  height: number,
  blockSize: number,
): { cols: number; rows: number } {
  return { cols: Math.ceil(width / blockSize), rows: Math.ceil(height / blockSize) };
}

/** Default block size for a frame — matches the original tool's adaptive sizing. */
export function defaultBlockSize(
  width: number,
  height: number,
  maxBlock = 80,
  minBlock = 12,
): number {
  return Math.max(minBlock, Math.min(maxBlock, Math.round(Math.min(width, height) / 20)));
}
