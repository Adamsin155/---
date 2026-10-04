// generated — edit app/ instead. Source: app/protocol-versions.js. Regenerate: node scripts/sync-functions.mjs
// Protocol versions per client (plan stage 5: "פריט חדש לא מסמן לקוחות קיימים
// כ'באיחור'"). Each client records the protocol version it started under
// (clients.protocol_version, stamped by the database at insert; see
// supabase/migrations/20260930190000_year.sql). For a client that started under an
// older version:
//  - items added in a later version are "חדש בפרוטוקול" (`fresh`): they stay in the
//    card and in the work lists as work to do, but they never make their process
//    late (clientState counts lateness only on the items the client started with);
//  - a deadline a later version made shorter never makes it late either: its due
//    date is the later of the one it started under and the current one;
//  - a process whose timing a later version replaced as a whole (`replace`: v6 moved
//    the shoot day to right after the group) keeps the start and due it started under.
// Nothing else changes for it: what needs what, who owns it and completion are as
// in the current protocol.
//
// PROTOCOL_HISTORY is also what the office reads as "מה השתנה" (year.html). When
// PROTOCOL_VERSION in protocol.js goes up: add its entry here with the item keys it
// added (`items`) and the due specs it changed (`due`: the spec before), and raise
// private.protocol_version_current() and the default of clients.protocol_version in
// a migration. tests/protocol-versions.test.mjs and tests/sql/year.test.mjs fail
// until they agree.
import { PROCESSES, PROTOCOL_VERSION } from './protocol.js';

export const PROTOCOL_HISTORY = [
  {
    version: 1, date: '2026-09-29', title: 'הפרוטוקול הראשון במערכת',
    changes: ['35 התהליכים של הפרוטוקול הכללי, פריט אחרי פריט, עם אחראי ומועד לכל אחד.'],
  },
  {
    version: 2, date: '2026-09-29', since: '2026-09-29T13:27:55Z', title: 'מיזוג הפרוטוקולים של העובדים',
    changes: [
      'נוספו שיחת הדגשים (12א) ושיוך העורך (22א).',
      'בדיקות מפורטות: קבלת הכונן ובדיקה עצמית של העורך, בקרת האיכות של אופיר על הסרטונים ועל הגרפיקות.',
      'זמני העריכה נספרים משיוך העורך: 3 ימי עסקים, וסגירת התיקונים ביום הרביעי.',
      'נוספו בדיקות לעירית (מעקב אחרי האפיון, יום לפני הצילום, שיוך העורך) ולליאור (עסקה חריגה, Meta, חידוש).',
    ],
    items: [
      'p02.deal', 'p02.team', 'p03.available', 'p03.calendar', 'p04.followup', 'p04.tasks', 'p05.vault', 'p08.saved',
      'p10.c.business', 'p10.c.ads', 'p10.c.page', 'p10.c.ig', 'p10.c.links', 'p10.c.perms',
      'p12a.read', 'p12a.call', 'p12a.t.services', 'p12a.t.products', 'p12a.t.messages', 'p12a.t.dont', 'p12a.t.offers',
      'p12a.t.faq', 'p12a.t.topics', 'p12a.t.objections', 'p12a.t.advantages', 'p12a.t.focus',
      'p12.numbered', 'p14.delays', 'p15.irit', 'p16.plan', 'p16.early', 'p16.open', 'p17.handdrive', 'p17.plan', 'p19.all',
      'p22a.drive', 'p22a.load', 'p22a.assigned', 'p22a.irit',
      'p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone',
      'p22.self.spelling', 'p22.self.broll', 'p22.self.closing', 'p22.self.complete',
      'p23.q.design', 'p23.q.errors', 'p23.q.logo', 'p23.q.contact', 'p23.q.match', 'p23.q.pro', 'p23.q.variety',
      'p25.q.editing', 'p25.q.errors', 'p25.q.clear', 'p25.q.match', 'p25.q.pro', 'p25.q.fit',
      'p27.notes', 'p27.final', 'p27.toilai', 'p34.state', 'p34.problems', 'p35.drive', 'p35.system',
    ],
    // The due dates before version 2.
    due: {
      p22: { from: 'shoot', businessDays: 5 },
      p24: { from: 'p22' },
      p27: { from: 'p26', businessDays: 1 },
    },
  },
  {
    version: 3, date: '2026-09-29', since: '2026-09-29T14:04:17Z', title: 'שיראל הוסרה מהפרוטוקול',
    changes: ['העבודה של שיראל עברה לליאור (החלטה 33), והכספת נפתחה לניראל בלקוחות שלה.'],
  },
  {
    version: 4, date: '2026-09-29', since: '2026-09-29T16:00:54Z', title: 'הפרוטוקול של הצלם',
    changes: ['נוספו התהליכים של אלי ביום הצילום: הגעה ובי־רול (17ב), צילום לפי הסדר (18ב) וסידור הכונן ומסירה (19ב).'],
    items: [
      'p17b.arrived', 'p17b.drive', 'p17b.gear', 'p17b.zones', 'p17b.broll', 'p17b.variety',
      'p18b.order', 'p18b.quality', 'p18b.numbered',
      'p19b.folders', 'p19b.complete', 'p19b.opens', 'p19b.cards', 'p19b.handed', 'p19b.notes',
    ],
  },
  {
    version: 5, date: '2026-09-30', title: 'זרימות המשרד והאפיון',
    changes: [
      '"האפיון הסתיים" מפעיל את השעונים, ושאר טופס האפיון תוך 60 דקות (החלטה 12).',
      'התסריטים עד סוף יום העסקים השני, והזום ביום השלישי (החלטה 14).',
      '"הגאנט מלא" מודיע לעירית לבד; הפריט "עודכנה עירית" הוסר מתהליך 29.',
      '"קיבלתי" של עילאי על הגרסאות הסופיות סוגר את העריכה.',
    ],
    // The due dates before version 5.
    due: {
      p04: { from: 'char', hours: 2 },
      p12: { from: 'char', businessDays: 3 },
    },
  },
  {
    version: 6, date: '2026-10-03', title: 'יום הצילום מיד אחרי פתיחת הקבוצה, העלאת גרפיקות שאושרו',
    changes: [
      'יום הצילום (11, ו־11ב של נטלי) נקבע מיד אחרי פתיחת קבוצת ה־WhatsApp, עד סוף יום העסקים הבא, ועבר לתחנת ההצטרפות.',
      'נוספו 7ב ו־23ב: עילאי מעלה לרשתות את הגרפיקות שהלקוח אישר, תוך 30 דקות עבודה.',
      'אישור הלקוח על יתרת הגרפיקות (23) הוא עכשיו גם פריט שעירית יכולה לסמן.',
    ],
    items: ['p07b.posted', 'p23.approved', 'p23b.posted'],
    // A new way of working, not a shorter deadline: a client that started before keeps
    // the whole old timing of 11 (start and due).
    replace: {
      p11: { start: { from: 'charEnd' }, due: { from: 'char', businessDays: 3 } },
    },
  },
];

export const LATEST = PROTOCOL_HISTORY.at(-1).version;

const SINCE = new Map();
for (const v of PROTOCOL_HISTORY) for (const k of v.items || []) SINCE.set(k, v.version);
// The version an item key (a round's too: `r2.p12a.read`) was added in; 1 for the first protocol.
export const itemSince = (key) => SINCE.get(String(key).replace(/^r\d+\./, '')) || 1;

// The database stamps the version from version 5 on (migration 20260930190000). Before
// it, every row read 1 (the column's old default); the migration sets those rows by
// when they were opened against `since` (when each version reached the main branch),
// never above 4. versionOf reads an unstamped row the same way, so the screens agree
// before and after the migration.
export const STAMPED_FROM = 5;
export function versionAt(createdAt) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 1;
  let v = 1;
  for (const x of PROTOCOL_HISTORY) if (x.since && x.version < STAMPED_FROM && t >= Date.parse(x.since)) v = x.version;
  return v;
}

// The version a client started under. A client without one (not loaded) is read as
// the current version: nothing changes for it.
export function versionOf(client) {
  const v = Number(client?.protocol_version);
  if (!Number.isInteger(v) || v < 1 || v > PROTOCOL_VERSION) return PROTOCOL_VERSION;
  return v === 1 && client.created_at ? versionAt(client.created_at) : v;
}
export const isOlderClient = (client) => versionOf(client) < PROTOCOL_VERSION;

// The timing a later version replaced as a whole ({ start, due }) for base process
// `id`, as the client started under it (null: not replaced since).
export function timingStartedUnder(id, version) {
  for (const v of PROTOCOL_HISTORY) {
    if (v.version > version && v.replace?.[id]) return v.replace[id];
  }
  return null;
}

// The due spec a client started under for base process `id` (null: unchanged since).
export function dueStartedUnder(id, version) {
  for (const v of PROTOCOL_HISTORY) {
    if (v.version > version && v.due?.[id]) return v.due[id];
  }
  return null;
}

const ROUND_IDS = new Set(PROCESSES.filter((p) => p.round).map((p) => p.id));
// A due spec as it reads inside shoot round n (as applicableProcesses shifts them).
function shiftSpec(spec, n) {
  if (!spec || !n) return spec;
  if (ROUND_IDS.has(spec.from)) return { ...spec, from: `r${n}-${spec.from}` };
  const item = /^item:(p\d+[a-z]?)\./.exec(spec.from);
  if (item && ROUND_IDS.has(item[1])) return { ...spec, from: `item:r${n}.${spec.from.slice(5)}` };
  return spec;
}

// The client's processes (applicableProcesses) with what it started under: items
// added later marked `fresh` (the version that added them), and `dueBefore` where a
// later version changed the deadline. Unchanged for a client on the current version.
export function adjustForVersion(procs, client) {
  const v = versionOf(client);
  if (v >= PROTOCOL_VERSION) return procs;
  return procs.map((p) => {
    const round = Number(/^r(\d+)-/.exec(p.id)?.[1] || 0);
    const base = p.id.replace(/^r\d+-/, '');
    const before = dueStartedUnder(base, v);
    const timing = timingStartedUnder(base, v);
    let fresh = false;
    const items = p.items.map((i) => {
      const since = itemSince(i.key);
      if (since <= v) return i;
      fresh = true;
      return { ...i, fresh: since };
    });
    if (!fresh && !before && !timing) return p;
    return {
      ...p, items,
      ...(before ? { dueBefore: shiftSpec(before, round) } : {}),
      ...(timing ? { start: shiftSpec(timing.start, round), due: shiftSpec(timing.due, round), timingBefore: true } : {}),
    };
  });
}

// The later of two deadlines (null when neither is known).
export const laterDue = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);

// Words for a fresh item (the card's tag).
export const freshText = (since) => `חדש בפרוטוקול (גרסה ${since}) · לא נספר באיחור`;
