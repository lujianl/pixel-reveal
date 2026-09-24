/**
 * Public type surface for pixel-reveal.
 *
 * Everything a consumer can customise is described here. The library has no
 * runtime dependencies.
 */

/** A raw RGBA pixel buffer, row-major, 4 bytes per pixel. */
export interface FrameBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A string, or a map of locale -> string (e.g. `{ en: 'Melt', zh: '像素融化' }`). */
export type LocalizedText = string | Readonly<Record<string, string>>;

/** Built-in easing names, or supply your own `(t: number) => number` in `[0,1]`. */
export type Easing =
  | 'linear'
  | 'easeOutQuad'
  | 'easeOutCubic'
  | 'easeInOutQuad'
  | 'easeInOutCubic'
  | ((t: number) => number);

/** Encoder acceleration preference, mirrored from the WebCodecs `hardwareAcceleration` hint. */
export type HardwareAccelerationPreference =
  'no-preference' | 'prefer-hardware' | 'prefer-software';

/** Everything an effect needs to render its animation. */
export interface EffectContext {
  /** Output frame size in pixels (already even-numbered and size-capped). */
  readonly width: number;
  readonly height: number;
  /** Side length of one pixel block, in output pixels. */
  readonly blockSize: number;
  /**
   * Block size the *final output* will use.
   *
   * Equal to `blockSize` when rendering the output itself. A preview renders at
   * a smaller size, so size-dependent decisions (such as how much blur a 20px
   * radius is worth) must be made against the output's block size — otherwise
   * the preview shows blur the export will not have.
   */
  readonly outputBlockSize: number;
  /**
   * Ratio of this frame's size to the intended output size (`1` when rendering
   * the output). Effects that use absolute pixel measurements should multiply
   * them by this.
   */
  readonly renderScale: number;
  /** Block grid dimensions. `cols * rows` is the number of blocks. */
  readonly cols: number;
  readonly rows: number;
  /** Source image resampled to `width` x `height`. */
  readonly sharp: FrameBuffer;
  /** Heavy blur of the source — the "unrevealed" backdrop, before pixelation. */
  readonly blur: FrameBuffer;
  /** `blur` downscaled to the block grid and scaled back up without smoothing. */
  readonly base: FrameBuffer;
  /** Seeded PRNG in `[0,1)`. Use this instead of `Math.random` for reproducible output. */
  readonly random: () => number;
  /**
   * Re-seed the PRNG. The pipeline calls this before every `effect.create()`,
   * so two renderers built from one context (video + cover) see the same
   * random sequence.
   */
  reseed(seed: number): void;
  /** Sharpen-to-blur ladder, cached: `getBlurred(radius)` returns `sharp` blurred by `radius`. */
  getBlurred(radius: number): FrameBuffer;
}

/** Renders one frame at `progress` (`0` = first frame, `1` = fully revealed). */
export type EffectRenderer = (progress: number, frame: FrameBuffer) => void;

/** Per-call knobs handed to an effect (`effectOptions` on the export call). */
export type EffectOptions = Readonly<Record<string, unknown>>;

/** A pluggable animation. Register with `defineEffect()` or pass inline to `createMotionPhoto()`. */
export interface EffectDefinition {
  /** Stable identifier, e.g. `'square'`. */
  readonly name: string;
  /** Human-readable name (localisable). */
  readonly label?: LocalizedText;
  /** One-line description (localisable). */
  readonly description?: LocalizedText;
  /** Animation length in seconds. Falls back to `defaults.duration`. */
  readonly duration?: number;
  /** Progress curve. Falls back to `defaults.easing`. */
  readonly easing?: Easing;
  /** Build a renderer for one generation. Called once per export. */
  create(context: EffectContext, options: EffectOptions): EffectRenderer;
}

/**
 * Convenience factory input for the common case: every block gets a normalised
 * weight in `[0,1]` and is revealed once `progress` passes it.
 */
export interface BlockEffectConfig {
  name: string;
  label?: LocalizedText;
  description?: LocalizedText;
  duration?: number;
  easing?: Easing;
  /** Return one weight per block (length `cols * rows`), row-major. */
  weights(context: EffectContext, options: EffectOptions): Float32Array;
}

/** Supported Motion Photo metadata flavours. */
export type MetadataProfileName = 'google' | 'oplus' | 'none';

export interface MetadataOptions {
  /**
   * - `'google'` (default): plain Google Motion Photo metadata, no device identity.
   * - `'oplus'` : OPPO/OnePlus-flavoured metadata, for galleries that need it.
   *   Carries a device fingerprint from a real device dump — opt in deliberately.
   * - `'none'`  : no Motion Photo metadata (output is a plain JPEG + trailing MP4).
   */
  profile?: MetadataProfileName;
  /** Written to `OpCamera:MotionPhotoOwner` (oplus profile) and the XMP `xmptk`. */
  appName?: string;
  /** Extra XMP properties merged into the `rdf:Description` element. */
  extraXmpAttributes?: Readonly<Record<string, string>>;
  /** Embed the sRGB ICC profile (default `true`). */
  embedIcc?: boolean;
  /** Embed the MPF (Multi-Picture Format) segment (default `true`). */
  embedMpf?: boolean;
}

/** Decoding/encoding hooks, so the core can run outside a browser (tests, workers, Node). */
export interface ImageCodec {
  /** Decode any supported source into a raw RGBA frame. */
  decode(source: ImageSource, options: { maxDimension: number }): Promise<FrameBuffer>;
  /** Encode a frame as baseline JPEG (used for the still cover, not the video). */
  encodeJpeg(frame: FrameBuffer, quality: number): Promise<Uint8Array>;
}

/** Anything the default browser codec can decode. */
export type ImageSource =
  | Blob
  | File
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageData
  | FrameBuffer;

/** Result of a successful export. */
export interface MotionPhotoResult {
  /** The finished still+video file. Save it as `.jpg`. */
  blob: Blob;
  type: 'image/jpeg';
  width: number;
  height: number;
  /** Number of encoded video frames. */
  frameCount: number;
  /** Effective video duration in milliseconds. */
  durationMs: number;
  /** Codec string actually negotiated with the browser (e.g. `avc1.640028`). */
  codec: string;
  /** Average bitrate requested, in bits per second. */
  bitrate: number;
  /** `true` when the browser reported a hardware-accelerated encoder. */
  hardwareAccelerated: boolean | null;
  /** Size of the embedded MP4 payload in bytes. */
  videoBytes: number;
  /** Total file size in bytes. */
  bytes: number;
}

export interface ProgressEvent {
  /** `'decode' | 'precompute' | 'encode' | 'assemble'`. */
  stage: 'decode' | 'precompute' | 'encode' | 'assemble';
  /** `0..1` within the whole job. */
  progress: number;
  /** Frames encoded so far (encode stage only). */
  frame?: number;
  frameCount?: number;
  /** Estimated seconds remaining, or `null` when unknown. */
  etaSeconds?: number | null;
}

export interface ExportOptions {
  /** Source still image. */
  source: ImageSource;
  /** Built-in effect name, or your own `EffectDefinition`. Default `'square'`. */
  effect?: string | EffectDefinition;
  /** Per-call overrides forwarded to the effect's `weights`/`create`. */
  effectOptions?: Readonly<Record<string, unknown>>;
  /** Animation length in seconds. Overrides the effect default. */
  duration?: number;
  /** Progress curve override. */
  easing?: Easing;
  /** Frames per second. Default `30`. */
  fps?: number;
  /** Output is scaled so its longest side is at most this. Default `2560`. */
  maxDimension?: number;
  /** Pixel block side length; default is derived from the frame size. */
  blockSize?: number;
  /** Seed for randomised effects. Same seed + same input => same output. Default `1`. */
  seed?: number;
  /** Cover frame: `'effect'` (first animation frame, default) or `'original'`. */
  cover?: 'effect' | 'original';
  /** Target average bitrate in bits/s. Default is derived from resolution + fps. */
  bitrate?: number;
  /** `'prefer-hardware' | 'prefer-software' | 'no-preference'`. Default `'no-preference'`. */
  hardwareAcceleration?: HardwareAccelerationPreference;
  /** Metadata flavour and branding. */
  metadata?: MetadataOptions;
  /** Replace the browser image codec (tests, workers, Node). */
  codec?: ImageCodec;
  /** Localise built-in effect labels/descriptions in `result`… and demo UI. */
  locale?: string;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

/** Config defaults returned by `defaults()`. */
export interface ResolvedDefaults {
  effect: string;
  duration: number;
  fps: number;
  maxDimension: number;
  bitratePerPixel: number;
  minBitrate: number;
  maxBitrate: number;
  cover: 'effect' | 'original';
  seed: number;
  metadata: Required<Pick<MetadataOptions, 'profile' | 'appName' | 'embedIcc' | 'embedMpf'>>;
}
