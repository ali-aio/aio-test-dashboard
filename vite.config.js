import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `app.html` is the entry while the React port runs alongside the old page; index.html
// stays the shipped vanilla dashboard until every view is ported. Relative base so the
// build can be served from any path (it currently lives at /dist/ on fw2).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, rollupOptions: { input: 'app.html' } },
})
