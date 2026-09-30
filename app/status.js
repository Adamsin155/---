// The client's status page (status.html): opened from a secret link in WhatsApp,
// no password, understandable on a phone in 10 seconds. Everything comes from one
// database function that checks the token (public.get_status); the client's
// actions go through three more (approve_item, request_fix, answer_survey), which
// check it again and store the exact words shown. What to show and how to word it:
// app/status-logic.js. All text goes through text nodes, never innerHTML.
import { h } from './quote-doc.js';
import {
  TOKEN, STATIONS_CLIENT, stationOf, nextMilestones, needsFromYou, itemText, wordingFor, ROUNDS_USED, receiptText,
  QUESTIONS, SURVEY_NOTE, SURVEY_TITLES, scaleOf, nameOk, cleanName, domId, RESPONSE_TIMES, OFFICE_HOURS_TEXT, team,
  LINK_LABELS, CLOSED_TEXT, actionError, ITEMS,
} from './status-logic.js';
import { dayText, timeText } from './messages-logic.js';

const $ = (id) => document.getElementById(id);
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const token = new URLSearchParams(location.search).get('t') || '';
let data = null;
let supa = null;
const busy = new Set();
const drafts = new Map(); // item key -> the note being written (kept across a refresh of the page's data)

// The name typed once is offered again on this phone (a convenience; never needed).
const NAME_KEY = 'status.name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const saveName = (v) => { try { localStorage.setItem(NAME_KEY, cleanName(v)); } catch { /* private mode */ } };
let typedName = '';
const currentName = () => typedName || savedName() || data?.client?.name || '';

const at = (v) => { const d = new Date(v); return `${dayText(d)} בשעה ${timeText(d)}`; };

function showState(kind) {
  const [title, text] = CLOSED_TEXT[kind] || CLOSED_TEXT.error;
  $('page').hidden = true;
  fill($('state'), h('h1', {}, title), h('p', {}, text));
  $('state').hidden = false;
  document.title = `${title} · astrateg`;
}

async function load() {
  if (!TOKEN.test(token)) { showState('invalid'); return; }
  try {
    supa ||= await import('./supa.js');
    const { data: d, error } = await supa.supabase.rpc('get_status', { p_token: token });
    if (error) throw error;
    if (!d || d.state !== 'ok') { showState(d?.state || 'invalid'); return; }
    render(d);
  } catch {
    showState('error');
  }
}

// ── Rendering ─────────────────────────────
function render(d) {
  data = d;
  const now = new Date();
  const c = d.client;
  document.title = `דף המצב · ${c.business} · astrateg`;
  $('sbar-title').textContent = `דף המצב · ${c.business}`;
  $('preview').hidden = !d.preview;
  const st = stationOf(d, now);
  $('hello-h').textContent = `שלום ${c.name}, ככה אנחנו עומדים`;
  fill($('where'), h('span', { class: 'sstep' }, `שלב ${st + 1} מתוך 8`), ' ', h('strong', {}, STATIONS_CLIENT[st].title), `: ${STATIONS_CLIENT[st].text}`);
  fill($('stations-bar'), STATIONS_CLIENT.map((s, i) => h('span', { class: i < st ? 'is-done' : i === st ? 'is-now' : '' })));
  fill($('stations'), STATIONS_CLIENT.map((s, i) => h('li', { class: i < st ? 'is-done' : i === st ? 'is-now' : '', 'aria-current': i === st ? 'step' : null },
    h('span', { class: 'st-mark', 'aria-hidden': 'true' }, i < st ? '✓' : String(i + 1)),
    h('span', {}, h('strong', {}, s.title), h('span', { class: 'st-text' }, ` · ${s.text}`),
      h('span', { class: 'sr-only' }, i < st ? ' (הושלם)' : i === st ? ' (עכשיו)' : '')))));

  const needs = needsFromYou(d, now);
  $('needs-sec').hidden = !needs.length;
  fill($('needs'), needs.map((n) => h('li', {}, n.href ? h('a', { href: n.href }, n.text) : n.text)));

  renderItems();
  renderSurvey();

  const next = nextMilestones(d, now);
  fill($('next'), next.length ? next.map((m) => h('li', {}, h('span', { class: 'next-when' }, m.when), h('span', { class: 'next-what' }, m.label)))
    : h('li', { class: 'muted' }, 'אין כרגע תאריך קרוב. נעדכן כאן ובקבוצה.'));

  const thu = d.thursday;
  $('thursday-sec').hidden = !thu;
  if (thu) { $('thu-at').textContent = `נשלח ב${dayText(new Date(thu.at))}`; $('thu-body').textContent = thu.body; }

  fill($('team'), team().map((p) => h('li', {}, h('strong', {}, p.name), h('span', {}, p.role))));

  const links = LINK_LABELS.filter(([k]) => d.links?.[k]);
  $('links-sec').hidden = !links.length;
  fill($('links'), links.map(([k, label]) => h('li', {}, h('a', { href: d.links[k], target: '_blank', rel: 'noopener noreferrer' }, label, h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')))));

  fill($('times'), RESPONSE_TIMES.map(([what, when]) => [h('dt', {}, what), h('dd', {}, when)]).flat());
  $('hours').textContent = OFFICE_HOURS_TEXT;

  const hist = d.approvals || [];
  $('history-sec').hidden = !hist.length;
  fill($('history'), hist.map((a) => h('li', {},
    h('span', { class: a.decision === 'approve' ? 'hist-ok' : 'hist-fix' }, a.decision === 'approve' ? 'אושר' : 'בקשת תיקון'),
    ` · ${itemText(a.item, a.shootRound)} · סבב ${a.round} · ${a.name} · ${at(a.at)}`,
    a.note ? h('span', { class: 'hist-note' }, a.note) : null)));

  $('state').hidden = true;
  $('page').hidden = false;
}

// ── Approvals ─────────────────────────────
function renderItems() {
  const items = (data.items || []).filter((i) => i.state !== 'approved');
  $('approvals-sec').hidden = !items.length;
  fill($('items'), items.map(itemCard));
}

function itemCard(it) {
  const id = domId(it.key);
  const label = itemText(it.item, it.shootRound);
  const head = [
    h('h3', { id: `h-${id}` }, label),
    h('p', { class: 'sitem-meta' }, `סבב ${it.round}`, it.link ? [' · ', h('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer' }, ITEMS[it.item].link, h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'))] : null),
  ];
  if (it.state === 'fixing') {
    return h('article', { class: 'sitem is-fixing', id: `item-${id}`, 'aria-labelledby': `h-${id}` }, ...head,
      h('p', { class: 'sbadge' }, 'אצלנו בתיקון. נחזור אליך עם הגרסה המתוקנת, ותוכלו לאשר אותה כאן.'));
  }
  const args = () => ({ name: $(`n-${id}`)?.value || currentName(), business: data.client.business, item: it.item, shootRound: it.shootRound, round: it.round, included: it.included });
  const extra = it.round > it.included;
  const nameInput = h('input', {
    class: 'sinput', id: `n-${id}`, autocomplete: 'name', maxlength: '120', value: currentName(), 'aria-describedby': `n-${id}-err`,
    oninput: (e) => {
      typedName = e.target.value;
      $(`wa-${id}`).textContent = wordingFor('approve', args());
      $(`wf-${id}`).textContent = wordingFor('fix', args());
      e.target.removeAttribute('aria-invalid');
      $(`n-${id}-err`).hidden = true;
    },
  });
  const note = h('textarea', {
    class: 'sinput sarea', id: `f-${id}`, rows: '4', maxlength: '4000', 'aria-describedby': `wf-${id} f-${id}-err`,
    oninput: (e) => { drafts.set(it.key, e.target.value); e.target.removeAttribute('aria-invalid'); $(`f-${id}-err`).hidden = true; },
  });
  note.value = drafts.get(it.key) || '';
  return h('article', { class: 'sitem', id: `item-${id}`, 'aria-labelledby': `h-${id}` }, ...head,
    h('div', { class: 'sfield' },
      h('label', { for: `n-${id}` }, 'השם המלא שלך'),
      nameInput,
      h('p', { class: 'serr', id: `n-${id}-err`, hidden: true }, 'יש למלא שם מלא.')),
    h('div', { class: 'schoice' },
      h('p', { class: 'swording', id: `wa-${id}` }, wordingFor('approve', args())),
      h('button', { type: 'button', class: 'sbtn sbtn-ok', id: `ok-${id}`, 'aria-describedby': `wa-${id}`, onclick: () => act('approve', it) }, 'מאשר/ת')),
    h('div', { class: 'schoice schoice-fix' },
      extra ? h('p', { class: 'sused' }, ROUNDS_USED) : null,
      h('p', { class: 'swording', id: `wf-${id}` }, wordingFor('fix', args())),
      h('label', { for: `f-${id}` }, 'מה לתקן (כל ההערות בבת אחת)'),
      note,
      h('p', { class: 'serr', id: `f-${id}-err`, hidden: true }, 'יש לכתוב מה לתקן.'),
      h('button', { type: 'button', class: 'sbtn', id: `fx-${id}`, 'aria-describedby': `wf-${id}`, onclick: () => act('fix', it) }, 'מבקש/ת תיקון')),
    h('p', { class: 'serr serr-box', id: `e-${id}`, role: 'alert', hidden: true }));
}

async function act(decision, it) {
  const id = domId(it.key);
  if (busy.has(it.key)) return;
  const nameEl = $(`n-${id}`);
  const noteEl = $(`f-${id}`);
  const name = nameEl.value;
  $(`e-${id}`).hidden = true;
  if (!nameOk(name)) {
    nameEl.setAttribute('aria-invalid', 'true');
    $(`n-${id}-err`).hidden = false;
    nameEl.focus();
    return;
  }
  const note = noteEl.value.trim();
  if (decision === 'fix' && note.length < 2) {
    noteEl.setAttribute('aria-invalid', 'true');
    $(`f-${id}-err`).hidden = false;
    noteEl.focus();
    return;
  }
  // Exactly the words on the screen now (the database refuses any other).
  const wording = $(decision === 'approve' ? `wa-${id}` : `wf-${id}`).textContent;
  const btn = $(decision === 'approve' ? `ok-${id}` : `fx-${id}`);
  const label = btn.textContent;
  busy.add(it.key);
  btn.disabled = true;
  btn.textContent = 'שומר…';
  try {
    const { data: d, error } = decision === 'approve'
      ? await supa.supabase.rpc('approve_item', { p_token: token, p_key: it.key, p_name: name, p_wording: wording, p_note: null })
      : await supa.supabase.rpc('request_fix', { p_token: token, p_key: it.key, p_name: name, p_wording: wording, p_note: note });
    if (error) throw error;
    saveName(name);
    drafts.delete(it.key);
    if (!d || d.state !== 'ok') { showState(d?.state || 'error'); return; }
    render(d);
    const mine = (d.approvals || []).find((a) => a.key === it.key && a.decision === decision);
    const r = $('receipt');
    r.textContent = mine ? receiptText(mine) : 'התקבל. תודה!';
    r.hidden = false;
    r.focus();
  } catch (err) {
    busy.delete(it.key);
    btn.disabled = false;
    btn.textContent = label;
    const e = $(`e-${id}`);
    e.textContent = actionError(err);
    e.hidden = false;
    return;
  }
  busy.delete(it.key);
}

// ── The question ──────────────────────────
function renderSurvey() {
  const sec = $('survey');
  const kind = (data.surveys?.due || [])[0];
  if (!kind) { sec.hidden = true; fill(sec); return; }
  sec.hidden = false;
  const name = h('input', { class: 'sinput', id: 'sv-name', autocomplete: 'name', maxlength: '120', value: currentName(), oninput: (e) => { typedName = e.target.value; } });
  fill(sec,
    h('h2', { id: 'survey-h' }, `שאלה קצרה: ${SURVEY_TITLES[kind]}`),
    h('form', { id: 'sv-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); answer(kind); } },
      h('fieldset', { class: 'sscale' },
        h('legend', {}, QUESTIONS[kind]),
        h('div', { class: `sscale-row${kind === 'nps' ? ' is-11' : ''}` }, scaleOf(kind).map((n) => h('label', { class: 'sscore' },
          h('input', { type: 'radio', name: 'sv-score', value: String(n), id: `sv-${n}` }), h('span', {}, String(n))))),
        h('p', { class: 'sscale-ends', 'aria-hidden': 'true' }, h('span', {}, kind === 'nps' ? '0: בכלל לא' : '1: לא מרוצים'), h('span', {}, kind === 'nps' ? '10: בטוח' : '5: מרוצים מאוד'))),
      h('div', { class: 'sfield' }, h('label', { for: 'sv-name' }, 'השם שלך'), name),
      h('p', { class: 'muted' }, SURVEY_NOTE),
      h('p', { class: 'serr', id: 'sv-err', role: 'alert', hidden: true }),
      h('button', { type: 'submit', class: 'sbtn sbtn-ok', id: 'sv-send' }, 'שליחה')));
}

async function answer(kind) {
  const picked = document.querySelector('input[name="sv-score"]:checked');
  const name = $('sv-name').value;
  const err = $('sv-err');
  err.hidden = true;
  if (!picked) { err.textContent = 'בחרו מספר.'; err.hidden = false; $(`sv-${scaleOf(kind)[0]}`).focus(); return; }
  if (!nameOk(name)) { err.textContent = 'יש למלא שם.'; err.hidden = false; $('sv-name').focus(); return; }
  const btn = $('sv-send');
  btn.disabled = true;
  try {
    const { data: d, error } = await supa.supabase.rpc('answer_survey', { p_token: token, p_kind: kind, p_score: Number(picked.value), p_name: name });
    if (error) throw error;
    saveName(name);
    if (!d || d.state !== 'ok') { showState(d?.state || 'error'); return; }
    render(d);
    const r = $('receipt');
    r.textContent = 'תודה! קיבלנו את התשובה.';
    r.hidden = false;
    r.focus();
  } catch (e) {
    btn.disabled = false;
    err.textContent = actionError(e);
    err.hidden = false;
  }
}

load();
