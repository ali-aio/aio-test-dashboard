// Light/dark toggle. No stored choice = follow the OS (prefers-color-scheme); once a
// button is pressed the choice is stored and wins. The pre-paint stamp lives inline in
// each page's <head> (see THEME_STAMP there) so the page never flashes the wrong theme.
//
// More than one button can drive it (index.html has one at the top of the source list and
// one in the status bar), so every registered button is repainted on any change — a toggle
// pressed in one place must not leave the other showing the old glyph.
const KEY = 'theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const btns = new Set();

function stored() { try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; } }
function effective() { return stored() || (mq.matches ? 'dark' : 'light'); }
function paint(btn) {
  const t = effective();
  btn.textContent = t === 'dark' ? '☀' : '☾';
  btn.title = btn.ariaLabel = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
const paintAll = () => btns.forEach(paint);
mq.addEventListener('change', paintAll);

export function initThemeToggle(btn) {
  if (!btn || btns.has(btn)) return;
  btns.add(btn);
  btn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode — still applies this session */ }
    document.documentElement.setAttribute('data-theme', next);
    paintAll();
  });
  paint(btn);
}
