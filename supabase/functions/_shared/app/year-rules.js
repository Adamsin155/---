// generated — edit app/ instead. Source: app/year-rules.js. Regenerate: node scripts/sync-functions.mjs
// Reminder rules of the package year (stage 5), appended to RULES in
// app/reminder-rules.js and run by the same engine (app/reminder-engine.js).
//  - The monthly cycle is a draft (decision 31), so it stays gentle: a digest line
//    when a month starts, one ring a day per person only for the items due that day,
//    and a digest line the morning after an item's due date. No escalation.
//  - Renewals (station 8): digest lines 90, 60 and 30 days before the contract ends
//    to Lior and the owner (next to the existing 75/60/45 ladder of rule `renewal`,
//    without doubling its lines), and one ring to Lior when process 34 has not
//    started by its day, 60 days before the end.
// Rows of this module have no process ref (reminder_log.ref takes only pNN keys),
// except the renewal's, which is process 34.
import { parseDate, clientLabel } from './protocol-logic.js';
import { openMonthItems, groupMarks, monthOf, cycleFrom, monthItems } from './year-logic.js';
import { partsIL, dayKeyIL, atTimeIL } from './tz.js';

const OWNER = 'owner';
const YEAR_URL = 'year.html';
const cardUrl = (id) => `client.html?id=${encodeURIComponent(id)}#month`;
const short = (list, max = 3) => (list.length > max ? `${list.slice(0, max).join(', ')} ועוד ${list.length - max}` : list.join(', '));
const dmy = (d) => { const p = partsIL(d); return `${p.day}.${p.month}.${p.year}`; };

// The month marks of every client, grouped once per tick (env.monthMarks: rows).
const grouped = new WeakMap();
const marksOf = (env, c) => {
  if (!grouped.has(env)) grouped.set(env, groupMarks(env.monthMarks || []));
  return grouped.get(env)[c.id] || {};
};
const active = (env) => env.clients.filter((c) => c.status === 'active');
// Open cycle items of every active client (null person: everyone's).
function openItems(env, person = null) {
  const out = [];
  for (const c of active(env)) out.push(...openMonthItems(person, c, env.stateOf(c), env.checksOf(c), marksOf(env, c), env.now));
  return out;
}
const WHO = ['irit', 'lior', 'ofir', 'ilai'];

export const YEAR_RULES = [
  // A new month of the cycle: one digest line to each owner with items in it.
  {
    id: 'monthStart', event: 'מחזור חודשי (טיוטה): חודש חדש', procs: [],
    instances(env) {
      const out = [];
      for (const c of active(env)) {
        const m = monthOf(c, env.now);
        const from = cycleFrom(c, env.stateOf(c));
        if (!m || m.over || from === null || m.n < from) continue;
        const items = monthItems(c, m.n, { from });
        for (const person of WHO) {
          const mine = items.filter((i) => i.owner === person);
          if (!mine.length) continue;
          out.push({ id: `m${m.n}.${person}`, cid: c.id, client: c, name: clientLabel(c), person, n: m.n, count: mine.length, url: cardUrl(c.id), anchors: { event: m.start } });
        }
      }
      return out;
    },
    steps: [
      { id: 'digest', at: '08:30', to: (i) => i.person, level: 'digest', title: (i) => `חודש ${i.n} התחיל: ${i.name} · ${i.count === 1 ? 'פריט אחד' : `${i.count} פריטים`} במחזור החודשי (טיוטה)`, body: () => '' },
    ],
  },

  // Items due today: one ring a day per person, at 10:00, for all of them together.
  {
    id: 'monthDay', event: 'מחזור חודשי (טיוטה): פריטים להיום', procs: [],
    instances(env) {
      const out = [];
      const day = dayKeyIL(env.now);
      for (const person of WHO) {
        const list = openItems(env, person).filter((i) => dayKeyIL(i.dueAt) === day);
        if (!list.length) continue;
        out.push({ id: `${person}@${day}`, cid: null, person, list, url: 'clients.html#mine', anchors: { event: atTimeIL(env.now, 0) } });
      }
      return out;
    },
    steps: [
      {
        id: 'ring', at: '10:00', to: (i) => i.person, level: 'ring',
        title: (i) => (i.list.length === 1 ? `היום במחזור החודשי: ${clientLabel(i.list[0].client)}` : `היום במחזור החודשי: ${i.list.length} פריטים`),
        body: (i) => `${i.list.length === 1 ? i.list[0].label : short([...new Set(i.list.map((x) => clientLabel(x.client)))])}. טיוטה, עד שיהיה פרוטוקול כתוב.`,
      },
    ],
  },

  // An item past its due date: a digest line the next business morning. No escalation.
  {
    id: 'monthLate', event: 'מחזור חודשי (טיוטה): באיחור', procs: [],
    instances(env) {
      return openItems(env).filter((i) => i.status === 'overdue').map((i) => ({
        id: `m${i.month}.${i.key}`, cid: i.client.id, client: i.client, name: clientLabel(i.client), item: i, url: cardUrl(i.client.id), anchors: { event: i.dueAt },
      }));
    },
    steps: [
      { id: 'digest', businessDays: 1, at: '08:30', to: (i) => i.item.owner, level: 'digest', overdue: true, title: (i) => `באיחור במחזור החודשי: ${i.name} · ${i.item.label}`, body: () => 'טיוטה, עד שיהיה פרוטוקול כתוב.' },
    ],
  },

  // Renewals: the 90-day list. Lior and the owner, 90, 60 and 30 days before the end.
  {
    id: 'renewalList', event: 'חידוש (34): רשימת 90 הימים', procs: ['p34'],
    instances(env) {
      const out = [];
      for (const c of active(env)) {
        const end = parseDate(c.contract_end);
        const s = env.stateOf(c).states.find((x) => x.proc.id === 'p34');
        if (!end || !s || s.complete) continue;
        const checks = env.checksOf(c);
        const resolved = (k) => ['done', 'na'].includes(checks[k]?.state);
        out.push({
          id: `p34@${c.contract_end}`, cid: c.id, client: c, name: clientLabel(c), ref: 'p34', url: `${YEAR_URL}#renewals`,
          started: s.proc.items.some((it) => resolved(it.key)), talked: resolved('p34.talk'), waiting: !!s.wait,
          anchors: { event: end, start: s.dueAt ? atTimeIL(s.dueAt, 0) : null },
        });
      }
      return out;
    },
    steps: [
      { id: 'd90', days: -90, at: '08:30', to: 'lior', level: 'digest', title: (i) => `חידוש בעוד 90 יום: ${i.name}`, body: (i) => `החוזה מסתיים ב־${dmy(i.anchors.event)}. סיכום התוצאות והצעת החידוש בשנת החבילה.` },
      { id: 'd90', days: -90, at: '08:30', to: OWNER, level: 'digest', title: (i) => `חידוש בעוד 90 יום: ${i.name}`, body: (i) => `החוזה מסתיים ב־${dmy(i.anchors.event)}.` },
      // Lior's 60-day line comes from rule `renewal` (75/60/45).
      { id: 'd60', days: -60, at: '08:30', to: OWNER, level: 'digest', title: (i) => `חידוש בעוד 60 יום: ${i.name}`, body: (i) => (i.started ? 'ליאור התחיל את תהליך 34.' : 'תהליך 34 עוד לא התחיל.') },
      // Process 34 not started on its day: one ring to Lior.
      { id: 'start', from: 'start', at: '12:00', to: 'lior', level: 'ring', when: (i) => !i.started && !i.waiting, title: (i) => `החידוש לא התחיל, 60 יום לפני הסיום: ${i.name}`, body: () => 'לפתוח את תהליך 34: מצב ותוצאות, שביעות רצון, ולהתחיל לדבר על ההמשך. הסיכום והצעת החידוש בשנת החבילה.' },
      { id: 'd30', days: -30, at: '08:30', to: 'lior', level: 'digest', title: (i) => `חידוש בעוד 30 יום: ${i.name}`, body: (i) => (i.talked ? 'נרשמה שיחת חידוש.' : 'עוד לא נרשמה שיחת חידוש.') },
      // Without a renewal call the owner gets rule `renewal`'s immediate ring instead.
      { id: 'd30', days: -30, at: '08:30', to: OWNER, level: 'digest', when: (i) => i.talked, title: (i) => `חידוש בעוד 30 יום: ${i.name}`, body: () => 'נרשמה שיחת חידוש.' },
    ],
  },
];
