import { describe, expect, it } from 'vitest';

import {
  bitrateFor,
  defaults,
  fitEvenDimensions,
  progressForFrame,
  resolveJob,
} from '../src/config.js';
import { PixelRevealError } from '../src/errors.js';
import { makeTestImage } from './helpers.js';

const source = makeTestImage(8, 8);

describe('fitEvenDimensions', () => {
  it('rounds odd dimensions down to even', () => {
    expect(fitEvenDimensions(101, 51, 2560)).toMatchObject({ width: 100, height: 50 });
  });

  it('scales down to the cap and keeps both axes even', () => {
    const result = fitEvenDimensions(6000, 4000, 2560);
    expect(result.width).toBe(2560);
    expect(result.height % 2).toBe(0);
    expect(result.height).toBeLessThanOrEqual(1706);
    expect(result.scale).toBeLessThan(1);
  });

  it('leaves small images alone', () => {
    const result = fitEvenDimensions(320, 180, 2560);
    expect(result).toMatchObject({ width: 320, height: 180, scale: 1 });
  });

  it('scales the longest side regardless of orientation', () => {
    const portrait = fitEvenDimensions(3000, 6000, 2560);
    expect(portrait.height).toBe(2560);
    expect(portrait.width % 2).toBe(0);
  });
});

describe('bitrateFor', () => {
  it('clamps small frames to the floor', () => {
    expect(bitrateFor(320, 180, 30)).toBe(defaults.minBitrate);
  });

  it('clamps large frames to the ceiling', () => {
    expect(bitrateFor(2560, 2560, 30)).toBe(defaults.maxBitrate);
  });

  it('scales with resolution between the floor and the ceiling', () => {
    const medium = bitrateFor(1280, 720, 30);
    const large = bitrateFor(1920, 1080, 30);
    expect(medium).toBe(defaults.minBitrate); // ~6.6 Mbps of target, lifted to the floor
    expect(large).toBeGreaterThan(medium); // ~14.9 Mbps, above the floor and below the ceiling
    expect(large).toBeLessThanOrEqual(defaults.maxBitrate);
  });

  it('targets the measured quality sweet spot', () => {
    // 0.24 bpp is where decoded quality stops improving measurably; see the note
    // on `bitratePerPixel`.
    expect(defaults.bitratePerPixel).toBeGreaterThanOrEqual(0.24);
    const target = bitrateFor(1920, 1440, 30);
    const bpp = target / (1920 * 1440 * 30);
    expect(bpp).toBeGreaterThanOrEqual(0.2);
    expect(bpp).toBeLessThanOrEqual(0.3);
  });

  it('keeps the floor high enough for small frames', () => {
    // The original implementation encoded everything at 10 Mbps; the floor keeps
    // downscaled photos from being clamped to a visibly worse bitrate.
    expect(defaults.minBitrate).toBeGreaterThanOrEqual(10_000_000);
    expect(bitrateFor(640, 360, 30)).toBe(defaults.minBitrate);
  });
});

describe('progressForFrame', () => {
  it('spans 0..1 inclusively for valid indices', () => {
    expect(progressForFrame(0, 10)).toBe(0);
    expect(progressForFrame(9, 10)).toBe(1);
    expect(progressForFrame(5, 10)).toBeCloseTo(5 / 9, 6);
  });

  it('clamps out-of-range indices', () => {
    expect(progressForFrame(10, 10)).toBe(1);
    expect(progressForFrame(-5, 10)).toBe(0);
  });

  it('handles a single frame', () => {
    expect(progressForFrame(0, 1)).toBe(1);
  });
});

describe('resolveJob', () => {
  it('applies defaults', () => {
    const job = resolveJob({ source }, 320, 180);
    expect(job.effect.name).toBe(defaults.effect);
    expect(job.fps).toBe(30);
    expect(job.seed).toBe(1);
    expect(job.cover).toBe('effect');
    expect(job.hardwareAcceleration).toBe('no-preference');
    expect(job.metadata.profile).toBe('google');
    expect(job.blockSize).toBe(12);
    expect(job.cols).toBe(Math.ceil(320 / 12));
    expect(job.rows).toBe(Math.ceil(180 / 12));
  });

  it('derives frame count and duration from the frame rate', () => {
    const job = resolveJob({ source, effect: 'scatter', fps: 24 }, 320, 180);
    expect(job.frameCount).toBe(Math.round(2 * 24));
    expect(job.duration).toBeCloseTo(2, 6);
  });

  it('lets callers override everything', () => {
    const job = resolveJob(
      {
        source,
        effect: 'ripple',
        duration: 1,
        fps: 10,
        blockSize: 20,
        seed: 99,
        cover: 'original',
        bitrate: 1_000_000,
        hardwareAcceleration: 'prefer-software',
        metadata: { profile: 'oplus', appName: 'demo' },
      },
      400,
      400,
    );
    expect(job.frameCount).toBe(10);
    expect(job.blockSize).toBe(20);
    expect(job.cols).toBe(20);
    expect(job.seed).toBe(99);
    expect(job.cover).toBe('original');
    expect(job.bitrate).toBe(1_000_000);
    expect(job.hardwareAcceleration).toBe('prefer-software');
    expect(job.metadata).toMatchObject({ profile: 'oplus', appName: 'demo' });
  });

  it('raises a typed error for unknown effects', () => {
    try {
      resolveJob({ source, effect: 'nope' }, 100, 100);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PixelRevealError);
      expect((error as PixelRevealError).code).toBe('EFFECT_NOT_FOUND');
    }
  });

  it('accepts an inline effect definition', () => {
    const custom = {
      name: 'inline',
      duration: 1,
      create: () => (_progress: number, frame: { data: Uint8ClampedArray }) => {
        frame.data.fill(0);
      },
    };
    const job = resolveJob({ source, effect: custom }, 100, 100);
    expect(job.effect.name).toBe('inline');
    expect(job.frameCount).toBe(30);
  });

  it('never returns fewer than two frames', () => {
    const job = resolveJob({ source, duration: 0.001, fps: 1 }, 100, 100);
    expect(job.frameCount).toBe(2);
  });
});
