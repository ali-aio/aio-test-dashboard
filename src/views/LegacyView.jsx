import React from 'react'

// v1 lives in the vanilla page while its views are ported. Rather than half-port them
// into React and have two half-working copies, the picker sends you to the real thing.
export default function LegacyView() {
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Previous dashboard</h1><div className="sub">v1 — still served by the original page</div></div></div>
      <div className="callout">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" /></svg>
        <div>
          The v1 views (Overview, Devices, Test cycles, Health, Charging, Thermal, Settings) have not been ported to
          React yet, so they are still served by the original page — unchanged and fully working.
          <div className="acts"><a className="btn primary" href="../index.html">Open the v1 dashboard</a></div>
        </div>
      </div>
    </div>
  )
}
