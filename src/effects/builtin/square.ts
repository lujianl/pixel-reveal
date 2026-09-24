/**
 * Melt — blocks sharpen out of a soft blur. The only built-in that is not a
 * block-weight reveal: it resamples the source every frame.
 *
 * The blur is applied to the *pixel grid* rather than the full-resolution frame,
 * which is both far cheaper and visually equivalent — the grid is already
 * low-pass, so blurring it before upscaling produces the same soft-blocks look.
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
    const intensity = numberOption(options, 'intensity', 1);
    const maxBlurPixels = Math.max(1, context.blockSize * 1.5 * intensity);
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
      const radius = Math.round((maxBlurPixels * (1 - progress)) / blockSize);
      const softened = radius > 0 ? boxBlur(grid, radius, 2) : grid;
      if (softened.width !== context.width || softened.height !== context.height) {
        upscaleNearestInto(frame, softened);
      } else {
        copyInto(frame, softened);
      }
    };
  },
});
