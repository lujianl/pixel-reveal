/**
 * Motion Photo assembly.
 *
 * A Motion Photo is an ordinary JPEG with an MP4 appended after the image data,
 * plus metadata telling the gallery that the trailing bytes are a video:
 *
 *   SOI | APP1(EXIF) | APP1(XMP) | APP0 | APP2(ICC) | APP2(MPF) | <image data> | <mp4>
 *
 * Pure byte manipulation, so it is fully unit-testable outside a browser.
 */

import { PixelRevealError } from '../errors.js';
import { MPF_BASE64, OPLUS_EXIF_BASE64, SRGB_ICC_BASE64, decodeBase64 } from '../metadata/blobs.js';
import { buildExifApp1 } from '../metadata/exif.js';
import { buildXmpApp1 } from '../metadata/xmp.js';
import type { MetadataProfileName } from '../types.js';

const SOI = [0xff, 0xd8];

export interface AssembleMotionPhotoOptions {
  /** The still frame, JPEG-encoded. */
  coverJpeg: Uint8Array;
  /** The encoded video. */
  video: Uint8Array;
  width: number;
  height: number;
  profile: MetadataProfileName;
  appName: string;
  embedIcc: boolean;
  embedMpf: boolean;
  /** Presentation timestamp of the still within the video, in microseconds. */
  presentationTimestampUs: number;
  extraXmpAttributes?: Readonly<Record<string, string>>;
}

export interface JpegSegments {
  /** The JFIF APP0 segment, if the encoder emitted one. */
  app0: Uint8Array;
  /** Offset of the first non-APPn marker (start of the actual image data). */
  offset: number;
}

/**
 * Walk the leading APPn/COM segments of a JPEG.
 * Canvas-generated JPEGs may have no APP0 at all, which is handled.
 */
export function readJpegSegments(jpeg: Uint8Array): JpegSegments {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new PixelRevealError('ENCODE_FAILED', 'Cover frame is not a JPEG (missing SOI marker).');
  }
  let app0 = new Uint8Array(0);
  let offset = 2;
  while (offset + 3 < jpeg.length) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1]!;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (!isApp && !isComment) break;
    const length = (jpeg[offset + 2]! << 8) | jpeg[offset + 3]!;
    if (length < 2 || offset + 2 + length > jpeg.length) break;
    if (marker === 0xe0) app0 = jpeg.slice(offset, offset + 2 + length);
    offset += 2 + length;
  }
  return { app0, offset };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function assembleMotionPhoto(options: AssembleMotionPhotoOptions): Uint8Array {
  const { app0, offset } = readJpegSegments(options.coverJpeg);
  const parts: Uint8Array[] = [new Uint8Array(SOI)];

  if (options.profile === 'oplus') {
    // Opt-in: real-device EXIF. Only reachable when the caller asks for it.
    parts.push(decodeBase64(OPLUS_EXIF_BASE64));
  } else if (options.profile === 'google') {
    parts.push(buildExifApp1({ width: options.width, height: options.height }));
  }

  if (options.profile !== 'none') {
    parts.push(
      buildXmpApp1({
        profile: options.profile,
        appName: options.appName,
        width: options.width,
        height: options.height,
        videoLength: options.video.length,
        presentationTimestampUs: options.presentationTimestampUs,
        ...(options.extraXmpAttributes ? { extraAttributes: options.extraXmpAttributes } : {}),
      }),
    );
  }

  if (app0.length > 0) parts.push(app0);
  if (options.embedIcc) parts.push(decodeBase64(SRGB_ICC_BASE64));
  if (options.embedMpf && options.profile !== 'none') parts.push(decodeBase64(MPF_BASE64));

  parts.push(options.coverJpeg.subarray(offset));
  parts.push(options.video);

  return concat(parts);
}

export function indexOfBytes(haystack: Uint8Array, needle: readonly number[], from = 0): number {
  outer: for (let i = Math.max(0, from); i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export interface MotionPhotoInspection {
  jpeg: boolean;
  motionPhotoMetadata: boolean;
  oplusMetadata: boolean;
  hasIcc: boolean;
  hasMpf: boolean;
  hasFtyp: boolean;
  hasMoov: boolean;
  /** Byte offset where the appended MP4 starts, or -1. */
  videoOffset: number;
}

/** Structural self-check, also used by the test-suite and the demo's diagnostics. */
export function inspectMotionPhoto(bytes: Uint8Array): MotionPhotoInspection {
  const videoOffset = indexOfBytes(bytes, [0x66, 0x74, 0x79, 0x70]); // 'ftyp'
  return {
    jpeg: bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8,
    motionPhotoMetadata:
      indexOfBytes(bytes, [0x4d, 0x6f, 0x74, 0x69, 0x6f, 0x6e, 0x50, 0x68, 0x6f, 0x74, 0x6f]) >= 0, // 'MotionPhoto'
    oplusMetadata: indexOfBytes(bytes, [0x4f, 0x70, 0x43, 0x61, 0x6d, 0x65, 0x72, 0x61]) >= 0, // 'OpCamera'
    hasIcc:
      indexOfBytes(bytes, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45]) >= 0, // 'ICC_PROFILE'
    hasMpf: indexOfBytes(bytes, [0x4d, 0x50, 0x46, 0x00]) >= 0, // 'MPF\0'
    hasFtyp: videoOffset >= 0,
    hasMoov: indexOfBytes(bytes, [0x6d, 0x6f, 0x6f, 0x76]) >= 0, // 'moov'
    videoOffset,
  };
}
