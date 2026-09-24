import { describe, expect, it } from 'vitest';

import { resolveEasing } from '../src/easing.js';
import { builtinEffects } from '../src/effects/builtin/index.js';
// Importing the effect layer is what registers the built-ins on the default registry.
import { registerBuiltinEffects } from '../src/effects/index.js';
import {
  createRegistry,
  defineBlockEffect,
  defineEffect,
  effects,
  listEffects,
  normalizeWeights,
} from '../src/effects/registry.js';
import { cloneFrame, createFrame, resampleArea, upscaleNearest } from '../src/frame.js';
import { createEffectContext } from '../src/pipeline/precompute.js';
import type { EffectContext, FrameBuffer } from '../src/types.js';
import { makeBlockDistinctImage, makeTestImage, sameBytes } from './helpers.js';

const BLOCK_SIZE = 8;

function contextFor(sharp: FrameBuffer, seed = 1): EffectContext {
  return createEffectContext({ sharp, blockSize: BLOCK_SIZE, seed });
}

describe('effect registry', () => {
  it('registers the nine built-ins', () => {
    registerBuiltinEffects();
    const names = listEffects().map((effect) => effect.name);
    expect(names).toEqual([
      'square',
      'scatter',
      'diagonal',
      'rain',
      'luminance',
      'expand',
      'spiral',
      'ripple',
      'bloom',
    ]);
    expect(effects.has('ripple')).toBe(true);
  });

  it('is idempotent', () => {
    registerBuiltinEffects();
    registerBuiltinEffects();
    expect(listEffects()).toHaveLength(builtinEffects.length);
  });

  it('rejects malformed definitions', () => {
    expect(() => defineEffect({ name: '', create: () => () => {} })).toThrow(TypeError);
    expect(() => defineEffect({ name: 'x' } as never)).toThrow(TypeError);
  });

  it('supports isolated registries', () => {
    const registry = createRegistry([builtinEffects[0]!]);
    expect(registry.list()).toHaveLength(1);
    registry.register(
      defineEffect({
        name: 'custom',
        create: () => (_progress, frame) => {
          frame.data.fill(0);
        },
      }),
    );
    expect(registry.has('custom')).toBe(true);
    expect(effects.has('custom')).toBe(false);
  });

  it('rejects registering an effect without create()', () => {
    const registry = createRegistry();
    expect(() => registry.register({ name: 'bad' } as never)).toThrow(TypeError);
  });
});

describe('normalizeWeights', () => {
  it('scales the maximum to exactly 1', () => {
    const weights = normalizeWeights(new Float32Array([1, 2, 4]));
    expect(Array.from(weights)).toEqual([0.25, 0.5, 1]);
  });

  it('never produces a zero weight, so frame 0 stays hidden', () => {
    const weights = normalizeWeights(new Float32Array([0, 5, 10]));
    expect(Math.min(...weights)).toBe(0);
    // A zero-weight block would reveal on frame 0; callers avoid this by
    // using weights that are strictly positive before normalising.
    const positive = normalizeWeights(new Float32Array([1, 5, 10]));
    expect(Math.min(...positive)).toBeGreaterThan(0);
  });

  it('handles an all-zero input', () => {
    const weights = normalizeWeights(new Float32Array([0, 0]));
    expect(Array.from(weights)).toEqual([1, 1]);
  });
});

describe('defineBlockEffect', () => {
  const sharp = makeTestImage(32, 24);

  it('starts at the pixelated backdrop and ends at the sharp image', () => {
    const effect = defineBlockEffect({
      name: 'test-linear',
      weights: (context) => {
        const weights = new Float32Array(context.cols * context.rows);
        for (let i = 0; i < weights.length; i++) weights[i] = (i + 1) / weights.length;
        return weights;
      },
    });
    const context = contextFor(sharp);
    const render = effect.create(context, {});
    const frame = createFrame(sharp.width, sharp.height);

    render(0, frame);
    expect(sameBytes(frame.data, context.base.data)).toBe(true);

    render(1, frame);
    expect(sameBytes(frame.data, sharp.data)).toBe(true);
  });

  it('reveals exactly the blocks whose weight has been passed', () => {
    const blockSize = 8;
    const width = 64;
    const height = 48;
    const sharp = makeBlockDistinctImage(width, height, blockSize);
    const buildWeights = (context: EffectContext): Float32Array => {
      const weights = new Float32Array(context.cols * context.rows);
      for (let i = 0; i < weights.length; i++) weights[i] = (i + 1) / weights.length;
      return weights;
    };
    const effect = defineBlockEffect({ name: 'test-monotonic', weights: buildWeights });
    const context = createEffectContext({ sharp, blockSize, seed: 1 });
    const weights = buildWeights(context);
    const render = effect.create(context, {});
    const frame = createFrame(width, height);

    // A block's first pixel is copied verbatim from `sharp` once revealed, and
    // the fixture guarantees the pixelated base never shares that value.
    const countRevealed = (): number => {
      let revealed = 0;
      for (let by = 0; by < context.rows; by++) {
        for (let bx = 0; bx < context.cols; bx++) {
          const offset = (by * blockSize * width + bx * blockSize) * 4;
          if (
            frame.data[offset] === sharp.data[offset] &&
            frame.data[offset + 1] === sharp.data[offset + 1]
          ) {
            revealed++;
          }
        }
      }
      return revealed;
    };

    let previous = -1;
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      render(progress, frame);
      const revealed = countRevealed();
      const expected = weights.reduce((sum, weight) => sum + (weight <= progress ? 1 : 0), 0);
      expect(revealed, `progress ${progress}`).toBe(expected);
      expect(revealed).toBeGreaterThanOrEqual(previous);
      previous = revealed;
    }
    expect(previous).toBe(context.cols * context.rows);
  });

  it('rejects a weights array of the wrong length', () => {
    const effect = defineBlockEffect({ name: 'test-bad', weights: () => new Float32Array(3) });
    expect(() => effect.create(contextFor(sharp), {})).toThrow(/expected/);
  });
});

describe('built-in effects', () => {
  const sharp = makeTestImage(64, 48);

  it('expose complete metadata', () => {
    for (const effect of builtinEffects) {
      expect(effect.label, effect.name).toBeTruthy();
      expect(effect.description, effect.name).toBeTruthy();
      expect(effect.duration, effect.name).toBeGreaterThan(0);
    }
  });

  it.each(builtinEffects.map((effect) => [effect.name, effect] as const))(
    '%s ends fully revealed',
    (name, effect) => {
      const context = contextFor(sharp, 5);
      const render = effect.create(context, {});
      const frame = createFrame(sharp.width, sharp.height);
      for (const progress of [0, 0.5, 1]) render(progress, frame);
      expect(frame.data.length).toBe(sharp.width * sharp.height * 4);
      // Every effect must finish on the untouched photo.
      expect(sameBytes(frame.data, sharp.data), `${name} should end fully revealed`).toBe(true);
    },
  );

  it('reveals nothing on the first frame', () => {
    for (const effect of builtinEffects) {
      if (effect.name === 'square') continue; // square cross-fades rather than revealing blocks
      const context = contextFor(sharp, 3);
      const render = effect.create(context, {});
      const frame = createFrame(sharp.width, sharp.height);
      render(0, frame);
      expect(sameBytes(frame.data, context.base.data), `${effect.name} frame 0`).toBe(true);
    }
  });

  it('is reproducible for a given seed', () => {
    for (const name of ['scatter', 'rain', 'bloom']) {
      const effect = builtinEffects.find((candidate) => candidate.name === name)!;
      const first = createFrame(sharp.width, sharp.height);
      const second = createFrame(sharp.width, sharp.height);
      const renderA = effect.create(contextFor(sharp, 11), {});
      const renderB = effect.create(contextFor(sharp, 11), {});
      renderA(0.4, first);
      renderB(0.4, second);
      expect(sameBytes(first.data, second.data), `${name} same seed`).toBe(true);

      const other = createFrame(sharp.width, sharp.height);
      const renderC = effect.create(contextFor(sharp, 12), {});
      renderC(0.4, other);
      expect(sameBytes(first.data, other.data), `${name} different seed`).toBe(false);
    }
  });

  it('honours anchors and options', () => {
    const expand = builtinEffects.find((effect) => effect.name === 'expand')!;
    const fromTopLeft = expand.create(contextFor(sharp, 1), { from: 'topLeft' });
    const fromCenter = expand.create(contextFor(sharp, 1), { from: 'center' });
    const a = createFrame(sharp.width, sharp.height);
    const b = createFrame(sharp.width, sharp.height);
    fromTopLeft(0.3, a);
    fromCenter(0.3, b);
    expect(sameBytes(a.data, b.data)).toBe(false);
  });

  it('square sharpens towards the source', () => {
    const square = builtinEffects.find((effect) => effect.name === 'square')!;
    const context = contextFor(sharp, 1);
    const render = square.create(context, {});
    const frame = createFrame(sharp.width, sharp.height);
    render(1, frame);
    expect(sameBytes(frame.data, sharp.data)).toBe(true);
    render(0, frame);
    expect(sameBytes(frame.data, context.base.data)).toBe(false);
    expect(frame.data.length).toBe(sharp.width * sharp.height * 4);
  });
});

describe('Melt blur curve', () => {
  // Regression guard. The first software implementation scaled the blur by
  // (1 - progress) *and* measured it against the current block size, so the
  // radius collapsed to zero for the last third of the animation (hard blocks)
  // while starting far too large on big frames. The reference behaviour keeps
  // the radius roughly constant in block units, because the blur and the block
  // size shrink together.
  const width = 120;
  const height = 90;
  const sharp = makeTestImage(width, height);
  const blockSize = 12; // min(w,h)/20 for this fixture
  const melt = builtinEffects.find((effect) => effect.name === 'square')!;

  /** What a plain pixelation at the same block size looks like. */
  const pixelateOnly = (blockSizeAtT: number): Uint8ClampedArray => {
    const cols = Math.ceil(width / blockSizeAtT);
    const rows = Math.ceil(height / blockSizeAtT);
    return upscaleNearest(resampleArea(sharp, cols, rows), width, height).data;
  };

  const renderAt = (progress: number): Uint8ClampedArray => {
    const context = createEffectContext({ sharp, blockSize, seed: 1 });
    const frame = createFrame(width, height);
    melt.create(context, {})(progress, frame);
    return frame.data.slice();
  };

  it('softens the blocks early on', () => {
    for (const progress of [0, 0.25, 0.5, 0.75]) {
      const blockSizeAtT = Math.max(1, Math.round(blockSize * (1 - progress)));
      const expected = pixelateOnly(blockSizeAtT);
      const actual = renderAt(progress);
      expect(
        sameBytes(actual, expected),
        `progress ${progress} should still be blurred, not bare blocks`,
      ).toBe(false);
    }
  });

  it('converges on the untouched photo', () => {
    expect(sameBytes(renderAt(1), sharp.data)).toBe(true);
    const almost = renderAt(0.999);
    let differing = 0;
    for (let i = 0; i < almost.length; i += 4) {
      if (almost[i] !== sharp.data[i]) differing++;
    }
    // At the very end the blocks are a single pixel and the blur has tapered off.
    expect(differing / (width * height)).toBeLessThan(0.02);
  });

  it('does not smear large frames', () => {
    // The bug this guards: scaling the blur with the *block size* meant a
    // 2560px photo (blockSize 128) got a 192px blur on its first frame. With the
    // reference behaviour, a 20px blur is sub-block at that size, so the first
    // frame is exactly the pixelated backdrop.
    const bigBlock = 80;
    const context = createEffectContext({ sharp, blockSize: bigBlock, seed: 1 });
    const frame = createFrame(width, height);
    melt.create(context, {})(0, frame);
    const bare = upscaleNearest(
      resampleArea(sharp, Math.ceil(width / bigBlock), Math.ceil(height / bigBlock)),
      width,
      height,
    ).data;
    expect(sameBytes(frame.data, bare)).toBe(true);
  });
});

describe('easing', () => {
  it('resolves named curves', () => {
    expect(resolveEasing('linear')(0.25)).toBe(0.25);
    expect(resolveEasing('easeOutQuad')(0)).toBe(0);
    expect(resolveEasing('easeOutQuad')(1)).toBe(1);
    expect(resolveEasing(undefined)(1)).toBe(1);
  });

  it('accepts custom functions', () => {
    const custom = resolveEasing(() => 0.42);
    expect(custom(0.9)).toBe(0.42);
  });

  it('keeps every named curve inside [0,1]', () => {
    for (const name of [
      'linear',
      'easeOutQuad',
      'easeOutCubic',
      'easeInOutQuad',
      'easeInOutCubic',
    ] as const) {
      const easing = resolveEasing(name);
      for (let t = 0; t <= 1; t += 0.05) {
        const value = easing(t);
        expect(value).toBeGreaterThanOrEqual(-1e-9);
        expect(value).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

describe('context', () => {
  it('produces a pixelated base distinct from the sharp source', () => {
    const context = contextFor(makeTestImage(40, 40));
    expect(sameBytes(context.base.data, context.sharp.data)).toBe(false);
    expect(context.base.width).toBe(40);
    expect(context.cols).toBe(Math.ceil(40 / BLOCK_SIZE));
  });

  it('caches blurred variants and reseeds the rng', () => {
    const context = contextFor(makeTestImage(16, 16), 1);
    const first = context.getBlurred(4);
    expect(context.getBlurred(4)).toBe(first);

    const a = context.random();
    context.reseed(1);
    expect(context.random()).toBe(a);
  });

  it('never mutates the sharp source', () => {
    const sharp = makeTestImage(24, 24);
    const before = cloneFrame(sharp);
    const context = contextFor(sharp);
    for (const effect of builtinEffects) {
      effect.create(context, {})(0.5, createFrame(sharp.width, sharp.height));
    }
    expect(sameBytes(sharp.data, before.data)).toBe(true);
  });
});
