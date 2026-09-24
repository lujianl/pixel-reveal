/**
 * Luminance — reveals by brightness, so highlights surface first.
 * Option: `darkFirst` (true reverses the order).
 */

import { blockLuminance, normalizedRanks } from '../../frame.js';
import { defineBlockEffect } from '../registry.js';

export const luminance = defineBlockEffect({
  name: 'luminance',
  label: { en: 'Luminance', zh: '光影渐现' },
  description: { en: 'Bright areas surface first', zh: '亮部先现，暗部后显' },
  duration: 2,
  easing: 'linear',
  weights(context, options) {
    const darkFirst = options.darkFirst === true;
    const luminance = blockLuminance(context.sharp, context.cols, context.rows);
    const values = new Float32Array(luminance.length);
    for (let i = 0; i < luminance.length; i++) {
      values[i] = darkFirst ? luminance[i]! : -luminance[i]!;
    }
    return normalizedRanks(values);
  },
});
