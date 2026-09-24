/**
 * pixel-reveal — turn a still photo into a pixel-reveal Motion Photo.
 *
 * Two entry points:
 * - `createPreview()` — render frames for a live preview, no encoding, no video.
 * - `createMotionPhoto()` — full export: render + encode + assemble.
 *
 * Everything runs locally. There are no network calls and no runtime
 * dependencies.
 */

import { bitrateFor, defaults, fitEvenDimensions, progressForFrame, resolveJob } from './config.js';
import { registerBuiltinEffects } from './effects/index.js';
import { PixelRevealError } from './errors.js';
import { clamp01 } from './easing.js';
import { createFrame, defaultBlockSize } from './frame.js';
import { encodeVideo, isVideoEncodingSupported } from './pipeline/encoder.js';
import { assembleMotionPhoto, inspectMotionPhoto } from './pipeline/motion-photo.js';
import { createMp4Muxer } from './pipeline/muxer.js';
import { createEffectContext } from './pipeline/precompute.js';
import { createBrowserCodec, supportsMotionPhotoExport } from './platform/browser.js';
import type {
  EffectDefinition,
  EffectOptions,
  Easing,
  ExportOptions,
  FrameBuffer,
  ImageCodec,
  ImageSource,
  MotionPhotoResult,
  ProgressEvent,
} from './types.js';

registerBuiltinEffects();

export interface PreviewOptions {
  source: ImageSource;
  effect?: string | EffectDefinition;
  effectOptions?: EffectOptions;
  duration?: number;
  easing?: Easing;
  fps?: number;
  maxDimension?: number;
  blockSize?: number;
  seed?: number;
  codec?: ImageCodec;
  /**
   * Longest side the eventual export will use (its `maxDimension`). Combined
   * with `sourceSize`, the preview reproduces the export's block count and its
   * blur, so what you see is what the export produces.
   */
  outputMaxDimension?: number;
  /** Natural pixel size of the source; avoids a second decode to work it out. */
  sourceSize?: { width: number; height: number };
}

export interface PreviewSession {
  readonly width: number;
  readonly height: number;
  readonly blockSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly duration: number;
  readonly fps: number;
  readonly effectName: string;
  /** This frame's size relative to the export's (`1` when no export size was given). */
  readonly renderScale: number;
  /**
   * Render one frame. `progress` is `0..1` and easing is applied for you.
   * Block-based effects accumulate, so render in ascending order — call
   * `reset()` when scrubbing backwards.
   */
  render(progress: number): FrameBuffer;
  /** Rebuild the renderer, discarding accumulated state. */
  reset(): void;
}

/** Prepare a preview session (decodes the source once, no encoding). */
export async function createPreview(options: PreviewOptions): Promise<PreviewSession> {
  const codec = options.codec ?? createBrowserCodec();
  const maxDimension = options.maxDimension ?? defaults.maxDimension;
  const sharp = await codec.decode(options.source, { maxDimension });

  // Mirror the export's geometry when the caller says what the export will be.
  // The grid density and any size-dependent effect decision (Melt's blur) then
  // match the export instead of being derived from this smaller frame — without
  // this, a 720px preview shows blur that a 2560px export does not have.
  let blockSize = options.blockSize;
  let outputBlockSize: number | undefined;
  let renderScale = 1;
  if (options.outputMaxDimension && options.sourceSize) {
    const exportTarget = fitEvenDimensions(
      options.sourceSize.width,
      options.sourceSize.height,
      options.outputMaxDimension,
    );
    const exportBlock = defaultBlockSize(exportTarget.width, exportTarget.height);
    const exportShort = Math.min(exportTarget.width, exportTarget.height);
    const previewShort = Math.min(sharp.width, sharp.height);
    if (exportShort > 0) renderScale = Math.min(1, previewShort / exportShort);
    outputBlockSize = exportBlock;
    if (blockSize === undefined) blockSize = Math.max(1, Math.round(exportBlock * renderScale));
  }

  const job = resolveJob(
    { ...options, ...(blockSize === undefined ? {} : { blockSize }) },
    sharp.width,
    sharp.height,
  );
  const context = createEffectContext({
    sharp,
    blockSize: job.blockSize,
    seed: job.seed,
    renderScale,
    ...(outputBlockSize === undefined ? {} : { outputBlockSize }),
  });

  const buildRenderer = () => {
    context.reseed(job.seed); // identical random sequence for every rebuild
    return job.effect.create(context, job.effectOptions);
  };

  let renderer = buildRenderer();
  let lastProgress = -1;
  const frame = createFrame(sharp.width, sharp.height);

  return {
    width: sharp.width,
    height: sharp.height,
    blockSize: job.blockSize,
    cols: job.cols,
    rows: job.rows,
    frameCount: job.frameCount,
    duration: job.duration,
    fps: job.fps,
    effectName: job.effect.name,
    renderScale,
    render(progress: number): FrameBuffer {
      const eased = job.easing(clamp01(progress));
      if (eased < lastProgress) renderer = buildRenderer();
      lastProgress = eased;
      renderer(eased, frame);
      return frame;
    },
    reset(): void {
      renderer = buildRenderer();
      lastProgress = -1;
    },
  };
}

/** Render + encode + assemble in one call. */
export async function createMotionPhoto(options: ExportOptions): Promise<MotionPhotoResult> {
  if (!isVideoEncodingSupported()) {
    throw new PixelRevealError(
      'UNSUPPORTED_ENVIRONMENT',
      'This browser cannot encode video (WebCodecs VideoEncoder is missing). Chrome 94+ or Edge 94+ required.',
    );
  }

  const report = (event: ProgressEvent): void => options.onProgress?.(event);
  const codec = options.codec ?? createBrowserCodec();
  const maxDimension = options.maxDimension ?? defaults.maxDimension;

  report({ stage: 'decode', progress: 0 });
  const sharp = await codec.decode(options.source, { maxDimension });
  const job = resolveJob(options, sharp.width, sharp.height);

  report({ stage: 'precompute', progress: 0.05 });
  const context = createEffectContext({ sharp, blockSize: job.blockSize, seed: job.seed });
  context.reseed(job.seed);
  const renderer = job.effect.create(context, job.effectOptions);
  const muxer = createMp4Muxer(sharp.width, sharp.height, job.fps);
  const startedAt = Date.now();

  const encoded = await encodeVideo({
    width: sharp.width,
    height: sharp.height,
    fps: job.fps,
    bitrate: job.bitrate,
    frameCount: job.frameCount,
    hardwareAcceleration: job.hardwareAcceleration,
    sink: muxer.sink,
    ...(options.signal ? { signal: options.signal } : {}),
    allocateFrame: (width, height) => createFrame(width, height),
    renderFrame: (index, target) => {
      renderer(job.easing(progressForFrame(index, job.frameCount)), target);
    },
    onFrame: (index, frameCount) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const eta = index > 0 ? Math.round((elapsed / index) * (frameCount - index)) : null;
      report({
        stage: 'encode',
        progress: 0.1 + 0.75 * ((index + 1) / frameCount),
        frame: index + 1,
        frameCount,
        etaSeconds: eta,
      });
    },
  });

  const video = muxer.finish();
  if (video.length < 1024) {
    throw new PixelRevealError(
      'ENCODE_FAILED',
      'Encoded video is suspiciously small; nothing to embed.',
    );
  }

  report({ stage: 'assemble', progress: 0.9 });

  // Cover frame: either the original still or the animation's first frame.
  let coverFrame: FrameBuffer;
  if (job.cover === 'original') {
    coverFrame = sharp;
  } else {
    // Re-seed so the cover's random pattern matches frame 0 of the video.
    context.reseed(job.seed);
    const coverRenderer = job.effect.create(context, job.effectOptions);
    coverFrame = createFrame(sharp.width, sharp.height);
    coverRenderer(0, coverFrame);
  }
  const coverJpeg = await codec.encodeJpeg(coverFrame, 0.95);

  const bytes = assembleMotionPhoto({
    coverJpeg,
    video,
    width: sharp.width,
    height: sharp.height,
    profile: job.metadata.profile,
    appName: job.metadata.appName,
    embedIcc: job.metadata.embedIcc,
    embedMpf: job.metadata.embedMpf,
    // The still is presented at the midpoint of the clip, so galleries that
    // animate on open start from the still and move outward in both directions.
    presentationTimestampUs: Math.round((job.duration * 1_000_000) / 2),
    ...(job.metadata.extraXmpAttributes
      ? { extraXmpAttributes: job.metadata.extraXmpAttributes }
      : {}),
  });

  const inspection = inspectMotionPhoto(bytes);
  if (!inspection.jpeg || !inspection.hasMoov) {
    throw new PixelRevealError(
      'ENCODE_FAILED',
      `Assembled file failed validation (jpeg=${inspection.jpeg}, moov=${inspection.hasMoov}).`,
    );
  }

  report({ stage: 'assemble', progress: 1 });

  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }),
    type: 'image/jpeg',
    width: sharp.width,
    height: sharp.height,
    frameCount: encoded.frameCount,
    durationMs: Math.round(job.duration * 1000),
    codec: encoded.codec,
    bitrate: job.bitrate,
    // WebCodecs does not report whether the encoder is hardware-backed.
    hardwareAccelerated: null,
    videoBytes: video.length,
    bytes: bytes.length,
  };
}

export { bitrateFor, defaults, supportsMotionPhotoExport };
export { PixelRevealError, isPixelRevealError } from './errors.js';
export { createBrowserCodec, frameToImageData } from './platform/browser.js';
export { createFrame } from './frame.js';
export { detectLocale, effectText, translate } from './i18n/index.js';
export { assembleMotionPhoto, inspectMotionPhoto } from './pipeline/motion-photo.js';
export { isVideoEncodingSupported, pickVideoConfig, requiredLevelHex } from './pipeline/encoder.js';
export { encodeVideo, yieldToEventLoop } from './pipeline/encoder.js';
export { createEffectContext, defaultBlurRadius } from './pipeline/precompute.js';
export {
  createRegistry,
  defineBlockEffect,
  defineEffect,
  effects,
  getEffect,
  listEffects,
  registerBuiltinEffects,
  registerEffect,
} from './effects/index.js';
export * as frame from './frame.js';
export type { Mp4MuxerHandle } from './pipeline/muxer.js';
export type { EffectRegistry } from './effects/registry.js';
export type {
  BlockEffectConfig,
  Easing,
  EffectContext,
  EffectDefinition,
  EffectOptions,
  EffectRenderer,
  ExportOptions,
  FrameBuffer,
  HardwareAccelerationPreference,
  ImageCodec,
  ImageSource,
  LocalizedText,
  MetadataOptions,
  MetadataProfileName,
  MotionPhotoResult,
  ProgressEvent,
} from './types.js';
