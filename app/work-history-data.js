// The reads of "עבודה לפי עובד" (owner.html#work; app/work-history-logic.js). Row level security
// decides who reads what. The editors' daily numbers may not be there before their migration
// (20261119100000_work_history.sql): the page then shows the rest.
import { supabase } from './supa.js';
import { loadAllLog } from './protocol-data.js';
import { addDaysIL, dayKeyIL, atTimeIL } from './tz.js';

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

// → { log, files, progress } of the last `days` days, the oldest first.
export async function loadWorkHistory(days, now = new Date()) {
  const start = atTimeIL(addDaysIL(now, -days), 0);
  const iso = start.toISOString();
  const [log, files, progress] = await Promise.all([
    loadAllLog(iso),
    all(() => supabase.from('client_files').select('client_id, kind, uploaded_by, created_at, deleted_at')
      .in('kind', ['deliverable_graphic', 'deliverable_video']).gte('created_at', iso).order('created_at')),
    all(() => supabase.from('editor_progress_log').select('client_id, editor, day, delta').gte('day', dayKeyIL(start)).order('id')).catch(() => []),
  ]);
  return { log, files, progress };
}
