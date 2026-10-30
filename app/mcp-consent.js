// The page where someone approves connecting their Claude account (mcp-consent.html; docs/ops.md,
// section 84). Supabase's OAuth server sends the person here with ?authorization_id=…: they sign in
// with their usual login if needed, see in plain words which app asks and what it will be able to do,
// and approve or refuse; then the browser goes back to where Supabase says. Who may connect is the
// database's (public.mcp_allowed()): anyone else is told so and gets no button. This page keeps
// nothing, and it does not go through the app's menu or a person's home page: it is one question.
import { supabase, currentStaff, sessionEmail, explainError, cleanEmail, looksLikeEmail, sendPasswordReset, signOutHere, RESET_NEEDS_EMAIL, RESET_SENT } from './supa.js';
import { loginDoor } from './login-ui.js';
import { authorizationIdOf, safeRedirect, clientNameOf, clientHostOf, CONSENT_CAN, CONSENT_CANNOT, CONSENT_WORDS } from './mcp-logic.js';

const $ = (id) => document.getElementById(id);
const AUTH_ID = authorizationIdOf(location.search);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') node.addEventListener('click', v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function show(title, ...body) {
  $('login-block').hidden = true;
  $('app').hidden = false;
  $('card-h').textContent = title;
  $('card-body').replaceChildren(...body.filter(Boolean));
  $('card-h').focus({ preventScroll: true });
}
const sub = (text) => el('p', { class: 'mc-sub' }, text);
// Going back to the app that asked: only to a web address Supabase gave.
function goBack(url) {
  const safe = safeRedirect(url);
  if (!safe) { show('לא הצלחנו לחזור', sub(CONSENT_WORDS.bad_link)); return false; }
  location.assign(safe);
  return true;
}
function anotherAccount() {
  return el('button', {
    type: 'button', class: 'mc-other', id: 'mc-other',
    onclick: async () => { await signOutHere(); showLogin(); },
  }, 'כניסה עם חשבון אחר');
}
function showLogin() {
  $('app').hidden = true;
  $('login-block').hidden = false;
  $('lg-email').focus();
}

async function decide(action) {
  const yes = $('mc-yes');
  const no = $('mc-no');
  const err = $('mc-err');
  err.hidden = true;
  yes.disabled = true;
  no.disabled = true;
  if (action === 'approve') yes.textContent = 'מחבר…';
  // The browser's move stays here (safeRedirect), not inside the library.
  const ask = action === 'approve' ? 'approveAuthorization' : 'denyAuthorization';
  const { data, error } = await supabase.auth.oauth[ask](AUTH_ID, { skipBrowserRedirect: true }).catch(() => ({ error: true }));
  if (!error && data?.redirect_url) { goBack(data.redirect_url); return; }
  err.textContent = CONSENT_WORDS.failed;
  err.hidden = false;
  yes.disabled = false;
  no.disabled = false;
  yes.textContent = 'אישור';
}

function consentScreen(details, email) {
  const name = clientNameOf(details);
  const host = clientHostOf(details);
  show(`${name} מבקש להתחבר לחשבון שלך באסטרטג`,
    host ? el('p', { class: 'mc-sub' }, 'אחרי האישור חוזרים אל ', el('span', { class: 'mc-host', id: 'mc-host' }, host)) : null,
    el('h2', { class: 'mc-h' }, 'מה הוא יוכל לעשות'),
    el('ul', { class: 'mc-list mc-yes', id: 'mc-can' }, ...CONSENT_CAN.map((t) => el('li', {}, t))),
    el('h2', { class: 'mc-h' }, 'מה הוא לא יוכל'),
    el('ul', { class: 'mc-list mc-no', id: 'mc-cannot' }, ...CONSENT_CANNOT.map((t) => el('li', {}, t))),
    el('p', { class: 'mc-err', id: 'mc-err', role: 'alert', hidden: '' }),
    el('div', { class: 'mc-acts' },
      el('button', { type: 'button', class: 'btn btn-primary', id: 'mc-yes', onclick: () => decide('approve') }, 'אישור'),
      el('button', { type: 'button', class: 'btn', id: 'mc-no', onclick: () => decide('deny') }, 'לא עכשיו')),
    el('p', { class: 'mc-who', id: 'mc-who' }, `מחובר/ת בתור ${email || ''} · `, anotherAccount()));
}

// Signed in: is this person on the list, and what does Supabase say of this request?
async function ask() {
  const email = await sessionEmail().catch(() => null);
  const allowed = await supabase.rpc('mcp_allowed').catch(() => ({ error: true }));
  // Before the migration, or on a failure: no button either.
  if (allowed.error || allowed.data !== true) {
    show('אין גישה', sub(CONSENT_WORDS.not_allowed), el('p', { class: 'mc-who', id: 'mc-who' }, `מחובר/ת בתור ${email || ''} · `, anotherAccount()));
    return;
  }
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(AUTH_ID).catch(() => ({ error: true }));
  if (error || !data) {
    show('הקישור לא תקף', sub(CONSENT_WORDS.bad_link));
    return;
  }
  // Approved before: Supabase answers with where to go, and there is nothing to ask.
  if (!('authorization_id' in data)) {
    if (data.redirect_url) goBack(data.redirect_url);
    else show('הקישור לא תקף', sub(CONSENT_WORDS.bad_link));
    return;
  }
  consentScreen(data, email);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('lg-submit').disabled = true;
  $('lg-err').hidden = true;
  $('lg-msg').hidden = true;
  loginDoor.signing();
  const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail($('lg-email').value), password: $('lg-pass').value });
  $('lg-submit').disabled = false;
  if (error) { $('lg-err').textContent = explainError(error); $('lg-err').hidden = false; loginDoor.failed(); return; }
  $('lg-pass').value = '';
  await ask();
});
$('lg-forgot').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const email = cleanEmail($('lg-email').value);
  $('lg-err').hidden = true;
  $('lg-msg').hidden = true;
  if (!looksLikeEmail(email)) { $('lg-err').textContent = RESET_NEEDS_EMAIL; $('lg-err').hidden = false; $('lg-email').focus(); return; }
  btn.disabled = true;
  try { await sendPasswordReset(email); $('lg-msg').textContent = RESET_SENT; $('lg-msg').hidden = false; } catch (err) { $('lg-err').textContent = explainError(err); $('lg-err').hidden = false; }
  btn.disabled = false;
});

(async () => {
  if (!AUTH_ID) { show('הקישור לא תקף', sub(CONSENT_WORDS.bad_link)); return; }
  const staff = await currentStaff().catch(() => null);
  if (!staff) { showLogin(); return; }
  await ask();
})();
