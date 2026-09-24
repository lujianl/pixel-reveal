/**
 * Expand — a ring grows outward from an anchor.
 *
 * Distances are normalised per axis, so the ring's shape follows the image
 * aspect ratio (a 16:9 photo expands as a wide rectangle rather than a circle).
 * Use `ripple` when you want a true circle.
 * Options: `from` ('center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight').
 */

import { defineBlockEffect, normalizeWeights } from '../registry.js';

export function anchorFor(from: string, cols: number, rows: number): { x: number; y: number } {
  const lastX = cols - 1;
  const lastY = rows - 1;
  switch (from) {
    case 'topLeft':
      return { x: 0, y: 0 };
    case 'topRight':
      return { x: lastX, y: 0 };
    case 'bottomLeft':
      return { x: 0, y: lastY };
    case 'bottomRight':
      return { x: lastX, y: lastY };
    default:
      return { x: lastX / 2, y: lastY / 2 };
  }
}

export const expand = defineBlockEffect({
  name: 'expand',
  label: { en: 'Expand', zh: '回字展开' },
  description: { en: 'Ring grows from the centre', zh: '从中心向外扩展' },
  duration: 2,
  easing: 'linear',
  weights(context, options) {
    const from = typeof options.from === 'string' ? options.from : 'center';
    const anchor = anchorFor(from, context.cols, context.rows);
    const stepX = 1 / context.cols;
    const stepY = 1 / context.rows;
    const weights = new Float32Array(context.cols * context.rows);
    for (let by = 0; by < context.rows; by++) {
      const dy = Math.abs(by - anchor.y) * stepY;
      for (let bx = 0; bx < context.cols; bx++) {
        const dx = Math.abs(bx - anchor.x) * stepX;
        weights[by * context.cols + bx] = Math.max(dx, dy);
      }
    }
    return normalizeWeights(weights);
  },
});
