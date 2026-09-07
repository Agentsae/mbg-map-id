import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // maplibre-gl spawns a Web Worker (maplibre-gl-worker.mjs) resolved relative
  // to its own module URL at runtime (import.meta.url) — see
  // node_modules/maplibre-gl/dist/maplibre-gl.js `wi()`/`Oi()`. Vite's esbuild
  // dep pre-bundler only emits the single flattened `maplibre-gl.js` chunk
  // into node_modules/.vite/deps/ and does NOT copy the separate worker file
  // alongside it — confirmed reproducible on every `npm run dev` start via
  // this exact terminal warning: "The file does not exist at
  // .../.vite/deps/maplibre-gl-worker.mjs". That leaves the worker script
  // 404-ing in dev mode, a real bug independent of anything else (it's the
  // documented/recommended fix for maplibre-gl + Vite, see maplibre-gl-js
  // issues re: esbuild optimizeDeps + Worker). NOTE: investigated 2026-08-28
  // as a candidate cause for a separate "map renders blank/white" report —
  // could NOT confirm this worker warning is what actually causes that
  // symptom (screenshot comparisons before/after this fix were identical in
  // a software-WebGL/headless test harness that also fails to paint MapLibre's
  // OWN demo style, i.e. an environment limitation unrelated to this repo).
  // Keeping this fix regardless since it's a legitimate, reproducible dev-only
  // issue on its own merits — `vite build` uses Rollup (bundles the worker
  // correctly) so production was never affected either way.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
