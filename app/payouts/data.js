// Database access for the payouts app. Every table is owner-only (RLS);
// this file only maps rows to the shapes engine.js expects.
import { supabase } from '../supa.js';
import { monthBounds } from './engine.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export async function session() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export async function isOwner(userId) {
  const rows = check(await supabase.from('payout_owners').select('user_id').eq('user_id', userId));
  return rows.length === 1;
}

export async function loadSettings() {
  const rows = check(await supabase.from('payout_settings')
    .select('id, effective_from, data, note, created_at').order('effective_from'));
  return rows.map((r) => ({ id: r.id, effectiveFrom: r.effective_from, data: r.data, note: r.note, createdAt: r.created_at }));
}

// Inserts a version, or replaces the one that starts on the same day.
export async function saveSettings(effectiveFrom, data, note) {
  check(await supabase.from('payout_settings')
    .upsert({ effective_from: effectiveFrom, data, note: note || null }, { onConflict: 'effective_from' }));
}

const dealFromRow = (r) => ({
  id: r.id, date: r.deal_date, client: r.client, selection: r.selection,
  perks: r.perks || [], seller: r.seller || '', note: r.note || '', quoteId: r.quote_id,
});

export async function loadMonth(month) {
  const { first, last } = monthBounds(month);
  const [deals, incomes, expenses, lock] = await Promise.all([
    supabase.from('payout_deals').select('*').gte('deal_date', first).lte('deal_date', last).order('deal_date'),
    supabase.from('payout_incomes').select('*').gte('income_date', first).lte('income_date', last).order('income_date'),
    supabase.from('payout_expenses').select('*').eq('month', month).order('created_at'),
    supabase.from('payout_locks').select('month, report, locked_at').eq('month', month).maybeSingle(),
  ]);
  return {
    deals: check(deals).map(dealFromRow),
    incomes: check(incomes).map((r) => ({
      id: r.id, date: r.income_date, label: r.label, family: r.family, amount: Number(r.amount_agorot), note: r.note || '',
    })),
    expenses: check(expenses).map((r) => ({
      id: r.id, month: r.month, label: r.label, payee: r.payee || '', amount: Number(r.amount_agorot),
    })),
    lock: check(lock),
  };
}

export async function lastSeller() {
  const rows = check(await supabase.from('payout_deals').select('seller')
    .not('seller', 'is', null).order('created_at', { ascending: false }).limit(1));
  return rows[0]?.seller || '';
}

export async function saveDeal(d) {
  const row = {
    deal_date: d.date, client: d.client.trim(), selection: d.selection,
    perks: d.perks, seller: d.seller?.trim() || null, note: d.note?.trim() || null,
  };
  if (d.id) check(await supabase.from('payout_deals').update(row).eq('id', d.id));
  else check(await supabase.from('payout_deals').insert(row));
}

export async function deleteRow(table, id) {
  check(await supabase.from(table).delete().eq('id', id));
}

export async function saveIncome(e) {
  const row = { income_date: e.date, label: e.label.trim(), family: e.family, amount_agorot: e.amount, note: e.note?.trim() || null };
  if (e.id) check(await supabase.from('payout_incomes').update(row).eq('id', e.id));
  else check(await supabase.from('payout_incomes').insert(row));
}

export async function saveExpense(e) {
  const row = { month: e.month, label: e.label.trim(), payee: e.payee?.trim() || null, amount_agorot: e.amount };
  if (e.id) check(await supabase.from('payout_expenses').update(row).eq('id', e.id));
  else check(await supabase.from('payout_expenses').insert(row));
}

export async function lockMonth(month, report) {
  check(await supabase.from('payout_locks').insert({ month, report }));
}

export async function unlockMonth(month) {
  check(await supabase.from('payout_locks').delete().eq('month', month));
}

export async function lastLockedMonth() {
  const rows = check(await supabase.from('payout_locks').select('month').order('month', { ascending: false }).limit(1));
  return rows[0]?.month || null;
}

export function explain(err) {
  const msg = String(err?.message || err || '');
  if (/month is locked/.test(msg)) return 'החודש נעול. כדי לשנות בו משהו, פתחו אותו קודם במסך ״החודש״.';
  if (/settings overlap a locked month/.test(msg)) return 'אי אפשר לקבוע הגדרות שמתחילות בחודש נעול או לפניו. בחרו תאריך תחילה מאוחר יותר.';
  if (/Invalid login credentials/i.test(msg)) return 'האימייל או הסיסמה שגויים.';
  if (/rate limit|security purposes/i.test(msg)) return 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  if (/duplicate key/.test(msg)) return 'הרשומה כבר קיימת.';
  if (/JWT|not authenticated|401/.test(msg)) return 'יש להתחבר מחדש.';
  return 'הפעולה לא הושלמה. נסו שוב בעוד רגע.';
}
