/**
 * Spiral — the reveal traces an Archimedean spiral out from the centre.
 * Options: `turns` (arm count), `from` (anchor).
 *
 * Ordering uses `Math.atan2`; it is stable within an engine, but the *order* of
 * near-identical angles could differ between JS engines. Nothing here is
 * bit-sensitive, so that is acceptable (see README "determinism").
 */

import { normalizedRanks } from '../../frame.js';
import { defineBlockEffect, numberOption } from '../registry.js';
import { anchorFor } from './expand.js';

export const spiral = defineBlockEffect({
  name: 'spiral',
  label: { en: 'Spiral', zh: '黄金螺旋' },
  description: { en: 'Traces a spiral outward', zh: '沿螺旋向外展开' },
  duration: 3,
  easing: 'easeOutQuad',
  weights(context, options) {
    const turns = Math.max(1, numberOption(options, 'turns', 3));
    const from = typeof options.from === 'string' ? options.from : 'center';
    const anchor = anchorFor(from, context.cols, context.rows);
    const weights = new Float32Array(context.cols * context.rows);
    let maxRadius = 0;
    for (let by = 0; by < context.rows; by++) {
      for (let bx = 0; bx < context.cols; bx++) {
        const dx = bx - anchor.x;
        const dy = by - anchor.y;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius > maxRadius) maxRadius = radius;
      }
    }
    if (maxRadius <= 0) maxRadius = 1;
    for (let by = 0; by < context.rows; by++) {
      for (let bx = 0; bx < context.cols; bx++) {
        const dx = bx - anchor.x;
        const dy = by - anchor.y;
        const angle = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI); // 0..1
        const radius = Math.sqrt(dx * dx + dy * dy) / maxRadius; // 0..1
        const phase = angle + radius * turns;
        weights[by * context.cols + bx] = phase - Math.floor(phase); // keep the fractional part
      }
    }
    return normalizedRanks(weights);
  },
});
