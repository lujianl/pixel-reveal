/**
 * Effect registry.
 *
 * Built-in effects register themselves on import; consumers can add their own
 * with `defineEffect()` / `registerEffect()` without touching library code.
 * A registry instance can be forked (`createRegistry()`) when you want full
 * isolation — e.g. a build with only your own effects.
 */

import { blitBlock, cloneFrame, copyInto } from '../frame.js';
import type {
  BlockEffectConfig,
  EffectContext,
  EffectDefinition,
  EffectOptions,
  EffectRenderer,
} from '../types.js';

export type { BlockEffectConfig } from '../types.js';

export interface EffectRegistry {
  register(effect: EffectDefinition): void;
  get(name: string): EffectDefinition | undefined;
  has(name: string): boolean;
  list(): EffectDefinition[];
}

export function createRegistry(seed: readonly EffectDefinition[] = []): EffectRegistry {
  const effects = new Map<string, EffectDefinition>();
  for (const effect of seed) effects.set(effect.name, effect);
  return {
    register(effect) {
      if (!effect || typeof effect.name !== 'string' || effect.name.length === 0) {
        throw new TypeError('registerEffect: effect.name must be a non-empty string');
      }
      if (typeof effect.create !== 'function') {
        throw new TypeError(`registerEffect: effect "${effect.name}" must implement create()`);
      }
      effects.set(effect.name, effect);
    },
    get: (name) => effects.get(name),
    has: (name) => effects.has(name),
    list: () => [...effects.values()],
  };
}

/** Freeze and validate an effect definition. */
export function defineEffect(effect: EffectDefinition): EffectDefinition {
  if (!effect || typeof effect.name !== 'string' || effect.name.length === 0) {
    throw new TypeError('defineEffect: name must be a non-empty string');
  }
  if (typeof effect.create !== 'function') {
    throw new TypeError(`defineEffect: effect "${effect.name}" must implement create()`);
  }
  return Object.freeze({ ...effect });
}

/** The default, mutable registry used by `createMotionPhoto()`. */
export const effects: EffectRegistry = createRegistry();

export function registerEffect(effect: EffectDefinition): EffectDefinition {
  effects.register(effect);
  return effect;
}

export function getEffect(name: string): EffectDefinition | undefined {
  return effects.get(name);
}

export function listEffects(): EffectDefinition[] {
  return effects.list();
}

/**
 * Build an effect from a per-block weight function.
 *
 * Blocks start hidden (showing the pixelated backdrop) and are copied from the
 * sharp source the first frame their weight drops to or below `progress`.
 * Revealed blocks are remembered, so each block is copied exactly once per
 * export — the cost per frame is independent of frame count.
 */
export function defineBlockEffect(config: BlockEffectConfig): EffectDefinition {
  return defineEffect({
    name: config.name,
    label: config.label,
    description: config.description,
    duration: config.duration,
    easing: config.easing,
    create(context: EffectContext, options: EffectOptions): EffectRenderer {
      const weights = config.weights(context, options);
      const expected = context.cols * context.rows;
      if (weights.length !== expected) {
        throw new Error(
          `effect "${config.name}": weights() returned ${weights.length} entries, expected ${expected}`,
        );
      }
      const state = cloneFrame(context.base);
      const revealed = new Uint8Array(weights.length);
      return (progress: number, frame) => {
        for (let i = 0; i < weights.length; i++) {
          if (revealed[i] === 0 && weights[i]! <= progress) {
            revealed[i] = 1;
            blitBlock(
              state,
              context.sharp,
              i % context.cols,
              (i / context.cols) | 0,
              context.blockSize,
            );
          }
        }
        copyInto(frame, state);
      };
    },
  });
}

/**
 * Scale weights so the largest is exactly `1`.
 *
 * Dividing by the maximum (rather than min-max normalising) is deliberate: it
 * keeps every weight strictly positive, so frame 0 — rendered at `progress = 0`
 * — shows the untouched pixelated backdrop, and the last frame shows everything.
 */
export function normalizeWeights(values: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v > max) max = v;
  }
  if (!Number.isFinite(max) || max <= 0) {
    values.fill(1);
    return values;
  }
  for (let i = 0; i < values.length; i++) {
    values[i] = values[i]! / max;
  }
  return values;
}

/** Read a numeric option with a default. */
export function numberOption(options: EffectOptions, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
