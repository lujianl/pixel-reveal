/**
 * Bloom — several seeds open at once and merge.
 * Options: `points` (seed count), `jitter` (0..1 spread within each quadrant).
 */

import { defineBlockEffect, normalizeWeights, numberOption } from '../registry.js';

export const bloom = defineBlockEffect({
  name: 'bloom',
  label: { en: 'Bloom', zh: '多点绽放' },
  description: { en: 'Several points open at once', zh: '多点同时向外绽放' },
  duration: 3,
  easing: 'linear',
  weights(context, options) {
    const requested = Math.max(1, Math.round(numberOption(options, 'points', 5)));
    const jitter = numberOption(options, 'jitter', 0.3);
    const seeds: Array<{ x: number; y: number }> = [];
    const cols = context.cols;
    const rows = context.rows;
    // Spread the first four across quadrants, then fill in randomly.
    const quadrant = [
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.1, y: 0.6 },
      { x: 0.6, y: 0.6 },
    ];
    for (let i = 0; i < requested; i++) {
      const base = quadrant[i % quadrant.length]!;
      const offsetX = i < quadrant.length ? 0 : context.random();
      const offsetY = i < quadrant.length ? 0 : context.random();
      seeds.push({
        x: cols * (base.x + offsetX * 0.4 + (context.random() - 0.5) * jitter * 0.4),
        y: rows * (base.y + offsetY * 0.4 + (context.random() - 0.5) * jitter * 0.4),
      });
    }

    const weights = new Float32Array(cols * rows);
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        let best = Infinity;
        for (const seed of seeds) {
          const dx = bx - seed.x;
          const dy = by - seed.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < best) best = distance;
        }
        weights[by * cols + bx] = best;
      }
    }
    return normalizeWeights(weights);
  },
});
