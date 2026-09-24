import { describe, expect, it } from 'vitest';

import { PixelRevealError } from '../src/errors.js';
import { buildExifApp1 } from '../src/metadata/exif.js';
import { buildXmpApp1, buildXmpPacket, escapeXmlAttribute } from '../src/metadata/xmp.js';
import {
  assembleMotionPhoto,
  indexOfBytes,
  inspectMotionPhoto,
  readJpegSegments,
} from '../src/pipeline/motion-photo.js';
import { fakeCoverJpeg, fakeVideo } from './helpers.js';

const baseOptions = {
  width: 320,
  height: 180,
  appName: 'pixel-reveal',
  embedIcc: true,
  embedMpf: true,
  presentationTimestampUs: 1_250_000,
};

describe('readJpegSegments', () => {
  it('finds APP0 and the first non-APP marker', () => {
    const jpeg = fakeCoverJpeg();
    const { app0, offset } = readJpegSegments(jpeg);
    expect(app0[0]).toBe(0xff);
    expect(app0[1]).toBe(0xe0);
    expect(app0.length).toBe(2 + 2 + 14);
    expect(jpeg[offset]).toBe(0xff);
    expect(jpeg[offset + 1]).toBe(0xdb);
  });

  it('handles a JPEG with no APP0', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0, 0, 0xff, 0xd9]);
    const { app0, offset } = readJpegSegments(bare);
    expect(app0.length).toBe(0);
    expect(offset).toBe(2);
  });

  it('rejects a non-JPEG cover', () => {
    expect(() => readJpegSegments(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(
      PixelRevealError,
    );
  });

  it('stops on a truncated segment instead of reading past the end', () => {
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00]);
    const { offset } = readJpegSegments(truncated);
    expect(offset).toBe(2);
  });
});

describe('assembleMotionPhoto', () => {
  const cover = fakeCoverJpeg();
  const video = fakeVideo();

  it('starts with SOI and appends the video verbatim', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'google',
    });
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(Array.from(bytes.subarray(bytes.length - video.length))).toEqual(Array.from(video));
  });

  it('keeps the cover APP0 segment', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'google',
    });
    expect(indexOfBytes(bytes, [0xff, 0xe0])).toBeGreaterThan(0);
  });

  it('writes generic Motion Photo metadata by default', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'google',
    });
    const info = inspectMotionPhoto(bytes);
    expect(info).toMatchObject({
      jpeg: true,
      motionPhotoMetadata: true,
      oplusMetadata: false,
      hasIcc: true,
      hasMpf: true,
      hasFtyp: true,
      hasMoov: true,
    });
    expect(info.videoOffset).toBeGreaterThan(0);
  });

  it('does not leak device identity in the default profile', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'google',
    });
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, 2000));
    expect(text).not.toContain('OpCamera');
    expect(text).not.toContain('oplus');
    // The legacy device EXIF carries this application identifier.
    expect(text).not.toContain('pixel_melt_photos');
  });

  it('opts into OPPO metadata only when asked', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'oplus',
    });
    const info = inspectMotionPhoto(bytes);
    expect(info.oplusMetadata).toBe(true);
    expect(info.motionPhotoMetadata).toBe(true);
  });

  it('can omit metadata entirely', () => {
    const bytes = assembleMotionPhoto({ ...baseOptions, coverJpeg: cover, video, profile: 'none' });
    const info = inspectMotionPhoto(bytes);
    expect(info.motionPhotoMetadata).toBe(false);
    expect(info.hasMpf).toBe(false);
    // The trailer is still present for readers that understand it.
    expect(info.hasMoov).toBe(true);
  });

  it('honours the ICC/MPF switches', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'google',
      embedIcc: false,
      embedMpf: false,
    });
    const info = inspectMotionPhoto(bytes);
    expect(info.hasIcc).toBe(false);
    expect(info.hasMpf).toBe(false);
  });

  it('records the real video length in the container directory', () => {
    const bytes = assembleMotionPhoto({
      ...baseOptions,
      coverJpeg: cover,
      video,
      profile: 'google',
    });
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, 4000));
    expect(text).toContain(`Item:Length="${video.length}"`);
    expect(text).toContain('Item:Semantic="MotionPhoto"');
    expect(text).toContain('Item:Semantic="Primary"');
  });
});

describe('xmp generation', () => {
  it('escapes attribute values', () => {
    expect(escapeXmlAttribute('a&b<c>"d\'')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
    const packet = buildXmpPacket({
      profile: 'oplus',
      appName: '"evil" & <tag>',
      width: 10,
      height: 10,
      videoLength: 5,
      presentationTimestampUs: 1,
    });
    expect(packet).not.toContain('"evil"');
    expect(packet).toContain('&quot;evil&quot; &amp; &lt;tag&gt;');
  });

  it('wraps the packet in a correctly sized APP1 segment', () => {
    const segment = buildXmpApp1({
      profile: 'google',
      appName: 'x',
      width: 1,
      height: 1,
      videoLength: 2,
      presentationTimestampUs: 3,
    });
    const declared = (segment[2]! << 8) | segment[3]!;
    expect(segment[0]).toBe(0xff);
    expect(segment[1]).toBe(0xe1);
    expect(declared).toBe(segment.length - 2);
    expect(new TextDecoder().decode(segment.subarray(4, 32))).toContain('ns.adobe.com/xap/1.0/');
  });
});

describe('generated EXIF', () => {
  it('declares a self-consistent segment length', () => {
    const segment = buildExifApp1({ width: 100, height: 50 });
    const declared = (segment[2]! << 8) | segment[3]!;
    expect(segment[0]).toBe(0xff);
    expect(segment[1]).toBe(0xe1);
    expect(declared).toBe(segment.length - 2);
    expect(new TextDecoder().decode(segment.subarray(4, 10))).toBe('Exif\0\0');
  });

  it('writes a little-endian TIFF header pointing at a valid IFD0', () => {
    const segment = buildExifApp1({ width: 100, height: 50, orientation: 6 });
    const view = new DataView(segment.buffer, segment.byteOffset);
    const tiffStart = 10; // after marker + length + 'Exif\0\0'
    expect(segment[tiffStart]).toBe(0x49); // 'I'
    expect(segment[tiffStart + 1]).toBe(0x49);
    expect(view.getUint16(tiffStart + 2, true)).toBe(42);

    const ifd = tiffStart + view.getUint32(tiffStart + 4, true);
    const entries = view.getUint16(ifd, true);
    expect(entries).toBe(2);

    const first = ifd + 2;
    expect(view.getUint16(first, true)).toBe(0x0112); // Orientation
    expect(view.getUint16(first + 2, true)).toBe(3); // SHORT
    expect(view.getUint32(first + 4, true)).toBe(1); // count
    expect(view.getUint16(first + 8, true)).toBe(6);

    const second = first + 12;
    expect(view.getUint16(second, true)).toBe(0xa001); // ColorSpace
    expect(view.getUint16(second + 8, true)).toBe(1); // sRGB

    // Last 4 bytes of the IFD chain must terminate.
    expect(view.getUint32(second + 12, true)).toBe(0);
  });

  it('falls back to orientation 1 for nonsense values', () => {
    for (const orientation of [0, 9, -3, Number.NaN]) {
      const segment = buildExifApp1({ width: 4, height: 4, orientation });
      const view = new DataView(segment.buffer, segment.byteOffset);
      const ifd = 10 + view.getUint32(14, true);
      expect(view.getUint16(ifd + 2 + 8, true), `orientation ${orientation}`).toBe(1);
    }
  });

  it('is small — no device dump', () => {
    expect(buildExifApp1({ width: 10, height: 10 }).length).toBeLessThan(64);
  });
});

describe('indexOfBytes', () => {
  it('finds and misses correctly', () => {
    const haystack = new Uint8Array([1, 2, 3, 4, 5]);
    expect(indexOfBytes(haystack, [3, 4])).toBe(2);
    expect(indexOfBytes(haystack, [3, 4], 3)).toBe(-1);
    expect(indexOfBytes(haystack, [9])).toBe(-1);
  });
});
