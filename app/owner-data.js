// Data for the owner's screens (owner.html), the client's colour in the card and
// on screen 4, and the questions to the one responsible person. Row level
// security decides who reads what (supabase/migrations/20260930120000_owner_screens.sql):
// client_messages and the questions are the office's; a question is also read and
// answered by the person it is addressed to. Who and when are stamped by the database.
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

// Messages sent to clients since a moment (the last contact). Office only.
export async function loadMessagesSince(sinceIso, clientId = null) {
  return all(() => {
    let q = supabase.from('client_messages').select('client_id, kind, sent_at').gte('sent_at', sinceIso).order('sent_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    return q;
  });
}

// The status of every login (never a user name or a password): a broken one turns the client red.
// The managers (the owner, Irit, Ofir) read it through access_status_overview(), so
// screen 1 does not depend on their vault flag; anyone else, or before that
// migration, from the vault's rows as before.
export async function loadAccessStatus() {
  const { data, error } = await supabase.rpc('access_status_overview');
  if (!error && Array.isArray(data) && data.length) return data;
  return all(() => supabase.from('client_access').select('client_id, network, status, updated_at').order('client_id'));
}

// Deadline changes since a moment (every client, or one).
export async function loadDateChanges({ sinceIso = null, clientId = null } = {}) {
  return all(() => {
    let q = supabase.from('client_date_changes').select('id, client_id, field, round, task_id, old_value, new_value, by_email, at').order('at', { ascending: false });
    if (sinceIso) q = q.gte('at', sinceIso);
    if (clientId) q = q.eq('client_id', clientId);
    return q;
  });
}

// The whole history of one client (rounds of corrections, editing stops).
export async function loadClientLog(clientId) {
  return all(() => supabase.from('protocol_log').select('client_id, item_key, action, note, by_email, at').eq('client_id', clientId).order('at'));
}

// The whole history of some items across the clients (returns to fix, rounds of
// corrections: app/health.js historyKeys), with no date floor.
export async function loadLogFor(keys) {
  if (!keys.length) return [];
  return all(() => supabase.from('protocol_log').select('client_id, item_key, action, note, by_email, at').in('item_key', keys).order('at'));
}

// ── Questions ──────────────────────────────
const Q_COLS = 'id, client_id, to_person, about, context, question, asked_by, asked_at, answer, answered_by, answered_at';
export async function loadQuestions({ sinceIso = null, toPerson = null, openOnly = false, clientId = null } = {}) {
  return all(() => {
    let q = supabase.from('client_questions').select(Q_COLS).order('asked_at', { ascending: false });
    if (sinceIso) q = q.gte('asked_at', sinceIso);
    if (toPerson) q = q.eq('to_person', toPerson);
    if (clientId) q = q.eq('client_id', clientId);
    if (openOnly) q = q.is('answer', null);
    return q;
  });
}

export async function askQuestion(row) {
  const { data, error } = await supabase.from('client_questions').insert(row).select(Q_COLS).single();
  if (error) throw error;
  return data;
}

export async function answerQuestion(id, answer) {
  const { data, error } = await supabase.from('client_questions').update({ answer }).eq('id', id).select(Q_COLS).single();
  if (error) throw error;
  return data;
}

// Undo within 5 minutes of asking, before an answer (the database checks both).
export async function withdrawQuestion(id) {
  const { data, error } = await supabase.from('client_questions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('not allowed');
}

// Everything the card needs for its colour, besides what it loads already. Each
// part is optional: without it, its rule is left out (never assumed).
export async function loadHealthExtras(clientId, sinceIso) {
  const [messages, log, changes] = await Promise.allSettled([
    loadMessagesSince(sinceIso, clientId), loadClientLog(clientId), loadDateChanges({ clientId }),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  return { messages: ok(messages), log: ok(log), dateChanges: ok(changes) };
}
