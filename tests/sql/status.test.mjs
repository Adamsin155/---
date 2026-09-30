// The client's side (supabase/migrations/20260930170000_client_status.sql) in a real
// Postgres with every migration (tests/sql/pg.mjs): the secret link (a hash in the
// table, the token in Vault, expiry, revocation, only Irit, Lior and the owner),
// the anonymous page reaching the database only through its functions and getting
// only client-safe data, approvals kept as evidence and marking the protocol, fix
// requests opening a task for whoever fixes, surveys and the low-score call, and the
// WhatsApp checkbox kept with the signature. The words the database checks are the
// same as the page's (app/status-logic.js).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';
import { wordingFor, itemText, QUESTIONS, MARKS, WHATSAPP_CONSENT, ITEMS } from '../../app/status-logic.js';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, $3)', [email, person, key !== 'nadia']);
  }
  const add = async (name, fields = {}) => {
    const cols = ['name', ...Object.keys(fields)];
    const vals = [name, ...Object.values(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals);
    ids[name] = rows[0].id;
  };
  await add('dana', { business: 'קפה דנה בע״מ', phone: '050-1234567', editor: 'nadia', shoot_type: 'dms', notes: 'הערה פנימית: לקוח קשה',
    links: JSON.stringify({ drive: 'https://drive.google.com/x', scripts: 'https://docs.google.com/y', gantt: 'javascript:alert(1)', metricool: 'https://metricool.com/z' }) });
  await add('ended', { status: 'ended' });
  await db.query("update public.clients set shoot_at = now() - interval '1 day', char_at = now() - interval '20 days', contract_end = ((now() at time zone 'Asia/Jerusalem')::date + 45) where id = $1", [ids.dana]);
  const mark = (key, note = null) => db.query("insert into public.protocol_checks (client_id, item_key, state, note) values ($1, $2, 'done', $3)", [ids.dana, key, note]);
  for (const k of ['p07.sent', 'p12.scripts', 'p12.numbered', 'p12.docs', 'p23.sent', 'p26.sent', 'p25.approved']) await mark(k);
  await mark('p25.return.1', '{"issues":[{"text":"בעיה פנימית"}]}');
  await mark('p22.missing', '{"what":["logo"]}');
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
// Committed calls (as() rolls back): a function run as a user, kept.
async function keep(who, sql, params = []) {
  const u = who === 'anon' ? null : users[who];
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestBrowser/1.0' })]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const status = async (token) => (await keep('anon', 'select public.get_status($1) as s', [token]))[0].s;
let token;

test('only Irit, Lior and the owner make a link; the table keeps a hash, the token is in Vault', async () => {
  for (const who of ['ofir', 'ilai', 'nadia', 'anon']) {
    const r = await q(who, 'select public.status_link_create($1)', [ids.dana]);
    assert.match(r.error, /not allowed|permission denied/, who);
  }
  const [{ l }] = await keep('irit', 'select public.status_link_create($1) as l', [ids.dana]);
  token = l.token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = (await db.query('select * from public.client_status_links where id = $1', [l.id])).rows[0];
  assert.notEqual(row.token_hash, token);
  assert.equal(row.created_by, 'irit@astrateg.test');
  assert.ok(Math.abs(new Date(row.expires_at) - Date.now() - 180 * 864e5) < 60e3, 'expires in 180 days');
  assert.equal((await db.query('select count(*)::int as n from public.client_status_links where token_hash like $1', [`%${token}%`])).rows[0].n, 0);
  // The office reads the link, never its hash or Vault id; the token only through the function.
  assert.equal((await q('ofir', 'select id, expires_at from public.client_status_links')).rows.length, 1);
  assert.match((await q('ofir', 'select token_hash from public.client_status_links')).error, /permission denied/);
  assert.match((await q('ofir', 'select secret_id from public.client_status_links')).error, /permission denied/);
  assert.deepEqual((await q('nadia', 'select id from public.client_status_links')).rows, []);
  assert.equal((await q('lior', 'select public.status_link_token($1) as t', [l.id])).rows[0].t, token);
  assert.match((await q('ofir', 'select public.status_link_token($1) as t', [l.id])).error, /not allowed/);
  assert.match((await q('anon', 'select public.status_link_token($1) as t', [l.id])).error, /permission denied/);
  // Nobody writes the tables directly.
  assert.match((await q('irit', "insert into public.client_status_links (client_id, token_hash, expires_at) values ($1, repeat('a', 64), now())", [ids.dana])).error, /permission denied/);
  assert.match((await q('irit', 'delete from public.client_approvals')).error, /permission denied/);
  // No link for a client that ended.
  assert.match((await q('irit', 'select public.status_link_create($1)', [ids.ended])).error, /client not open/);
});

test('anon reaches nothing but the page\'s functions', async () => {
  for (const t of ['client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents', 'clients', 'protocol_checks', 'client_tasks']) {
    const r = await q('anon', `select 1 from public.${t}`);
    assert.ok(r.error || r.rows.length === 0, t);
  }
  for (const fn of ['private.status_items($1)', 'private.status_surveys_due($1)']) {
    assert.match((await q('anon', `select ${fn}`, [ids.dana])).error, /permission denied/, fn);
  }
  assert.match((await q('anon', 'select public.survey_record($1, $2, 3, $3)', [ids.dana, 'shoot', 'דנה'])).error, /permission denied/);
});

test('the page: client-safe data only, a view logged once, a friendly state for a bad link', async () => {
  const s = await status(token);
  assert.equal(s.state, 'ok');
  assert.equal(s.preview, false);
  assert.equal(s.client.business, 'קפה דנה בע״מ');
  const text = JSON.stringify(s);
  for (const secret of ['050-1234567', 'הערה פנימית', 'בעיה פנימית', 'p25.return', 'p22.missing', 'p25.approved', 'nadia', 'metricool', 'javascript:', 'irit@']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.deepEqual(Object.keys(s.links).sort(), ['drive', 'scripts']);
  for (const k of Object.keys(s.marks)) assert.ok(MARKS.test(k), k);
  assert.deepEqual(s.items.map((i) => `${i.item}:${i.state}:${i.round}`), ['graphics9:waiting:1', 'scripts:waiting:1', 'graphics:waiting:1', 'videos:waiting:1']);
  // One view per 5 minutes.
  await status(token);
  assert.equal((await db.query('select count(*)::int as n from public.client_status_views')).rows[0].n, 1);
  // A signed-in staff member previews: nothing logged.
  await db.query('delete from public.client_status_views');
  const prev = (await keep('irit', 'select public.get_status($1) as s', [token]))[0].s;
  assert.equal(prev.preview, true);
  assert.equal((await db.query('select count(*)::int as n from public.client_status_views')).rows[0].n, 0);
  // Bad links.
  assert.equal((await status('short')).state, 'invalid');
  assert.equal((await status('A'.repeat(43))).state, 'invalid');
  assert.equal((await status(null)).state, 'invalid');
});

test('the words the database checks are the page\'s', async () => {
  for (const item of Object.keys(ITEMS)) {
    for (const r of [1, 2]) {
      for (const form of ['label', 'lamed', 'next']) {
        assert.equal((await db.query('select private.status_item_text($1, $2, $3) as t', [item, r, form])).rows[0].t, itemText(item, r, form));
      }
      for (const decision of ['approve', 'fix']) {
        const args = { name: ' דנה  לוי ', business: 'קפה דנה', item, shootRound: r, round: r };
        const sql = (await db.query('select private.status_wording($1, $2, $3, $4, $5, $6) as w', [decision, args.name, args.business, item, r, r])).rows[0].w;
        assert.equal(sql, wordingFor(decision, args), `${decision} ${item} ${r}`);
      }
    }
  }
  for (const k of Object.keys(QUESTIONS)) assert.equal((await db.query('select private.survey_question($1) as t', [k])).rows[0].t, QUESTIONS[k]);
  assert.equal((await db.query('select private.whatsapp_consent_text() as t')).rows[0].t, `${WHATSAPP_CONSENT.label}\n${WHATSAPP_CONSENT.more}`);
  for (const k of ['p07.sent', 'r2.p27.approved', 'p23.approved', 'p25.return.1', 'p13.zoom', 'p27.wait', 'p04.followup', 'p22a.assigned']) {
    assert.equal((await db.query('select private.status_mark_ok($1) as ok', [k])).rows[0].ok, MARKS.test(k), k);
  }
});

const wording = (s, key, decision, name) => {
  const it = s.items.find((i) => i.key === key);
  return wordingFor(decision, { name, business: s.client.business, item: it.item, shootRound: it.shootRound, round: it.round, included: it.included });
};

test('approving: evidence with the exact words, the protocol item marked; not twice, not by staff, not with other words', async () => {
  let s = await status(token);
  const w = wording(s, 'p07.approved', 'approve', 'דנה לוי');
  assert.match((await q('anon', 'select public.approve_item($1, $2, $3, $4)', [token, 'p07.approved', 'דנה לוי', `${w} `])).error, /wording changed/);
  assert.match((await q('irit', 'select public.approve_item($1, $2, $3, $4)', [token, 'p07.approved', 'דנה לוי', w])).error, /staff cannot act/);
  assert.match((await q('anon', 'select public.approve_item($1, $2, $3, $4)', [token, 'p07.approved', 'ד', w])).error, /invalid name/);
  s = (await keep('anon', 'select public.approve_item($1, $2, $3, $4, $5) as s', [token, 'p07.approved', 'דנה לוי', w, 'מעולה']))[0].s;
  assert.equal(s.items.find((i) => i.key === 'p07.approved').state, 'approved');
  const a = (await db.query("select * from public.client_approvals where item_key = 'p07.approved'")).rows[0];
  assert.equal(a.wording, w);
  assert.equal(a.decision, 'approve');
  assert.equal(a.round, 1);
  assert.equal(a.signer_name, 'דנה לוי');
  assert.equal(a.ip, '203.0.113.9');
  assert.equal(a.user_agent, 'TestBrowser/1.0');
  assert.equal(a.file_ref, 'https://drive.google.com/x');
  assert.match(a.evidence_hash, /^[0-9a-f]{64}$/);
  const c = (await db.query("select * from public.protocol_checks where client_id = $1 and item_key = 'p07.approved'", [ids.dana])).rows[0];
  assert.equal(c.state, 'done');
  assert.equal(c.by_email, 'system');
  assert.match(c.note, /אושר בדף המצב על ידי דנה לוי/);
  assert.match((await q('anon', 'select public.approve_item($1, $2, $3, $4)', [token, 'p07.approved', 'דנה לוי', w])).error, /not awaiting approval/);
  // The client sees their own approval in the page's history.
  assert.equal(s.approvals[0].name, 'דנה לוי');
});

test('a fix request: a task for whoever fixes, the round counted; another round is Lior\'s call', async () => {
  let s = await status(token);
  const w = wording(s, 'p23.approved', 'fix', 'דנה');
  assert.match((await q('anon', 'select public.request_fix($1, $2, $3, $4, $5)', [token, 'p23.approved', 'דנה', w, ' '])).error, /note required/);
  s = (await keep('anon', 'select public.request_fix($1, $2, $3, $4, $5) as s', [token, 'p23.approved', 'דנה', w, 'הטלפון בגרפיקה 4 שגוי']))[0].s;
  assert.equal(s.items.find((i) => i.key === 'p23.approved').state, 'fixing');
  const t = (await db.query("select * from public.client_tasks where source = 'client_fix' and brief ->> 'item_key' = 'p23.approved'")).rows[0];
  assert.equal(t.owner, 'ilai');
  assert.match(t.title, /^תיקון לבקשת הלקוח: יתרת הגרפיקות · סבב 1$/);
  assert.equal(t.brief.problem, 'הטלפון בגרפיקה 4 שגוי');
  assert.ok(t.due_on);
  // While it is being fixed: no second request, no approval.
  assert.match((await q('anon', 'select public.request_fix($1, $2, $3, $4, $5)', [token, 'p23.approved', 'דנה', w, 'עוד'])).error, /not awaiting approval/);
  // Ilai fixes it: back with the client, round 2, and a fix now is another round, for Lior.
  await db.query('update public.client_tasks set done_at = now() where id = $1', [t.id]);
  s = await status(token);
  const it = s.items.find((i) => i.key === 'p23.approved');
  assert.deepEqual([it.state, it.round], ['waiting', 2]);
  const w2 = wording(s, 'p23.approved', 'fix', 'דנה');
  assert.match(w2, /תיקון נוסף ליתרת הגרפיקות, מעבר לסבבים הכלולים בחבילה/);
  await keep('anon', 'select public.request_fix($1, $2, $3, $4, $5)', [token, 'p23.approved', 'דנה', w2, 'עוד צבע']);
  const t2 = (await db.query("select * from public.client_tasks where source = 'client_fix' and brief ->> 'item_key' = 'p23.approved' and done_at is null")).rows[0];
  assert.equal(t2.owner, 'lior');
  assert.equal(t2.brief.extra, true);
  // The scripts go to Lior.
  const ws = wording(s, 'p13.approved', 'fix', 'דנה');
  await keep('anon', 'select public.request_fix($1, $2, $3, $4, $5)', [token, 'p13.approved', 'דנה', ws, 'תסריט 2 לא מתאים']);
  assert.equal((await db.query("select owner from public.client_tasks where brief ->> 'item_key' = 'p13.approved'")).rows[0].owner, 'lior');
  // Approving in the Zoom (Lior marks it) closes his fix task.
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p13.approved', 'done')", [ids.dana]);
  assert.ok((await db.query("select done_at from public.client_tasks where brief ->> 'item_key' = 'p13.approved'")).rows[0].done_at);
});

test('the videos: the notes go to the editor through the protocol (p27.notes), and her fixes close the task', async () => {
  let s = await status(token);
  const w = wording(s, 'p27.approved', 'fix', 'דנה');
  s = (await keep('anon', 'select public.request_fix($1, $2, $3, $4, $5) as s', [token, 'p27.approved', 'דנה', w, 'סרטון 3: מוזיקה אחרת']))[0].s;
  const t = (await db.query("select * from public.client_tasks where brief ->> 'item_key' = 'p27.approved'")).rows[0];
  assert.equal(t.owner, 'nadia');
  assert.equal(t.brief.notes_marked, true);
  const notes = (await db.query("select * from public.protocol_checks where client_id = $1 and item_key = 'p27.notes'", [ids.dana])).rows[0];
  assert.deepEqual(JSON.parse(notes.note), { text: 'סרטון 3: מוזיקה אחרת', via: 'status' });
  assert.equal(s.items.find((i) => i.key === 'p27.approved').state, 'fixing');
  // The notes never come back to the page: only their state.
  assert.ok(!JSON.stringify(s.marks).includes('מוזיקה'));
  // Nadia marks the client's fixes done (as herself): the task closes.
  await keep('nadia', "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p27.fixes', 'done')", [ids.dana]);
  assert.ok((await db.query('select done_at from public.client_tasks where id = $1', [t.id])).rows[0].done_at);
  s = await status(token);
  const it = s.items.find((i) => i.key === 'p27.approved');
  assert.deepEqual([it.state, it.round], ['waiting', 2]);
});

test('surveys: open when due, once; a low score opens Lior\'s call, 2 or less flags the owner; the office records answers from the group', async () => {
  let s = await status(token);
  assert.deepEqual(s.surveys.due, ['shoot', 'nps']); // the shoot was yesterday; the contract ends in 45 days
  assert.match((await q('anon', "select public.answer_survey($1, 'delivery', 5, 'דנה')", [token])).error, /survey not open/);
  assert.match((await q('anon', "select public.answer_survey($1, 'shoot', 9, 'דנה')", [token])).error, /check constraint/);
  s = (await keep('anon', "select public.answer_survey($1, 'shoot', 3, 'דנה לוי') as s", [token]))[0].s;
  assert.deepEqual(s.surveys.due, ['nps']);
  const row = (await db.query("select * from public.client_surveys where kind = 'shoot'")).rows[0];
  assert.deepEqual([row.score, row.source, row.recorded_by, row.question], [3, 'page', 'client', QUESTIONS.shoot]);
  const t = (await db.query('select * from public.client_tasks where id = $1', [row.task_id])).rows[0];
  assert.deepEqual([t.owner, t.source, t.brief.owner_alert], ['lior', 'survey', false]);
  assert.match(t.title, /^להתקשר ללקוח: ציון 3 מתוך 5 בשאלה על יום הצילום$/);
  assert.match((await q('anon', "select public.answer_survey($1, 'shoot', 4, 'דנה')", [token])).error, /survey not open/);
  // Not on a day the renewal message went out.
  await db.query("insert into public.client_messages (client_id, kind, template_key, ref, body) values ($1, 'milestone', 'renewal', 'renewal', 'x')", [ids.dana]);
  assert.deepEqual((await status(token)).surveys.due, []);
  await db.query("delete from public.client_messages where template_key = 'renewal'");
  // The office records an answer given in the group: 2 → the owner hears too.
  assert.match((await q('ilai', "select public.survey_record($1, 'nps', 2, 'דנה')", [ids.dana])).error, /not allowed/);
  await keep('irit', "select public.survey_record($1, 'nps', 4, 'דנה')", [ids.dana]);
  const n = (await db.query("select * from public.client_surveys where kind = 'nps'")).rows[0];
  assert.deepEqual([n.source, n.recorded_by], ['office', 'irit@astrateg.test']);
  assert.equal((await db.query('select brief from public.client_tasks where id = $1', [n.task_id])).rows[0].brief.owner_alert, true);
  // A good score opens nothing.
  const { rows: [c2] } = await db.query("insert into public.clients (name) values ('good') returning id");
  await keep('lior', "select public.survey_record($1, 'delivery', 5, 'רון')", [c2.id]);
  assert.equal((await db.query("select task_id from public.client_surveys where client_id = $1", [c2.id])).rows[0].task_id, null);
  // The office reads the answers; an editor does not.
  assert.equal((await q('owner', 'select 1 from public.client_surveys')).rows.length, 3);
  assert.deepEqual((await q('nadia', 'select 1 from public.client_surveys')).rows, []);
});

test('revoked, expired, closed: a friendly state, and nothing can be done', async () => {
  const [{ l }] = await keep('lior', 'select public.status_link_create($1) as l', [ids.dana]);
  assert.equal((await status(token)).state, 'revoked'); // a new link ends the one before
  assert.equal((await status(l.token)).state, 'ok');
  assert.match((await q('anon', "select public.answer_survey($1, 'nps', 9, 'דנה')", [token])).error, /status link revoked/);
  await db.query("update public.client_status_links set expires_at = now() - interval '1 minute' where id = $1", [l.id]);
  assert.equal((await status(l.token)).state, 'expired');
  await db.query("update public.client_status_links set expires_at = now() + interval '1 day' where id = $1", [l.id]);
  await keep('owner', 'select public.status_link_revoke($1)', [l.id]);
  assert.equal((await status(l.token)).state, 'revoked');
  assert.equal((await q('lior', 'select public.status_link_token($1) as t', [l.id])).rows[0].t, null);
  const [{ l: l3 }] = await keep('irit', 'select public.status_link_create($1) as l', [ids.dana]);
  await db.query("update public.clients set status = 'ended' where id = $1", [ids.dana]);
  assert.equal((await status(l3.token)).state, 'closed');
  await db.query("update public.clients set status = 'active' where id = $1", [ids.dana]);
});

test('the task sources keep every earlier value and add the two new ones', async () => {
  const def = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'client_tasks_source_check'")).rows[0].d;
  for (const v of ['p31', 'p33', 'escalation', 'status', 'pause', 'followup', 'request', 'tell', 'client_fix', 'survey']) assert.ok(def.includes(`'${v}'`), v);
});

test('signing: the WhatsApp choice is kept with the signature (optional, never required); four arguments still work', async () => {
  const model = { signable: true, docType: 'agreement', termMonths: 12, client: { name: 'חתימה', phone: '050-7654321' },
    package: { id: 'social-natali', tierName: 'Social', influencer: 'נטלי דדון' }, selection: { influencer: 'natali', paid: [], free: {} },
    totals: { monthlyNet: 100000, monthlyGross: 118000, termGross: 1416000 } };
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const quote = async () => (await db.query("insert into public.quotes (model, client_name, monthly_gross_agorot, term_gross_agorot) values ($1, 'חתימה', 118000, 1416000) returning id, token", [JSON.stringify(model)])).rows[0];
  const a = await quote();
  await keep('anon', 'select public.sign_quote($1, $2, $3, true, true)', [a.token, 'דנה לוי', png]);
  const ca = (await db.query('select * from public.client_consents where quote_id = $1', [a.id])).rows[0];
  assert.deepEqual([ca.given, ca.phone, ca.ip, ca.user_agent, ca.kind], [true, '050-7654321', '203.0.113.9', 'TestBrowser/1.0', 'whatsapp']);
  assert.equal(ca.wording, `${WHATSAPP_CONSENT.label}\n${WHATSAPP_CONSENT.more}`);
  assert.match(ca.version, /^whatsapp-v1/);
  const b = await quote();
  await keep('anon', 'select public.sign_quote($1, $2, $3, true)', [b.token, 'רון כהן', png]);
  assert.equal((await db.query('select given from public.client_consents where quote_id = $1', [b.id])).rows[0].given, false);
  assert.equal((await db.query("select status from public.quotes where id = $1", [b.id])).rows[0].status, 'signed');
  // Revoking ("הסר"): the office records when and how.
  const cid = (await db.query('select id from public.clients where quote_id = $1', [a.id])).rows[0].id;
  assert.match((await q('ilai', "select public.whatsapp_consent_revoke($1, 'whatsapp')", [cid])).error, /not allowed/);
  await keep('irit', "select public.whatsapp_consent_revoke($1, 'whatsapp')", [cid]);
  const r = (await db.query('select revoked_at, revoked_via, revoked_by from public.client_consents where quote_id = $1', [a.id])).rows[0];
  assert.ok(r.revoked_at);
  assert.deepEqual([r.revoked_via, r.revoked_by], ['whatsapp', 'irit@astrateg.test']);
  // Read by the office only.
  assert.equal((await q('ofir', 'select 1 from public.client_consents')).rows.length, 2);
  assert.deepEqual((await q('nadia', 'select 1 from public.client_consents')).rows, []);
});
