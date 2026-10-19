// The made-up office that the browser suites and the demo link (app/demo/demo.js) share:
// about 30 clients over the 8 stations, late items, a shoot day tomorrow, Stav's new
// deals, work waiting in every queue, and six clients from the old system in landing.
// Its clock is Tuesday 20.10.2026, 10:00 in Israel (NOW); the demo moves every date to
// today (shiftWorld). Names are invented. Plain data only: it runs in the browser too.
import { importKeys } from '../client-open.js';
import { PROCESSES } from '../protocol.js';
import { returnNote } from '../office-marks.js';

export const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
export const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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

const keysOf = (...ids) => ids.flatMap((id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key));

export function flowWorld({ landing = true, queues = true } = {}) {
  const db = buildWorld();
  const base = db.clients[11]; // "חן קוסמטיקה": a client in editing, every column filled
  const add = (n, station, fields, at = '2026-10-16T09:00:00+03:00') => {
    const c = { ...base, id: cid(n), editor: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, ...fields };
    db.clients.push(c);
    for (const k of importKeys(station)) db.protocol_checks.push({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: emailOf('irit'), at });
    return c;
  };
  const mark = (n, key, at, note = null, by = 'nadia') => db.protocol_checks.push({ client_id: cid(n), item_key: key, state: 'done', note, by_email: emailOf(by), at });
  // An editing that reached Ofir: assigned (22א), edited (22), in the Drive and "מוכן לבדיקה" (24).
  const edited = (n, editor, assignedAt, readyAt) => {
    for (const k of keysOf('p22a')) mark(n, k, assignedAt, null, 'ofir');
    for (const k of keysOf('p22', 'p24')) mark(n, k, readyAt, null, k === 'p24.folder' ? 'ofir' : editor);
  };
  for (const c of db.clients) Object.assign(c, { landing: false, landed_at: null, landed_by: null, landing_slot: null, ...c });
  db.client_landing_marks = [];
  db.client_landing_done = [];
  db.quotes = [];
  db.change_requests = [];
  db.client_access = [];
  db.client_messages = [];
  db.message_templates = [];
  db.office_reviews = [];
  db.photographer_months = [];
  db.photographer_changes = [];

  if (queues) {
    // Ofir: a shoot of last Thursday waits for an editor (22א), with its clock.
    add(23, 'post', { name: 'נטע שלום', business: 'שלום דפוס', char_at: '2026-09-30T10:00:00+03:00', shoot_at: '2026-10-15T10:00:00+03:00', deal_at: '2026-09-27T09:00:00+03:00' });
    // Ofir: Nadia got her client last week, edited, and marked "מוכן לבדיקה" twenty minutes ago (25).
    edited(12, 'nadia', '2026-10-15T09:00:00+03:00', '2026-10-20T09:40:00+03:00');
    // Anna's videos came back from Ofir yesterday with two fixes (her page, editor.html).
    edited(16, 'anna', '2026-10-18T12:00:00+03:00', '2026-10-19T12:00:00+03:00');
    mark(16, 'p25.return.1', '2026-10-19T13:30:00+03:00', returnNote([{ ref: '2', text: 'הכתובית נחתכת בסוף' }, { ref: '5', text: 'מוזיקה חזקה מדי' }], '2026-10-20T17:00:00+03:00'), 'ofir');
    // Lior: Yariv paused an editing yesterday morning and it is still paused.
    mark(14, 'p22.pause', '2026-10-19T09:30:00+03:00', JSON.stringify({ reason: 'משימה דחופה אחרת' }), 'yariv');
    // Lior: a login that does not work.
    db.client_access.push({ id: 'a0000000-0000-4000-8000-000000000001', client_id: cid(17), network: 'instagram', label: null, username: 'wolf.pilates', status: 'broken', note: 'הסיסמה לא עובדת', updated_by: emailOf('ilai'), updated_at: '2026-10-19T14:00:00+03:00' });
    // Lior: Ofir asked for a change.
    db.change_requests.push({ id: 'b0000000-0000-4000-8000-000000000001', client_id: null, problem: 'אין מי שמאשר תסריטים כשליאור ביום צילום', why: 'שני לקוחות חיכו יומיים', proposal: 'אופיר מאשר במקומו באותו יום', created_by_email: emailOf('ofir'), created_at: '2026-10-19T16:00:00+03:00', decision: null, decided_by_email: null, decided_at: null });
    // Lior: an urgent task given to Ilai an hour ago, and no "התחלתי".
    db.client_tasks.push({ id: 'd0000000-0000-4000-8000-000000000021', client_id: cid(18), title: 'להחליף את הגרפיקה שעלתה עם טעות', owner: 'ilai', due_on: null, done_at: null,
      created_at: '2026-10-20T09:00:00+03:00', created_by_email: emailOf('irit'), source: null, urgent: true, started_at: null });
  }
  if (landing) {
    // From the old system, still in landing: three wait for an editor, one for Ofir's check,
    // and one shoots next week.
    const OLD = { landing: true, created_by_email: 'system', char_at: '2026-06-10T10:00:00+03:00', deal_at: '2026-06-01T09:00:00+03:00', contract_end: '2027-06-01' };
    add(31, 'post', { ...OLD, name: 'דנה קורן', business: 'קורן אדריכלות', shoot_at: '2026-06-25T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    add(32, 'post', { ...OLD, name: 'משה חדד', business: 'חדד מאפים', shoot_at: '2026-06-28T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    add(33, 'post', { ...OLD, name: 'יעל פרץ', business: 'פרץ יוגה', shoot_at: '2026-07-02T10:00:00+03:00', shoot_type: 'natali', package_name: 'Social all in one · נטלי דדון' }, '2026-10-06T09:00:00+03:00');
    add(34, 'post', { ...OLD, name: 'אבנר גולן', business: 'גולן מזגנים', editor: 'anna', shoot_at: '2026-07-05T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    edited(34, 'anna', '2026-10-07T09:00:00+03:00', '2026-10-12T15:00:00+03:00');
    add(35, 'content', { ...OLD, name: 'רותי אלון', business: 'אלון צמחים', shoot_at: '2026-10-26T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    // Yariv got this one in the old system and is in the middle of the editing.
    add(36, 'post', { ...OLD, name: 'עדי נוי', business: 'נוי מסגרות', editor: 'yariv', shoot_at: '2026-07-08T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    for (const k of [...keysOf('p22a'), 'p22.received']) mark(36, k, '2026-10-08T09:00:00+03:00', null, k.startsWith('p22a') ? 'ofir' : 'yariv');
  }
  return db;
}
