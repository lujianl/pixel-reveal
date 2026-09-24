/**
 * Default in-browser image codec.
 *
 * Only used for I/O: decoding the still once, and JPEG-encoding the cover once.
 * The per-frame render path never touches canvas, so browser rasterisation
 * differences cannot affect the animation.
 *
 * The source is drawn at its natural size and then resampled with our own
 * integer area filter, which keeps the downscale deterministic instead of
 * depending on each browser's `drawImage` implementation.
 */

import { fitEvenDimensions } from '../config.js';
import { PixelRevealError } from '../errors.js';
import { resampleArea } from '../frame.js';
import type { FrameBuffer, ImageCodec, ImageSource } from '../types.js';

export interface BrowserCodecOptions {
  /** Reject sources larger than this many pixels (default 32 MP). */
  maxPixels?: number;
  /** Reject sources smaller than this on the shortest side (default 64). */
  minDimension?: number;
}

const DEFAULT_MAX_PIXELS = 32 * 1024 * 1024;
const DEFAULT_MIN_DIMENSION = 64;

type Decoded =
  | { kind: 'pixels'; width: number; height: number; data: Uint8ClampedArray }
  | {
      kind: 'drawable';
      drawable: CanvasImageSource;
      width: number;
      height: number;
      release(): void;
    };

function isFrameBufferLike(source: unknown): source is FrameBuffer {
  return (
    typeof source === 'object' &&
    source !== null &&
    'data' in source &&
    (source as FrameBuffer).data instanceof Uint8ClampedArray &&
    'width' in source &&
    'height' in source &&
    typeof (source as FrameBuffer).width === 'number' &&
    typeof (source as FrameBuffer).height === 'number'
  );
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new PixelRevealError(
    'UNSUPPORTED_ENVIRONMENT',
    'No canvas implementation available; pass a custom ImageCodec.',
  );
}

type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function context2d(canvas: OffscreenCanvas | HTMLCanvasElement): AnyContext2D {
  const context = canvas.getContext('2d') as AnyContext2D | null;
  if (!context)
    throw new PixelRevealError('DECODE_FAILED', 'Could not acquire a 2D canvas context.');
  return context;
}

async function toDecoded(source: ImageSource): Promise<Decoded> {
  // Already raw pixels — no decode, and the caller's buffer is only ever read.
  if (isFrameBufferLike(source)) {
    return { kind: 'pixels', width: source.width, height: source.height, data: source.data };
  }
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    return { kind: 'pixels', width: source.width, height: source.height, data: source.data };
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return {
      kind: 'drawable',
      drawable: source,
      width: source.width,
      height: source.height,
      release: () => source.close(),
    };
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return {
      kind: 'drawable',
      drawable: source,
      width: source.width,
      height: source.height,
      release: () => {},
    };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return {
      kind: 'drawable',
      drawable: source,
      width: source.width,
      height: source.height,
      release: () => {},
    };
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return {
      kind: 'drawable',
      drawable: source,
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
      release: () => {},
    };
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (typeof createImageBitmap !== 'function') {
      throw new PixelRevealError('UNSUPPORTED_ENVIRONMENT', 'createImageBitmap is unavailable.');
    }
    // `from-image` bakes EXIF rotation into the pixels, so no orientation tag is needed later.
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    return {
      kind: 'drawable',
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }
  throw new PixelRevealError('DECODE_FAILED', 'Unsupported image source.');
}

export function createBrowserCodec(options: BrowserCodecOptions = {}): ImageCodec {
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const minDimension = options.minDimension ?? DEFAULT_MIN_DIMENSION;

  return {
    async decode(source, { maxDimension }): Promise<FrameBuffer> {
      const decoded = await toDecoded(source);
      try {
        const { width, height } = decoded;
        if (width < minDimension || height < minDimension) {
          throw new PixelRevealError(
            'IMAGE_TOO_SMALL',
            `Image is too small (${width}x${height}); the minimum is ${minDimension}px.`,
          );
        }
        if (width * height > maxPixels) {
          throw new PixelRevealError(
            'IMAGE_TOO_LARGE',
            `Image is too large (${width}x${height}); the limit is ${Math.round(maxPixels / 1_000_000)} MP.`,
          );
        }

        let natural: FrameBuffer;
        if (decoded.kind === 'pixels') {
          natural = { width, height, data: decoded.data };
        } else {
          const canvas = createCanvas(width, height);
          const context = context2d(canvas);
          context.drawImage(decoded.drawable, 0, 0, width, height);
          const imageData = context.getImageData(0, 0, width, height);
          natural = { width, height, data: imageData.data as Uint8ClampedArray };
        }

        const target = fitEvenDimensions(width, height, maxDimension);
        if (target.width === width && target.height === height) return natural;
        return resampleArea(natural, target.width, target.height);
      } finally {
        if (decoded.kind === 'drawable') decoded.release();
      }
    },

    async encodeJpeg(frame, quality): Promise<Uint8Array> {
      const canvas = createCanvas(frame.width, frame.height);
      const context = context2d(canvas);
      context.putImageData(frameToImageData(frame), 0, 0);
      if (typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        return new Uint8Array(await blob.arrayBuffer());
      }
      const htmlCanvas = canvas as HTMLCanvasElement;
      const blob = await new Promise<Blob | null>((resolve) =>
        htmlCanvas.toBlob((value) => resolve(value), 'image/jpeg', quality),
      );
      if (!blob) throw new PixelRevealError('ENCODE_FAILED', 'JPEG encoding failed.');
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

/** True when the current environment can encode video in-page. */
export function supportsMotionPhotoExport(): boolean {
  return typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
}

/**
 * Wrap a frame as `ImageData` so it can be handed to `putImageData`.
 *
 * The cast narrows the backing store to `ArrayBuffer`: frames produced by this
 * library are always backed by a plain (never shared) buffer, but TypeScript's
 * `Uint8ClampedArray` default allows `SharedArrayBuffer`.
 */
export function frameToImageData(frame: FrameBuffer): ImageData {
  return new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height);
}
