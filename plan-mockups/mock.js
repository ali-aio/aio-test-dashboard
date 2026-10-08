/* Shared shell + mock data for the test-plan mockups. Classic script (no modules) so the
   pages open straight from disk. Nothing here talks to the MDM — every number is invented. */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Test types come from the lab's CSV file names (Tariq's dashboard README).
  const TYPES = [
    { id: 'ads',    name: 'Discharge on Ads',   dot: '#0a84ff', blurb: 'Screen on, ads looping, battery runs down' },
    { id: 'wlcload', name: 'WLC on Load',       dot: '#5e5ce6', blurb: 'Wireless charging pad with the device under load' },
    { id: 'wlcads', name: 'WLC + Discharge on Ads', dot: '#bf5af2', blurb: 'Pad charging and ads discharge back to back' },
    { id: 'burnin', name: 'Burn-in Test',       dot: '#c2a000', blurb: 'Sustained full load for thermal and stability' },
    { id: 'restaurant', name: 'Restaurant Case', dot: '#30b0c7', blurb: 'Replays a restaurant-day usage pattern' },
    { id: 'charging', name: 'Charging Cycle',    dot: '#a2845e', blurb: 'Charge-only cycle, wired' },
    { id: 'phone',  name: 'WLC on Phone',        dot: '#8e8e93', blurb: 'Device charging a phone from its pad' },
  ];
  const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));

  const SERIALS = Array.from({ length: 26 }, (_, i) => 'AT070AABU' + String(231 + i * 7).padStart(5, '0'));
  // deterministic pseudo-random so every reload shows the same mock
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const chip = id => id ? `<span class="tchip"><i style="background:${TYPE[id].dot}"></i>${esc(TYPE[id].name)}</span>` : '<span class="tchip none"><i></i>Untagged</span>';
  const badge = (k, t, live) => `<span class="badge b-${k}${live ? ' live' : ''}">${esc(t)}</span>`;
  const SRC = {
    plan:     badge('run', 'Planned'),
    csv:      badge('off', 'Imported CSV'),
    none:     badge('warn', 'Untagged'),
  };
  const bar = (p, cls) => `<div class="bar ${cls || ''}"><i style="width:${p}%"></i></div>`;

  const ICON = {
    grid: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
    dev: '<rect x="4" y="1.5" width="8" height="13" rx="1.5"/><path d="M7 12h2"/>',
    clock: '<path d="M8 2v6l4 2"/><circle cx="8" cy="8" r="6.5"/>',
    pulse: '<path d="M2 9.5h2.5l1.5-4 2 6 1.5-3H14"/>',
    bolt: '<path d="M9 1.5 4 9h4l-1 5.5L13 7H9z" stroke-linejoin="round"/>',
    therm: '<path d="M6.5 9.5V3a1.5 1.5 0 0 1 3 0v6.5a2.5 2.5 0 1 1-3 0z"/>',
    today: '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/>',
    sched: '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M5 9h2M9 9h2M5 11.5h2"/>',
    hist: '<path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path d="M2.5 2.5v3h3M8 5v3l2 1.5"/>',
    imp: '<path d="M8 2v8M5 7l3 3 3-3M2.5 13.5h11"/>',
    doc: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>',
    info: '<circle cx="8" cy="8" r="6.5"/><path d="M8 7v4M8 5v.01"/>',
  };
  const svg = p => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

  function sidebar(active) {
    const glyph = (key, label, col, ic, href, cnt) => `<a class="item ${active === key ? 'on' : ''}" href="${href}"><span class="glyph" style="background:${col}">${svg(ic)}</span><span class="nm">${label}</span><span class="cnt num">${cnt || ''}</span></a>`;
    const item = (key, label, ic, href, cnt) => `<a class="item ${active === key ? 'on' : ''}" href="${href}">${svg(ic)}<span class="nm">${label}</span><span class="cnt num">${cnt || ''}</span></a>`;
    return `<div class="sec">Views</div>
      ${glyph('overview', 'Overview', '#f9674e', ICON.grid, '#')}
      ${glyph('devices', 'Devices', '#5e5ce6', ICON.dev, '06-device.html', '26')}
      ${glyph('runs', 'Test cycles', '#34c759', ICON.clock, '#')}
      ${glyph('health', 'Health', '#ff9f0a', ICON.pulse, '#')}
      ${glyph('charging', 'Charging', '#0a84ff', ICON.bolt, '#')}
      ${glyph('thermal', 'Thermal', '#ff375f', ICON.therm, '#')}
      <div class="sec">Test plan <span class="newtag">new</span></div>
      ${item('today', 'Today', ICON.today, '01-today.html', '23/26')}
      ${item('schedule', 'Schedule', ICON.sched, '03-schedule.html')}
      ${item('history', 'History', ICON.hist, '04-history.html')}
      ${item('import', 'Import past data', ICON.imp, '05-import.html')}
      <div class="sec">About these mockups</div>
      ${item('approach', 'The approach', ICON.info, '00-approach.html')}`;
  }

  function mount(o) {
    document.title = (o.title || 'Test plan') + ' — mockup';
    document.documentElement.setAttribute('data-theme', (function () { try { return localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { return 'light'; } })());
    if (!o.insp) document.body.classList.add('noinsp');
    document.body.innerHTML = `
    <div class="app"><div class="body">
      <aside class="source"><div id="source">${sidebar(o.active)}</div></aside>
      <main class="pane"><div class="content" id="view">
        <div class="mock-note"><b>Mockup · mock data.</b> ${o.note || ''}</div>
        ${o.content}
      </div></main>
      <aside class="insp" id="insp">${o.insp || ''}</aside>
    </div>
    <footer class="status"><span>${o.status || 'Mockup — nothing on this page is live'}</span><button class="tbtn" id="theme" title="Toggle light / dark"></button></footer></div>`;
    const tb = document.getElementById('theme'); const paint = () => tb.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾'; paint();
    tb.onclick = () => { const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('theme', n); } catch (e) {} paint(); };
  }

  window.Mock = { esc, TYPES, TYPE, SERIALS, rnd, chip, badge, SRC, bar, ICON, svg, mount };
})();
