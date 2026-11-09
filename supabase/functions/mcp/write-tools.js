// The owner's write tools of the mcp function (the owner, 9.11.2026; docs/ops.md, section 116): from
// Claude on the phone, in words, the owner marks a protocol item, changes a client's details, sets or
// moves a characterization meeting or a shoot day, gives or closes a task, writes a special note to an
// employee, prepares AND creates a contract for a client, and records a request for a change to the
// system. Plain JavaScript, so node tests run it whole (tests/mcp-write.test.mjs).
//
//   - the owners only (public.my_person() null): Lior and Ofir keep reading and the draft. The handler
//     lists and runs these tools for the owner alone, and the database's gate (public.mcp_request_gate(),
//     supabase/migrations/20261207100000_mcp_write.sql) lets a connected app's token write only when it
//     is an owner's, only the tables and rpcs in WRITE_GATE below;
//   - every write goes with the owner's own token (the OAuth token): row level security, the triggers
//     and the stamps (by_email, the history) are the app's own. Never the service key. The contract is
//     created by the create-quote function, as the builder creates it (it recomputes the price);
//   - each tool does what the app's own screen does, with its rules: the client card's mark (the
//     guards of app/mark-guard-rules.js, what it waits for, a reason for "לא רלוונטי", the wait closed
//     when the process completes, the folder task with item 24), the card's details form (only these
//     fields), the meeting and shoot-day dialogs (app/date-set.js: "נקבעה פגישה" with a first meeting,
//     the shoot day's questions and the reason kept with the date), the "נודניק" functions, the
//     builder (create-quote, the deal linked);
//   - `dry_run` (the default): a Hebrew paragraph of exactly what would change, and nothing written.
//     Claude shows it to the owner and calls again with dry_run: false only after a yes;
//   - nothing is deleted: no tool removes a client, a task or a note's history. "Clear" of a mark and
//     "close" of a task are what the app does with them;
//   - no phone, email or company number goes back: the contract's details are read from the system
//     here and sent to create-quote, never shown; free text with an email or a long number is refused.
import { PEOPLE, PROCESSES, CHARACTERIZERS, EDITORS, CLIENT_STATUS, TEAM_PEOPLE, SHOOT_TYPES, PHOTOGRAPHERS, isSilent } from '../_shared/app/protocol.js';
import { clientState, blockers, isResolved, WAIT, WAITED, endWaitNote, roundsOf } from '../_shared/app/protocol-logic.js';
import { guardOf, formOf, guardVerdict, ganttFacts, roundOfKey } from '../_shared/app/mark-guard-rules.js';
import { GANTT_KINDS } from '../_shared/app/gantt-template.js';
import { folderItemOf } from '../_shared/app/qa-logic.js';
import { validateTask, ASSIGNEES } from '../_shared/app/staff-tasks-logic.js';
import { shootDateConcerns, shootDateNote } from '../_shared/app/shoot-prep.js';
import * as A from '../_shared/app/availability-logic.js';
import { isChoice, soloOf, choiceOf, crewPatch, roundWithCrew } from '../_shared/app/shoot-crew.js';
import { fromInputIL, dayKeyIL, partsIL } from '../_shared/app/tz.js';
import { draftOf, DRAFT_SCHEMA, DRAFT_ERRORS, DRAFT_SITE, PERSONAL } from '../_shared/app/mcp-draft.js';
import { DOC_TYPES } from '../_shared/app/catalog.js';
import { whatsappLink } from '../_shared/app/quote-doc.js';
import { matchClient } from '../ask/tools.js';

// ── What a connected app's token may do in the database, for an owner (the gate's lists) ──
// tests/sql/mcp-write.test.mjs holds these equal to public.mcp_request_gate() in the migration.
export const WRITE_GATE = {
  // Read, besides the read tools' tables (TABLES in ../ask/tools.js): the guards' and the shoot day's facts, the notes.
  read: ['client_scripts', 'photographer_months', 'photographer_changes', 'staff_notes'],
  insert: ['protocol_checks', 'staff_notes', 'system_requests'],
  update: ['clients', 'client_tasks', 'deal_requests'],
  delete: ['protocol_checks'],
  rpcs: [
    'staff_task_create', 'staff_task_create_brief', 'staff_task_done', 'staff_task_cancel', 'staff_note_delete',
    'date_change_note', 'photographer_taken', 'photographer_taken_by', 'clients_private', 'clients_contact', 'deal_take',
  ],
};
const READ_TABLES = ['clients', 'client_tasks', 'staff_tasks', 'protocol_checks', 'client_gantt', 'client_files', 'deal_requests', ...WRITE_GATE.read];

// The person's client with only these tables, these operations and these rpcs (as guardDb for the reads).
export function guardWrite(client) {
  const allowed = (table, op) => (op === 'select' ? READ_TABLES : WRITE_GATE[op] || []).includes(table);
  return {
    from(table) {
      const q = client.from(table);
      const wrap = (op) => (...args) => {
        if (!allowed(table, op)) throw Object.assign(new Error(`not allowed: ${op} ${table}`), { code: 'not_allowed' });
        if (op === 'select' && (typeof args[0] !== 'string' || args[0].includes('*'))) throw new Error('name the columns');
        return q[op === 'insert' && args[1]?.onConflict ? 'upsert' : op](...args);
      };
      return { select: wrap('select'), insert: wrap('insert'), update: wrap('update'), delete: wrap('delete') };
    },
    rpc(fn, args) {
      if (!WRITE_GATE.rpcs.includes(fn)) throw Object.assign(new Error(`not allowed: rpc ${fn}`), { code: 'not_allowed' });
      return client.rpc(fn, args);
    },
  };
}

// ── Small helpers ──────────────────────────────
const plain = (s) => String(s ?? '').replace(/[‎‏‪-‮⁦-⁩"'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const label = (c) => (c.business && c.business !== c.name ? `${c.name} (${c.business})` : c.name);
const personName = (k) => (k === 'owner' ? 'הבעלים' : PEOPLE[k]?.name || k || '');
const personKey = (v, list) => {
  const s = plain(v);
  if (!s) return null;
  const hit = list.find((p) => p.key === s || plain(p.name) === s);
  return hit ? hit.key : null;
};
const whenText = (d) => {
  const p = partsIL(d);
  return `${p.day}.${p.month}.${p.year} בשעה ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};
const textOf = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max + 1);
// A refusal, in one Hebrew sentence (and, when there is more than one match, the candidates).
class Refusal extends Error {
  constructor(text, code = 'refused', extra = {}) { super(text); this.code = code; this.extra = extra; }
}
const refuse = (text, code, extra) => { throw new Refusal(text, code, extra); };
const personalIn = (...texts) => texts.some((t) => typeof t === 'string' && PERSONAL.test(t));
const PERSONAL_WORDS = 'בטקסט יש מייל או מספר ארוך. טלפונים, מיילים ומספרי זהות לא עוברים כאן.';

async function rows(query) {
  const { data, error } = await query;
  if (error) throw Object.assign(new Error('db'), { code: error.code || 'db' });
  return Array.isArray(data) ? data : data ? [data] : [];
}
// A write's answer: the database's code, never its words.
async function wrote(query) {
  const { data, error } = await query;
  if (error) throw Object.assign(new Error('db'), { code: error.code || 'db' });
  return data;
}

// The client's columns these tools need (as the card reads them: never phone, notes or email here).
const CLIENT_COLS = 'id, name, business, address, package_name, shoot_type, characterizer, has_logo, editor_name, deal_at, char_at, shoot_at, contract_end, status, quote_id, created_at, links, deliverables, rounds, editor, editor2, protocol_version, archived_at, landing, landed_at, landing_slot';
const CHECK_COLS = 'client_id, item_key, state, note, by_email, at';
async function clientOf(ctx, words) {
  if (typeof words !== 'string' || !words.trim()) refuse('צריך שם של לקוח.', 'bad_input');
  const list = await rows(ctx.db.from('clients').select(CLIENT_COLS).order('name').limit(1000));
  const m = matchClient(list, words.slice(0, 200));
  if (!m.client) refuse(m.error, m.candidates ? 'ambiguous' : 'not_found', m.candidates ? { candidates: m.candidates } : {});
  return m.client;
}
async function checksOf(ctx, clientId) {
  const list = await rows(ctx.db.from('protocol_checks').select(CHECK_COLS).eq('client_id', clientId).limit(5000));
  return Object.fromEntries(list.map((r) => [r.item_key, r]));
}

// ── 1. A protocol item: done, "לא רלוונטי", or open again ──
const ITEM_NOTE_MAX = 500;
const stateWords = { done: 'בוצע', na: 'לא רלוונטי', clear: 'פתוח' };
function itemsOf(client, checks, now) {
  const out = [];
  for (const s of clientState(client, checks, now).states) for (const i of s.proc.items) out.push({ proc: s.proc, item: i });
  return out;
}
const procTitle = (p) => `${p.ctx?.round ? `סבב ${p.ctx.round} · ` : ''}${p.num ? `${p.num}. ` : ''}${p.title}`;
function itemFrom(list, words) {
  const w = String(words ?? '').trim();
  if (!w) refuse('צריך את הפריט: המפתח שלו (למשל p03.scheduled) או המילים שלו.', 'bad_input');
  const byKey = list.find((x) => x.item.key === w);
  if (byKey) return byKey;
  const p = plain(w);
  const exact = list.filter((x) => plain(x.item.label) === p);
  const pool = exact.length ? exact : list.filter((x) => plain(x.item.label).includes(p) || plain(`${x.proc.title} ${x.item.label}`).includes(p));
  if (pool.length === 1) return pool[0];
  if (!pool.length) refuse(`לא נמצא אצל הלקוח הזה פריט "${w.slice(0, 60)}".`, 'not_found');
  return refuse('נמצאו כמה פריטים כאלה. איזה מהם? (לשלוח את המפתח, key)', 'ambiguous', {
    candidates: pool.slice(0, 12).map((x) => ({ key: x.item.key, item: x.item.label, process: procTitle(x.proc) })),
  });
}
// The facts a guard looks at, read as the owner (as guardFacts in app/mark-guards.js). null: not known.
async function guardFactsOf(ctx, guard, clientId, key) {
  try {
    if (guard === 'gantt' || guard === 'scheduled') {
      const data = await rows(ctx.db.from('client_gantt').select('kind, state').eq('client_id', clientId).limit(5000));
      return ganttFacts(data, (kind) => !!GANTT_KINDS[kind]?.post);
    }
    if (guard === 'scripts') return { scripts: (await rows(ctx.db.from('client_scripts').select('n').eq('client_id', clientId).eq('round', roundOfKey(key)).limit(1))).length };
    if (guard === 'logoFile') return { logos: (await rows(ctx.db.from('client_files').select('id').eq('client_id', clientId).eq('kind', 'logo').is('deleted_at', null).limit(1))).length };
  } catch { /* not known: the mark is taken */ }
  return null;
}

async function markItem(ctx, a) {
  const state = a.state;
  if (!['done', 'na', 'clear'].includes(state)) refuse('state הוא done, na או clear.', 'bad_input');
  const now = ctx.now();
  const client = await clientOf(ctx, a.client);
  const checks = await checksOf(ctx, client.id);
  const list = itemsOf(client, checks, now);
  const { proc, item } = itemFrom(list, a.item);
  const cur = checks[item.key] && isResolved(item, checks[item.key], now) ? checks[item.key].state : null;
  const note = a.note === undefined || a.note === null ? '' : textOf(a.note, ITEM_NOTE_MAX);
  if (note.length > ITEM_NOTE_MAX) refuse(`ההערה עד ${ITEM_NOTE_MAX} תווים.`, 'bad_input');
  if (personalIn(note)) refuse(PERSONAL_WORDS, 'personal_details');
  // As the card: an item that is a form of its own, or a call or a daily follow-up, is done there.
  if (formOf(item.key)) refuse('את הפריט הזה סוגרים דרך הטופס שלו בכרטיס הלקוח, לא בסימון.', 'via_form');
  if (item.recurring || guardOf(item.key) === 'callSummary') refuse('את הפריט הזה מתעדים בכרטיס הלקוח (השיחה או המעקב עצמם), לא בסימון.', 'via_card');
  const warn = [];
  if (state === 'done') {
    if (cur === 'done') refuse('הפריט כבר מסומן ״בוצע״. לא שיניתי כלום.', 'nothing_to_change');
    if (cur === 'na') refuse('הפריט מסומן ״לא רלוונטי״. קודם מחזירים אותו לפתוח (state: clear), ואז מסמנים.', 'is_na');
    const block = blockers(item, proc.ctx || client, checks);
    if (block) {
      const names = Object.fromEntries(list.map((x) => [x.item.key, x.item.label]));
      refuse(`הפריט עוד מחכה: ${[...block.items.map((k) => names[k] || k), ...block.fields.map((f) => `פרט חסר בכרטיס (${f})`)].join(', ')}.`, 'blocked');
    }
    const guard = guardOf(item.key);
    if (guard && guard !== 'graphicsCount') {
      const v = guardVerdict(guard, await guardFactsOf(ctx, guard, client.id, item.key));
      if (v?.refuse) refuse(v.refuse, 'guard');
    }
    if (guard === 'graphicsCount') warn.push('כדאי לוודא שכל הגרפיקות הועלו (במסך של עילאי נשאל על זה).');
  } else if (state === 'na') {
    if (cur === 'na') refuse('הפריט כבר מסומן ״לא רלוונטי״. לא שיניתי כלום.', 'nothing_to_change');
    if (cur === 'done') refuse('הפריט מסומן ״בוצע״. קודם מבטלים את הסימון (state: clear).', 'is_done');
    if (item.key.replace(/^r\d+\./, '') === 'p13.approved') refuse('אישור הלקוח לא מסומן ״לא רלוונטי״: הוא ניתן או לא.', 'no_na');
    if (!item.optional && !note) refuse('ל״לא רלוונטי״ צריך סיבה קצרה (note), כמו בכרטיס.', 'reason_required');
  } else if (!checks[item.key]) refuse('הפריט כבר פתוח. לא שיניתי כלום.', 'nothing_to_change');

  const verb = state === 'done' ? 'יסומן ״בוצע״' : state === 'na' ? `יסומן ״${item.optional ? 'לא נדרש' : 'לא רלוונטי'}״${note ? ` (סיבה: ${note})` : ''}` : 'יחזור להיות פתוח (הסימון שלו יוסר; ההיסטוריה נשמרת)';
  const preview = `אצל ${label(client)}, בתהליך ${procTitle(proc)}: הפריט "${item.label}" ${verb}. הסימון יירשם בשמך, כמו בכרטיס הלקוח.${warn.length ? ` ${warn.join(' ')}` : ''}`;
  if (a.dry_run !== false) return { preview };

  if (state === 'clear') {
    await wrote(ctx.db.from('protocol_checks').delete().eq('client_id', client.id).eq('item_key', item.key));
    delete checks[item.key];
  } else {
    checks[item.key] = await wrote(ctx.db.from('protocol_checks')
      .insert({ client_id: client.id, item_key: item.key, state, note: note || null }, { onConflict: 'client_id,item_key' })
      .select(CHECK_COLS).single());
  }
  const also = [];
  if (state !== 'clear' && await endWaitIfComplete(ctx, client, checks, item.key, now)) also.push('ההמתנה ללקוח בתהליך הזה נסגרה.');
  // The folder item (24) closes Ofir's folder task with it (as the card).
  if (state === 'done' && /^(r\d+\.)?p24\.folder$/.test(item.key)) {
    const open = await rows(ctx.db.from('client_tasks').select('id, title').eq('client_id', client.id).is('done_at', null).limit(200));
    for (const t of open.filter((x) => folderItemOf(x) === item.key)) {
      try { await wrote(ctx.db.from('client_tasks').update({ done_at: ctx.now().toISOString() }).eq('id', t.id).select('id')); also.push('משימת התיקייה של אופיר נסגרה איתו.'); } catch { /* the task stays */ }
    }
  }
  return { done: `${label(client)}: "${item.label}" ${stateWords[state] === 'פתוח' ? 'חזר להיות פתוח' : `סומן ״${stateWords[state]}״`}.${also.length ? ` ${also.join(' ')}` : ''}` };
}
// A process that is complete no longer waits on the client (the card's endWaitIfComplete).
async function endWaitIfComplete(ctx, client, checks, key, now) {
  if (/\.(claim|wait|waited|pause)$/.test(key)) return false;
  const st = clientState(client, checks, now).states.find((x) => x.proc.items.some((i) => i.key === key));
  if (!st?.complete) return false;
  const wk = WAIT(st.proc);
  const tk = WAITED(st.proc);
  if (!checks[wk]) return false;
  try {
    await wrote(ctx.db.from('protocol_checks').insert({ client_id: client.id, item_key: tk, state: 'done', note: endWaitNote(client, st.proc, checks, now) }, { onConflict: 'client_id,item_key' }).select(CHECK_COLS).single());
    await wrote(ctx.db.from('protocol_checks').delete().eq('client_id', client.id).eq('item_key', wk));
    return true;
  } catch { return false; /* the wait stays and counts until completion */ }
}

// ── 2. A client's details (the card's details form, these fields only) ──
const FIELD_MAX = 120;
export const CLIENT_FIELDS = ['name', 'business', 'package_name', 'characterizer', 'editor', 'status'];
const FIELD_WORDS = { name: 'שם', business: 'עסק', package_name: 'חבילה', characterizer: 'מי מבצע את האפיון', editor: 'העורך', status: 'סטטוס' };
const valueWords = (f, v) => {
  if (v === null || v === undefined || v === '') return '(ריק)';
  if (f === 'characterizer' || f === 'editor') return personName(v);
  if (f === 'status') return CLIENT_STATUS[v] || v;
  return String(v);
};
async function updateClientTool(ctx, a) {
  const client = await clientOf(ctx, a.client);
  const patch = {};
  for (const f of ['name', 'business', 'package_name']) {
    if (a[f] === undefined) continue;
    const v = textOf(a[f], FIELD_MAX);
    if (v.length > FIELD_MAX) refuse(`${FIELD_WORDS[f]}: עד ${FIELD_MAX} תווים.`, 'bad_input');
    if (personalIn(v)) refuse(PERSONAL_WORDS, 'personal_details');
    if (f === 'name' && !v) refuse('חסר שם לקוח.', 'bad_input');
    patch[f] = v || null;
  }
  if (a.characterizer !== undefined) {
    const k = personKey(a.characterizer, CHARACTERIZERS.map((x) => PEOPLE[x]));
    if (!k) refuse(`מי מבצע את האפיון: ${CHARACTERIZERS.map(personName).join(', ')}.`, 'bad_input');
    patch.characterizer = k;
  }
  if (a.editor !== undefined) {
    const k = a.editor === null || a.editor === '' ? null : personKey(a.editor, EDITORS.map((x) => PEOPLE[x]));
    if (a.editor && !k) refuse(`העורך: ${EDITORS.map(personName).join(', ')}, או ריק.`, 'bad_input');
    patch.editor = k;
  }
  let reason = null;
  if (a.status !== undefined) {
    if (!CLIENT_STATUS[a.status]) refuse(`סטטוס: ${Object.entries(CLIENT_STATUS).map(([k, v]) => `${k} (${v})`).join(', ')}.`, 'bad_input');
    patch.status = a.status;
    if (a.status === 'ended' && client.status !== 'ended') {
      // As the form: ending a client closes its work only after process 35 is done.
      const checks = await checksOf(ctx, client.id);
      const p35 = PROCESSES.find((p) => p.id === 'p35').items.map((i) => i.key);
      if (!p35.every((k) => checks[k])) refuse('לפני ״הסתיים״ צריך לסגור את תהליך 35 (עצירת קמפיינים, הסרת גישות וסגירת חיבורים). אפשר לבחור ״מסיים התקשרות״ (ending) כדי שהתהליך יופיע.', 'p35_open');
    }
    if (a.status === 'cancelled' && client.status !== 'cancelled') {
      reason = textOf(a.cancel_reason, 500);
      if (!reason) refuse('לביטול ההסכם צריך סיבה קצרה (cancel_reason), כמו בכרטיס.', 'reason_required');
      if (personalIn(reason)) refuse(PERSONAL_WORDS, 'personal_details');
    }
  }
  if (a.cancel_reason !== undefined && a.status !== 'cancelled') refuse('cancel_reason רק עם status: cancelled.', 'bad_input');
  for (const k of Object.keys(patch)) if ((patch[k] ?? null) === (client[k] ?? null)) delete patch[k];
  if (!Object.keys(patch).length) refuse('אין מה לשנות: הכול כבר כך.', 'nothing_to_change');
  const lines = Object.entries(patch).map(([f, v]) => `${FIELD_WORDS[f]}: מ״${valueWords(f, client[f])}״ ל״${valueWords(f, v)}״`);
  const preview = `בכרטיס של ${label(client)} ישתנו: ${lines.join('; ')}.${reason ? ` סיבת הביטול תישמר בכרטיס.` : ''} השינוי נרשם כמו שמירה בטופס הפרטים.`;
  if (a.dry_run !== false) return { preview };
  const saved = await wrote(ctx.db.from('clients').update({ ...patch, ...(reason ? { closed_reason: reason } : {}) }).eq('id', client.id).select('id'));
  if (!Array.isArray(saved) || saved.length !== 1) refuse('השינוי לא נשמר (אין הרשאה לשנות את הלקוח הזה).', 'not_saved');
  return { done: `נשמר בכרטיס של ${label(client)}: ${lines.join('; ')}.` };
}

// ── 3. A characterization meeting or a shoot day (app/date-set.js) ──
const SCHEDULED = 'p03.scheduled';
const answered = (check) => !!check && (check.state === 'done' || check.state === 'na');
const notThere = (err) => ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(err?.code);
// The photographer's month (app/availability-ui.js loadAvailability, for one month and one photographer).
async function availabilityOf(ctx, day, who) {
  const month = A.monthOfDay(day);
  const range = { p_from: `${month}-01`, p_to: A.monthDays(month).at(-1) };
  try {
    const [m, c, t] = await Promise.all([
      ctx.db.from('photographer_months').select('person, month, days, none, submitted_at, updated_at, by_person').gte('month', `${month}-01`).lte('month', `${month}-01`).order('month'),
      ctx.db.from('photographer_changes').select('id, person, reported_at, reported_month, days, shoot_days, note').gte('reported_month', `${A.addMonths(month, -3)}-01`).order('reported_at', { ascending: false }),
      who === 'eli' ? ctx.db.rpc('photographer_taken', range) : ctx.db.rpc('photographer_taken_by', { p_person: who, ...range }),
    ]);
    if (m.error || c.error || t.error) return null;
    const taken = Object.fromEntries((t.data || []).map((r) => [String(r.day).slice(0, 10), r.n]));
    return { months: m.data || [], changes: c.data || [], taken };
  } catch { return null; }
}
async function setDateTool(ctx, a) {
  if (!['characterization', 'shoot'].includes(a.which)) refuse('which הוא characterization (פגישת אפיון) או shoot (יום צילום).', 'bad_input');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(a.at || ''))) refuse('המועד בפורמט YYYY-MM-DDTHH:MM, בשעון ישראל.', 'bad_input');
  const at = fromInputIL(a.at);
  if (!at || Number.isNaN(+at) || dayKeyIL(at) !== a.at.slice(0, 10)) refuse('המועד לא תקין.', 'bad_input');
  const now = ctx.now();
  const client = await clientOf(ctx, a.client);
  const reason = a.reason === undefined ? '' : textOf(a.reason, 200);
  if (personalIn(reason)) refuse(PERSONAL_WORDS, 'personal_details');

  if (a.which === 'characterization') {
    if (a.round !== undefined || a.crew !== undefined) refuse('round ו־crew רק ליום צילום.', 'bad_input');
    const person = a.characterizer === undefined ? client.characterizer || null : personKey(a.characterizer, CHARACTERIZERS.map((x) => PEOPLE[x]));
    if (!CHARACTERIZERS.includes(person)) refuse(`מי מבצע את האפיון? ${CHARACTERIZERS.map(personName).join(', ')}.`, 'bad_input');
    const first = !client.char_at;
    if (!first && +new Date(client.char_at) === +at && client.characterizer === person) refuse('הפגישה כבר במועד הזה ועם אותו אדם. לא שיניתי כלום.', 'nothing_to_change');
    const checks = await checksOf(ctx, client.id);
    const marks = first && !answered(checks[SCHEDULED]);
    const preview = `פגישת האפיון של ${label(client)} ${first ? 'תיקבע' : `תזוז מ־${whenText(new Date(client.char_at))}`} ל־${whenText(at)}, עם ${personName(person)}.${marks ? ' כמו בכרטיס, ״נקבעה פגישה״ (תהליך 3) יסומן ״בוצע״.' : ''}`;
    if (a.dry_run !== false) return { preview };
    const saved = await wrote(ctx.db.from('clients').update({ char_at: at.toISOString(), characterizer: person }).eq('id', client.id).select('id'));
    if (!Array.isArray(saved) || saved.length !== 1) refuse('המועד לא נשמר (אין הרשאה לשנות את הלקוח הזה).', 'not_saved');
    let marked = false;
    if (marks) {
      try { await wrote(ctx.db.from('protocol_checks').insert({ client_id: client.id, item_key: SCHEDULED, state: 'done', note: null }, { onConflict: 'client_id,item_key' }).select(CHECK_COLS).single()); marked = true; } catch { /* stays open on the card */ }
    }
    return { done: `פגישת האפיון של ${label(client)}: ${whenText(at)}, עם ${personName(person)}.${marked ? ' ״נקבעה פגישה״ סומן.' : ''}` };
  }

  // A shoot day: the client's own (round 1) or a round's that exists.
  if (a.characterizer !== undefined) refuse('characterizer רק לפגישת אפיון.', 'bad_input');
  const n = a.round === undefined || a.round === null ? 1 : a.round;
  if (!Number.isInteger(n) || n < 1 || n > 50) refuse('round הוא מספר הסבב (1 או יותר).', 'bad_input');
  const rounds = roundsOf(client);
  const round = n > 1 ? rounds.find((r) => r.n === n) : null;
  if (n > 1 && !round) refuse(`ללקוח הזה אין סבב צילום ${n}. סבב חדש מוסיפים בכרטיס הלקוח.`, 'not_found');
  const was = n > 1 ? round.shoot_at || null : client.shoot_at || null;
  const crew = a.crew === undefined ? choiceOf(n > 1 ? round : client) : a.crew;
  if (!isChoice(crew)) refuse(`מי מצלם (crew): ${[...Object.keys(SHOOT_TYPES), ...Object.keys(PHOTOGRAPHERS).map((p) => `solo:${p}`)].join(', ')}.`, 'bad_input');
  if (was && +new Date(was) === +at && crew === choiceOf(n > 1 ? round : client)) refuse('יום הצילום כבר במועד הזה. לא שיניתי כלום.', 'nothing_to_change');
  // The questions of the card (availability-ui.js confirmShootDay), asked here in words.
  const moved = +at !== +new Date(was || 0);
  const who = soloOf(crew) || 'eli';
  let dateConcerns = [];
  let extra = [];
  if (moved) {
    dateConcerns = shootDateConcerns({ shootAt: at, charAt: n > 1 ? null : client.char_at, now });
    const data = await availabilityOf(ctx, dayKeyIL(at), who);
    if (data) extra = A.availabilityConcerns({ day: dayKeyIL(at), ...data, people: [who], own: was ? dayKeyIL(new Date(was)) : null, now });
  }
  const concerns = [...dateConcerns, ...extra];
  const crewText = soloOf(crew) ? `בלי משפיענים, ליאור + ${PHOTOGRAPHERS[soloOf(crew)].name}` : SHOOT_TYPES[crew]?.name || crew;
  const what = `יום הצילום${n > 1 ? ` של סבב ${n}` : ''} של ${label(client)}`;
  const preview = `${what} ${was ? `יזוז מ־${whenText(new Date(was))}` : 'ייקבע'} ל־${whenText(at)} (${crewText}).${concerns.length ? ` שימו לב: ${concerns.join(' ')} ${extra.length ? 'כמו בכרטיס, צריך סיבה קצרה (reason), והיא נשמרת עם שינוי המועד.' : 'הסיבות נשמרות עם שינוי המועד.'}` : ''}`;
  if (extra.length && !reason && a.dry_run === false) refuse(`${concerns.join(' ')} כדי לקבוע בכל זאת צריך סיבה קצרה (reason).`, 'reason_required');
  if (a.dry_run !== false) return { preview };
  const iso = at.toISOString();
  const patch = n > 1
    ? { rounds: rounds.map((r) => (r.n === n ? { ...roundWithCrew(r, crew), shoot_at: iso } : r)) }
    : { shoot_at: iso, ...crewPatch(client, crew) };
  const saved = await wrote(ctx.db.from('clients').update(patch).eq('id', client.id).select('id'));
  if (!Array.isArray(saved) || saved.length !== 1) refuse('המועד לא נשמר (אין הרשאה לשנות את הלקוח הזה).', 'not_saved');
  const note = extra.length ? A.exceptionNote(concerns, reason) : dateConcerns.length ? shootDateNote(dateConcerns) : null;
  let noted = true;
  if (note) {
    const r = await Promise.resolve(ctx.db.rpc('date_change_note', { p_client: client.id, p_field: n > 1 ? 'round_shoot_at' : 'shoot_at', p_round: n > 1 ? n : null, p_new: iso, p_note: note })).catch(() => ({ error: true }));
    noted = !r?.error;
  }
  return { done: `${what}: ${whenText(at)} (${crewText}).${note && !noted ? ' המועד נשמר, אבל הסיבה לא נשמרה בהיסטוריה.' : ''}` };
}

// ── 4. A task: given on the spot ("נודניק"), or closed ──
async function giveTaskTool(ctx, a) {
  const assignee = personKey(a.person, ASSIGNEES());
  if (!assignee) refuse(`למי? ${ASSIGNEES().map((p) => p.name).join(', ')}.`, 'bad_input');
  const body = textOf(a.text, 600);
  const brief = a.brief && typeof a.brief === 'object' && !Array.isArray(a.brief) ? a.brief : {};
  if (personalIn(body, ...Object.values(brief))) refuse(PERSONAL_WORDS, 'personal_details');
  let client = null;
  if (a.client !== undefined && a.client !== null && a.client !== '') client = await clientOf(ctx, a.client);
  const v = validateTask({ assignee, body, clientId: client?.id || '', brief });
  if (!v.ok) refuse(Object.values(v.errors).join(' '), 'bad_input', { fields: Object.keys(v.errors) });
  const preview = `${personName(assignee)} יקבל/תקבל משימה מיידית ("נודניק")${client ? ` על ${label(client)}` : ''}: "${v.args.p_body}". מרגע זה תגיע תזכורת לטלפון כל 30 דקות, בשעות העבודה, עד שיסמנו ״בוצע״ (או שתבטל/י).`;
  if (a.dry_run !== false) return { preview };
  await wrote(ctx.db.rpc(v.rpc, v.args));
  return { done: `המשימה נשלחה ל${personName(assignee)}${client ? ` (${label(client)})` : ''}.` };
}

async function closeTaskTool(ctx, a) {
  const words = a.task_id ? null : plain(a.text);
  if (!a.task_id && !words) refuse('צריך task_id או כמה מילים מהמשימה (text).', 'bad_input');
  if (a.task_id && !isUuid(a.task_id)) refuse('task_id לא תקין.', 'bad_input');
  const who = a.person ? personKey(a.person, [...TEAM_PEOPLE(), { key: 'owner', name: 'הבעלים' }]) : null;
  if (a.person && !who) refuse(`לא מכיר את "${String(a.person).slice(0, 40)}" בצוות.`, 'bad_input');
  const client = a.client ? await clientOf(ctx, a.client) : null;
  let st = ctx.db.from('staff_tasks').select('id, assignee, body, client_id, client_name, created_by, status').eq('status', 'open');
  let ct = ctx.db.from('client_tasks').select('id, client_id, title, owner, done_at').is('done_at', null);
  if (a.task_id) { st = st.eq('id', a.task_id); ct = ct.eq('id', a.task_id); }
  if (client) { st = st.eq('client_id', client.id); ct = ct.eq('client_id', client.id); }
  const [staff, cards, list] = await Promise.all([rows(st.limit(1000)), rows(ct.limit(2000)), client ? [client] : rows(ctx.db.from('clients').select('id, name, business').limit(1000))]);
  const names = Object.fromEntries(list.map((c) => [c.id, label(c)]));
  const found = [
    ...staff.filter((t) => (!who || t.assignee === who) && (!words || plain(t.body).includes(words)))
      .map((t) => ({ kind: 'staff', id: t.id, text: t.body, person: t.assignee, client: t.client_name || null })),
    ...cards.filter((t) => (!who || t.owner === who) && (!words || plain(t.title).includes(words)))
      .map((t) => ({ kind: 'client', id: t.id, text: t.title, person: t.owner, client: names[t.client_id] || null, client_id: t.client_id })),
  ];
  if (!found.length) refuse('לא מצאתי משימה פתוחה כזו.', 'not_found');
  if (found.length > 1) {
    refuse('נמצאו כמה משימות פתוחות. איזו מהן? (לשלוח את task_id)', 'ambiguous', {
      candidates: found.slice(0, 12).map((t) => ({ task_id: t.id, task: String(t.text).slice(0, 120), person: personName(t.person), client: t.client })),
    });
  }
  const t = found[0];
  const head = `"${String(t.text).slice(0, 160)}" (${personName(t.person)}${t.client ? `, ${t.client}` : ''})`;
  if (t.kind === 'staff') {
    // The database: only the assignee marks a task done; the owners cancel one (it stops the reminders).
    const mine = t.person === 'owner';
    const preview = mine ? `המשימה שלך ${head} תסומן ״בוצע״, והתזכורות ייעצרו.` : `המשימה המיידית ${head} תבוטל, והתזכורות ל${personName(t.person)} ייעצרו. (״בוצע״ מסמן רק מי שקיבל אותה; הבעלים מבטלים.)`;
    if (a.dry_run !== false) return { preview };
    await wrote(ctx.db.rpc(mine ? 'staff_task_done' : 'staff_task_cancel', { p_id: t.id }));
    return { done: mine ? `סומן ״בוצע״: ${head}.` : `בוטלה: ${head}. התזכורות נעצרו.` };
  }
  const folder = folderItemOf({ title: t.text });
  const preview = `המשימה ${head} תסומן ״בוצע״ בכרטיס הלקוח.${folder ? ' כמו בכרטיס, גם ״יש תיקייה מסודרת״ (24) יסומן איתה.' : ''}`;
  if (a.dry_run !== false) return { preview };
  const saved = await wrote(ctx.db.from('client_tasks').update({ done_at: ctx.now().toISOString() }).eq('id', t.id).select('id'));
  if (!Array.isArray(saved) || saved.length !== 1) refuse('המשימה לא נסגרה (אין הרשאה).', 'not_saved');
  if (folder) {
    try {
      const cur = await rows(ctx.db.from('protocol_checks').select('state').eq('client_id', t.client_id).eq('item_key', folder).limit(1));
      if (cur[0]?.state !== 'done') await wrote(ctx.db.from('protocol_checks').insert({ client_id: t.client_id, item_key: folder, state: 'done', note: null }, { onConflict: 'client_id,item_key' }).select(CHECK_COLS).single());
    } catch { /* the item stays for the card */ }
  }
  return { done: `סומן ״בוצע״: ${head}.` };
}

// ── 5. "הערה מיוחדת" to an employee (feat/staff-notes: public.staff_notes) ──
export const NOTE_MAX = 1000;
export const NOTES_OFF = 'ההערות המיוחדות עוד לא הופעלו במערכת. כשהן יעלו, הכלי יעבוד.';
const notePeople = () => TEAM_PEOPLE().map((p) => ({ key: p.key, name: p.name }));
async function staffNoteTool(ctx, a) {
  const action = a.action || 'add';
  if (!['add', 'list', 'remove'].includes(action)) refuse('action הוא add, list או remove.', 'bad_input');
  const missing = (err) => notThere(err) && refuse(NOTES_OFF, 'not_available');
  if (action === 'list') {
    const who = a.person ? personKey(a.person, notePeople()) : null;
    if (a.person && !who) refuse(`לא מכיר את "${String(a.person).slice(0, 40)}" בצוות.`, 'bad_input');
    let q = ctx.db.from('staff_notes').select('id, person, body, created_by, created_at').is('deleted_at', null);
    if (who) q = q.eq('person', who);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
    if (error) { missing(error); throw Object.assign(new Error('db'), { code: error.code }); }
    return { notes: (data || []).map((n) => ({ note_id: n.id, to: personName(n.person), note: n.body, by: personName(n.created_by), on: dayKeyIL(new Date(n.created_at)) })) };
  }
  if (action === 'remove') {
    if (!isUuid(a.note_id)) refuse('צריך note_id (מ־action: list).', 'bad_input');
    const { data, error } = await ctx.db.from('staff_notes').select('id, person, body').eq('id', a.note_id).is('deleted_at', null).limit(1);
    if (error) { missing(error); throw Object.assign(new Error('db'), { code: error.code }); }
    const n = (data || [])[0];
    if (!n) refuse('לא מצאתי הערה פעילה כזו.', 'not_found');
    const preview = `ההערה ל${personName(n.person)} "${String(n.body).slice(0, 160)}" תרד מהמסכים שלו/שלה. היא לא נמחקת מההיסטוריה.`;
    if (a.dry_run !== false) return { preview };
    await wrote(ctx.db.rpc('staff_note_delete', { p_id: n.id }));
    return { done: `ההערה ל${personName(n.person)} הורדה.` };
  }
  const person = personKey(a.person, notePeople());
  const body = textOf(a.text, NOTE_MAX);
  if (!person) refuse(`למי ההערה? ${notePeople().map((p) => p.name).join(', ')}.`, 'bad_input');
  if (!body) refuse('כותבים את ההערה (text).', 'bad_input');
  if (body.length > NOTE_MAX) refuse(`עד ${NOTE_MAX} תווים.`, 'bad_input');
  if (personalIn(body)) refuse(PERSONAL_WORDS, 'personal_details');
  const preview = `הערה מיוחדת ל${personName(person)}: "${body}". היא תופיע בראש כל עמוד שלו/שלה עד שתורידו אותה${isSilent(person) ? '' : ', ותישלח פעם אחת כהתראה'}.`;
  if (a.dry_run !== false) return { preview };
  const { error } = await ctx.db.from('staff_notes').insert({ person, body }).select('id');
  if (error) { missing(error); throw Object.assign(new Error('db'), { code: error.code }); }
  return { done: `ההערה נשמרה ל${personName(person)}.` };
}

// ── 6. A contract: prepared, created as the builder creates it, ready to send ──
const DEAL_COLS = 'id, created_at, seller, business_name, contact_name, phone, company_id, business_address, notes, status, quote_id, taken_by';
async function contractClient(ctx, a) {
  const hasDeal = typeof a.deal === 'string' && a.deal.trim();
  const hasClient = typeof a.client === 'string' && a.client.trim();
  if (hasDeal === hasClient) refuse('למי החוזה: deal (עסקה מהשטח, לפי שם העסק) או client (לקוח קיים). אחד מהם.', 'bad_input');
  if (hasDeal) {
    const list = await rows(ctx.db.from('deal_requests').select(DEAL_COLS).order('created_at', { ascending: false }).limit(300));
    const w = plain(a.deal);
    let pool = list.filter((d) => plain(d.business_name) === w || plain(d.contact_name) === w);
    if (!pool.length) pool = list.filter((d) => plain(d.business_name).includes(w) || plain(d.contact_name).includes(w));
    const waiting = pool.filter((d) => d.status === 'pending');
    if (waiting.length === 1) pool = waiting;
    if (!pool.length) refuse(`לא נמצאה עסקה בשם "${String(a.deal).slice(0, 60)}".`, 'not_found');
    if (pool.length > 1) refuse('נמצאו כמה עסקאות כאלה. איזו מהן?', 'ambiguous', { candidates: pool.slice(0, 10).map((d) => `${d.business_name || d.contact_name} · ${personName(d.seller)} · ${dayKeyIL(new Date(d.created_at))}`) });
    const d = pool[0];
    return {
      who: d.business_name || d.contact_name, deal: d,
      details: { name: d.contact_name || '', company: d.business_name || '', companyId: d.company_id || '', address: d.business_address || '', phone: d.phone || '', email: '', notes: d.notes || '' },
    };
  }
  const c = await clientOf(ctx, a.client);
  const [priv, contact] = await Promise.all([
    Promise.resolve(ctx.db.rpc('clients_private', { p_ids: [c.id] })).then((r) => (r.error ? null : (r.data || [])[0] || null)),
    Promise.resolve(ctx.db.rpc('clients_contact', { p_ids: [c.id] })).then((r) => (r.error ? null : (r.data || [])[0] || null)).catch(() => null),
  ]);
  return {
    who: label(c), client: c,
    details: { name: c.name || '', company: c.business || '', companyId: contact?.company_id || '', address: c.address || '', phone: priv?.phone || '', email: contact?.contact_email || '', notes: '' },
  };
}
const ils = (agorot) => Math.round(agorot / 100);
export const SIGN_PAGE = 'q.html';
export const SENT_PAGE = 'quotes.html';
// The builder's own message (app/builder.js createLink), word for word.
export function sendText({ name, number, link, agreement, months, hours }) {
  return agreement
    ? `שלום${name ? ` ${name}` : ''}, מצורף הסכם ההתקשרות מאסטרטג (${number}) ${months === 1 ? 'לחודש אחד' : `ל־${months} חודשים`}. אפשר לעיין ולחתום כאן בתוך ${hours} שעות:\n${link}`
    : `שלום${name ? ` ${name}` : ''}, מצורפת הצעת המחיר מאסטרטג (${number}), בתוקף ל־${hours} שעות. לצפייה:\n${link}`;
}
async function sendContractTool(ctx, a) {
  const d = draftOf(a.contract);
  if (d.error) refuse(DRAFT_ERRORS[d.error] || DRAFT_ERRORS.bad_input, String(d.error).slice(0, 32), { fields: d.fields });
  const to = await contractClient(ctx, a);
  const doc = DOC_TYPES[d.toSend.docType] || DOC_TYPES.agreement;
  const agreement = doc.signable === true;
  const missing = [];
  if (agreement && !to.details.name.trim()) missing.push('שם');
  if (agreement && !to.details.companyId.trim()) missing.push('ח.פ / ת.ז');
  if (missing.length) refuse(`חסר במערכת ${missing.join(' ו')} של ${to.who}, וחוזה לא יוצא בלעדיהם. ממלאים ב${to.deal ? 'עסקה' : 'כרטיס הלקוח'} (או יוצרים במחולל), ואז שוב.`, 'details_missing');
  const t = d.model.totals;
  const summary = {
    document: d.model.docTitle, for: to.who, package: `${d.model.package.tierName} · ${d.model.package.influencer}`, months: d.model.termMonths,
    monthly_with_vat_ils: ils(t.monthlyGross), whole_term_with_vat_ils: ils(t.termGross), differs_from_package: d.exceptions, to_check: d.check,
  };
  const warn = [];
  if (to.deal?.quote_id) warn.push('לעסקה הזו כבר נוצר חוזה; ייווצר עוד אחד.');
  if (to.deal?.taken_by && to.deal.taken_by !== 'owner') warn.push(`העסקה אצל ${personName(to.deal.taken_by)}: אם היא עדיין אצלו/אצלה, החוזה לא ייווצר.`);
  if (!to.details.phone) warn.push('אין במערכת טלפון של הלקוח: את ההודעה שולחים בוואטסאפ לאיש הקשר ידנית.');
  const preview = `ייווצר ${d.model.docTitle} ל${to.who}: ${summary.package}, ${summary.months} חודשים, ${summary.monthly_with_vat_ils.toLocaleString('he-IL')} ₪ לחודש כולל מע״מ (${summary.whole_term_with_vat_ils.toLocaleString('he-IL')} ₪ לכל התקופה).${d.exceptions.length ? ` שונה מהחבילה: ${d.exceptions.join(' ')}` : ''} הפרטים של הלקוח נלקחים מה${to.deal ? 'עסקה' : 'כרטיס'} שבמערכת. הוא יופיע ב״הצעות שנשלחו״ עם קישור לחתימה, ותקבלו הודעה מוכנה לשליחה ללקוח בוואטסאפ.${warn.length ? ` ${warn.join(' ')}` : ''}`;
  if (a.dry_run !== false) return { preview, summary };
  if (to.deal) {
    // The builder takes the deal when it opens it: someone else's stays theirs.
    const taken = await Promise.resolve(ctx.db.rpc('deal_take', { p_id: to.deal.id })).catch(() => ({ error: { code: 'error' } }));
    if (!taken.error && taken.data && taken.data.ok === false) refuse(`העסקה כבר אצל ${personName(taken.data.taken_by)}.`, 'deal_taken');
  }
  const made = await ctx.createQuote({ selection: d.toSend, client: to.details });
  if (!made.ok) refuse(made.status === 403 ? 'יצירת החוזה נדחתה (הרשאה).' : 'החוזה לא נוצר. אפשר ליצור אותו במחולל.', made.status === 403 ? 'not_allowed' : 'quote_failed');
  const q = made.data;
  if (!q?.token) refuse('החוזה נשמר, אבל עוד אין לו קישור. רואים אותו ב״הצעות שנשלחו״.', 'no_link');
  let linked = null;
  if (to.deal) {
    try { await wrote(ctx.db.from('deal_requests').update({ quote_id: q.id }).eq('id', to.deal.id).select('id')); linked = true; } catch { linked = false; }
  }
  const link = `${DRAFT_SITE}${SIGN_PAGE}#t=${encodeURIComponent(q.token)}`;
  const message = sendText({ name: to.details.name.trim(), number: q.number, link, agreement, months: d.model.termMonths, hours: doc.validHours });
  return {
    done: `${d.model.docTitle} ${q.number} נוצר ל${to.who}.${linked === true ? ' הוא קושר לעסקה, והסטטוס שלה ״חוזה נשלח״.' : linked === false ? ' הוא לא קושר לעסקה: לסמן ״החוזה נשלח״ במשימות.' : ''}`,
    number: q.number,
    sign_link: link,
    message,
    // WhatsApp opens with the message ready; the person picks the chat (no number goes through here).
    whatsapp: whatsappLink('', message),
    send: `שליחה: לפתוח את הקישור whatsapp ולבחור את הלקוח, או ב״הצעות שנשלחו״ (${DRAFT_SITE}${SENT_PAGE}) ללחוץ ״תזכורת בוואטסאפ״ בשורה של ${q.number}: הוואטסאפ נפתח למספר ששמור במערכת.`,
    summary,
  };
}

// ── 7. A request for a change or a fix to the system (the developer reads the list) ──
export const REQUEST_MAX = 2000;
async function systemRequestTool(ctx, a) {
  const body = textOf(a.text, REQUEST_MAX);
  if (!body) refuse('כותבים מה לשנות או לתקן (text).', 'bad_input');
  if (body.length > REQUEST_MAX) refuse(`עד ${REQUEST_MAX} תווים.`, 'bad_input');
  if (personalIn(body)) refuse(PERSONAL_WORDS, 'personal_details');
  const preview = `תירשם בקשה לשינוי במערכת: "${body}". היא נכנסת לרשימה שהמפתח (Claude Code) קורא. שום דבר במערכת לא משתנה עכשיו.`;
  if (a.dry_run !== false) return { preview };
  const { error } = await ctx.db.from('system_requests').insert({ body }).select('id');
  if (error) {
    if (notThere(error)) refuse('רשימת הבקשות עוד לא הופעלה במערכת (המיגרציה 20261207100000_mcp_write.sql).', 'not_available');
    throw Object.assign(new Error('db'), { code: error.code });
  }
  return { done: 'הבקשה נרשמה. היא תטופל ב־Claude Code.' };
}

// ── The tools as MCP lists them ────────────────
const DRY = { type: 'boolean', description: 'true (the default): only a Hebrew preview of the change, nothing is written. false: do it. ALWAYS call first with true, show the owner the preview word for word, and call again with false only after the owner said yes to that preview.' };
const str = (description) => ({ type: 'string', description });
const SAFETY = 'Owner only. First call with dry_run: true and show the owner the preview; only after the owner confirms, call again with dry_run: false and the same arguments.';
const WHEN = 'Israel time, "YYYY-MM-DDTHH:MM".';
export const WRITE_TOOLS = [
  {
    name: 'mark_protocol_item',
    title: 'סימון פריט בפרוטוקול של לקוח',
    description: `WRITES: marks one protocol item of one client as done ("בוצע"), not relevant ("לא רלוונטי", needs a short reason in note unless the item is optional), or clear (open again; the mark is removed, the history is kept). Exactly as the client card: items that wait for others, items closed through a form, calls and daily follow-ups, and the guards (an empty Gantt, no script, no logo file) are refused with the reason. Find the item by its key (e.g. "p03.scheduled", "r2.p11.calendar") or its words; when several match the answer lists their keys. ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: { client: str('The client\'s name (or part of it).'), item: str('The item\'s key, or its words.'), state: { type: 'string', enum: ['done', 'na', 'clear'] }, note: str('The reason for "na", or a short note.'), dry_run: DRY },
      required: ['client', 'item', 'state', 'dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: markItem,
  },
  {
    name: 'update_client',
    title: 'עדכון פרטי לקוח',
    description: `WRITES: changes fields of a client's card, only these: name, business, package_name, characterizer (${CHARACTERIZERS.join(', ')}), editor (the main editor: ${EDITORS.join(', ')}, or "" for none; a second editor is set in the card's "שיוך"), status (${Object.keys(CLIENT_STATUS).join(', ')}; "ended" only after process 35 is closed; "cancelled" needs cancel_reason). Never phone, email, address, notes or money. ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: {
        client: str('The client\'s name.'), name: str('New name.'), business: str('New business name.'), package_name: str('New package name.'),
        characterizer: str('Who runs the characterization (Hebrew name or key).'), editor: str('Main editor (Hebrew name or key), or "" for none.'),
        status: { type: 'string', enum: Object.keys(CLIENT_STATUS) }, cancel_reason: str('Why the agreement was cancelled (status cancelled).'), dry_run: DRY,
      },
      required: ['client', 'dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: updateClientTool,
  },
  {
    name: 'set_client_date',
    title: 'קביעה או הזזה של פגישת אפיון או יום צילום',
    description: `WRITES: sets or moves a client's characterization meeting (which: characterization; with who runs it, characterizer, default the card's) or shoot day (which: shoot; round for a later round that exists; crew: who films, default as now). As the card's dialogs: a first meeting also marks "נקבעה פגישה"; a shoot day in the past, before the meeting, too soon after it, or on a day the photographer is not free is said in the preview, and a day the photographer is not free needs a short reason, which is kept with the date change. ${WHEN} ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: {
        client: str('The client\'s name.'), which: { type: 'string', enum: ['characterization', 'shoot'] }, at: str(`The new date and hour, ${WHEN}`),
        characterizer: str('characterization: who runs it (Hebrew name or key).'), round: { type: 'integer', description: 'shoot: the round (1 = the client\'s first shoot day).' },
        crew: { type: 'string', enum: [...Object.keys(SHOOT_TYPES), ...Object.keys(PHOTOGRAPHERS).map((p) => `solo:${p}`)], description: 'shoot: with influencers (the shoot type) or solo:<photographer>.' },
        reason: str('shoot: why, when the day goes against the photographer\'s availability.'), dry_run: DRY,
      },
      required: ['client', 'which', 'at', 'dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: setDateTool,
  },
  {
    name: 'give_task',
    title: 'משימה מיידית לעובד (נודניק)',
    description: `WRITES: gives an employee a task on the spot ("נודניק"): they are reminded on the phone every 30 minutes in working hours until they mark it done. For Nirel a brief is required (problem, change, keep, result). ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: {
        person: str('To whom (Hebrew name or key; "הבעלים" for the owner).'), text: str('What to do (up to 500 characters).'), client: str('Optional: the client it is about.'),
        brief: { type: 'object', properties: { problem: { type: 'string' }, change: { type: 'string' }, keep: { type: 'string' }, result: { type: 'string' } }, additionalProperties: false, description: 'For Nirel only, all four.' },
        dry_run: DRY,
      },
      required: ['person', 'text', 'dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: giveTaskTool,
  },
  {
    name: 'close_task',
    title: 'סגירת משימה',
    description: `WRITES: closes one open task. A task of a client card is marked done (with the folder item when it is Ofir's folder task). A task given on the spot ("נודניק") is marked done when it is the owner's own, and otherwise cancelled (only its assignee marks it done), which stops its reminders. Nothing is deleted. Find it by task_id or by words (with person or client to narrow); several matches come back with their task_id. ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: { task_id: str('The task\'s id, from an earlier answer.'), text: str('Words of the task.'), person: str('Whose task.'), client: str('The client.'), dry_run: DRY },
      required: ['dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: closeTaskTool,
  },
  {
    name: 'staff_note',
    title: 'הערה מיוחדת לעובד',
    description: `WRITES (add, remove): a special note to one employee ("הערה מיוחדת"), shown at the top of every page of theirs until it is removed, with one push when written. action add (person, text), list (optional person; read only, no dry run needed), remove (note_id from list: it comes off their screens, the history is kept). ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['add', 'list', 'remove'] }, person: str('To whom (Hebrew name or key).'), text: str('The note (up to 1000 characters).'), note_id: str('remove: the note\'s id.'), dry_run: DRY },
      required: ['action', 'dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: staffNoteTool,
  },
  {
    name: 'send_contract',
    title: 'הכנת חוזה ויצירתו לשליחה ללקוח',
    description: `WRITES: prepares a contract from the deal's package choices (contract: the same fields as prepare_contract_draft) and creates it in the system as the builder does, for a field deal (deal: the business name) or an existing client (client). The client's name, company id, address and phone are taken from the system, never typed here and never shown. The answer has the number, the signing link and the ready message with a WhatsApp link (the person picks the chat), and it appears in "הצעות שנשלחו". It does not message the client by itself. ${SAFETY}`,
    input_schema: {
      type: 'object',
      properties: { deal: str('A field deal: the business name.'), client: str('An existing client: the name.'), contract: { ...DRAFT_SCHEMA, description: 'The package choices, as prepare_contract_draft.' }, dry_run: DRY },
      required: ['contract', 'dry_run'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: sendContractTool,
  },
  {
    name: 'request_system_change',
    title: 'בקשת שינוי או תיקון במערכת',
    description: `WRITES: records a free-text request for a change or a fix to the system itself (a screen, a rule, a bug) in the list the developer reads. It changes nothing in the system now. ${SAFETY}`,
    input_schema: { type: 'object', properties: { text: str('What to change or fix, in the owner\'s words.'), dry_run: DRY }, required: ['text', 'dry_run'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: systemRequestTool,
  },
];
export const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
export const MCP_WRITE_TOOLS = WRITE_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.input_schema, annotations: t.annotations }));
// Who: an owner (public.my_person() null, in the office). Lior and Ofir read and draft only.
export const mayWrite = ({ office, person } = {}) => office === true && person === null;

const WORDS = {
  not_allowed: 'אין הרשאה לפעולה הזו.', '42501': 'אין הרשאה לפעולה הזו.', P0002: 'לא נמצא.', '22023': 'הערך לא תקין.', '23514': 'הערך לא תקין.', '23505': 'כבר קיים.',
};
// One call: { text, isError, code } (the code for mcp_usage: ok, preview, or a short code).
// ctx: { db: guardWrite(the owner's client), now(), createQuote(body) → { ok, status, data } }.
export async function runWrite(ctx, name, args) {
  const tool = WRITE_TOOLS.find((t) => t.name === name);
  if (!tool) return { text: JSON.stringify({ error: 'unknown tool' }), isError: true, code: 'unknown_tool' };
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const known = Object.keys(tool.input_schema.properties);
  const extra = Object.keys(a).filter((k) => !known.includes(k));
  if (extra.length) return { text: JSON.stringify({ error: 'יש שדה שהכלי לא מקבל.', fields: extra.map((k) => k.slice(0, 40)).slice(0, 10) }), isError: true, code: 'unknown_field' };
  if (a.dry_run !== undefined && typeof a.dry_run !== 'boolean') return { text: JSON.stringify({ error: 'dry_run הוא true או false.' }), isError: true, code: 'bad_input' };
  try {
    const out = await tool.run(ctx, a);
    if (out.preview) return { text: JSON.stringify({ dry_run: true, nothing_was_changed: true, preview: out.preview, ...(out.summary ? { summary: out.summary } : {}), next: 'Show the owner this preview. Only after a yes, call again with dry_run: false.' }), isError: false, code: 'preview' };
    return { text: JSON.stringify(out.done !== undefined ? { done: true, ...out, result: out.done } : out), isError: false, code: 'ok' };
  } catch (e) {
    if (e instanceof Refusal) return { text: JSON.stringify({ error: e.message, code: e.code, ...e.extra, nothing_was_changed: e.code !== 'no_link' }), isError: true, code: String(e.code).slice(0, 32) };
    const code = String(e?.code || 'error').slice(0, 20);
    return { text: JSON.stringify({ error: `הפעולה לא הושלמה. ${WORDS[code] || ''}`.trim(), code }), isError: true, code: code === 'not_allowed' ? 'not_allowed' : 'db_error' };
  }
}
