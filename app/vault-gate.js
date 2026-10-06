// "קוד הכספת" in the client card (docs/ops.md, section 29): the small dialog that
// asks for the 6-digit code before a password is shown, and the line "הכספת פתוחה עוד
// MM:SS" with "נעילה עכשיו". It is the gate of app/protocol-data.js (setPasswordGate):
// every "הצגת סיסמה" passes through askVaultCode(). The database decides everything
// (vault_unlock, access_reveal): this only asks, and shows what it answered. Until the
// owner sets a code (or before the migration) nothing is asked, as before.
import { h } from './quote-doc.js';
import { vaultCodeStatus, vaultUnlock, vaultLock } from './protocol-data.js';
import { isCode, isOpen, openText, unlockMessage, CODE_LENGTH, UNLOCK_MINUTES } from './vault-code.js';

let openUntil = null;   // this user's unlock, as the database last said
let hintEl = null;
let onLocked = null;    // the card hides the passwords it shows
let timer = null;
let dlg = null;

function paintHint() {
  if (!hintEl) return;
  const live = openUntil && new Date(openUntil) > new Date();
  if (!live) {
    const was = !!openUntil;
    openUntil = null;
    clearInterval(timer);
    timer = null;
    hintEl.hidden = true;
    hintEl.replaceChildren();
    if (was) onLocked?.();
    return;
  }
  const text = openText(openUntil);
  if (!hintEl.firstChild) {
    hintEl.replaceChildren(
      h('span', { id: 'vault-open-text', role: 'timer' }, text),
      h('button', { type: 'button', class: 'btn-text', id: 'vault-lock', onclick: lockNow }, 'נעילה עכשיו'));
  } else if (hintEl.firstChild.textContent !== text) hintEl.firstChild.textContent = text;
  hintEl.hidden = false;
  timer ||= setInterval(paintHint, 1000);
}
async function lockNow() {
  try { await vaultLock(); } catch { /* it ends by itself in a few minutes */ }
  openUntil = new Date(0).toISOString();
  paintHint();
}

// The card's line. `locked()` is called when the unlock ends (by time or "נעילה עכשיו").
export async function mountVaultHint(el, { locked = null } = {}) {
  hintEl = el;
  onLocked = locked;
  if (!el) return;
  const s = await vaultCodeStatus().catch(() => null);
  if (s?.set && s.openUntil) openUntil = s.openUntil;
  paintHint();
}

function build() {
  const input = h('input', {
    class: 'input vg-code', id: 'vg-code', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: String(CODE_LENGTH),
    autocomplete: 'off', dir: 'ltr', 'aria-describedby': 'vg-hint vg-err', required: true,
  });
  const err = h('p', { class: 'err', id: 'vg-err', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary', id: 'vg-submit' }, 'פתיחה');
  const d = h('dialog', { id: 'dlg-vault-code', class: 'vg-dlg', 'aria-labelledby': 'vg-h' },
    h('form', { id: 'vg-form', novalidate: true, autocomplete: 'off' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'vg-h' }, 'קוד הכספת'),
        h('button', { type: 'button', class: 'close', 'data-close': true, 'aria-label': 'סגירה' }, '×')),
      h('div', { class: 'dlg-body' },
        h('div', { class: 'field' }, h('label', { for: 'vg-code' }, 'קוד של 6 ספרות'), input),
        h('p', { class: 'hint', id: 'vg-hint' }, `אחרי הקוד הסיסמאות נפתחות ל־${UNLOCK_MINUTES} דקות, וכל צפייה נרשמת.`),
        err),
      h('div', { class: 'dlg-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'ביטול'), submit)));
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === d) d.close(); });
  // Digits only, whatever the keyboard.
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, CODE_LENGTH); });
  return { d, input, err, submit };
}

// The gate: resolves true when a password may be asked for now.
export async function askVaultCode() {
  const s = await vaultCodeStatus().catch(() => null);
  if (!s || isOpen(s)) { if (s?.set && s.openUntil) { openUntil = s.openUntil; paintHint(); } return true; }
  dlg ||= build();
  const { d, input, err, submit } = dlg;
  const say = (msg) => { err.textContent = msg || ''; err.hidden = !msg; if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
  const lock = (on) => { input.disabled = on; submit.disabled = on; };
  input.value = '';
  say(null);
  lock(false);
  if (s.lockedUntil) { say(unlockMessage({ state: 'locked', until: s.lockedUntil })); lock(true); }
  return new Promise((resolve) => {
    let done = false;
    const form = d.querySelector('form');
    const finish = (ok) => {
      if (done) return;
      done = true;
      form.removeEventListener('submit', onSubmit);
      d.removeEventListener('close', onClose);
      input.value = '';
      if (d.open) d.close();
      resolve(ok);
    };
    const onClose = () => finish(false);
    async function onSubmit(e) {
      e.preventDefault();
      const code = input.value;
      if (!isCode(code)) { say('הקוד הוא בדיוק 6 ספרות.'); input.focus(); return; }
      submit.disabled = true;
      let res = null;
      try { res = await vaultUnlock(code); } catch { res = null; }
      submit.disabled = false;
      input.value = '';
      if (res?.state === 'open' || res?.state === 'none') {
        if (res.until) { openUntil = res.until; paintHint(); }
        finish(true);
        return;
      }
      say(unlockMessage(res));
      if (res?.state === 'locked') lock(true); else input.focus();
    }
    form.addEventListener('submit', onSubmit);
    d.addEventListener('close', onClose);
    d.showModal();
    if (!input.disabled) input.focus();
  });
}
