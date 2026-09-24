/**
 * Effect layer entry point.
 *
 * Importing this module registers the nine built-in effects. Consumers can add
 * or replace effects at runtime:
 *
 * ```ts
 * import { defineBlockEffect, registerEffect } from 'pixel-reveal';
 *
 * registerEffect(defineBlockEffect({
 *   name: 'wipe',
 *   label: 'Wipe',
 *   weights: (ctx) => { ... }, // one weight per block, 0..1
 * }));
 * ```
 */

import { builtinEffects } from './builtin/index.js';
import { effects } from './registry.js';

export { builtinEffects } from './builtin/index.js';
export {
  bloom,
  diagonal,
  expand,
  luminance,
  rain,
  ripple,
  scatter,
  spiral,
  square,
} from './builtin/index.js';
export { anchorFor } from './builtin/expand.js';
export {
  createRegistry,
  defineBlockEffect,
  defineEffect,
  effects,
  getEffect,
  listEffects,
  normalizeWeights,
  numberOption,
  registerEffect,
} from './registry.js';
export type { BlockEffectConfig, EffectRegistry } from './registry.js';

export function registerBuiltinEffects(): void {
  for (const effect of builtinEffects) effects.register(effect);
}

registerBuiltinEffects();
