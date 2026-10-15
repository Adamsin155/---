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

// The office and the owners record the real editor of a shoot of a client in landing
// (null clears it; round null: the client's own shoot). Quiet: no ring, no clock, no
// folder task; the activation makes it imported history (landing-logic.js, editorSlots).
export async function setLandingEditor(clientId, editor = null, round = null) {
  const { data, error } = await supabase.rpc('landing_set_editor', { p_client: clientId, p_editor: editor, p_round: round });
  if (error) throw error;
  return data;
}

// A step asked again although the import marked it done (landing-logic.js, ASK_AGAIN: the
// Highlights) and answered "not done yet": before the activation the owner's own sign-in takes
// the imported mark back, so the step becomes a task with a fresh deadline. Only imported marks
// ('ייבוא'), only those keys; a real mark is never touched.
const ASKED = /^p08b?\./;
async function reopenAskedAgain(ids) {
  if (!ids?.length) return;
  const { data: open, error } = await supabase.from('client_landing_marks').select('client_id, item_key').in('client_id', ids).eq('choice', 'open');
  if (error || !open?.length) return;
  const asked = open.filter((m) => ASKED.test(m.item_key));
  if (!asked.length) return;
  const { data: imported } = await supabase.from('protocol_checks').select('client_id, item_key').in('client_id', [...new Set(asked.map((m) => m.client_id))])
    .in('item_key', [...new Set(asked.map((m) => m.item_key))]).eq('note', 'ייבוא');
  const by = {};
  for (const r of imported || []) if (asked.some((m) => m.client_id === r.client_id && m.item_key === r.item_key)) (by[r.client_id] ||= []).push(r.item_key);
  // As protocol-data.js clearChecksBulk (not imported: that module reads this one).
  for (const [id, keys] of Object.entries(by)) {
    const { error: e } = await supabase.from('protocol_checks').delete().eq('client_id', id).in('item_key', keys).eq('note', 'ייבוא');
    if (e) throw e;
  }
}

// The owners: close a person's part on these clients; activate these clients now.
export async function finishFor(person, ids) {
  const { data, error } = await supabase.rpc('landing_done_for', { p_person: person, p_clients: ids });
  if (error) throw error;
  return data;
}
export async function activate(ids) {
  await reopenAskedAgain(ids);
  const { data, error } = await supabase.rpc('landing_activate', { p_clients: ids });
  if (error) throw error;
  return data;
}

// ── The personal link to the taking-in, with no sign-in (the owner, 15.10.2026;
// supabase/migrations/20261027100000_landing_links.sql). The token rides in the address's
// '#', so it never reaches a server log; the database keeps only its hash.
export const linkUrl = (base, token) => `${new URL('intake-link.html', base).href}#t=${encodeURIComponent(token)}`;
export const tokenOf = (hash) => { const m = /(?:^#|&)t=([0-9a-f]{64})(?:&|$)/.exec(String(hash || '')); return m ? m[1] : null; };

// The owners: a new link for one person (an older one stops working), take it back, list them.
export async function makeLink(person) {
  const { data, error } = await supabase.rpc('landing_link_make', { p_person: person });
  if (error) throw error;
  return data;
}
export async function revokeLink(person) {
  const { error } = await supabase.rpc('landing_link_revoke', { p_person: person });
  if (error) throw error;
}
export async function listLinks() {
  try {
    const { data, error } = await supabase.rpc('landing_links');
    return error || !Array.isArray(data) ? null : data;
  } catch { return null; }
}

// The link's screen: { person, expires_at, clients, checks, intake } in the shapes the
// signed-in screen loads (loadClients, loadChecks, loadIntake).
export async function linkRead(token) {
  const { data, error } = await supabase.rpc('landing_link_read', { p_token: token });
  if (error) throw error;
  const checks = {}, marks = {}, done = {};
  for (const r of data.checks || []) (checks[r.client_id] ||= {})[r.item_key] = r;
  for (const r of data.marks || []) (marks[r.client_id] ||= {})[r.item_key] = r;
  for (const r of data.done || []) (done[r.client_id] ||= {})[r.person] = r;
  const clients = (data.clients || []).map((c) => ({ ...c, landing: c.landing === true }))
    .sort((a, b) => String(b.deal_at || '').localeCompare(String(a.deal_at || '')));
  return { person: data.person, expires_at: data.expires_at, clients, checks, intake: { marks, done, ready: true } };
}
export async function linkTake(token, clientId, marks = {}, done = null, waiting = null) {
  const { data, error } = await supabase.rpc('landing_link_take', { p_token: token, p_client: clientId, p_marks: marks, p_done: done, p_waiting: waiting });
  if (error) throw error;
  return data || { landing: true };
}
