import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtSerial, compareSerial } from '../lib/fmt.js'

/** Which devices to export: every one ticked to start with, a search, Select all / Clear, and
 *  how many cycles each has. Drawn on <body>, like the header's Export CSV dialog (same styles).
 *  counts: Map serial -> number of cycles. onExport(Set of serials). */
export default function PickDevicesDialog({ title, sub, counts, onExport, onClose }) {
  const all = useMemo(() => [...counts.keys()].sort(compareSerial), [counts])
  const [picked, setPicked] = useState(() => new Set(all))
  const [q, setQ] = useState('')
  const shown = all.filter((sn) => !q.trim() || sn.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (sn) => setPicked((p) => { const n = new Set(p); if (n.has(sn)) n.delete(sn); else n.add(sn); return n })
  const cycles = [...picked].reduce((a, sn) => a + (counts.get(sn) || 0), 0)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card modal export-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width: 'min(520px, 100%)' }}>
        <div className="card-head">
          <div><h2>{title}</h2>{sub && <div className="card-sub">{sub}</div>}</div>
          <button className="rp-x" aria-label="Close" style={{ marginLeft: 'auto' }} onClick={onClose}>×</button>
        </div>
        <div className="card-body export-body">
          <section>
            <div className="export-h">Devices <span className="secondary">· {picked.size} of {all.length} ticked</span></div>
            <div className="dev-pick">
              <div className="dev-pick-bar">
                <input className="input" type="search" placeholder="Search serials… (e.g. 044)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set([...picked, ...shown]))}>Select all</button>
                <button type="button" className="btn btn-sm" onClick={() => { const n = new Set(picked); shown.forEach((s) => n.delete(s)); setPicked(n) }}>Clear</button>
              </div>
              <div className="dev-pick-list" style={{ maxHeight: 280 }}>
                {shown.map((sn) => (
                  <label key={sn} className="dev-pick-item">
                    <input type="checkbox" checked={picked.has(sn)} onChange={() => toggle(sn)} />
                    <span className="mono">{fmtSerial(sn)}</span>
                    <span className="secondary">· {counts.get(sn)} cycle{counts.get(sn) === 1 ? '' : 's'}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>
        <div className="card-body export-foot">
          <span className="secondary">{picked.size ? `${picked.size} device${picked.size === 1 ? '' : 's'} · ${cycles} cycle${cycles === 1 ? '' : 's'}, hour by hour` : 'Tick at least one device'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!picked.size} onClick={() => onExport(picked)}>Export CSV</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
