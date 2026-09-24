/**
 * Rain — columns fill from the top down, each with its own random head start.
 * Options: `spread` (max per-column delay, 0..1), `reverse` (true = bottom-up).
 */

import { defineBlockEffect, normalizeWeights, numberOption } from '../registry.js';

export const rain = defineBlockEffect({
  name: 'rain',
  label: { en: 'Rain', zh: '像素雨帘' },
  description: { en: 'Columns fill top to bottom', zh: '列依次从上往下落' },
  duration: 4,
  easing: 'linear',
  weights(context, options) {
    const spread = numberOption(options, 'spread', 0.2);
    const reverse = options.reverse === true;
    const delays = new Float32Array(context.cols);
    for (let c = 0; c < context.cols; c++) delays[c] = context.random() * spread;

    const weights = new Float32Array(context.cols * context.rows);
    for (let by = 0; by < context.rows; by++) {
      const row = (by + 0.5) / context.rows; // 0 at the top edge
      const y = reverse ? 1 - row : row;
      for (let bx = 0; bx < context.cols; bx++) {
        const delay = delays[bx]!;
        weights[by * context.cols + bx] = delay + (1 - delay) * y;
      }
    }
    return normalizeWeights(weights);
  },
});
