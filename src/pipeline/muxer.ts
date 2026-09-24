/** Thin adapter over the vendored mp4-muxer, so the rest of the pipeline never imports it directly. */

import { ArrayBufferTarget, Muxer } from '../vendor/mp4-muxer.js';
import type { VideoChunkSink } from './encoder.js';

export interface Mp4MuxerHandle {
  sink: VideoChunkSink;
  /** Finalise and return the MP4 bytes. */
  finish(): Uint8Array;
}

export function createMp4Muxer(width: number, height: number, fps: number): Mp4MuxerHandle {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    // 'in-memory' puts the moov box first, which is what galleries expect of the
    // MP4 appended to a Motion Photo.
    fastStart: 'in-memory',
    // No `audio` entry: mp4-muxer only writes tracks that are declared, and
    // v5 removed the `audio: false` form.
    video: { codec: 'avc', width, height, frameRate: fps },
  });

  return {
    sink: {
      addVideoChunk(chunk, meta) {
        muxer.addVideoChunk(chunk, meta);
      },
    },
    finish() {
      muxer.finalize();
      return new Uint8Array(target.buffer);
    },
  };
}
