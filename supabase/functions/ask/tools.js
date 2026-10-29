// The ask function's tools (docs/ops.md, section 74): what Claude may read to answer a question,
// all of it read-only and all of it through the database client of the person who asked (their
// own JWT: row level security answers exactly what their screens answer). Plain JavaScript, so
// node tests it whole (tests/ask.test.mjs).
//
// Three walls, on top of the database's own:
//   1. the tables: `guardDb` lets a tool read only the tables in TABLES. The vault and the
//      clients' logins (client_access, its links and logs, the vault code) are not there, and
//      there is no rpc at all: no tool can ask for a password, nor whether one is in place;
//   2. the columns: every read names its columns (never "*"); a client's notes, phone, email and
//      address are not read (the notes are free text, where anything may have been written);
//   3. money: prices, quote amounts and income only when public.sees_money() (the two owners).
//      The sales tool asks for money columns only then, and `withoutMoney` takes every money
//      field out of anything a tool returns to anyone else, as a last net.
// Every list is capped (ROW_CAP rows, and OUTPUT_MAX characters for a whole tool answer).
import { PEOPLE, SHOOT_TYPES, CLIENT_STATUS, PROCESSES, editorsOf } from '../_shared/app/protocol.js';
import { monthTarget, monthKey, isMonthKey, monthLabel } from '../_shared/app/edit-count.js';
import { dayKeyIL, partsIL } from '../_shared/app/tz.js';
import { folderIdOf, summarize } from '../_shared/drive.js';

export const ROW_CAP = 50;
export const OUTPUT_MAX = 14000;
const LOAD_MAX = 1000;

// The only tables a tool may read.
export const TABLES = [
  'clients', 'client_tasks', 'staff_tasks', 'protocol_checks', 'editor_progress', 'editor_progress_month',
  'client_gantt', 'deal_requests', 'quotes',
];
// Never, whatever is added to TABLES one day (tests/ask.test.mjs holds the two apart).
export const NEVER = /access|vault|secret|password|token|link|consent|push|whatsapp|staff$|payout|log$/;

// The person's client, with only `from` and only the tables above.
export function guardDb(client) {
  return {
    from(table) {
      if (!TABLES.includes(table) || NEVER.test(table)) throw new Error(`table not allowed: ${table}`);
      const q = client.from(table);
      return {
        select(cols, opts) {
          if (typeof cols !== 'string' || !cols.trim() || cols.includes('*')) throw new Error('name the columns');
          return q.select(cols, opts);
        },
      };
    },
  };
}

// ── Money ──────────────────────────────────────
const MONEY_KEY = /agorot|price|amount|gross|discount|total|retainer|income|money|₪/i;
export function withoutMoney(v) {
  if (Array.isArray(v)) return v.map(withoutMoney);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !MONEY_KEY.test(k)).map(([k, x]) => [k, withoutMoney(x)]));
}

// ── Small helpers ──────────────────────────────
const plain = (s) => String(s ?? '').replace(/[‎‏‪-‮⁦-⁩"'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const personName = (p) => (p ? PEOPLE[p]?.name || p : null);
const personKey = (v) => {
  const s = plain(v);
  if (!s) return null;
  const hit = Object.values(PEOPLE).find((p) => p.key === s || plain(p.name) === s);
  return hit ? hit.key : null;
};
const day = (iso) => (iso ? dayKeyIL(new Date(iso)) : null);
const cap = (list, n = ROW_CAP) => ({ rows: list.slice(0, n), more: Math.max(0, list.length - n) });
const shekels = (agorot) => (Number.isFinite(Number(agorot)) ? Math.round(Number(agorot) / 100) : null);
const PROC_TITLE = Object.fromEntries(PROCESSES.map((p) => [p.id, `${p.num ? `${p.num}. ` : ''}${p.title}`]));
const procOf = (key) => PROC_TITLE[String(key).replace(/^r\d+\./, '').split('.')[0]] || null;

async function rows(query) {
  const { data, error } = await query;
  if (error) throw Object.assign(new Error('db'), { code: error.code || 'db' });
  return Array.isArray(data) ? data : [];
}

const CLIENT_COLS = 'id, name, business, quote_id, package_name, shoot_type, editor, editor2, deal_at, char_at, shoot_at, contract_end, status, deliverables, rounds, links, archived_at, landing, created_at';
// Every client this person may see (cached for the request).
async function clientsOf(ctx) {
  ctx.cache ||= {};
  ctx.cache.clients ||= rows(ctx.db.from('clients').select(CLIENT_COLS).order('name').limit(LOAD_MAX));
  return ctx.cache.clients;
}
const isCurrent = (c) => !c.archived_at && (c.status === 'active' || c.status === 'ending');
const label = (c) => (c.business && c.business !== c.name ? `${c.name} (${c.business})` : c.name);

// A client by the words the person used: { client } or { error, candidates }.
export function matchClient(list, words) {
  const w = plain(words);
  if (!w) return { error: 'צריך שם של לקוח.' };
  const byId = list.find((c) => c.id === String(words).trim());
  if (byId) return { client: byId };
  const exact = list.filter((c) => plain(c.name) === w || plain(c.business) === w);
  const pool = exact.length ? exact : list.filter((c) => plain(c.name).includes(w) || plain(c.business).includes(w) || (w.length >= 3 && w.includes(plain(c.name)) && plain(c.name).length >= 3));
  const live = pool.filter(isCurrent);
  const pick = live.length === 1 ? live : pool;
  if (pick.length === 1) return { client: pick[0] };
  if (!pick.length) return { error: `לא נמצא לקוח בשם "${String(words).slice(0, 60)}".` };
  return { error: 'נמצאו כמה לקוחות בשם הזה. איזה מהם?', candidates: pick.slice(0, 10).map(label) };
}
async function clientFrom(ctx, words) {
  return matchClient(await clientsOf(ctx), words);
}

// ── The tools ──────────────────────────────────
const STATUS_CHOICES = ['current', 'active', 'ending', 'ended', 'cancelled', 'archived', 'all'];
const str = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'find_clients',
    description: 'Count and list clients, with optional filters. Default: current clients (active or ending, not archived). Use for "כמה לקוחות", "מי הלקוחות של נדיה", "כמה לקוחות בחבילת נטלי".',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUS_CHOICES, description: 'current = active or ending (default); archived = in the archive.' },
        name: str('Part of the client or business name.'),
        package: str('Part of the package name, e.g. "נטלי", "סמיון", "פודקאסט".'),
        editor: str('An editor (name in Hebrew or key): their clients, as main or second editor.'),
        shoot_type: str('Shoot type key or name.'),
        monthly: { type: 'boolean', description: 'Only clients with a fixed number of videos a month.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'client_details',
    description: 'Everything known about one client: status, package, what they are owed (videos, graphics, shoot days, this month\'s videos for a monthly client), dates, shoot rounds, editors and how many videos were edited, protocol progress, open and late tasks, this month\'s content Gantt, links. Money only for the owners.',
    input_schema: { type: 'object', properties: { client: str('The client\'s name (or part of it).') }, required: ['client'], additionalProperties: false },
  },
  {
    name: 'tasks',
    description: 'Tasks of the team: the clients\' tasks and the tasks staff gave each other. Filter by person, client, open or late.',
    input_schema: {
      type: 'object',
      properties: {
        person: str('Whose tasks (Hebrew name or key), e.g. "עירית".'),
        client: str('A client\'s name.'),
        late_only: { type: 'boolean', description: 'Only open tasks whose date passed.' },
        include_done: { type: 'boolean', description: 'Also tasks done in the last 30 days.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shoot_days',
    description: 'Shoot days (each client\'s, every round\'s) between two dates, Israel time. Default: this week (Sunday to Saturday).',
    input_schema: { type: 'object', properties: { from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD') }, additionalProperties: false },
  },
  {
    name: 'editors_progress',
    description: 'Per editor: their current clients and the videos they have edited (per shoot round, and this month for monthly clients).',
    input_schema: { type: 'object', properties: { editor: str('Optional: one editor.'), month: str('YYYY-MM, default this month.') }, additionalProperties: false },
  },
  {
    name: 'content_gantt',
    description: 'The content Gantt (planned posts, videos, graphics, stories) for a month: counts by kind and state, and the items. For one client or all.',
    input_schema: { type: 'object', properties: { client: str('Optional client name.'), month: str('YYYY-MM, default this month.') }, additionalProperties: false },
  },
  {
    name: 'sales',
    description: 'The field sales\' deals and the quotes/contracts sent: counts by status and seller in a period. Amounts only for the owners.',
    input_schema: { type: 'object', properties: { from: str('YYYY-MM-DD, default the 1st of this month.'), to: str('YYYY-MM-DD, default today.') }, additionalProperties: false },
  },
  {
    name: 'drive_files',
    description: 'The files in a client\'s Google Drive folder (names, kinds, dates, links; never the contents): how many videos, what was uploaded lately, a file\'s link.',
    input_schema: { type: 'object', properties: { client: str('The client\'s name.'), since: str('Optional YYYY-MM-DD: only files added from then.') }, required: ['client'], additionalProperties: false },
  },
  {
    name: 'team',
    description: 'The team: names and roles.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const todayKey = (ctx) => dayKeyIL(ctx.now());
const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

async function findClients(ctx, i) {
  const list = await clientsOf(ctx);
  const status = STATUS_CHOICES.includes(i.status) ? i.status : 'current';
  const ed = i.editor ? personKey(i.editor) : null;
  const st = plain(i.shoot_type);
  const out = list.filter((c) => {
    if (status === 'current' && !isCurrent(c)) return false;
    if (status === 'archived' && !c.archived_at) return false;
    if (!['current', 'archived', 'all'].includes(status) && (c.status !== status || c.archived_at)) return false;
    if (i.name && !(plain(c.name).includes(plain(i.name)) || plain(c.business).includes(plain(i.name)))) return false;
    if (i.package && !plain(c.package_name).includes(plain(i.package))) return false;
    if (i.editor && !(ed && editorsOf(c).includes(ed)) && !(editorsOf(c).some((e) => plain(personName(e)).includes(plain(i.editor))))) return false;
    if (st && !(plain(c.shoot_type) === st || plain(SHOOT_TYPES[c.shoot_type]?.name).includes(st))) return false;
    if (i.monthly && !monthTarget(c, ctx.now())) return false;
    return true;
  });
  const { rows: shown, more } = cap(out);
  return {
    count: out.length,
    clients: shown.map((c) => ({
      name: label(c), status: CLIENT_STATUS[c.status] || c.status, archived: !!c.archived_at || undefined, package: c.package_name || null,
      editors: editorsOf(c).map(personName), shoot_type: SHOOT_TYPES[c.shoot_type]?.name || null,
    })),
    more,
  };
}

async function clientDetails(ctx, i) {
  const m = await clientFrom(ctx, i.client);
  if (!m.client) return m;
  const c = m.client;
  const now = ctx.now();
  const month = monthKey(now);
  const d = c.deliverables || {};
  const [checks, tasks, prog, progMonth, gantt] = await Promise.all([
    rows(ctx.db.from('protocol_checks').select('item_key, state, at').eq('client_id', c.id).order('at', { ascending: false }).limit(LOAD_MAX)),
    rows(ctx.db.from('client_tasks').select('title, owner, due_on, done_at, urgent').eq('client_id', c.id).is('done_at', null).limit(LOAD_MAX)),
    rows(ctx.db.from('editor_progress').select('editor, round, edited').eq('client_id', c.id).limit(100)),
    rows(ctx.db.from('editor_progress_month').select('editor, month, edited').eq('client_id', c.id).eq('month', month).limit(100)),
    rows(ctx.db.from('client_gantt').select('kind, state, day, month').eq('client_id', c.id).limit(LOAD_MAX)),
  ]);
  const today = todayKey(ctx);
  const done = checks.filter((k) => k.state === 'done');
  const inMonth = gantt.filter((g) => String(g.day || '').startsWith(month));
  const out = {
    name: label(c),
    status: CLIENT_STATUS[c.status] || c.status,
    archived: !!c.archived_at || undefined,
    package: c.package_name || null,
    shoot_type: SHOOT_TYPES[c.shoot_type]?.name || null,
    editors: editorsOf(c).map(personName),
    dates: { deal: day(c.deal_at), characterization: day(c.char_at), shoot: day(c.shoot_at), contract_end: c.contract_end || null },
    owed_for_the_whole_agreement: {
      videos: d.videos ?? null, graphics: d.graphics ?? null, shoot_days: d.shoot_days ?? null, collabs: d.collabs ?? null,
      stories: d.stories ?? null, ch14: d.ch14 ?? null, monthly_photographer_contents: d.monthly || null, scripts: d.scripts ?? null,
      extra: Array.isArray(d.extra) ? d.extra : undefined,
    },
    monthly_client: monthTarget(c, now) !== null
      ? { videos_this_month: monthTarget(c, now), regular_per_month: d.videos_month, month: monthLabel(month), shoot_every_month: d.shoot_monthly === true }
      : null,
    rounds: (Array.isArray(c.rounds) ? c.rounds : []).map((r) => ({ round: r.n, shoot: day(r.shoot_at), editors: [r.editor, r.editor2].filter(Boolean).map(personName) })),
    edited: {
      per_round: prog.map((p) => ({ editor: personName(p.editor), round: p.round, edited: p.edited })),
      this_month: progMonth.map((p) => ({ editor: personName(p.editor), edited: p.edited })),
    },
    protocol: {
      items_done: done.length,
      latest_done: done.slice(0, 5).map((k) => ({ step: procOf(k.item_key) || k.item_key, on: day(k.at) })),
    },
    open_tasks: tasks.length,
    late_tasks: tasks.filter((t) => t.due_on && t.due_on < today).map((t) => ({ title: t.title, who: personName(t.owner), due: t.due_on })).slice(0, 20),
    gantt_this_month: { items: inMonth.length, by_state: countBy(inMonth, 'state'), by_kind: countBy(inMonth, 'kind') },
    links: Object.fromEntries(Object.entries(c.links || {}).filter(([, v]) => typeof v === 'string' && /^https:\/\//.test(v))),
    landing: c.landing ? true : undefined,
  };
  // The agreement's price: the owners only (public.sees_money()); nobody else's query asks for it.
  if (ctx.seesMoney && c.quote_id) {
    const q = await rows(ctx.db.from('quotes').select('number, status, monthly_gross_agorot, term_gross_agorot, signed_at').eq('id', c.quote_id).limit(1));
    out.agreements = q.map((x) => ({ number: x.number, status: x.status, signed: day(x.signed_at), monthly_price_ils: shekels(x.monthly_gross_agorot), term_total_ils: shekels(x.term_gross_agorot) }));
  }
  return out;
}

function countBy(list, key) {
  const out = {};
  for (const x of list) { const k = x[key] ?? 'none'; out[k] = (out[k] || 0) + 1; }
  return out;
}

async function tasksTool(ctx, i) {
  const who = i.person ? personKey(i.person) : null;
  if (i.person && !who) return { error: `לא מכיר את "${String(i.person).slice(0, 40)}" בצוות.` };
  let client = null;
  if (i.client) {
    const m = await clientFrom(ctx, i.client);
    if (!m.client) return m;
    client = m.client;
  }
  const today = todayKey(ctx);
  const since = new Date(ctx.now().getTime() - 30 * 86400000).toISOString();
  let ct = ctx.db.from('client_tasks').select('client_id, title, owner, due_on, done_at, urgent, created_at');
  if (who) ct = ct.eq('owner', who);
  if (client) ct = ct.eq('client_id', client.id);
  if (!i.include_done) ct = ct.is('done_at', null);
  let st = ctx.db.from('staff_tasks').select('assignee, body, client_name, status, created_at, done_at, created_by');
  if (who) st = st.eq('assignee', who);
  if (client) st = st.eq('client_id', client.id);
  st = i.include_done ? st.in('status', ['open', 'done']) : st.eq('status', 'open');
  const [a, b, list] = await Promise.all([rows(ct.order('due_on', { ascending: true }).limit(LOAD_MAX)), rows(st.order('created_at', { ascending: false }).limit(LOAD_MAX)), clientsOf(ctx)]);
  const names = Object.fromEntries(list.map((c) => [c.id, label(c)]));
  let clientTasks = a.filter((t) => !t.done_at || t.done_at >= since).map((t) => ({
    title: t.title, who: personName(t.owner), client: names[t.client_id] || null, due: t.due_on || null,
    late: !t.done_at && !!t.due_on && t.due_on < today, done: t.done_at ? day(t.done_at) : null, urgent: t.urgent || undefined,
  }));
  if (i.late_only) clientTasks = clientTasks.filter((t) => t.late);
  const staffTasks = i.late_only ? [] : b.filter((t) => t.status === 'open' || String(t.done_at || '') >= since).map((t) => ({ task: String(t.body || '').slice(0, 200), to: personName(t.assignee), from: personName(t.created_by), client: t.client_name || null, status: t.status, given: day(t.created_at) }));
  const c1 = cap(clientTasks);
  const c2 = cap(staffTasks, 25);
  return {
    client_tasks: { count: clientTasks.length, late: clientTasks.filter((t) => t.late).length, rows: c1.rows, more: c1.more },
    staff_tasks: i.late_only ? undefined : { count: staffTasks.length, rows: c2.rows, more: c2.more },
  };
}

function weekOf(ctx) {
  const today = todayKey(ctx);
  const wd = partsIL(ctx.now()).weekday; // 0 = Sunday
  const t = Date.parse(`${today}T12:00:00Z`);
  const k = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { from: k(t - wd * 86400000), to: k(t + (6 - wd) * 86400000) };
}

async function shootDays(ctx, i) {
  const week = weekOf(ctx);
  const from = okDate(i.from) ? i.from : week.from;
  const to = okDate(i.to) ? i.to : (okDate(i.from) ? i.from : week.to);
  const list = (await clientsOf(ctx)).filter((c) => !c.archived_at && c.status !== 'cancelled');
  const out = [];
  for (const c of list) {
    const add = (at, round) => {
      const k = day(at);
      if (k && k >= from && k <= to) {
        const p = partsIL(new Date(at));
        out.push({ day: k, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, client: label(c), round: round || undefined, shoot_type: SHOOT_TYPES[c.shoot_type]?.name || null });
      }
    };
    add(c.shoot_at, null);
    for (const r of Array.isArray(c.rounds) ? c.rounds : []) add(r.shoot_at, r.n);
  }
  out.sort((a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`));
  const { rows: shown, more } = cap(out);
  return { from, to, count: out.length, days: shown, more };
}

async function editorsProgress(ctx, i) {
  const month = isMonthKey(i.month) ? i.month : monthKey(ctx.now());
  const only = i.editor ? personKey(i.editor) : null;
  if (i.editor && !only) return { error: `לא מכיר עורך בשם "${String(i.editor).slice(0, 40)}".` };
  const list = (await clientsOf(ctx)).filter(isCurrent);
  const [prog, progMonth] = await Promise.all([
    rows(ctx.db.from('editor_progress').select('client_id, editor, round, edited').limit(LOAD_MAX)),
    rows(ctx.db.from('editor_progress_month').select('client_id, editor, month, edited').eq('month', month).limit(LOAD_MAX)),
  ]);
  const editors = Object.values(PEOPLE).filter((p) => p.editor && (!only || p.key === only)).map((p) => p.key);
  const names = Object.fromEntries(list.map((c) => [c.id, label(c)]));
  return {
    month: monthLabel(month),
    editors: editors.map((e) => {
      const mine = list.filter((c) => editorsOf(c).includes(e) || (Array.isArray(c.rounds) && c.rounds.some((r) => r.editor === e || r.editor2 === e)));
      const pm = progMonth.filter((p) => p.editor === e);
      return {
        editor: personName(e),
        current_clients: mine.length,
        clients: mine.slice(0, 30).map(label),
        edited_per_shoot: prog.filter((p) => p.editor === e && names[p.client_id]).slice(0, 30).map((p) => ({ client: names[p.client_id], round: p.round, edited: p.edited })),
        edited_this_month_sum: pm.reduce((t, p) => t + (p.edited || 0), 0),
        edited_this_month: pm.slice(0, 30).map((p) => ({ client: names[p.client_id] || null, edited: p.edited })),
      };
    }),
  };
}

async function contentGantt(ctx, i) {
  const month = isMonthKey(i.month) ? i.month : monthKey(ctx.now());
  let client = null;
  if (i.client) {
    const m = await clientFrom(ctx, i.client);
    if (!m.client) return m;
    client = m.client;
  }
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  let q = ctx.db.from('client_gantt').select('client_id, kind, title, day, state, posted_on, internal, link')
    .gte('day', `${month}-01`).lte('day', `${month}-${String(last).padStart(2, '0')}`);
  if (client) q = q.eq('client_id', client.id);
  const [items, list] = await Promise.all([rows(q.order('day').limit(LOAD_MAX)), clientsOf(ctx)]);
  const names = Object.fromEntries(list.map((c) => [c.id, label(c)]));
  const shown = cap(items);
  return {
    month: monthLabel(month), client: client ? label(client) : 'all', count: items.length,
    by_kind: countBy(items, 'kind'), by_state: countBy(items, 'state'),
    by_client: client ? undefined : Object.fromEntries(Object.entries(countBy(items, 'client_id')).map(([k, n]) => [names[k] || k, n]).slice(0, 60)),
    items: shown.rows.map((g) => ({ client: names[g.client_id] || null, day: g.day, kind: g.kind, title: g.title || null, state: g.state, posted: g.posted_on || null, link: g.link || null })),
    more: shown.more,
  };
}

async function sales(ctx, i) {
  const today = todayKey(ctx);
  const from = okDate(i.from) ? i.from : `${today.slice(0, 7)}-01`;
  const to = okDate(i.to) ? i.to : today;
  const startIso = new Date(`${from}T00:00:00+02:00`).toISOString();
  const endIso = new Date(Date.parse(`${to}T00:00:00+02:00`) + 86400000).toISOString();
  const dealCols = ctx.seesMoney ? 'created_at, seller, business_name, status, signed_at, discount_agorot' : 'created_at, seller, business_name, status, signed_at';
  const quoteCols = ctx.seesMoney ? 'number, client_name, status, created_at, signed_at, monthly_gross_agorot, term_gross_agorot' : 'number, client_name, status, created_at, signed_at';
  const [deals, quotes] = await Promise.all([
    rows(ctx.db.from('deal_requests').select(dealCols).gte('created_at', startIso).lt('created_at', endIso).order('created_at', { ascending: false }).limit(LOAD_MAX)).catch(() => null),
    rows(ctx.db.from('quotes').select(quoteCols).gte('created_at', startIso).lt('created_at', endIso).order('created_at', { ascending: false }).limit(LOAD_MAX)).catch(() => null),
  ]);
  const out = { from, to };
  if (deals) {
    out.field_deals = {
      count: deals.length, by_status: countBy(deals, 'status'),
      by_seller: Object.fromEntries(Object.entries(countBy(deals, 'seller')).map(([k, n]) => [personName(k) || k, n])),
      rows: cap(deals).rows.map((d) => ({ business: d.business_name, seller: personName(d.seller), status: d.status, on: day(d.created_at), ...(ctx.seesMoney && d.discount_agorot ? { discount_ils: shekels(d.discount_agorot) } : {}) })),
    };
  }
  if (quotes) {
    const signed = quotes.filter((q) => q.status === 'signed');
    out.quotes = {
      count: quotes.length, by_status: countBy(quotes, 'status'),
      rows: cap(quotes).rows.map((q) => ({ number: q.number, client: q.client_name, status: q.status, sent: day(q.created_at), signed: day(q.signed_at), ...(ctx.seesMoney ? { monthly_price_ils: shekels(q.monthly_gross_agorot) } : {}) })),
    };
    if (ctx.seesMoney) {
      out.quotes.signed_monthly_total_ils = signed.reduce((t, q) => t + (shekels(q.monthly_gross_agorot) || 0), 0);
      out.quotes.signed_term_total_ils = signed.reduce((t, q) => t + (shekels(q.term_gross_agorot) || 0), 0);
    }
  }
  if (!deals && !quotes) out.note = 'אין לך גישה לעסקאות ולהצעות.';
  return out;
}

export const DRIVE_OFF = 'הדרייב עוד לא מחובר';
async function driveFiles(ctx, i) {
  const m = await clientFrom(ctx, i.client);
  if (!m.client) return m;
  const c = m.client;
  if (!ctx.drive) return { client: label(c), error: DRIVE_OFF };
  const link = c.links?.drive;
  const id = folderIdOf(link);
  if (!id) return { client: label(c), error: link ? 'הקישור לדרייב בכרטיס אינו קישור לתיקייה.' : 'אין קישור לתיקיית הדרייב בכרטיס הלקוח.' };
  try {
    const { files, truncated } = await ctx.drive.list(id);
    const since = okDate(i.since) ? i.since : null;
    const s = summarize(files, { since, limit: 40 });
    return { client: label(c), folder: link, since: since || undefined, counts: s.counts, files: s.files, more: s.more, partial: truncated || undefined };
  } catch (e) {
    const code = e?.code || 'error';
    if (code === 'no_access') return { client: label(c), error: `אין גישה לתיקייה. צריך לשתף אותה (צפייה) עם ${ctx.drive.email}.` };
    if (code === 'auth') return { client: label(c), error: 'החיבור לדרייב נדחה (המפתח). צריך לבדוק את ההגדרה.' };
    return { client: label(c), error: 'הדרייב לא ענה כרגע. נסו שוב.' };
  }
}

function team() {
  return { people: Object.values(PEOPLE).filter((p) => p.key !== 'editor').map((p) => ({ name: p.name, role: p.role })) };
}

const RUN = {
  find_clients: findClients, client_details: clientDetails, tasks: tasksTool, shoot_days: shootDays,
  editors_progress: editorsProgress, content_gantt: contentGantt, sales, drive_files: driveFiles, team,
};

// One tool call: { content: string, isError }. ctx: { db (guardDb), seesMoney, drive (or null), now() }.
export async function runTool(ctx, name, input) {
  const fn = RUN[name];
  if (!fn) return { content: JSON.stringify({ error: 'unknown tool' }), isError: true };
  let out;
  try {
    out = await fn(ctx, input && typeof input === 'object' ? input : {});
  } catch (e) {
    return { content: JSON.stringify({ error: 'הקריאה מהמערכת נכשלה.', code: String(e?.code || 'error').slice(0, 20) }), isError: true };
  }
  if (!ctx.seesMoney) out = withoutMoney(out);
  return { content: fit(out), isError: false };
}

// The answer as JSON of at most OUTPUT_MAX characters: the longest lists are shortened first.
export function fit(value) {
  let text = JSON.stringify(value);
  if (text.length <= OUTPUT_MAX) return text;
  const v = JSON.parse(text);
  const lists = [];
  const walk = (o) => { if (o && typeof o === 'object') for (const [k, x] of Object.entries(o)) { if (Array.isArray(x)) lists.push([o, k]); walk(x); } };
  walk(v);
  for (let n = 20; n >= 0 && text.length > OUTPUT_MAX; n -= 5) {
    for (const [o, k] of lists) if (o[k].length > n) { o[`${k}_cut`] = o[k].length - n; o[k] = o[k].slice(0, n); }
    text = JSON.stringify(v);
  }
  return text.length <= OUTPUT_MAX ? text : JSON.stringify({ error: 'too much to show: ask something narrower' });
}
