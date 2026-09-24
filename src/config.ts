/**
 * Defaults and option resolution.
 *
 * `resolveOptions()` is the single place where user input, effect metadata and
 * library defaults are merged, which keeps the pipeline free of `??` chains.
 */

import { getEffect, listEffects } from './effects/registry.js';
// Side-effect import: guarantees the built-in effects are registered before
// `resolveJob` is reachable, so `config` can be used on its own.
import './effects/index.js';
import { PixelRevealError } from './errors.js';
import { resolveEasing } from './easing.js';
import { defaultBlockSize, gridFor } from './frame.js';
import type {
  EffectDefinition,
  EffectOptions,
  ExportOptions,
  MetadataOptions,
  ResolvedDefaults,
} from './types.js';

export const defaults: ResolvedDefaults = {
  effect: 'square',
  duration: 2.5,
  fps: 30,
  maxDimension: 2560,
  /** bits per pixel per second, before clamping */
  bitratePerPixel: 0.12,
  minBitrate: 6_000_000,
  maxBitrate: 20_000_000,
  cover: 'effect',
  seed: 1,
  metadata: {
    profile: 'google',
    appName: 'pixel-reveal',
    embedIcc: true,
    embedMpf: true,
  },
};

export interface ResolvedJob {
  effect: EffectDefinition;
  effectOptions: EffectOptions;
  easing: (t: number) => number;
  fps: number;
  duration: number;
  frameCount: number;
  maxDimension: number;
  blockSize: number;
  cols: number;
  rows: number;
  seed: number;
  cover: 'effect' | 'original';
  bitrate: number;
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  metadata: Required<Pick<MetadataOptions, 'profile' | 'appName' | 'embedIcc' | 'embedMpf'>> &
    Pick<MetadataOptions, 'extraXmpAttributes'>;
}

/** Compute the encoder bitrate for a given resolution (bits per second). */
export function bitrateFor(width: number, height: number, fps: number): number {
  const target = width * height * fps * defaults.bitratePerPixel;
  return Math.round(Math.min(defaults.maxBitrate, Math.max(defaults.minBitrate, target)));
}

/**
 * Clamp to an even-numbered size no larger than `maxDimension`.
 * Even dimensions are required by 4:2:0 chroma subsampling in H.264.
 */
export function fitEvenDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number; scale: number } {
  let w = Math.floor(width);
  let h = Math.floor(height);
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  const longest = Math.max(w, h);
  if (longest > maxDimension) {
    const scale = maxDimension / longest;
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
    if (w % 2) w -= 1;
    if (h % 2) h -= 1;
  }
  return { width: w, height: h, scale: Math.min(1, maxDimension / Math.max(width, height)) };
}

export function resolveJob(
  options: ExportOptions,
  outputWidth: number,
  outputHeight: number,
): ResolvedJob {
  const effectName = typeof options.effect === 'string' ? options.effect : undefined;
  let effect: EffectDefinition | undefined;
  if (typeof options.effect === 'object') {
    effect = options.effect;
  } else {
    effect = getEffect(effectName ?? defaults.effect);
  }
  if (!effect) {
    const available = listEffects()
      .map((candidate) => candidate.name)
      .join(', ');
    throw new PixelRevealError(
      'EFFECT_NOT_FOUND',
      `Unknown effect "${effectName ?? ''}". Registered effects: ${available || '(none)'}`,
    );
  }

  const fps = Math.max(1, Math.round(options.fps ?? defaults.fps));
  const duration = Math.max(0.2, options.duration ?? effect.duration ?? defaults.duration);
  const frameCount = Math.max(2, Math.round(duration * fps));
  const blockSize = Math.max(
    1,
    Math.round(options.blockSize ?? defaultBlockSize(outputWidth, outputHeight)),
  );
  const { cols, rows } = gridFor(outputWidth, outputHeight, blockSize);
  const metadata = {
    profile: options.metadata?.profile ?? defaults.metadata.profile,
    appName: options.metadata?.appName ?? defaults.metadata.appName,
    embedIcc: options.metadata?.embedIcc ?? defaults.metadata.embedIcc,
    embedMpf: options.metadata?.embedMpf ?? defaults.metadata.embedMpf,
    extraXmpAttributes: options.metadata?.extraXmpAttributes,
  };

  return {
    effect,
    effectOptions: options.effectOptions ?? {},
    easing: resolveEasing(options.easing ?? effect.easing),
    fps,
    duration: frameCount / fps,
    frameCount,
    maxDimension: options.maxDimension ?? defaults.maxDimension,
    blockSize,
    cols,
    rows,
    seed: options.seed ?? defaults.seed,
    cover: options.cover ?? defaults.cover,
    bitrate: options.bitrate ?? bitrateFor(outputWidth, outputHeight, fps),
    hardwareAcceleration: options.hardwareAcceleration ?? 'no-preference',
    metadata,
  };
}

/** Progress within `[0,1]` for frame `index` of `frameCount` (indices are 0-based). */
export function progressForFrame(index: number, frameCount: number): number {
  if (frameCount <= 1) return 1;
  const progress = index / (frameCount - 1);
  return progress < 0 ? 0 : progress > 1 ? 1 : progress;
}
