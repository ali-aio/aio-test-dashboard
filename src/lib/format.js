// Pure formatting + small numeric helpers, shared by every view. No DOM, no React.
export const H = 3600e3, MIN = 60e3, DAY = 24 * H;
export const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export const pctl = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
export const pctOf = (a, b) => b ? (a - b) / b * 100 : null;
export const signed = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
export const ago = t => { const m = Math.round((Date.now() - t) / MIN); return m < 2 ? 'just now' : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
export const dt = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
export const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const hoursAxis = max => isFinite(max) ? Math.max(12, Math.ceil(max * 1.1 / 12) * 12) : 24;
export const int = v => Math.round(v).toLocaleString();
