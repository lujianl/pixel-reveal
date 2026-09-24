/**
 * Builds the immutable `EffectContext` an effect renders against.
 *
 * Done once per export. The expensive parts (blur, pixel-block backdrop) are
 * computed here so per-frame work stays proportional to what actually changes.
 */

import { boxBlur, cloneFrame, gridFor, resampleArea, upscaleNearest } from '../frame.js';
import { createRandom } from '../rng.js';
import type { EffectContext, FrameBuffer } from '../types.js';

export interface PrecomputeInput {
  /** Source image already resampled to the output size. */
  sharp: FrameBuffer;
  blockSize: number;
  seed: number;
  /** Radius of the "unrevealed" backdrop blur, in output pixels. */
  blurRadius?: number;
}

/** Blur radius that keeps the backdrop proportionate at any resolution. */
export function defaultBlurRadius(width: number, height: number): number {
  return Math.max(6, Math.min(40, Math.round(Math.min(width, height) / 24)));
}

export function createEffectContext(input: PrecomputeInput): EffectContext {
  const { sharp, blockSize, seed } = input;
  const { cols, rows } = gridFor(sharp.width, sharp.height, blockSize);
  const blurRadius = input.blurRadius ?? defaultBlurRadius(sharp.width, sharp.height);
  const blur = boxBlur(sharp, blurRadius, 2);
  const base = upscaleNearest(resampleArea(blur, cols, rows), sharp.width, sharp.height);

  const blurCache = new Map<number, FrameBuffer>();
  let rng = createRandom(seed);

  return {
    width: sharp.width,
    height: sharp.height,
    blockSize,
    cols,
    rows,
    sharp,
    blur,
    base,
    random: () => rng(),
    reseed(nextSeed: number): void {
      rng = createRandom(nextSeed);
    },
    getBlurred(radius: number): FrameBuffer {
      const key = Math.max(0, Math.round(radius));
      const cached = blurCache.get(key);
      if (cached) return cached;
      const frame = key === 0 ? cloneFrame(sharp) : boxBlur(sharp, key, 2);
      blurCache.set(key, frame);
      return frame;
    },
  };
}
