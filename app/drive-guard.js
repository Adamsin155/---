// The check of "כל הסרטונים הועלו לדרייב" (p24.drive / rN.p24.drive) before it is marked done
// (the owner, 17.11.2026; the rules: app/drive-guard-logic.js; docs/ops.md, section 140). The
// client's folder is listed live by the drive function (as the caller: the client's editor, or
// whoever changes the Gantt), and its edited videos are counted against what the shoot needs.
//
// Every write of the mark goes through app/protocol-data.js setCheck / setChecksBulk, which asks
// here first (guardDriveMarks): one place, whatever screen the tap came from (the client card,
// "בוצע" of a whole process, the editor's "מוכן לבדיקה", the office's lists, the landing). A
// screen that wants to say it before its own optimistic tick asks checkDriveVideos first; a
// "yes" is remembered for two minutes, so the write right after it does not list the folder again.
// Unmarking, and "לא רלוונטי" (state 'na'), are never checked.
import { loadClient } from './protocol-data.js';
import { listDriveFiles, ERRORS } from './drive-files.js';
import { driveVerdict, isDriveKey, cannotCheck } from './drive-guard-logic.js';

export { isDriveKey } from './drive-guard-logic.js';

// The refusals' words on this check: who may look into the folder is not the Gantt's sentence.
const WORDS = { ...ERRORS, not_allowed: 'את הדרייב של הלקוח בודקים העורך שלו, עילאי, עירית, אופיר, ליאור והבעלים.', no_client: 'הלקוח לא נמצא. רעננו את הדף.' };
const KEEP_MS = 120e3;
const passed = new Map(); // `${clientId}|${key}` → when the folder was found full

// null: the mark may be written; { refuse: sentence } otherwise. Never throws.
//   client: the client's row when the screen has it (else it is read).
export async function checkDriveVideos(clientId, key, { client = null, now = new Date() } = {}) {
  if (!isDriveKey(key)) return null;
  const memo = `${clientId}|${key}`;
  if (Date.now() - (passed.get(memo) || 0) < KEEP_MS) return null;
  let row = client;
  if (!row || row.id !== clientId) {
    try { row = await loadClient(clientId); } catch { row = null; }
  }
  if (!row) return { refuse: cannotCheck(WORDS.no_client) };
  const got = await listDriveFiles(clientId, { words: WORDS });
  if (got.error) return { refuse: cannotCheck(got.error) };
  const v = driveVerdict(row, key, got, now);
  if (!v.ok) return { refuse: v.say };
  passed.set(memo, Date.now());
  return null;
}

// An error the screens show as it is (app/supa.js explainError reads `say`).
export const refusal = (say) => Object.assign(new Error('drive_videos_missing'), { code: 'drive_videos', say });

// Before setCheck / setChecksBulk write `keys` as `state`: throws refusal(...) when one of them is
// step 24's "all in the Drive" and the Drive does not have them. Nothing is written then.
export async function guardDriveMarks(clientId, keys, state) {
  if (state !== 'done') return;
  for (const key of keys) {
    if (!isDriveKey(key)) continue;
    const v = await checkDriveVideos(clientId, key);
    if (v?.refuse) throw refusal(v.refuse);
  }
}
// Forget the remembered "yes" (tests; a folder that changed).
export const forgetDriveChecks = () => passed.clear();
