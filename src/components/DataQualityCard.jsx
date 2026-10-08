import React from 'react'
import { Card, Pill } from './Primitives.jsx'
import { fmtInt } from '../lib/fmt.js'

/**
 * What the import had to work around, declared rather than fixed in silence.
 *
 * Collapsed by default: it is the thing you open when a figure elsewhere looks
 * wrong, not the thing you read first.
 */
export default function DataQualityCard({ issues = [], files = [] }) {
  if (!issues.length) return null

  const headerless = files.filter((f) => f.headerless)

  return (
    <Card collapsible title="Data quality"
      sub="Gaps and oddities in the files, and what we did about each one — nothing is changed behind your back">
      <div className="quality-grid">
        {issues.map((i) => (
          <div key={i.label} className="quality-item">
            <Pill level={i.level}>{fmtInt(i.n)}</Pill>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{i.label}</div>
              <div className="hint">{i.note}</div>
            </div>
          </div>
        ))}
      </div>
      {headerless.length > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          Files with no header row — columns were mapped by position using the test type in the
          filename: {headerless.map((f) => f.name).join(', ')}
        </p>
      )}
    </Card>
  )
}
