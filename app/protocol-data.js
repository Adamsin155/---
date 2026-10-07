// Data access for the client protocol pages. Row level security decides what each
// person reads and changes: the office sees every client; everyone else only the
// clients they work on (supabase/migrations/20260930130000_assignment_rls.sql), so
// a list can come back shorter or empty, and a client not theirs as null. Who
// checked an item and when are stamped by the database.
import { supabase } from './supa.js';
import { withLanding } from './landing-data.js';

const PAGE = 1000;
async function all(build) {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) return out;
  }
}

// The office's columns of a client (its own phone, the office's notes, why an
// agreement was cancelled) are not readable from public.clients since
// 20260930210000_hardening.sql: the office reads them through
// public.clients_private(), and nobody else gets them (they come back null). Before
// that migration the function is missing, and they are read from the table as before.
export const CLIENT_PRIVATE = ['phone', 'notes', 'closed_reason'];
const CLIENT_COLS = 'id, name, business, address, package_name, shoot_type, characterizer, has_logo, editor_name, deal_at, char_at, shoot_at, contract_end, status, quote_id, created_at, created_by_email, links, deliverables, rounds, verified_at, verified_by, editor, protocol_version';
const LEGACY_COLS = `${CLIENT_COLS}, ${CLIENT_PRIVATE.join(', ')}`;
const CHECK_COLS = 'client_id, item_key, state, note, by_email, at';
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, done_by_email, created_by_email, created_at, source, brief, urgent, started_at';

// { id: { phone, notes, closed_reason } }: the office's clients (all of them when
// `ids` is null); {} for anyone else; null before the migration.
const missingFunction = (error, status) => error?.code === 'PGRST202' || error?.code === '42883' || status === 404;
async function privateFields(ids = null) {
  const { data, error, status } = await supabase.rpc('clients_private', ids ? { p_ids: ids } : {});
  if (error) {
    if (missingFunction(error, status)) return null;
    throw error;
  }
  return Object.fromEntries((data || []).map((r) => [r.id, r]));
}
const withPrivate = (row, priv) => row && {
  ...row, phone: priv[row.id]?.phone ?? null, notes: priv[row.id]?.notes ?? null, closed_reason: priv[row.id]?.closed_reason ?? null,
};
// One client row as the pages use it: the office's columns added (null outside the office).
async function complete(row) {
  if (!row) return row;
  const priv = await privateFields([row.id]);
  if (priv) return withPrivate(row, priv);
  const { data, error } = await supabase.from('clients').select(LEGACY_COLS).eq('id', row.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadClients({ includeEnded = false } = {}) {
  const read = (cols) => all(() => {
    let q = supabase.from('clients').select(cols).order('deal_at', { ascending: false });
    if (!includeEnded) q = q.neq('status', 'ended');
    return q;
  });
  const [rows, priv] = await Promise.all([read(CLIENT_COLS), privateFields()]);
  // Every row carries its landing columns (docs/ops.md, section 41): the deadlines,
  // the lists and the clocks of every page read them through clientState.
  return withLanding(priv ? rows.map((r) => withPrivate(r, priv)) : await read(LEGACY_COLS));
}

export async function loadClient(id) {
  const [{ data, error }, priv] = await Promise.all([
    supabase.from('clients').select(CLIENT_COLS).eq('id', id).maybeSingle(),
    privateFields([id]),
  ]);
  if (error) throw error;
  if (!data || priv) return data && withLanding(withPrivate(data, priv));
  return withLanding(await complete(data));
}

// Checks grouped by client: { clientId: { itemKey: check } }.
export async function loadChecks(clientId = null) {
  const rows = await all(() => {
    const q = supabase.from('protocol_checks').select(CHECK_COLS).order('client_id').order('item_key');
    return clientId ? q.eq('client_id', clientId) : q;
  });
  const out = {};
  for (const r of rows) (out[r.client_id] ||= {})[r.item_key] = r;
  return out;
}

export async function setCheck(clientId, key, state, note = null) {
  const { data, error } = await supabase.from('protocol_checks')
    .upsert({ client_id: clientId, item_key: key, state, note }, { onConflict: 'client_id,item_key' })
    .select(CHECK_COLS).single();
  if (error) throw error;
  return data;
}

// Several items in one request: all are saved or none are.
export async function setChecksBulk(clientId, keys, state, note = null) {
  const { data, error } = await supabase.from('protocol_checks')
    .upsert(keys.map((k) => ({ client_id: clientId, item_key: k, state, note })), { onConflict: 'client_id,item_key' })
    .select(CHECK_COLS);
  if (error) throw error;
  return data;
}

export async function clearChecksBulk(clientId, keys) {
  const { error } = await supabase.from('protocol_checks').delete().eq('client_id', clientId).in('item_key', keys);
  if (error) throw error;
}

export async function clearCheck(clientId, key) {
  const { error } = await supabase.from('protocol_checks').delete().eq('client_id', clientId).eq('item_key', key);
  if (error) throw error;
}

// Weekly calls with their summaries, independent of how busy the history is.
export async function loadCalls(clientId, limit = 20) {
  const { data, error } = await supabase.from('protocol_log')
    .select('id, item_key, action, note, by_email, at').eq('client_id', clientId).eq('action', 'done')
    .like('item_key', '%p31.call').order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

export async function loadLog(clientId, limit = 60) {
  const { data, error } = await supabase.from('protocol_log')
    .select('id, item_key, action, note, by_email, at').eq('client_id', clientId)
    .order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

export async function loadTasks({ clientId = null, openOnly = false } = {}) {
  const read = (cols) => all(() => {
    let q = supabase.from('client_tasks').select(cols).order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    if (openOnly) q = q.is('done_at', null);
    return q;
  });
  try {
    return await read(TASK_COLS);
  } catch (err) {
    // Until migration 20260930110001 adds started_at ("התחלתי"), tasks load without it.
    if (err?.code !== '42703') throw err;
    return read(TASK_COLS.replace(', started_at', ''));
  }
}

export async function addTask(task) {
  const { data, error } = await supabase.from('client_tasks').insert(task).select(TASK_COLS).single();
  if (error) throw error;
  return data;
}

export async function setTaskDone(id, done) {
  const { data, error } = await supabase.from('client_tasks')
    .update({ done_at: done ? new Date().toISOString() : null }).eq('id', id).select(TASK_COLS).single();
  if (error) throw error;
  return data;
}

// "התחלתי" on an urgent task (the database stamps when and who).
export async function setTaskStarted(id, started) {
  const { data, error } = await supabase.from('client_tasks')
    .update({ started_at: started ? new Date().toISOString() : null }).eq('id', id).select(TASK_COLS).single();
  if (error) throw error;
  return data;
}

export async function createClient(fields) {
  const { data, error } = await supabase.from('clients').insert(fields).select(CLIENT_COLS).single();
  if (error) throw error;
  return complete(data);
}

export async function updateClient(id, fields) {
  const { data, error } = await supabase.from('clients').update(fields).eq('id', id).select(CLIENT_COLS).single();
  if (error) throw error;
  return withLanding(await complete(data));
}

// What the office needs from agreements, without their money (the owner's decision,
// 6.10.2026): public.quote_facts() answers the office with the number, the signing day,
// the package and the selection minus the discount and any price typed by hand; the
// table public.quotes itself is read only by the owners and Irit (and, for a contract
// that waits for approval, by Ofir and Lior). `ids`: these agreements; null: every
// signed one. Returns null when the function is not there (before the migration
// 20261013100000_money_owners_only.sql) or did not answer: the caller then reads the
// table as before.
export async function quoteFacts(ids = null) {
  try {
    const { data, error } = await supabase.rpc('quote_facts', { p_ids: ids });
    return error || !Array.isArray(data) ? null : data;
  } catch { return null; }
}

// Signed agreements that no client was opened from yet.
export async function signedQuotes() {
  const signed = async () => {
    const facts = await quoteFacts(null);
    if (facts) {
      return facts.filter((q) => q.status === 'signed').slice(0, 200)
        .map((q) => ({ ...q, company: q.client?.company ?? null, phone: q.client?.phone ?? null }));
    }
    const { data, error } = await supabase.from('quotes')
      .select('id, number, client_name, signed_at, company:model->client->>company, phone:model->client->>phone, tier:model->package->>tierName, influencer:model->package->>influencer, package_id:model->package->>id, selection:model->selection, term_months:model->>termMonths')
      .eq('status', 'signed').order('signed_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data;
  };
  const [quotes, { data: linked, error: e2 }] = await Promise.all([
    signed(),
    supabase.from('clients').select('quote_id').not('quote_id', 'is', null),
  ]);
  if (e2) throw e2;
  const used = new Set(linked.map((r) => r.quote_id));
  return quotes.filter((q) => !used.has(q.id));
}

// Who is who: staff email -> person key, for showing names instead of emails.
export async function loadDirectory() {
  const { data, error } = await supabase.from('staff').select('email, person');
  if (error) return {};
  return Object.fromEntries(data.filter((r) => r.person).map((r) => [r.email, r.person]));
}

// WhatsApp numbers of the team by person (staff.phone, set on the team screen), for
// the handoff buttons. Staff read the staff list ("staff read staff"). No column
// yet (its migration not applied) or an error: no numbers, and WhatsApp asks whom to send to.
export async function loadStaffPhones() {
  const { data, error } = await supabase.from('staff').select('person, phone').not('person', 'is', null);
  if (error) return {};
  const out = {};
  for (const r of data) if (r.person && r.phone && !out[r.person]) out[r.person] = r.phone;
  return out;
}

// Daily reviews (processes 32 and 33) since a given day: [{ day, kind, by_email, at, note }].
export async function loadReviews(sinceDay) {
  const { data, error } = await supabase.from('office_reviews').select('day, kind, note, by_email, at, note_by, note_at')
    .gte('day', sinceDay).order('day', { ascending: false });
  if (error) throw error;
  return data;
}

// Marking never sends a note, so it cannot wipe notes written from another screen.
export async function markReview(day, kind, note) {
  const row = note === undefined || note === null ? { day, kind } : { day, kind, note };
  const { data, error } = await supabase.from('office_reviews')
    .upsert(row, { onConflict: 'day,kind' }).select('day, kind, note, by_email, at, note_by, note_at').single();
  if (error) throw error;
  return data;
}

// The signed agreement a client was opened from: its number and signing day (nothing
// else of it is shown in the card; no price and no link to the document).
export async function loadQuoteSummary(id) {
  const facts = await quoteFacts([id]);
  if (facts) return facts[0] ? { id: facts[0].id, number: facts[0].number, signed_at: facts[0].signed_at } : null;
  const { data, error } = await supabase.from('quotes').select('id, number, signed_at').eq('id', id).maybeSingle();
  if (error) return null;
  return data;
}

// All checks with their times, for the performance report.
export async function loadAllLog(sinceIso) {
  return all(() => supabase.from('protocol_log').select('client_id, item_key, action, note, by_email, at')
    .gte('at', sinceIso).order('at'));
}

// The tasks marked done since a moment (the week's chart on the manager view, app/week-chart.js).
export async function loadTasksDoneSince(sinceIso) {
  return all(() => supabase.from('client_tasks').select('id, client_id, done_at').gte('done_at', sinceIso).order('done_at'));
}

// ── Access vault ─────────────────────────────
// The list never contains passwords; a password is read only through
// access_reveal(), which logs who viewed it and when.
export async function loadAccess(clientId) {
  const { data, error } = await supabase.from('client_access')
    .select('id, network, label, username, status, note, updated_by, updated_at, has_secret:secret_id')
    .eq('client_id', clientId).order('created_at');
  if (error) throw error;
  return data.map((r) => ({ ...r, has_secret: !!r.has_secret }));
}

export async function saveAccess(clientId, a) {
  const { data, error } = await supabase.rpc('access_save', {
    p_client: clientId, p_id: a.id || null, p_network: a.network, p_label: a.label || null,
    p_username: a.username || null, p_password: a.password || null, p_status: a.status || 'ok', p_note: a.note || null,
  });
  if (error) throw error;
  return data;
}

// THE ONE PLACE a stored password is asked for (the only call of access_reveal in
// the app; the card's "הצגת סיסמה" comes through here). Who may open a password is
// decided by the database, unchanged: the vault flag and can_use_client_vault().
//
// The step before a password is shown plugs in here and nowhere else: "קוד הכספת"
// (app/vault-gate.js, set by the card with setPasswordGate). `passwordGate` is awaited
// before every reveal and gets { accessId }; returning false stops the reveal. The
// gate only asks for the code: it is the database that checks it and remembers the
// unlock (vault_unlock; access_reveal refuses without one once a code was set).
export const GATE_CANCELLED = 'הפתיחה בוטלה.';
let passwordGate = async () => true;
export const setPasswordGate = (fn) => { passwordGate = typeof fn === 'function' ? fn : async () => true; };
export async function revealAccess(id) {
  if (!(await passwordGate({ accessId: id }))) throw new Error(GATE_CANCELLED);
  const { data, error } = await supabase.rpc('access_reveal', { p_id: id });
  if (error) throw error;
  return data;
}

// "קוד הכספת" (20261008100100_vault_code.sql). The status: { set, changedAt, owner,
// openUntil, lockedUntil, left }, or null before the migration (the vault then works
// as it always did).
export async function vaultCodeStatus() {
  const { data, error } = await supabase.rpc('vault_code_status');
  return !error && data && typeof data === 'object' ? data : null;
}
// { state: 'open', until } | { state: 'wrong', left } | { state: 'locked', until } | { state: 'none' }
export async function vaultUnlock(code) {
  const { data, error } = await supabase.rpc('vault_unlock', { p_code: code });
  if (error) throw error;
  return data;
}
export async function vaultLock() {
  const { error } = await supabase.rpc('vault_lock');
  if (error) throw error;
}
export async function setVaultCode(code) {
  const { data, error } = await supabase.rpc('vault_code_set', { p_code: code });
  if (error) throw error;
  return data;
}
export async function loadVaultCodeLog(limit = 12) {
  const { data, error } = await supabase.from('vault_code_log').select('id, email, event, at').in('event', ['wrong', 'lockout', 'set', 'changed']).order('at', { ascending: false }).limit(limit);
  return error ? [] : data || [];
}

export async function deleteAccess(id) {
  const { error } = await supabase.rpc('access_delete', { p_id: id });
  if (error) throw error;
}

export async function loadAccessLog(clientId, limit = 30) {
  const { data, error } = await supabase.from('client_access_log')
    .select('id, network, action, by_email, at').eq('client_id', clientId).order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// May this user use the vault: the vault flag (staff.vault) and, for one client,
// outside the office, a client assigned to them. Until the database has the
// per-client check (its migration not applied yet), the flag alone decides.
export async function canUseVault(clientId = null) {
  if (clientId) {
    const { data, error, status } = await supabase.rpc('can_use_client_vault', { p_client: clientId });
    if (!error) return data === true;
    if (status !== 404 && error.code !== 'PGRST202') return false;
  }
  const { data, error } = await supabase.rpc('can_use_vault');
  return !error && data === true;
}

// ── Ofir's weekly status summaries ───────────
// week = the Sunday of the week (local date, YYYY-MM-DD).
const NOTE_COLS = 'client_id, week, current, missing, next, owner, due_on, by_email, at';
export async function loadStatusNotes({ clientId = null, sinceWeek = null } = {}) {
  return all(() => {
    let q = supabase.from('client_status_notes').select(NOTE_COLS).order('week', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    if (sinceWeek) q = q.gte('week', sinceWeek);
    return q;
  });
}

export async function saveStatusNote(note) {
  const { data, error } = await supabase.from('client_status_notes')
    .upsert(note, { onConflict: 'client_id,week' }).select(NOTE_COLS).single();
  if (error) throw error;
  return data;
}
