// "הודעות ללקוחות" (messages.html): the day's queue of proactive messages to
// clients (docs/plan/system-plan.md, section 7 and Irit's day). For each open
// client, the message that fits today, editable; "שליחה ומעבר לבא" opens
// WhatsApp with it (a link only, never automation) and records that it was
// sent. What to suggest is decided in messages-logic.js; the database stamps
// who sent and when, and keeps to one message per client per Israel day.
// For the owner, Irit and Lior (the database lets the office in: can_message_clients()).
import { supabase } from './supa.js';
import { STATIONS } from './protocol.js';
import { isBusinessDay } from './protocol-logic.js';
import { loadClients, loadChecks, loadDirectory } from './protocol-data.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, VIEWER_UNKNOWN, directory, who, formatStamp, store,
} from './protocol-ui.js';
import { dayKeyIL } from './tz.js';
import { canManageTeam } from './team-rules.js';
import {
  dayQueue, templatesByKey, messageText, unfilledIn, unknownVars, templateVars, waLink, groupLink, canSendMessages,
  DEFAULT_TEMPLATES, MESSAGE_KINDS, dayText, timeText,
} from './messages-logic.js';

const MSG_COLS = 'id, client_id, kind, template_key, ref, body, sent_by_email, sent_at';
const TPL_COLS = 'key, title, body, kind, station, updated_by, updated_at';
const HISTORY_DAYS = 180;
const PAGE = 1000;

let clients = [];
let checks = {};
let messages = [];            // client_messages of the last HISTORY_DAYS days, newest first
let templateRows = [];
let templates = templatesByKey();
let templatesError = null;
let entries = [];             // today's queue (dayQueue)
let day = null;               // the Israel day the queue was built for
let lastLoad = 0;
let station = store.get('messages.station') || 'all';
const drafts = new Map();     // client id -> { opt, text }: the chosen option and the text as edited
const recording = new Set();  // client ids whose record is on its way
const failed = new Map();     // client id -> { option, text, error }: opened in WhatsApp, not recorded
const errors = new Map();     // client id -> what to fix before sending
const openHistory = new Set();

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
  lastLoad = Date.now();
  $('state').textContent = templatesError ? `הנוסחים השמורים לא נטענו (${explain(templatesError)}), ולכן מוצגים הנוסחים המקוריים.` : '';
  if (day && day !== dayKeyIL(now)) { drafts.clear(); failed.clear(); errors.clear(); }
  build(now);
  renderKeepingFocus();
}

function build(now = new Date()) {
  day = dayKeyIL(now);
  const byClient = {};
  for (const m of messages) (byClient[m.client_id] ||= []).push(m);
  entries = dayQueue(clients, checks, byClient, now);
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
  $('msg-summary').textContent = `${dayText(now)} · ${todo === 1 ? 'הודעה אחת לשליחה' : `${todo} הודעות לשליחה`} · ${done === 1 ? 'לקוח אחד כבר קיבל הודעה היום' : `${done} לקוחות כבר קיבלו הודעה היום`}`;
}

function renderFilters() {
  const all = entries.filter((e) => !e.dayOff);
  const used = new Set(all.map(stationKey));
  const chip = (key, title, n) => h('button', {
    type: 'button', class: 'chip', id: `msg-st-${key}`, 'aria-pressed': String(station === key),
    onclick: () => { station = key; store.set('messages.station', key); render(); },
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
  const empty = $('msg-empty');
  if (off) empty.textContent = 'היום המשרד סגור (סוף שבוע או חג), ולכן אין היום הודעות יזומות ללקוחות.';
  else if (!list.length) empty.textContent = station === 'all' ? 'אין היום לקוחות פעילים בתור.' : 'אין היום לקוחות בתחנה הזו.';
  else if (!pending(list).length) empty.textContent = 'כל ההודעות של היום נשלחו. יפה!';
  empty.hidden = !(off || !list.length || !pending(list).length);
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

// "אבן דרך: ברוכים הבאים"; a daily template's title already says what it is.
function optionLabel(o) {
  const title = templates.get(o.key)?.title || o.key;
  return o.kind === 'daily' ? title : `${MESSAGE_KINDS[o.kind]}: ${title}`;
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

function sentCard(e) {
  const m = e.sent;
  return h('li', { class: 'msg-card is-sent', id: `msg-${e.client.id}`, 'aria-labelledby': `msg-h-${e.client.id}` },
    head(e),
    h('p', { class: 'msg-why' },
      h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'כבר נשלח היום'),
      h('span', {}, `${timeText(new Date(m.sent_at))} · ${who(m.sent_by_email)} · ${templates.get(m.template_key)?.title || MESSAGE_KINDS[m.kind] || ''}`)),
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

  return h('li', { class: `msg-card k-${o.kind}${busy ? ' is-busy' : ''}`, id: `msg-${id}`, 'aria-labelledby': `msg-h-${id}` },
    head(e),
    h('p', { class: 'msg-why' }, kindBadge(o.kind), h('span', {}, o.reason)),
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

function focusCard(id) {
  const ta = id && document.getElementById(`msg-text-${id}`);
  if (ta) { ta.focus(); return; }
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
    .insert({ client_id: c.id, kind: option.kind, template_key: option.key, ref: option.ref || null, body: text })
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
  toast(`נרשם: נשלחה הודעה ל${c.name}.`);
  focusCard(next);
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
}, 60e3);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('msg-page').hidden && Date.now() - lastLoad > 60e3) load();
});

mountSession(async (staff) => {
  const [dir, viewer] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  $('nav-team').hidden = !canManageTeam(viewer);
  if (!canSendMessages(viewer)) return showNoAccess(viewer.error ? VIEWER_UNKNOWN : null);
  $('msg-page').hidden = false;
  await load();
});
