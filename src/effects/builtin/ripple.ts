/**
 * Ripple — a true circle expands from the centre. Distance is measured in block
 * units; because blocks are square this is a circle on screen regardless of the
 * image aspect ratio.
 * Options: `from` (same anchors as `expand`), `ellipse` (true stretches the ring with the frame).
 */

import { defineBlockEffect, normalizeWeights } from '../registry.js';
import { anchorFor } from './expand.js';

export const ripple = defineBlockEffect({
  name: 'ripple',
  label: { en: 'Ripple', zh: '水波涟漪' },
  description: { en: 'Circle expands from the centre', zh: '同心圆向外扩散' },
  duration: 3.5,
  easing: 'easeInOutQuad',
  weights(context, options) {
    const from = typeof options.from === 'string' ? options.from : 'center';
    const ellipse = options.ellipse === true;
    const anchor = anchorFor(from, context.cols, context.rows);
    const stepX = ellipse ? 1 / context.cols : 1;
    const stepY = ellipse ? 1 / context.rows : 1;
    const weights = new Float32Array(context.cols * context.rows);
    for (let by = 0; by < context.rows; by++) {
      const dy = (by - anchor.y) * stepY;
      for (let bx = 0; bx < context.cols; bx++) {
        const dx = (bx - anchor.x) * stepX;
        weights[by * context.cols + bx] = Math.sqrt(dx * dx + dy * dy);
      }
    }
    return normalizeWeights(weights);
  },
});
