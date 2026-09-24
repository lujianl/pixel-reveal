/**
 * WebCodecs wrapper.
 *
 * Isolated behind a small surface so an alternative encoder (WASM, server-side)
 * can be dropped in later without touching the rest of the pipeline.
 */

import { PixelRevealError } from '../errors.js';
import type { FrameBuffer, HardwareAccelerationPreference } from '../types.js';

/** H.264 level ceilings, by macroblock count (`maxFS`). */
const H264_LEVELS: ReadonlyArray<{ maxFs: number; hex: string }> = [
  { maxFs: 8192, hex: '28' }, // 4.0
  { maxFs: 8704, hex: '2a' }, // 4.2
  { maxFs: 22080, hex: '32' }, // 5.0
  { maxFs: 36864, hex: '33' }, // 5.1
  { maxFs: 139264, hex: '3c' }, // 6.0
];

/** Tried in order; the first the browser reports as supported wins. */
const H264_PROFILES = ['6400', '4d00', '4200'] as const; // High, Main, Baseline

export function isVideoEncodingSupported(): boolean {
  return typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
}

export function requiredLevelHex(width: number, height: number): string {
  const macroBlocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = H264_LEVELS.find((entry) => macroBlocks <= entry.maxFs);
  return (level ?? H264_LEVELS[H264_LEVELS.length - 1]!).hex;
}

export interface EncoderConfigOptions {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  hardwareAcceleration?: HardwareAccelerationPreference;
}

/**
 * Pick the best encoder configuration the current browser actually supports.
 * Levels are derived from the frame size so we never request a level the
 * resolution violates (a common cause of "encoder not supported" failures).
 */
export async function pickVideoConfig(options: EncoderConfigOptions): Promise<VideoEncoderConfig> {
  const level = requiredLevelHex(options.width, options.height);
  const base = {
    width: options.width,
    height: options.height,
    bitrate: options.bitrate,
    framerate: options.fps,
    latencyMode: 'quality' as const,
    ...(options.hardwareAcceleration ? { hardwareAcceleration: options.hardwareAcceleration } : {}),
  };

  if (typeof VideoEncoder.isConfigSupported === 'function') {
    for (const profile of H264_PROFILES) {
      const candidate: VideoEncoderConfig = {
        ...base,
        codec: `avc1.${profile}${level}`,
        avc: { format: 'avc' },
      };
      try {
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support?.supported) return candidate;
      } catch {
        // Some engines reject unknown codec strings by throwing; try the next one.
      }
    }
  }

  return { ...base, codec: `avc1.6400${level}`, avc: { format: 'avc' } };
}

/** Sink for encoded chunks — implemented by the MP4 muxer. */
export interface VideoChunkSink {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
}

export interface EncodeVideoOptions {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  frameCount: number;
  hardwareAcceleration?: HardwareAccelerationPreference;
  /** Fill `target` with frame `index` (0-based). */
  renderFrame(index: number, target: FrameBuffer): void;
  /** Allocates the buffer handed to `renderFrame`; override to reuse memory. */
  allocateFrame?: (width: number, height: number) => FrameBuffer;
  sink: VideoChunkSink;
  /** Cap on queued frames before the loop yields. */
  maxQueueSize?: number;
  signal?: AbortSignal;
  onFrame?: (index: number, frameCount: number) => void;
}

export interface EncodeVideoResult {
  /** Codec string actually used, e.g. `avc1.640028`. */
  codec: string;
  frameCount: number;
}

/**
 * Yield to the event loop without the ~4 ms clamp that nested `setTimeout(…, 0)`
 * calls incur, so a long encode stays responsive without dragging.
 *
 * Two engine quirks are handled here, both verified in a real browser:
 *
 * 1. The port must be started by assigning `onmessage`. Adding a `message`
 *    listener with `addEventListener` does **not** start it in Chromium, which
 *    silently leaves the returned promise pending forever.
 * 2. Node keeps the process alive while a port is open, so ports are `unref`'d
 *    (a no-op in browsers, where the method does not exist).
 *
 * Resolvers are queued, so concurrent yields cannot clobber each other.
 */
const yieldQueue: Array<() => void> = [];

type UnrefablePort = { unref?: () => void; onmessage: ((event: unknown) => void) | null };

let yieldChannel: MessageChannel | null = null;

function getYieldChannel(): MessageChannel | null {
  if (yieldChannel) return yieldChannel;
  if (typeof MessageChannel !== 'function') return null;
  const channel = new MessageChannel();
  (channel.port1 as unknown as UnrefablePort).onmessage = () => {
    const next = yieldQueue.shift();
    if (next) next();
  };
  (channel.port1 as unknown as UnrefablePort).unref?.();
  (channel.port2 as unknown as UnrefablePort).unref?.();
  yieldChannel = channel;
  return channel;
}

export function yieldToEventLoop(): Promise<void> {
  const channel = getYieldChannel();
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    yieldQueue.push(resolve);
    channel.port2.postMessage(0);
  });
}

function allocateDefault(width: number, height: number): FrameBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export async function encodeVideo(options: EncodeVideoOptions): Promise<EncodeVideoResult> {
  if (!isVideoEncodingSupported()) {
    throw new PixelRevealError(
      'UNSUPPORTED_ENVIRONMENT',
      'WebCodecs VideoEncoder is not available in this environment (Chrome 94+/Edge 94+ required).',
    );
  }

  const config = await pickVideoConfig({
    width: options.width,
    height: options.height,
    fps: options.fps,
    bitrate: options.bitrate,
    hardwareAcceleration: options.hardwareAcceleration,
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => options.sink.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error(String(error));
    },
  });

  try {
    encoder.configure(config);
  } catch (error) {
    // configure() reports most problems through the error callback, but a bad
    // codec string or an invalid dictionary still throws synchronously. Retry
    // once at Baseline, keeping `avc` formatting so SPS/PPS stay extractable.
    const fallback: VideoEncoderConfig = {
      codec: `avc1.4200${requiredLevelHex(options.width, options.height)}`,
      width: options.width,
      height: options.height,
      bitrate: options.bitrate,
      framerate: options.fps,
      avc: { format: 'avc' },
    };
    try {
      encoder.configure(fallback);
    } catch {
      encoder.close();
      throw new PixelRevealError('ENCODE_FAILED', 'Failed to configure the video encoder.', error);
    }
  }

  const allocate = options.allocateFrame ?? allocateDefault;
  const frameDurationUs = Math.round(1_000_000 / options.fps);
  const keyFrameInterval = Math.max(1, Math.round(options.fps));
  const maxQueue = Math.max(1, options.maxQueueSize ?? 4);
  const codec = config.codec;

  try {
    for (let index = 0; index < options.frameCount; index++) {
      if (options.signal?.aborted) {
        throw new PixelRevealError('ABORTED', 'Export aborted.');
      }
      if (encoderError) throw encoderError;

      const buffer = allocate(options.width, options.height);
      options.renderFrame(index, buffer);

      const videoFrame = new VideoFrame(buffer.data, {
        format: 'RGBA',
        codedWidth: options.width,
        codedHeight: options.height,
        timestamp: index * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(videoFrame, { keyFrame: index % keyFrameInterval === 0 });
      videoFrame.close();

      if ('encodeQueueSize' in encoder) {
        while (encoder.encodeQueueSize > maxQueue) {
          if (encoderError) throw encoderError;
          await yieldToEventLoop();
        }
      }
      if (index % 2 === 0 || index === options.frameCount - 1) {
        options.onFrame?.(index, options.frameCount);
        await yieldToEventLoop();
      }
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  return { codec, frameCount: options.frameCount };
}
