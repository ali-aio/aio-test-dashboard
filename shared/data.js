// Shared API wiring for all four demo pages — config storage, fetchDevices/fetchHistory.
export function apiBase() { return (localStorage.getItem('apiBase') || '').replace(/\/$/, ''); }
export function apiKey() { return localStorage.getItem('apiKey') || ''; }
export function hasConfig() { return !!(apiBase() && apiKey()); }

// Scope (group) is a setting, not a per-page filter — the testing team works within
// one lab group, so it's set once (via the scope badge's dropdown) and every page
// respects it automatically rather than each page pulling the whole fleet and
// filtering client-side. Restaurant scoping was tried and dropped — group only, for now.
export function scopeGroup() { return localStorage.getItem('scopeGroup') || ''; }

function clearDeviceCache() {
  try {
    Object.keys(sessionStorage).filter(k => k.startsWith('cache:devices')).forEach(k => sessionStorage.removeItem(k));
  } catch (e) {}
}

export function setScopeGroup(group) {
  localStorage.setItem('scopeGroup', group.trim());
  clearDeviceCache(); // scope changed — any cached list under the old scope is now wrong
}

export function saveConfig(base, key) {
  localStorage.setItem('apiBase', base.trim());
  localStorage.setItem('apiKey', key.trim());
  clearDeviceCache();
}

export async function fetchFilters() {
  const res = await fetch(`${apiBase()}/api/v1/testdata/filters`, { headers: { 'X-API-Key': apiKey() } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── Persistent cache (sessionStorage) ──────────────────────────────────────────
// Keyed per-tab, survives navigating between pages (the whole point of pulling this
// out of in-memory JS objects) but clears when the tab closes — never serves a week-
// old number silently. Each entry carries its own TTL; fetchDevices/fetchHistory
// return the cached value instantly when fresh, and a hard refresh (refreshBtn) can
// force a bypass via { fresh: true }.
const DEVICES_TTL_MS = 20_000;   // once-a-cycle snapshot; 20s avoids a refetch per page nav
const HISTORY_TTL_MS = 60_000;   // history for a given range barely changes minute to minute

function cacheGet(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > ttlMs) return null;
    return v;
  } catch (e) { return null; }
}
function cacheSet(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch (e) { /* storage full/private mode — just skip caching */ }
}

export async function fetchDevices(opts = {}) {
  const group = scopeGroup();
  const key = `cache:devices:${group}`;
  if (!opts.fresh) {
    const cached = cacheGet(key, DEVICES_TTL_MS);
    if (cached) return cached;
  }
  const qs = group ? `?group=${encodeURIComponent(group)}` : '';
  const res = await fetch(`${apiBase()}/api/v1/testdata/devices${qs}`, { headers: { 'X-API-Key': apiKey() } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  cacheSet(key, data);
  return data;
}

export async function fetchHistory(serial, hours, opts = {}) {
  const key = `cache:history:${serial}:${hours}`;
  if (!opts.fresh) {
    const cached = cacheGet(key, HISTORY_TTL_MS);
    if (cached) return cached;
  }
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  const url = `${apiBase()}/api/v1/testdata/devices/${encodeURIComponent(serial)}/history`
    + `?start=${start.toISOString()}&end=${end.toISOString()}&interval_sec=${hours <= 24 ? 300 : 1800}&cycles=true`;
  const res = await fetch(url, { headers: { 'X-API-Key': apiKey() } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const rows = await res.json();
  cacheSet(key, rows);
  return rows;
}

// Run `fn` over `items` with at most `limit` in flight at once — used for the
// per-device sparkline fetches, which used to run one at a time (N sequential round
// trips) and were the actual cause of "loading takes forever" on a bigger fleet.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = undefined; }
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return results;
}

// Config now lives on its own settings.html page, not inline on each dashboard page.
// Call this on load: if config is missing, shows a banner pointing at Settings instead
// of running onReady. Every page's topbar should still link to settings.html so there's
// always a way in.
export function requireConfig(bannerEl, onReady) {
  if (hasConfig()) { onReady(); return; }
  if (bannerEl) {
    bannerEl.hidden = false;
    bannerEl.innerHTML = 'No API key configured yet — <a href="settings.html" style="color:inherit;font-weight:700;text-decoration:underline">open Settings</a> to add one.';
    bannerEl.classList.remove('in'); void bannerEl.offsetWidth; bannerEl.classList.add('in');
  }
}

// Visible, everywhere — scoping was applying silently (set in Settings, invisible on
// every other page), which reads as "it's not scoped at all." The badge is the scope
// picker itself (a dropdown of groups, filled from /testdata/filters) rather than a
// link elsewhere — picking a group clears the stale cache and reloads the page.
//
// The popover is appended to <body>, not rendered inline under the badge. Several
// pages have an ancestor (e.g. .topbar, animated on load) whose CSS animation creates
// an implicit stacking context — any z-index on a descendant is then trapped inside
// that context and can never out-paint that ancestor's later DOM siblings (the stats
// row, the table) no matter how high the z-index number is. Rendering at the body
// level and positioning it with fixed coordinates sidesteps that entirely.
let scopePop = null;
function getScopePop() {
  if (scopePop) return scopePop;
  scopePop = document.createElement('div');
  scopePop.className = 'scope-pop';
  scopePop.hidden = true;
  document.body.appendChild(scopePop);
  document.addEventListener('click', () => { scopePop.hidden = true; });
  window.addEventListener('scroll', () => { scopePop.hidden = true; }, true);
  return scopePop;
}

export function initScopeBadge(el) {
  if (!el) return;
  const group = scopeGroup();
  el.innerHTML = `<button type="button" class="scope-badge" id="scope-badge-btn">${group || 'All devices'}</button>`;
  const btn = el.querySelector('#scope-badge-btn');
  const pop = getScopePop();

  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const wasOpen = !pop.hidden;
    pop.hidden = true;
    if (wasOpen) return;

    const rect = btn.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${rect.left}px`;
    pop.hidden = false;
    pop.innerHTML = '<div class="scope-pop-loading"><span class="spinner" style="border-color:var(--border);border-top-color:var(--accent)"></span></div>';
    try {
      const { groups } = await fetchFilters();
      const options = ['', ...groups];
      pop.innerHTML = options.map(g => {
        const active = g === group;
        return `<button type="button" class="scope-opt${active ? ' active' : ''}" data-group="${g}">${g || 'All devices'}</button>`;
      }).join('');
      pop.querySelectorAll('.scope-opt').forEach(opt => opt.addEventListener('click', () => {
        setScopeGroup(opt.dataset.group);
        location.reload();
      }));
    } catch (err) {
      pop.innerHTML = `<div class="scope-pop-loading">Error: ${err.message}</div>`;
    }
  });
}

export function showBanner(el, msg) {
  if (!el) return;
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
}
