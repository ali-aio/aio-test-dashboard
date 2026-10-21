import React, { useEffect, useRef, useState } from 'react'
import { ago } from '../lib/format.js'

// Close a popover on a click outside it or Escape.
function useDismiss(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return ref
}

const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The bell: devices of a running cycle that behave unlike the rest. A click opens Today;
 *  the tick marks one read without leaving the page. */
export function NotificationBell({ log, onRead, onReadAll, onOpen }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, setOpen)
  const unread = log.filter((a) => !a.read).length
  return (
    <div className="hdr-pop" ref={ref}>
      <button type="button" className="btn btn-icon hdr-bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        title="Notifications" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2.2a3.9 3.9 0 0 0-3.9 3.9v2.6L2.9 11h10.2l-1.2-2.3V6.1A3.9 3.9 0 0 0 8 2.2zM6.4 12.6a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" /></svg>
        {unread > 0 && <span className="hdr-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover popover-right hdr-panel" role="dialog" aria-label="Notifications">
          <div className="hdr-panel-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="link-btn" onClick={onReadAll}>Mark all as read</button>}
          </div>
          {!log.length ? <div className="hdr-empty">Nothing to report. You will be told here when one or two devices of a running cycle behave differently from all the others — on charge, wireless pad and load, not reporting, battery level or temperature.</div>
            : <ul className="notif-list">
              {log.map((a) => (
                <li key={a.id} className={`notif${a.read ? '' : ' is-unread'}`}>
                  <button type="button" className="notif-body" onClick={() => { onRead(a.id); setOpen(false); onOpen(a) }}>
                    <span className="notif-dot" aria-hidden="true" />
                    <span>
                      <span className="notif-title"><b className="mono">{a.serial}</b> · {a.title}</span>
                      <span className="notif-sub">Others: {a.others}</span>
                      <span className="notif-sub">{a.test} started {hm(a.cycleStart)}{a.resolvedAt ? ` · back in line since ${hm(a.resolvedAt)}` : ''}</span>
                      <span className="notif-time">{ago(a.at)}</span>
                    </span>
                  </button>
                  {!a.read && <button type="button" className="notif-read" title="Mark as read" aria-label="Mark as read" onClick={() => onRead(a.id)}>
                    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>}
                </li>
              ))}
            </ul>}
        </div>
      )}
    </div>
  )
}

/** The Live pill: a click shows when the server last checked the MDM for finished cycles. */
export function LiveBadge({ error, ready, server }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, setOpen)
  const label = error ? 'Disconnected' : ready ? 'Live' : 'Connecting'
  return (
    <div className="hdr-pop" ref={ref}>
      <button type="button" className={`pill pill-btn ${error ? 'pill-bad' : ready ? 'pill-ok pill-live' : ''}`} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && (
        <div className="popover popover-right hdr-panel hdr-panel-sm" role="dialog" aria-label="Connection">
          <div className="hdr-panel-head"><strong>{label}</strong>
            <button type="button" className="btn btn-sm hdr-reload" title="Reload the dashboard (like Ctrl+R)" onClick={() => location.reload()}>
              <ReloadIcon /> Reload</button>
          </div>
          <div className="hdr-info">
            {error ? <p>{error}</p> : null}
            <p>Live device readings update every 30 seconds.</p>
            {server?.lastSweepAt ? <p>{server.sweeping ? 'The server is checking the MDM for new cycles now.'
              : <>Cycles checked <b>{ago(server.lastSweepAt)}</b> ({new Date(server.lastSweepAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). The server checks the MDM for finished cycles every 30 minutes.</>}</p> : null}
            <p><OldDataLink server={server} /></p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Old data: the previous T7-Dashboard (the lab's CSV imports), served by our server on its own port
 *  (`t7Port` in /api/status, 8091 by default), opened in a new tab on the same host. In the Live pill's
 *  panel, not the header row (the user, Oct 2026: too much in the top row). */
function OldDataLink({ server }) {
  const href = `${location.protocol}//${location.hostname}:${server?.t7Port || 8091}/`
  return (
    <a className="btn btn-sm" href={href} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}
      title="Open the old T7-Dashboard (the lab's imported CSV data) in a new tab">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3.5h-9v-9H6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Old data</a>
  )
}

const ReloadIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.6v3.2H9.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
