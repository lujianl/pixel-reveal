/** Shared fixtures for the test-suite. */

import { createFrame } from '../src/frame.js';
import type { FrameBuffer } from '../src/types.js';

/** Deterministic synthetic photo: gradient + a bright block + a dark block. */
export function makeTestImage(width = 64, height = 48): FrameBuffer {
  const frame = createFrame(width, height);
  const data = frame.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      data[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      data[offset + 2] = 128;
      data[offset + 3] = 255;
    }
  }
  fillRect(frame, 4, 4, Math.floor(width / 4), Math.floor(height / 4), [255, 255, 255, 255]);
  fillRect(
    frame,
    Math.floor(width / 2),
    Math.floor(height / 2),
    Math.floor(width / 3),
    Math.floor(height / 3),
    [0, 0, 0, 255],
  );
  return frame;
}

export function fillRect(
  frame: FrameBuffer,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgba: readonly [number, number, number, number],
): void {
  for (let y = y0; y < Math.min(y0 + h, frame.height); y++) {
    for (let x = x0; x < Math.min(x0 + w, frame.width); x++) {
      const offset = (y * frame.width + x) * 4;
      frame.data[offset] = rgba[0];
      frame.data[offset + 1] = rgba[1];
      frame.data[offset + 2] = rgba[2];
      frame.data[offset + 3] = rgba[3];
    }
  }
}

export function sameBytes(
  a: Uint8ClampedArray | Uint8Array,
  b: Uint8ClampedArray | Uint8Array,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A frame where the first pixel of every block is unmistakable, so reveal state
 * can be read back unambiguously (the block average never equals that pixel).
 */
export function makeBlockDistinctImage(
  width: number,
  height: number,
  blockSize: number,
): FrameBuffer {
  const frame = createFrame(width, height);
  for (let i = 0; i < frame.data.length; i += 4) {
    frame.data[i] = 128;
    frame.data[i + 1] = 128;
    frame.data[i + 2] = 128;
    frame.data[i + 3] = 255;
  }
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x = bx * blockSize;
      const y = by * blockSize;
      const offset = (y * width + x) * 4;
      const marker: [number, number] = (bx + by) % 2 === 0 ? [255, 0] : [0, 255];
      frame.data[offset] = marker[0];
      frame.data[offset + 1] = marker[1];
      frame.data[offset + 2] = 64;
    }
  }
  return frame;
}

/** A synthetic minimal JPEG: SOI + APP0(JFIF) + a fake DQT marker + EOI. */
export function fakeCoverJpeg(): Uint8Array {
  const app0Payload = new Uint8Array(14).fill(0x20);
  const app0Length = app0Payload.length + 2;
  const dqt = new Uint8Array([0xff, 0xdb, 0x00, 0x04, 0x00, 0x11]);
  const out = new Uint8Array(2 + 2 + app0Length + dqt.length + 2);
  let offset = 0;
  out.set([0xff, 0xd8], offset);
  offset += 2;
  out.set([0xff, 0xe0, (app0Length >> 8) & 0xff, app0Length & 0xff], offset);
  offset += 4;
  out.set(app0Payload, offset);
  offset += app0Payload.length;
  out.set(dqt, offset);
  offset += dqt.length;
  out.set([0xff, 0xd9], offset);
  return out;
}

/** A payload shaped like an MP4 header, for structural assertions. */
export function fakeVideo(payloadBytes = 2048): Uint8Array {
  const video = new Uint8Array(payloadBytes);
  video.set([0x00, 0x00, 0x00, 0x18], 0);
  video.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  video.set([0x6d, 0x6f, 0x6f, 0x76], 64); // 'moov'
  return video;
}
