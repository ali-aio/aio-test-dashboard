// Server-renders every analysis view, for every test type and the common filter cases,
// against the real cycle history (data/cycles.json) run through src/lib/adapt.js.
//
// It exists because T7's views iterate cycle fields unconditionally, so a field the
// adapter forgets is not a missing number — it is a crash ("x is not iterable") that only
// shows up when someone clicks into one test. That shipped once; this catches it in Node.
//   npm test
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
await build({ logLevel: 'error', configFile: false, plugins: [react()],
  build: { target: 'esnext', ssr: path.join(here, 'render.test.jsx'), outDir: path.join(here, '.out'), emptyOutDir: true } })
// fleet.js reads the scope group from storage at import time, so the stub has to exist
// before the bundle loads; render.test.jsx swaps in its own after.
{ const m = new Map(); globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) } } }
const before = process.exitCode
await import(path.join(here, '.out', 'render.test.js'))
if (process.exitCode && !before) console.error('\nrender test FAILED')
