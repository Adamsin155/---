// The read of "הכנסות ישנות" (owner.html#old-income; app/old-income-logic.js). Read only: the app has
// no write to this table, and row level security lets only the owners read it.
import { supabase } from './supa.js';

const PAGE = 1000;
export async function loadOldIncome() {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('old_income_deals')
      .select('old_id, deal_date, business, amount, retainer, package, payment_method, close_type')
      .order('old_id').range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) return out;
  }
}
