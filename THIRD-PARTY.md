# Third-party code

## mp4-muxer

- **Files:** `src/vendor/mp4-muxer.js` (implementation), `src/vendor/mp4-muxer.d.ts` (types), `src/vendor/mp4-muxer.LICENSE` (licence text)
- **Version:** 5.2.2 (pinned)
- **Purpose:** mux WebCodecs `EncodedVideoChunk`s into an MP4 so the video can be appended to the JPEG.
- **License:** MIT — Copyright (c) 2023 Vanilagy
- **Upstream:** https://github.com/Vanilagy/mp4-muxer

### How it was vendored

Taken from the published npm tarball (`npm pack mp4-muxer@5.2.2`), file `build/mp4-muxer.mjs`:

| File                | Change                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- |
| `mp4-muxer.js`      | The implementation is **unmodified**; only a provenance header comment was prepended. |
| `mp4-muxer.d.ts`    | Copied verbatim from `build/mp4-muxer.d.ts`.                                          |
| `mp4-muxer.LICENSE` | Copied verbatim from the package root, so the MIT notice is preserved.                |

`src/vendor/` is excluded from Prettier (see `.prettierignore`) — do not reformat it, so that a diff against upstream stays legible.

### Updating

```bash
npm pack mp4-muxer@<version>
# then re-copy build/mp4-muxer.mjs (plus the header), build/mp4-muxer.d.ts and LICENSE
npm run typecheck && npm test && npm run build
```

Check `src/pipeline/muxer.ts` afterwards: v5 dropped the `audio: false` form of `MuxerOptions`, so the audio track is simply not declared. `npm run test:e2e` must pass — it exercises the real muxer in a browser.
