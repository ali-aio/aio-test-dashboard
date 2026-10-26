// Whether each tablet's host app (Nugget — the app that plays the ads) was on screen, from the
// MDM testing API's host-app routes (read-only, added 21 Oct 2026; data from firmware client
// 1.11.0+, kept from 17 Oct 2026):
//   GET /api/v1/testdata/host-app                      — every device, state now (Today, the bell)
//   GET /api/v1/testdata/devices/{serial}/host-app     — one device's timeline as spans
// The sweep keeps every device's spans in data/hostapp.json (buildHostApp in server/sweep.mjs);
// a cycle's share of time with the app on screen is how the dashboard knows the ads really ran
// (before this it only assumed it from the test). Plain JS, shared by the server and the browser.

/** Compact span codes, as stored in data/hostapp.json: [fromMs, toMs, code]. */
export const SPAN = { on: 'on', screenOff: 'off', otherApp: 'app', noReport: 'nr', offline: 'x' };
export const spanCode = (state, why) => (state === 'on_screen' ? SPAN.on
  : state === 'off_screen' ? (why === 'screen_off' ? SPAN.screenOff : SPAN.otherApp)
  : why === 'device_offline' ? SPAN.offline : SPAN.noReport);
export const SPAN_LABEL = { on: 'App on screen', off: 'Screen off', app: 'Another app in front', nr: 'Not reported', x: 'Offline' };
/** The live list's state as a span code (state now). */
export const stateCode = (x) => (x ? spanCode(x.state, x.why) : SPAN.noReport);

/** One device's timeline from the API (spans with from / to / state / why) -> compact spans. */
export function compactSpans(apiSpans = []) {
  return apiSpans.map((s) => [Date.parse(s.from), Date.parse(s.to), spanCode(s.state, s.why)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
}

/** Merge a fresh window of spans into the stored ones: the fresh window wins where they overlap,
 *  anything stored before it is kept (cut at its start), and touching spans of one code join. */
export function mergeSpans(old = [], fresh = [], keepFrom = -Infinity) {
  if (!fresh.length) return old.filter((s) => s[1] > keepFrom);
  const from = fresh[0][0], out = [];
  for (const s of old) { if (s[1] <= keepFrom) continue; if (s[0] >= from) break; out.push(s[1] > from ? [s[0], from, s[2]] : s); }
  for (const s of fresh) {
    const last = out[out.length - 1];
    if (last && last[2] === s[2] && last[1] >= s[0]) last[1] = Math.max(last[1], s[1]); else out.push([...s]);
  }
  return out;
}

const firstEndingAfter = (spans, t) => { let lo = 0, hi = spans.length; while (lo < hi) { const m = (lo + hi) >> 1; if (spans[m][1] <= t) lo = m + 1; else hi = m; } return lo; };

/**
 * How the time from `start` to `end` was spent: seconds per code, the on-screen share of the
 * KNOWN time (on screen + screen off + other app), and the longest stretch the app was not on
 * screen. null when nothing is known in that time (client too old, or before 17 Oct 2026).
 */
export function screenTime(spans, start, end) {
  if (!spans?.length || !(end > start)) return null;
  const s = { on: 0, off: 0, app: 0, nr: 0, x: 0 }; let gap = null, run = null;
  for (let i = firstEndingAfter(spans, start); i < spans.length && spans[i][0] < end; i++) {
    const [a0, b0, code] = spans[i], a = Math.max(a0, start), b = Math.min(b0, end);
    if (b <= a) continue;
    s[code] += (b - a) / 1e3;
    // a stretch with the app not on screen (screen off or another app; unknown time breaks it)
    if (code === SPAN.screenOff || code === SPAN.otherApp) {
      run = run && run.to >= a ? { ...run, to: b, why: code } : { from: a, to: b, why: code };
      if (!gap || run.to - run.from > gap.to - gap.from) gap = run;
    } else if (code === SPAN.on) run = null;
  }
  const known = s.on + s.off + s.app;
  if (!known) return null;
  return { onS: s.on, screenOffS: s.off, otherAppS: s.app, unknownS: s.nr + s.x, knownS: known,
    onPct: Math.round(s.on / known * 1000) / 10, longestOff: gap ? { ...gap, min: Math.round((gap.to - gap.from) / 60e3) } : null };
}

// An ads test whose app was off screen this long at a stretch, or on screen for less than this
// share of the known time, did not run its ads as the test says — flagged on the cycle
export const ADS_GAP_MIN = 15, ADS_MIN_PCT = 90;
export const adsGap = (st) => !!st && (st.onPct < ADS_MIN_PCT || (st.longestOff?.min ?? 0) >= ADS_GAP_MIN);
