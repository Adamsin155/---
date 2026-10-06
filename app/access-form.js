// The client's logins form (access.html): opened from a secret link in WhatsApp, no
// password, filled on a phone. Write-only: the page asks the database only for the
// business name and the link's state (public.access_form_info), and sends once
// (public.access_form_submit), which answers only a state. Nothing typed here is kept
// in the browser (no localStorage, no cookie): closing the page before sending means
// filling it again. The rules and the words: app/access-logic.js, which the database
// repeats. All text goes through text nodes, never innerHTML.
//
// The page loads only its own files (this one, access-logic.js, tz.js, supa.js and
// the Supabase client beside it) and talks only to the database: see the
// Content-Security-Policy in access.html.
import {
  TOKEN, tokenFrom, insecure, secureUrl, REQUIRED, EXTRA_PLATFORMS, CHOICES, NETWORK_NAMES, emptyForm, canAddExtra, formProblems, waitingText,
  buildPayload, confirmLines, PAGE_TEXT, CLOSED_TEXT, SEND_ERRORS, USER_MAX, PASS_MAX, LABEL_MAX,
} from './access-logic.js';

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

let token = '';
let supa = null;
let preview = false;
let form = emptyForm();
let seq = 0;
let sending = false;
let pending = null;            // the payload being confirmed
const touched = new Set();     // the fields whose message may show (left once, or after "המשך")
let showAll = false;

// ── States ────────────────────────────────
function showState(kind, extra = null) {
  const [title, text] = CLOSED_TEXT[kind] || CLOSED_TEXT.error;
  wipe();
  $('page').hidden = true;
  $('thanks').hidden = true;
  $('foot').hidden = true;
  fill($('state'), h('h1', {}, title), text ? h('p', {}, text) : null, extra);
  $('state').hidden = false;
  document.title = `${title} · astrateg`;
}

// Everything typed leaves the page: the state, and the fields themselves.
function wipe() {
  for (const el of document.querySelectorAll('#form input, #form textarea')) { el.value = ''; if (el.type === 'password') el.type = 'text'; }
  form = emptyForm();
  pending = null;
  fill($('cards'));
  fill($('extras'));
  fill($('review'));
  $('review-notes').textContent = '';
}

async function rpc(name, args) {
  supa ||= await import('./supa.js');
  return supa.supabase.rpc(name, args);
}

async function start() {
  // A password must not travel in the clear: over http the page only sends the visitor on.
  if (insecure(location)) {
    const to = secureUrl(location);
    showState('insecure', h('p', {}, h('a', { href: to, id: 'secure-link' }, 'מעבר לכתובת המאובטחת')));
    setTimeout(() => location.replace(to), 1500);
    return;
  }
  token = tokenFrom(location);
  if (!TOKEN.test(token)) { showState('invalid'); return; }
  try {
    const { data, error } = await rpc('access_form_info', { p_token: token });
    if (error) throw error;
    if (!data || data.state !== 'ok') { showState(data?.state || 'invalid'); return; }
    render(data);
  } catch {
    showState('error');
  }
}

// ── The form ──────────────────────────────
function render(d) {
  preview = !!d.preview;
  document.title = `${PAGE_TEXT.title} · ${d.business} · astrateg`;
  $('sbar-title').textContent = `פרטי הכניסה לרשתות · ${d.business}`;
  $('business').textContent = d.business;
  $('hello-h').textContent = PAGE_TEXT.title;
  $('why').textContent = PAGE_TEXT.why;
  fill($('points'), PAGE_TEXT.points.map((p) => h('li', {}, p)));
  $('notes-hint').textContent = PAGE_TEXT.notesHint;
  $('notes-warn').textContent = PAGE_TEXT.notesWarn;
  $('preview').hidden = !preview;
  fill($('cards'), REQUIRED.map(mainCard));
  renderExtras();
  $('state').hidden = true;
  $('page').hidden = false;
  $('foot').hidden = false;
  refresh();
}

// A field's name ('instagram.username', 'x2.password') and the ids made from it.
const errId = (fid) => `${fid.replace('.', '-')}-err`;
const fieldId = (fid) => fid.replace('.', '-');
// A message under a field: shown once the field was left (or "המשך" was pressed).
const errLine = (fid) => h('p', { class: 'serr', id: errId(fid), 'data-fid': fid, hidden: true });

function textField(fid, label, value, onInput, attrs = {}, { wide = false, hint = null } = {}) {
  const id = fieldId(fid);
  const input = h('input', {
    class: 'sinput', id, type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    'aria-describedby': errId(fid), ...attrs,
    oninput: (e) => { onInput(e.currentTarget.value); refresh(); },
    onblur: () => { touched.add(fid); refresh(); },
  });
  input.value = value || '';
  return h('div', { class: `sfield${wide ? ' sfield-wide' : ''}` }, h('label', { for: id }, label), input, hint ? h('p', { class: 'shint' }, hint) : null, errLine(fid));
}

// The password: never offered from the browser's saved logins, never saved by it,
// hidden until "הצגה" is pressed.
function passField(fid, platform, value, onInput) {
  const id = fieldId(fid);
  const input = h('input', {
    class: 'sinput', id, type: 'password', dir: 'ltr', autocomplete: 'new-password', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    maxlength: String(PASS_MAX), 'aria-describedby': errId(fid),
    oninput: (e) => { onInput(e.currentTarget.value); refresh(); },
    onblur: () => { touched.add(fid); refresh(); },
  });
  input.value = value || '';
  const show = h('button', {
    type: 'button', class: 'sshow', id: `${id}-show`, 'aria-pressed': 'false', 'aria-controls': id,
    onclick: (e) => {
      const on = input.type === 'password';
      input.type = on ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.firstChild.textContent = on ? 'הסתרה' : 'הצגה';
    },
  }, 'הצגה', h('span', { class: 'sr-only' }, ` של הסיסמה ל־${platform}`));
  return h('div', { class: 'sfield' }, h('label', { for: id }, 'סיסמה'), h('div', { class: 'spass' }, input, show), errLine(fid));
}

function mainDetail(n) {
  const v = form.main[n];
  const name = NETWORK_NAMES[n];
  if (v.choice === 'have') {
    return h('div', { class: 'slogin' },
      textField(`${n}.username`, 'שם משתמש, מייל או טלפון', v.username, (x) => { v.username = x; }, { maxlength: String(USER_MAX) }),
      passField(`${n}.password`, name, v.password, (x) => { v.password = x; }));
  }
  if (v.choice === 'reset') {
    return h('div', { class: 'slogin' },
      textField(`${n}.username`, 'שם משתמש, מייל או טלפון (אם ידוע)', v.username, (x) => { v.username = x; }, { maxlength: String(USER_MAX) },
        { wide: true, hint: 'נחזור אליכם כדי לחדש את הסיסמה יחד.' }));
  }
  if (v.choice === 'none') return h('p', { class: 'shint' }, `נפתח עבורכם עמוד ${name} חדש.`);
  return null;
}

function mainCard(n) {
  const v = form.main[n];
  const name = NETWORK_NAMES[n];
  const detail = h('div', { id: `${n}-detail` }, mainDetail(n));
  return h('section', { class: 'scard', id: `card-${n}`, 'aria-labelledby': `${n}-h` },
    h('h2', { id: `${n}-h` }, name, h('span', { class: 'sneed', id: `${n}-need` }, 'חובה')),
    h('fieldset', { class: 'schoices', id: `${n}-choice`, 'aria-describedby': errId(`${n}.choice`) },
      h('legend', {}, `מה המצב ב־${name}?`),
      CHOICES.map(([key, label]) => h('label', { class: 'schoice' },
        h('input', {
          type: 'radio', name: `${n}-choice`, id: `${n}-choice-${key}`, value: key, checked: v.choice === key,
          onchange: () => { v.choice = key; touched.add(`${n}.choice`); fill(detail, mainDetail(n)); refresh(); },
        }),
        h('span', {}, label)))),
    errLine(`${n}.choice`),
    detail);
}

function extraCard(x, i) {
  const spec = EXTRA_PLATFORMS.find((p) => p.key === x.platform);
  const select = h('select', {
    class: 'sinput', id: `${x.id}-platform`, 'aria-describedby': errId(`${x.id}.platform`),
    onchange: (e) => { x.platform = e.currentTarget.value; touched.add(`${x.id}.platform`); renderExtras(`${x.id}-platform`); refresh(); },
  }, h('option', { value: '' }, 'בחירה…'), EXTRA_PLATFORMS.map((p) => h('option', { value: p.key, selected: p.key === x.platform }, p.label)));
  const shown = spec ? (spec.free ? (x.label.trim() || 'פלטפורמה נוספת') : spec.label) : 'פלטפורמה נוספת';
  return h('section', { class: 'scard sextra', id: `card-${x.id}`, 'aria-labelledby': `${x.id}-h` },
    h('div', { class: 'sextra-head' },
      h('h2', { id: `${x.id}-h` }, `פלטפורמה נוספת ${i + 1}`),
      h('button', { type: 'button', class: 'sbtn sbtn-text', id: `${x.id}-remove`, onclick: () => removeExtra(x.id) }, 'הסרה', h('span', { class: 'sr-only' }, ` של פלטפורמה נוספת ${i + 1}`))),
    h('div', { class: 'slogin' },
      h('div', { class: 'sfield' }, h('label', { for: `${x.id}-platform` }, 'שם הפלטפורמה'), select, errLine(`${x.id}.platform`)),
      spec?.free ? textField(`${x.id}.label`, 'איזו פלטפורמה?', x.label, (v) => { x.label = v; }, { dir: 'auto', maxlength: String(LABEL_MAX), autocapitalize: 'sentences' }) : null,
      textField(`${x.id}.username`, 'שם משתמש, מייל או טלפון', x.username, (v) => { x.username = v; }, { maxlength: String(USER_MAX) }),
      passField(`${x.id}.password`, shown, x.password, (v) => { x.password = v; })));
}

function renderExtras(focusId = null) {
  fill($('extras'), form.extra.map(extraCard));
  $('add').hidden = !canAddExtra(form);
  if (focusId) $(focusId)?.focus();
}
function addExtra() {
  if (!canAddExtra(form)) return;
  seq += 1;
  const x = { id: `x${seq}`, platform: '', label: '', username: '', password: '' };
  form.extra.push(x);
  renderExtras(`${x.id}-platform`);
  refresh();
}
function removeExtra(id) {
  form.extra = form.extra.filter((x) => x.id !== id);
  for (const k of [...touched]) if (k.startsWith(`${id}.`)) touched.delete(k);
  renderExtras();
  refresh();
  $('add').hidden ? $('next').focus() : $('add').focus();
}

// The messages under the fields, the "חובה" tags, and the send button, from what is typed now.
function refresh() {
  const p = formProblems(form);
  for (const el of document.querySelectorAll('#form .serr[data-fid], #notes-err')) {
    const fid = el.dataset.fid || 'notes';
    const msg = p.errors[fid];
    const on = !!msg && (showAll || touched.has(fid) || fid === 'notes');
    el.textContent = on ? msg : '';
    el.hidden = !on;
    const ctl = $(fieldId(fid));
    if (ctl && ctl.tagName !== 'FIELDSET') { if (on) ctl.setAttribute('aria-invalid', 'true'); else ctl.removeAttribute('aria-invalid'); }
  }
  for (const n of REQUIRED) {
    const done = !Object.keys(p.errors).some((k) => k.startsWith(`${n}.`));
    $(`card-${n}`)?.classList.toggle('is-done', done);
    const tag = $(`${n}-need`);
    if (tag) tag.textContent = done ? 'מולא ✓' : 'חובה';
  }
  $('next').disabled = !p.mainOk;
  const wait = waitingText(p.missing);
  if ($('wait').textContent !== wait) $('wait').textContent = wait;
  return p;
}

function firstInvalid(p) {
  const fid = Object.keys(p.errors)[0];
  if (!fid) return null;
  if (fid.endsWith('.choice')) return $(`${fid.split('.')[0]}-choice-have`);
  return $(fieldId(fid));
}

// "המשך": everything is checked; then the confirmation, which lists the platforms
// and the choices and never a password.
function toConfirm(e) {
  e.preventDefault();
  showAll = true;
  const p = refresh();
  const err = $('form-err');
  if (!p.ok) {
    err.textContent = 'יש שדות שצריך להשלים או לתקן. הם מסומנים בטופס.';
    err.hidden = false;
    (firstInvalid(p) || err).focus();
    return;
  }
  err.hidden = true;
  pending = buildPayload(form);
  fill($('review'), confirmLines(pending).map((l) => h('li', {},
    h('strong', {}, l.platform),
    h('span', {}, l.choice),
    l.username ? h('span', {}, 'שם משתמש: ', h('span', { class: 'num' }, l.username)) : null,
    l.password ? h('span', {}, 'סיסמה: הוזנה (לא מוצגת)') : null)));
  $('review-notes').textContent = pending.notes ? `הערות: ${pending.notes}` : '';
  $('review-notes').hidden = !pending.notes;
  $('send-err').hidden = true;
  $('send').disabled = preview;
  if (preview) { $('send-err').textContent = SEND_ERRORS.staff; $('send-err').hidden = false; }
  $('form').hidden = true;
  $('confirm').hidden = false;
  $('confirm').focus();
  window.scrollTo({ top: 0 });
}

function backToForm(message = null) {
  pending = null;
  $('confirm').hidden = true;
  $('form').hidden = false;
  const err = $('form-err');
  err.textContent = message || '';
  err.hidden = !message;
  (message ? err : $('next')).focus();
}

async function send() {
  if (sending || !pending || preview) return;
  sending = true;
  const btn = $('send');
  btn.disabled = true;
  $('back').disabled = true;
  btn.textContent = 'שולח…';
  $('send-err').hidden = true;
  let res = null;
  let failed = null;
  try {
    const { data, error } = await rpc('access_form_submit', { p_token: token, p_payload: pending });
    if (error) failed = error; else res = data;
  } catch (err) { failed = err; }
  sending = false;
  btn.textContent = 'שליחה';
  btn.disabled = false;
  $('back').disabled = false;
  if (failed || !res?.state) {
    const staff = /staff cannot/.test(String(failed?.message || '')) || failed?.code === '42501';
    $('send-err').textContent = staff ? SEND_ERRORS.staff : SEND_ERRORS.network;
    $('send-err').hidden = false;
    $('send-err').focus();
    return;
  }
  if (res.state === 'done') { thanks(); return; }
  if (res.state === 'refused') {
    backToForm(`${SEND_ERRORS.refused}${res.left ? ` אפשר לנסות עוד ${res.left === 1 ? 'פעם אחת' : `${res.left} פעמים`}.` : ''}`);
    return;
  }
  showState(res.state);
}

// Sent: nothing of what was typed stays in the page.
function thanks() {
  wipe();
  $('page').hidden = true;
  $('state').hidden = true;
  $('foot').hidden = true;
  $('thanks-h').textContent = PAGE_TEXT.thanksTitle;
  $('thanks-text').textContent = PAGE_TEXT.thanks;
  $('thanks').hidden = false;
  document.title = `${PAGE_TEXT.thanksTitle} · astrateg`;
  $('thanks').focus();
  window.scrollTo({ top: 0 });
}

$('form').addEventListener('submit', toConfirm);
$('add').addEventListener('click', addExtra);
$('notes').addEventListener('input', (e) => { form.notes = e.currentTarget.value; refresh(); });
$('send').addEventListener('click', send);
$('back').addEventListener('click', () => backToForm());

start();
