// "קריאת חוזה חתום" (the owner, 5.11.2026; docs/ops.md, section 104): the logic of reading a signed
// contract uploaded by hand (app/contract-read-logic.js) and the contract-ai function's read mode
// (supabase/functions/contract-ai/handler.js), with fakes in the shapes the real services answer:
// supabase-js { data, error }, Storage's download a Blob, the Messages API a message with a text block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_SCHEMA, PACKAGE_IDS, readSystemPrompt, validateReadResult, readMediaOf, readTooBig, contractEndOf,
  checkReadForm, clientPatchFromRead, manualAmounts, READ_USER_TEXT,
} from '../app/contract-read-logic.js';
import { makeHandler, buildReadRequest, toBase64, MODEL } from '../supabase/functions/contract-ai/handler.js';
import { packageName, dealDeliverables } from '../app/client-open.js';

const NOW = new Date('2026-11-05T10:00:00Z');

test('the schema is strict and names the catalog\'s packages, "משפיען לבחירה" among them', () => {
  assert.equal(READ_SCHEMA.additionalProperties, false);
  assert.deepEqual([...READ_SCHEMA.required].sort(), Object.keys(READ_SCHEMA.properties).sort());
  assert.ok(PACKAGE_IDS.includes('social-choice'));
  assert.deepEqual(READ_SCHEMA.properties.package_id.enum, ['', ...PACKAGE_IDS]);
  const p = readSystemPrompt();
  assert.match(p, /משפיען לבחירה/);
  assert.match(p, /514729938/, 'Astrateg\'s own company number is not the client\'s');
  assert.equal(p, readSystemPrompt(), 'the same text on every call (cached)');
});

test('the answer is checked: numbers, dates and the package; nothing unknown gets in', () => {
  const good = validateReadResult({ business: ' סטודיו  סיוון ', company_id: '066-196445', contact_name: 'סיוון פנסו', package_id: 'social-choice', monthly_net: 3900, term_months: 12, signed_on: '2026-11-04', notes: [] }, NOW);
  assert.deepEqual(good.result, { business: 'סטודיו סיוון', company_id: '066196445', contact_name: 'סיוון פנסו', package_id: 'social-choice', monthly_net: 3900, term_months: 12, signed_on: '2026-11-04', notes: [] });
  assert.deepEqual(good.dropped, []);
  const bad = validateReadResult({ business: '', company_id: '123', package_id: 'gold', monthly_net: 99999999, term_months: 400, signed_on: '2027-13-01', notes: ['א', '', 'ב', 'ג', 'ד'] }, NOW);
  assert.deepEqual([bad.result.company_id, bad.result.package_id, bad.result.monthly_net, bad.result.term_months, bad.result.signed_on], ['', '', null, null, '']);
  assert.deepEqual(bad.result.notes, ['א', 'ב', 'ג']);
  assert.deepEqual(bad.dropped.map((d) => d.field), ['company_id', 'package_id', 'monthly_net', 'term_months', 'signed_on']);
  // A date in the future is not a signing day.
  assert.equal(validateReadResult({ signed_on: '2026-12-01' }, NOW).result.signed_on, '');
  // Not an object at all: nothing throws.
  assert.equal(validateReadResult('x', NOW).dropped[0].field, '');
});

test('the file types and sizes the model reads', () => {
  assert.deepEqual(readMediaOf('application/pdf'), { kind: 'document', mime: 'application/pdf' });
  assert.deepEqual(readMediaOf('', 'a/b/c-חוזה.PDF'), { kind: 'document', mime: 'application/pdf' });
  assert.deepEqual(readMediaOf('image/jpeg'), { kind: 'image', mime: 'image/jpeg' });
  assert.deepEqual(readMediaOf('image/heic', 'x.heic'), { error: 'read_unsupported' });
  assert.equal(readTooBig({ kind: 'image' }, 4 * 1024 * 1024), true);
  assert.equal(readTooBig({ kind: 'document' }, 4 * 1024 * 1024), false);
});

test('the end of the contract, the review form, what fills the client, the amounts with VAT', () => {
  assert.equal(contractEndOf('2026-11-04', 12), '2027-11-04');
  assert.equal(contractEndOf('2026-11-04', null), null);
  const f = checkReadForm({ business: 'בסט קאר', company_id: '51 515151 5', contact_name: '', package_id: 'social-choice', monthly_net: '3,900', term_months: '12', signed_on: '2026-11-04' }, NOW);
  assert.equal(f.ok, true);
  assert.deepEqual(f.row, { business: 'בסט קאר', company_id: '515151515', contact_name: null, package_id: 'social-choice', monthly_net_agorot: 390000, term_months: 12, signed_on: '2026-11-04' });
  const e = checkReadForm({ business: '', company_id: '12', monthly_net: '39.5', term_months: '0', signed_on: '2026-02-30', package_id: 'x' }, NOW);
  assert.deepEqual(Object.keys(e.errors).sort(), ['business', 'company_id', 'monthly_net', 'package_id', 'signed_on', 'term_months']);
  // The client: only what is missing, except the package's name and the end, which the contract decides.
  const patch = clientPatchFromRead(f.row, { business: 'קיים', package_name: null, deliverables: null, contract_end: '2027-01-01' }, { packageName, dealDeliverables });
  assert.deepEqual(Object.keys(patch).sort(), ['company_id', 'contract_end', 'deliverables', 'package_name']);
  assert.equal(patch.package_name, packageName('social-choice'));
  assert.equal(patch.contract_end, '2027-11-04');
  assert.equal(patch.deliverables.videos, 36);
  assert.deepEqual(clientPatchFromRead(f.row, { business: 'x', company_id: '1', package_name: packageName('social-choice'), deliverables: { videos: 1 }, contract_end: '2027-11-04' }, { packageName, dealDeliverables }), {});
  assert.deepEqual(manualAmounts({ monthly_net_agorot: 390000, term_months: 12 }), { monthly_gross_agorot: 460200, term_gross_agorot: 5522400 });
});

// ── The function's read mode ──
const FILE_ID = '1f6c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000001';
const PDF = new TextEncoder().encode('%PDF-1.4 contract');
const ANSWER = { business: 'בסט קאר', company_id: '515151515', contact_name: 'דני', package_id: 'social-choice', monthly_net: 3900, term_months: 12, signed_on: '2026-11-04', notes: [] };
const reply = (raw) => ({ id: 'msg_1', model: MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(raw) }] });

function world({ office = true, may = true, file = { id: FILE_ID, client_id: CLIENT, kind: 'material_other', label: 'חוזה חתום', storage_path: `${CLIENT}/material_other/${FILE_ID}-חוזה.pdf`, mime: 'application/pdf', size_bytes: PDF.length, deleted_at: null }, bytes = PDF, answer = ANSWER, key = 'sk-ant-secret-key' } = {}) {
  const w = { calls: [], inserts: [], logs: [], downloads: [], rpcs: [] };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', ...(key ? { ANTHROPIC_API_KEY: key } : {}) };
  const createClient = (url, k, opts) => ({
    auth: { getUser: async () => ({ data: { user: opts?.global?.headers?.Authorization ? { id: 'u-ofir', email: 'ofir@astrateg.test' } : null } }) },
    rpc: async (fn, args) => {
      w.rpcs.push([fn, args]);
      if (fn === 'is_office') return { data: office, error: null };
      if (fn === 'can_upload_client_file') return { data: may, error: null };
      return { data: null, error: { message: 'no' } };
    },
    from: (t) => ({
      select: () => ({
        eq: (col, v) => ({
          gte: async () => ({ count: 0, error: null }),
          maybeSingle: async () => ({ data: t === 'client_files' && file && v === file.id ? file : null, error: null }),
        }),
      }),
      insert: (row) => ({ select: () => ({ single: async () => { w.inserts.push({ t, row }); return { data: { id: 'run-1' }, error: null }; } }) }),
    }),
    storage: { from: (bucket) => ({ download: async (path) => { w.downloads.push([bucket, path]); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { name: 'StorageError' } }; } }) },
  });
  const makeClient = () => ({ beta: { messages: { create: async (params) => { w.calls.push(params); return reply(answer); } } } });
  w.handle = makeHandler({ env: (k) => env[k], serviceKey: () => 'service', createClient, makeClient, Errors: {}, log: (m) => w.logs.push(m) });
  return w;
}
const post = (body) => new Request('https://db.example/functions/v1/contract-ai', { method: 'POST', headers: { Authorization: 'Bearer t', origin: 'https://app.astrateg.tech', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = async (w, body) => { const res = await w.handle(post(body)); return { status: res.status, body: await res.json() }; };

test('the function reads the file: the PDF to Claude, the checked answer back, the run kept without the bytes', async () => {
  const w = world();
  const r = await call(w, { mode: 'read', fileId: FILE_ID.toUpperCase() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.mode, r.body.clientId, r.body.fileId], ['read', CLIENT, FILE_ID]);
  assert.deepEqual(r.body.result, validateReadResult(ANSWER, new Date()).result);
  // The caller's own right to that client, then the file from the private bucket.
  assert.deepEqual(w.rpcs.map(([fn]) => fn), ['is_office', 'can_upload_client_file']);
  assert.deepEqual(w.rpcs[1][1], { p_client: CLIENT, p_kind: 'material_other' });
  assert.deepEqual(w.downloads, [['client-files', `${CLIENT}/material_other/${FILE_ID}-חוזה.pdf`]]);
  // The request: the document, then the short words; the strict schema.
  const params = w.calls[0];
  assert.deepEqual(params, buildReadRequest({ kind: 'document', mime: 'application/pdf' }, toBase64(PDF)));
  assert.equal(params.messages[0].content[0].type, 'document');
  assert.equal(params.messages[0].content[0].source.data, Buffer.from(PDF).toString('base64'));
  assert.equal(params.messages[0].content[1].text, READ_USER_TEXT);
  assert.deepEqual(params.output_config.format.schema, READ_SCHEMA);
  // The run: what was read, never the file.
  const run = w.inserts[0].row;
  assert.equal(run.deal_text, `קריאת חוזה חתום: ${FILE_ID}`);
  assert.equal(run.result.mode, 'read');
  assert.doesNotMatch(JSON.stringify([w.inserts, w.logs]), /JVBERi|sk-ant-secret-key/);
});

test('the function refuses what it may not read, before anything goes to Claude', async () => {
  const cases = [
    [{}, { mode: 'read' }, 400, 'file_required'],
    [{}, { mode: 'read', fileId: 'not-a-uuid' }, 400, 'file_required'],
    [{ office: false }, { mode: 'read', fileId: FILE_ID }, 403, 'not staff: contracts are prepared by the office'],
    [{ may: false }, { mode: 'read', fileId: FILE_ID }, 403, 'not_allowed'],
    [{ file: null }, { mode: 'read', fileId: FILE_ID }, 404, 'file_not_found'],
    [{ file: { id: FILE_ID, client_id: CLIENT, kind: 'logo', label: null, storage_path: 'x', mime: 'image/png', size_bytes: 1 } }, { mode: 'read', fileId: FILE_ID }, 404, 'file_not_found'],
    [{ file: { id: FILE_ID, client_id: CLIENT, kind: 'material_other', label: 'חוזה חתום', storage_path: 'x.heic', mime: 'image/heic', size_bytes: 1 } }, { mode: 'read', fileId: FILE_ID }, 415, 'read_unsupported'],
    [{ file: { id: FILE_ID, client_id: CLIENT, kind: 'material_other', label: 'חוזה חתום', storage_path: 'x.jpg', mime: 'image/jpeg', size_bytes: 9e6 } }, { mode: 'read', fileId: FILE_ID }, 413, 'read_too_big'],
    [{ bytes: null }, { mode: 'read', fileId: FILE_ID }, 502, 'file_unreadable'],
    [{ key: null }, { mode: 'read', fileId: FILE_ID }, 503, 'ai_not_configured'],
  ];
  for (const [opts, body, status, error] of cases) {
    const w = world(opts);
    const r = await call(w, body);
    assert.deepEqual([r.status, r.body.error], [status, error], JSON.stringify(opts).slice(0, 60));
    assert.equal(w.calls.length, 0);
  }
  // A picture goes as an image.
  const w = world({ file: { id: FILE_ID, client_id: CLIENT, kind: 'material_other', label: 'חוזה חתום', storage_path: `${CLIENT}/material_other/${FILE_ID}-scan.jpg`, mime: 'image/jpeg', size_bytes: PDF.length } });
  assert.equal((await call(w, { mode: 'read', fileId: FILE_ID })).status, 200);
  assert.deepEqual(w.calls[0].messages[0].content[0].type, 'image');
  // The text modes are as before.
  assert.equal((await call(world(), { text: '' })).body.error, 'text_required');
});
