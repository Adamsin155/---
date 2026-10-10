// The automatic editor assignment, as it was (the owner's decision of 3.10.2026, item 6):
// when a shoot day was closed and no editor was assigned yet, the reminders tick assigned
// one by itself. Protocol v9 (the owner's decision of 10.10.2026; docs/ops.md, section
// 57) turned it off: Ofir assigns, and the same load calculation is now a suggestion in
// his dialog (app/qa-logic.js: editorLoad, suggestEditor).
//
// What stays here is how to read what the server wrote until then, so a client that was
// assigned automatically keeps saying so (the tag "שויך אוטומטית" on Ofir's load list),
// and the one mark the assignment still closes for Lior.
import { REASON_KEY, readJson } from './office-marks.js';

// 22א also holds Lior's "the drive came back". He confirmed exactly that when he closed
// the shoot day (19: "הכונן חזר אליי", p19.took), so the assignment closes it with the
// rest: otherwise 22א stays open on that one item and is reported late in the same
// minute it was assigned (found live, 6.10.2026). Ofir's dialog does the same now.
export const AUTO_DRIVE_NOTE = 'נסגר לבד: ליאור אישר בסגירת יום הצילום שהכונן חזר';

// The reason mark of an automatic assignment ({ editor, auto: true, … }), or null.
export function autoReasonOf(checks, pre = '') {
  const r = readJson(checks?.[REASON_KEY(pre)]);
  return r && r.auto === true && r.editor ? r : null;
}
