// Light/dark toggle. No stored choice = follow the OS (prefers-color-scheme); once the
// button is pressed the choice is stored and wins. The pre-paint stamp lives inline in
// each page's <head> (see THEME_STAMP there) so the page never flashes the wrong theme.
const KEY = 'theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function stored() { try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; } }
function effective() { return stored() || (mq.matches ? 'dark' : 'light'); }

export function initThemeToggle(btn) {
  if (!btn) return;
  const paint = () => {
    const t = effective();
    btn.textContent = t === 'dark' ? '☀' : '☾';
    btn.title = btn.ariaLabel = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  };
  btn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode — still applies this session */ }
    document.documentElement.setAttribute('data-theme', next);
    paint();
  });
  mq.addEventListener('change', paint);
  paint();
}
