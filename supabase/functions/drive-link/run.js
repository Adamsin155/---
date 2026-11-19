// The drive-link function's work (docs/ops.md, section 143), free of Deno APIs so node tests run it
// whole (tests/drive-autolink.test.mjs). One run every three hours in the day (pg_cron,
// public.drive_link_tick):
//   1. the main clients folder (app_settings 'drive_clients_folder'), its folders (one level);
//   2. the clients with an empty Drive link and the folders nobody is linked to
//      (app/drive-autolink-logic.js autolinkWork);
//   3. Claude reads only the names and answers by meaning; the answer is checked (checkAnswer);
//   4. a sure folder is linked (public.drive_link_auto: into an empty link only); unsure ones are
//      kept for Irit's pick, once per set of folders (the reminder rule driveAsk tells her and the owners).
// Only counts and short codes are returned and logged: never a name, never the key.
import { autolinkWork, autolinkPayload, autolinkRequest, answerOf, checkAnswer, autolinkActions } from '../_shared/app/drive-autolink-logic.js';

// store: { mainFolder() → id|null, clients() → [{ id, name, business, status, archived_at, links }],
//          states() → [{ client_id, status, ask_key }], link(clientId, folderId, name) → boolean,
//          ask(row) }
// drive: { folders(folderId) → [{ id, name }] }
// ai: { ask(request) → message } | null (no ANTHROPIC_API_KEY: nothing is matched)
export async function runAutolink({ store, drive, ai, log = () => {} }) {
  const stats = { clients: 0, folders: 0, linked: 0, asked: 0, skipped: null };
  const main = await store.mainFolder();
  if (!main) return { ...stats, skipped: 'no_folder' };
  if (!ai) return { ...stats, skipped: 'no_ai' };
  const [clients, folders] = await Promise.all([store.clients(), drive.folders(main)]);
  const work = autolinkWork(clients, folders);
  stats.clients = work.clients.length;
  stats.folders = work.folders.length;
  if (!work.clients.length || !work.folders.length) return stats;
  let message;
  try {
    message = await ai.ask(autolinkRequest(autolinkPayload(work)));
  } catch (e) {
    log(`drive-link: the AI failed (${String(e?.status || e?.name || 'error').slice(0, 30)})`);
    return { ...stats, skipped: 'ai_failed' };
  }
  const answer = answerOf(message);
  if (!answer) return { ...stats, skipped: 'ai_no_answer' };
  const states = new Map((await store.states()).map((s) => [s.client_id, s]));
  for (const a of autolinkActions(checkAnswer(answer, work), states)) {
    if (a.act === 'link') {
      if (await store.link(a.client.id, a.folder.id, a.folder.name)) stats.linked += 1;
    } else {
      await store.ask({ client_id: a.client.id, status: 'ask', candidates: a.candidates, ask_key: a.key, folder_id: null, folder_name: null, by_email: '' });
      stats.asked += 1;
    }
  }
  return stats;
}
