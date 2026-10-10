// A realistic office for the browser suites that walk every role on a phone
// (tests/roles-phone-e2e.mjs): about 20 open clients spread over the 8 stations,
// several late items, a shoot day tomorrow, new deals from Stav, urgent tasks and
// exceptions, and an in-memory fake of Supabase that answers every table generically.
// The clock is Tuesday 20.10.2026, 10:00 in Israel. Names are invented.
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { withClientColumns } from './fake-clients.mjs';

export const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
export const SUPA = 'https://czncjzziqrqtezpwxxpz.supabase.co';
export const GALLERY_TOKEN = 'g'.repeat(43); // gallery.html?t=…: the client's link (43 characters)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

// ── People ────────────────────────────────
export const ROLES = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nirel: 'nirel', nadia: 'nadia', yariv: 'yariv', anna: 'anna', eli: 'eli', stav: 'stav' };
export const emailOf = (role) => `${role}@astrateg.test`;
const OFFICE = new Set([null, 'irit', 'lior', 'ofir', 'ilai']);

const id = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const client = (n, fields) => ({
  id: id(n), name: '', business: null, address: 'הרצל 10, תל אביב', phone: null, package_name: 'Social + TV all in one · סמיון, מישל ודניס', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-10-11T09:00:00+03:00', char_at: null, shoot_at: null,
  contract_end: '2027-10-11', status: 'active', notes: null, quote_id: null, created_at: '2026-10-11T09:00:00+03:00',
  created_by_email: emailOf('irit'), links: {}, deliverables: { videos: 25, graphics: 35, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  archived_at: null, archived_by: null,
  ...fields,
});
const NATALI = { package_name: 'Social all in one · נטלי דדון', shoot_type: 'natali' };

export function buildWorld() {
  const checks = [];
  const mark = (c, station, at) => { for (const k of importKeys(station)) checks.push({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: emailOf('irit'), at }); };
  const list = [];
  const add = (n, station, fields, at = '2026-10-16T09:00:00+03:00') => { const c = client(n, fields); list.push(c); mark(c, station, at); return c; };

  // Station 1, joining: three new deals, one of them minutes old.
  add(1, 'join', { name: 'אבי לוי', business: 'פיצה נאפולי', deal_at: '2026-10-20T09:40:00+03:00', created_at: '2026-10-20T09:40:00+03:00' });
  add(2, 'join', { name: 'מיכל שחר', business: 'קליניקת שחר', deal_at: '2026-10-19T15:00:00+03:00', created_at: '2026-10-19T15:00:00+03:00', ...NATALI });
  add(3, 'join', { name: 'יוסי אדרי', business: 'מוסך אדרי', deal_at: '2026-10-18T11:00:00+03:00', created_at: '2026-10-18T11:00:00+03:00' });
  // Station 2, characterization.
  add(4, 'char', { name: 'רונית גל', business: 'סטודיו גל', char_at: '2026-10-15T10:00:00+03:00', deal_at: '2026-10-13T09:00:00+03:00' });
  add(5, 'char', { name: 'דוד מזרחי', business: 'מזרחי נדל״ן', char_at: '2026-10-19T12:00:00+03:00', deal_at: '2026-10-14T09:00:00+03:00', has_logo: false });
  add(6, 'char', { name: 'שירה כץ', business: 'שירה קונדיטוריה', char_at: '2026-10-20T13:00:00+03:00', deal_at: '2026-10-15T09:00:00+03:00', ...NATALI });
  // Station 3, content and approval: one shoots tomorrow.
  add(7, 'content', { name: 'עומר דיין', business: 'דיין רהיטים', char_at: '2026-10-08T10:00:00+03:00', shoot_at: '2026-10-21T10:00:00+03:00', deal_at: '2026-10-06T09:00:00+03:00' });
  add(8, 'content', { name: 'נועה ברק', business: 'ברק עיצוב שיער', char_at: '2026-10-12T10:00:00+03:00', shoot_at: '2026-10-27T10:00:00+03:00', deal_at: '2026-10-08T09:00:00+03:00', ...NATALI });
  add(9, 'content', { name: 'אלון רז', business: 'רז מערכות', char_at: '2026-10-13T10:00:00+03:00', deal_at: '2026-10-09T09:00:00+03:00' });
  // Station 4, the shoot day: tomorrow, and yesterday.
  add(10, 'shoot', { name: 'טל אורן', business: 'אורן פרחים', char_at: '2026-10-05T10:00:00+03:00', shoot_at: '2026-10-21T13:00:00+03:00', deal_at: '2026-10-01T09:00:00+03:00' });
  add(11, 'shoot', { name: 'גיל סער', business: 'סער ספורט', char_at: '2026-10-05T10:00:00+03:00', shoot_at: '2026-10-19T10:00:00+03:00', deal_at: '2026-10-01T09:00:00+03:00' });
  // Station 5, editing and quality control: one per editor.
  add(12, 'post', { name: 'מאיה חן', business: 'חן קוסמטיקה', editor: 'nadia', char_at: '2026-09-28T10:00:00+03:00', shoot_at: '2026-10-14T10:00:00+03:00', deal_at: '2026-09-24T09:00:00+03:00' });
  add(13, 'post', { name: 'ערן פלד', business: 'פלד אופניים', editor: 'nadia', char_at: '2026-09-28T10:00:00+03:00', shoot_at: '2026-10-15T10:00:00+03:00', deal_at: '2026-09-24T09:00:00+03:00' });
  add(14, 'post', { name: 'ליאת שגב', business: 'שגב אופטיקה', editor: 'yariv', char_at: '2026-09-29T10:00:00+03:00', shoot_at: '2026-10-13T10:00:00+03:00', deal_at: '2026-09-25T09:00:00+03:00' });
  add(15, 'post', { name: 'הדר נחום', business: 'נחום תכשיטים', editor: 'nirel', char_at: '2026-09-29T10:00:00+03:00', shoot_at: '2026-10-15T10:00:00+03:00', deal_at: '2026-09-25T09:00:00+03:00', ...NATALI });
  add(16, 'post', { name: 'בני אשכנזי', business: 'אשכנזי שיפוצים', editor: 'anna', char_at: '2026-09-30T10:00:00+03:00', shoot_at: '2026-10-18T10:00:00+03:00', deal_at: '2026-09-27T09:00:00+03:00' });
  // Station 6, publishing.
  add(17, 'publish', { name: 'קרן וולף', business: 'וולף פילאטיס', editor: 'yariv', char_at: '2026-09-10T10:00:00+03:00', shoot_at: '2026-09-29T10:00:00+03:00', deal_at: '2026-09-07T09:00:00+03:00' });
  add(18, 'publish', { name: 'שי בן דוד', business: 'בן דוד חשמל', editor: 'anna', char_at: '2026-09-10T10:00:00+03:00', shoot_at: '2026-09-30T10:00:00+03:00', deal_at: '2026-09-07T09:00:00+03:00' });
  // Station 7, ongoing.
  add(19, 'ongoing', { name: 'אורית מור', business: 'מור וטרינריה', editor: 'nadia', char_at: '2026-07-10T10:00:00+03:00', shoot_at: '2026-07-29T10:00:00+03:00', deal_at: '2026-07-07T09:00:00+03:00', contract_end: '2027-07-07' }, '2026-08-20T09:00:00+03:00');
  add(20, 'ongoing', { name: 'רועי טל', business: 'טל ביטוחים', editor: 'nirel', char_at: '2026-06-10T10:00:00+03:00', shoot_at: '2026-06-29T10:00:00+03:00', deal_at: '2026-06-07T09:00:00+03:00', contract_end: '2027-06-07', ...NATALI }, '2026-08-01T09:00:00+03:00');
  // Station 8, renewal: the contract ends in five weeks.
  add(21, 'renewal', { name: 'סיגל רום', business: 'רום אירועים', editor: 'yariv', char_at: '2025-11-28T10:00:00+02:00', shoot_at: '2025-12-15T10:00:00+02:00', deal_at: '2025-11-25T09:00:00+02:00', contract_end: '2026-11-25' }, '2026-02-01T09:00:00+02:00');
  // An ended client: never in anyone's work.
  add(22, 'renewal', { name: 'גן אירועים', business: 'גן אירועים', status: 'ended', contract_end: '2026-09-01', deal_at: '2025-09-01T09:00:00+03:00' }, '2026-02-01T09:00:00+02:00');

  const task = (n, cid, title, owner, extra = {}) => ({
    id: `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, client_id: id(cid), title, owner, due_on: null, done_at: null,
    created_at: '2026-10-19T09:00:00+03:00', created_by_email: emailOf('irit'), source: null, urgent: false, started_at: null, ...extra,
  });
  const tasks = [
    task(1, 12, 'הלקוחה ביקשה להחליף מוזיקה בסרטון 3', 'nadia', { due_on: '2026-10-20' }),
    task(2, 13, 'חסר לוגו באיכות טובה', 'irit', { due_on: '2026-10-19' }),
    task(3, 17, 'להכין שלוש גרפיקות למבצע חורף', 'ilai', { due_on: '2026-10-21' }),
    task(4, 19, 'הלקוחה לא מרוצה מקצב הפרסום', 'lior', { urgent: true, created_at: '2026-10-20T09:30:00+03:00', created_by_email: emailOf('irit') }),
    task(5, 14, 'חריגה: העריכה עצורה, חסר חומר גלם', 'lior', { source: 'escalation', created_at: '2026-10-20T08:45:00+03:00', created_by_email: emailOf('yariv') }),
    task(6, 20, 'לבדוק את הגישה לאינסטגרם', 'ofir', { due_on: '2026-10-22' }),
    task(7, 15, 'בריף: סטורי למבצע', 'nirel', { due_on: '2026-10-21' }),
  ];
  const deal = (n, business, contact, at, status = 'pending') => ({
    id: `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, created_at: at, created_by_email: emailOf('stav'), seller: 'stav', business_name: business,
    contact_name: contact, phone: '050-0000000', tier: 'social', influencer: 'dms', paid: [], free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false },
    discount_agorot: 0, notes: null, status, quote_id: null, sent_at: status === 'sent' ? at : null, signed_at: null, status_by_email: null,
  });
  const deals = [
    deal(1, 'מאפיית השכונה', 'רמי', '2026-10-20T09:52:00+03:00'),
    deal(2, 'קפה הפינה', 'דנה', '2026-10-20T09:20:00+03:00'),
    deal(3, 'סלון יופי לילך', 'לילך', '2026-10-19T16:00:00+03:00', 'sent'),
  ];
  const staff = Object.entries(ROLES).map(([k, person]) => ({ email: emailOf(k), person, vault: OFFICE.has(person), phone: null }));
  return {
    staff,
    clients: list,
    protocol_checks: checks,
    protocol_log: checks.slice(-300).map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at })),
    client_tasks: tasks,
    deal_requests: deals,
    // Omer Dayan's scripts for tomorrow's shoot: three written, the rest to write.
    client_scripts: [1, 2, 3].map((n) => ({
      client_id: id(7), round: 1, n, title: `רעיון ${n}: הספה שמשנה את הסלון`, body: 'פתיחה: סמיון נכנס לחנות ומתיישב על הספה.\nאמצע: שלוש סיבות לבחור בה.\nסגירה: הזמנה לבוא לנסות.',
      links: [], status: n < 3 ? 'ready' : 'draft', version: 1, by_email: emailOf('lior'), at: '2026-10-19T15:00:00+03:00',
    })),
    script_grants: [], script_share_links: [],
    // Maya Chen's files: client material and deliverables.
    client_files: [
      ...['logo', 'image', 'image'].map((kind, i) => ({ id: `f0000000-0000-4000-8000-00000000000${i}`, client_id: id(12), kind, label: kind === 'logo' ? 'לוגו' : `תמונה ${i}`, storage_path: `${id(12)}/pic-${i}.svg`, mime: 'image/svg+xml', size_bytes: 90000, posted_on: null, link: null, uploaded_by: emailOf('irit'), created_at: '2026-09-29T09:00:00+03:00', deleted_at: null })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `f0000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, client_id: id(12), kind: 'deliverable_graphic', label: `גרפיקה ${i + 1}`, storage_path: `${id(12)}/pic-${i + 3}.svg`, mime: 'image/svg+xml', size_bytes: 150000, posted_on: i < 2 ? '2026-10-12' : null, link: null, uploaded_by: emailOf('ilai'), created_at: '2026-10-06T09:00:00+03:00', deleted_at: null })),
    ],
  };
}

// ── The fake ───────────────────────────────
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('gt.')) out = out.filter((r) => String(r[k]) > v.slice(3));
    else if (v.startsWith('lte.')) out = out.filter((r) => String(r[k]) <= v.slice(4));
    else if (v.startsWith('lt.')) out = out.filter((r) => String(r[k]) < v.slice(3));
    else if (v.startsWith('like.')) { const re = new RegExp(`^${v.slice(5).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`); out = out.filter((r) => re.test(String(r[k] ?? ''))); }
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}

// The part of the database that opens a fix task (private.client_fix_open, migration
// 20261024100000), for the fakes: who fixes, by when (asked by 13:00 on a working day in
// Israel: that day; later, or on Friday and Saturday: the next working day), the videos'
// notes mark, and the task. Returns { task } or { error }.
const FIX_ITEMS = { 'p07.approved': ['graphics9', 'p07.sent', '9 הגרפיקות הראשונות'], 'p13.approved': ['scripts', 'p12.docs', 'התסריטים ליום הצילום'], 'p23.approved': ['graphics', 'p23.sent', 'יתרת הגרפיקות'], 'p27.approved': ['videos', 'p26.sent', 'הסרטונים'] };
export function openClientFix(db, { clientId, key, note, from, by, email = '', at }) {
  const text = String(note || '').trim();
  if (text.length < 2) return { error: 'note required' };
  const c = db.clients.find((x) => x.id === clientId);
  const pre = /^(r\d+\.)/.exec(String(key))?.[1] || '';
  const spec = FIX_ITEMS[String(key).slice(pre.length)];
  const checks = (db.protocol_checks ||= []);
  const has = (k, states = ['done']) => checks.some((r) => r.client_id === clientId && r.item_key === pre + k && states.includes(r.state));
  const tasks = (db.client_tasks ||= []);
  const fixing = tasks.some((t) => t.client_id === clientId && t.source === 'client_fix' && !t.done_at && t.brief?.item_key === key)
    || (spec?.[0] === 'videos' && has('p27.notes') && !has('p27.fixes', ['done', 'na']) && !has('p27.final'));
  if (!c || !spec || !has(spec[1]) || has(String(key).slice(pre.length), ['done', 'na']) || fixing) return { error: 'not awaiting approval' };
  const [item, , label] = spec;
  const n = pre ? pre.slice(1, -1) : null;
  const editor = n ? (c.rounds || []).find((r) => String(r.n) === n)?.editor : c.editor;
  const owner = item === 'scripts' ? 'lior' : item === 'videos' ? (editor || 'ofir') : 'ilai';
  // Israel's wall clock of `at`, as a UTC date (so its day, weekday and hour read plainly).
  const il = new Date(new Date(at).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let due = new Date(il);
  if (item === 'scripts' || [5, 6].includes(il.getDay()) || il.getHours() >= 13) do due.setDate(due.getDate() + 1); while ([5, 6].includes(due.getDay()));
  let marked = false;
  if (item === 'videos' && !has('p27.notes')) {
    checks.push({ client_id: clientId, item_key: `${pre}p27.notes`, state: 'done', note: JSON.stringify({ text: text.slice(0, 1500), via: from }), by_email: email, at });
    marked = true;
  }
  const task = {
    id: randomUUID(), client_id: clientId, title: `תיקון לבקשת הלקוח: ${label}${n ? ` (סבב צילום ${n})` : ''} · סבב 1`, owner, due_on: day(due), done_at: null, done_by_email: null,
    created_at: at, created_by_email: email, source: 'client_fix', urgent: false, started_at: null, result: null,
    brief: { problem: text.slice(0, 4000), from, item, item_key: key, round: 1, extra: false, notes_marked: marked, approval: null, by },
  };
  tasks.push(task);
  return { task };
}

export function makeFake(db, { now = () => NOW.toISOString() } = {}) {
  const users = new Map(db.staff.map((s) => [s.email, { id: randomUUID(), email: s.email, aud: 'authenticated', role: 'authenticated' }]));
  const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
  const userOf = (headers) => {
    const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
    return [...users.values()].find((u) => jwtFor(u) === token) || null;
  };
  const personOf = (u) => db.staff.find((x) => x.email === u?.email)?.person;
  const isOffice = (u) => !!u && OFFICE.has(personOf(u));
  const calls = [];
  const KEYS = { protocol_checks: ['client_id', 'item_key'] };

  async function handler(route) {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const headers = req.headers();
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    if (req.method() === 'OPTIONS') return json(200, {});
    const p = url.pathname;
    const me = userOf(headers);
    if (p === '/auth/v1/token') {
      const u = users.get(String(body.email || '').toLowerCase());
      if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
    }
    if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (p === '/rest/v1/rpc/is_staff') return json(200, !!me);
    if (p === '/rest/v1/rpc/can_use_vault' || p === '/rest/v1/rpc/can_use_client_vault') return json(200, isOffice(me));
    if (p === '/rest/v1/rpc/manager_client_finance') return json(200, []);
    if (p === '/rest/v1/rpc/archived_clients') return json(200, []);
    if (p === '/rest/v1/rpc/push_status') return json(200, []);
    // The scripts page (process 12): Lior and the owner write.
    const writes = !!me && (personOf(me) === null || personOf(me) === 'lior');
    if (p === '/rest/v1/rpc/scripts_client') {
      const c = db.clients.find((x) => x.id === body.p_client);
      if (!c || !writes) return json(200, null);
      return json(200, { id: c.id, name: c.name, business: c.business || c.name, status: c.status, shootType: c.shoot_type, charAt: c.char_at, shootAt: c.shoot_at,
        videos: c.deliverables?.videos ?? null, rounds: (c.rounds || []).map((r) => r.n), manage: true });
    }
    if (p === '/rest/v1/rpc/can_write_scripts') return json(200, writes);
    // "הלקוח ביקש תיקון" written down by the office (public.staff_request_fix, migration
    // 20261024100000): the task the status page opens, to the same person, by the same rule.
    if (p === '/rest/v1/rpc/staff_request_fix') {
      const person = personOf(me);
      if (!me || !(person === null || ['irit', 'lior', 'ofir'].includes(person))) return json(403, { code: '42501', message: 'not allowed' });
      const out = openClientFix(db, { clientId: body.p_client, key: body.p_key, note: body.p_note, from: 'office', by: person || 'owner', email: me.email, at: now() });
      return out.error ? json(400, { code: '22023', message: out.error }) : json(200, out.task);
    }
    // The client's gallery (gallery.html?t=GALLERY_TOKEN): no sign-in.
    if (p === '/functions/v1/client-media') {
      if (body?.t !== GALLERY_TOKEN) return json(200, { state: 'invalid' });
      const pic = (i) => `${SUPA}/storage/v1/object/sign/client-files/pic-${i}.svg?token=t`;
      const files = [
        ...Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, kind: 'deliverable_graphic', label: `גרפיקה ${i + 1}`, mime: 'image/svg+xml', size: 120000, postedOn: i < 4 ? '2026-10-12' : null, link: null, at: '2026-10-10T09:00:00+03:00', url: pic(i), download: pic(i), thumb: null })),
        { id: 'v1', kind: 'deliverable_video', label: 'סרטון 1: פתיחת העונה', mime: 'video/mp4', size: 48000000, postedOn: '2026-10-15', link: 'https://www.instagram.com/reel/example', at: '2026-10-14T09:00:00+03:00', url: pic(9), download: pic(9), thumb: null },
        { id: 's1', kind: 'deliverable_site', label: null, mime: null, size: null, postedOn: null, link: 'https://example.co.il', at: '2026-10-14T09:00:00+03:00', url: null, download: null, thumb: null },
      ];
      return json(200, { state: 'ok', scope: 'gallery', business: 'חן קוסמטיקה', expiresAt: '2027-10-11T09:00:00Z', ttl: 3600, files });
    }
    if (p.startsWith('/storage/v1/object/sign/')) {
      if (req.method() === 'POST') return json(200, { signedURL: `${p.replace('/storage/v1', '')}?token=t` });
      const hue = (Number(/pic-(\d+)/.exec(p)?.[1] || 0) * 47) % 360;
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="hsl(${hue} 70% 45%)"/></svg>` });
    }
    if (p.startsWith('/rest/v1/rpc/') || p.startsWith('/functions/v1/')) return json(404, { code: 'PGRST202', message: 'not found' });
    if (p.startsWith('/storage/v1/')) return json(404, { message: 'not found' });
    const m = /^\/rest\/v1\/(\w+)$/.exec(p);
    if (!m) return json(404, { code: '42P01', message: 'not found' });
    if (!me) return json(401, { message: 'permission denied' });
    const table = m[1];
    const rowsOf = () => (db[table] ||= []);
    const single = (headers.accept || '').includes('vnd.pgrst.object');
    const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));
    const person = personOf(me);
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      let rows = applyFilters(rowsOf(), url.searchParams);
      if (table === 'clients') {
        rows = rows.filter((r) => !r.archived_at);
        if (person === 'stav') rows = [];
        else if (person === 'eli') rows = rows.filter((r) => r.shoot_at);
        else if (!isOffice(me)) rows = rows.filter((r) => r.editor === person);
      }
      if (person === 'stav' && table !== 'deal_requests' && table !== 'staff' && table !== 'reminder_log') rows = [];
      // Money (20261013100000_money_owners_only.sql): the owners and Irit read the deals and the
      // quotes; a seller their own deals; Ofir and Lior a contract that waits for approval;
      // anyone a quote they made.
      const readsAll = person === null || person === 'irit';
      if (table === 'deal_requests' && !readsAll) rows = rows.filter((r) => r.seller === person);
      if (table === 'quotes' && !readsAll) {
        const approver = person === 'ofir' || person === 'lior';
        rows = rows.filter((r) => r.created_by_email === me.email || (approver && r.approval && r.approval !== 'none' && r.status === 'sent'));
      }
      if (['client_messages', 'client_access'].includes(table) && !isOffice(me)) rows = [];
      const off = Number(url.searchParams.get('offset') || 0);
      const lim = Number(url.searchParams.get('limit') || 1e9);
      return reply(rows.slice(off, off + lim));
    }
    calls.push({ method: req.method(), table, body, by: me.email });
    if (req.method() === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const keys = url.searchParams.get('on_conflict')?.split(',') || KEYS[table] || null;
      const out = list.map((r) => {
        const row = { id: randomUUID(), created_at: now(), at: now(), by_email: me.email, created_by_email: me.email, ...r };
        const old = keys && rowsOf().find((x) => keys.every((k) => String(x[k]) === String(row[k])));
        if (old) { Object.assign(old, r, { at: now(), by_email: me.email }); return old; }
        rowsOf().push(row);
        return row;
      });
      return single ? json(201, out[0]) : json(201, out);
    }
    if (req.method() === 'PATCH') {
      const rows = applyFilters(rowsOf(), url.searchParams);
      for (const r of rows) Object.assign(r, body);
      return reply(rows);
    }
    if (req.method() === 'DELETE') {
      const gone = new Set(applyFilters(rowsOf(), url.searchParams));
      db[table] = rowsOf().filter((r) => !gone.has(r));
      return reply([...gone]);
    }
    return json(405, { message: 'unexpected' });
  }
  return { route: withClientColumns(handler, { clients: () => db.clients, staff: () => db.staff }), calls };
}
