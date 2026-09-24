/**
 * Easing curves. Named curves keep configuration serialisable; pass a function
 * when you need something custom.
 */

import type { Easing } from './types.js';

export function resolveEasing(easing: Easing | undefined): (t: number) => number {
  if (typeof easing === 'function') return easing;
  switch (easing) {
    case 'linear':
      return (t) => t;
    case 'easeOutQuad':
      return (t) => 1 - (1 - t) * (1 - t);
    case 'easeInOutQuad':
      return (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    case 'easeInOutCubic':
      return (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    case 'easeOutCubic':
    case undefined:
      return (t) => 1 - Math.pow(1 - t, 3);
    default:
      return (t) => t;
  }
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
