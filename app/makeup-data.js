// Data for Tal's screen (makeup.html; docs/ops.md, section 132). Two functions of the database
// (supabase/migrations/20261213100000_makeup_tal.sql) and nothing else: she reads no table.
// Until the migration is in, the functions are missing: `null`, and the page says so.
import { supabase } from './supa.js';

const missing = (error, status) => status === 404 || ['PGRST202', '42883'].includes(error?.code);

// { days: [{ day, shoot_at, business, round }], answers: [...] }, or null before the migration.
export async function loadMakeupDays() {
  const { data, error, status } = await supabase.rpc('makeup_my_days');
  if (error) { if (missing(error, status)) return null; throw error; }
  return { days: data?.days || [], answers: data?.answers || [] };
}

// "מאשרת" with her hour ('HH:MM'), or "לא יכולה" (hour null). The database checks and stamps.
export async function saveMakeupAnswer(day, answer, hour = null) {
  const { data, error } = await supabase.rpc('makeup_answer', { p_day: day, p_answer: answer, p_arrive: hour });
  if (error) throw error;
  return data;
}

// The office's view (Lior on "לפני יום צילום"): her answers from today on, or [] before the
// migration (row level security: the office reads, nobody else).
export async function loadMakeupAnswers(fromDay) {
  const { data, error, status } = await supabase.from('makeup_answers').select('id, day, shoot_at, answer, arrive_time, at').gte('day', fromDay).order('id');
  if (error) { if (missing(error, status) || ['42P01', 'PGRST205'].includes(error.code)) return []; throw error; }
  return data || [];
}
