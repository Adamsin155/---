// Client card: the client's protocol by phase, checked off by each person in
// their role, with tasks and a full history of who checked what and when.
import { PEOPLE, PROCESSES, SHOOT_TYPES, CLIENT_STATUS } from './protocol.js';
import {
  clientState, missingFields, isResolved, blockers, openItemsFor, byUrgency, CLAIM,
} from './protocol-logic.js';
import {
  loadClient, loadChecks, loadLog, loadTasks, setCheck, clearCheck, addTask, setTaskDone, updateClient,
  myPerson, loadDirectory,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, peopleChips, formatWhen, formatDay, formatStamp, who,
  statusBadge, dueText, progressBar, mountSession, store, directory,
} from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';

const id = new URLSearchParams(location.search).get('id');
let client = null;
let checks = {};
let tasks = [];
let myEmail = '';
let me = null;               // this user's person key
let focusPerson = '';        // highlighted person ('' = everyone)
let onlyFocus = false;       // hide processes the person has nothing in
let printing = false;
const openPhases = new Set();
const shownDone = new Set(); // phases whose completed processes the user expanded
const pending = new Set();

const ITEM_INDEX = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, { proc: p, item: i }])));
const FIELD_NAMES = {
  characterizer: 'מי מבצע את האפיון', char_at: 'מועד פגישת האפיון', shoot_type: 'סוג יום הצילום',
  shoot_at: 'מועד יום הצילום', has_logo: 'האם יש ללקוח לוגו',
};
const FIELD_INPUT = { characterizer: 'ed-characterizer', char_at: 'ed-char-at', shoot_type: 'ed-shoot-type', shoot_at: 'ed-shoot-at', has_logo: 'ed-logo' };
const labelOf = (key) => ITEM_INDEX.get(key)?.item.label || key;

async function load() {
  if (!id) { $('state').textContent = 'לא נבחר לקוח.'; return; }
  if (!client) $('state').textContent = 'טוען…';
  try {
    const [c, ch, t] = await Promise.all([loadClient(id), loadChecks(id), loadTasks({ clientId: id })]);
    if (!c) { $('state').textContent = 'הלקוח לא נמצא.'; $('app').hidden = true; return; }
    client = c;
    checks = ch[id] || {};
    tasks = t;
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  $('state').textContent = '';
  document.title = `${client.name} · כרטיס לקוח · astrateg`;
  renderKeepingFocus();
  loadHistory();
}

function render() {
  const s = clientState(client, checks, new Date());
  if (!openPhases.size) {
    openPhases.add(s.current);
    for (const ph of s.phases) if (ph.states.some((x) => x.status === 'overdue')) openPhases.add(ph.key);
    const tp = PROCESSES.find((p) => p.id === location.hash.slice(1));
    if (tp) openPhases.add(tp.phase);
  }
  renderHead(s);
  renderViewbar();
  renderPhases(s);
  renderTasks();
}

// Periodic and background refreshes must not move keyboard focus or scroll.
function renderKeepingFocus(focusId = document.activeElement?.id) {
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  const el = focusId && document.getElementById(focusId);
  if (el && !el.disabled) el.focus({ preventScroll: true });
  else if (focusId) document.getElementById(focusId.replace(/-na$/, ''))?.focus({ preventScroll: true });
}

// ── Header ──────────────────────────────────
function fact(k, v) {
  return h('div', { class: 'fact' }, h('dt', {}, k), h('dd', {}, v || h('span', { class: 'muted' }, 'לא הוזן')));
}

function nextFor(s) {
  const person = focusPerson || null;
  return openItemsFor(person, client, checks, s).sort(byUrgency)[0] || null;
}

function renderHead(s) {
  const c = client;
  const phone = c.phone ? h('span', {},
    h('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}`, dir: 'ltr' }, c.phone), ' · ',
    h('a', { href: whatsappLink(c.phone, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp')) : null;
  const charBy = c.characterizer ? PEOPLE[c.characterizer].name : null;
  const phaseTitle = s.phases.find((p) => p.key === s.current)?.title;
  const next = nextFor(s);
  fill($('cc-head'),
    h('div', { class: 'cc-top' },
      h('div', {},
        h('div', { class: 'kicker' }, c.status === 'active' ? `שלב נוכחי: ${phaseTitle}` : CLIENT_STATUS[c.status]),
        h('h1', {}, c.name),
        h('p', { class: 'muted' }, [c.business, c.package_name].filter(Boolean).join(' · ') || ' ')),
      h('div', { class: 'head-actions' },
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => window.print() }, 'הדפסה'),
        h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-edit', onclick: () => openEdit() }, 'עריכת פרטים'))),
    h('div', { class: 'cc-progress' },
      h('span', {}, 'תהליכים שהושלמו'),
      h('strong', { class: 'num', dir: 'ltr' }, `${s.procsDone}/${s.procsTotal}`),
      progressBar(s.procsDone, s.procsTotal, 'תהליכים שהושלמו'),
      s.overdue ? statusBadge('overdue', null) : null,
      s.overdue ? h('span', { class: 'num' }, `${s.overdue} תהליכים`) : null),
    next ? h('a', { class: `cc-next s-${next.status}`, href: `#${next.proc.id}`, onclick: (e) => { e.preventDefault(); goTo(next.proc.id); } },
      h('span', { class: 'k' }, focusPerson ? `הצעד הבא אצל ${PEOPLE[focusPerson].name}` : 'הצעד הבא'),
      h('span', {}, `${next.proc.num} · ${next.proc.title}`),
      statusBadge(next.status, next.dueAt)) : null,
    h('dl', { class: 'facts cc-facts' },
      fact('טלפון', phone),
      fact('פרטי העסקה התקבלו', c.deal_at ? formatStamp(c.deal_at) : null),
      fact('פגישת אפיון', c.char_at ? `${formatStamp(c.char_at)}${charBy ? ` · ${charBy}` : ''}` : charBy),
      fact('יום צילום', [c.shoot_type ? SHOOT_TYPES[c.shoot_type].name : null, c.shoot_at ? formatStamp(c.shoot_at) : null].filter(Boolean).join(' · ') || null),
      fact('לוגו', c.has_logo === true ? 'יש' : c.has_logo === false ? 'אין, עילאי מכין' : null),
      fact('עורך', c.editor_name),
      fact('סיום החוזה', c.contract_end ? formatDay(c.contract_end) : null)),
    c.notes ? h('p', { class: 'cc-notes' }, c.notes) : null,
  );
  fill($('cc-sticky'),
    h('span', { class: 'sticky-name' }, c.name),
    h('strong', { class: 'num', dir: 'ltr' }, `${s.procsDone}/${s.procsTotal}`),
    progressBar(s.procsDone, s.procsTotal, 'תהליכים שהושלמו'),
    s.overdue ? statusBadge('overdue', null) : null);
}

function goTo(procId) {
  const p = PROCESSES.find((x) => x.id === procId);
  if (p) { openPhases.add(p.phase); shownDone.add(p.phase); render(); }
  const el = document.getElementById(procId);
  el?.scrollIntoView({ block: 'start' });
  el?.querySelector('.cbx:not(:disabled)')?.focus({ preventScroll: true });
}

// ── Person focus ────────────────────────────
function renderViewbar() {
  const opts = [['', 'כל הצוות'], ...Object.values(PEOPLE).map((p) => [p.key, p.key === me ? `${p.name} (אני)` : p.name])];
  const choose = (k) => { focusPerson = k; store.set('focus', k); render(); };
  fill($('viewbar'),
    h('div', { class: 'chips-row wide-only', role: 'group', 'aria-label': 'הדגשה לפי עובד' },
      h('span', { class: 'me-label' }, 'הצגה לפי עובד:'),
      ...opts.map(([k, label]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(focusPerson === k), onclick: () => choose(k),
      }, label))),
    h('label', { class: 'narrow-only person-select' }, h('span', {}, 'הצגה לפי:'),
      h('select', { class: 'input', onchange: (e) => choose(e.currentTarget.value) },
        ...opts.map(([k, label]) => h('option', { value: k, selected: focusPerson === k }, label)))),
    focusPerson ? h('label', { class: 'only' },
      h('input', { type: 'checkbox', checked: onlyFocus, onchange: (e) => { onlyFocus = e.currentTarget.checked; render(); } }),
      ` רק התהליכים של ${PEOPLE[focusPerson].name}`) : null,
    h('div', { class: 'viewbar-acts' },
      h('button', { type: 'button', class: 'btn-text', onclick: () => { for (const p of clientState(client, checks).phases) { openPhases.add(p.key); shownDone.add(p.key); } render(); } }, 'פתיחת הכול'),
      h('button', { type: 'button', class: 'btn-text', onclick: () => { openPhases.clear(); openPhases.add('__none'); shownDone.clear(); render(); } }, 'קיפול')),
  );
}

// ── Phases and processes ────────────────────
function renderPhases(s) {
  const now = new Date();
  fill($('phases'), ...s.phases.map((ph, idx) => {
    const list = ph.states.filter((x) => !onlyFocus || !focusPerson || x.proc.items.some((i) => i.owners.includes(focusPerson)));
    if (!list.length) return null;
    const late = ph.states.filter((x) => x.status === 'overdue').length;
    const done = list.filter((x) => x.complete);
    const showDone = printing || shownDone.has(ph.key) || done.length === list.length;
    const missing = missingFields(ph, client);
    const det = h('details', { class: `phase${ph.key === s.current ? ' is-current' : ''}`, open: printing || openPhases.has(ph.key) },
      h('summary', {},
        h('span', { class: 'ph-idx num' }, String(idx + 1)),
        h('span', { class: 'ph-title' }, h('h2', {}, ph.title), ph.key === s.current ? h('span', { class: 'ph-now' }, 'השלב הנוכחי') : null),
        h('span', { class: 'ph-meta' },
          late ? statusBadge('overdue', null) : null,
          ph.complete ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'הושלם') : null,
          ph.procsTotal ? h('span', { class: 'num', dir: 'ltr' }, `${ph.procsDone}/${ph.procsTotal}`) : null,
          ph.procsTotal ? progressBar(ph.procsDone, ph.procsTotal, `תהליכים שהושלמו בשלב ${ph.title}`) : null)),
      ph.note ? h('p', { class: 'ph-note' }, ph.note) : null,
      missing.length ? h('div', { class: 'need ph-need', role: 'note' },
        h('span', {}, `חלק מהתהליכים בשלב תלויים בפרטים שחסרים: ${missing.map((f) => FIELD_NAMES[f]).join(', ')}.`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openEdit(FIELD_INPUT[missing[0]]) }, 'השלמת פרטים')) : null,
      h('div', { class: 'procs' },
        !showDone && done.length ? h('button', {
          type: 'button', class: 'done-row', 'aria-expanded': 'false', onclick: () => { shownDone.add(ph.key); render(); },
        }, h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' })),
        `${done.length} תהליכים הושלמו (${done.map((x) => x.proc.num).join(', ')})`, h('span', { class: 'btn-text' }, 'הצגה')) : null,
        ...list.filter((x) => showDone || !x.complete).map((x) => procCard(x, now))));
    det.addEventListener('toggle', () => {
      if (printing) return;
      openPhases.delete('__none');
      if (det.open) openPhases.add(ph.key); else openPhases.delete(ph.key);
    });
    return h('section', { class: 'phase-wrap', 'aria-label': ph.title }, det);
  }));
}

function claimLine(x) {
  const p = x.proc;
  if (p.owners.length < 2 || x.complete) return null;
  if (x.claim) {
    return h('span', { class: 'claim' }, `${PEOPLE[x.claim.person]?.name || x.claim.person} לקח/ה · ${formatStamp(x.claim.at)}`,
      x.claim.person === me ? h('button', { type: 'button', class: 'btn-text', onclick: () => setClaim(p, null) }, 'שחרור') : null);
  }
  return h('span', { class: 'claim' }, 'לא נלקח',
    me && p.owners.includes(me) ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setClaim(p, me) }, 'אני על זה') : null);
}

async function setClaim(p, person) {
  const ok = await mark(CLAIM(p), person ? 'done' : null, null, person);
  if (ok) toast(person ? `לקחת את תהליך ${p.num}.` : 'התהליך שוחרר.');
}

function procCard(x, now) {
  const p = x.proc;
  const mine = focusPerson && p.items.some((i) => i.owners.includes(focusPerson));
  const dim = focusPerson && !mine && x.status !== 'overdue';
  const missing = missingFields(p, client);
  const guidance = p.guidance ? (client.shoot_type ? [p.guidance[client.shoot_type]] : Object.values(p.guidance)) : [];
  const compact = x.complete && !printing;
  return h('article', { class: `proc s-${x.status}${mine ? ' is-mine' : ''}${dim ? ' is-dim' : ''}`, id: p.id, 'aria-labelledby': `${p.id}-h` },
    h('header', { class: 'proc-head' },
      h('span', { class: 'pnum num' }, p.num),
      h('div', { class: 'proc-title' },
        h('h3', { id: `${p.id}-h` }, p.title),
        h('div', { class: 'proc-meta' },
          peopleChips(x.claim ? [x.claim.person] : p.owners),
          compact ? null : h('span', { class: 'sla' }, p.sla),
          dueText(x, now) ? h('span', { class: 'due num' }, dueText(x, now)) : null,
          claimLine(x))),
      h('div', { class: 'proc-status' },
        statusBadge(x.status, x.dueAt, now),
        p.recurring || compact ? null : h('span', { class: 'num muted', dir: 'ltr' }, `${x.resolved}/${x.required}`))),
    compact ? null : [
      p.ownerNote ? h('p', { class: 'proc-note' }, p.ownerNote) : null,
      missing.length ? h('div', { class: 'need', role: 'note' },
        h('span', {}, `חסר בפרטי הלקוח: ${missing.map((f) => FIELD_NAMES[f]).join(', ')}.`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openEdit(FIELD_INPUT[missing[0]]) }, 'השלמת פרטים')) : null,
      p.what ? h('p', { class: 'proc-what' }, p.what) : null,
      ...guidance.map((g) => h('p', { class: 'proc-guide' }, g)),
      p.rule ? h('p', { class: 'proc-rule' }, h('strong', {}, 'חובה: '), p.rule) : null,
      h('ul', { class: 'items' }, ...p.items.map((i) => itemRow(p, i))),
    ],
  );
}

function itemRow(p, i) {
  const c = checks[i.key];
  const state = c && isResolved(i, c) ? c.state : null;
  const cid = `i-${i.key.replace(/\./g, '-')}`;
  const busy = pending.has(i.key);
  const block = state ? null : blockers(i, client, checks);
  const ownOwners = i.owners.join() !== p.owners.join();
  const mine = focusPerson && i.owners.includes(focusPerson);
  const meta = [];
  if (c && (!i.recurring)) {
    const verb = c.state === 'na' ? (i.optional ? 'לא נדרש' : 'סומן לא רלוונטי') : 'בוצע';
    meta.push(h('span', { class: 'by' }, `${verb} · ${who(c.by_email)} · ${formatStamp(c.at)}`));
    if (c.note) meta.push(h('span', { class: 'inote' }, c.state === 'na' ? `סיבה: ${c.note}` : c.note));
  }
  if (block) {
    const here = block.items.filter((k) => ITEM_INDEX.get(k)?.proc.id === p.id);
    const there = block.items.filter((k) => !here.includes(k)).map((k) => `${labelOf(k)} (תהליך ${ITEM_INDEX.get(k)?.proc.num})`);
    const why = [
      ...(here.length > 2 ? [`${here.length} בדיקות למעלה`] : here.map(labelOf)),
      ...there,
    ];
    const text = [
      why.length ? `ממתין ל: ${why.join(', ')}` : null,
      block.fields.length ? `צריך להזין קודם: ${block.fields.map((f) => FIELD_NAMES[f]).join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    meta.push(h('span', { class: 'blocked', id: `${cid}-b` }, text));
  }
  if (i.optional && !c) meta.push(h('span', { class: 'tag' }, 'אם רלוונטי'));
  if (ownOwners) meta.push(peopleChips(i.owners));

  if (i.recurring) {
    return h('li', { class: `item recurring${state ? ' is-done' : ''}${mine ? ' is-mine' : ''}` },
      h('span', { class: `rmark${state ? ' on' : ''}`, 'aria-hidden': 'true' }),
      h('div', { class: 'ibody' },
        h('span', { class: 'ilabel' }, i.label),
        h('div', { class: 'imeta' },
          c ? h('span', { class: 'by' }, `שיחה אחרונה: ${formatStamp(c.at)} · ${who(c.by_email)}`) : h('span', { class: 'muted' }, 'עוד לא תועדה שיחה'),
          c?.note ? h('span', { class: 'inote' }, c.note) : null)),
      h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => openCall(i.key) }, 'תיעוד שיחה'));
  }

  const naLabel = state === 'na' ? 'החזרה לפתוח' : i.optional ? 'לא נדרש' : 'לא רלוונטי';
  return h('li', { class: `item${state === 'done' ? ' is-done' : ''}${state === 'na' ? ' is-na' : ''}${mine ? ' is-mine' : ''}${busy ? ' is-busy' : ''}${block ? ' is-blocked' : ''}` },
    h('label', { class: 'irow', for: cid },
      h('input', {
        type: 'checkbox', id: cid, class: 'cbx', checked: state === 'done', disabled: busy || state === 'na' || !!block,
        'aria-describedby': meta.length ? `${cid}-m` : null,
        onchange: (e) => mark(i.key, e.currentTarget.checked ? 'done' : null, cid),
      }),
      h('span', { class: 'ibody' },
        h('span', { class: 'ilabel' }, i.label, state === 'na' ? h('span', { class: 'tag' }, i.optional ? 'לא נדרש' : 'לא רלוונטי') : null),
        meta.length ? h('span', { class: 'imeta', id: `${cid}-m` }, ...meta) : null)),
    state === 'done' ? null : h('button', {
      type: 'button', class: `btn-text na-btn${i.optional ? ' is-opt' : ''}`, disabled: busy, id: `${cid}-na`,
      'aria-label': `${naLabel}: ${i.label}`,
      onclick: () => {
        if (state === 'na') return mark(i.key, null, `${cid}-na`);
        if (i.optional) return mark(i.key, 'na', `${cid}-na`);
        return openNa(i, `${cid}-na`);
      },
    }, naLabel));
}

// Optimistic: the screen changes at once and rolls back if the save fails.
async function mark(key, state, focusId, note = null) {
  if (pending.has(key)) return false;
  const prev = checks[key];
  pending.add(key);
  if (state) checks[key] = { state, note, at: new Date().toISOString(), by_email: myEmail };
  else delete checks[key];
  renderKeepingFocus(focusId);
  try {
    if (state) checks[key] = await setCheck(id, key, state, note);
    else await clearCheck(id, key);
    pending.delete(key);
    renderKeepingFocus(focusId);
    loadHistory();
    return true;
  } catch (err) {
    pending.delete(key);
    if (prev) checks[key] = prev; else delete checks[key];
    renderKeepingFocus(focusId);
    toast(`הסימון לא נשמר ולכן בוטל. ${errorText(err)}`);
    return false;
  }
}

// ── "Not relevant" needs a reason for required items ──
const naDlg = $('dlg-na');
let naTarget = null;
naDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === naDlg) naDlg.close(); });
naDlg.addEventListener('close', () => { if (naTarget) document.getElementById(naTarget.focusId)?.focus(); });
function openNa(item, focusId) {
  naTarget = { item, focusId };
  $('na-form').reset();
  $('na-err').hidden = true;
  $('na-item').textContent = item.label;
  naDlg.showModal();
  $('na-reason').focus();
}
$('na-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = $('na-reason').value.trim();
  if (!reason) { $('na-err').textContent = 'כתבו בקצרה למה הפריט לא רלוונטי ללקוח הזה.'; $('na-err').hidden = false; $('na-reason').focus(); return; }
  $('na-submit').disabled = true;
  const ok = await mark(naTarget.item.key, 'na', naTarget.focusId, reason);
  $('na-submit').disabled = false;
  if (ok) naDlg.close();
});

// ── Weekly call ─────────────────────────────
const callDlg = $('dlg-call');
let callKey = null;
callDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === callDlg) callDlg.close(); });
function openCall(key) {
  callKey = key;
  $('call-form').reset();
  $('call-err').hidden = true;
  callDlg.showModal();
  $('call-note').focus();
}
$('call-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('call-submit').disabled = true;
  const ok = await mark(callKey, 'done', null, $('call-note').value.trim() || null);
  $('call-submit').disabled = false;
  if (ok) { callDlg.close(); toast('השיחה תועדה.'); }
});

// ── Tasks ───────────────────────────────────
fill($('task-owner'), ...Object.values(PEOPLE).map((p) => h('option', { value: p.key }, p.name)));
function renderTasks() {
  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at).slice(0, 20);
  const today = new Date().toLocaleDateString('en-CA');
  const row = (t) => {
    const tid = `t-${t.id}`;
    const late = !t.done_at && t.due_on && t.due_on < today;
    return h('li', { class: `item${t.done_at ? ' is-done' : ''}` },
      h('label', { class: 'irow', for: tid },
        h('input', { type: 'checkbox', id: tid, class: 'cbx', checked: !!t.done_at, onchange: (e) => toggleTask(t, e.currentTarget) }),
        h('span', { class: 'ibody' },
          h('span', { class: 'ilabel' }, t.title),
          h('span', { class: 'imeta' },
            personChip(t.owner),
            t.due_on ? h('span', { class: `num${late ? ' late' : ''}` }, `${late ? 'באיחור · ' : ''}עד ${formatDay(t.due_on)}`) : null,
            t.done_at ? h('span', { class: 'by' }, `בוצע · ${who(t.done_by_email)} · ${formatStamp(t.done_at)}`) : h('span', { class: 'by' }, `נפתח ע״י ${who(t.created_by_email)} · ${formatStamp(t.created_at)}`)))));
  };
  if (!tasks.length) fill($('task-list'), h('li', { class: 'empty' }, 'אין משימות פתוחות.'));
  else fill($('task-list'), ...open.map(row), ...done.map(row));
}
async function toggleTask(t, input) {
  input.disabled = true;
  try {
    const row = await setTaskDone(t.id, input.checked);
    tasks = tasks.map((x) => (x.id === t.id ? row : x));
    renderTasks();
    document.getElementById(`t-${t.id}`)?.focus();
  } catch (err) {
    input.checked = !input.checked;
    input.disabled = false;
    toast(`המשימה לא עודכנה. ${errorText(err)}`);
  }
}
$('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('task-title').value.trim();
  $('task-title').setAttribute('aria-invalid', String(!title));
  if (!title) { $('task-title').focus(); toast('כתבו מה צריך לעשות.'); return; }
  $('task-submit').disabled = true;
  try {
    const row = await addTask({ client_id: id, title, owner: $('task-owner').value, due_on: $('task-due').value || null });
    tasks = [row, ...tasks];
    $('task-title').value = '';
    $('task-due').value = '';
    renderTasks();
    toast(`המשימה נוספה אצל ${PEOPLE[row.owner].name}.`);
  } catch (err) {
    toast(`המשימה לא נשמרה. ${errorText(err)}`);
  }
  $('task-submit').disabled = false;
  $('task-title').focus();
});

// ── History ─────────────────────────────────
const ACTION = { done: 'סימן/ה כבוצע', na: 'סימן/ה לא רלוונטי', clear: 'ביטל/ה סימון' };
async function loadHistory() {
  let log = [];
  try { log = await loadLog(id); } catch { return; }
  fill($('hist-list'), ...(log.length ? log.map((r) => {
    const claimed = /\.claim$/.test(r.item_key);
    const ref = ITEM_INDEX.get(r.item_key);
    const procNum = PROCESSES.find((p) => CLAIM(p) === r.item_key)?.num;
    const text = claimed
      ? (r.action === 'clear' ? `שחרר/ה את תהליך ${procNum}` : `לקח/ה את תהליך ${procNum}`)
      : `${ACTION[r.action]}: `;
    return h('li', {},
      h('span', { class: 'num muted' }, formatStamp(r.at)), ' ',
      h('strong', {}, who(r.by_email)), ` ${text}`,
      !claimed && ref ? h('a', { href: `#${ref.proc.id}`, onclick: (e) => { e.preventDefault(); goTo(ref.proc.id); } }, `${ref.proc.num} · ${ref.item.label}`) : null,
      !claimed && !ref ? r.item_key : null,
      r.note && !claimed ? h('div', { class: 'inote' }, r.note) : null);
  }) : [h('li', { class: 'empty' }, 'עוד לא סומן דבר.')]));
}

// ── Edit client ─────────────────────────────
const edDlg = $('dlg-edit');
edDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === edDlg) edDlg.close(); });
const pad = (n) => String(n).padStart(2, '0');
const toLocal = (v) => { if (!v) return ''; const d = new Date(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

function openEdit(focusId = 'ed-name') {
  const c = client;
  $('ed-err').hidden = true;
  $('ed-name').value = c.name || '';
  $('ed-business').value = c.business || '';
  $('ed-phone').value = c.phone || '';
  $('ed-package').value = c.package_name || '';
  $('ed-deal').value = toLocal(c.deal_at);
  $('ed-status').value = c.status;
  $('ed-char-at').value = toLocal(c.char_at);
  $('ed-characterizer').value = c.characterizer || '';
  $('ed-logo').value = c.has_logo === null || c.has_logo === undefined ? '' : String(c.has_logo);
  $('ed-shoot-type').value = c.shoot_type || '';
  $('ed-shoot-at').value = toLocal(c.shoot_at);
  $('ed-editor').value = c.editor_name || '';
  $('ed-contract-end').value = c.contract_end || '';
  $('ed-notes').value = c.notes || '';
  edDlg.showModal();
  $(focusId).focus();
}
$('ed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('ed-name').value.trim();
  const fail = (msg) => { $('ed-err').textContent = msg; $('ed-err').hidden = false; };
  if (!name) { $('ed-name').focus(); return fail('חסר שם לקוח.'); }
  // Ending a client closes its work only after process 35 is done.
  const status = $('ed-status').value;
  const p35 = PROCESSES.find((p) => p.id === 'p35').items.map((i) => i.key);
  if (status === 'ended' && client.status !== 'ended' && !p35.every((k) => checks[k])) {
    $('ed-status').focus();
    return fail('לפני שמסמנים ״הסתיים״ צריך לסגור את תהליך 35 (עצירת קמפיינים, הסרת גישות וסגירת חיבורים). בחרו ״מסיים התקשרות״ כדי שהתהליך יופיע.');
  }
  const val = (i) => $(i).value.trim() || null;
  $('ed-submit').disabled = true;
  try {
    client = await updateClient(id, {
      name, business: val('ed-business'), phone: val('ed-phone'), package_name: val('ed-package'),
      deal_at: fromLocal($('ed-deal').value) || client.deal_at, status,
      char_at: fromLocal($('ed-char-at').value), characterizer: val('ed-characterizer'),
      has_logo: $('ed-logo').value === '' ? null : $('ed-logo').value === 'true',
      shoot_type: val('ed-shoot-type'), shoot_at: fromLocal($('ed-shoot-at').value), editor_name: val('ed-editor'),
      contract_end: val('ed-contract-end'), notes: val('ed-notes'),
    });
    edDlg.close();
    render();
    toast('הפרטים נשמרו.');
  } catch (err) {
    fail(errorText(err));
  }
  $('ed-submit').disabled = false;
});

// Print the whole protocol, with every phase and item.
window.addEventListener('beforeprint', () => { if (client) { printing = true; render(); } });
window.addEventListener('afterprint', () => { if (client) { printing = false; render(); } });

const busy = () => pending.size || edDlg.open || callDlg.open || naDlg.open;
document.addEventListener('visibilitychange', () => { if (!document.hidden && client && !busy()) load(); });
setInterval(() => { if (!document.hidden && client && !busy()) renderKeepingFocus(); }, 60e3);

mountSession(async (staff) => {
  myEmail = staff.email;
  Object.assign(directory, await loadDirectory());
  me = (await myPerson()) || store.get('me') || null;
  if (me && !PEOPLE[me]) me = null;
  // A saved choice ('' = whole team) wins; otherwise start from the user's own work.
  const saved = store.get('focus');
  focusPerson = saved !== null ? saved : me || '';
  if (focusPerson && !PEOPLE[focusPerson]) focusPerson = '';
  await load();
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView({ block: 'start' });
});
