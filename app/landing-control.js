// The owners' control of the landing (owner.html; docs/ops.md, section 41): how many
// clients are still in landing, who finished going over how many, and the "מפעילים"
// actions: the clients nobody has to go over, the clients with a shoot day in the
// coming two weeks, one person, or everyone. Only the owners activate
// (public.landing_activate and public.landing_done_for check it); the card is drawn
// for them alone and disappears when no client is in landing.
import { PEOPLE } from './protocol.js';
import { clientLabel } from './protocol-logic.js';
import { fill, h, errorText, progressBar, formatDay } from './protocol-ui.js';
import { loadIntake, activate, finishFor } from './landing-data.js';
import { landingBoard, waitingPeople, shootSoon, SHOOT_SOON_DAYS } from './landing-logic.js';

const names = (list, max = 3) => {
  const all = list.map((c) => clientLabel(c));
  return all.length > max ? `${all.slice(0, max).join(', ')} ועוד ${all.length - max}` : all.join(', ');
};
const clientsWord = (n) => (n === 1 ? 'לקוח אחד' : `${n} לקוחות`);

// mountLandingControl(el, { clients, checks, reload, toast }): `clients` and `checks`
// are getters of what the page already loaded; `reload` loads the page again after
// an activation. Returns { refresh }.
export function mountLandingControl(el, { clients, checks, reload, toast }) {
  let intake = { marks: {}, done: {}, ready: false };
  let armed = null; // the action waiting for its second tap
  let working = false;

  async function run(label, fn) {
    if (working) return;
    working = true;
    armed = null;
    draw();
    try {
      const n = await fn();
      toast(`${label}: ${n ? `${clientsWord(n)} יצאו מקליטה. המועדים נספרים מעכשיו.` : 'אף לקוח לא יצא מקליטה עדיין.'}`);
    } catch (err) {
      toast(`לא בוצע: ${errorText(err)}`);
    }
    working = false;
    await reload();
    await refresh();
  }

  // One person: their part is closed on the clients they did not go over (what they
  // left unanswered stays open), and every client that then waits for nobody is activated.
  const activatePerson = (row) => run(`מפעילים את ${PEOPLE[row.key].name}`, async () => {
    const ids = row.left.map((c) => c.id);
    await finishFor(row.key, ids);
    const now = new Date();
    const free = row.left.filter((c) => !waitingPeople(c, checks()[c.id] || {}, intake.marks[c.id] || {}, { ...(intake.done[c.id] || {}), [row.key]: { done: true } }, now).length);
    return free.length ? activate(free.map((c) => c.id)) : 0;
  });

  // Two taps: the first asks, the second does.
  const button = (id, text, sure, act) => h('button', {
    type: 'button', class: armed === id ? 'btn btn-sm btn-primary' : 'btn btn-sm', disabled: working, 'data-act': id,
    onclick: () => { if (armed === id) act(); else { armed = id; draw(); } },
  }, armed === id ? sure : text);

  function draw() {
    const now = new Date();
    const b = landingBoard(clients(), checks(), intake.marks, intake.done, now);
    el.hidden = !b.total;
    if (!b.total) { fill(el); return; }
    fill(el,
      h('h2', { id: 'landing-h' }, 'קליטת הלקוחות הקיימים'),
      h('p', {}, `${clientsWord(b.total)} בקליטה: בלי שעונים, בלי איחורים ובלי התראות, עד שמפעילים. `,
        'כשמפעילים לקוח, מה שנשאר בו פתוח מקבל מועד חדש שנספר מרגע ההפעלה.'),
      h('ul', { class: 'land-ctl-rows' },
        ...b.people.map((r) => h('li', { class: 'land-ctl-row', 'data-person': r.key },
          h('span', { class: 'land-ctl-text' }, h('strong', {}, PEOPLE[r.key].name), ` · עבר/ה על ${r.finished} מתוך ${r.total}`,
            r.alone.length ? ` · ${clientsWord(r.alone.length)} מחכים רק לו/ה` : ''),
          progressBar(r.finished, r.total, `${PEOPLE[r.key].name}: לקוחות שנקלטו`),
          r.left.length ? button(`person:${r.key}`, `מפעילים את ${PEOPLE[r.key].name}`, `בטוח? ${clientsWord(r.left.length)}`, () => activatePerson(r)) : h('span', { class: 'muted' }, 'סיים/ה')))),
      h('p', { class: 'land-ctl-note' }, '״מפעילים את…״ סוגר את החלק של אותו עובד בלקוחות שעוד לא עבר עליהם (מה שלא סימן נשאר פתוח). לקוח יוצא מקליטה כשאף אחד כבר לא צריך לעבור עליו.'),
      h('ul', { class: 'land-ctl-rows' },
        b.ready.length ? h('li', { class: 'land-ctl-row' },
          h('span', { class: 'land-ctl-text' }, h('strong', {}, `מוכנים להפעלה: ${b.ready.length}`), ` · אין בהם מה לקלוט, או שכולם סיימו · ${names(b.ready)}`),
          button('ready', `מפעילים ${clientsWord(b.ready.length)}`, 'בטוח? מפעילים', () => run('מוכנים להפעלה', () => activate(b.ready.map((c) => c.id))))) : null,
        b.soon.length ? h('li', { class: 'land-ctl-row' },
          h('span', { class: 'land-ctl-text' }, h('strong', {}, `יום צילום ב־${SHOOT_SOON_DAYS} הימים הקרובים: ${b.soon.length}`),
            ` · ${b.soon.slice(0, 3).map((c) => `${clientLabel(c)} (${formatDay(shootSoon(c, now))})`).join(', ')}${b.soon.length > 3 ? ` ועוד ${b.soon.length - 3}` : ''}`,
            ' · הם מופיעים במסכי ימי הצילום כרגיל, אבל התזכורות שלהם כבויות עד ההפעלה.'),
          button('soon', 'מפעילים אותם', 'בטוח? מפעילים', () => run('ימי צילום קרובים', () => activate(b.soon.map((c) => c.id))))) : null,
        h('li', { class: 'land-ctl-row' },
          h('span', { class: 'land-ctl-text' }, h('strong', {}, 'כל הלקוחות שבקליטה'), ` · ${b.total}`),
          button('all', 'מפעילים את כולם', `בטוח? ${clientsWord(b.total)}`, () => run('מפעילים את כולם', () => activate(b.clients.map((c) => c.id)))))),
      intake.ready ? null : h('p', { class: 'land-ctl-note' }, 'מסך הקליטה של העובדים עוד לא זמין (המיגרציה של הקליטה לא הוחלה).'));
  }

  async function refresh() {
    if ((clients() || []).some((c) => c.landing === true)) intake = await loadIntake();
    draw();
  }
  refresh();
  return { refresh };
}
