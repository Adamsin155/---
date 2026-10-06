// Data access for Stav's deals (public.deal_requests,
// supabase/migrations/20261003100000_sales_deals.sql). Row level security decides:
// a seller reads and adds only his own; the office reads all and moves the status.
// Who and when are stamped by the database. Until the migration is in, the table is
// missing: the functions return null and the pages say so.
import { supabase } from './supa.js';

const BASE_COLS = 'id, created_at, created_by_email, seller, business_name, contact_name, phone, tier, influencer, paid, free, discount_agorot, notes, status, quote_id, sent_at, signed_at, status_by_email';
// `custom`: "הצעה אחרת" (supabase/migrations/20261010100000_custom_contracts.sql).
const COLS = `${BASE_COLS}, custom`;
const missingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202';

// Every deal the signed-in person may read, newest first (`pendingOnly`: still waiting
// for a contract). null when the table is not there yet.
export async function loadDeals({ pendingOnly = false } = {}) {
  let q = supabase.from('deal_requests').select(COLS).order('created_at', { ascending: false }).limit(200);
  if (pendingOnly) q = q.eq('status', 'pending');
  const { data, error } = await q;
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return data || [];
}

export async function loadDeal(id) {
  const { data, error } = await supabase.from('deal_requests').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// A new deal (the row from validateDeal in app/deal-logic.js).
export async function addDeal(row) {
  const { data, error } = await supabase.from('deal_requests').insert(row).select(COLS).single();
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
