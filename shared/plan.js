// Moved to src/lib/plan.js during the React + Vite migration. This re-export keeps the
// legacy page (index.html), the demo pages and server/sweep.mjs working unchanged
// until they are ported; delete it once nothing imports './shared/' any more.
export * from '../src/lib/plan.js';
