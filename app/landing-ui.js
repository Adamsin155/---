// "קליטת לקוחות קיימים" (landing.html; docs/ops.md, section 41): the one screen on
// which a person goes over the clients that came from the old system. For each client
// in landing that has something of theirs: the items the system shows as open for
// them, and next to each "כבר בוצע" / "עדיין פתוח" / "לא רלוונטי". One tap accepts
// the system's proposal for a client, one tap says "everything of mine here was done",
// and "סיימתי עם הלקוח הזה" closes it (it can be taken back until the client is
// activated). The office also corrects the client's station here.
// No clock, no lateness and no colour of urgency anywhere on this screen.
// The logic: app/landing-logic.js; the writes: app/landing-data.js (functions of the
// database that check whose item it is and stamp who and when).
import { STATIONS, PEOPLE } from './protocol.js';
import { clientLabel } from './protocol-logic.js';
import { loadClients, loadChecks, loadDirectory, setChecksBulk, clearChecksBulk } from './protocol-data.js';
import { $, fill, h, toast, errorText, mountSession, directory, viewerOf, VIEWER_UNKNOWN, progressBar } from './protocol-ui.js';
import { loadIntake, takeIn } from './landing-data.js';
import {
  CHOICES, CHOICE_TEXT, intakeFor, intakeLeft, waitingPeople, stationNow, evidentStation, stationPlan,
} from './landing-logic.js';
import { IMPORT_NOTE } from './client-open.js';

let viewer = null;
let me = null;
let clients = [];
let checks = {};
let intake = { marks: {}, done: {}, ready: false };
const busy = new Set();     // client ids with a write on its way
const openDone = new Set(); // finished clients whose items are shown again
const openItems = new Set(); // clients whose items are shown one by one

const clientUrl = (id) => `client.html?id=${encodeURIComponent(id)}`;
const office = () => viewer?.scope === 'office' && !!me;
const marksOf = (id) => (intake.marks[id] ||= {});
const doneOf = (id) => (intake.done[id] ||= {});
const procText = (proc) => `${/^r(\d+)-/.test(proc.id) ? `סבב ${/^r(\d+)-/.exec(proc.id)[1]} · ` : ''}${proc.num} · ${proc.title}`;

async function load() {
  if (!clients.length) $('state').textContent = 'טוען…';
  try {
    [clients, checks, intake] = await Promise.all([loadClients(), loadChecks(), loadIntake()]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  $('state').textContent = '';
  render();
}

// ── Writes ──────────────────────────────────
// Whoever else still has to go over the client, once I have finished it.
const othersWaiting = (client) => waitingPeople(client, checks[client.id] || {}, marksOf(client.id), { ...doneOf(client.id), [me]: { done: true } }).filter((p) => p !== me);

async function save(client, marks, done = null) {
  if (busy.has(client.id)) return false;
  busy.add(client.id);
  const before = { marks: { ...marksOf(client.id) }, done: { ...doneOf(client.id) } };
  // Shown at once; taken back if the database refuses.
  for (const [k, choice] of Object.entries(marks)) marksOf(client.id)[k] = { choice, person: me, at: new Date().toISOString() };
  if (done !== null) doneOf(client.id)[me] = { done, at: new Date().toISOString() };
  render();
  try {
    const res = await takeIn(client.id, marks, done, done ? othersWaiting(client) : null);
    busy.delete(client.id);
    if (res?.landing === false) {
      toast(`${clientLabel(client)} הופעל: כולם סיימו לעבור עליו.`);
      await load();
    } else render();
    return true;
  } catch (err) {
    busy.delete(client.id);
    intake.marks[client.id] = before.marks;
    intake.done[client.id] = before.done;
    render();
    toast(/not in landing/i.test(String(err?.message)) ? 'הלקוח כבר הופעל. מרעננים את הרשימה.' : `לא נשמר: ${errorText(err)}`);
    if (/not in landing/i.test(String(err?.message))) load();
    return false;
  }
}

const choose = (client, key, choice) => save(client, { [key]: choice });
async function finish(x, marks, said) {
  // What was not answered stays open, and is recorded so.
  const rest = Object.fromEntries(x.items.filter((i) => !i.choice && !(i.key in marks)).map((i) => [i.key, 'open']));
  openDone.delete(x.client.id);
  const ok = await save(x.client, { ...rest, ...marks }, true);
  if (ok && clients.some((c) => c.id === x.client.id && c.landing)) {
    toast(said, { label: 'ביטול', run: () => reopen(x.client) });
    $('land-h').focus?.();
  }
}
const reopen = (client) => save(client, {}, false);

// The office corrects the station, exactly as the import form marks it: everything
// before the station becomes imported history, and imported history from it on is
// taken back. Real marks stay.
async function fixStation(client, key) {
  const plan = stationPlan(client, checks[client.id] || {}, key);
  if (!plan || busy.has(client.id)) return;
  if (!plan.set.length && !plan.clear.length) { toast('הלקוח כבר בתחנה הזו.'); return; }
  busy.add(client.id);
  render();
  try {
    if (plan.clear.length) await clearChecksBulk(client.id, plan.clear);
    if (plan.set.length) await setChecksBulk(client.id, plan.set, 'done', IMPORT_NOTE);
    toast(`${clientLabel(client)}: התחנה תוקנה ל״${STATIONS.find((s) => s.key === key).title}״.`);
  } catch (err) {
    toast(`התחנה לא תוקנה: ${errorText(err)}`);
  }
  busy.delete(client.id);
  await load();
}

// ── Render ──────────────────────────────────
function choiceButtons(x, item) {
  const disabled = busy.has(x.client.id);
  return h('div', { class: 'land-choices', role: 'group', 'aria-label': item.label },
    ...CHOICES.filter((c) => !(c === 'na' && item.approval)).map((c) => h('button', {
      type: 'button', class: `land-choice c-${c}${item.choice === c ? ' is-on' : ''}`, 'aria-pressed': String(item.choice === c), disabled,
      'data-key': item.key, 'data-choice': c, onclick: () => choose(x.client, item.key, c),
    }, CHOICE_TEXT[c])));
}

// Whether the data itself says the client is further than the system has it.
const stationOff = (c, now) => { const ev = evidentStation(c, checks[c.id] || {}, now); return !!ev.why && ev.index !== ev.guessed; };

function stationRow(x, now) {
  const c = x.client;
  const cur = stationNow(c, checks[c.id] || {}, now);
  const ev = evidentStation(c, checks[c.id] || {}, now);
  const id = `land-st-${c.id}`;
  const select = h('select', { class: 'input land-st', id, 'aria-label': `התחנה של ${clientLabel(c)}` },
    ...STATIONS.map((s, i) => h('option', { value: s.key, selected: i === (ev.why ? ev.index : cur) }, s.title)));
  return h('div', { class: 'land-station' },
    h('label', { for: id }, ev.why && ev.index !== cur ? `${ev.why}. באיזו תחנה הלקוח באמת?` : 'התחנה לא נכונה? באיזו תחנה הלקוח באמת?'),
    h('div', { class: 'land-station-row' }, select,
      h('button', { type: 'button', class: 'btn btn-sm', disabled: busy.has(c.id), 'data-act': 'station', onclick: () => fixStation(c, select.value) }, 'תיקון התחנה')));
}

const answered = (x) => x.items.filter((i) => i.choice).length;

function clientCard(x, now) {
  const c = x.client;
  const cur = STATIONS[stationNow(c, checks[c.id] || {}, now)];
  const id = `land-${c.id}`;
  const off = busy.has(c.id);
  if (x.finished && !openDone.has(c.id)) {
    const open = x.items.filter((i) => i.choice !== 'done' && i.choice !== 'na').length;
    return h('li', { class: 'land-card is-finished', id, 'data-id': c.id },
      h('div', { class: 'land-fin' },
        h('span', { class: 'land-fin-name' }, h('span', { class: 'land-tick', 'aria-hidden': 'true' }, '✓'), clientLabel(c)),
        h('span', { class: 'muted' }, open ? `נקלט · ${open === 1 ? 'פריט אחד נשאר פתוח' : `${open} פריטים נשארו פתוחים`}` : 'נקלט · הכול כבר בוצע'),
        h('button', { type: 'button', class: 'btn-text land-undo', disabled: off, 'data-act': 'undo', onclick: () => { openItems.add(c.id); reopen(c); } }, 'ביטול')));
  }
  const p = x.proposal;
  const all = Object.fromEntries(x.items.map((i) => [i.key, 'done']));
  return h('li', { class: 'land-card', id, 'data-id': c.id },
    h('div', { class: 'land-head' },
      h('h2', {}, h('a', { href: clientUrl(c.id) }, clientLabel(c))),
      h('span', { class: 'tag' }, `לפי המערכת: ${cur.title}`),
      h('span', { class: 'muted' }, x.items.length === 1 ? 'פריט אחד שלך' : `${x.items.length} פריטים שלך`)),
    office() && stationOff(c, now) ? stationRow(x, now) : null,
    p ? h('div', { class: 'land-proposal' },
      h('p', {}, h('strong', {}, 'ההצעה: '), `${p.why}, ולכן ${p.done.length === 1 ? 'פריט אחד כבר בוצע' : `${p.done.length} פריטים כבר בוצעו`}${p.open.length ? ` ו${p.open.length === 1 ? 'אחד עדיין פתוח' : `־${p.open.length} עדיין פתוחים`}` : ''}.`),
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: off, 'data-act': 'accept',
        onclick: () => finish(x, { ...Object.fromEntries(p.done.map((k) => [k, 'done'])), ...Object.fromEntries(p.open.map((k) => [k, 'open'])) }, `${clientLabel(c)}: ההצעה התקבלה.`),
      }, 'לקבל את ההצעה ולסיים')) : null,
    // The two quick ways first; the items one by one are a tap away (a client can have dozens).
    h('div', { class: 'land-actions' },
      h('button', { type: 'button', class: 'btn', disabled: off, 'data-act': 'all', onclick: () => finish(x, all, `${clientLabel(c)}: הכול סומן ״כבר בוצע״.`) }, 'הכול כבר בוצע אצלי בלקוח הזה'),
      h('button', { type: 'button', class: p ? 'btn' : 'btn btn-primary', disabled: off, 'data-act': 'finish', onclick: () => finish(x, {}, `${clientLabel(c)} נקלט.`) }, answered(x) ? 'סיימתי עם הלקוח הזה' : 'הכול עדיין פתוח · סיימתי')),
    h('details', { class: 'land-more', open: openItems.has(c.id), ontoggle: (e) => { if (e.currentTarget.open) openItems.add(c.id); else openItems.delete(c.id); } },
      h('summary', { 'data-act': 'items' }, `פריט־פריט (${x.items.length})`, answered(x) ? h('span', { class: 'muted' }, ` · נענו ${answered(x)}`) : null),
      office() && !stationOff(c, now) ? stationRow(x, now) : null,
      h('ul', { class: 'land-items' }, ...x.items.map((i) => h('li', { class: `land-item${p?.done.includes(i.key) && !i.choice ? ' is-proposed' : ''}` },
        h('div', { class: 'land-item-text' }, h('span', { class: 'land-label' }, i.label), h('small', { class: 'muted' }, procText(i.proc),
          p?.done.includes(i.key) && !i.choice ? ' · ההצעה: כבר בוצע' : '')),
        choiceButtons(x, i))))));
}

function render() {
  const now = new Date();
  if (viewer?.error) { fill($('land-progress'), h('p', { class: 'muted' }, VIEWER_UNKNOWN)); fill($('land-list')); return; }
  if (!me) {
    fill($('land-progress'), h('p', {}, 'לבעלים אין פריטים לקלוט. מי סיים לקלוט וההפעלה נמצאים ב״מבט מנהל״. ', h('a', { href: 'owner.html#landing' }, 'למבט מנהל')));
    fill($('land-list'));
    return;
  }
  const list = intakeFor(me, clients, checks, intake.marks, intake.done, now);
  const left = intakeLeft(list);
  const total = list.length;
  if (!total) {
    fill($('land-progress'), h('p', { class: 'land-empty' }, 'אין לקוחות קיימים שמחכים לך. ', h('a', { href: 'clients.html#mine' }, 'חזרה להמשימות שלי')));
    fill($('land-list'));
    fill($('land-done'));
    return;
  }
  fill($('land-progress'),
    h('p', { class: 'land-count' }, left ? `נשארו ${left} מתוך ${total} לקוחות` : `סיימת: ${total} לקוחות נקלטו`, progressBar(total - left, total, 'לקוחות שנקלטו')),
    left ? null : h('p', { class: 'muted' }, 'לקוח יוצא מקליטה כשכל מי שיש לו בו עבודה סיים לעבור עליו, או כשהבעלים מפעילים. מה שנשאר פתוח יקבל אז מועד חדש, מיום ההפעלה. ',
      h('a', { href: 'clients.html#mine' }, 'חזרה להמשימות שלי')));
  fill($('land-list'), ...list.map((x) => clientCard(x, now)));
  fill($('land-done'));
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && viewer && !busy.size) load(); });

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  me = v.me && PEOPLE[v.me] && !PEOPLE[v.me].sales ? v.me : null;
  await load();
});
