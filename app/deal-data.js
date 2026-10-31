// Data access for Stav's deals (public.deal_requests,
// supabase/migrations/20261003100000_sales_deals.sql). Row level security decides:
// a seller reads and adds only his own; Irit, Ofir and the owners read all and move the status.
// Who and when are stamped by the database. Until the migration is in, the table is
// missing: the functions return null and the pages say so.
import { supabase } from './supa.js';

const BASE_COLS = 'id, created_at, created_by_email, seller, business_name, contact_name, phone, tier, influencer, paid, free, discount_agorot, notes, status, quote_id, sent_at, signed_at, status_by_email';
// `custom`: "הצעה אחרת" (supabase/migrations/20261010100000_custom_contracts.sql), or since
// 29.10.2026 the seller's own words ({ text }); `doc_type`: what Irit prepares (חוזה / הצעת מחיר,
// 20261118100000_no_manager_approval.sql). Before that migration the list is read without it.
const OLD_COLS = `${BASE_COLS}, custom`;
const DOC_COLS = `${OLD_COLS}, doc_type`;
// Who took it, the company number, the business address and "הנחה חריגה" (20261122100000_deal_pool.sql).
let COLS = `${DOC_COLS}, taken_by, taken_at, company_id, business_address, special_discount_agorot`;
const missingColumn = (error) => error?.code === '42703' || error?.code === 'PGRST204';
async function withCols(run) {
  for (;;) {
    const r = await run(COLS);
    if (!missingColumn(r.error) || COLS === OLD_COLS) return r;
    COLS = COLS === DOC_COLS ? OLD_COLS : DOC_COLS;
  }
}
const missingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202';

// Every deal the signed-in person may read, newest first (`pendingOnly`: still waiting
// for a contract). null when the table is not there yet.
export async function loadDeals({ pendingOnly = false } = {}) {
  const { data, error } = await withCols((cols) => {
    let q = supabase.from('deal_requests').select(cols).order('created_at', { ascending: false }).limit(200);
    if (pendingOnly) q = q.eq('status', 'pending');
    return q;
  });
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return data || [];
}

export async function loadDeal(id) {
  const { data, error } = await withCols((cols) => supabase.from('deal_requests').select(cols).eq('id', id).maybeSingle());
  if (error) throw error;
  return data;
}

// A new deal (the row from validateDeal in app/deal-logic.js).
export async function addDeal(row) {
  const { data, error } = await supabase.from('deal_requests').insert(row).select(COLS).single();
  if (error) throw error;
  return data;
}

// Whoever presses first takes the deal: { ok, taken_by, status }. Before the migration: nothing to take.
export async function takeDeal(id) {
  const { data, error } = await supabase.rpc('deal_take', { p_id: id });
  if (error) {
    if (missingTable(error)) return { ok: true, taken_by: null };
    throw error;
  }
  return data;
}

// The owners hand a waiting deal to Irit or to Ofir.
export async function handOverDeal(id, person) {
  const { data, error } = await supabase.rpc('deal_hand_over', { p_id: id, p_person: person });
  if (error) throw error;
  return data;
}

// The office: "חוזה נשלח", "בוטל", or back to waiting.
export async function setDealStatus(id, status) {
  const { data, error } = await supabase.from('deal_requests').update({ status }).eq('id', id).select(COLS).single();
  if (error) throw error;
  return data;
}

// The quote created from the deal (index.html?deal=…): linked, the deal is "חוזה נשלח".
export async function linkQuote(id, quoteId) {
  const { data, error } = await supabase.from('deal_requests').update({ quote_id: quoteId }).eq('id', id).select(COLS).single();
  if (error) throw error;
  return data;
}
