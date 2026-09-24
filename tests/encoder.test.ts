import { describe, expect, it } from 'vitest';

import { requiredLevelHex, yieldToEventLoop } from '../src/pipeline/encoder.js';

/**
 * `yieldToEventLoop` exists because a long encode must not block the main
 * thread. These tests cover the contract; the browser-specific failure mode it
 * guards against (a `MessagePort` that is never started) can only be reproduced
 * in a real engine — see `tools/e2e.mjs`.
 */
describe('yieldToEventLoop', () => {
  it('resolves', async () => {
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
  });

  it('resolves many sequential yields', async () => {
    for (let i = 0; i < 25; i++) {
      await yieldToEventLoop();
    }
  });

  it('never loses a resolver when yields overlap', async () => {
    const results = await Promise.all([
      yieldToEventLoop().then(() => 'a'),
      yieldToEventLoop().then(() => 'b'),
      yieldToEventLoop().then(() => 'c'),
      yieldToEventLoop().then(() => 'd'),
    ]);
    expect(results).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lets a caller interleave work with the yield', async () => {
    const order: string[] = [];
    const pending = yieldToEventLoop().then(() => order.push('yielded'));
    order.push('sync');
    await pending;
    expect(order).toEqual(['sync', 'yielded']);
  });
});

describe('requiredLevelHex', () => {
  it('picks the smallest level the frame size fits', () => {
    // macroblocks: 640x360 = 920, 1080p = 8160 (inside 4.0's 8192),
    // 1440p = 14400, 4K = 32400, 2560² = 25600 (inside 5.1's 36864),
    // 4096² = 65536 (needs 6.0).
    expect(requiredLevelHex(640, 360)).toBe('28'); // 4.0
    expect(requiredLevelHex(1280, 720)).toBe('28'); // 4.0
    expect(requiredLevelHex(1920, 1080)).toBe('28'); // 4.0, just inside the ceiling
    expect(requiredLevelHex(2560, 1440)).toBe('32'); // 5.0
    expect(requiredLevelHex(2560, 2560)).toBe('33'); // 5.1, not 6.0
    expect(requiredLevelHex(3840, 2160)).toBe('33'); // 5.1
    expect(requiredLevelHex(4096, 4096)).toBe('3c'); // 6.0
  });

  it('is monotonic in frame area', () => {
    const order = ['28', '2a', '32', '33', '3c'];
    let previous = -1;
    for (const [width, height] of [
      [320, 180],
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
      [4096, 4096],
    ] as const) {
      const rank = order.indexOf(requiredLevelHex(width, height));
      expect(rank, `${width}x${height}`).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
    expect(previous).toBe(order.length - 1);
  });

  it('never returns an undefined level for tiny frames', () => {
    expect(requiredLevelHex(64, 64)).toBe('28');
  });
});
