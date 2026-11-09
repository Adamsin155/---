// A mark with nothing behind it (protocol v8; docs/ops.md, section 49; the full-flow
// simulation's finding 6.1). Before "סיימתי" is taken on an item that carries `guard`
// (app/protocol.js), the system looks at what it holds itself:
//
//   gantt          "הגאנט מלא" (29): refused while the client's Gantt has no content row.
//   scheduled      "תוזמן לפרסום" (28): refused while no row of the Gantt is scheduled
//                  or up (the Gantt's own states; Metricool is not asked).
//   scripts        "התסריטים מסודרים בעמוד התסריטים" (12): refused while that shoot
//                  round has no script on the scripts page.
//   graphicsCount  "מוכן לבדיקה (לאופיר)" (23): never refused. With fewer graphics up
//                  than the package it ASKS ("הועלתה 1 מתוך 26. לשלוח בכל זאת?"), where
//                  the files are uploaded (app/ilai-card.js), which has both numbers.
//   logoFile       "עילאי הכין לוגו חדש" (5; protocol v10): refused while the client's files hold
//                  no logo (the kind 'logo' of app/files-logic.js). The first graphics hang on it.
//   callSummary    the weekly call (31): it is recorded in the call's own dialog
//                  ("תיעוד שיחה"), which already refuses an empty summary. The pill
//                  leads there.
//
// Refused only when the system KNOWS it is empty: a read that fails, a table that is
// not there, a count that is not zero, all let the mark through. The finished videos
// are in the client's Google Drive (the owner's decision of 7.10.2026): no guard asks
// for an upload of a video.
//
// The browser asks; the database does not. A mark written past the screens (another
// tool, an old tab) is not stopped: that needs a rule in the database, which was left
// out on purpose (no change to who may write what).
import { guardOf, formOf, guardVerdict, ganttFacts, roundOfKey } from './mark-guard-rules.js';

export { guardOf, formOf, guardVerdict, ganttFacts, roundOfKey, REFUSALS, graphicsAsk } from './mark-guard-rules.js';

// One small read for one mark. null when it could not be read (never thrown).
export async function guardFacts(guard, clientId, key) {
  try {
    const { supabase } = await import('./supa.js');
    if (guard === 'gantt' || guard === 'scheduled') {
      const { GANTT_KINDS } = await import('./gantt-template.js');
      const { data, error } = await supabase.from('client_gantt').select('kind, state').eq('client_id', clientId).limit(5000);
      if (error || !Array.isArray(data)) return null;
      return ganttFacts(data, (kind) => !!GANTT_KINDS[kind]?.post);
    }
    if (guard === 'scripts') {
      const { data, error } = await supabase.from('client_scripts').select('n').eq('client_id', clientId).eq('round', roundOfKey(key)).limit(1);
      if (error || !Array.isArray(data)) return null;
      return { scripts: data.length };
    }
    if (guard === 'logoFile') {
      const { data, error } = await supabase.from('client_files').select('id').eq('client_id', clientId).eq('kind', 'logo').is('deleted_at', null).limit(1);
      if (error || !Array.isArray(data)) return null;
      return { logos: data.length };
    }
  } catch { /* not known: the mark is taken */ }
  return null;
}

// What a screen asks before it writes `key` as done: null, { refuse }, or { via: 'call' }.
// (graphicsCount is asked where the files are, with the numbers that page already has.)
export async function checkMark(clientId, key) {
  // v12: an item that is a form of its own (`form` in app/protocol.js: the campaign's details, the
  // pre-shoot form, the scripts' link) is taken through that form, in the client card.
  const form = formOf(key);
  if (form) return { via: 'form', form };
  const guard = guardOf(key);
  if (!guard || guard === 'graphicsCount') return null;
  if (guard === 'callSummary') return { via: 'call' };
  return guardVerdict(guard, await guardFacts(guard, clientId, key));
}
