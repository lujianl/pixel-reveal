import { describe, expect, it } from 'vitest';

import {
  blitBlock,
  blockLuminance,
  boxBlur,
  cloneFrame,
  copyInto,
  createFrame,
  defaultBlockSize,
  gridFor,
  normalizedRanks,
  resampleArea,
  upscaleNearest,
  upscaleNearestInto,
} from '../src/frame.js';
import { createRandom, shuffled } from '../src/rng.js';
import { makeTestImage, sameBytes } from './helpers.js';

describe('frame buffers', () => {
  it('creates zeroed RGBA frames', () => {
    const frame = createFrame(3, 2);
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(2);
    expect(frame.data.length).toBe(24);
    expect(frame.data.every((value) => value === 0)).toBe(true);
  });

  it('clones without aliasing', () => {
    const frame = makeTestImage(8, 8);
    const copy = cloneFrame(frame);
    copy.data[0] = 123;
    expect(frame.data[0]).not.toBe(123);
  });

  it('rejects mismatched copyInto', () => {
    expect(() => copyInto(createFrame(2, 2), createFrame(3, 3))).toThrow();
  });
});

describe('resampleArea', () => {
  it('returns an exact copy for identical dimensions', () => {
    const source = makeTestImage(8, 8);
    const result = resampleArea(source, 8, 8);
    expect(sameBytes(result.data, source.data)).toBe(true);
    result.data[0] = 7;
    expect(source.data[0]).not.toBe(7);
  });

  it('averages 2x2 blocks when halving', () => {
    const source = createFrame(2, 2);
    const values = [0, 100, 200, 255];
    for (let i = 0; i < 4; i++) {
      source.data[i * 4] = values[i]!;
      source.data[i * 4 + 3] = 255;
    }
    const result = resampleArea(source, 1, 1);
    expect(result.data[0]).toBe(Math.round((0 + 100 + 200 + 255) / 4));
  });

  it('preserves the requested size for non-integer ratios', () => {
    const result = resampleArea(makeTestImage(10, 7), 4, 3);
    expect(result.width).toBe(4);
    expect(result.height).toBe(3);
  });
});

describe('upscaleNearest', () => {
  it('keeps hard block edges', () => {
    const source = createFrame(2, 1);
    source.data.set([10, 0, 0, 255, 200, 0, 0, 255]);
    const result = upscaleNearest(source, 4, 1);
    expect(Array.from(result.data.filter((_, index) => index % 4 === 0))).toEqual([
      10, 10, 200, 200,
    ]);
  });

  it('writes into a provided target without allocating', () => {
    const source = createFrame(2, 2);
    source.data.fill(33);
    const target = createFrame(4, 4);
    upscaleNearestInto(target, source);
    expect(target.data.every((value) => value === 33)).toBe(true);
  });
});

describe('boxBlur', () => {
  it('is a no-op for radius 0', () => {
    const source = makeTestImage(8, 8);
    expect(sameBytes(boxBlur(source, 0).data, source.data)).toBe(true);
  });

  it('is deterministic', () => {
    const source = makeTestImage(16, 12);
    expect(sameBytes(boxBlur(source, 3, 2).data, boxBlur(source, 3, 2).data)).toBe(true);
  });

  it('preserves a flat colour', () => {
    const source = createFrame(9, 5);
    for (let i = 0; i < source.data.length; i += 4) {
      source.data[i] = 77;
      source.data[i + 1] = 88;
      source.data[i + 2] = 99;
      source.data[i + 3] = 255;
    }
    const blurred = boxBlur(source, 2, 2);
    expect(blurred.data[0]).toBe(77);
    expect(blurred.data[1]).toBe(88);
    expect(blurred.data[2]).toBe(99);
    expect(blurred.data[3]).toBe(255);
  });

  it('reduces variance', () => {
    const source = makeTestImage(24, 24);
    const blurred = boxBlur(source, 4, 2);
    const spread = (data: Uint8ClampedArray) => {
      let min = 255;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        min = Math.min(min, data[i]!);
        max = Math.max(max, data[i]!);
      }
      return max - min;
    };
    expect(spread(blurred.data)).toBeLessThan(spread(source.data));
  });
});

describe('blitBlock', () => {
  it('copies a block and clips at the edge', () => {
    const source = createFrame(4, 4);
    source.data.fill(255);
    const target = createFrame(4, 4);
    blitBlock(target, source, 1, 1, 4);
    // 4x4 block starting at (4,4) is entirely outside -> nothing copied.
    expect(target.data.every((value) => value === 0)).toBe(true);
    blitBlock(target, source, 0, 0, 4);
    expect(target.data.every((value) => value === 255)).toBe(true);
  });
});

describe('blockLuminance / normalizedRanks', () => {
  it('computes Rec.601 luminance per block', () => {
    const frame = createFrame(1, 1);
    frame.data.set([255, 255, 255, 255]);
    expect(blockLuminance(frame, 1, 1)[0]).toBeCloseTo(255, 3);
    frame.data.set([0, 0, 0, 255]);
    expect(blockLuminance(frame, 1, 1)[0]).toBe(0);
  });

  it('ranks in (0,1] so the first frame reveals nothing', () => {
    const ranks = normalizedRanks([30, 10, 20]);
    expect(ranks[1]).toBeCloseTo(0.5 / 3, 6); // smallest value -> lowest rank
    expect(ranks[0]).toBeCloseTo(2.5 / 3, 6);
    expect(Math.max(...ranks)).toBeLessThanOrEqual(1);
    expect(Math.min(...ranks)).toBeGreaterThan(0);
  });
});

describe('grid helpers', () => {
  it('derives the block grid', () => {
    expect(gridFor(100, 50, 30)).toEqual({ cols: 4, rows: 2 });
  });

  it('keeps the adaptive block size in range', () => {
    expect(defaultBlockSize(320, 180)).toBe(12);
    expect(defaultBlockSize(2560, 1440)).toBe(72);
    expect(defaultBlockSize(2000, 2000)).toBe(80);
  });
});

describe('rng', () => {
  it('is reproducible for a seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it('differs across seeds', () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });

  it('stays within [0,1)', () => {
    const random = createRandom(7);
    for (let i = 0; i < 500; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('shuffles deterministically without losing items', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffled(input, createRandom(9));
    const b = shuffled(input, createRandom(9));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(input);
  });
});
