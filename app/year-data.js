// Data for the package year (year.html, the cycle in "המשימות שלי" and the client
// card). Row level security decides who reads and writes: the month marks are the
// office's (supabase/migrations/20260930190000_year.sql). Who marked and when are
// stamped by the database. Until that migration is applied the marks read as null
// ("not there yet") and the screens say so instead of failing.
import { supabase } from './supa.js';
import { quoteFacts } from './protocol-data.js';
import { SURVEY_TABLE, SURVEY_REPORT_COLS } from './surveys.js';

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
// A table that is not there (yet): PostgREST's "not in the schema cache", or Postgres's.
export const isMissingTable = (err) => !!err && (err.code === 'PGRST205' || err.code === '42P01' || /schema cache|does not exist/i.test(String(err.message || '')));

const MARK_COLS = 'client_id, month, item, state, note, by_email, at';

// Month marks of every client (or one), or null when the table is not there yet.
export async function loadMonthMarks(clientId = null) {
  try {
    return await all(() => {
      const q = supabase.from('client_month_marks').select(MARK_COLS).order('client_id').order('month').order('item');
      return clientId ? q.eq('client_id', clientId) : q;
    });
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function setMonthMark(clientId, month, item, state, note = null) {
  const { data, error } = await supabase.from('client_month_marks')
    .upsert({ client_id: clientId, month, item, state, note }, { onConflict: 'client_id,month,item' })
    .select(MARK_COLS).single();
  if (error) throw error;
  return data;
}

export async function clearMonthMark(clientId, month, item) {
  const { error } = await supabase.from('client_month_marks').delete()
    .eq('client_id', clientId).eq('month', month).eq('item', item);
  if (error) throw error;
}

// The signed agreements the renewals start from: the package selection and the
// client's details (Map quote id -> { id, number, signed_at, selection, client }).
export async function loadAgreements(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  // public.quote_facts(): the selection whole for the owners and Irit, without its money for the rest.
  const facts = await quoteFacts(list);
  if (facts) return new Map(facts.map((q) => [q.id, { id: q.id, number: q.number, signed_at: q.signed_at, selection: q.selection, client: q.client }]));
  const { data, error } = await supabase.from('quotes')
    .select('id, number, signed_at, selection:model->selection, client:model->client').in('id', list);
  if (error) return new Map();
  return new Map(data.map((q) => [q.id, q]));
}

// The clients' answers (public.client_surveys, stage 4; the shape in app/surveys.js):
// rows of these clients, or null when the table cannot be read (before its
// migration). The renewals list never fails for it: app/renewals.js surveySummary.
export async function loadSurveys(clientIds) {
  const list = [...new Set((clientIds || []).filter(Boolean))];
  if (!list.length) return {};
  try {
    const rows = await all(() => supabase.from(SURVEY_TABLE).select(SURVEY_REPORT_COLS).in('client_id', list));
    const out = {};
    for (const r of rows) (out[r.client_id] ||= []).push(r);
    return out;
  } catch {
    return null;
  }
}
