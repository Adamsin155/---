// Data access for the landing of the old clients (docs/ops.md, section 41;
// supabase/migrations/20261018100000_clients_landing.sql and
// 20261020100000_landing_intake.sql). Everything is written through functions of the
// database, which stamp who and when; the browser cannot change clients.landing.
// Before the migrations nothing here fails a page: no client is in landing then.
import { supabase } from './supa.js';

const FLAGS = 'id, landing, landed_at, landed_by';
const missing = (error) => ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error?.code);

// The landing columns of the clients one sees: { id: { landing, landed_at, landed_by,
// landing_slot } }. Read apart from the client rows, so a site published before the
// migrations keeps working ({}: nobody is in landing).
export async function landingFlags(ids = null) {
  const read = async (cols) => {
    let q = supabase.from('clients').select(cols);
    if (ids) q = q.in('id', ids); else q = q.or('landing.eq.true,landed_at.not.is.null');
    return q.limit(5000);
  };
  try {
    let { data, error } = await read(`${FLAGS}, landing_slot`);
    if (error && missing(error)) ({ data, error } = await read(FLAGS));
    if (error) return {};
    return Object.fromEntries((data || []).filter((r) => r && (r.landing === true || r.landed_at)).map((r) => [r.id, r]));
  } catch { return {}; }
}

// Client rows with their landing columns added (a client not in the answer: never in landing).
export async function withLanding(rows) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) return rows;
  const flags = await landingFlags(Array.isArray(rows) ? null : list.map((r) => r.id));
  const add = (r) => r && ({ ...r, landing: flags[r.id]?.landing === true, landed_at: flags[r.id]?.landed_at ?? null, landed_by: flags[r.id]?.landed_by ?? null, landing_slot: flags[r.id]?.landing_slot ?? null });
  return Array.isArray(rows) ? rows.map(add) : add(rows);
}

// What was said so far on the clients in landing: { marks: { clientId: { itemKey: row } },
// done: { clientId: { person: row } }, ready }. ready false: the migration is not there.
export async function loadIntake() {
  try {
    const [m, d] = await Promise.all([
      supabase.from('client_landing_marks').select('client_id, item_key, choice, person, by_email, at').limit(20000),
      supabase.from('client_landing_done').select('client_id, person, done, by_email, at').limit(20000),
    ]);
    if (m.error || d.error) return { marks: {}, done: {}, ready: false };
    const marks = {};
    const done = {};
    for (const r of m.data || []) (marks[r.client_id] ||= {})[r.item_key] = r;
    for (const r of d.data || []) (done[r.client_id] ||= {})[r.person] = r;
    return { marks, done, ready: true };
  } catch { return { marks: {}, done: {}, ready: false }; }
}

// One person on one client: their answers ({ itemKey: 'done' | 'open' | 'na' }), and
// "סיימתי עם הלקוח" (true), taking it back (false) or neither (null). `waiting`: the
// other people who still have to go over the client; when nobody is left the database
// activates it. Returns { landing }: false when the client was activated by this call.
export async function takeIn(clientId, marks = {}, done = null, waiting = null) {
  const { data, error } = await supabase.rpc('landing_take', { p_client: clientId, p_marks: marks, p_done: done, p_waiting: waiting });
  if (error) throw error;
  return data || { landing: true };
}

// The owners: close a person's part on these clients; activate these clients now.
export async function finishFor(person, ids) {
  const { data, error } = await supabase.rpc('landing_done_for', { p_person: person, p_clients: ids });
  if (error) throw error;
  return data;
}
export async function activate(ids) {
  const { data, error } = await supabase.rpc('landing_activate', { p_clients: ids });
  if (error) throw error;
  return data;
}
