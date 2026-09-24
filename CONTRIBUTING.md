# Contributing

Thanks for taking a look. This project is small on purpose — keep patches focused and tested.

## Setup

```bash
git clone <your-fork>
cd pixel-reveal
npm install
npm run dev        # demo on http://localhost:5173
```

Requires Node 20+. There are no runtime dependencies; devDependencies are Vite, TypeScript, Vitest and Prettier only.

## Before you open a PR

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

All four must pass, and CI runs exactly these. If you touched anything on the encode, mux or assemble path, also run the browser smoke test — Node cannot execute WebCodecs, so it is the only thing that catches encode-path regressions:

```bash
npm run build
npm run preview                                # terminal 1
npm run test:e2e -- http://localhost:4173/     # terminal 2
```

That combination is not ceremony: a `MessagePort` started with `addEventListener` instead of `onmessage` resolves fine in Node and hangs forever in Chromium. It shipped once; the smoke test and `.github/workflows/e2e.yml` exist to stop it recurring.

## Project layout

| Path                      | What lives there                                                 |
| ------------------------- | ---------------------------------------------------------------- |
| `src/types.ts`            | The entire public type surface. Start here when changing an API. |
| `src/frame.ts`            | Pure pixel operations. No DOM, no canvas — keep it that way.     |
| `src/effects/registry.ts` | `defineEffect`, `defineBlockEffect`, the registry.               |
| `src/effects/builtin/`    | One file per built-in effect.                                    |
| `src/pipeline/`           | Precompute → render → encode → mux → assemble.                   |
| `src/metadata/`           | XMP, generated EXIF, binary blobs.                               |
| `src/vendor/`             | Vendored third-party code. Do not reformat it.                   |
| `demo/`                   | The minimal workbench. Presentation only.                        |
| `tests/`                  | Vitest suites; they run in plain Node.                           |

## Adding an effect

1. **Prefer a weight function.** If the effect is "reveal blocks in some order", it is a `defineBlockEffect` and belongs in one small file:

   ```ts
   // src/effects/builtin/wipe.ts
   import { defineBlockEffect, normalizeWeights } from '../registry.js';

   export const wipe = defineBlockEffect({
     name: 'wipe',
     label: { en: 'Wipe', zh: '横向擦除' },
     description: { en: 'Sweeps left to right', zh: '从左向右扫过' },
     duration: 2,
     easing: 'easeOutQuad',
     weights(context) {
       const weights = new Float32Array(context.cols * context.rows);
       for (let by = 0; by < context.rows; by++) {
         for (let bx = 0; bx < context.cols; bx++) {
           weights[by * context.cols + bx] = bx + 1;
         }
       }
       return normalizeWeights(weights);
     },
   });
   ```

2. Register it in `src/effects/builtin/index.ts` (import, re-export, and add to `builtinEffects` in display order).
3. Add a test. The shared suites in `tests/effects.test.ts` iterate `builtinEffects`, so a new effect automatically gets the "ends fully revealed" and "frame 0 reveals nothing" checks — add effect-specific assertions alongside.
4. If the effect needs a new option, read it with `numberOption(options, 'key', fallback)` and document it in the JSDoc header of the file.
5. Update the effect table in `README.md` and `README.zh-CN.md` if you changed the built-in list.

### Weight rules

- Normalise so the **maximum is exactly 1** (`normalizeWeights` does it, or divide by the max yourself). If the maximum is below 1 the animation will finish early and hold a still frame.
- Keep every weight **strictly greater than 0**. A zero weight would reveal a block on frame 0, so the first frame would not be the clean pixelated backdrop. `normalizedRanks()` already returns values in `(0, 1]`.
- Use `context.random()`, never `Math.random`, so exports stay reproducible.

### Full-control effects

If the effect is not a block reveal (see `src/effects/builtin/square.ts`), use `defineEffect()` and write pixels into `target`. Rules:

- Never mutate `context.sharp` / `blur` / `base` — they are shared.
- Fill the whole frame every call; do not assume the buffer is cleared.
- Do not allocate a frame-sized buffer per frame if you can avoid it; reuse a captured scratch frame.

## Style

- TypeScript strict mode, `verbatimModuleSyntax` (use `import type`).
- Prettier with the repo config — `npm run format` before committing.
- Comments explain _why_, not _what_. Keep the surrounding comment style: prose sentences, `//` inside functions, JSDoc on exported API.
- No runtime dependencies. If you truly need one, open an issue first — vendoring may be a better fit.
- Keep the render path free of DOM and canvas APIs so it stays testable in Node.

## Commits and PRs

- Conventional-ish subjects: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- One logical change per PR; describe the user-visible effect and how you verified it.
- Note any behaviour change in `CHANGELOG.md` under **Unreleased**.
- If you change output bytes for a given input, say so explicitly — downstream users may rely on stability.

## Reporting bugs

Include: browser + version, the options you passed, whether the file plays in your gallery, and the `inspectMotionPhoto()` output if you can get it. A sample photo helps enormously, but please only share images you are allowed to publish.

## Repository housekeeping

If you fork this project, two things are worth updating for your own copy:

- `README.md` — the CI and e2e badges point at `lujianl/pixel-reveal`.
- `LICENSE` — the copyright line reads "lujianl".
