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

// → { log, files, progress, drive, driveState } of the last `days` days, the oldest first.
// `driveState` is null while the Drive counts are not there yet (20261120100000_drive_daily.sql).
export async function loadWorkHistory(days, now = new Date()) {
  const start = atTimeIL(addDaysIL(now, -days), 0);
  const iso = start.toISOString();
  const [log, files, progress, drive, driveState] = await Promise.all([
    loadAllLog(iso),
    all(() => supabase.from('client_files').select('client_id, kind, uploaded_by, created_at, deleted_at')
      .in('kind', ['deliverable_graphic', 'deliverable_video']).gte('created_at', iso).order('created_at')),
    all(() => supabase.from('editor_progress_log').select('client_id, editor, day, delta').gte('day', dayKeyIL(start)).order('id')).catch(() => []),
    all(() => supabase.from('drive_daily').select('client_id, day, folder, kind, files').gte('day', dayKeyIL(start)).gt('files', 0).order('day')).catch(() => []),
    all(() => supabase.from('drive_scan_state').select('client_id, scanned_at, error').order('client_id')).catch(() => null),
  ]);
  return { log, files, progress, drive, driveState };
}
