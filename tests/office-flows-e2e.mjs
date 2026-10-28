// End-to-end check of the office's flows (stage 3, part 2; system-plan section 3:
// Ofir, Lior and Ilai), against an in-memory fake of Supabase. The browser's clock
// is fixed on Tuesday 20.10.2026 at 10:00 in Israel (Thursday 22.10 for the summary).
//  - Ofir lands on his queue (qa.html): what waits for him against the one-hour
//    target; he returns the videos with two issues, the editor marks them fixed in
//    the client card ("תוקן"), they come back as a second check, he approves, and
//    the handoff to Irit is offered.
//  - The assignment: Nirel preselected for Natali; Nadia with or without a reason; the
//    folder task (24) and the WhatsApp to the editor.
//  - Thursday: the pass over the clients, Irit's since 26.10.2026 ("עברתי", "עברתי על כל
//    השאר", recorded as the day's control), a data-health fix in one tap, the summary
//    prefilled; the owner and Ofir look at it, with no button of the pass and no task.
//  - Lior lands on "החלטות": an exception through reason → decision → next action
//    (a linked task) → close; "התחלתי"; an urgent task back with him; a login
//    closed as partly fixed; paused editing moved; the Tuesday campaign check; the
//    lists match the reminder engine.
//  - Ilai: the characterization day's card (the vault statuses check the access,
//    the page checks, Metricool's state (Ofir connects it since v11), "מוכן לבדיקה" to Irit, the Gantt), and "קיבלתי".
//  - A 360px phone: no sideways scrolling, 44px targets.
//  - The old system's signed documents (25.10.2026): the owner imports two through the page
//    (scripts/legacy-contracts-import.mjs importInPage), the card lists them, "פתיחה" shows one;
//    an editor reads none.
//  - The old system's characterization (26.10.2026): the owner imports one through the page
//    (scripts/legacy-characterizations-import.mjs importInPage), the card shows the closed row
//    "אפיון מהמערכת הישנה" (390px), opened: the filled text readable, the brief and the raw
//    answers in their own rows; the editor reads it on the card and on her page.
// Run: npx http-server -p 8080 -s . &  then  node tests/office-flows-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import { applicableProcesses } from '../app/protocol-logic.js';
import { buildEnv, candidates } from '../app/reminder-engine.js';
import { splitLists } from '../app/decisions-logic.js';
import { withClientColumns } from './fake-clients.mjs';
import { monthKey } from '../app/edit-count.js';
import { importInPage } from '../scripts/legacy-contracts-import.mjs';
import { importInPage as importCharsInPage } from '../scripts/legacy-characterizations-import.mjs';

// qa.html since 20.10.2026 (the owner's review): each editor's load and the clients in landing waiting for an editor are folds; opened here to read them.
const openQaFolds = (p) => p.evaluate(() => { for (const d of document.querySelectorAll('#load-list details, #assign-list details')) d.open = true; });

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const TUE = new Date('2026-10-20T10:00:00+03:00');
const THU = new Date('2026-10-22T10:00:00+03:00');
let clockNow = TUE;
const t0 = Date.now();
const serverNow = () => new Date(clockNow.getTime() + (Date.now() - t0)).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const IL = (s) => new Date(`${s}+03:00`).toISOString();

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', nirel: 'nirel' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: !['nadia', 'yariv', 'ilai'].includes(person), phone: null }));
// Ilai has no vault flag, as on the live site (6.10.2026): his card reads the statuses
// through access_status_for_work() and says plainly that the passwords are not his.
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};

// ── Clients ───────────────────────────────
const client = (fields) => ({
  id: randomUUID(), name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: IL('2026-10-01T09:00:00'), char_at: IL('2026-10-05T10:00:00'), shoot_at: null,
  contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null, created_at: IL('2026-10-01T09:00:00'),
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 25, graphics: 35, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  ...fields,
});
const checks = [];
const keysOf = (c, ids) => applicableProcesses(c).filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const one = (c, key, at, note = null, by = 'irit@astrateg.test') => {
  const i = checks.findIndex((x) => x.client_id === c.id && x.item_key === key);
  const row = { client_id: c.id, item_key: key, state: 'done', note, by_email: by, at };
  if (i >= 0) checks[i] = row; else checks.push(row);
};
const all = (c, ids, at, note = 'ייבוא') => { for (const k of keysOf(c, ids)) one(c, k, at, note); };
const UPTO_SHOOT = ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p11b', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19b', 'p20', 'p21'];

// Videos with Ofir since 09:30 (assigned to Nadia on Sunday).
const V = client({ name: 'מספרת רון', editor: 'nadia', shoot_at: IL('2026-10-18T10:00:00'), address: 'הרצל 10, תל אביב' });
all(V, [...UPTO_SHOOT, 'p19', 'p23'], IL('2026-10-18T09:00:00'));
all(V, ['p22a'], IL('2026-10-18T12:00:00'), null);
all(V, ['p22'], IL('2026-10-20T09:00:00'), null);
for (const k of ['p24.folder', 'p24.drive', 'p24.notify']) one(V, k, IL('2026-10-20T09:30:00'), null, 'nadia@astrateg.test');
// The rest of the graphics, ready for Ofir since 09:00.
const G = client({ name: 'קפה גליה', shoot_at: IL('2026-10-15T10:00:00') });
all(G, UPTO_SHOOT, IL('2026-10-15T09:00:00'));
one(G, 'p23.made', IL('2026-10-20T09:00:00'), null, 'ilai@astrateg.test');
// Natali's shoot yesterday: waiting for an editor (Nirel preselected).
const quoteN = { id: randomUUID(), selection: { paid: [], free: { simeonJoin: false } } };
const N = client({ name: 'סטודיו נטלי', shoot_type: 'natali', shoot_at: IL('2026-10-19T10:00:00'), quote_id: quoteN.id });
all(N, UPTO_SHOOT, IL('2026-10-19T09:00:00'));
all(N, ['p19'], IL('2026-10-19T15:00:00'), null);
// The day was closed from the card with "the drive is back with Lior" as "לא רלוונטי": Lior never confirmed it.
// So Ofir's assignment does not close Lior's own item of 22א for him (since protocol v9 it does when he
// confirmed), and 22א stays open on that item, as it did in this scenario before.
checks.find((x) => x.client_id === N.id && x.item_key === 'p19.took').state = 'na';
// Ofir's characterization at 12:00 today.
const C = client({ name: 'גן ורד', char_at: IL('2026-10-20T12:00:00'), deal_at: IL('2026-10-19T09:00:00'), created_at: IL('2026-10-19T09:00:00'), address: 'ויצמן 5, רחובות' });
all(C, ['p01', 'p02', 'p03'], IL('2026-10-19T09:10:00'), null);
// Paused editing since yesterday afternoon (Yariv).
const P = client({ name: 'סטודיו פז', editor: 'yariv', shoot_at: IL('2026-10-15T10:00:00') });
all(P, [...UPTO_SHOOT, 'p19', 'p23'], IL('2026-10-15T09:00:00'));
all(P, ['p22a'], IL('2026-10-18T09:30:00'), null);
one(P, 'p22.pause', IL('2026-10-19T15:00:00'), JSON.stringify({ stage: 'חצי מהסרטונים', left: '12 סרטונים', why: 'משימה דחופה' }), 'yariv@astrateg.test');
// A campaign that is live (for Tuesday's check), imported.
const L = client({ name: 'חנות ותיקה', deal_at: IL('2026-03-01T09:00:00'), char_at: IL('2026-03-03T10:00:00'), shoot_at: IL('2026-03-10T10:00:00') });
all(L, [...UPTO_SHOOT, 'p19', 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p30'], IL('2026-10-01T09:00:00'));
one(L, 'p31.call', IL('2026-10-19T12:00:00'), null, 'lior@astrateg.test');
// Ilai's characterization day: the meeting at 08:00 ended at 08:55 with the access.
const I = client({ name: 'מאפיית שחר', char_at: IL('2026-10-20T08:00:00'), deal_at: IL('2026-10-19T09:00:00'), created_at: IL('2026-10-19T09:00:00'), has_logo: false });
all(I, ['p01', 'p02', 'p03'], IL('2026-10-19T09:10:00'), null);
all(I, ['p04'], IL('2026-10-20T08:55:00'), null);
one(I, 'p05.access', IL('2026-10-20T08:55:00'), null, 'ofir@astrateg.test');
// The final versions in the Drive, for Ilai's "קיבלתי".
const F = client({ name: 'גלידה שמש', editor: 'nadia', shoot_at: IL('2026-10-11T10:00:00') });
all(F, [...UPTO_SHOOT, 'p19', 'p22a', 'p22', 'p23', 'p24', 'p25', 'p26'], IL('2026-10-12T09:00:00'));
for (const k of ['p27.approved', 'p27.final']) one(F, k, IL('2026-10-20T09:15:00'), null, 'nadia@astrateg.test');

const task = (c, fields) => ({
  id: randomUUID(), client_id: c.id, title: '', owner: 'lior', due_on: null, done_at: null, done_by_email: null,
  created_by_email: 'ofir@astrateg.test', created_at: IL('2026-10-20T09:00:00'), source: null, brief: null, urgent: false, started_at: null, ...fields,
});
const tEsc = task(V, { title: 'לקוח מתלונן (תהליך 25 · בקרת איכות על הסרטונים): הלקוח כועס על הכתוביות בסרטונים הקודמים', source: 'escalation', urgent: true, created_by_email: 'irit@astrateg.test' });
const tUrgent = task(G, { title: 'לפתוח ללקוח TikTok ולהכניס את הגישה לכספת', owner: 'ilai', urgent: true, created_by_email: 'irit@astrateg.test' });
const tNoDue = task(G, { title: 'לבדוק את הצבעים בגרפיקות', owner: 'irit', created_by_email: 'ofir@astrateg.test', created_at: IL('2026-10-19T11:00:00') });
const accessRows = [
  { id: randomUUID(), client_id: G.id, network: 'instagram', label: null, username: 'galia', status: 'broken', note: null, updated_by: 'irit@astrateg.test', updated_at: IL('2026-10-19T11:00:00'), created_at: IL('2026-10-01T09:00:00'), secret_id: 'x' },
  { id: randomUUID(), client_id: I.id, network: 'instagram', label: null, username: 'shahar', status: 'ok', note: null, updated_by: 'ilai@astrateg.test', updated_at: IL('2026-10-20T09:50:00'), created_at: IL('2026-10-20T09:40:00'), secret_id: 'y' },
  { id: randomUUID(), client_id: I.id, network: 'tiktok', label: null, username: null, status: 'missing', note: null, updated_by: 'ilai@astrateg.test', updated_at: IL('2026-10-20T09:52:00'), created_at: IL('2026-10-20T09:40:00'), secret_id: null },
];

const db = {
  staff,
  clients: [V, G, N, C, P, L, I, F],
  protocol_checks: checks,
  protocol_log: checks.map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at })),
  client_tasks: [tEsc, tUrgent, tNoDue],
  office_reviews: [{ day: '2026-10-18', kind: 'p33', note: null, by_email: 'ofir@astrateg.test', at: IL('2026-10-18T15:00:00'), note_by: null, note_at: null }],
  client_status_notes: [],
  client_messages: [],
  client_access: accessRows,
  client_access_log: [],
  client_date_changes: [],
  client_questions: [],
  quotes: [{ id: quoteN.id, number: 'AST-1', model: { selection: quoteN.selection } }],
  // Package 1: "מוכן לבדיקה" opens only once a graphic of the batch is in the client's
  // files. Ilai's first graphic for מאפיית שחר is already up (the upload itself and
  // the lock: tests/package1-e2e.mjs).
  client_files: [{ id: 'f0000000-0000-4000-8000-000000000001', client_id: I.id, kind: 'deliverable_graphic', label: null, storage_path: `${I.id}/deliverable_graphic/f0000000-0000-4000-8000-000000000001-post-1.png`, mime: 'image/png', size_bytes: 2048, posted_on: null, link: null, uploaded_by: 'ilai@astrateg.test', created_at: IL('2026-10-20T09:40:00'), deleted_at: null }],
  office_passes: [],
  // How many videos each editor edited (public.editor_progress, 22.10.2026): Nadia on Ron's, Yariv on Paz's.
  editor_progress: [
    { client_id: V.id, editor: 'nadia', round: 1, edited: 18, updated_at: IL('2026-10-20T09:00:00'), updated_by: 'nadia@astrateg.test' },
    { client_id: P.id, editor: 'yariv', round: 1, edited: 7, updated_at: IL('2026-10-19T15:00:00'), updated_by: 'yariv@astrateg.test' },
  ],
  // A monthly client's numbers per month (public.editor_progress_month, 20261104100000_editor_progress_month.sql).
  editor_progress_month: [],
  task_decisions: [],
  change_requests: [],
  // The old system's signed documents (public.legacy_contracts, 20261105100000_legacy_contracts.sql): imported in the last step.
  legacy_contracts: [],
  // The old system's characterizations (public.legacy_characterizations, 20261109100000_legacy_characterizations.sql): imported in the last step.
  legacy_characterizations: [],
};

// ── Fake PostgREST ─────────────────────────
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
function match(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
  if (v.startsWith('gte.')) return String(r[k] ?? '') >= unq(v.slice(4));
  if (v.startsWith('in.(')) return new Set(v.slice(4, -1).split(',').map(unq)).has(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v.startsWith('like.')) { const pat = v.slice(5).replace(/\*/g, '%'); return new RegExp(`^${pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(String(r[k])); }
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.slice(1, -1).split(',').map((x) => { const [col, ...rest] = x.split('.'); return [col, rest.join('.')]; });
      out = out.filter((r) => parts.some(([col, cond]) => match(r, col, cond)));
      continue;
    }
    out = out.filter((r) => match(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}
const KEYS = { protocol_checks: ['client_id', 'item_key'], office_reviews: ['day', 'kind'], client_status_notes: ['client_id', 'week'], office_passes: ['day'], task_decisions: ['task_id'] };

// public.clients as the database answers it since 20260930210000_hardening.sql (tests/fake-clients.mjs).
const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(headers);
  const now = serverNow();
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  const vault = !!me && !!staff.find((r) => r.email === me.email)?.vault;
  if (p === '/rest/v1/rpc/can_use_vault' || p === '/rest/v1/rpc/can_use_client_vault') return json(200, vault);
  if (p === '/rest/v1/rpc/access_status_for_work') {
    const person = staff.find((r) => r.email === me?.email)?.person;
    const office = !!me && (person === null || ['irit', 'lior', 'ofir', 'ilai'].includes(person));
    const ids = body?.p_clients ? new Set(body.p_clients) : null;
    return json(200, !office ? [] : db.client_access.filter((a) => !ids || ids.has(a.client_id))
      .map((a) => ({ client_id: a.client_id, network: a.network, label: a.label, status: a.status, updated_at: a.updated_at })));
  }
  if (p === '/rest/v1/rpc/access_save') {
    const a = db.client_access.find((x) => x.id === body.p_id);
    Object.assign(a, { status: body.p_status, note: body.p_note, updated_by: me.email, updated_at: now });
    return json(200, a.id);
  }
  if (p === '/rest/v1/rpc/ofir_meetings') {
    return json(200, db.clients.filter((c) => c.char_at && (c.characterizer || 'ofir') === 'ofir').map((c) => {
      const saved = db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === 'p04.saved' && x.at > c.char_at);
      return { starts_at: c.char_at, ends_at: saved ? saved.at : new Date(new Date(c.char_at).getTime() + 2 * 36e5).toISOString() };
    }));
  }
  // An editor's own number on a shoot they edit (20261101100000_editor_progress.sql).
  if (p === '/rest/v1/rpc/editor_progress_set') {
    const person = staff.find((r) => r.email === me?.email)?.person;
    const c = db.clients.find((x) => x.id === body.p_client);
    const round = body.p_round || 1;
    if (!person || !c || round !== 1 || ![c.editor, c.editor2].includes(person)) return json(403, { code: '42501', message: 'not allowed' });
    let row = db.editor_progress.find((x) => x.client_id === c.id && x.editor === person && x.round === round);
    if (!row) db.editor_progress.push(row = { client_id: c.id, editor: person, round });
    Object.assign(row, { edited: body.p_edited, updated_at: now, updated_by: me.email });
    return json(200, row);
  }
  // A monthly client: the editor's own number in a month (20261104100000_editor_progress_month.sql).
  if (p === '/rest/v1/rpc/editor_progress_month_set') {
    const person = staff.find((r) => r.email === me?.email)?.person;
    const c = db.clients.find((x) => x.id === body.p_client);
    const month = body.p_month || monthKey(new Date(now));
    if (!person || !c || ![c.editor, c.editor2].includes(person)) return json(403, { code: '42501', message: 'not allowed' });
    let row = db.editor_progress_month.find((x) => x.client_id === c.id && x.editor === person && x.month === month);
    if (!row) db.editor_progress_month.push(row = { client_id: c.id, editor: person, month });
    Object.assign(row, { edited: body.p_edited, updated_at: now, updated_by: me.email });
    return json(200, row);
  }
  // The old system's documents: the owner only; again on the same old id changes the row; no IP, browser, phone or company number kept.
  if (p === '/rest/v1/rpc/legacy_contract_import') {
    const person = staff.find((r) => r.email === me?.email);
    if (!person || person.person !== null) return json(403, { code: '42501', message: 'not allowed' });
    if (!db.clients.some((c) => c.id === body.p_client)) return json(400, { code: '22023', message: 'no such client' });
    const d = body.p_doc;
    const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k]) => !['signedip', 'signeduseragent', 'ip', 'useragent', 'ua', 'phone', 'hp'].includes(k.toLowerCase())).map(([k, x]) => [k, scrub(x)])) : v);
    // The state (20261110100000_batch_2710.sql): not signed keeps no signature and no signing time.
    const status = { 'נחתם': 'signed', 'ממתין לחתימה': 'pending', 'הצעת מחיר': 'quote', '': 'signed' }[String(d.status ?? '').trim()];
    if (!status) return json(400, { code: '22023', message: 'an unknown state' });
    const signed = status === 'signed';
    const row = { id: Number(d.id), client_id: body.p_client, doc_type: d.docType || 'contract', doc_number: d.docNumber || null, signer_name: d.signerName || d.signers?.[0]?.name || null,
      signed_at: signed ? d.signedAt || null : null, total_amount: d.totalAmount ?? null, retainer: d.retainer ?? null, signature: signed ? d.signature || null : null, doc: scrub(d), imported_at: now, imported_by: me.email, status };
    const i = db.legacy_contracts.findIndex((x) => x.id === row.id);
    if (i >= 0) db.legacy_contracts[i] = row; else db.legacy_contracts.push(row);
    return json(200, { id: row.id, client_id: row.client_id, doc_type: row.doc_type });
  }
  // The old system's characterization: the owner only; again on the same client changes the row; no phone or e-mail kept.
  if (p === '/rest/v1/rpc/legacy_characterization_import') {
    const person = staff.find((r) => r.email === me?.email);
    if (!person || person.person !== null) return json(403, { code: '42501', message: 'not allowed' });
    if (!db.clients.some((c) => c.id === body.p_client)) return json(400, { code: '22023', message: 'no such client' });
    const d = body.p_doc;
    const strip = (t) => (typeof t === 'string' && t.trim() ? t.replace(/\r\n?/g, '\n').trim()
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[הוסר]')
      .replace(/(?<![0-9])(?:(?:\+|00)?972[ .-]{0,3}(?:\(0\)[ .-]{0,3})?|\(?0)[0-9]{1,2}\)?[ .-]{0,3}[0-9]{3}[ .-]{0,3}[0-9]{3,4}(?![0-9])/g, '[הוסר]') : null);
    const answers = d.charterAnswers && typeof d.charterAnswers === 'object'
      ? Object.fromEntries(Object.entries(d.charterAnswers).map(([k, v]) => [k, strip(v)]).filter(([, v]) => v)) : null;
    const row = { client_id: body.p_client, filled_text: strip(d.charterFilledText), filled_at: d.charterFilledAt || null, brief_text: strip(d.briefText), brief_at: d.briefUpdatedAt || null,
      script_text: strip(d.charterScript), script_at: d.charterScriptAt || null, summary_text: strip(d.charterSummary), answers: answers && Object.keys(answers).length ? answers : null, imported_at: now, imported_by: me.email };
    const i = db.legacy_characterizations.findIndex((x) => x.client_id === row.client_id);
    if (i >= 0) db.legacy_characterizations[i] = row; else db.legacy_characterizations.push(row);
    return json(200, { client_id: row.client_id });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: '42P01', message: 'relation does not exist' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (table === 'quotes') rows = rows.map((q) => ({ id: q.id, number: q.number, selection: q.model.selection }));
    if (table === 'client_access') rows = vault ? rows : [];
    // Every member of staff but the field sales agents (20261109100000_legacy_characterizations.sql).
    if (table === 'legacy_characterizations') { const pr = staff.find((r) => r.email === me.email); rows = pr && !['stav', 'amos'].includes(pr.person) ? rows : []; }
    if (table === 'legacy_contracts') { const pr = staff.find((r) => r.email === me.email); rows = pr && (pr.person === null || ['irit', 'lior', 'ofir', 'ilai'].includes(pr.person)) ? rows : []; }
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const r of rows) {
      let row;
      if (table === 'protocol_checks') {
        row = { note: null, ...r, by_email: me.email, at: now };
        db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note ?? null, by_email: me.email, at: now });
      } else if (table === 'client_tasks') {
        row = { done_at: null, done_by_email: null, source: null, brief: null, urgent: false, due_on: null, started_at: null, ...r, id: randomUUID(), created_at: now, created_by_email: me.email };
      } else if (table === 'office_passes') {
        const prev = db.office_passes.find((x) => x.day === r.day);
        row = { snapshot: null, completed_at: null, ...(prev || {}), ...r, by_email: prev?.by_email || me.email, at: prev?.at || now };
        if (r.completed_at && !prev?.completed_at) row.completed_at = now;
      } else if (table === 'change_requests') {
        row = { decision: null, decided_by_email: null, decided_at: null, client_id: null, ...r, id: randomUUID(), created_by_email: me.email, created_at: now };
      } else {
        row = { ...r, by_email: me.email, at: now };
      }
      const key = KEYS[table];
      const i = key ? db[table].findIndex((x) => key.every((k) => x[k] === row[k])) : -1;
      if (i >= 0) db[table][i] = row; else db[table].push(row);
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    for (const r of rows) {
      Object.assign(r, body);
      if (table === 'client_tasks' && 'done_at' in body) { r.done_at = body.done_at ? now : null; r.done_by_email = body.done_at ? me.email : null; }
      if (table === 'client_tasks' && 'started_at' in body) r.started_at = body.started_at ? now : null;
      if (table === 'change_requests' && 'decision' in body) { r.decided_by_email = me.email; r.decided_at = now; }
    }
    return reply(rows);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === 'protocol_checks') for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: me.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(time = TUE, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>wa</p>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// Visible form controls without a name a screen reader can say (a <label>, aria-label(ledby) or title).
const unlabeled = (page, root = 'body') => page.evaluate((r) => [...document.querySelectorAll(`${r} input:not([type=hidden]), ${r} select, ${r} textarea`)]
  .filter((e) => e.offsetParent && !e.closest('.sr-only'))
  .filter((e) => ![...(e.labels || [])].some((l) => l.textContent.trim()) && !e.getAttribute('aria-label')?.trim()
    && !(e.getAttribute('aria-labelledby') || '').split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim()) && !e.title?.trim())
  .map((e) => `${e.tagName}#${e.id}.${e.className}`), root);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const octx = await newContext();
const ofir = await newPage(octx);

// Since 6.10.2026 Ofir lands on "המשימות שלי" (it was his queue), and the queue is one tap away in his personal menu.
await step('Ofir\'s queue, one tap from "המשימות שלי": what waits for his check against the one-hour target, first due first', async () => {
  await signIn(ofir, 'clients.html', 'ofir');
  await ofir.waitForSelector('#profile-switch[data-to="manager"]');
  await ofir.waitForSelector('#view-mine:not([hidden])');
  assert.match(ofir.url(), /clients\.html(#mine)?$/);
  await ofir.click('#side-qa');
  await ofir.waitForURL(/qa\.html$/);
  await ofir.waitForSelector('#qa-list .of-card');
  const cards = await ofir.locator('#qa-list > li.of-card').evaluateAll((els) => els.map((e) => [e.querySelector('.wclient').textContent, e.querySelector('.wtitle').textContent, e.querySelector('.of-line').textContent]));
  assert.deepEqual(cards.map((x) => x.slice(0, 2)), [['קפה גליה', 'יתרת הגרפיקות'], ['מספרת רון', 'סרטונים']]);
  // The graphics are on Ofir's fast ladder (protocol v9): ten minutes from the hand-over at 09:00, long passed by 10:00.
  assert.match(cards[0][2], /^באיחור · ליאור עודכן · הגיע היום 09:00 · לאשר עד היום 09:10/);
  assert.match(cards[1][2], /^מחכה 30 דק׳ מתוך שעה · בקרה עד היום 10:30/);
  assert.equal(await ofir.locator('#qa-list > li').first().locator('.s-overdue').count(), 1);
  // Today's characterization, with navigation; the Natali shoot waiting for an editor, Nirel preselected.
  assert.match(await ofir.locator('#char-list').innerText(), /12:00[^]*גן ורד[^]*ויצמן 5, רחובות/);
  assert.match(await ofir.getAttribute('#char-list a[href^="https://waze.com"]', 'href'), /waze\.com\/ul\?q=/);
  assert.match(await ofir.locator('#assign-list').innerText(), /סטודיו נטלי[^]*ניראל מסומנת מראש/);
  // Nadia: Ron's videos are with Ofir (day 2 of 4, closing); Shemesh is late (day 6 of 4). Yariv's paused job.
  await openQaFolds(ofir);
  assert.match(await ofir.locator('#load-list').innerText(), /נדיה\s*2 לקוחות בעריכה[^]*גלידה שמש · יום 6 מתוך 4[^]*מספרת רון · יום 2 מתוך 4 · תיקונים וסגירה · נערכו 18\/25/);
  assert.match(await ofir.locator('#load-list').innerText(), /יריב\s*לקוח אחד בעריכה · אחת עצורה\s*סטודיו פז · יום 2 מתוך 2 · נערכו 7\/25 עצורה/);
  // An editor with no number yet: nothing is said (Shemesh).
  assert.doesNotMatch(await ofir.locator('#load-list').innerText(), /גלידה שמש[^\n]*נערכו/);
  await shot(ofir, 'office-01-qa');
});

await step('return for fixes: approving needs all eleven checks (six, and the five critical mistakes of protocol v10); two issues, due today 18:00, round 1', async () => {
  await ofir.click('#qa-list > li:nth-child(2) button');
  await ofir.waitForSelector('#dlg-qa[open]');
  assert.equal(await ofir.locator('#qa-checks input').count(), 11);
  await ofir.locator('#qa-checks input').first().check();
  await ofir.waitForFunction(() => !document.querySelector('#qa-checks input').disabled);
  await ofir.click('#qa-approve');
  assert.match(await ofir.locator('#qa-err').innerText(), /כל 11 הבדיקות \(חסרות 10\)/);
  await ofir.click('#qa-to-return');
  assert.equal(await ofir.locator('#qa-return-h').innerText(), 'החזרה לתיקון · סבב 1');
  assert.equal(await ofir.inputValue('#qa-due'), '2026-10-20T18:00');
  await ofir.fill('#qa-ref-1', '3');
  await ofir.fill('#qa-text-1', 'הטלפון בסגיר שגוי');
  await ofir.click('#qa-add');
  await ofir.fill('#qa-ref-2', '7');
  await ofir.fill('#qa-text-2', 'כתוביות חתוכות');
  await ofir.click('#qa-send-return');
  await toastHas(ofir, 'הוחזר לתיקון (סבב 1). הרשימה עוברת ל'); // not "<שם> מקבל/ת את הרשימה"
  assert.doesNotMatch(await ofir.locator('#toast').innerText(), /מקבל\/ת/);
  const r = checkOf(V, 'p25.return.1');
  assert.deepEqual(JSON.parse(r.note).issues, [{ ref: '3', text: 'הטלפון בסגיר שגוי' }, { ref: '7', text: 'כתוביות חתוכות' }]);
  assert.equal(JSON.parse(r.note).due, '2026-10-20T15:00:00.000Z');
  // The check he ticked is of the old version: cleared.
  assert.equal(checkOf(V, 'p25.q.editing'), null);
  await ofir.waitForFunction(() => document.querySelectorAll('#qa-list > li.of-card').length === 1);
  assert.match(await ofir.locator('#qa-fixing').innerText(), /הוחזרו לתיקון ועוד לא חזרו \(1\)/);
});

await step('the editor sees the list in the client card and marks each "תוקן"; the last one sends it back to Ofir', async () => {
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, `client.html?id=${V.id}#p24`, 'nadia');
  await nadia.waitForSelector('.fix-list');
  assert.match(await nadia.locator('.fix-list').innerText(), /הוחזר לתיקון · סבב 1[^]*לתקן עד היום 18:00[^]*סרטון 3: הטלפון בסגיר שגוי[^]*סרטון 7: כתוביות חתוכות/);
  await nadia.locator('.fix-list .fix-btn').first().click();
  await toastHas(nadia, 'סומן שתוקן.');
  assert.ok(checkOf(V, 'p25.fixed.1.0'));
  await nadia.waitForFunction(() => document.querySelectorAll('.fix-list .fix-btn').length === 1);
  await nadia.locator('.fix-list .fix-btn').click();
  await toastHas(nadia, 'חזרה לבדיקה של אופיר');
  assert.ok(checkOf(V, 'p25.fixed.1'));
  await nadia.waitForSelector('.qa-now');
  assert.match(await nadia.locator('.qa-now').innerText(), /אצל אופיר לבדיקה חוזרת \(אחרי סבב 1\)/);
  await shot(nadia, 'office-02-editor-fixed');
  await nctx.close();
});

await step('the re-check: back in the queue as check 2 with what was returned; all six checks, approved, handoff to Irit', async () => {
  await ofir.click('#btn-refresh');
  await ofir.waitForFunction(() => document.querySelectorAll('#qa-list > li.of-card').length === 2);
  const v = ofir.locator('#qa-list > li', { hasText: 'מספרת רון' });
  assert.match(await v.innerText(), /בדיקה 2 · אחרי תיקון/);
  await v.locator('button').click();
  await ofir.waitForSelector('#dlg-qa[open]');
  assert.match(await ofir.locator('#qa-prev').innerText(), /מה הוחזר בסבב 1[^]*סרטון 3: הטלפון בסגיר שגוי/);
  for (const box of await ofir.locator('#qa-checks input').all()) { await box.check(); await ofir.waitForFunction((el) => !el.disabled, await box.elementHandle()); }
  await ofir.click('#qa-approve');
  await toastHas(ofir, 'אושר. עירית מקבלת');
  assert.ok(checkOf(V, 'p25.approved'));
  await ofir.waitForSelector('#handoff:not([hidden])');
  assert.match(await ofir.locator('#handoff').innerText(), /לשלוח לעירית בוואטסאפ[^]*לשלוח לליאור בוואטסאפ/);
  await ofir.click('#handoff-close');
});

await step('assignment: Nirel preselected for Natali; Nadia with no reason (optional since 21.10.2026); the folder task and the WhatsApp to the editor', async () => {
  // The card suggests the rule's own choice, one confirmation away; "עורך אחר" opens the dialog.
  assert.match(await ofir.locator('#assign-list .as-sug').innerText(), /מומלץ: ניראל[^]*צילום של נטלי: ניראל מסומנת מראש/);
  assert.equal((await ofir.locator('#assign-list .as-go').innerText()).trim(), 'שיוך לניראל');
  await ofir.click('#assign-list [id^="as-open-"]');
  await ofir.waitForSelector('#dlg-assign[open]');
  assert.equal(await ofir.isChecked('#as-e-nirel'), true);
  assert.equal(await ofir.isVisible('#as-joint'), true);
  assert.deepEqual(await ofir.locator('#as-editors input').evaluateAll((els) => els.map((e) => e.value)), ['nadia', 'yariv', 'anna', 'nirel']);
  await ofir.check('#as-e-nadia');
  // The reason is asked for, never required: the hint stays, the assignment goes through without it.
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  assert.equal(await ofir.innerText('#as-reason-hint'), 'בצילום של נטלי ניראל מסומנת מראש. בשיוך לעורך אחר כדאי לרשום למה.');
  await ofir.click('#as-submit');
  await toastHas(ofir, 'סטודיו נטלי שויך לנדיה');
  assert.equal(db.clients.find((c) => c.id === N.id).editor, 'nadia');
  assert.ok(checkOf(N, 'p22a.assigned') && checkOf(N, 'p22a.load'));
  assert.equal(checkOf(N, 'p22a.irit').note, 'נסגר לבד: השיוך נרשם במערכת');
  // No reason written: no reason mark (a written one is kept, as the swap below shows).
  assert.equal(checkOf(N, 'p22a.reason'), null);
  // The videos stay in the client's Drive (the owner's decision of 7.10.2026): Ofir's folder task is opened, as before.
  const folder = db.client_tasks.find((t) => t.client_id === N.id && t.owner === 'ofir');
  assert.equal(folder.title, 'פתיחת תיקייה מסודרת בדרייב לעריכה (24)');
  assert.equal(folder.due_on, '2026-10-21');
  await ofir.waitForSelector('#handoff:not([hidden])');
  assert.match(await ofir.locator('#handoff').innerText(), /עורך שויך · נדיה[^]*לשלוח לנדיה בוואטסאפ/);
  const text = new URL(await ofir.getAttribute('.handoff-wa', 'href')).searchParams.get('text');
  assert.match(text, /סטודיו נטלי עובר לעריכה אצלך[^]*בדרייב של הלקוח ואצל אופיר לבקרה: [^]*סגירה, כולל תיקוני הלקוח: /);
  await ofir.click('#handoff-close');
  assert.match(await ofir.locator('#assign-list').innerText(), /אין לקוחות שמחכים לשיוך עורך/);
  await shot(ofir, 'office-03-assigned');
  // The folder task, done from "המשימות שלי", is item 24 "יש תיקייה מסודרת" too.
  await ofir.goto(`${BASE}clients.html#mine`);
  const box = `#w-${N.id}-${folder.id}`.replace(/[^\w#-]/g, '_');
  await ofir.waitForSelector(box);
  await ofir.check(box);
  await toastHas(ofir, 'סומן כבוצע');
  assert.ok(db.client_tasks.find((t) => t.id === folder.id).done_at);
  assert.ok(checkOf(N, 'p24.folder'));
  await ofir.goto(`${BASE}qa.html`);
  await ofir.waitForSelector('#qa-list .of-card');
});

await step('"החלפת עורך" from the load list: the same dialog and rules; on time the editing days start over, and the new editor is told', async () => {
  // Natali's shoot, assigned to Nadia a moment ago: back to Nirel.
  const before = checkOf(N, 'p22a.assigned').at;
  await openQaFolds(ofir);
  const nadiaCard = ofir.locator('#load-list .of-editor', { hasText: 'נדיה' });
  assert.match(await nadiaCard.innerText(), /סטודיו נטלי · שויך היום[^]*החלפת עורך/);
  await ofir.click(`#sw-${N.id}`);
  await ofir.waitForSelector('#dlg-assign[open]');
  assert.equal(await ofir.innerText('#as-h'), 'החלפת עורך · סטודיו נטלי');
  assert.match(await ofir.innerText('#as-meta'), /עכשיו אצל נדיה · שויך היום/);
  assert.equal(await ofir.innerText('#as-submit'), 'החלפה');
  // The one who has it now cannot be chosen; Nirel is preselected for Natali, with each editor's load.
  assert.equal(await ofir.isDisabled('#as-e-nadia'), true);
  assert.match(await ofir.locator('label[for="as-e-nadia"]').innerText(), /העורך הנוכחי/);
  assert.equal(await ofir.isChecked('#as-e-nirel'), true);
  assert.match(await ofir.locator('label[for="as-e-yariv"]').innerText(), /לקוח אחד בעריכה/);
  // The clocks: not late, so the days are counted again from today (as the first assignment does), and it says until when.
  assert.equal(await ofir.isVisible('#as-clock-wrap'), true);
  assert.equal(await ofir.isChecked('#as-clock-restart'), true);
  assert.equal(await ofir.isHidden('#as-clock-late'), true);
  assert.match(await ofir.innerText('#as-clock-restart-label'), /^לספור מחדש מהיום: יעד /);
  assert.match(await ofir.innerText('#as-clock-keep-label'), /^להשאיר את המועד: יעד /);
  // Another editor for Natali: a reason is asked for, not required.
  await ofir.check('#as-e-yariv');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  await ofir.check('#as-e-nirel');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  await ofir.fill('#as-reason', 'נדיה עמוסה השבוע');
  await ofir.waitForTimeout(1100); // a later second, so the new stamp differs
  await ofir.click('#as-submit');
  await toastHas(ofir, 'סטודיו נטלי עבר מנדיה לניראל. מועדי העריכה נספרים מהיום');
  assert.equal(db.clients.find((c) => c.id === N.id).editor, 'nirel');
  assert.ok(checkOf(N, 'p22a.assigned').at > before, 'the assignment is stamped again');
  const why = JSON.parse(checkOf(N, 'p22a.reason').note);
  assert.deepEqual([why.editor, why.from, why.swap, why.restart, why.late, why.prev], ['nirel', 'nadia', true, true, false, before]);
  assert.equal(why.reason, 'החלפת עורך: מנדיה לניראל · נדיה עמוסה השבוע · מועדי העריכה נספרים מחדש מהיום');
  // As after the first assignment: the WhatsApp to the (new) editor. No second folder task: the one of the first assignment (done above) is the client's folder.
  await ofir.waitForSelector('#handoff:not([hidden])');
  assert.match(await ofir.locator('#handoff').innerText(), /עורך שויך · ניראל[^]*לשלוח לניראל בוואטסאפ/);
  await ofir.click('#handoff-close');
  assert.equal(db.client_tasks.filter((t) => t.client_id === N.id && t.title.startsWith('פתיחת תיקייה')).length, 1);
  await openQaFolds(ofir);
  assert.match(await ofir.locator('#load-list .of-editor', { hasText: 'ניראל' }).innerText(), /סטודיו נטלי · שויך היום/);
  // The reminder engine: the notice "לקוח חדש בעריכה אצלך" is now Nirel's, not Nadia's.
  const byClient = {};
  for (const r of db.protocol_checks) (byClient[r.client_id] ||= {})[r.item_key] = r;
  const env = buildEnv({ clients: db.clients, checks: byClient, tasks: db.client_tasks.filter((t) => !t.done_at), staff: db.staff, access: [], reviews: db.office_reviews, statusNotes: [], now: new Date(new Date(serverNow()).getTime() + 60e3) });
  const told = candidates(env).filter((r) => r.rule === 'editing' && r.step === 'assigned' && r.clientId === N.id).map((r) => r.person);
  if (process.env.DEBUG_SWAP) console.log(candidates(env).filter((r) => r.rule === 'editing').map((r) => r.key));
  assert.deepEqual(told, ['nirel']);
});

await step('a swap never resets a late job silently: the deadlines stay unless Ofir chooses to count again and writes why', async () => {
  // Shemesh is with Nadia on day 6 of 4.
  const stamp = checkOf(F, 'p22a.assigned').at;
  await ofir.click(`#sw-${F.id}`);
  await ofir.waitForSelector('#dlg-assign[open]');
  assert.equal(await ofir.isChecked('#as-clock-keep'), true);
  assert.match(await ofir.innerText('#as-clock-late'), /העריכה כבר באיחור\. ההחלפה לא מאפסת את האיחור/);
  assert.match(await ofir.innerText('#as-clock-keep-label'), /\(באיחור\)$/);
  assert.equal(await ofir.isHidden('#as-joint-wrap'), true);
  assert.deepEqual(await ofir.locator('#as-editors input').evaluateAll((els) => els.map((e) => e.value)), ['nadia', 'yariv', 'anna', 'nirel']); // every editor, any shoot (21.10.2026)
  await ofir.check('#as-e-anna');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  // Counting again is his explicit choice, with a reason.
  await ofir.check('#as-clock-restart');
  assert.equal(await ofir.innerText('#as-reason-label'), 'סיבה (חובה)');
  await ofir.click('#as-submit');
  assert.match(await ofir.innerText('#as-err'), /העריכה כבר באיחור\. כדי לספור את המועדים מחדש כתבו למה\./);
  assert.equal(db.clients.find((c) => c.id === F.id).editor, 'nadia');
  await shot(ofir, 'office-03b-swap-late');
  // Left as it is: the job moves and stays late.
  await ofir.check('#as-clock-keep');
  await ofir.click('#as-submit');
  await toastHas(ofir, 'גלידה שמש עבר מנדיה לאנה. המועדים לא השתנו: העריכה נשארת באיחור.');
  assert.equal(db.clients.find((c) => c.id === F.id).editor, 'anna');
  assert.equal(checkOf(F, 'p22a.assigned').at, stamp, 'the assignment mark is untouched: the clocks did not move');
  const why = JSON.parse(checkOf(F, 'p22a.reason').note);
  assert.deepEqual([why.editor, why.from, why.restart, why.late, why.reason], ['anna', 'nadia', false, true, 'החלפת עורך: מנדיה לאנה · המועדים לא השתנו, העריכה נשארת באיחור']);
  // No WhatsApp is offered here: the handoff of an assignment (app/handoffs.js) is for an editing that has not reached Ofir yet.
  await ofir.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await ofir.isHidden('#handoff'), true);
  await openQaFolds(ofir);
  assert.match(await ofir.locator('#load-list .of-editor', { hasText: 'אנה' }).innerText(), /גלידה שמש · יום 6 מתוך 4/);
  assert.equal(await ofir.locator('#load-list .of-editor', { hasText: 'אנה' }).locator('.of-jobs .late').count(), 1); // the job's own line (the head says "אחת באיחור" too, 20.10.2026)
  await shot(ofir, 'office-03c-swapped');
});

// Since 6.10.2026 Lior lands on "המשימות שלי" (it was "החלטות"), and "החלטות" is one tap away in his personal menu.
await step('Lior\'s "החלטות", one tap from "המשימות שלי": an exception through reason → decision → next action → close, and "התחלתי"', async () => {
  const lctx = await newContext();
  const lior = await newPage(lctx);
  await signIn(lior, 'clients.html', 'lior');
  await lior.waitForSelector('#profile-switch[data-to="manager"]');
  await lior.waitForSelector('#view-mine:not([hidden])');
  assert.match(lior.url(), /clients\.html(#mine)?$/);
  await lior.click('#side-decisions');
  await lior.waitForURL(/decisions\.html$/);
  await lior.waitForSelector('#ex-list .dc-card');
  const card = lior.locator('#ex-list .dc-card');
  assert.match(await card.innerText(), /מספרת רון[^]*לקוח מתלונן[^]*הלקוח כועס על הכתוביות/);
  assert.deepEqual(await card.locator('.dc-path li').evaluateAll((els) => els.map((e) => e.className)), ['is-now', '', '', '']);
  await card.locator('.start-btn').click();
  await toastHas(lior, 'נרשם שהתחלת');
  assert.ok(db.client_tasks.find((t) => t.id === tEsc.id).started_at);
  await lior.click(`#ex-${tEsc.id}-s`);
  await lior.fill(`#ex-${tEsc.id}-reason`, 'העורך לא בדק כתוביות');
  await lior.click(`#ex-${tEsc.id}-close`);
  assert.match(await lior.innerText(`#ex-${tEsc.id}-err`), /ואז ההחלטה/);
  await lior.fill(`#ex-${tEsc.id}-decision`, 'שיחה עם הלקוח ובדיקה חוזרת של כל הכתוביות');
  await lior.click(`#ex-${tEsc.id}-save`);
  await toastHas(lior, 'נשמר.');
  assert.deepEqual(await card.locator('.dc-path li').evaluateAll((els) => els.map((e) => e.className)), ['is-done', 'is-done', 'is-now', '']);
  await lior.fill(`#ex-${tEsc.id}-next`, 'להתקשר ללקוח ולהסביר');
  await lior.selectOption(`#ex-${tEsc.id}-owner`, 'irit');
  await lior.click(`#ex-${tEsc.id}-close`);
  await toastHas(lior, 'החריגה נסגרה. הפעולה הבאה אצל עירית.');
  const linked = db.client_tasks.find((t) => t.title === 'להתקשר ללקוח ולהסביר (בעקבות חריגה: לקוח מתלונן)');
  assert.equal(linked.owner, 'irit');
  assert.equal(linked.due_on, '2026-10-21');
  assert.deepEqual(db.task_decisions.map((d) => [d.task_id, d.reason, d.next_task_id]), [[tEsc.id, 'העורך לא בדק כתוביות', linked.id]]);
  assert.ok(db.client_tasks.find((t) => t.id === tEsc.id).done_at);
  assert.match(await lior.locator('#ex-list').innerText(), /אין חריגות פתוחות/);
  globalThis.lior = lior;
  globalThis.lctx = lctx;
});

await step('an urgent task not started in 30 office minutes is back with Lior; a login closed as partly fixed; paused editing moved', async () => {
  const lior = globalThis.lior;
  const ur = lior.locator('#ur-list .of-card');
  assert.match(await ur.innerText(), /קפה גליה[^]*עילאי[^]*חזרה אליך[^]*לא נלחץ ״התחלתי״ עד 09:30/);
  // Broken login: "תוקן חלקית" keeps it red and records what is missing.
  const acc = lior.locator('#ac-list .of-card');
  assert.match(await acc.innerText(), /קפה גליה[^]*Instagram/);
  await acc.locator('.dc-inline button').click();
  await toastHas(lior, 'כתבו מה עדיין חסר.');
  await acc.locator('input').fill('קוד אימות מהלקוח');
  await acc.locator('.dc-inline button').click();
  await toastHas(lior, 'נשמר כתוקן חלקית');
  const a = db.client_access.find((x) => x.client_id === G.id);
  assert.deepEqual([a.status, a.note], ['broken', 'תוקן חלקית, עדיין חסר: קוד אימות מהלקוח']);
  assert.deepEqual(JSON.parse(checkOf(G, 'p06.fixed.instagram').note), { partial: true, missing: 'קוד אימות מהלקוח', access: a.id });
  // Editing paused since yesterday: Ofir's proposal by load, and the deadlines moved by a day.
  const pz = lior.locator('#pz-list .of-card');
  // Nadia, not Anna: the two swaps above left Nadia with one job and gave Anna the late one, and the fewest open tasks decide.
  assert.match(await pz.innerText(), /סטודיו פז[^]*יריב[^]*עצורה מאז[^]*הצעת אופיר לפי העומס: נדיה/);
  await pz.locator('input[type=number]').fill('1');
  await pz.locator('button[type=submit]').click();
  await toastHas(lior, 'המועדים של סטודיו פז הוזזו ב־1 ימי עסקים');
  assert.deepEqual(JSON.parse(checkOf(P, 'p22a.shift').note), { days: 1, why: 'עריכה עצורה' });
  assert.equal(JSON.parse(checkOf(P, 'p22.decision').note).choice, 'move');
});

await step('the Tuesday campaign check, and the lists: the same items the reminder engine puts in them', async () => {
  const lior = globalThis.lior;
  assert.match(await lior.locator('#cp-body').innerText(), /חנות ותיקה/);
  await lior.click('#cp-done');
  await toastHas(lior, 'בדיקת הקמפיינים השבועית נרשמה.');
  assert.ok(db.office_reviews.some((r) => r.kind === 'campaigns' && r.day === '2026-10-20'));
  // What the engine lists for Lior now (the page's own clock), without the exceptions and paused editing.
  const byClient = {};
  for (const r of db.protocol_checks) (byClient[r.client_id] ||= {})[r.item_key] = r;
  const at = new Date(await lior.evaluate(() => Date.now()));
  const env = buildEnv({ clients: db.clients, checks: byClient, tasks: db.client_tasks.filter((t) => !t.done_at), staff: db.staff, access: db.client_access.filter((x) => x.status === 'broken'), reviews: db.office_reviews, statusNotes: db.client_status_notes, now: at });
  // Since the owner's page review of 20.10.2026 the cards are only what waits for his decision: late
  // items (his own, or others') and Ofir's quality-check queue are folded under them (splitLists).
  const listed = candidates(env).filter((r) => r.person === 'lior' && r.list && !['exception', 'paused'].includes(r.rule));
  const expected = [...new Set(splitLists(listed).decide.map((r) => r.title))];
  await lior.click('#btn-refresh');
  await lior.waitForFunction((n) => document.querySelectorAll('#ls-list .of-card').length === n, expected.length);
  const shown = await lior.locator('#ls-list .wclient').allInnerTexts();
  assert.deepEqual([...shown].sort(), [...expected].sort());
  // His own late items are one line with a link to his "באיחור" tab; the others' are one folded, counted line.
  const mine = listed.filter((r) => r.rule === 'late' && / · ליאור$/.test(r.title));
  const others = listed.filter((r) => ['late', 'qa'].includes(r.rule) && !mine.includes(r));
  assert.ok(mine.length >= 1 && others.length >= 1, 'something should be on the lists');
  assert.equal(await lior.innerText('#ls-mine'), `${mine.length === 1 ? 'פריט אחד שלך באיחור' : `${mine.length} פריטים שלך באיחור`}, בלשונית ״באיחור״`);
  assert.equal(await lior.getAttribute('#ls-mine a', 'href'), 'clients.html#late');
  assert.equal(await lior.innerText('#ls-others > summary .n'), String(others.length));
  await lior.click('#ls-others > summary');
  assert.deepEqual((await lior.locator('#ls-others li').allInnerTexts()).sort(), others.map((r) => r.title).sort());
  await shot(lior, 'office-04-decisions');
  await globalThis.lctx.close();
});

await step('Ilai: the characterization day card; the vault statuses check the access; page, the state of Metricool, graphics to Irit, the Gantt; "קיבלתי"', async () => {
  const ictx = await newContext();
  const ilai = await newPage(ictx);
  await signIn(ilai, 'clients.html#mine', 'ilai');
  await ilai.waitForSelector('.g-ilai .il-card');
  assert.equal(await ilai.innerText('#il-h').then((t) => t.split('\n')[0]), 'יום אפיון: שעתיים');
  const card = ilai.locator('.il-card', { hasText: 'מאפיית שחר' }).first();
  assert.match(await card.locator('summary').innerText(), /מאפיית שחר[^]*הבא: /);
  await toastHas(ilai, 'הגישות של מאפיית שחר סומנו כנבדקו, לפי הסטטוסים בכספת.');
  assert.equal(checkOf(I, 'p06.verified').note, 'נסגר לבד: כל הרשתות בכספת קיבלו סטטוס');
  await card.locator('summary').click();
  assert.match(await card.innerText(), /Instagram: תקינה[^]*TikTok: אין רשת/);
  // No vault flag: the statuses are there, the passwords are not his, and the card says so.
  assert.equal(staff.find((r) => r.person === 'ilai').vault, false);
  assert.match(await card.innerText(), /אין לך גישה לסיסמאות בכספת. בעל המשרד מפעיל אותה בעמוד הצוות./);
  assert.doesNotMatch(await card.innerText(), /אין עדיין רשתות בכספת/);
  assert.equal(await card.locator('a', { hasText: 'לכספת' }).count(), 0);
  await card.locator('label', { hasText: 'שם העמוד' }).locator('input').check();
  await ilai.waitForFunction(() => true);
  // Protocol v11 (21.10.2026): connecting to Metricool is Ofir's, with the accesses. Ilai's card only says it.
  assert.equal(await card.locator('input[type=url]').count(), 0);
  assert.match(await card.innerText(), /את החיבור ל־Metricool עושה אופיר/);
  for (let i = 0; i < 50 && !checkOf(I, 'p06.name'); i += 1) await ilai.waitForTimeout(100);
  assert.ok(checkOf(I, 'p06.name'));
  assert.equal(checkOf(I, 'p06.metricool'), null);
  await ilai.locator('.il-card', { hasText: 'מאפיית שחר' }).locator('button', { hasText: 'מוכן לבדיקה (לאופיר)' }).click();
  await toastHas(ilai, '9 הגרפיקות עברו לבדיקה של אופיר.');
  assert.ok(checkOf(I, 'p07.made'));
  await ilai.waitForSelector('#handoff:not([hidden])');
  assert.match(await ilai.locator('#handoff').innerText(), /לשלוח לאופיר בוואטסאפ/); // protocol v9: the first 9 graphics go to Ofir's check
  await ilai.click('#handoff-close');
  await ilai.locator('.il-card', { hasText: 'מאפיית שחר' }).locator('label', { hasText: 'גאנט התוכן נפתח במערכת' }).locator('input').check();
  await toastHas(ilai, 'שלד הגאנט סומן.');
  assert.ok(checkOf(I, 'p09.file') && checkOf(I, 'p09.c.time'));
  // The card covers these processes: they are not listed again below it.
  assert.equal(await ilai.locator('#mine-list .wproc[data-key$=":p07"]', { hasText: 'מאפיית שחר' }).count(), 0);
  // "קיבלתי" on the final versions closes the editing.
  await ilai.locator('.il-card', { hasText: 'גלידה שמש' }).locator('button', { hasText: 'קיבלתי' }).click();
  await toastHas(ilai, 'העריכה נסגרה.');
  assert.ok(checkOf(F, 'p27.toilai'));
  await shot(ilai, 'office-05-ilai');
  globalThis.ictx = ictx;
});

await step('the pass over the clients is Irit\'s (26.10.2026): the owner and Ofir look at it, with no button of the pass; nothing of it in their "המשימות שלי"', async () => {
  clockNow = THU;
  for (const who of ['owner', 'ofir']) {
    const vctx = await newContext(THU, { width: 390, height: 844 });
    const page = await newPage(vctx);
    await signIn(page, 'pass.html', who);
    await page.waitForSelector('#ps-list .ps-row');
    assert.equal(await page.innerText('#ps-view'), 'המעבר על הלקוחות הוא של עירית. כאן רואים איפה הוא עומד.');
    assert.match(await page.innerText('#ps-status'), /עירית עברה על 0 מתוך \d+ לקוחות/);
    // No button of the pass: not "עברתי", not "פתח משימה", not an update to Lior, not the rest.
    assert.equal(await page.locator('#ps-list button:not(.more-btn)').count(), 0, who);
    assert.equal(await page.locator('#ps-rest-btn').count(), 0, who);
    assert.doesNotMatch(await page.innerText('#ps-rest'), /עברתי על כל השאר/);
    assert.ok(await noHScroll(page), `${who}: the pass scrolls sideways at 390px`);
    if (who === 'owner' && OUT) {
      await page.waitForSelector('#login-block', { state: 'hidden' });
      await page.waitForTimeout(1200); // the sign-in screen fades out
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${OUT}/office-06b-pass-owner-view-390.png` });
    }
    // Nothing of the pass is a task of theirs: no card, no Thursday summary, no line.
    await page.goto(`${BASE}clients.html#mine`);
    await page.waitForSelector('#view-mine:not([hidden])');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#rv-pass-go, .thu-card').count(), 0, who);
    assert.doesNotMatch(await page.innerText('#view-mine'), /מעבר על הלקוחות|מעבר חובה של יום חמישי/, who);
    await vctx.close();
  }
  // Irit's own "המשימות שלי": the pass is due (none since Sunday), a card that leads to it.
  const ictx2 = await newContext(THU, { width: 390, height: 844 });
  const ir = await newPage(ictx2);
  await signIn(ir, 'clients.html#mine', 'irit');
  await ir.waitForSelector('#rv-pass-go');
  assert.equal(await ir.getAttribute('#rv-pass-go', 'href'), 'pass.html');
  assert.match(await ir.innerText('#mine-list'), /מעבר על הלקוחות · תהליך 33/);
  await ir.click('#rv-pass-go');
  await ir.waitForSelector('#ps-list .ps-row');
  assert.equal(await ir.locator('#ps-view').count(), 0);
  assert.ok(await ir.locator('#ps-list button', { hasText: /^עברתי$|פתח משימה/ }).count() > 0);
  if (OUT) {
    await ir.waitForTimeout(1200);
    await ir.evaluate(() => window.scrollTo(0, 0));
    await ir.screenshot({ path: `${OUT}/office-06c-pass-irit-390.png` });
  }
  await ictx2.close();
});

await step('Thursday: the pass (Irit: עברתי, one tap for the rest, the day\'s control), a data fix in one tap, the summary prefilled', async () => {
  clockNow = THU;
  const tctx = await newContext(THU);
  const o = await newPage(tctx);
  await signIn(o, 'pass.html', 'irit');
  await o.waitForSelector('#ps-list .ps-row');
  assert.match(await o.innerText('#ps-status'), /היום חמישי: מעבר מלא, והוא נחשב גם כבקרה של היום/);
  const attention = await o.locator('#ps-list .ps-row .wclient').allInnerTexts();
  assert.ok(attention.length >= 2, JSON.stringify(attention));
  // Every attention row: "עברתי" (the first one "פתח משימה" with an owner and a due date).
  await o.locator('#ps-list .ps-row').first().locator('button', { hasText: 'פתח משימה' }).click();
  await o.waitForSelector('#dlg-task[open]');
  await o.fill('#tk-title', 'לבדוק מול העורך מה חסר');
  await o.selectOption('#tk-owner', 'lior');
  await o.click('#tk-submit');
  await toastHas(o, 'נפתחה משימה לליאור');
  assert.ok(db.client_tasks.some((t) => t.source === 'p33' && t.title === 'לבדוק מול העורך מה חסר' && t.due_on === '2026-10-25'));
  // The list shows its first six clients; the rest are behind "הצג עוד".
  if (await o.locator('#ps-list .more-btn').count()) await o.click('#ps-list .more-btn');
  // A stuck client (Ofir's stage 11) is not closed by "עברתי" alone: it says how long it
  // has been open, and offers a task, an update to Lior, or a written reason.
  const stuckIds = await o.locator('#ps-list .ps-row:not(.is-seen):has(.ps-stuck-acts)').evaluateAll((els) => els.map((e) => e.id));
  assert.ok(stuckIds.length >= 2, `stuck rows: ${stuckIds.length}`);
  // (One of them is סטודיו נטלי: its 22א is still open on Lior's "the drive came back", see the fixture.)
  assert.equal(checkOf(N, 'p22a.drive'), null);
  // The simplification of 20.10.2026 (the owner): each row says it once (what, whose, how
  // late; no "תקוע: …" again under it); the clients stuck at one person stand together with
  // one update to Lior; Ofir's own late work says "שלך", with "בטיפול שלי" and no Lior.
  const kindOf = async (id) => o.locator(`#${id}`).evaluate((el) => (el.closest('.ps-group') ? 'group' : el.querySelector('[id$="-own"]') ? 'own' : 'alone'));
  const kinds = {};
  for (const id of stuckIds) {
    const row = o.locator(`#${id}`);
    kinds[id] = await kindOf(id);
    assert.equal(await row.locator('button', { hasText: /^עברתי$/ }).count(), 0, 'no bare "עברתי" on a stuck client');
    assert.deepEqual(await row.locator('.of-acts button').allInnerTexts(), {
      alone: ['פתח משימה', 'עדכון לליאור', 'אין צורך בפעולה'], group: ['פתח משימה', 'אין צורך בפעולה'], own: ['בטיפול שלי', 'פתח משימה'],
    }[kinds[id]], `${id}: ${kinds[id]}`);
    assert.doesNotMatch(await row.innerText(), /תקוע: /, 'said once');
    assert.equal(await row.locator('.ps-line').count(), 1, 'one line');
    if (kinds[id] === 'own') assert.match(await row.locator('.ps-line').innerText(), /שלך/);
  }
  const groups = await o.locator('#ps-list .ps-group').evaluateAll((els) => els.map((e) => e.id));
  for (const g of groups) assert.match(await o.innerText(`#${g} .of-head`), /^לקוחות תקועים\s*אצל \S+/);
  assert.ok(await o.locator('#ps-list .ps-age').count() >= 1);
  assert.match(await o.locator('#ps-list .ps-age').first().innerText(), /(פתוח|באיחור|ממתין ללקוח) .*ימי עסקים|יום עסקים אחד|אין פעילות/);
  await shot(o, 'office-06a-pass-stuck');
  // (1) A written reason: a dot is not one.
  const s1 = stuckIds.find((id) => kinds[id] !== 'own');
  await o.click(`#${s1}-why-open`);
  await o.waitForSelector(`#${s1}-why-text`);
  assert.equal(await o.evaluate(() => document.activeElement.id), `${s1}-why-text`);
  await o.fill(`#${s1}-why-text`, ' . ');
  await o.click(`#${s1}-why-save`);
  assert.match(await o.innerText(`#${s1}-why-err`), /כתבו בכמה מילים למה לא נדרשת פעולה, או פתחו משימה\./);
  assert.ok(!db.office_passes.find((x) => x.day === '2026-10-22')?.seen?.[s1.slice(3)]);
  await o.fill(`#${s1}-why-text`, 'הלקוח בחו״ל עד יום ראשון, סוכם איתו');
  await o.click(`#${s1}-why-save`);
  await o.waitForSelector(`#${s1}.is-seen`);
  assert.match(await o.locator(`#${s1} .ps-seen`).innerText(), /^עברת · אין צורך בפעולה: ״הלקוח בחו״ל עד יום ראשון, סוכם איתו״ · \d\d:\d\d$/);
  const kept = db.office_passes.find((x) => x.day === '2026-10-22').seen[s1.slice(3)];
  assert.deepEqual([kept.how, kept.reason], ['reason', 'הלקוח בחו״ל עד יום ראשון, סוכם איתו']);
  // (2) An update to Lior: the existing exception path (a task for him, source 'escalation').
  // For a group, one task about all its open clients, each recorded as "עודכן ליאור".
  const grp = groups[0] || null;
  const s2 = grp ? null : stuckIds.find((id) => kinds[id] === 'alone' && id !== s1);
  const toLior = grp ? await o.locator(`#${grp} .ps-row:not(.is-seen)`).evaluateAll((els) => els.map((e) => e.id)) : [s2];
  await o.click(grp ? `#${grp}-lior` : `#${s2}-lior`);
  await o.waitForSelector('#dlg-task[open]');
  assert.match(await o.innerText('#tk-h'), grp ? /^עדכון לליאור · \d+ לקוחות תקועים אצל / : /^עדכון לליאור · /);
  const lead = grp ? 'לקוחות תקועים אצל ' : 'לקוח תקוע: ';
  assert.ok((await o.inputValue('#tk-title')).startsWith(lead), await o.inputValue('#tk-title'));
  assert.equal(await o.inputValue('#tk-owner'), 'lior');
  assert.equal(await o.isDisabled('#tk-owner'), true);
  assert.equal(await o.innerText('#tk-submit'), 'שליחה לליאור');
  await o.click('#tk-submit');
  await toastHas(o, `נשלח לליאור: ${lead}`);
  const escs = db.client_tasks.filter((t) => t.source === 'escalation' && t.title.startsWith(lead));
  assert.equal(escs.length, 1, 'one update to Lior');
  const esc = escs[0];
  assert.deepEqual([esc.owner, esc.due_on, esc.client_id], ['lior', '2026-10-25', toLior[0].slice(3)]);
  for (const id of toLior) {
    await o.waitForSelector(`#${id}.is-seen`);
    assert.match(await o.locator(`#${id} .ps-seen`).innerText(), /^עודכן ליאור · /);
    assert.deepEqual(db.office_passes.find((x) => x.day === '2026-10-22').seen[id.slice(3)].task, esc.id);
  }
  // The rest of the stuck clients: a reason, or "בטיפול שלי" on Ofir's own.
  for (const id of stuckIds.filter((x) => x !== s1 && !toLior.includes(x))) {
    if (await o.locator(`#${id}.is-seen`).count()) continue;
    if (kinds[id] === 'own') {
      await o.click(`#${id}-own`);
      await o.waitForSelector(`#${id}.is-seen`);
      assert.match(await o.locator(`#${id} .ps-seen`).innerText(), /^בטיפול שלך · /);
      continue;
    }
    await o.click(`#${id}-why-open`);
    await o.fill(`#${id}-why-text`, 'נבדק מול העורך, מסתדר היום');
    await o.click(`#${id}-why-save`);
    await o.waitForSelector(`#${id}.is-seen`);
  }
  while (await o.locator('#ps-list .ps-row:not(.is-seen) button', { hasText: 'עברתי' }).count()) {
    const n = await o.locator('#ps-list .ps-row:not(.is-seen)').count();
    await o.locator('#ps-list .ps-row:not(.is-seen) button', { hasText: 'עברתי' }).first().click();
    await o.waitForFunction((k) => document.querySelectorAll('#ps-list .ps-row:not(.is-seen)').length === k - 1, n);
  }
  const rest = o.locator('#ps-rest-btn');
  if (await rest.count()) {
    assert.match(await rest.innerText(), /^עברתי על כל השאר \(\d+ לקוחות\)$/);
    await rest.click();
  }
  await toastHas(o, 'המעבר הושלם ונרשם כבקרת הלקוחות של היום (33).');
  assert.ok(db.office_reviews.some((r) => r.kind === 'p33' && r.day === '2026-10-22'));
  const pass = db.office_passes.find((x) => x.day === '2026-10-22');
  assert.ok(pass.completed_at && pass.snapshot && Object.keys(pass.snapshot).length === db.clients.filter((c) => c.status === 'active').length);
  // Data health: the task without a due date gets the next business day in one tap.
  await o.click(`#hl-due-${tNoDue.id}`);
  await toastHas(o, 'נקבע מועד למשימה');
  assert.equal(db.client_tasks.find((t) => t.id === tNoDue.id).due_on, '2026-10-25');
  // The summary: prefilled from the system, saved as is.
  assert.match(await o.innerText('#th-body'), /יעד: היום 13:00/);
  const row = o.locator(`#th-${V.id}`);
  await row.locator('summary').click();
  assert.match(await o.inputValue(`#th-${V.id}-current`), /^עריכה ובקרה/);
  assert.ok((await o.inputValue(`#th-${V.id}-next`)).length > 0);
  await row.locator('button', { hasText: 'שמירה' }).first().click();
  await toastHas(o, 'סיכום המצב של מספרת רון נשמר.');
  const note = db.client_status_notes.find((n) => n.client_id === V.id);
  assert.equal(note.week, '2026-10-18');
  assert.match(note.current, /^עריכה ובקרה/);
  // "בקשת שינוי": three fields, to Lior, behind its small button (20.10.2026).
  assert.equal(await o.isVisible('#cr-problem'), false);
  await o.click('#cr-open');
  assert.equal(await o.evaluate(() => document.activeElement.id), 'cr-problem');
  await o.fill('#cr-problem', 'אין מקום לרשום את מספר הסרטון בתיקון');
  await o.fill('#cr-why', 'העורך מנחש איזה סרטון');
  await o.fill('#cr-proposal', 'שדה מספר בכל שורה');
  await o.click('#cr-submit');
  await toastHas(o, 'בקשת השינוי נשלחה לליאור');
  assert.equal(db.change_requests.length, 1);
  // "אין מי שייצא לאפיון": a structured message to Lior, behind its small button.
  assert.equal(await o.isVisible('#nb-client'), false);
  await o.click('#nb-open');
  await o.selectOption('#nb-client', C.id);
  await o.fill('#nb-info', 'הלקוח מבקש פגישה בבוקר');
  await o.click('#nb-submit');
  await toastHas(o, 'נשלח לליאור: אין מי שייצא לאפיון של גן ורד.');
  const nb = db.client_tasks.find((t) => t.title.startsWith('אין מי שייצא לאפיון'));
  assert.equal(nb.source, 'escalation');
  assert.match(nb.title, /ויצמן 5, רחובות · הלקוח מבקש פגישה בבוקר$/);
  await shot(o, 'office-06-pass');
  globalThis.tctx = tctx;
});

await step('a 360px phone: no sideways scrolling and 44px targets on the three screens and Ilai\'s card', async () => {
  // Ilai's card on Tuesday, the day of the characterization (a day later it is gone).
  for (const [path, who, sel, root, time] of [['qa.html', 'ofir', '#qa-h', '#app', THU], ['pass.html', 'irit', '#ps-list', '#app', THU], ['decisions.html', 'lior', '#ex-h', '#app', THU], ['clients.html#mine', 'ilai', '.g-ilai summary', '.g-ilai', TUE]]) {
    const pctx = await newContext(time, { width: 360, height: 780 });
    const page = await newPage(pctx);
    await signIn(page, path, who);
    await page.waitForSelector(sel);
    await page.waitForTimeout(300);
    assert.ok(await noHScroll(page), `${path} scrolls sideways at 360px`);
    if (root === '.g-ilai') await page.locator('.g-ilai summary').first().click();
    const small = await page.evaluate((r) => [...document.querySelectorAll(['button', 'a.btn', 'summary', '.chip', 'select', 'input:not([type=checkbox]):not([type=radio])', '.of-card a'].map((x) => `${r} ${x}`).join(', '))]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && !e.closest('.topbar, .sr-only, #now-bar, .now-bar, #push-card'))
      .map((e) => `${e.tagName}.${e.className}:${e.textContent.trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().height)}`), root);
    assert.deepEqual(small, [], `${path}: targets under 44px`);
    await page.evaluate((r) => document.querySelectorAll(`${r} details`).forEach((d) => { d.open = true; }), root);
    assert.deepEqual(await unlabeled(page, root), [], `${path}: form controls without a label`);
    await shot(page, `office-07-phone-${path.split('.')[0]}`);
    if (OUT && process.env.PHONE_PAGES) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, i = 0; y < h && i < 8; y += 760, i += 1) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.screenshot({ path: `${OUT}/office-phone-${path.split('.')[0]}-${i}.png` }); }
    }
    await pctx.close();
  }
});

await step('a 390px phone: the stuck row (three ways out, the reason field) and "החלפת עורך" fit, with 44px targets', async () => {
  db.office_passes = db.office_passes.filter((x) => x.day !== '2026-10-22'); // Thursday's pass is open again
  let pctx = await newContext(THU, { width: 390, height: 844 });
  let page = await newPage(pctx);
  await signIn(page, 'pass.html', 'irit');
  await page.waitForSelector('#ps-list .ps-row');
  if (await page.locator('#ps-list .more-btn').count()) await page.click('#ps-list .more-btn');
  const row = page.locator('#ps-list .ps-row:has(.ps-stuck-acts)').first();
  const id = await row.getAttribute('id');
  await page.click(`#${id}-why-open`);
  await page.waitForSelector(`#${id}-why-text`);
  assert.ok(await noHScroll(page), 'the stuck row scrolls sideways at 390px');
  for (const el of await row.locator('button, input').all()) assert.ok((await el.boundingBox()).height >= 44, 'a 44px target in the stuck row');
  assert.deepEqual(await unlabeled(page, `#${id}`), []);
  if (OUT) await row.screenshot({ path: `${OUT}/office-08-phone-390-stuck-row.png` });
  // "החלפת עורך" is Ofir's (qa.html); the pass above is Irit's since 26.10.2026.
  await pctx.close();
  pctx = await newContext(THU, { width: 390, height: 844 });
  page = await newPage(pctx);
  await signIn(page, 'qa.html', 'ofir');
  await page.waitForSelector('#load-list .of-editor');
  await openQaFolds(page);
  await page.waitForSelector('#load-list .sw-btn');
  await page.locator('#load-list .sw-btn').first().click();
  await page.waitForSelector('#dlg-assign[open]');
  assert.ok(await noHScroll(page), 'the swap dialog scrolls sideways at 390px');
  for (const el of await page.locator('#dlg-assign .wrow, #dlg-assign .dlg-foot .btn').all()) if (await el.isVisible()) assert.ok((await el.boundingBox()).height >= 44, 'a 44px target in the swap dialog');
  assert.deepEqual(await unlabeled(page, '#dlg-assign'), []);
  if (OUT) await page.screenshot({ path: `${OUT}/office-09-phone-390-swap.png` });
  await pctx.close();
});

// ── Two editors on one client (the owner's request of 21.10.2026) ──
await step('"עורך/ת נוסף/ת": Ofir assigns two editors; both get the WhatsApp; the second finds the client on her editing page', async () => {
  // A shoot day yesterday, waiting for an editor (added here, so the steps above count as before).
  // Lior's scripts are a Google Docs link in the card, with the office's number beside it (21.10.2026).
  const T = client({ name: 'סטודיו טל', shoot_at: IL('2026-10-21T10:00:00'), links: { scripts: 'https://docs.google.com/document/d/tal-scripts' },
    deliverables: { videos: 25, graphics: 35, shoot_days: 1, scripts: 12 } });
  db.clients.push(T);
  for (const k of keysOf(T, [...UPTO_SHOOT, 'p19'])) db.protocol_checks.push({ client_id: T.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: IL('2026-10-21T09:00:00') });
  const pctx = await newContext(THU, { width: 390, height: 844 });
  const page = await newPage(pctx);
  await signIn(page, 'qa.html', 'ofir');
  await page.waitForSelector(`#assign-list [data-key^="${T.id}"]`);
  await page.click(`#assign-list [data-key^="${T.id}"] [id^="as-open-"]`);
  await page.waitForSelector('#dlg-assign[open]');
  // "+ עורך/ת נוסף/ת": a second editor beside the main one, never the same one, and the split of the videos.
  await page.check('#as-e-yariv');
  assert.ok(await page.locator('#as-editor2-wrap').isHidden());
  await page.click('#as-editor2-add');
  assert.deepEqual(await page.locator('#as-editor2 option').evaluateAll((els) => els.map((e) => e.value)), ['nadia', 'anna', 'nirel']);
  await page.selectOption('#as-editor2', 'nadia');
  // 25 videos in the package: even, the main editor takes the odd one.
  assert.equal(await page.innerText('#as-split-h'), 'חלוקת הסרטונים (25 לפי החבילה)');
  assert.deepEqual([await page.inputValue('#as-split-1'), await page.inputValue('#as-split-2')], ['13', '12']);
  assert.deepEqual([await page.innerText('#as-split-1-name'), await page.innerText('#as-split-2-name')], ['יריב', 'נדיה']);
  // A split that does not add up is not saved.
  await page.fill('#as-split-2', '10');
  await page.click('#as-submit');
  assert.match(await page.innerText('#as-err'), /ביחד 23, ובחבילה 25/);
  await page.fill('#as-split-1', '15');
  assert.equal(await page.innerText('#as-reason-label'), 'סיבה (לא חובה)');
  assert.ok(await noHScroll(page), 'the assignment dialog scrolls sideways at 390px');
  assert.deepEqual(await unlabeled(page, '#dlg-assign'), []);
  if (OUT) await page.screenshot({ path: `${OUT}/office-10-assign-two-editors-390.png` });
  await page.click('#as-submit');
  await toastHas(page, 'סטודיו טל שויך ליריב ולנדיה');
  const saved = db.clients.find((c) => c.id === T.id);
  assert.deepEqual([saved.editor, saved.editor2, saved.editor_split], ['yariv', 'nadia', { yariv: 15, nadia: 10 }]);
  // The WhatsApp to each of them.
  await page.waitForSelector('#handoff:not([hidden])');
  assert.match(await page.locator('#handoff').innerText(), /לשלוח ליריב בוואטסאפ[^]*לשלוח לנדיה בוואטסאפ/);
  await page.click('#handoff-close');
  // The load: the client is with each of them, "יחד עם".
  await openQaFolds(page);
  assert.match(await page.locator('#load-list .of-editor:has(summary .p-yariv)').innerText(), /סטודיו טל[^]*12 תסריטים[^]*יחד עם נדיה/);
  assert.match(await page.locator('#load-list .of-editor:has(summary .p-nadia)').innerText(), /סטודיו טל[^]*יחד עם יריב/);
  // Both hear "לקוח חדש בעריכה אצלך".
  const byClient = {};
  for (const r of db.protocol_checks) (byClient[r.client_id] ||= {})[r.item_key] = r;
  const env = buildEnv({ clients: db.clients, checks: byClient, tasks: db.client_tasks.filter((t) => !t.done_at), staff: db.staff, access: [], reviews: db.office_reviews, statusNotes: [], now: new Date(new Date(serverNow()).getTime() + 60e3) });
  assert.deepEqual(candidates(env).filter((r) => r.rule === 'editing' && r.step === 'assigned' && r.clientId === T.id).map((r) => r.person).sort(), ['nadia', 'yariv']);
  await pctx.close();
  // Nadia, the second editor: the client is on her editing page, with whom.
  const nctx = await newContext(THU, { width: 390, height: 844 });
  const nadia = await newPage(nctx);
  await signIn(nadia, 'editor.html', 'nadia');
  await nadia.waitForSelector('#app:not([hidden])');
  const card = nadia.locator('.ed-card', { hasText: 'סטודיו טל' });
  await card.waitFor();
  await nadia.waitForFunction(() => !document.querySelector('#lg-submit')?.checkVisibility?.());
  await card.scrollIntoViewIfNeeded();
  assert.match(await card.locator('.ed-pair').innerText(), /עורכים יחד: יריב \+ נדיה/);
  // Her own share of the videos, how many scripts, and the scripts themselves one tap away.
  assert.equal(await card.locator('.ed-share').innerText(), '10 מתוך 25 סרטונים — השאר אצל יריב');
  assert.equal(await card.locator('.ed-scount').innerText(), '12 תסריטים');
  assert.equal(await card.locator('.ed-scripts-open').innerText(), 'פתיחת התסריטים (12)');
  assert.equal(await card.locator('.ed-scripts-open').getAttribute('href'), 'https://docs.google.com/document/d/tal-scripts');
  assert.ok(await noHScroll(nadia), 'the editing page scrolls sideways at 390px');
  if (OUT) await card.screenshot({ path: `${OUT}/office-11-editor2-page-390.png` });
  // "ערכתי [ N ] מתוך M" (22.10.2026): her own share; − / + big enough for a thumb, saved by itself.
  const row = card.locator('.ed-count');
  assert.match((await row.innerText()).replace(/\s+/g, ' '), /^ערכתי − \+ מתוך 10/);
  const input = row.locator('input');
  const status = async () => `${await input.getAttribute('id')}-s`;
  assert.equal(await input.inputValue(), '0');
  assert.ok(await row.locator('[id$="-minus"]').isDisabled());
  for (const el of [input, row.locator('[id$="-minus"]'), row.locator('[id$="-plus"]')]) assert.ok((await el.boundingBox()).height >= 44, 'a 44px target in the count');
  for (let i = 0; i < 3; i += 1) await row.locator('[id$="-plus"]').click();
  await row.locator('.ed-count-s', { hasText: 'נשמר' }).waitFor();
  const mine = () => db.editor_progress.find((x) => x.client_id === T.id && x.editor === 'nadia');
  assert.equal(mine().edited, 3);
  // Typed, and above her share: kept as it is.
  await input.fill('12');
  await nadia.waitForFunction((id) => document.getElementById(id)?.textContent === 'נשמר', await status());
  assert.equal(mine().edited, 12);
  await input.fill('');
  await input.blur();
  assert.equal(await input.inputValue(), '12');
  await input.fill('3');
  await nadia.waitForFunction((id) => document.getElementById(id)?.textContent === 'נשמר', await status());
  assert.equal(mine().edited, 3);
  assert.equal(db.editor_progress.filter((x) => x.client_id === T.id).length, 1); // Yariv has his own, not written yet
  assert.deepEqual(await unlabeled(nadia, '.ed-count'), []);
  assert.ok(await noHScroll(nadia));
  if (OUT) await card.screenshot({ path: `${OUT}/office-12-editor-count-390.png` });
  // After a refresh, the number she saved.
  await nadia.click('#btn-refresh');
  await nadia.waitForFunction(() => [...document.querySelectorAll('.ed-card')].find((c) => c.textContent.includes('סטודיו טל'))?.querySelector('.ed-count input')?.value === '3');
  await nctx.close();
});

await step('the office sees each editor\'s number: Ofir\'s load list and the client card, short', async () => {
  const T = db.clients.find((c) => c.name === 'סטודיו טל');
  const pctx = await newContext(THU, { width: 390, height: 844 });
  const page = await newPage(pctx);
  await signIn(page, 'qa.html', 'ofir');
  await page.waitForSelector('#load-list .of-editor');
  await openQaFolds(page);
  const loadOf = (name) => page.locator('#load-list .of-editor').filter({ has: page.locator('summary', { hasText: name }) });
  const nadiaLoad = loadOf('נדיה');
  assert.match(await nadiaLoad.innerText(), /סטודיו טל · [^\n]*נערכו 3\/10/);
  assert.match(await nadiaLoad.innerText(), /מספרת רון[^\n]*נערכו 18\/25/);
  // Yariv has not written a number on Tal yet: nothing about it on his line.
  assert.doesNotMatch(await loadOf('יריב').innerText(), /סטודיו טל[^\n]*נערכו/);
  assert.ok(await noHScroll(page));
  await page.waitForFunction(() => !document.querySelector('#lg-submit')?.checkVisibility?.());
  if (OUT) await page.locator('#load-list').screenshot({ path: `${OUT}/office-13-ofir-load-counts-390.png` });
  // The client card's head: both editors, each against their share.
  await page.goto(`${BASE}client.html?id=${T.id}`);
  await page.waitForSelector('#cc-edited');
  assert.equal((await page.innerText('#cc-edited')).replace(/\s+/g, ' ').trim(), 'נערכו יריב 0/15 · נדיה 3/10');
  await page.waitForFunction(() => !document.querySelector('#lg-submit')?.checkVisibility?.());
  if (OUT) await page.locator('.cc-facts').screenshot({ path: `${OUT}/office-14-card-counts-390.png` });
  await page.goto(`${BASE}client.html?id=${V.id}`);
  await page.waitForSelector('#cc-edited');
  assert.equal((await page.innerText('#cc-edited dd')).trim(), '18/25');
  assert.ok(await noHScroll(page));
  await pctx.close();
});


// Anna and Irit, 22.10.2026: an editor started with part of the footage and no phone; the
// editing goes on. The client card shows it on 22 with her words, and the office closes it.
await step('the client card shows what the editor reported missing while editing, with her words; "הגיע הכול" closes it and Lior\'s task', async () => {
  const T = db.clients.find((c) => c.name === 'סטודיו טל');
  const at = new Date(THU.getTime() - 36e5).toISOString();
  db.protocol_checks.push(
    { client_id: T.id, item_key: 'p22.received', state: 'done', note: null, by_email: 'nadia@astrateg.test', at },
    { client_id: T.id, item_key: 'p22.check.scripts', state: 'done', note: null, by_email: 'nadia@astrateg.test', at },
    { client_id: T.id, item_key: 'p22.check.logo', state: 'done', note: null, by_email: 'nadia@astrateg.test', at },
    { client_id: T.id, item_key: 'p22.missing', state: 'done', by_email: 'nadia@astrateg.test', at,
      note: JSON.stringify({ what: ['footage', 'phone'], note: '', notes: { footage: 'אין צילומי מוצר' }, have: 4, of: 10, going: true }) },
  );
  const lior = task(T, { title: 'להשלים חומר: יש ל־4 מתוך 10 (אין צילומי מוצר) — לקבוע השלמה/יום צילום', created_by_email: 'nadia@astrateg.test', created_at: at, due_on: '2026-10-23' });
  db.client_tasks.push(lior);
  const pctx = await newContext(THU, { width: 390, height: 844 });
  const page = await newPage(pctx);
  await signIn(page, `client.html?id=${T.id}#p22`, 'irit');
  await page.waitForSelector('#p22-report');
  assert.match((await page.innerText('#p22-report span')).replace(/\s+/g, ' ').trim(), /^חסר לעורך: טלפון העסק, חומר צילום \(חומר ל־4 מתוך 10, אין צילומי מוצר\) · נדיה · .+ · העריכה ממשיכה$/);
  assert.equal(await page.locator('#p22 .wait-line:not(.report-line)').count(), 0, 'not a wait');
  assert.ok(await noHScroll(page));
  await page.waitForFunction(() => !document.querySelector('#lg-submit')?.checkVisibility?.());
  await page.locator('#p22-report').scrollIntoViewIfNeeded();
  if (OUT) await page.locator('#p22').screenshot({ path: `${OUT}/office-15-card-editor-report-390.png` });
  await page.click('#p22-arrived');
  await toastHas(page, 'סומן שהכול הגיע');
  assert.equal(checkOf(T, 'p22.missing'), null);
  for (const k of ['p22.check.footage', 'p22.check.phone']) assert.ok(checkOf(T, k), k);
  assert.ok(lior.done_at, 'Lior\'s task for the footage closed with it');
  assert.equal(await page.locator('#p22-report').count(), 0);
  await pctx.close();
});

// A monthly client (the owner, 22.10.2026): a fixed number of videos every month instead of one
// package, 8 a month and 12 in October 2026. A setting of the client (deliverables), off for everyone else.
await step('a monthly client: Irit sets "סרטונים בחודש" and October\'s exception; Nadia counts "ערכתי [ N ] מתוך 12" this month, from 0 again on the 1st; the office sees "החודש"', async () => {
  // Irit, in the client's details (390px): 8 a month, October 2026 is 12.
  const ictx = await newContext(THU, { width: 390, height: 844 });
  const irit = await newPage(ictx);
  await signIn(irit, `client.html?id=${V.id}`, 'irit');
  await irit.waitForSelector('#btn-edit');
  await irit.click('#btn-edit');
  await irit.waitForSelector('#dlg-edit[open]');
  assert.equal(await irit.inputValue('#ed-month-n'), '');
  assert.equal(await irit.inputValue('#ed-month-x'), '2026-10');
  assert.equal(await irit.locator('#ed-month-x option:checked').innerText(), 'אוקטובר 2026');
  // 0 a month is not a monthly client: refused, with the field named.
  await irit.fill('#ed-month-n', '0');
  await irit.click('#ed-submit');
  assert.match(await irit.innerText('#ed-err'), /סרטונים בחודש: מספר שלם מ־1 עד 999/);
  await irit.fill('#ed-month-n', '8');
  await irit.fill('#ed-month-xn', '12');
  assert.deepEqual(await unlabeled(irit, '#dlg-edit'), []);
  assert.ok(await noHScroll(irit), 'the details dialog scrolls sideways at 390px');
  await irit.locator('#ed-month').scrollIntoViewIfNeeded();
  if (OUT) await irit.locator('#ed-deliv-fs').screenshot({ path: `${OUT}/office-16-monthly-fields-390.png` });
  await irit.setViewportSize({ width: 1280, height: 900 });
  assert.ok(await noHScroll(irit), 'the details dialog scrolls sideways at 1280px');
  await irit.locator('#ed-month').scrollIntoViewIfNeeded();
  if (OUT) await irit.locator('#ed-deliv-fs').screenshot({ path: `${OUT}/office-16-monthly-fields-1280.png` });
  await irit.click('#ed-submit');
  await toastHas(irit, 'הפרטים נשמרו');
  assert.deepEqual([V.deliverables.videos_month, V.deliverables.videos_month_except, V.deliverables.videos], [8, { '2026-10': 12 }, 25]);
  // The package block says so, with a way to change it.
  await irit.locator('#deliv-month').waitFor({ state: 'attached' });
  assert.equal((await irit.locator('#deliv-month').textContent()).replace(/\s+/g, ' ').trim(), 'לקוח חודשי8 סרטונים בכל חודש · אוקטובר 2026: 12שינוי');
  await irit.setViewportSize({ width: 390, height: 844 });
  await irit.locator('#fold-contract > summary').click();
  await irit.locator('#deliv-month').scrollIntoViewIfNeeded();
  assert.ok(await noHScroll(irit));
  if (OUT) await irit.locator('section.deliv').screenshot({ path: `${OUT}/office-16-monthly-package-390.png` });
  await ictx.close();

  // Nadia (390px): "12 סרטונים החודש" and "ערכתי [ 0 ] מתוך 12": the shoot's 18 is not this month's.
  const nctx = await newContext(THU, { width: 390, height: 844 });
  const nadia = await newPage(nctx);
  await signIn(nadia, 'editor.html', 'nadia');
  const card = nadia.locator('.ed-card', { hasText: 'מספרת רון' });
  await card.locator('.ed-count').waitFor();
  await nadia.waitForFunction(() => !document.querySelector('#lg-submit')?.checkVisibility?.());
  assert.equal(await card.locator('.ed-month').innerText(), '12 סרטונים החודש');
  const row = card.locator('.ed-count');
  assert.match((await row.innerText()).replace(/\s+/g, ' '), /^ערכתי − \+ מתוך 12/);
  const input = row.locator('input');
  assert.equal(await input.inputValue(), '0');
  assert.match(await input.getAttribute('aria-label'), /^כמה סרטונים ערכתי החודש מתוך 12: מספרת רון$/);
  for (let i = 0; i < 3; i += 1) await row.locator('[id$="-plus"]').click();
  await row.locator('.ed-count-s', { hasText: 'נשמר' }).waitFor();
  const oct = () => db.editor_progress_month.find((x) => x.client_id === V.id && x.editor === 'nadia' && x.month === '2026-10');
  assert.equal(oct().edited, 3);
  await input.fill('5');
  await nadia.waitForFunction((id) => document.getElementById(id)?.textContent === 'נשמר', `${await input.getAttribute('id')}-s`);
  assert.equal(oct().edited, 5);
  assert.equal(db.editor_progress.find((x) => x.client_id === V.id && x.editor === 'nadia').edited, 18, 'the shoot\'s number is left as it was');
  assert.deepEqual(await unlabeled(nadia, '.ed-count'), []);
  assert.ok(await noHScroll(nadia));
  await card.scrollIntoViewIfNeeded();
  if (OUT) await card.screenshot({ path: `${OUT}/office-17-monthly-editor-card-390.png` });
  // After a refresh: this month's number.
  await nadia.click('#btn-refresh');
  await nadia.waitForFunction(() => [...document.querySelectorAll('.ed-card')].find((c) => c.textContent.includes('מספרת רון'))?.querySelector('.ed-count input')?.value === '5');
  await nctx.close();

  // The office: Ofir's load list and the client card, "5/12 החודש".
  const octx2 = await newContext(THU, { width: 390, height: 844 });
  const of2 = await newPage(octx2);
  await signIn(of2, 'qa.html', 'ofir');
  await of2.waitForSelector('#load-list .of-editor');
  await openQaFolds(of2);
  const nadiaLoad = of2.locator('#load-list .of-editor').filter({ has: of2.locator('summary', { hasText: 'נדיה' }) });
  assert.match(await nadiaLoad.innerText(), /מספרת רון[^\n]*נערכו 5\/12 החודש/);
  await of2.goto(`${BASE}client.html?id=${V.id}`);
  await of2.waitForSelector('#cc-edited');
  assert.equal((await of2.innerText('#cc-edited dd')).trim(), '5/12 החודש');
  await octx2.close();

  // The 1st of November in Israel, five past midnight (22:05 UTC on 31 October): from 0 again,
  // "מתוך 8"; the office has no number for November yet.
  const NOV1 = new Date('2026-11-01T00:05:00+02:00');
  const n2 = await newContext(NOV1, { width: 390, height: 844 });
  const nadia2 = await newPage(n2);
  await signIn(nadia2, 'editor.html', 'nadia');
  const card2 = nadia2.locator('.ed-card', { hasText: 'מספרת רון' });
  await card2.locator('.ed-count').waitFor();
  assert.equal(await card2.locator('.ed-month').innerText(), '8 סרטונים בחודש');
  assert.match((await card2.locator('.ed-count').innerText()).replace(/\s+/g, ' '), /^ערכתי − \+ מתוך 8/);
  assert.equal(await card2.locator('.ed-count input').inputValue(), '0');
  await card2.locator('.ed-count [id$="-plus"]').click();
  await card2.locator('.ed-count-s', { hasText: 'נשמר' }).waitFor();
  assert.deepEqual(db.editor_progress_month.filter((x) => x.client_id === V.id).map((x) => [x.month, x.edited]), [['2026-10', 5], ['2026-11', 1]]);
  await n2.close();
});

// A monthly shoot day, and the client's email and company number (the owner, 28.10.2026): the
// switch "יום צילום חודשי" next to "סרטונים בחודש" (deliverables.shoot_monthly), and "אימייל"
// and "ח.פ / ת.ז" next to the phone (the office's, through clients_contact()). Typed key by key
// and deleted with Backspace, in Chromium and in WebKit as an iPhone 13.
// Types `text` into a field key by key, deletes `back` characters with Backspace, and returns
// what the field holds after each part.
async function typeKeys(page, sel, text, back = 0) {
  await page.locator(sel).click();
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 40 });
  const typed = await page.inputValue(sel);
  for (let i = 0; i < back; i += 1) await page.keyboard.press('Backspace');
  return [typed, await page.inputValue(sel)];
}
async function detailsFlow(page, who, shots) {
  await signIn(page, `client.html?id=${V.id}`, who);
  await page.waitForSelector('#btn-edit');
  await page.click('#btn-edit');
  await page.waitForSelector('#dlg-edit[open]');
  assert.equal(await page.isChecked('#ed-shoot-monthly'), false);
  // The switch, tapped (a real tap on the phone), beside "סרטונים בחודש".
  await page.locator('#ed-shoot-monthly').scrollIntoViewIfNeeded();
  if (shots.tap) await page.locator('#ed-shoot-monthly').tap(); else await page.locator('#ed-shoot-monthly').click();
  assert.equal(await page.isChecked('#ed-shoot-monthly'), true);
  // The email and the company number, typed key by key; a mistake taken back with Backspace.
  await page.fill('#ed-email', '');
  assert.deepEqual(await typeKeys(page, '#ed-email', 'Ruth@Shtihim.co.ilX', 1), ['Ruth@Shtihim.co.ilX', 'Ruth@Shtihim.co.il']);
  await page.fill('#ed-company-id', '');
  assert.deepEqual(await typeKeys(page, '#ed-company-id', '51-472-993-89', 1), ['51-472-993-89', '51-472-993-8']);
  // Wrong ones are refused, with the field named; then right.
  await typeKeys(page, '#ed-company-id', '', 4);
  assert.equal(await page.inputValue('#ed-company-id'), '51-472-9');
  await page.click('#ed-submit');
  assert.match(await page.innerText('#ed-err'), /^ח\.פ \/ ת\.ז: צריך 9 ספרות, ונכתבו 6\.$/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ed-company-id');
  assert.deepEqual(await typeKeys(page, '#ed-company-id', '93-8'), ['51-472-993-8', '51-472-993-8']);
  assert.deepEqual(await typeKeys(page, '#ed-email', '', 6), ['Ruth@Shtihim.co.il', 'Ruth@Shtihim']);
  await page.click('#ed-submit');
  assert.match(await page.innerText('#ed-err'), /^האימייל לא נראה תקין/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ed-email');
  await typeKeys(page, '#ed-email', '.co.il');
  assert.equal(await page.inputValue('#ed-email'), 'Ruth@Shtihim.co.il');
  assert.deepEqual(await unlabeled(page, '#dlg-edit'), []);
  assert.ok(await noHScroll(page), 'the details dialog scrolls sideways');
  // 16px, so iOS does not zoom in on focus (the whole dialog's fields), and 44px to tap.
  for (const sel of ['#ed-email', '#ed-company-id', '#ed-phone']) {
    assert.equal(await page.locator(sel).evaluate((el) => getComputedStyle(el).fontSize), '16px', sel);
    assert.ok((await page.locator(sel).boundingBox()).height >= 44, sel);
  }
  if (shots.fields) {
    await page.locator('#ed-email').scrollIntoViewIfNeeded();
    await page.screenshot({ path: shots.fields });
  }
  if (shots.switch) {
    // The screen as it is (an element shot of a scrolled dialog comes out wrong in WebKit).
    await page.locator('#ed-shoot-monthly-h').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: shots.switch });
  }
  await page.click('#ed-submit');
  await toastHas(page, 'הפרטים נשמרו');
  // Saved, and kept: the deliverables keep the monthly videos too.
  assert.equal(V.deliverables.shoot_monthly, true);
  assert.equal(V.deliverables.videos_month, 8);
  assert.deepEqual([V.contact_email, V.company_id], ['ruth@shtihim.co.il', '514729938']);
  // After a reload: the card shows them with the phone, the package block the switch, and the dialog keeps it.
  // After a reload (Chromium; WebKit with the fixed clock loses this fake's session on a
  // reload, so there the card drawn again from the saved row is read).
  if (!shots.tap) await page.reload();
  await page.waitForSelector('#btn-edit');
  const facts = (await page.locator('.cc-facts').innerText()).replace(/\s+/g, ' ');
  assert.match(facts, /אימייל ruth@shtihim\.co\.il/);
  assert.match(facts, /ח\.פ \/ ת\.ז 514729938/);
  await page.locator('#deliv-shoot-monthly').waitFor({ state: 'attached' });
  await page.click('#btn-edit');
  await page.waitForSelector('#dlg-edit[open]');
  assert.equal(await page.isChecked('#ed-shoot-monthly'), true);
  assert.equal(await page.inputValue('#ed-email'), 'ruth@shtihim.co.il');
  assert.equal(await page.inputValue('#ed-company-id'), '514729938');
  // Off again: the key goes, nothing else does.
  if (shots.tap) await page.locator('#ed-shoot-monthly').tap(); else await page.locator('#ed-shoot-monthly').click();
  await page.click('#ed-submit');
  await toastHas(page, 'הפרטים נשמרו');
  assert.equal('shoot_monthly' in V.deliverables, false);
  assert.equal(V.deliverables.videos_month, 8);
  // Back on, as the client is.
  await page.click('#btn-edit');
  await page.waitForSelector('#dlg-edit[open]');
  await page.locator('#ed-shoot-monthly').check();
  await page.click('#ed-submit');
  await toastHas(page, 'הפרטים נשמרו');
  assert.equal(V.deliverables.shoot_monthly, true);
}

await step('"יום צילום חודשי", "אימייל" and "ח.פ / ת.ז": Irit turns the switch on and types both key by key (390px and 1280px), saved and kept; an editor sees neither', async () => {
  const ictx = await newContext(THU, { width: 390, height: 844 });
  const irit = await newPage(ictx);
  await detailsFlow(irit, 'irit', OUT ? { fields: `${OUT}/office-18-contact-fields-390.png`, switch: `${OUT}/office-18-shoot-monthly-390.png` } : {});
  await ictx.close();
  // 1280px, the owner, from empty again.
  Object.assign(V, { contact_email: null, company_id: null });
  V.deliverables = { ...V.deliverables }; delete V.deliverables.shoot_monthly;
  const octx2 = await newContext(THU, { width: 1280, height: 900 });
  const owner = await newPage(octx2);
  await detailsFlow(owner, 'owner', OUT ? { switch: `${OUT}/office-18-shoot-monthly-1280.png` } : {});
  await owner.locator('#fold-contract > summary').click();
  await owner.locator('#deliv-shoot-monthly').scrollIntoViewIfNeeded();
  assert.equal((await owner.locator('#deliv-shoot-monthly').textContent()).replace(/\s+/g, ' ').trim(), 'יום צילום חודשיבסוף כל חודש עירית מקבלת תזכורת לקבוע את יום הצילום של החודש הבא.שינוי');
  if (OUT) await owner.locator('section.deliv').screenshot({ path: `${OUT}/office-18-shoot-monthly-package-1280.png` });
  await octx2.close();
  // Nadia, the editor: no email and no company number on her card, however the page asks.
  const nctx = await newContext(THU, { width: 390, height: 844 });
  const nadia = await newPage(nctx);
  await signIn(nadia, `client.html?id=${V.id}`, 'nadia');
  await nadia.waitForSelector('#cc-head h1');
  const head = await nadia.locator('#cc-head').innerText();
  assert.doesNotMatch(head, /ruth@shtihim|514729938|אימייל|ח\.פ/);
  await nctx.close();
});

await step('the same on an iPhone 13 (WebKit): the switch tapped, both fields typed key by key and deleted with Backspace, saved and kept', async () => {
  const safari = await webkit.launch();
  try {
    Object.assign(V, { contact_email: null, company_id: null });
    V.deliverables = { ...V.deliverables }; delete V.deliverables.shoot_monthly;
    const ctx = await safari.newContext({ ...devices['iPhone 13'], locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
    await ctx.clock.install({ time: THU });
    await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
    const page = await newPage(ctx);
    await detailsFlow(page, 'irit', { tap: true, ...(OUT ? { fields: `${OUT}/office-18-contact-fields-iphone13-webkit.png`, switch: `${OUT}/office-18-shoot-monthly-iphone13-webkit.png` } : {}) });
    await ctx.close();
  } finally {
    await safari.close();
  }
});

await step('the old system\'s signed documents: the owner imports through the page, the card lists them (390px), "פתיחה" shows the document read-only; an editor reads none', async () => {
  const wctx = await newContext(THU, { width: 390, height: 844 });
  const owner = await newPage(wctx);
  await signIn(owner, `client.html?id=${V.id}`, 'owner');
  await owner.waitForSelector('#cc-head h1');
  await owner.waitForSelector('#fold-contract');
  assert.equal(await owner.locator('#fold-legacy').count(), 0, 'no block while there are none');
  // A fake signature, drawn in the page as the old system's pad did.
  const signature = await owner.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 360; c.height = 120;
    const x = c.getContext('2d');
    x.lineWidth = 3; x.strokeStyle = '#031432'; x.lineCap = 'round';
    x.beginPath(); x.moveTo(20, 80);
    for (let i = 0; i <= 32; i += 1) x.lineTo(20 + i * 10, 70 + Math.sin(i / 2) * 30 - (i % 5) * 4);
    x.stroke();
    return c.toDataURL('image/png');
  });
  const hash = 'abcdef0123456789'.repeat(4);
  const contract = {
    id: 501, clientId: 44, clientName: 'רון לוי', business: 'מספרת רון', hp: '512345678', phone: '050-1234567', packageName: 'חבילת פרימיום',
    influencers: 2, months: 12, shootDays: 1, contentTotal: 40, reels: 25, graphics: 15, totalAmount: 60000, retainer: 5000, paymentMethod: 'הוראת קבע',
    notes: 'הצילום בבוקר, לפני פתיחת המספרה.', createdAt: '2025-03-01T08:00:00.000Z', docNumber: 'AST-2025-017', validUntil: '2025-03-04T08:00:00.000Z',
    docHash: hash, docHashAt: '2025-03-01T08:00:00.000Z', signHistory: [{ at: '2025-03-02T09:00:00.000Z', event: 'signed', ip: '1.2.3.4', userAgent: 'Mozilla/5.0' }],
    signerName: 'רון לוי', signature, signedAt: '2025-03-02T09:00:00.000Z', signedIp: '1.2.3.4', signedUserAgent: 'Mozilla/5.0', firstViewedAt: '2025-03-01T10:00:00.000Z',
    customClauses: ['הלקוח מאשר שימוש בתכנים בתיק העבודות של אסטרטג.', { title: 'בלעדיות', text: 'אסטרטג לא תעבוד עם מספרה אחרת ברדיוס 2 ק״מ.' }],
    specialRequest: 'סרטון אחד באנגלית', packageBullets: ['ניהול אינסטגרם וטיקטוק', 'דוח חודשי'], extraBullets: ['קמפיין ממומן'], checksCount: 12,
    paymentSummary: '12 תשלומים של ₪5,000 + מע״מ', docType: '', status: 'נחתם', consentText: 'קראתי ואני מאשר את ההסכם', signatureHash: 'f'.repeat(64), catalog: { tiers: 3 },
  };
  const termination = {
    id: 502, clientId: 44, clientName: 'רון לוי', business: 'מספרת רון', docType: 'termination', parentContractId: 501, docNumber: 'AST-2025-090',
    termination: { endDate: '2025-09-30', reason: 'סגירת הסניף' }, signers: [{ name: 'רון לוי', signature, signedAt: '2025-09-01T10:00:00.000Z', ip: '1.2.3.4' }],
    signedAt: '2025-09-01T10:00:00.000Z', docHash: 'b'.repeat(64), status: 'נחתם',
  };
  // Since 27.10.2026 every document: one that waited for the signature there, and a price offer.
  const pending = { ...contract, id: 505, docNumber: 'AST-2025-120', status: 'ממתין לחתימה', signature, signedAt: null, signerName: '', signers: undefined, signHistory: [{ at: '2025-04-01T09:00:00.000Z', event: 'sent' }], totalAmount: 36000 };
  const offer = { id: 506, clientId: 44, clientName: 'רון לוי', business: 'מספרת רון', docNumber: 'AST-2025-130', status: 'הצעת מחיר', packageName: 'חבילת בסיס', months: 6, totalAmount: 18000, createdAt: '2025-05-01T08:00:00.000Z' };
  const list = [contract, termination, pending, offer, { id: 503, clientId: 44, status: 'נשלח' }, { id: 504, clientId: 77, clientName: 'לקוח שלא יובא', status: 'נחתם' }];
  const result = await importInPage(owner, list, (old) => (old === 44 ? V.id : null));
  assert.deepEqual(result, { ok: [501, 502, 505, 506], skipped: [{ id: 504, clientId: 77, clientName: 'לקוח שלא יובא' }], other: [{ id: 503, status: 'נשלח' }], failed: [] });
  assert.deepEqual(db.legacy_contracts.map((r) => [r.id, r.client_id, r.doc_type, r.status, !!r.signature]),
    [[501, V.id, 'contract', 'signed', true], [502, V.id, 'termination', 'signed', false], [505, V.id, 'contract', 'pending', false], [506, V.id, 'contract', 'quote', false]]);
  assert.doesNotMatch(JSON.stringify(db.legacy_contracts), /1\.2\.3\.4|Mozilla|050-1234567|512345678/);
  // Again: the same four rows.
  await importInPage(owner, [contract, termination, pending, offer], (old) => (old === 44 ? V.id : null));
  assert.equal(db.legacy_contracts.length, 4);

  // The card: one closed row with the count; opened, the newest signed first.
  await owner.reload();
  await owner.waitForSelector('#fold-legacy');
  assert.equal((await owner.locator('#fold-legacy > summary').innerText()).replace(/\s+/g, ' ').trim(), 'חוזים מהמערכת הישנה 4 מסמכים');
  await owner.locator('#fold-legacy > summary').click();
  const rows = await owner.locator('#legacy-contracts .lc-row').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(rows, ['סיום התקשרות AST-2025-090 נחתם 1.9.2025 רון לוי פתיחה', 'חוזה AST-2025-017 נחתם 2.3.2025 רון לוי ₪60,000 פתיחה',
    'חוזה AST-2025-130 הצעת מחיר ₪18,000 פתיחה', 'חוזה AST-2025-120 ממתין לחתימה (במערכת הישנה) ₪36,000 פתיחה']);
  assert.ok(await noHScroll(owner));
  const tooSmall = await owner.locator('#legacy-contracts a, #fold-legacy > summary').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  assert.equal(tooSmall, 0, '44px targets');
  await owner.locator('#fold-legacy').scrollIntoViewIfNeeded();
  if (OUT) await owner.locator('#fold-legacy').screenshot({ path: `${OUT}/office-18-legacy-card-390.png` });

  // "פתיחה": the document, read-only, printable.
  await owner.locator('#lc-501 .lc-open').click();
  await owner.waitForURL(/legacy-contract\.html\?id=501$/);
  await owner.waitForSelector('#lc-doc');
  assert.equal(await owner.innerText('#lc-stamp'), 'מסמך מהמערכת הישנה · נחתם 2.3.2025 · חותמת abcdef012345');
  const text = await owner.innerText('#lc-doc');
  for (const want of ['הסכם התקשרות', 'AST-2025-017', 'רון לוי', 'מספרת רון', 'חבילת פרימיום', 'ניהול אינסטגרם וטיקטוק', 'קמפיין ממומן', '₪60,000', '₪5,000', 'הוראת קבע',
    '12 תשלומים של ₪5,000 + מע״מ', 'בלעדיות', 'סרטון אחד באנגלית', 'הצילום בבוקר', 'החותם אישר: ״קראתי ואני מאשר את ההסכם״', 'DOC abcdef012345', 'SIG ffffffffffff']) assert.ok(text.includes(want), want);
  assert.doesNotMatch(text, /1\.2\.3\.4|Mozilla|050-1234567|512345678/);
  assert.match(await owner.getAttribute('.qd-sign-box.is-signed img', 'src'), /^data:image\/png;base64,/);
  assert.equal(await owner.getAttribute('#lc-back', 'href'), `client.html?id=${V.id}`);
  assert.equal(await owner.isVisible('#btn-print'), true);
  assert.ok(await noHScroll(owner));
  await shot(owner, 'office-19-legacy-doc-390');
  await owner.emulateMedia({ media: 'print' });
  assert.equal(await owner.isVisible('.cbar'), false, 'the bar is not printed');
  await shot(owner, 'office-20-legacy-doc-print');
  await owner.emulateMedia({ media: 'screen' });
  // The termination: its details and the link to the contract it ends.
  await owner.goto(`${BASE}legacy-contract.html?id=502`);
  await owner.waitForSelector('#lc-doc');
  assert.match(await owner.innerText('#lc-doc'), /סיום התקשרות[^]*פרטי סיום ההתקשרות[^]*30 בספטמבר 2025[^]*סגירת הסניף/);
  assert.equal(await owner.getAttribute('.lc-parent a', 'href'), 'legacy-contract.html?id=501');
  await shot(owner, 'office-21-legacy-termination-390');
  // Waiting for the signature there: no signature block, "לא נחתם"; a price offer: its own title.
  await owner.goto(BASE + 'legacy-contract.html?id=505');
  await owner.waitForSelector('#lc-doc');
  assert.equal(await owner.innerText('#lc-stamp'), 'מסמך מהמערכת הישנה · ממתין לחתימה, לא נחתם · חותמת abcdef012345');
  assert.match(await owner.innerText('#lc-unsigned'), /לא נחתם: המסמך חיכה לחתימת הלקוח במערכת הישנה/);
  assert.equal(await owner.locator('.qd-sign, .qd-sign-box img').count(), 0, 'no signature block');
  assert.match(await owner.innerText('#lc-doc'), /ממתין לחתימה \(במערכת הישנה\)[^]*AST-2025-120[^]*₪36,000/);
  assert.ok(await noHScroll(owner));
  await shot(owner, 'office-21b-legacy-pending-390');
  await owner.goto(BASE + 'legacy-contract.html?id=506');
  await owner.waitForSelector('#lc-doc');
  assert.equal((await owner.innerText('#lc-doc h1')).trim(), 'הצעת מחיר');
  assert.match(await owner.innerText('#lc-unsigned'), /לא נחתם: הצעת מחיר מהמערכת הישנה/);
  await shot(owner, 'office-21c-legacy-quote-390');
  await owner.setViewportSize({ width: 1280, height: 900 });
  assert.equal((await owner.innerText('#lc-kind')).trim(), 'הצעת מחיר');
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(BASE + 'legacy-contract.html?id=502');
  await owner.waitForSelector('#lc-doc');
  // On the phone the bar keeps the way back and "הדפסה"; on a computer, the signing day too.
  assert.equal((await owner.innerText('#btn-print')).trim(), 'הדפסה');
  assert.equal(await owner.isVisible('#lc-kind'), false);
  await owner.setViewportSize({ width: 1280, height: 900 });
  assert.equal((await owner.innerText('#btn-print')).replace(/\s+/g, ' ').trim(), 'הדפסה / שמירה כ־PDF');
  assert.equal((await owner.innerText('#lc-kind')).trim(), 'נחתם 1 בספטמבר 2025');
  await owner.goto(`${BASE}legacy-contract.html?id=501`);
  await owner.waitForSelector('#lc-doc');
  await shot(owner, 'office-22-legacy-doc-1280');
  await wctx.close();

  // An editor: no document, and no block.
  const ectx = await newContext(THU, { width: 390, height: 844 });
  const nadia = await newPage(ectx);
  await signIn(nadia, `client.html?id=${V.id}`, 'nadia');
  await nadia.waitForSelector('#cc-head h1');
  assert.equal(await nadia.locator('#fold-legacy').count(), 0);
  await nadia.goto(`${BASE}legacy-contract.html?id=501`);
  await nadia.waitForFunction(() => /המסמך לא נמצא/.test(document.getElementById('state')?.textContent || ''));
  assert.equal(await nadia.isVisible('#lc-doc'), false);
  await ectx.close();
});

await step('the old system\'s characterization: the owner imports through the page; the card\'s closed row (390px), opened: the filled text readable, the brief and the raw answers in their rows; the editor reads it on the card and on her page', async () => {
  const wctx = await newContext(THU, { width: 390, height: 844 });
  const owner = await newPage(wctx);
  await signIn(owner, `client.html?id=${V.id}`, 'owner');
  await owner.waitForSelector('#cc-head h1');
  await owner.waitForSelector('#fold-contract');
  assert.equal(await owner.isVisible('#fold-legacychar'), false, 'no row while there is none');
  const old = {
    id: 44, name: 'רון לוי', phone: '050-1234567', email: 'ron@example.com', notes: 'לא נשלח',
    charterFilledText: [
      'רקע על העסק', 'שם העסק: מספרת רון', 'תחום: תספורת גברים ועיצוב זקן', 'שעות פתיחה: 10:00-20:00', 'טלפון לתיאום: 050-1234567', 'מייל: ron.levi@gmail.com', '',
      'קהל יעד', 'גיל: 25–45', 'אזור: תל אביב והמרכז', '',
      'מה הלקוח מספר על עצמו', 'רון פתח את המספרה ב־2015. הוא אוהב לדבר עם הלקוחות ומאמין בשירות אישי, בלי למהר.', '',
      'שירותים:', '- תספורת', '- צבע', '- עיצוב זקן', '',
      'מטרות', 'מטרה עיקרית: יותר לקוחות צעירים בימי חול', 'מה לא לעשות: לא לצלם לקוחות בלי אישור',
    ].join('\r\n'),
    charterFilledAt: '2025-03-01T08:00:00.000Z',
    briefText: 'דגשים לסרטונים: לצלם בבוקר, לפני הפתיחה.\nלהזכיר את המבצע של יום שלישי.\nלחזור לרון ב־+972-52-765-4321.',
    briefUpdatedAt: '2025-03-05T08:00:00.000Z',
    charterScript: 'תסריט 1 – לפני ואחרי\nהוק: ככה נראה זקן אחרי שבוע בלי מספרה\nסצנה: רון מעצב זקן, מצלמה מעל הכתף\n\nתסריט 2 – יום במספרה\nהוק: 6:30 בבוקר, המספרה עוד סגורה',
    charterScriptAt: '2025-03-07T08:00:00.000Z',
    charterSummary: 'לקוח שקט ונעים. אוהב סרטונים קצרים עם מוזיקה.',
    charterAnswers: { 1: 'מספרה', 2: '', 3: 'לחייג 0549876543', 12: 'לא' },
  };
  const list = [old, { id: 77, name: 'לקוח שלא יובא', charterSummary: 'משהו' }, { id: 78, name: 'ריק', charterFilledText: '  ' }];
  const result = await importCharsInPage(owner, list, (o) => (o === 44 ? V.id : null));
  assert.deepEqual(result, { ok: [44], skipped: [{ id: 77, clientName: 'לקוח שלא יובא' }], failed: [] });
  assert.equal(db.legacy_characterizations.length, 1);
  assert.doesNotMatch(JSON.stringify(db.legacy_characterizations), /050-1234567|ron\.levi@|765-4321|0549876543|לא נשלח|ron@example/);
  // Again: the same row.
  await importCharsInPage(owner, [old], (o) => (o === 44 ? V.id : null));
  assert.equal(db.legacy_characterizations.length, 1);

  // The card: one closed row right under the characterization's block, with the day it was filled.
  await owner.reload();
  await owner.waitForSelector('#fold-legacychar:not([hidden])');
  assert.equal((await owner.locator('#fold-legacychar > summary').innerText()).replace(/\s+/g, ' ').trim(), 'אפיון מהמערכת הישנה מולא ב־1.3.2025 · בריף · תסריטים');
  assert.ok(await owner.evaluate(() => document.getElementById('ik-slot').nextElementSibling?.id === 'fold-legacychar'), 'right under the characterization');
  await owner.locator('#fold-legacychar > summary').click();
  await owner.waitForSelector('#legacy-char-filled');
  assert.equal(await owner.innerText('#legacy-char-filled .lch-stamp'), 'מולא ב־1.3.2025');
  assert.deepEqual(await owner.locator('#legacy-char-filled .lch-h').allInnerTexts(), ['רקע על העסק', 'קהל יעד', 'מה הלקוח מספר על עצמו', 'מטרות']);
  const pairs = await owner.locator('#legacy-char-filled dl').first().evaluate((dl) => [...dl.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.deepEqual(pairs, [['שם העסק', 'מספרת רון'], ['תחום', 'תספורת גברים ועיצוב זקן'], ['שעות פתיחה', '10:00-20:00'], ['טלפון לתיאום', '[הוסר]'], ['מייל', '[הוסר]']]);
  assert.match(await owner.innerText('#legacy-char-filled'), /רון פתח את המספרה ב־2015[^]*שירותים[^]*- תספורת\n- צבע\n- עיצוב זקן[^]*מטרה עיקרית[^]*יותר לקוחות צעירים/);
  // The parts after it are closed rows, each with its day.
  assert.deepEqual((await owner.locator('#legacy-char .lch-fold > summary').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
    ['בריף מהמערכת הישנה עודכן ב־5.3.2025', 'תסריטים מהמערכת הישנה נכתבו ב־7.3.2025', 'סיכום', 'תשובות גולמיות (3)']);
  assert.equal(await owner.locator('#legacy-char .lch-fold[open]').count(), 0);
  assert.ok(await noHScroll(owner));
  const tooSmall = await owner.locator('#fold-legacychar > summary, #legacy-char .lch-fold > summary').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  assert.equal(tooSmall, 0, '44px targets');
  // On a phone the key sits over its value.
  const [dtBottom, ddTop] = await owner.locator('#legacy-char-filled dl').first().evaluate((dl) => [dl.querySelector('dt').getBoundingClientRect().bottom, dl.querySelector('dd').getBoundingClientRect().top]);
  assert.ok(ddTop >= dtBottom - 1, 'the value under its key');
  // A range of numbers reads left to right in the Hebrew line ("25–45", not "45–25").
  assert.deepEqual(await owner.locator('#legacy-char-filled bdi[dir="ltr"]').allInnerTexts(), ['25–45']);
  await owner.locator('#fold-legacychar').scrollIntoViewIfNeeded();
  if (OUT) await owner.locator('#fold-legacychar').screenshot({ path: `${OUT}/office-23-legacy-char-390.png` });
  // The brief and the raw answers, opened.
  await owner.locator('#legacy-char-brief > summary').click();
  assert.match(await owner.innerText('#legacy-char-brief'), /לצלם בבוקר[^]*המבצע של יום שלישי[^]*לחזור לרון ב־\[הוסר\]/);
  await owner.locator('#legacy-char-answers > summary').click();
  const answers = await owner.locator('#legacy-char-answers dl').evaluate((dl) => [...dl.querySelectorAll('dt')].map((x) => [x.textContent, x.nextElementSibling.textContent]));
  assert.deepEqual(answers, [['שאלה 1', 'מספרה'], ['שאלה 3', 'לחייג [הוסר]'], ['שאלה 12', 'לא']]);
  await owner.locator('#legacy-char-brief').scrollIntoViewIfNeeded();
  if (OUT) await owner.locator('#legacy-char-brief').screenshot({ path: `${OUT}/office-24-legacy-char-brief-390.png` });
  // What is open stays open when the card is drawn again (the minute's refresh).
  await owner.clock.runFor(61e3);
  assert.equal(await owner.locator('#fold-legacychar[open] #legacy-char-brief[open]').count(), 1);
  // On paper: everything open, without the hint.
  await owner.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await owner.emulateMedia({ media: 'print' });
  assert.equal(await owner.locator('#legacy-char .lch-fold:not([open])').count(), 0);
  assert.equal(await owner.isVisible('#legacy-char .lch-note'), false);
  if (OUT) await owner.locator('#fold-legacychar').screenshot({ path: `${OUT}/office-25-legacy-char-print.png` });
  await owner.emulateMedia({ media: 'screen' });
  await owner.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  // On a computer: the key beside its value.
  await owner.setViewportSize({ width: 1280, height: 900 });
  const [dtTop, ddTop2] = await owner.locator('#legacy-char-filled dl').first().evaluate((dl) => [dl.querySelector('dt').getBoundingClientRect().top, dl.querySelector('dd').getBoundingClientRect().top]);
  assert.ok(Math.abs(dtTop - ddTop2) < 4, 'the value beside its key');
  assert.ok(await noHScroll(owner));
  await owner.locator('#fold-legacychar').scrollIntoViewIfNeeded();
  if (OUT) await owner.locator('#fold-legacychar').screenshot({ path: `${OUT}/office-27-legacy-char-1280.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  // A link straight to it opens the row.
  await owner.goto(`${BASE}client.html?id=${V.id}#legacy-char`);
  await owner.waitForSelector('#fold-legacychar[open] #legacy-char-filled');
  // A client with none: no row.
  await owner.goto(`${BASE}client.html?id=${G.id}`);
  await owner.waitForSelector('#cc-head h1');
  await owner.waitForSelector('#fold-contract');
  assert.equal(await owner.isVisible('#fold-legacychar'), false);
  await wctx.close();

  // The editor: on the card she opens, and on her page under the highlights.
  const ectx = await newContext(THU, { width: 390, height: 844 });
  const nadia = await newPage(ectx);
  await signIn(nadia, `client.html?id=${V.id}`, 'nadia');
  await nadia.waitForSelector('#fold-legacychar:not([hidden])');
  await nadia.locator('#fold-legacychar > summary').click();
  assert.match(await nadia.innerText('#legacy-char-filled'), /שם העסק[^]*מספרת רון/);
  assert.ok(await noHScroll(nadia));
  await nadia.goto(`${BASE}editor.html`);
  const card = nadia.locator('.ed-card', { hasText: 'מספרת רון' });
  await card.locator('details.ed-lch').waitFor();
  assert.equal((await card.locator('details.ed-lch > summary').innerText()).replace(/\s+/g, ' ').trim(), 'אפיון מהמערכת הישנה מולא ב־1.3.2025 · בריף · תסריטים');
  assert.equal(await card.locator('details.ed-lch[open]').count(), 0, 'closed until opened');
  await card.locator('details.ed-lch > summary').click();
  assert.match(await card.locator('details.ed-lch .lch-doc').innerText(), /רקע על העסק[^]*שם העסק[^]*מספרת רון/);
  assert.ok(await noHScroll(nadia));
  if (OUT) await card.locator('details.ed-lch').screenshot({ path: `${OUT}/office-26-legacy-char-editor-390.png` });
  await card.locator('details.ed-lch > summary').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(nadia, 'office-26b-legacy-char-editor-page-390');
  // Another client of hers has none: no row there.
  assert.equal(await nadia.locator('.ed-card', { hasText: 'גלידה שמש' }).locator('details.ed-lch').count(), 0);
  await ectx.close();
});

assert.deepEqual(errors, []);
await browser.close();
noCspViolations();
console.log(`\n${passed} steps passed`);
