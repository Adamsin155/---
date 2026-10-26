// The quiet line at the very bottom of "המשימות שלי" (the owner, 26.10.2026): the list holds
// tasks only, so the cards of the notifications and of WhatsApp left it for the window "ההתראות
// שלך" (clients.html #dlg-connect, opened from the bell's list too). While something is not
// connected for this person on this device, one small line says so, each part with "לחבר" to
// its own flow: the notifications card in that window (app/push.js), WhatsApp's consent
// screen (app/whatsapp.js). When everything is connected, nothing at all. The full status of
// the whole team stays on the team page (the owners and Irit). The words: connectGaps in
// app/push-logic.js.
import { h, fill } from './protocol-ui.js';
import { connectGaps, isPhone } from './push-logic.js';
import { pushNow } from './push.js';
import { waNow, openWhatsappConsent } from './whatsapp.js';

let dialogEl = null;

// The window "ההתראות שלך": the notifications card and WhatsApp's, with their own buttons.
export function openConnect(from = null) {
  if (!dialogEl) return;
  if (!dialogEl.open) dialogEl.showModal();
  (dialogEl.querySelector('#push-card:not([hidden]) button, #push-card:not([hidden]) summary') || dialogEl.querySelector('#connect-h'))?.focus();
  dialogEl.dataset.from = from || '';
}

// `closed`: told when the window closes (the page waits while a window is open, so the list is
// drawn again then: what was connected in it leaves the line and the list's tools).
export function mountConnect(dialog, { closed = () => {} } = {}) {
  dialogEl = dialog;
  if (!dialog) return;
  dialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    closed();
    // Back to the line (or the bell) that opened it, when it is still there.
    const id = dialog.dataset.from;
    (id && document.getElementById(id)?.offsetParent ? document.getElementById(id) : document.getElementById('tab-mine'))?.focus();
  });
}

// Draws the line into `el`; `own`: the list on the screen is the person's own "המשימות שלי"
// (not the team's, not another person's). Hidden when there is nothing to say.
export function paintConnectLine(el, { own = true } = {}) {
  if (!el) return;
  const gaps = own ? connectGaps({
    push: pushNow(), phone: isPhone({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }), wa: waNow(),
  }) : [];
  el.hidden = !gaps.length;
  if (!gaps.length) { fill(el); return; }
  const go = (g) => {
    if (!g.cta) return null;
    const id = `connect-${g.key}`;
    return h('button', {
      type: 'button', class: 'btn-text mc-go', id, 'aria-label': `${g.cta}: ${g.text}`,
      onclick: () => (g.key === 'push' ? openConnect(id) : openWhatsappConsent()),
    }, g.cta);
  };
  fill(el, h('ul', { class: 'mc-list' }, ...gaps.map((g) => h('li', { class: 'mc-item', 'data-gap': g.key },
    h('span', { class: 'mc-text' }, g.text), g.cta ? h('span', { class: 'mc-sep', 'aria-hidden': 'true' }, ' · ') : null, go(g)))));
}
