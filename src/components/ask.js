// An in-page "are you sure?" for the device commands, in place of window.confirm().
// A browser that was once told to block this site's dialogs answers confirm() with "no" at once, showing nothing, so the
// click did nothing at all (4 Nov 2026 Put back; 19 Nov the WLC battery Set; 20 Nov Open / WLC from the lab laptop's
// browser while another laptop worked). This box is part of the page, so nothing can block it.
// Resolves true (Yes) or false (No, Escape, a click outside).
export function ask(message, { yes = 'Yes', no = 'Cancel' } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div')
    wrap.className = 'ask-overlay'
    wrap.innerHTML = '<div class="ask-box" role="alertdialog" aria-modal="true"><p class="ask-msg"></p>'
      + '<div class="ask-btns"><button type="button" class="btn ask-no"></button><button type="button" class="btn btn-primary ask-yes"></button></div></div>'
    wrap.querySelector('.ask-msg').textContent = message
    wrap.querySelector('.ask-yes').textContent = yes
    wrap.querySelector('.ask-no').textContent = no
    const done = v => { document.removeEventListener('keydown', key, true); wrap.remove(); resolve(v) }
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true) }
    }
    wrap.addEventListener('click', e => { e.stopPropagation(); if (e.target === wrap) done(false) })
    wrap.querySelector('.ask-yes').addEventListener('click', () => done(true))
    wrap.querySelector('.ask-no').addEventListener('click', () => done(false))
    document.addEventListener('keydown', key, true)
    document.body.appendChild(wrap)
    wrap.querySelector('.ask-yes').focus()
  })
}
