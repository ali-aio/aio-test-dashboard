import { createContext } from 'react'

// Whether the per-sample history the curve charts draw from is still loading, and how to
// reload it. App provides it; every chart's empty state reads it, so "nothing to plot"
// can say "still loading" or offer a reload instead of looking like a dead end.
// Shape: { loading, at, err, days, reload() } — or null when there is no history window.
export const HistoryStatus = createContext(null)
