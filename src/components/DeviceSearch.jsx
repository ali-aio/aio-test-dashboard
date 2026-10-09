import React, { useEffect, useMemo, useRef, useState } from 'react'
import { status, lifetimeCycles } from '../lib/device.js'
import { fmtLifetime } from '../lib/fmt.js'

// The header's device search, on every screen: type part of a serial, pick a match (click,
// or arrows + Enter) and that device's whole history opens. "/" focuses it from anywhere.
export default function DeviceSearch({ devices, onOpen }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null), boxRef = useRef(null)

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return devices.filter((d) => d.serial.toLowerCase().includes(t))
      .sort((a, b) => (a.serial.toLowerCase().endsWith(t) ? 0 : 1) - (b.serial.toLowerCase().endsWith(t) ? 0 : 1) || (a.serial < b.serial ? -1 : 1))
      .slice(0, 8)
  }, [q, devices])
  useEffect(() => { setActive(0) }, [q])

  // "/" anywhere (outside a text field) jumps to the search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault(); inputRef.current?.focus()
    }
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDoc)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDoc) }
  }, [])

  const pick = (d) => { if (!d) return; onOpen(d.serial); setQ(''); setOpen(false); inputRef.current?.blur() }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]) }
    else if (e.key === 'Escape') { setQ(''); setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div className="dev-search" ref={boxRef}>
      <svg className="dev-search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input ref={inputRef} type="search" value={q} placeholder="Find a device… ( / )" aria-label="Find a device by serial"
        role="combobox" aria-expanded={open && matches.length > 0} aria-controls="dev-search-list" aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
      {open && q.trim() && (
        <div className="popover dev-search-pop" id="dev-search-list" role="listbox">
          {matches.length ? matches.map((d, i) => {
            const st = status(d)
            return (
              <button key={d.serial} type="button" role="option" aria-selected={i === active}
                className={`dev-search-row${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)} onClick={() => pick(d)}>
                <span className="mono">{d.serial}</span>
                <span className="secondary">{st.label}{st.pct != null ? ` · ${st.pct}%` : ''} · {fmtLifetime(lifetimeCycles(d.snap))} cycles</span>
              </button>
            )
          }) : <div className="secondary" style={{ padding: '8px 10px' }}>No device matches “{q.trim()}”.</div>}
        </div>
      )}
    </div>
  )
}
