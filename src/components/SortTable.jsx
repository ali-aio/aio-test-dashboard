import React, { useMemo, useState } from 'react'

// Click-to-sort for every table: first click on a heading puts the highest (hottest,
// longest, latest, A-Z) at the top, a second click the lowest, a third goes back to the
// table's own order. Values are read from what the cell shows, so a table needs no extra
// sort data: "9.1 h", "10.03%/h", "47.6 °C", "84 runs", "13h 45m", "09:34 PM",
// "7 May 2026" all compare as the quantity they show. Blank cells ("—") sink to the end.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The visible text of a rendered cell (string, number, element or a list of them). */
export function cellText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(cellText).join('')
  if (node.props) return cellText(node.props.children)
  return ''
}

/** A comparable value for a cell's text: a number where it shows one, else lower-case text, else null. */
export function sortValue(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const t = String(raw).replace(/−/g, '-').replace(/,/g, '').trim()
  if (!t || /^[—–-]+$/.test(t)) return null
  let m
  if ((m = t.match(/^(\d+)h\s*(\d+)?m?$/))) return +m[1] + (+(m[2] || 0)) / 60          // 13h 45m
  if ((m = t.match(/^(\d+)m$/))) return +m[1] / 60                                       // 45m
  if ((m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i))) {                                // 09:34 PM
    let h = +m[1] % (m[3] ? 12 : 24); if (/pm/i.test(m[3] || '')) h += 12
    return h * 60 + +m[2]
  }
  const mon = t.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)
  if (mon) {                                                                             // 7 May 2026 / Oct 7
    const day = (t.match(/\b(\d{1,2})\b/) || [])[1], year = (t.match(/\b(\d{4})\b/) || [])[1]
    if (day) return new Date(+(year || new Date().getFullYear()), MONTHS.indexOf(mon[1]), +day).getTime()
  }
  if ((m = t.match(/^[+-]?\d*\.?\d+/))) return parseFloat(m[0])                          // 9.1 h, 84%, +3.2%
  return t.toLowerCase()
}

/** Highest first (dir 1) or lowest first (dir -1); numbers before text, blanks last. */
export function compareValues(a, b, dir) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const an = typeof a === 'number', bn = typeof b === 'number'
  if (an && bn) return dir * (b - a)
  if (an !== bn) return an ? -1 : 1
  return dir * String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** Sort state for one table: { key, dir } or null for the table's own order. */
export function useSort() {
  const [sort, setSort] = useState(null)
  const onSort = (key) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  return [sort, onSort]
}

/** A clickable heading that shows ▲ (highest first) or ▼ (lowest first). */
export function SortTh({ k, sort, onSort, className, style, children }) {
  const on = sort?.key === k
  return (
    <th className={className} style={{ cursor: 'pointer', userSelect: 'none', ...style }} onClick={() => onSort(k)}
      aria-sort={on ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}
      title={on && sort.dir === 1 ? 'Highest first — click for lowest first' : on ? 'Lowest first — click to clear' : 'Click for highest first'}>
      {children}{on && <span className="sort-caret" aria-hidden="true">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
    </th>
  )
}

/**
 * A table whose <tbody> rows are sortable by any heading. `head` is the list of headings
 * ({ label, className?, style?, sortable? }), children are the <tr> rows as usual; each
 * row is sorted by the text of its n-th cell.
 */
export function SortTable({ head, children, className = 'data', caption }) {
  const [sort, onSort] = useSort()
  const rows = React.Children.toArray(children).filter(React.isValidElement)
  const ordered = useMemo(() => {
    if (!sort) return rows
    const val = (tr) => {
      const cells = React.Children.toArray(tr.props.children).filter(React.isValidElement)
      return sortValue(cellText(cells[sort.key]?.props.children))
    }
    return rows.map((r) => ({ r, v: val(r) })).sort((a, b) => compareValues(a.v, b.v, sort.dir)).map((x) => x.r)
  }, [children, sort])
  return (
    <table className={className}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead><tr>{head.map((h, i) => h.sortable === false
        ? <th key={i} className={h.className} style={h.style}>{h.label}</th>
        : <SortTh key={i} k={i} sort={sort} onSort={onSort} className={h.className} style={h.style}>{h.label}</SortTh>)}</tr></thead>
      <tbody>{ordered}</tbody>
    </table>
  )
}
