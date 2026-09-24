import { defineConfig } from 'vite';

/**
 * Demo build. `base: './'` keeps every asset URL relative so the same build
 * works from a domain root, a GitHub Pages project subpath, or file://.
 */
export default defineConfig({
  root: 'demo',
  base: './',
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
