import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchHistoryRange } from '../lib/data.js'
import { READING_COLUMNS, CYCLE_COLUMNS, readingsCsv, cyclesCsv, estimateRows } from '../lib/csv.js'

// Export CSV, from the header on every screen. Pick what (MDM readings, or one row per
// cycle), which devices, which time span (and the spacing of readings) and which columns,
// then download. Readings are fetched device by device through the backend proxy; a
// "rate limited" answer waits and retries rather than failing the export.

const SPANS = [
  { id: '1h', label: 'Last hour', ms: 3600e3 }, { id: '6h', label: 'Last 6 h', ms: 6 * 3600e3 },
  { id: '24h', label: 'Last 24 h', ms: 86400e3 }, { id: '7d', label: 'Last 7 days', ms: 7 * 86400e3 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 86400e3 }, { id: 'custom', label: 'Custom…' },
]
const INTERVALS = [{ s: 60, label: 'every 1 min' }, { s: 300, label: 'every 5 min' }, { s: 900, label: 'every 15 min' }, { s: 3600, label: 'every hour' }]
const BIG = 300000 // rows; above this the export asks for a second click
const toInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function historyWithRetry(serial, from, to, iv, cancelled) {
  for (let i = 0; i < 6; i++) {
    try { return await fetchHistoryRange(serial, from, to, iv) } catch (e) {
      if (cancelled()) throw e
      const m = /retry in (\d+)s|429|rate limit/i.exec(e.message || '')
      if (!m) throw e
      await sleep(((m[1] ? +m[1] : 15) + 1) * 1000)
    }
  }
  throw new Error(`gave up on ${serial} after repeated rate limits`)
}

export default function ExportDialog({ devices, cycles, group, onClose }) {
  const all = useMemo(() => devices.map((d) => d.serial).sort(), [devices])
  const [kind, setKind] = useState('readings')
  const [picked, setPicked] = useState(() => new Set(all))
  const [q, setQ] = useState('')
  const [span, setSpan] = useState('24h')
  const [from, setFrom] = useState(() => toInput(Date.now() - 86400e3))
  const [to, setTo] = useState(() => toInput(Date.now()))
  const [iv, setIv] = useState(300)
  const [rCols, setRCols] = useState(() => new Set(['serial', 'time_local', 'battery_pct', 'battery_temp_c', 'charging', 'charger_type', 'wlc_status', 'build_id']))
  const [withExtra, setWithExtra] = useState(false)
  const [cCols, setCCols] = useState(() => new Set(CYCLE_COLUMNS.map((c) => c.key)))
  const [busy, setBusy] = useState(null)   // { done, total } while fetching
  const [err, setErr] = useState(null)
  const [confirmBig, setConfirmBig] = useState(false)
  const cancelRef = useRef(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  useEffect(() => { setConfirmBig(false) }, [kind, picked, span, from, to, iv])

  const range = useMemo(() => {
    if (span === 'all') return { from: -Infinity, to: Infinity }
    if (span === 'custom') return { from: Date.parse(from), to: Date.parse(to) }
    const s = SPANS.find((x) => x.id === span); return { from: Date.now() - s.ms, to: Date.now() }
  }, [span, from, to])
  const rangeOk = range.to > range.from
  const shown = all.filter((sn) => sn.toLowerCase().includes(q.trim().toLowerCase()))
  const serials = all.filter((sn) => picked.has(sn))
  const cols = kind === 'readings' ? rCols : cCols, setCols = kind === 'readings' ? setRCols : setCCols
  const colDefs = kind === 'readings' ? READING_COLUMNS : CYCLE_COLUMNS
  const inRange = useMemo(() => cycles.filter((c) => picked.has(c.serial) && c.start <= range.to && (c.end ?? c.start) >= range.from), [cycles, picked, range])
  const est = kind === 'readings' && rangeOk && Number.isFinite(range.from) ? estimateRows(serials.length, range.from, range.to, iv) : inRange.length
  const ready = serials.length > 0 && cols.size > 0 && rangeOk && !busy

  const download = (text, name) => {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const stamp = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace(':', '') : 'all')
  const fileName = (what) => `aio-${what}_${group.replace(/[^\w-]+/g, '-')}_${stamp(range.from)}_to_${stamp(range.to)}.csv`

  async function run() {
    setErr(null)
    if (kind === 'cycles') { download(cyclesCsv(inRange, [...cCols]), fileName('cycles')); onClose(); return }
    if (est > BIG && !confirmBig) { setConfirmBig(true); return }
    cancelRef.current = false
    const rows = []
    setBusy({ done: 0, total: serials.length })
    try {
      for (let i = 0; i < serials.length; i++) {
        if (cancelRef.current) { setBusy(null); return }
        const got = await historyWithRetry(serials[i], range.from, range.to, iv, () => cancelRef.current)
        for (const r of got) if (!r.empty) rows.push({ ...r, serial_number: r.serial_number || serials[i] })
        setBusy({ done: i + 1, total: serials.length })
      }
      download(readingsCsv(rows, READING_COLUMNS.filter((c) => rCols.has(c.key)).map((c) => c.key), withExtra), fileName('readings'))
      setBusy(null); onClose()
    } catch (e) { setBusy(null); setErr(e.message || String(e)) }
  }

  const toggle = (set, setter, k) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n) }

  // drawn on <body>: inside the sticky header a fixed overlay would be trapped in its bar
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="card modal export-dialog" role="dialog" aria-modal="true" aria-label="Export CSV">
        <div className="card-head">
          <div><h2>Export CSV</h2><div className="card-sub">{group}</div></div>
          <button className="rp-x" aria-label="Close" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={onClose}>×</button>
        </div>
        <div className="card-body export-body">
          <section>
            <div className="export-h">What</div>
            <div className="seg" role="group" aria-label="What to export">
              <button type="button" aria-pressed={kind === 'readings'} className={kind === 'readings' ? 'is-on' : ''} onClick={() => { setKind('readings'); if (span === 'all') setSpan('24h') }}>Readings (MDM history)</button>
              <button type="button" aria-pressed={kind === 'cycles'} className={kind === 'cycles' ? 'is-on' : ''} onClick={() => setKind('cycles')}>Cycles (one row each)</button>
            </div>
            <div className="help">{kind === 'readings'
              ? 'Every reading the MDM holds for each device in the time span — battery, temperature, charging — at the spacing you pick.'
              : 'One row per detected cycle: test, start and end, cycle time, battery, drain, peak temperature, battery cycles.'}</div>
          </section>

          <section>
            <div className="export-h">Devices <span className="secondary">· {serials.length} of {all.length} ticked</span></div>
            <div className="dev-pick">
              <div className="dev-pick-bar">
                <input className="input" type="search" placeholder="Search serials… (e.g. 044)" value={q} onChange={(e) => setQ(e.target.value)} />
                <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set([...picked, ...shown]))}>Select all</button>
                <button type="button" className="btn btn-sm" onClick={() => { const n = new Set(picked); shown.forEach((s) => n.delete(s)); setPicked(n) }}>Clear</button>
              </div>
              <div className="dev-pick-list" style={{ maxHeight: 150 }}>
                {shown.map((sn) => (
                  <label key={sn} className="dev-pick-item"><input type="checkbox" checked={picked.has(sn)} onChange={() => toggle(picked, setPicked, sn)} /><span className="mono">{sn}</span></label>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div className="export-h">Time span</div>
            <div className="rp-presets" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', marginBottom: 8 }}>
              {[...SPANS, ...(kind === 'cycles' ? [{ id: 'all', label: 'All time' }] : [])].map((s) => (
                <button key={s.id} type="button" className={`rp-preset${span === s.id ? ' is-on' : ''}`} onClick={() => setSpan(s.id)}>{s.label}</button>
              ))}
            </div>
            {span === 'custom' && (
              <div className="grid grid-2" style={{ gap: 8 }}>
                <label className="field"><span className="secondary">From</span><input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                <label className="field"><span className="secondary">To</span><input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              </div>
            )}
            {kind === 'readings' && (
              <label className="field" style={{ marginTop: 8 }}><span className="secondary">One reading</span>
                <span className="ver" style={{ display: 'block' }}><select value={iv} onChange={(e) => setIv(+e.target.value)} style={{ width: '100%' }}>
                  {INTERVALS.map((x) => <option key={x.s} value={x.s}>{x.label}</option>)}</select></span></label>
            )}
            {!rangeOk && <div className="help" style={{ color: 'var(--status-critical)' }}>The end must be after the start.</div>}
          </section>

          <section>
            <div className="export-h">Columns <span className="secondary">· {cols.size} of {colDefs.length}</span>
              <button type="button" className="link-btn" style={{ marginLeft: 10 }} onClick={() => setCols(new Set(colDefs.map((c) => c.key)))}>Select all</button>
              <button type="button" className="link-btn" style={{ marginLeft: 8 }} onClick={() => setCols(new Set())}>Clear</button></div>
            <div className="export-cols">
              {colDefs.map((c) => (
                <label key={c.key} className="dev-pick-item"><input type="checkbox" checked={cols.has(c.key)} onChange={() => toggle(cols, setCols, c.key)} />{c.label}</label>
              ))}
              {kind === 'readings' && (
                <label className="dev-pick-item"><input type="checkbox" checked={withExtra} onChange={() => setWithExtra((v) => !v)} />Every other MDM field (extra.*)</label>
              )}
            </div>
          </section>
        </div>
        <div className="card-body export-foot">
          <span className="secondary" style={{ fontSize: 12.5 }}>
            {busy ? `Fetching readings… device ${busy.done} of ${busy.total}`
              : err ? <span style={{ color: 'var(--status-critical)' }}>Export failed: {err}</span>
              : confirmBig ? <span style={{ color: 'var(--status-warning)' }}>About {est.toLocaleString()} rows — a large file that takes a while. Click again to go ahead, or pick fewer devices, a shorter span or a wider spacing.</span>
              : kind === 'readings' ? `About ${est.toLocaleString()} rows (less where a device was offline)` : `${est.toLocaleString()} cycle${est === 1 ? '' : 's'}`}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {busy ? <button className="btn" onClick={() => { cancelRef.current = true }}>Cancel</button>
              : <button className="btn" onClick={onClose}>Cancel</button>}
            <button className="btn btn-primary" disabled={!ready} onClick={run}>{busy ? 'Exporting…' : confirmBig ? 'Export anyway' : 'Download CSV'}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
