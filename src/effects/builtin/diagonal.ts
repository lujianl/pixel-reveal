/**
 * Diagonal — sweeps from one corner to the opposite one, with a subtle
 * alternating-row stagger.
 * Options: `stagger` (0..1), `from` ('topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight').
 */

import { defineBlockEffect, normalizeWeights, numberOption } from '../registry.js';

export const diagonal = defineBlockEffect({
  name: 'diagonal',
  label: { en: 'Diagonal', zh: '对角渐显' },
  description: { en: 'Sweeps corner to corner', zh: '从角向对角渐进' },
  duration: 3,
  easing: 'easeOutQuad',
  weights(context, options) {
    const stagger = numberOption(options, 'stagger', 0.08);
    const from = typeof options.from === 'string' ? options.from : 'topLeft';
    const flipX = from === 'topRight' || from === 'bottomRight';
    const flipY = from === 'bottomLeft' || from === 'bottomRight';
    const weights = new Float32Array(context.cols * context.rows);
    for (let by = 0; by < context.rows; by++) {
      for (let bx = 0; bx < context.cols; bx++) {
        const cx = (flipX ? context.cols - 1 - bx : bx) + 0.5;
        const cy = (flipY ? context.rows - 1 - by : by) + 0.5;
        const offset = by % 2 === 0 ? 0 : stagger;
        weights[by * context.cols + bx] = cx / context.cols + cy / context.rows + offset;
      }
    }
    return normalizeWeights(weights);
  },
});
