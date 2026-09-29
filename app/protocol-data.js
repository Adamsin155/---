// Data access for the client protocol pages. Row level security limits every
// table to staff; who checked an item and when are stamped by the database.
import { supabase } from './supa.js';

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

const CLIENT_COLS = 'id, name, business, phone, package_name, shoot_type, characterizer, has_logo, editor_name, deal_at, char_at, shoot_at, contract_end, status, notes, quote_id, created_at, created_by_email';
const CHECK_COLS = 'client_id, item_key, state, note, by_email, at';
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, done_by_email, created_by_email, created_at';

export async function loadClients({ includeEnded = false } = {}) {
  return all(() => {
    let q = supabase.from('clients').select(CLIENT_COLS).order('deal_at', { ascending: false });
    if (!includeEnded) q = q.neq('status', 'ended');
    return q;
  });
}

export async function loadClient(id) {
  const { data, error } = await supabase.from('clients').select(CLIENT_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
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

export async function clearCheck(clientId, key) {
  const { error } = await supabase.from('protocol_checks').delete().eq('client_id', clientId).eq('item_key', key);
  if (error) throw error;
}

export async function loadLog(clientId, limit = 60) {
  const { data, error } = await supabase.from('protocol_log')
    .select('id, item_key, action, note, by_email, at').eq('client_id', clientId)
    .order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

export async function loadTasks({ clientId = null, openOnly = false } = {}) {
  return all(() => {
    let q = supabase.from('client_tasks').select(TASK_COLS).order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    if (openOnly) q = q.is('done_at', null);
    return q;
  });
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

export async function createClient(fields) {
  const { data, error } = await supabase.from('clients').insert(fields).select(CLIENT_COLS).single();
  if (error) throw error;
  return data;
}

export async function updateClient(id, fields) {
  const { data, error } = await supabase.from('clients').update(fields).eq('id', id).select(CLIENT_COLS).single();
  if (error) throw error;
  return data;
}

// Signed agreements that no client was opened from yet.
export async function signedQuotes() {
  const [{ data: quotes, error }, { data: linked, error: e2 }] = await Promise.all([
    supabase.from('quotes')
      .select('id, number, client_name, signed_at, company:model->client->>company, phone:model->client->>phone, tier:model->package->>tierName, influencer:model->package->>influencer, package_id:model->package->>id, term_months:model->>termMonths')
      .eq('status', 'signed').order('signed_at', { ascending: false }).limit(200),
    supabase.from('clients').select('quote_id').not('quote_id', 'is', null),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const used = new Set(linked.map((r) => r.quote_id));
  return quotes.filter((q) => !used.has(q.id));
}

export async function myPerson() {
  const { data: s } = await supabase.auth.getSession();
  const email = s?.session?.user?.email?.toLowerCase();
  if (!email) return null;
  const { data, error } = await supabase.from('staff').select('person').eq('email', email).maybeSingle();
  if (error) return null;
  return data?.person || null;
}

export async function setMyPerson(person) {
  const { error } = await supabase.rpc('set_my_person', { p_person: person });
  if (error) throw error;
}
