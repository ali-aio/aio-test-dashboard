import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `app.html` is the entry. The build lives in /dist/ but the server shows it at `/` (server.mjs),
// so the base is absolute: the page finds /dist/assets/ whichever address served it.
export default defineConfig({
  plugins: [react()],
  base: '/dist/',
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, rollupOptions: { input: 'app.html' } },
})
