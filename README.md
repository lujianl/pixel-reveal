# pixel-reveal

Turn a still photo into a **Motion Photo** (Live Photo) with a pixel-reveal animation — entirely in the browser. No upload, no backend, no runtime dependencies.

[![CI](https://github.com/lujianl/pixel-reveal/actions/workflows/ci.yml/badge.svg)](https://github.com/lujianl/pixel-reveal/actions/workflows/ci.yml)
[![Browser smoke test](https://github.com/lujianl/pixel-reveal/actions/workflows/e2e.yml/badge.svg)](https://github.com/lujianl/pixel-reveal/actions/workflows/e2e.yml)

![The demo mid-reveal: a photo half dissolved into pixel blocks, with the effect picker on the right](docs/screenshot.png)

```ts
import { createMotionPhoto } from 'pixel-reveal';

const { blob } = await createMotionPhoto({
  source: file, // File | Blob | ImageBitmap | canvas | ImageData | FrameBuffer
  effect: 'scatter',
  duration: 2.5,
});

// Save it as .jpg — camera rolls treat it as a Motion Photo.
download(blob, 'motion-photo.jpg');
```

---

## Why

A Motion Photo is a JPEG with an MP4 appended, plus metadata telling the gallery "there is a video in here". Producing one needs four things: frame rendering, H.264 encoding, MP4 muxing, and container assembly. This library does all four locally.

- **Private by construction** — the photo never leaves the device. Nothing to upload, no analytics.
- **Zero runtime dependencies** — the MP4 muxer (mp4-muxer 5.2.2) is vendored with its licence; the bundle is ~22 KB gzipped.
- **Customisable to the core** — an effect is a ~10 line function, not a plugin registration dance.
- **Testable** — the render path is pure pixel maths with no canvas, so it runs in Node and is unit tested.

## Features

|                      |                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------ |
| 9 built-in effects   | Melt, Scatter, Diagonal, Rain, Luminance, Expand, Spiral, Ripple, Bloom              |
| Live preview API     | `createPreview()` renders frames without encoding, for a scrubber or looping preview |
| Deterministic frames | Same input + options = same frames (seeded PRNG, no `Math.random`)                   |
| Encoder negotiation  | Picks the best H.264 profile/level the browser supports, with queue backpressure     |
| Metadata profiles    | `google` (default), `oplus`, `none`, plus custom XMP attributes                      |
| i18n-ready           | Effect labels accept `{ en, zh, … }`; `translate()` resolves them                    |
| Worker-friendly      | No DOM dependency in the render path                                                 |

## Install

```bash
npm install pixel-reveal
```

Or drop the standalone build into a page — it exposes a global `PixelReveal`:

```html
<script src="dist/pixel-reveal.iife.js"></script>
<script>
  const { createMotionPhoto } = PixelReveal;
</script>
```

## Usage

### Export a Motion Photo

```ts
import { createMotionPhoto, PixelRevealError } from 'pixel-reveal';

try {
  const result = await createMotionPhoto({
    source: file,
    effect: 'ripple',
    fps: 30,
    duration: 3,
    maxDimension: 2560, // longest side of the output
    blockSize: 32, // pixel block size; omit to derive it from the frame
    seed: 7, // same seed => same random pattern
    cover: 'effect', // 'effect' (first frame) | 'original'
    metadata: { profile: 'google', appName: 'my-app' },
    onProgress: ({ stage, progress, frame, frameCount, etaSeconds }) => {
      console.log(stage, progress, frame, frameCount, etaSeconds);
    },
  });

  console.log(result.width, result.height, result.codec, result.bytes);
  const url = URL.createObjectURL(result.blob);
} catch (error) {
  if (error instanceof PixelRevealError) console.error(error.code, error.message);
}
```

### Live preview

`createPreview()` decodes once and hands you frames, so you can animate or scrub before spending time on an export.

```ts
import { createPreview, frameToImageData } from 'pixel-reveal';

const preview = await createPreview({ source: file, effect: 'spiral', maxDimension: 720 });
canvas.width = preview.width;
canvas.height = preview.height;

const ctx = canvas.getContext('2d');
for (let i = 0; i <= 30; i++) {
  const frame = preview.render(i / 30);
  ctx.putImageData(frameToImageData(frame), 0, 0);
  await new Promise((r) => requestAnimationFrame(r));
}
```

> Block-based effects accumulate as progress advances. Render in ascending order, or call `preview.reset()` when you jump backwards.

### Write your own effect

Most effects are just "one weight per block; reveal the block once progress passes it". That is the whole API:

```ts
import { defineBlockEffect, registerEffect } from 'pixel-reveal';

registerEffect(
  defineBlockEffect({
    name: 'wipe',
    label: { en: 'Wipe', zh: '横向擦除' },
    description: { en: 'Sweeps left to right', zh: '从左向右扫过' },
    duration: 2,
    easing: 'easeOutQuad',
    weights: (ctx) => {
      const weights = new Float32Array(ctx.cols * ctx.rows);
      for (let by = 0; by < ctx.rows; by++) {
        for (let bx = 0; bx < ctx.cols; bx++) {
          weights[by * ctx.cols + bx] = (bx + 1) / ctx.cols; // normalised: max must reach 1
        }
      }
      return weights;
    },
  }),
);
```

`weights()` may read `effectOptions`, so one effect can serve many looks (`from: 'topLeft'`, `points: 9`, …). See `src/effects/builtin/` for nine worked examples.

For full control, `defineEffect()` hands you the frame buffer:

```ts
import { defineEffect, frame } from 'pixel-reveal';

registerEffect(
  defineEffect({
    name: 'soft',
    label: 'Soft',
    duration: 2,
    create: (ctx) => (progress, target) => {
      frame.copyInto(target, ctx.sharp);
      frame.blendInto(target, ctx.blur, 1 - progress); // bloom out of a blur
    },
  }),
);
```

`EffectContext` provides `sharp` (source at output size), `blur` (heavy blur), `base` (pixelated backdrop), the block grid (`blockSize`, `cols`, `rows`), `random()` (seeded), `getBlurred(radius)` (cached), and `reseed()`.

### Options

| Option                 | Default                 | Notes                                                                                      |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `source`               | —                       | `File`, `Blob`, `ImageBitmap`, `HTMLImageElement`, canvas, `ImageData`, or a `FrameBuffer` |
| `effect`               | `'square'`              | Built-in name or an `EffectDefinition`                                                     |
| `effectOptions`        | `{}`                    | Forwarded to the effect's `weights()` / `create()`                                         |
| `duration`             | effect default          | Seconds                                                                                    |
| `easing`               | effect default          | Named curve or `(t) => t`                                                                  |
| `fps`                  | `30`                    |                                                                                            |
| `maxDimension`         | `2560`                  | Longest output side; dimensions are forced even for 4:2:0 chroma                           |
| `blockSize`            | derived                 | Pixel block side, in output pixels                                                         |
| `seed`                 | `1`                     | Seeds randomised effects                                                                   |
| `cover`                | `'effect'`              | Still frame: first animation frame, or the untouched photo                                 |
| `bitrate`              | derived                 | ~0.12 bit/pixel/frame, clamped to 6–20 Mbps                                                |
| `hardwareAcceleration` | `'no-preference'`       | Hint passed to the encoder                                                                 |
| `metadata`             | `{ profile: 'google' }` | See below                                                                                  |
| `codec`                | browser codec           | Swap for tests, workers, or a non-browser host                                             |
| `locale`               | `'en'`                  | Affects resolved labels only                                                               |
| `signal`               | —                       | `AbortSignal` to cancel mid-encode                                                         |
| `onProgress`           | —                       | Called with `{ stage, progress, frame, frameCount, etaSeconds }`                           |

Resolves with `{ blob, type, width, height, frameCount, durationMs, codec, bitrate, hardwareAccelerated, videoBytes, bytes }`.

## Motion Photo metadata

Read this before shipping.

A Motion Photo is a JPEG with the MP4 appended after the image data, plus metadata telling the gallery the trailing bytes are playable:

```
SOI │ APP1(EXIF) │ APP1(XMP) │ APP0 │ APP2(ICC) │ APP2(MPF) │ <image data> │ <mp4>
```

| Profile                | What it writes                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google` **(default)** | Generic Google Motion Photo metadata (`GCamera:MotionPhoto*` + a `Container:Directory`). The EXIF segment is generated on the spot and contains only `Orientation` and `ColorSpace`. **No device identity.**                                                                          |
| `oplus`                | Adds `OpCamera:*` properties and embeds an EXIF blob taken from a real OPPO/OnePlus device dump — including that device's fingerprint. Enable it only if a specific gallery refuses the default, and be aware you are shipping files that claim to come from hardware you do not own. |
| `none`                 | The MP4 is appended, but no container metadata is written. Most galleries will show a still.                                                                                                                                                                                          |

Whether a given phone _animates_ the file depends on its gallery app, which no code can guarantee. Test on the devices you care about; `inspectMotionPhoto()` reports the container structure so you can rule that out first.

## Determinism

Guaranteed within one build and one engine:

- Integer/float pixel maths only, no `Math.random` (randomised effects use a seeded PRNG).
- The same `seed` + `maxDimension` + `blockSize` + `effect` produces identical frames.

Not guaranteed:

- **Byte-identical files across browsers.** The H.264 encoder is chosen by the browser (hardware vs software, profile support, chroma handling), so the video bits differ per device. Frame _content_ is identical; the encoded bytes are not. For byte-identical output everywhere, replace the encoder behind `encodeVideo()` (WASM or server-side).
- **`spiral` uses `Math.atan2`** to order blocks. The spec does not pin its precision, so tie-breaking between near-identical angles could vary between engines. Nothing downstream is bit-sensitive.

## Browser support

Encoding needs **WebCodecs** (`VideoEncoder` / `VideoFrame`). It is not a Baseline API — Chrome 94+ and Edge 94+ are the reliable targets; Firefox and Safari lag or lack parts. Everything except the final export (preview, effect authoring, tests) works without it, and `supportsMotionPhotoExport()` lets you degrade gracefully.

## Development

```bash
npm install
npm run dev          # demo on http://localhost:5173
npm run typecheck    # tsc --noEmit
npm test             # vitest (103 cases, plain Node)
npm run build        # library -> dist/, demo -> dist-demo/
npm run format       # prettier
```

### Testing the browser-only path

The unit tests run in Node, which cannot execute WebCodecs. The encode → mux → assemble pipeline is covered by a browser smoke test instead:

```bash
npm run build
npm run preview                                 # serves dist-demo on :4173
npm run test:e2e -- http://localhost:4173/      # in another terminal
```

It drives a headless Chromium over the DevTools protocol using Node's built-in `fetch` and `WebSocket` — no dependencies — and checks the demo wiring plus the real exported bytes (JPEG magic, Motion Photo metadata, `ftyp`/`moov`, ICC/MPF, and that the default profile writes no device identity). Set `CHROME_PATH` if your browser lives somewhere unusual.

> The built demo uses ES modules, so it must be **served over http(s)** — opening `dist-demo/index.html` from `file://` is blocked by CORS. `npm run preview` exists for exactly this.

CI runs both suites: `.github/workflows/ci.yml` (Node) and `.github/workflows/e2e.yml` (browser).

```
src/
  index.ts            public API: createMotionPhoto, createPreview, …
  types.ts            the entire public type surface
  frame.ts            pure pixel ops (blur, resample, blit, ranks)
  config.ts           defaults + option resolution
  effects/
    registry.ts       defineEffect / defineBlockEffect / registry
    builtin/          the nine effects, one file each
  pipeline/
    precompute.ts     builds the EffectContext
    encoder.ts        WebCodecs wrapper + capability negotiation
    muxer.ts          vendored MP4 muxer adapter
    motion-photo.ts   byte assembly + structural inspection
  metadata/           XMP + generated EXIF + binary blobs
  platform/browser.ts default canvas-backed ImageCodec
  vendor/             vendored mp4-muxer (MIT)
demo/                 the minimal workbench UI
tests/                vitest suites
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add an effect, and [CHANGELOG.md](./CHANGELOG.md) for behaviour changes relative to the original zero-build version.

## 中文文档

见 [README.zh-CN.md](./README.zh-CN.md)。

## License

[MIT](./LICENSE). The vendored MP4 muxer is MIT as well — see [THIRD-PARTY.md](./THIRD-PARTY.md).
