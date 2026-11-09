// Reading a signed contract uploaded by hand, and keeping what was read (docs/ops.md, sections 104
// and 117): the one way to ask the contract-ai function and to add the row of
// public.manual_contracts. Used by the review in the client's card (app/contract-read-ui.js) and by
// "הצעות שנשלחו" (app/dashboard.js), which reads a new contract file by itself when it opens.
import { supabase } from './supa.js';
import { packageName } from './client-open.js';
import { formFromRead, keepableRow } from './contract-read-logic.js';

// Asks contract-ai to read the file: { data } (data.result is the checked reading) or { code } (the
// function's error code, '' when it said none). A session that ran out is refreshed once.
export async function askContractRead(fileId) {
  const ask = () => supabase.functions.invoke('contract-ai', { body: { mode: 'read', fileId } });
  let { data, error } = await ask();
  if (error && error.context?.status === 401) { await supabase.auth.refreshSession(); ({ data, error } = await ask()); }
  if (!error) return { data };
  let code = '';
  try { code = String((await error.context.json()).error || ''); } catch { /* no body */ }
  return { code: code || 'read_failed' };
}

// The row of public.manual_contracts for the file, or null.
async function rowOfFile(fileId) {
  const { data } = await supabase.from('manual_contracts').select('*').eq('file_id', fileId).maybeSingle();
  return data || null;
}

// Adds the row of the file: { row, already }. The table keeps one row for each file (file_id is
// unique): when someone else kept it a moment before (two people opened "הצעות שנשלחו" together, or
// the card and the list), their row is the answer, `already` true, and nothing is added twice.
// `row`: checkReadForm's row; the package's name is added here.
export async function insertManualContract({ clientId, fileId, row, readByAi }) {
  const full = { ...row, package_name: row.package_id ? packageName(row.package_id) : null, read_by_ai: !!readByAi };
  const { data, error } = await supabase.from('manual_contracts').insert({ client_id: clientId, file_id: fileId, ...full }).select().single();
  if (!error) return { row: data, already: false };
  if (error.code === '23505') {
    const there = await rowOfFile(fileId);
    if (there) return { row: there, already: true };
  }
  throw error;
}

// Reads the file and keeps what was read, with no one at the screen ("הצעות שנשלחו", 9.11.2026):
// { ok: true, row, already } or { ok: false, code }. Nothing is kept when the reading failed (the
// card's "קריאת החוזה" then reads it afresh); what the reading found is kept as the review keeps it
// (keepableRow), and a row without a price or months is shown as "חוזים שצריך לבדוק".
export async function readAndKeep({ client, file }) {
  const { data, code } = await askContractRead(file.id);
  if (!data) return { ok: false, code };
  const row = keepableRow(formFromRead(data.result || {}), client.business || client.name);
  if (!row) return { ok: false, code: 'nothing_to_keep' };
  try {
    const kept = await insertManualContract({ clientId: client.id, fileId: file.id, row, readByAi: true });
    return { ok: true, ...kept };
  } catch (err) {
    return { ok: false, code: err?.code || 'not_kept' };
  }
}
