// Catmull-Rom → cubic-bezier spline through {x,y} points — smooth, no overshoot
// wiggle on monotonic runs, used instead of straight M/L segments everywhere so a
// noisy reading doesn't read as a jagged zig-zag.
function smoothPath(points) {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// Small moving average so the curve reads as a trend, not every single noisy sample —
// a real jitter in one reading shouldn't yank the line around; it should round it off.
function smoothValues(values, window = 3) {
  if (values.length <= window) return values;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(values.length - 1, i + half);
    let sum = 0, n = 0;
    for (let j = lo; j <= hi; j++) { sum += values[j]; n++; }
    return sum / n;
  });
}

// Shared history line chart: battery_pct over time, charge bands shaded, hover crosshair.
export function renderHistoryChart(container, rows, opts = {}) {
  const w = opts.w || 1000, h = opts.h || 200, pad = 32;
  const color = opts.color || 'var(--chart-battery)';
  const key = opts.key || 'battery_pct';
  const label = opts.label || 'battery';

  // The history API fills gaps (device offline / no samples) with placeholder rows
  // marked `empty: true` rather than omitting them — plotting those as battery_pct: 0
  // is exactly what caused the spikes-into-zero on a no-data stretch. Drop them.
  rows = rows.filter(r => !r.empty);

  if (!rows.length) {
    container.innerHTML = '<div class="drawer-loading">No samples in this range.</div>';
    return;
  }

  const pts = rows.map(r => {
    let extra = {};
    try { extra = typeof r.extra === 'string' ? JSON.parse(r.extra) : (r.extra || {}); } catch (e) {}
    return { t: new Date(r.timestamp).getTime(), v: r[key], charging: !!extra.charging };
  });
  const xs = pts.map(p => p.t);
  const xMin = Math.min(...xs), xMax = Math.max(...xs) || xMin + 1;
  const yMin = opts.yMin ?? 0, yMax = opts.yMax ?? 100;
  const X = t => pad + (t - xMin) / (xMax - xMin) * (w - pad * 2);
  const Y = v => h - pad + 8 - (v - yMin) / (yMax - yMin) * (h - pad - 8);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.classList.add('chart');

  if (opts.chargeBands !== false) {
    let i = 0;
    while (i < pts.length) {
      if (pts[i].charging) {
        let j = i;
        while (j < pts.length && pts[j].charging) j++;
        const rect = document.createElementNS(svg.namespaceURI, 'rect');
        rect.setAttribute('x', X(pts[i].t));
        rect.setAttribute('y', 4);
        rect.setAttribute('width', Math.max(1, X(pts[Math.max(i, j - 1)].t) - X(pts[i].t)));
        rect.setAttribute('height', h - 8);
        rect.setAttribute('fill', 'var(--accent-soft)');
        svg.appendChild(rect);
        i = j;
      } else i++;
    }
  }

  for (let g = 0; g <= 3; g++) {
    const gy = pad + g * (h - pad - 8) / 3;
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', pad); line.setAttribute('x2', w - pad);
    line.setAttribute('y1', gy); line.setAttribute('y2', gy);
    line.setAttribute('stroke', 'var(--chart-grid)'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  }

  const smoothed = smoothValues(pts.map(p => p.v));
  const path = smoothPath(pts.map((p, i) => ({ x: X(p.t), y: Y(smoothed[i]) })));
  const pathEl = document.createElementNS(svg.namespaceURI, 'path');
  pathEl.setAttribute('d', path);
  pathEl.setAttribute('fill', 'none');
  pathEl.setAttribute('stroke', color);
  pathEl.setAttribute('stroke-width', '2.5');
  pathEl.setAttribute('stroke-linecap', 'round');
  pathEl.setAttribute('stroke-linejoin', 'round');
  pathEl.style.strokeDasharray = '4000';
  pathEl.style.strokeDashoffset = '4000';
  pathEl.style.animation = 'draw-chart .6s ease-out forwards';
  svg.appendChild(pathEl);

  const cross = document.createElementNS(svg.namespaceURI, 'line');
  cross.setAttribute('class', 'crosshair-line');
  cross.setAttribute('y1', 4); cross.setAttribute('y2', h - 4);
  cross.setAttribute('visibility', 'hidden');
  svg.appendChild(cross);
  const dot = document.createElementNS(svg.namespaceURI, 'circle');
  dot.setAttribute('r', 4); dot.setAttribute('fill', color);
  dot.setAttribute('stroke', 'var(--surface)'); dot.setAttribute('stroke-width', '2');
  dot.setAttribute('visibility', 'hidden');
  svg.appendChild(dot);

  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  const tip = document.createElement('div');
  tip.className = 'tooltip-box';
  tip.style.display = 'none';
  wrap.appendChild(svg);
  wrap.appendChild(tip);

  svg.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width * w;
    let nearest = pts[0], nd = Infinity;
    for (const p of pts) { const dx = Math.abs(X(p.t) - mx); if (dx < nd) { nd = dx; nearest = p; } }
    cross.setAttribute('x1', X(nearest.t)); cross.setAttribute('x2', X(nearest.t));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', X(nearest.t)); dot.setAttribute('cy', Y(nearest.v));
    dot.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.style.left = Math.min(X(nearest.t) + 10, w - 160) + 'px';
    tip.style.top = '2px';
    const time = new Date(nearest.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    tip.textContent = `${time} · ${label} ${nearest.v}${opts.unit || ''}${nearest.charging ? ' · charging' : ''}`;
  });
  svg.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });

  container.innerHTML = '';
  container.appendChild(wrap);
}

export function sparkline(rows, key, color, w, h) {
  rows = rows.filter(r => !r.empty); // see renderHistoryChart — same no-data-as-zero bug
  if (!rows.length) return `<svg width="${w}" height="${h}"></svg>`;
  const pad = 3; // headroom so a bold stroke's rounded cap/curve peak doesn't clip the viewBox
  const raw = rows.map(r => r[key] ?? 0);
  const ys = smoothValues(raw, 5);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const X = i => i / (rows.length - 1 || 1) * w;
  const Y = v => pad + (h - pad * 2) - (v - yMin) / (yMax - yMin + 0.001) * (h - pad * 2);
  const points = rows.map((r, i) => ({ x: X(i), y: Y(ys[i]) }));
  const path = smoothPath(points);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
