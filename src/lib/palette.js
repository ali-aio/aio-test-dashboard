/* ===========================================================================
   Colour roles — every value traces to the validated reference palette
   (see README § Colour). Component code uses roles, never raw hex.

   Validation runs (dataviz scripts/validate_palette.js), both modes:
     • slots 1-8, adjacent pairlist  -> PASS   (lines, stacked and adjacent bars)
     • slots 1-3, all-pairs          -> PASS   (scatter, small multiples)
   So anything whose marks can land next to each other in ANY order — a
   scatter, a facet grid — is capped at three hues, and the tail folds into
   "Other" or a table. Lines and grouped bars may use the full eight.
   =========================================================================== */

/** Categorical slots in fixed order. Index = slot - 1. Never cycled. */
export const SERIES_VARS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
]
export const MAX_SERIES = SERIES_VARS.length
/** Hard cap where marks can be adjacent in any order (scatter, facets). */
export const MAX_SERIES_ALL_PAIRS = 3

/**
 * Colour follows the entity, not its rank: a stable key -> slot map built from
 * the full sorted key list, so filtering a series out never repaints the
 * survivors. Keys past slot 8 reuse the palette so a filtered device curve
 * remains coloured instead of turning grey. Grouped charts still cap their
 * visible series, while the per-device detail chart can show every device.
 */
export function buildColorMap(keys) {
  const map = new Map()
  keys.forEach((k, i) => map.set(k, SERIES_VARS[i % MAX_SERIES]))
  return map
}

/* ------------------------------------------------- fixed domain assignments
   These are stable identities across the whole app, so a build or a load type
   keeps its colour in every chart. All are drawn from the slot order above. */

export const BUILD_COLOR = {
  'Validation Build': 'var(--series-1)',
  'OTG Build': 'var(--series-2)',
  'Production Build': 'var(--series-3)',
  'OTG / Validation Build': 'var(--series-2)',
  Unknown: 'var(--series-4)',
}
export const BUILD_ORDER = ['Validation Build', 'OTG Build', 'OTG / Validation Build', 'Production Build', 'Unknown']

export const LOAD_TYPE_COLOR = {
  'iPhone 1': 'var(--series-1)',
  'iPhone 2': 'var(--series-2)',
  'iPhone 3': 'var(--series-3)',
  '5W WLC Tester': 'var(--series-7)',
  'No Load': 'var(--series-8)',
}

/** The two measures in the drain/gain grouped bar. */
export const MEASURE_COLOR = {
  drop: 'var(--series-1)',   // T7 battery lost per hour
  gain: 'var(--series-3)',   // charge delivered into the load per hour
  wireless: 'var(--series-1)',
  withoutWireless: 'var(--series-2)',
}

/* ------------------------------------------------------------- status scale
   Status colour means good / warning / serious / critical and nothing else;
   it never doubles as a series hue, and every use ships an icon and a label
   so colour is not carrying the meaning on its own. */

/**
 * The non-colour channel for status: shape, so severity survives colourblind
 * vision, greyscale print and forced-colours mode.
 *
 * Deliberately no triangles. A caret-shaped glyph sitting next to text reads as
 * "this opens something" — which in this app is exactly what the stat tiles'
 * dropdown affordance means. These five are shapes, not arrows, and escalate
 * by weight: circle, diamond, square, cross.
 */
export const STATUS_ICON = {
  good: '●', warning: '◆', serious: '◼', critical: '✕', neutral: '–',
}

const BANDS = {
  /** Peak PCB temperature, °C. */
  peakTemp: [[42, 'good'], [50, 'warning'], [58, 'serious'], [Infinity, 'critical']],
  /** T7 drain rate, %/h — higher is worse. */
  dropRate: [[5, 'good'], [9, 'warning'], [14, 'serious'], [Infinity, 'critical']],
  /** Cycle length, hours — longer runtime is better, so the bands invert. */
  duration: [[6, 'critical'], [12, 'serious'], [20, 'warning'], [Infinity, 'good']],
  /** Battery left at the end of a run, %. */
  endBattery: [[5, 'critical'], [15, 'serious'], [30, 'warning'], [Infinity, 'good']],
  /** Sample count behind an average — small n deserves a caveat. */
  sampleSize: [[2, 'critical'], [5, 'serious'], [15, 'warning'], [Infinity, 'good']],
}

export function levelFor(scale, value) {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  for (const [max, level] of BANDS[scale]) if (value <= max) return level
  return 'neutral'
}

/* ------------------------------------------------------------ sequential ramp
   One hue, light -> dark, for magnitude only. Never a rainbow. */

export const SEQ_STEPS = [
  'var(--seq-100)', 'var(--seq-150)', 'var(--seq-200)', 'var(--seq-250)',
  'var(--seq-300)', 'var(--seq-350)', 'var(--seq-400)', 'var(--seq-450)',
  'var(--seq-500)', 'var(--seq-550)', 'var(--seq-600)', 'var(--seq-650)',
  'var(--seq-700)',
]

export function seqColor(norm01) {
  if (!Number.isFinite(norm01)) return 'var(--surface-2)'
  const i = Math.round(Math.min(1, Math.max(0, norm01)) * (SEQ_STEPS.length - 1))
  return SEQ_STEPS[i]
}

/**
 * Ink for a label set INSIDE a coloured fill — the one place text may sit on a
 * series colour, chosen by the fill's luminance so it always clears contrast.
 * Every slot here clears 4.7:1 or better against near-black; most sit under
 * 4.5:1 against white, so dark ink is the default.
 */
const INK_DARK = '#0b0b0b'
const INK_LIGHT = '#ffffff'
const FILL_INK = {
  'var(--series-1)': INK_DARK, 'var(--series-2)': INK_DARK, 'var(--series-3)': INK_DARK,
  'var(--series-4)': INK_DARK, 'var(--series-5)': INK_DARK, 'var(--series-6)': INK_LIGHT,
  'var(--series-7)': INK_LIGHT, 'var(--series-8)': INK_DARK,
}
export const inkOn = (cssVar) => FILL_INK[cssVar] ?? INK_DARK
export const seqInk = (norm01) => (norm01 > 0.6 ? INK_LIGHT : INK_DARK)

/* ------------------------------------------------- many lines, one per thing
   Eight validated hues, so a chart with more lines than that must tell them apart some
   other way — never by generating a 9th hue (it would fail the colour-blind checks and
   look like a near-duplicate anyway). Lines 1–8 are solid; 9–16 reuse the same hues
   dashed; 17–24 dotted; then dash-dot. Colour + pattern stays unique for 32 lines, and
   a line keeps its style whatever else is shown, because the map is built from the full
   sorted list of keys, not from what happens to be visible. */
const DASHES = [undefined, '6 3', '1.5 3', '8 3 2 3']
export function buildStyleMap(keys) {
  const map = new Map()
  keys.forEach((k, i) => map.set(k, {
    color: SERIES_VARS[i % MAX_SERIES],
    dash: DASHES[Math.floor(i / MAX_SERIES) % DASHES.length],
  }))
  return map
}
/** Background for a legend/picker key that matches a line's dash pattern. */
export function keyBackground(color, dash) {
  if (!dash) return color
  const [on, off] = String(dash).split(/\s+/).map(Number)
  return `repeating-linear-gradient(90deg, ${color} 0 ${on}px, transparent ${on}px ${on + off}px)`
}
