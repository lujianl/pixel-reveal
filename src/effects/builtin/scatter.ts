/**
 * Scatter — blocks appear in a random order.
 * Option: `bias` (>1 clusters reveals later, <1 front-loads them).
 */

import { defineBlockEffect, normalizeWeights, numberOption } from '../registry.js';

export const scatter = defineBlockEffect({
  name: 'scatter',
  label: { en: 'Scatter', zh: '像素消散' },
  description: { en: 'Blocks appear in random order', zh: '随机顺序逐块显现' },
  duration: 2,
  easing: 'linear',
  weights(context, options) {
    const bias = numberOption(options, 'bias', 1);
    const total = context.cols * context.rows;
    const weights = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const r = context.random();
      weights[i] = bias === 1 ? r : Math.pow(r, bias);
    }
    return normalizeWeights(weights);
  },
});
