import React from 'react'

// v1 lives in the vanilla page while its views are ported. Rather than half-port them
// into React and end up with two half-working copies, the picker sends you to the real one.
export default function LegacyView() {
  return (
    <div className="view-stack">
      <div className="view-head"><div><h1>Previous dashboard</h1><div className="sub">v1 — still served by the original page</div></div></div>
      <div className="card"><div className="card-body">
        <p className="secondary" style={{ marginTop: 0 }}>
          The v1 views (Overview, Devices, Test cycles, Health, Charging, Thermal, Settings) have not been
          ported to React yet, so they are still served by the original page — unchanged and fully working.
        </p>
        <a className="btn btn-primary" href="../index.html">Open the v1 dashboard</a>
      </div></div>
    </div>
  )
}
