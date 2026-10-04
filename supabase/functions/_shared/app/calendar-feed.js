// generated — edit app/ instead. Source: app/calendar-feed.js. Regenerate: node scripts/sync-functions.mjs
// The personal calendar feed ("היומן שלי"): what goes into one person's calendar,
// from the same protocol logic as the screens. Pure (no DOM, no Deno): the edge
// function supabase/functions/calendar builds the feed with it (a copy in
// supabase/functions/_shared/app), node tests it, and the card in "המשימות שלי"
// (app/calendar-card.js) takes the link helpers.
//
// Each person gets only their own work, and only on the clients they may see (the
// rule of private.my_clients() in 20260930130000_assignment_rls.sql, repeated in
// visibleTo below, because the function reads with the service role):
//   - shoot days (the main one and every round's): Lior, Eli, Irit, and the owner's
//     overview. Eli only in his window: 7 days back to 30 ahead, in Israel days;
//   - characterization meetings: whoever characterizes (Ofir by default), and the owner;
//   - the Zoom that approves the scripts (13, `p13.zoomat`): Lior;
//   - the due time of each open process that has an open item of theirs (the
//     editors' editing and closing, Ofir's quality control, Ilai's graphics…),
//     except the meeting and the shoot day themselves; a process waiting on the
//     client has no date (it moves with the wait, decision 3) and is left out;
//   - their open tasks with a due day (all-day);
//   - Ofir's Thursday summary (13:00, decision 20) and Lior's campaigns check on
//     Tuesday (decision 21), on business days.
// The address goes only to those who go there: Eli, Lior and Irit on a shoot day,
// and the characterizer at the meeting (Ofir or Lior). No phone number of a client
// is ever written into a feed, and no internal note: a title, a time, a place for
// those who need it, and a link to the card (which asks to sign in).
import { SHOOT_TYPES, PEOPLE } from './protocol.js';
import { clientState, itemsOf, isResolved, roundsOf, roundContext, parseDate, isImported, isBusinessDay, weekKey } from './protocol-logic.js';
import { dayKeyIL, addDaysIL, atTimeIL, weekdayIL, partsIL, startOfDayIL, dayFromKeyIL, TZ } from './tz.js';

const DAY = 864e5;
export const OWNER = 'owner';

// ── The link ──────────────────────────────
// The token is 32 random bytes in hex; the database keeps only its SHA-256
// (public.calendar_feed_rotate, migration 20260930200000_calendar_feeds.sql).
export const FEED_TOKEN = /^[0-9a-f]{64}$/;
export const FEED_PATH = '/functions/v1/calendar';
export const feedUrl = (supabaseUrl, token) => `${String(supabaseUrl).replace(/\/+$/, '')}${FEED_PATH}?t=${token}`;
export const webcalUrl = (httpsUrl) => String(httpsUrl).replace(/^https:\/\//, 'webcal://');
// Google Calendar on a computer: "add calendar from URL" with the address filled in.
export const googleAddUrl = (httpsUrl) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(httpsUrl))}`;
// The token of a request: ?t=…, or the last part of the path (…/calendar/<token>.ics).
export function tokenFrom(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const q = u.searchParams.get('t');
  const last = u.pathname.split('/').pop().replace(/\.ics$/i, '');
  const t = (q ?? last ?? '').toLowerCase();
  return FEED_TOKEN.test(t) ? t : null;
}

// ── Who gets what ─────────────────────────
export const SHOOT_PEOPLE = new Set(['lior', 'eli', 'irit', OWNER]);
export const ADDRESS_ON_SHOOT = new Set(['eli', 'lior', 'irit']);
export const ADDRESS_ON_MEETING = new Set(['ofir', 'lior']);
const OFFICE = new Set([OWNER, 'irit', 'lior', 'ofir', 'ilai']);
export const PAST_DAYS = 30;
export const AHEAD_DAYS = 180;
export const ELI_BACK = 7;
export const ELI_AHEAD = 30;
const LIVE = new Set(['active', 'ending']);

// Where the links in the events open (the site; docs/ops.md, section 8 when it moves).
export const SITE = 'https://app.astrateg.tech/';
const cardUrl = (site, id, hash = '') => `${site}client.html?id=${encodeURIComponent(id)}${hash}`;

// The client and each extra shoot round: its context, item prefix, process prefix and number.
export function contextsOf(client) {
  return [{ ctx: client, pre: '', pid: '', n: 1 },
    ...roundsOf(client).map((r) => ({ ctx: roundContext(client, r), pre: `r${r.n}.`, pid: `r${r.n}-`, n: Number(r.n) }))];
}

// A shoot day in Eli's window (private.shoot_in_window): 7 Israel days back to 30 ahead.
function inEliWindow(at, now) {
  if (!at) return false;
  const d = Math.round((dayFromKeyIL(dayKeyIL(at)) - dayFromKeyIL(dayKeyIL(now))) / DAY);
  return d >= -ELI_BACK && d <= ELI_AHEAD;
}

// Whether `person` may see the client, as the database decides for them.
export function visibleTo(person, client, tasks = [], now = new Date()) {
  if (OFFICE.has(person)) return true;
  if (!PEOPLE[person] || person === 'editor') return false;
  if (client.editor === person || roundsOf(client).some((r) => r.editor === person)) return true;
  const recent = now.getTime() - 30 * DAY;
  if (tasks.some((t) => t.client_id === client.id && t.owner === person && (!t.done_at || new Date(t.done_at).getTime() > recent))) return true;
  if (person === 'nirel' && client.shoot_type === 'natali') return true;
  if (person === 'eli') return contextsOf(client).some((x) => inEliWindow(parseDate(x.ctx.shoot_at), now));
  return false;
}

const hm = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const latest = (...ds) => {
  const t = ds.map((d) => (d ? new Date(d).getTime() : NaN)).filter(Number.isFinite);
  return t.length ? new Date(Math.max(...t)) : null;
};
const isEndOfDay = (d) => { const p = partsIL(d); return p.hour === 23 && p.minute === 59; };
// Shoot-day length: the team an hour before the influencers, then 3 hours with
// Natali (process 20) or 5.5 with Denis, Michel and Semion (21).
export const shootMinutes = (type) => 60 + (type === 'dms' ? 330 : 180);
const DEADLINE_MIN = 30;
// Not a deadline of its own in the feed: the meeting and the shoot day (in every
// round) are events already.
const SKIP_DEADLINE = new Set(['p04', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21']);

// Every event of `person` ('owner' for the owner). `checks`: { clientId: { key: check } };
// `tasks`: client_tasks rows (at least the person's open ones and those finished in
// the last 30 days, for who sees what).
export function feedEvents({ person, clients = [], checks = {}, tasks = [], now = new Date(), site = SITE }) {
  const from = now.getTime() - PAST_DAYS * DAY;
  const until = now.getTime() + AHEAD_DAYS * DAY;
  const inRange = (d) => !!d && d.getTime() >= from && d.getTime() <= until;
  const out = [];
  const isOwner = person === OWNER;
  for (const c of clients) {
    if (!LIVE.has(c.status) || !visibleTo(person, c, tasks, now)) continue;
    const cs = checks[c.id] || {};

    // The characterization meeting.
    const charAt = parseDate(c.char_at);
    const characterizer = c.characterizer || 'ofir';
    if (inRange(charAt) && (isOwner || person === characterizer)) {
      out.push({
        uid: `char-${c.id}@astrateg`, kind: 'char', title: `פגישת אפיון · ${c.name}`, start: charAt, minutes: 120,
        location: ADDRESS_ON_MEETING.has(person) ? c.address || '' : '',
        description: [`מבצע/ת האפיון: ${PEOPLE[characterizer]?.name || ''}`, `כרטיס הלקוח: ${cardUrl(site, c.id, '#p04')}`].join('\n'),
        changedAt: c.updated_at || c.created_at,
      });
    }

    for (const x of contextsOf(c)) {
      const round = x.n > 1 ? ` ${x.n}` : '';
      // The shoot day.
      const shootAt = parseDate(x.ctx.shoot_at);
      const shootOk = SHOOT_PEOPLE.has(person) && (person !== 'eli' || inEliWindow(shootAt, now));
      if (shootAt && shootOk && inRange(shootAt)) {
        const type = x.ctx.shoot_type;
        out.push({
          uid: `shoot-${c.id}-${x.n}@astrateg`, kind: 'shoot',
          title: `יום צילום${round} · ${c.name}${SHOOT_TYPES[type] ? ` · ${SHOOT_TYPES[type].name}` : ''}`,
          start: new Date(shootAt.getTime() - 36e5), minutes: shootMinutes(type),
          location: ADDRESS_ON_SHOOT.has(person) ? c.address || '' : '',
          description: [`הגעת המשפיענים: ${hm.format(shootAt)}. הצוות מגיע שעה לפני.`, `כרטיס הלקוח: ${cardUrl(site, c.id)}`].join('\n'),
          changedAt: c.updated_at || c.created_at,
        });
      }
      // The Zoom that approves the scripts (13): Lior's.
      // Not when the Zoom is no longer needed (the client approved the scripts on the
      // status page: p13.zoom 'na', docs/ops.md section 17).
      const zoom = cs[`${x.pre}p13.zoomat`];
      const zoomAt = zoom?.state === 'done' && cs[`${x.pre}p13.zoom`]?.state !== 'na' ? parseDate(zoom.note) : null;
      if (person === 'lior' && inRange(zoomAt)) {
        out.push({
          uid: `zoom-${c.id}-${x.n}@astrateg`, kind: 'zoom', title: `זום לאישור התסריטים${round} · ${c.name}`, start: zoomAt, minutes: 60,
          description: `כרטיס הלקוח: ${cardUrl(site, c.id, `#${x.pid}p13`)}`, changedAt: zoom.at,
        });
      }
    }

    // Due times of the open processes that have an open item of theirs.
    if (!isOwner) {
      const s = clientState(c, cs, now);
      for (const st of s.states) {
        const base = st.proc.id.replace(/^r\d+-/, '');
        if (st.proc.recurring || st.complete || st.status === 'client' || !st.dueAt || !inRange(st.dueAt)) continue;
        if (SKIP_DEADLINE.has(base) || isImported(st.proc, cs)) continue;
        const mine = itemsOf(person, st).filter((i) => !i.optional && !isResolved(i, cs[i.key], now));
        if (!mine.length) continue;
        const round = st.proc.ctx?.round ? ` · סבב ${st.proc.ctx.round}` : '';
        const title = `יעד: ${st.proc.num} ${st.proc.title}${round} · ${c.name}`;
        const changedAt = latest(c.updated_at, ...st.proc.items.map((i) => cs[i.key]?.at));
        const list = mine.slice(0, 5).map((i) => `• ${i.label}`);
        if (mine.length > 5) list.push(`ועוד ${mine.length - 5}`);
        const description = [...list, `כרטיס הלקוח: ${cardUrl(site, c.id, `#${st.proc.id}`)}`].join('\n');
        const uid = `due-${c.id}-${st.proc.id}-${person}@astrateg`;
        if (isEndOfDay(st.dueAt)) out.push({ uid, kind: 'due', title, allDay: dayKeyIL(st.dueAt), description, changedAt });
        else out.push({ uid, kind: 'due', title, start: new Date(st.dueAt.getTime() - DEADLINE_MIN * 6e4), end: st.dueAt, description, changedAt });
      }
    }
  }

  // Their open tasks with a due day.
  const byId = new Map(clients.map((c) => [c.id, c]));
  for (const t of tasks) {
    const c = byId.get(t.client_id);
    if (t.owner !== person || t.done_at || !t.due_on || !c || !LIVE.has(c.status)) continue;
    const day = dayFromKeyIL(t.due_on);
    if (!inRange(day)) continue;
    out.push({
      uid: `task-${t.id}@astrateg`, kind: 'task', title: `${t.urgent ? 'דחוף: ' : 'משימה: '}${t.title} · ${c.name}`, allDay: t.due_on,
      description: `כרטיס הלקוח: ${cardUrl(site, c.id, '#tasks')}`, changedAt: latest(t.created_at, t.started_at),
    });
  }

  // Recurring work of the office, on business days, from this week for 8 weeks.
  const sunday = startOfDayIL(addDaysIL(atTimeIL(now, 12), -weekdayIL(now)));
  for (let w = 0; w < 8; w += 1) {
    const week = addDaysIL(atTimeIL(sunday, 12), 7 * w);
    if (person === 'ofir') {
      const thu = addDaysIL(week, 4);
      if (isBusinessDay(thu)) {
        const due = atTimeIL(thu, 13);
        out.push({
          uid: `thursday-${weekKey(thu)}-ofir@astrateg`, kind: 'weekly', title: 'סיכום חמישי: יעד 13:00',
          start: new Date(due.getTime() - DEADLINE_MIN * 6e4), end: due, description: `הסיכום: ${site}pass.html`,
        });
      }
    }
    if (person === 'lior') {
      const tue = addDaysIL(week, 2);
      if (isBusinessDay(tue)) {
        out.push({ uid: `campaigns-${dayKeyIL(tue)}-lior@astrateg`, kind: 'weekly', title: 'בדיקת קמפיינים שבועית', allDay: dayKeyIL(tue), description: '' });
      }
    }
  }
  const at = (e) => (e.allDay ? dayFromKeyIL(e.allDay).getTime() : new Date(e.start).getTime());
  return out.sort((a, b) => at(a) - at(b) || a.uid.localeCompare(b.uid));
}

// The calendar's name in the person's app.
export const feedName = (person) => (person === OWNER ? 'אסטרטג · הבעלים' : `אסטרטג · ${PEOPLE[person]?.name || ''}`);
