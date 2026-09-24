import { defineConfig } from 'vite';

/**
 * Library build: ESM + CJS + a standalone IIFE bundle that can be dropped
 * into any page with a plain <script> tag (no bundler required).
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'PixelReveal',
      formats: ['es', 'cjs', 'iife'],
      fileName: (format) => {
        if (format === 'es') return 'pixel-reveal.js';
        if (format === 'cjs') return 'pixel-reveal.cjs';
        return 'pixel-reveal.iife.js';
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    reportCompressedSize: true,
  },
});
