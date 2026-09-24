/**
 * Melt — blocks sharpen out of a soft blur.
 *
 * The only built-in that is not a block-weight reveal: it resamples the source
 * every frame.
 *
 * Reference behaviour (and the reason for the maths below): blur the frame by
 * `blurPixels * (1 - progress)`, then pixelate with blocks of
 * `blockSize * (1 - progress)`. Both quantities shrink together, so the blur
 * measured *in blocks* stays constant — which is why this can be done on the
 * block grid instead of the full-resolution frame:
 *
 *     radiusInBlocks = blurPixels * (1 - t) / (blockSize * (1 - t))
 *                    = blurPixels / blockSize
 *
 * Blurring the grid is a fraction of the work (a 32x32 grid instead of a
 * 2560x2560 frame) and keeps the render path free of canvas filters, so the
 * output stays reproducible. Blurring the *full* frame first and downscaling —
 * what the original canvas implementation did — is equivalent whenever the blur
 * is small relative to a block, which is exactly when the two differ at all.
 */

import { boxBlur, copyInto, resampleArea, upscaleNearestInto } from '../../frame.js';
import { defineEffect, numberOption } from '../registry.js';

export const square = defineEffect({
  name: 'square',
  label: { en: 'Melt', zh: '像素融化' },
  description: { en: 'Blocks sharpen out of a soft blur', zh: '方块从模糊渐变清晰' },
  duration: 3,
  easing: 'easeOutQuad',
  create(context, options) {
    /**
     * Blur of the first frame, in output pixels. The original tool hard-coded
     * 20px; scaling it with the frame would make large photos a smear.
     */
    const blurPixels = Math.max(0, numberOption(options, 'blur', 20));

    return (progress, frame) => {
      if (progress >= 1) {
        copyInto(frame, context.sharp);
        return;
      }

      const blockSize = Math.max(1, Math.round(context.blockSize * (1 - progress)));
      if (blockSize === 1) {
        copyInto(frame, context.sharp);
        return;
      }

      const cols = Math.ceil(context.width / blockSize);
      const rows = Math.ceil(context.height / blockSize);
      const grid = resampleArea(context.sharp, cols, rows);

      // Decide the radius in the *export's* block units, then apply that many
      // grid pixels here.
      //
      // The reference blurs by `blurPixels * (1 - t)` output pixels and pixelates
      // with `outputBlockSize * (1 - t)` blocks, so the blur measured in blocks
      // is `blurPixels / outputBlockSize` — constant, because both shrink
      // together. Evaluating the *rounded* radius in output space and reusing it
      // on this grid is what makes a 720px preview agree with a 2560px export: a
      // 20px radius is sub-block at photo sizes, so it must vanish in the preview
      // too. When this frame *is* the output (preview of nothing), the divisor is
      // `blockSize * (1 - t)` and nothing changed.
      const outputBlockNow = Math.max(
        1,
        Math.round((context.outputBlockSize || context.blockSize) * (1 - progress)),
      );
      const radius = Math.round((blurPixels * (1 - progress)) / outputBlockNow);
      const softened = radius >= 1 ? boxBlur(grid, radius, 2) : grid;

      if (softened.width !== context.width || softened.height !== context.height) {
        upscaleNearestInto(frame, softened);
      } else {
        copyInto(frame, softened);
      }
    };
  },
});
