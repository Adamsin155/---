// "הודעות ללקוחות" (messages.html): the day's queue of proactive messages to
// clients (docs/plan/system-plan.md, section 7 and Irit's day). For each open
// client, the message that fits today, editable; "שליחה ומעבר לבא" opens
// WhatsApp with it (a link only, never automation) and records that it was
// sent. What to suggest is decided in messages-logic.js; the database stamps
// who sent and when, and keeps to one message per client per Israel day.
// A record made by mistake (WhatsApp closed without sending) can be undone by
// whoever made it, for UNDO_MINUTES; the database holds to the same window.
// Sending the welcome or the day-before message checks the protocol item that
// is that message (2's intro, 15's reminder to the client).
// For the owner, Irit and Lior (the database lets the office in: can_message_clients()).
import { supabase } from './supa.js';
import { STATIONS } from './protocol.js';
import { isBusinessDay } from './protocol-logic.js';
import { loadClients, loadChecks, loadDirectory, setCheck, clearCheck } from './protocol-data.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, VIEWER_UNKNOWN, directory, who, formatStamp, store, visitStore, capList
} from './protocol-ui.js';
import { noteIcon, dress } from './kit.js';
import { dayKeyIL } from './tz.js';
import { canManageTeam } from './team-rules.js';
import {
  dayQueue, templatesByKey, messageText, unfilledIn, unknownVars, templateVars, waLink, groupLink, canSendMessages,
  protocolCheckOf, SENT_CHECK_NOTE, DEFAULT_TEMPLATES, MESSAGE_KINDS, dayText, timeText,
} from './messages-logic.js';
// The client's logins form (6.10.2026): the welcome carries its link, and a nudge follows.
import { accessUrl, accessLine, waitingLink, redactAccessLinks, hasRedactedLink } from './access-logic.js';
import { loadAccessLinks, accessLinkToken, createAccessLink, createError } from './access-data.js';

const MSG_COLS = 'id, client_id, kind, template_key, ref, body, sent_by_email, sent_at';
const TPL_COLS = 'key, title, body, kind, station, updated_by, updated_at';
const HISTORY_DAYS = 180;
const PAGE = 1000;
// The database lets the sender remove a fresh record for 5 minutes ("sender undoes a fresh record").
const UNDO_MINUTES = 5;

let clients = [];
let checks = {};
let messages = [];            // client_messages of the last HISTORY_DAYS days, newest first
let templateRows = [];
let templates = templatesByKey();
let templatesError = null;
let entries = [];             // today's queue (dayQueue)
let day = null;               // the Israel day the queue was built for
let lastLoad = 0;
let station = visitStore.get('messages.station') || 'all';
let myEmail = '';
const drafts = new Map();     // client id -> { opt, text }: the chosen option and the text as edited
const recording = new Set();  // client ids whose record is on its way
const failed = new Map();     // client id -> { option, text, error }: opened in WhatsApp, not recorded
const errors = new Map();     // client id -> what to fix before sending
const undoing = new Set();    // message ids whose undo is on its way
const openHistory = new Set();
// The links to the clients' logins forms (null: the form is not set up in the
// database yet), and the tokens of those that wait, by link id. A token is kept in
// memory only, and never in the record of a sent message (redactAccessLinks).
let accessLinks = null;
const accessTokens = new Map();
const creating = new Set();   // client ids whose link is being made

const optId = (o) => `${o.kind}:${o.ref || o.key}`;
const hasPhone = (c) => !waLink(c.phone, '').startsWith('https://wa.me/?');

function explain(err) {
  const msg = String(err?.message || err || '');
  if (/client_messages|message_templates/.test(msg) && /does not exist|Could not find/i.test(msg)) return 'טבלאות ההודעות עוד לא הוקמו במסד הנתונים.';
  if (/client_messages_one_per_day|duplicate key/i.test(msg)) return 'ללקוח הזה כבר נרשמה הודעה היום.';
  return errorText(err);
}

// ── Data ──────────────────────────────────
async function loadMessages(since) {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('client_messages').select(MSG_COLS)
      .gte('sent_at', since).order('sent_at', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) return out;
  }
}

async function loadTemplates() {
  const { data, error } = await supabase.from('message_templates').select(TPL_COLS);
  if (error) throw error;
  return data;
}

async function load() {
  $('state').textContent = entries.length ? '' : 'טוען…';
  const now = new Date();
  const since = new Date(now.getTime() - HISTORY_DAYS * 864e5).toISOString();
  try {
    [clients, checks, messages] = await Promise.all([loadClients(), loadChecks(), loadMessages(since)]);
  } catch (err) {
    $('state').textContent = explain(err);
    return;
  }
  // Without the saved templates the queue still works, with the original wording.
  try { templateRows = await loadTemplates(); templatesError = null; } catch (err) { templateRows = []; templatesError = err; }
  templates = templatesByKey(templateRows);
  // The logins form's links: without them the queue works as before.
  try { accessLinks = await loadAccessLinks(); } catch { accessLinks = null; }
  lastLoad = Date.now();
  $('state').textContent = templatesError ? `הנוסחים השמורים לא נטענו (${explain(templatesError)}), ולכן מוצגים הנוסחים המקוריים.` : '';
  if (day && day !== dayKeyIL(now)) { drafts.clear(); failed.clear(); errors.clear(); }
  build(now);
  renderKeepingFocus();
  fillAccessTokens();
}

function build(now = new Date()) {
  day = dayKeyIL(now);
  const byClient = {};
  for (const m of messages) (byClient[m.client_id] ||= []).push(m);
  // Each client's links, and the address of the one that waits once its token is known.
  const extras = {};
  for (const l of accessLinks || []) (extras[l.client_id] ||= { accessLinks: [], accessUrl: null }).accessLinks.push(l);
  for (const x of Object.values(extras)) {
    const token = accessTokens.get(waitingLink(x.accessLinks, now)?.id);
    x.accessUrl = token ? accessUrl(location.href, token) : null;
  }
  entries = dayQueue(clients, checks, byClient, now, extras);
}

// The tokens of the waiting links that today's messages carry (the welcome, the
// nudge): asked once each, then the queue is built again with the addresses.
async function fillAccessTokens() {
  const now = new Date();
  const want = [];
  for (const e of entries) {
    if (e.sent || !e.options.some((o) => o.key === 'welcome' || o.key === 'access_nudge')) continue;
    const l = waitingLink((accessLinks || []).filter((x) => x.client_id === e.client.id), now);
    if (l && !accessTokens.has(l.id)) want.push(l.id);
  }
  if (!want.length) return;
  const got = await Promise.all(want.map((id) => accessLinkToken(id).catch(() => null)));
  want.forEach((id, i) => accessTokens.set(id, got[i])); // null: not for this user; not asked again
  if (!got.some(Boolean)) return;
  build();
  renderKeepingFocus();
}

// "יצירת קישור" on the welcome: the link is made and the message gets its line. A
// text already edited by hand keeps its words, and the line is added at its end.
async function createLink(e) {
  const id = e.client.id;
  if (creating.has(id)) return;
  creating.add(id);
  renderKeepingFocus();
  let made = null;
  try { made = await createAccessLink(id); } catch (err) { toast(createError(err)); }
  if (made) {
    accessTokens.set(made.id, made.token);
    try { accessLinks = await loadAccessLinks(); } catch { /* the new link is added below */ }
    if (!(accessLinks || []).some((l) => l.id === made.id)) {
      accessLinks = [{ id: made.id, client_id: id, created_at: new Date().toISOString(), expires_at: made.expiresAt, revoked_at: null, submitted_at: null, attempts: 0 }, ...(accessLinks || [])];
    }
    const d = drafts.get(id);
    const url = accessUrl(location.href, made.token);
    if (d && d.text !== null && !d.text.includes('access.html')) drafts.set(id, { ...d, text: `${d.text.replace(/\s+$/, '')}\n\n${accessLine(url)}` });
    build();
    toast(`נוצר קישור לטופס פרטי הכניסה של ${e.client.name}, והוא בתוך ההודעה.`);
  }
  creating.delete(id);
  renderKeepingFocus();
  $(`msg-text-${id}`)?.focus({ preventScroll: true });
}

// What the card says about the logins form under the welcome message.
function accessRow(e, o) {
  if (accessLinks === null || o.key !== 'welcome') return null;
  const id = e.client.id;
  if (o.access === 'none') {
    return h('p', { class: 'msg-access', id: `msg-access-${id}` },
      h('span', {}, 'אין עדיין קישור ללקוח למילוי פרטי הכניסה לרשתות.'),
      h('button', { type: 'button', class: 'btn btn-sm', id: `msg-link-${id}`, disabled: creating.has(id), 'aria-describedby': `msg-h-${id}`, onclick: () => createLink(e) },
        creating.has(id) ? 'יוצר…' : 'יצירת קישור והוספה להודעה'));
  }
  const text = o.access === 'filled' ? 'הלקוח כבר מילא את פרטי הכניסה לרשתות.'
    : o.accessUrl ? 'ההודעה כוללת את הקישור לטופס פרטי הכניסה (תקף ל־14 יום, לשליחה אחת).'
      : 'יש ללקוח קישור לטופס פרטי הכניסה, אבל רק הבעלים, עירית, ליאור ואופיר מעתיקים אותו.';
  return h('p', { class: 'msg-access', id: `msg-access-${id}` }, h('span', {}, text));
}

// ── The queue ─────────────────────────────
const stationKey = (e) => STATIONS[e.station].key;
const shown = () => entries.filter((e) => !e.dayOff && (station === 'all' || stationKey(e) === station));
const pending = (list) => list.filter((e) => !e.sent);

function optionOf(e) {
  const d = drafts.get(e.client.id);
  return (d && e.options.find((o) => optId(o) === d.opt)) || e.options[0];
}
function textOf(e, o) {
  const d = drafts.get(e.client.id);
  return d && d.opt === optId(o) && d.text !== null ? d.text : messageText(o, templates);
}
const rowsFor = (text) => Math.min(16, Math.max(4, String(text).split('\n').length + 1));

function renderSummary(now) {
  const all = entries.filter((e) => !e.dayOff);
  const todo = pending(all).length;
  const done = all.length - todo;
  const next = [
    dayText(now),
    todo === 0 ? 'אין עוד הודעות לשליחה' : todo === 1 ? 'הודעה אחת לשליחה' : `${todo} הודעות לשליחה`,
    done === 0 ? 'עוד לא נשלחו הודעות היום' : done === 1 ? 'לקוח אחד כבר קיבל הודעה היום' : `${done} לקוחות כבר קיבלו הודעה היום`,
  ].join(' · ');
  // A status line: changed only when it says something new, so it is not read out on every refresh.
  if ($('msg-summary').textContent !== next) $('msg-summary').textContent = next;
  if (next && !$('msg-summary').querySelector('.k-ico')) noteIcon($('msg-summary'), 'info', 'chat');
}

function renderFilters() {
  const all = entries.filter((e) => !e.dayOff);
  const used = new Set(all.map(stationKey));
  const chip = (key, title, n) => h('button', {
    type: 'button', class: 'chip', id: `msg-st-${key}`, 'aria-pressed': String(station === key),
    onclick: () => { station = key; visitStore.set('messages.station', key); render(); },
  }, title, h('span', { class: 'n' }, n, h('span', { class: 'sr-only' }, ' לשליחה')));
  fill($('msg-filters'),
    chip('all', 'כל התחנות', pending(all).length),
    STATIONS.filter((st) => used.has(st.key) || station === st.key)
      .map((st) => chip(st.key, st.title, pending(all.filter((e) => stationKey(e) === st.key)).length)));
}

function render() {
  const now = new Date();
  renderSummary(now);
  renderFilters();
  const off = !isBusinessDay(now);
  const list = off ? [] : shown();
  fill($('msg-queue'), list.map(card));
  capList($('msg-queue'), 5, 'msg:queue'); // a queue: the next ones; the rest one tap away
  const empty = $('msg-empty');
  if (off) empty.textContent = 'היום המשרד סגור (סוף שבוע או חג), ולכן אין היום הודעות יזומות ללקוחות.';
  else if (!list.length) empty.textContent = station === 'all' ? 'אין היום לקוחות פעילים בתור.' : 'אין היום לקוחות בתחנה הזו.';
  else if (!pending(list).length) empty.textContent = 'כל ההודעות של היום נשלחו. יפה!';
  empty.hidden = !(off || !list.length || !pending(list).length);
  // The same sentence, as a friendly strip with its icon (app/kit.js).
  if (!empty.hidden) noteIcon(empty, off || !list.length ? 'info' : 'ok', off ? 'sun' : !list.length ? 'inbox' : 'check-circle');
}

// Re-rendering replaces the cards: keep focus, the caret and the scroll.
function renderKeepingFocus() {
  const el = document.activeElement;
  const id = el?.id;
  const sel = el && 'selectionStart' in el ? [el.selectionStart, el.selectionEnd] : null;
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  const back = id && document.getElementById(id);
  if (back) {
    back.focus({ preventScroll: true });
    if (sel && 'setSelectionRange' in back) { try { back.setSelectionRange(...sel); } catch { /* not a text field */ } }
  }
}

// "אבן דרך: ברוכים הבאים"; a daily template's title already says what it is; a
// delay says which promise ("הודעה על עיכוב: סגירת הסרטונים"), and an extra
// shoot round says which round, so two options never read the same.
function optionLabel(o) {
  const title = templates.get(o.key)?.title || o.key;
  if (o.kind === 'daily') return title;
  const round = /^r(\d+)\./.exec(o.ref || '')?.[1];
  return `${MESSAGE_KINDS[o.kind]}: ${o.kind === 'delay' ? o.vars['מה'] : title}${round ? ` (סבב צילום ${round})` : ''}`;
}

function kindBadge(kind) {
  return h('span', { class: `mk mk-${kind}` }, MESSAGE_KINDS[kind]);
}

function head(e) {
  const c = e.client;
  return h('div', { class: 'msg-head' },
    h('h2', { class: 'msg-name', id: `msg-h-${c.id}` },
      h('a', { href: `client.html?id=${encodeURIComponent(c.id)}` }, c.name),
      c.business && c.business !== c.name ? h('small', {}, c.business) : null),
    h('span', { class: 'tag msg-station' }, `תחנה: ${STATIONS[e.station].title}`));
}

function history(e) {
  const id = e.client.id;
  const list = messages.filter((m) => m.client_id === id);
  if (!list.length) return h('p', { class: 'msg-nohist' }, 'עוד לא נשלחו ללקוח הזה הודעות מהמערכת.');
  return h('details', {
    class: 'msg-history', id: `msg-hist-${id}`, open: openHistory.has(id),
    ontoggle: (ev) => { if (ev.currentTarget.open) openHistory.add(id); else openHistory.delete(id); },
  },
  h('summary', {}, `מה נשלח עד היום (${list.length})`),
  h('ol', { class: 'msg-hlist' }, ...list.map((m) => h('li', {},
    h('p', { class: 'msg-hmeta' }, `${formatStamp(m.sent_at)} · ${who(m.sent_by_email)} · ${templates.get(m.template_key)?.title || MESSAGE_KINDS[m.kind] || ''}`),
    h('p', { class: 'msg-body' }, m.body)))));
}

// A record of mine made in the last few minutes: I may still undo it.
const undoable = (m) => !!m && !!myEmail && m.sent_by_email === myEmail
  && Date.now() - new Date(m.sent_at).getTime() < UNDO_MINUTES * 60e3;

function sentCard(e) {
  const m = e.sent;
  const id = e.client.id;
  return h('li', { class: 'msg-card is-sent', id: `msg-${id}`, tabindex: '-1', 'aria-labelledby': `msg-h-${id}` },
    head(e),
    h('p', { class: 'msg-why' },
      h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'כבר נשלח היום'),
      h('span', {}, `${timeText(new Date(m.sent_at))} · ${who(m.sent_by_email)} · ${templates.get(m.template_key)?.title || MESSAGE_KINDS[m.kind] || ''}`)),
    undoable(m) ? h('div', { class: 'msg-undo' },
      h('span', { id: `msg-undo-note-${id}` }, 'לא נשלח בפועל בוואטסאפ? אפשר לבטל את הרישום בדקות הקרובות.'),
      h('button', {
        type: 'button', class: 'btn-text', id: `msg-undo-${id}`, disabled: undoing.has(m.id),
        'aria-describedby': `msg-h-${id} msg-undo-note-${id}`, onclick: () => undo(m),
      }, 'ביטול הרישום')) : null,
    history(e));
}

function card(e) {
  if (e.sent) return sentCard(e);
  const c = e.client;
  const id = c.id;
  const o = optionOf(e);
  const text = textOf(e, o);
  const busy = recording.has(id);
  const miss = failed.get(id);
  const problem = errors.get(id) || (miss ? `וואטסאפ נפתח, אבל השליחה לא נרשמה (${explain(miss.error)}). אחרי ששלחתם בוואטסאפ, לחצו ״סימון כנשלח״.` : '');
  const fillIn = unfilledIn(text);
  const sendLink = (group) => h('a', {
    class: group ? 'btn msg-group' : 'btn btn-primary msg-send', id: `msg-${group ? 'group' : 'send'}-${id}`,
    href: group ? groupLink(text) : waLink(c.phone, text), target: '_blank', rel: 'noopener noreferrer',
    'aria-describedby': `msg-h-${id}`, 'aria-disabled': busy ? 'true' : null,
    onclick: (ev) => onSend(ev, e, group),
  }, group ? 'שליחה לקבוצה' : 'שליחה ומעבר לבא', h('span', { class: 'sr-only' }, ' (נפתח בוואטסאפ)'));

  // A promise at risk that is not today's suggestion: said on the card, one choice away.
  const risk = e.options.find((x) => x.kind === 'delay' && optId(x) !== optId(o));

  return h('li', { class: `msg-card k-${o.kind}${busy ? ' is-busy' : ''}`, id: `msg-${id}`, tabindex: '-1', 'aria-labelledby': `msg-h-${id}` },
    head(e),
    h('p', { class: 'msg-why' }, kindBadge(o.kind), h('span', {}, o.reason)),
    risk ? h('p', { class: 'msg-risk' }, `${risk.reason}. אם זה יתעכב, בוחרים ״הודעה על עיכוב״ ב״איזו הודעה״.`) : null,
    e.options.length > 1 ? h('div', { class: 'field msg-pick' },
      h('label', { for: `msg-opt-${id}` }, 'איזו הודעה'),
      h('select', {
        class: 'input', id: `msg-opt-${id}`,
        onchange: (ev) => { drafts.set(id, { opt: ev.target.value, text: null }); errors.delete(id); renderKeepingFocus(); },
      }, ...e.options.map((x) => h('option', { value: optId(x), selected: optId(x) === optId(o) }, optionLabel(x))))) : null,
    h('label', { class: 'sr-only', for: `msg-text-${id}` }, `נוסח ההודעה ל${c.name}`),
    h('textarea', {
      class: 'input msg-text', id: `msg-text-${id}`, rows: rowsFor(text), maxlength: 4000,
      'aria-describedby': `msg-note-${id}${fillIn.length ? ` msg-fill-${id}` : ''}${problem ? ` msg-err-${id}` : ''}`,
      'aria-invalid': errors.has(id) ? 'true' : null,
      oninput: (ev) => onEdit(e, ev.target),
    }, text),
    h('p', { class: 'msg-fill', id: `msg-fill-${id}`, hidden: !fillIn.length }, fillIn.length ? `לפני השליחה ממלאים: ${fillIn.join(' ')}` : ''),
    accessRow(e, o),
    h('p', { class: 'err msg-err', id: `msg-err-${id}`, role: 'alert', hidden: !problem }, problem),
    h('div', { class: 'msg-acts' },
      sendLink(false),
      hasPhone(c) ? sendLink(true) : null,
      miss ? h('button', {
        type: 'button', class: 'btn', id: `msg-mark-${id}`, disabled: busy,
        onclick: () => { if (!recording.has(id)) record(e, miss); },
      }, 'סימון כנשלח') : null,
      h('button', { type: 'button', class: 'btn-text msg-skip', id: `msg-skip-${id}`, onclick: () => focusCard(nextAfter(id)) }, 'דילוג')),
    h('p', { class: 'msg-note', id: `msg-note-${id}` }, hasPhone(c)
      ? 'השליחה פותחת צ׳אט עם הטלפון שבכרטיס. להודעה בקבוצת הלקוח: ״שליחה לקבוצה״.'
      : 'אין טלפון בכרטיס: וואטסאפ ייפתח בלי נמען, ובוחרים את קבוצת הלקוח.'),
    history(e));
}

// Typing keeps the text as a draft and refreshes the links and the hint in place.
function onEdit(e, ta) {
  const id = e.client.id;
  const o = optionOf(e);
  drafts.set(id, { opt: optId(o), text: ta.value });
  $(`msg-send-${id}`).href = waLink(e.client.phone, ta.value.trim());
  const group = $(`msg-group-${id}`);
  if (group) group.href = groupLink(ta.value.trim());
  const fillIn = unfilledIn(ta.value);
  const hint = $(`msg-fill-${id}`);
  hint.textContent = fillIn.length ? `לפני השליחה ממלאים: ${fillIn.join(' ')}` : '';
  hint.hidden = !fillIn.length;
  if (errors.has(id) && !fillIn.length && ta.value.trim()) {
    errors.delete(id);
    ta.removeAttribute('aria-invalid');
    $(`msg-err-${id}`).hidden = true;
  }
}

// The link opens WhatsApp by itself (its default action); then the send is recorded.
// A message with places left to fill, or an empty one, does not go out.
function onSend(ev, e, group) {
  const id = e.client.id;
  if (recording.has(id)) { ev.preventDefault(); return; }
  const ta = $(`msg-text-${id}`);
  const text = ta.value.trim();
  const fillIn = unfilledIn(text);
  if (!text || fillIn.length) {
    ev.preventDefault();
    const msg = text ? `יש בהודעה מקומות שעוד לא מולאו: ${fillIn.join(' ')}. ממלאים אותם ואז שולחים.` : 'ההודעה ריקה. כתבו אותה ואז שולחים.';
    errors.set(id, msg);
    const err = $(`msg-err-${id}`);
    err.textContent = msg;
    err.hidden = false;
    ta.setAttribute('aria-invalid', 'true');
    ta.setAttribute('aria-describedby', `msg-note-${id} msg-err-${id}`);
    ta.focus();
    const at = fillIn.length ? ta.value.indexOf(fillIn[0]) : -1;
    if (at >= 0) ta.setSelectionRange(at, at + fillIn[0].length);
    return;
  }
  ev.currentTarget.href = group ? groupLink(text) : waLink(e.client.phone, text);
  // Record after the click has opened the link: re-rendering now would take the
  // link out of the page, and a link that is no longer in the page opens nothing.
  recording.add(id);
  const option = optionOf(e);
  setTimeout(() => record(e, { option, text }), 0);
}

// The next client still to message after `id` (in the order on screen), else the first.
function nextAfter(id) {
  const list = pending(shown());
  const i = list.findIndex((e) => e.client.id === id);
  const rest = [...list.slice(i + 1), ...list.slice(0, Math.max(i, 0))].filter((e) => e.client.id !== id);
  return rest[0]?.client.id || null;
}

// The next client's card, not its text: focusing a text field would open the
// phone's keyboard over the card on the way back from WhatsApp. A screen reader
// reads the card's name; Tab goes on into it.
function focusCard(id) {
  const card = id && document.getElementById(`msg-${id}`);
  if (card) {
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'start', behavior: 'instant' });
    return;
  }
  const empty = $('msg-empty');
  if (!empty.hidden) empty.focus();
}

async function record(e, { option, text }) {
  const c = e.client;
  const next = nextAfter(c.id);
  recording.add(c.id);
  failed.delete(c.id);
  errors.delete(c.id);
  renderKeepingFocus();
  const { data, error } = await supabase.from('client_messages')
    // The record keeps the words, never the token of the logins form's link.
    .insert({ client_id: c.id, kind: option.kind, template_key: option.key, ref: option.ref || null, body: redactAccessLinks(text) })
    .select(MSG_COLS).single();
  recording.delete(c.id);
  if (error) {
    if (/client_messages_one_per_day|duplicate key/i.test(String(error.message))) {
      // Someone else already recorded a message today (another screen): show theirs.
      toast(`ל${c.name} כבר נרשמה היום הודעה, אולי ממחשב אחר. התור עודכן.`);
      await load();
      focusCard(next);
      return;
    }
    failed.set(c.id, { option, text, error });
    renderKeepingFocus();
    $(`msg-mark-${c.id}`)?.focus();
    return;
  }
  messages.unshift(data);
  drafts.delete(c.id);
  build();
  render();
  toast(`נרשם: נשלחה הודעה ל${c.name}.`, { label: 'ביטול', run: () => undo(data) });
  focusCard(next);
  checkSent(data);
}

// The protocol item that is this message (2's intro, 15's reminder), checked
// once it was sent from the queue. If that fails, the card still has it to check by hand.
async function checkSent(m) {
  const key = protocolCheckOf(m);
  const cs = (checks[m.client_id] ||= {});
  if (!key || cs[key]?.state === 'done') return;
  try { cs[key] = await setCheck(m.client_id, key, 'done', SENT_CHECK_NOTE); } catch { return; }
  // Undone while the check was on its way: take it back too.
  if (!messages.some((x) => x.id === m.id)) {
    try { await clearCheck(m.client_id, key); delete cs[key]; } catch { /* the card can uncheck it */ }
  }
  build();
  renderKeepingFocus();
}

// Undo a record made by mistake. The database allows it to whoever recorded the
// message, within UNDO_MINUTES; the protocol item it checked is unchecked too.
async function undo(m) {
  if (undoing.has(m.id)) return;
  const c = clients.find((x) => x.id === m.client_id);
  undoing.add(m.id);
  renderKeepingFocus();
  const { data, error } = await supabase.from('client_messages').delete().eq('id', m.id).select('id');
  undoing.delete(m.id);
  if (error || !data?.length) {
    renderKeepingFocus();
    toast(error ? `הרישום לא בוטל. ${explain(error)}` : `אי אפשר לבטל: עברו יותר מ־${UNDO_MINUTES} דקות מהרישום, או שמישהו אחר רשם אותו.`);
    return;
  }
  messages = messages.filter((x) => x.id !== m.id);
  const key = protocolCheckOf(m);
  const ck = key && checks[m.client_id]?.[key];
  if (ck && ck.note === SENT_CHECK_NOTE && ck.by_email === m.sent_by_email) {
    try { await clearCheck(m.client_id, key); delete checks[m.client_id][key]; } catch { /* stays checked; the card can uncheck it */ }
  }
  build();
  // Back in the queue with the text as it was sent.
  const e = entries.find((x) => x.client.id === m.client_id);
  const o = e?.options.find((x) => x.key === m.template_key && (x.ref || null) === (m.ref || null));
  // (A message that carried the logins form's link is worded again, with the link.)
  if (o) drafts.set(m.client_id, { opt: optId(o), text: hasRedactedLink(m.body) ? null : m.body });
  render();
  toast(`הרישום בוטל: ההודעה ל${c?.name || 'לקוח'} חזרה לתור.`);
  focusCard(m.client_id);
}

// ── Templates ─────────────────────────────
const tplDlg = $('dlg-templates');
let tplDirty = false;
const GROUPS = [['milestone', 'אבני דרך'], ['thursday', 'עדכון חמישי'], ['delay', 'הודעה על עיכוב'], ['daily', 'הודעות יומיות לפי תחנה']];

function showTemplate(key) {
  const t = templates.get(key);
  $('tpl-key').value = key;
  $('tpl-title').value = t.title;
  $('tpl-text').value = t.body;
  $('tpl-text').removeAttribute('aria-invalid');
  $('tpl-err').hidden = true;
  $('tpl-vars').textContent = `המערכת ממלאת לבד: ${templateVars(key).map((v) => `{${v}}`).join(' ')}. סוגריים מרובעים, כמו [להשלים], מסמנים מקום שממלאים ביד לפני כל שליחה.`;
  $('tpl-meta').textContent = t.isDefault || !t.updated_by || t.updated_by === 'system'
    ? 'זה הנוסח המקורי.'
    : `עודכן לאחרונה ${formatStamp(t.updated_at)}, ${who(t.updated_by)}.`;
  tplDirty = false;
}

function openTemplates() {
  const byKind = (kind) => DEFAULT_TEMPLATES.filter((t) => t.kind === kind);
  fill($('tpl-key'), GROUPS.map(([kind, label]) => h('optgroup', { label },
    ...byKind(kind).map((t) => h('option', { value: t.key }, templates.get(t.key).title)))));
  showTemplate($('tpl-key').value || DEFAULT_TEMPLATES[0].key);
  tplDlg.showModal();
  $('tpl-key').focus();
}

const leaveTemplate = () => !tplDirty || confirm('השינויים בנוסח לא נשמרו. לצאת בלי לשמור?');

$('btn-templates').addEventListener('click', openTemplates);
$('tpl-key').addEventListener('focus', (ev) => { ev.target.dataset.prev = ev.target.value; });
$('tpl-key').addEventListener('change', (ev) => {
  if (!leaveTemplate()) { ev.target.value = ev.target.dataset.prev; return; }
  ev.target.dataset.prev = ev.target.value;
  showTemplate(ev.target.value);
});
$('tpl-title').addEventListener('input', () => { tplDirty = true; });
$('tpl-text').addEventListener('input', () => { tplDirty = true; });
$('tpl-default').addEventListener('click', () => {
  const d = DEFAULT_TEMPLATES.find((t) => t.key === $('tpl-key').value);
  $('tpl-title').value = d.title;
  $('tpl-text').value = d.body;
  tplDirty = true;
  $('tpl-text').focus();
  toast('הנוסח המקורי הוחזר לשדה. הוא יישמר רק אחרי ״שמירת הנוסח״.');
});
tplDlg.addEventListener('click', (ev) => {
  if ((ev.target.closest('[data-close]') || ev.target === tplDlg) && leaveTemplate()) tplDlg.close();
});
tplDlg.addEventListener('cancel', (ev) => { if (!leaveTemplate()) ev.preventDefault(); });

function templateError(msg, field = 'tpl-text') {
  $('tpl-err').textContent = msg;
  $('tpl-err').hidden = false;
  $(field).setAttribute('aria-invalid', 'true');
  $(field).focus();
}

$('tpl-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const key = $('tpl-key').value;
  const t = templates.get(key);
  const title = $('tpl-title').value.trim();
  const body = $('tpl-text').value.replace(/\s+$/, '');
  $('tpl-err').hidden = true;
  $('tpl-title').removeAttribute('aria-invalid');
  $('tpl-text').removeAttribute('aria-invalid');
  if (!title) return templateError('חסר שם לנוסח.', 'tpl-title');
  if (!body.trim()) return templateError('הנוסח ריק.');
  const unknown = unknownVars(key, body);
  if (unknown.length) {
    return templateError(`המערכת לא ממלאת בנוסח הזה את ${unknown.map((v) => `{${v}}`).join(' ')}. אפשר להשתמש ב: ${templateVars(key).map((v) => `{${v}}`).join(' ')}. למקום שממלאים ביד כותבים בסוגריים מרובעים, כמו [להשלים].`);
  }
  $('tpl-save').disabled = true;
  const { data, error } = await supabase.from('message_templates')
    .upsert({ key, title, body, kind: t.kind, station: t.station }, { onConflict: 'key' })
    .select(TPL_COLS).single();
  $('tpl-save').disabled = false;
  if (error) return templateError(`הנוסח לא נשמר. ${explain(error)}`);
  templateRows = [...templateRows.filter((r) => r.key !== key), data];
  templates = templatesByKey(templateRows);
  $('tpl-key').selectedOptions[0].textContent = data.title;
  showTemplate(key);
  build();
  renderKeepingFocus();
  toast('הנוסח נשמר. הודעות שכבר ערכתם בתור נשארות כמו שכתבתם אותן.');
});

// ── Start ─────────────────────────────────
function showNoAccess(msg = null) {
  $('msg-page').hidden = true;
  $('no-access').hidden = false;
  $('state').textContent = msg || '';
}

$('btn-refresh').addEventListener('click', load);
// A new Israel day starts a new queue; a screen left open picks up others' sends.
setInterval(() => {
  if ($('msg-page').hidden || document.hidden) return;
  if (dayKeyIL(new Date()) !== day || Date.now() - lastLoad > 5 * 60e3) load();
  else if (document.querySelector('.msg-undo')) renderKeepingFocus(); // an undo whose time is up goes away
}, 60e3);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('msg-page').hidden && Date.now() - lastLoad > 60e3) load();
});

// The kit (docs/ops.md, section 52): each card's name takes the icon of its kind of message.
dress($('app'), [['.msg-card.is-sent .msg-name', 'check-circle', 'green', 'md'], ['.msg-card.k-delay .msg-name', 'alert', 'orange', 'md'], ['.msg-card.k-milestone .msg-name', 'star', 'purple', 'md'],
  ['.msg-card.k-thursday .msg-name', 'calendar', 'teal', 'md'], ['.msg-card .msg-name', 'chat', 'blue', 'md'], ['#na-h', 'lock', 'navy']]);

mountSession(async (staff) => {
  myEmail = String(staff.email || '').toLowerCase();
  const [dir, viewer] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  $('nav-team').hidden = !canManageTeam(viewer);
  if (!canSendMessages(viewer)) return showNoAccess(viewer.error ? VIEWER_UNKNOWN : null);
  $('msg-page').hidden = false;
  await load();
});
