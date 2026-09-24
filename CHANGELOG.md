# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/) and the format of [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- `createPreview()` — decode once, then render frames on demand for a live preview or scrubber, without encoding.
- `defineBlockEffect()` — build an effect from a per-block weight function (~10 lines for a typical effect).
- `defineEffect()` / `registerEffect()` / `createRegistry()` — pluggable effects, including fully isolated registries.
- `inspectMotionPhoto()` — structural self-check (JPEG, Motion Photo metadata, ICC, MPF, `ftyp`/`moov`).
- Seeded PRNG (`seed` option) so randomised effects reproduce exactly; `reseed()` on `EffectContext`.
- `frame` namespace of pure pixel helpers (blur, area resample, nearest upscale, block blit, blend, ranks).
- Metadata profiles: `google` (default), `oplus`, `none`, plus `extraXmpAttributes`.
- Generated minimal EXIF (Orientation + ColorSpace) for the default profile.
- `locale` option and `translate()` / `effectText()` helpers; all built-in effects ship `en` + `zh` labels.
- `AbortSignal` support and encoder queue backpressure.
- Per-effect options: `square.intensity`, `scatter.bias`, `diagonal.from`/`stagger`, `rain.spread`/`reverse`, `luminance.darkFirst`, `expand.from`, `ripple.from`/`ellipse`, `spiral.turns`/`from`, `bloom.points`/`jitter`.
- Test suite (Vitest, 103 cases) covering pixel ops, the effect registry, weight semantics, config resolution, metadata assembly, i18n and the encoder helpers.
- `tools/e2e.mjs` — dependency-free browser smoke test (`npm run test:e2e`) that drives a headless Chromium over CDP and asserts on the real exported bytes; plus a dedicated `e2e` workflow.
- TypeScript + Vite build producing ESM, CJS and a standalone IIFE bundle, plus a minimal demo workbench.
- CI workflow (typecheck, test, build) and a GitHub Pages workflow for the demo.

### Changed

- **Rendering no longer uses canvas.** Frames are produced by pure pixel maths against a `FrameBuffer`, which makes the render path deterministic per-engine, unit-testable in Node, usable in a Web Worker, and portable to WASM or a server later. The `ImageCodec` interface is the only part that touches canvas (source decode and cover JPEG encode).
- **Default metadata no longer impersonates a device.** The previous implementation always embedded an EXIF blob extracted from a real OPPO/OnePlus Motion Photo (device fingerprint included). The default `google` profile now writes generated EXIF plus generic Google Motion Photo XMP; the device-derived blob is confined to the opt-in `oplus` profile.
- Effects are now data-driven: every block-based effect reduces to one weight per block, so `defineBlockEffect` covers 8 of the 9 built-ins.
- **The vendored MP4 muxer is now a pinned upstream release.** It was previously an unknown-version build artefact extracted from a single-file HTML prototype, with no licence text. It is now `mp4-muxer` 5.2.2, taken unmodified from the npm tarball, with its official type declarations and MIT licence text alongside it. This adds ~6 KB gzipped to the bundle (5.2.2 also handles HEVC/VP9/AV1 and fragmented output); `src/pipeline/muxer.ts` dropped the `audio: false` option that v5 removed.
- The 9 expanded-card DOM blocks and their inline SVG icons were replaced by generated markup from a single effect list.
- Options are resolved in one place (`resolveJob`), with typed errors (`PixelRevealError.code`) instead of string matching.
- Demo UI rewritten: single workbench (drop target → preview → effect strip → export) with settings behind a disclosure, bilingual, no card grid.
- Branding is configurable (`metadata.appName`); the hard-coded ICP footer is gone.

### Fixed

- **`encodeVideo()` hung on its first yield.** Progress was yielded through a `MessagePort` whose `message` listener was attached with `addEventListener` — which does **not** start the port in Chromium, so the promise never settled and the export froze at "encoding frame 1/N". The port is now started via `onmessage` with a queued resolver (also making overlapping yields safe), and both ports are `unref`'d so a Node consumer can still exit. Node resolves the broken pattern happily, which is why this needed a browser test to find.
- **`rain` revealed bottom-up.** It now fills each column from the top down, matching its name and description.
- **`diagonal` never finished.** Normalising weights is now mandatory, so the far corner reveals at progress 1 instead of stalling at ~96%.
- **`expand` left a sharp block on frame 0.** All effects now show the untouched pixelated backdrop on the first frame.
- **Repeated exports lost their animation.** Per-frame reveal masks were monotonically accumulated and never reset, so a second export of the same effect began with the image already lit. Renderers are rebuilt (and the PRNG re-seeded) for every export.
- **`square` ghosted at the edges.** The blurred pass was composited onto a reused canvas without clearing, so the semi-transparent blur border accumulated frame over frame (measured: edge alpha 88 → 224 across five draws). Frames now start from a clear buffer, and the blur is applied to the block grid rather than the full frame — same look, far cheaper.
- **Cover frame could differ from the video's first frame** for randomised effects: the cover renderer now shares the export's seed.
- `ripple`'s three-wave band loop was dead code (the mask accumulated, so it rendered as a single expanding circle); the effect is now honestly a circular reveal, with `expand` keeping the aspect-following ring.
- Preview canvas used to be capped by the user's export `maxDimension` (slow scrubbing); the preview now decodes at a small fixed size.
- **`square` (Melt, the default effect) was over-blurred on large photos and had no blur left in its final third.** The software rewrite scaled the blur by `(1 - progress)` _and_ measured it against the current block size, so the radius fell to zero for the last third (bare pixel blocks) while starting at ≈1.5 blocks — on a 2560px photo a 160–192px blur on the first frame, roughly eight times the reference 20px. The radius is now `blurPixels * (1 - progress) / blockSize`, which stays constant in block units exactly like the reference, and a sub-block blur (smaller than one block) is correctly skipped instead of smearing. Measured against the original canvas algorithm the mean absolute error is now under 2/255 at every progress value, and the first and last frames match exactly.
- **Encoder bitrate retuned against measurements.** The rate was derived from a 0.12 bit/pixel/frame target with a 6 Mbps floor; decoded back and compared with the source, that delivered a mean error of 1.47/255 at 1920×1440, while 0.24 bpp delivers 1.30 and 0.48 bpp only 1.28 — quality saturates around 0.24, which is now the target. The floor is 10 Mbps (the original implementation's flat rate) and the ceiling 30 Mbps, since 2560×2560 would otherwise ask for ~47 Mbps. Note that at low resolutions the encoder's rate control saturates by itself: a 480×360 clip is byte-identical at 6, 10 and 20 Mbps.
