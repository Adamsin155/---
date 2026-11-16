// The gfx-auto function's work (docs/ops.md, section 138), free of Deno APIs so node tests run it
// whole (tests/gfx-auto-run.test.mjs). One hourly run (pg_cron, public.gfx_auto_tick):
//   1. every open task of a graphics person on a client that the rules can judge
//      (app/gfx-auto-logic.js judge): closed when the Drive or the Gantt shows the work, else its
//      progress ("4 מתוך 10") is written;
//   2. the fix tasks (stage 3), only when `ai` is given (GFX_AI=on, the Drive's read scope and the
//      Anthropic key): new graphics images since the task, not checked before, go to Claude with the
//      task's notes; every note fixed closes the task, a note not fixed is kept for rule `gfxFix`.
// Only counts and short codes are returned and logged: never a file's name or content, never the key.
import {
  judged, judge, kindOf, driveSince, isHighlightFolder, AI, AI_IMAGES, AI_MODEL, aiRequest, aiVerdicts, aiOutcome, aiCloseNote,
} from '../_shared/app/gfx-auto-logic.js';
import { fileClass, folderIdOf } from '../_shared/drive.js';
import { dayKeyIL, atTimeIL } from '../_shared/app/tz.js';
import { readAnswer, toBase64, failureOf } from '../contract-ai/handler.js';

const since = (t) => t.auto_reopened_at || t.created_at;
const byClient = (rows) => {
  const m = new Map();
  for (const r of rows || []) { if (!m.has(r.client_id)) m.set(r.client_id, []); m.get(r.client_id).push(r); }
  return m;
};

// store: { openTasks(), drive(clientIds, fromDay), gantt(clientIds), close(id, note, n), progress(id, n),
//          drives(clientIds) → Map(id → drive link), checks(taskIds), checksSince(iso) → n, saveCheck(row) }
// ai (optional): { list(folderId, sinceIso) → { files }, download(fileId, { maxBytes }) → bytes,
//                  ask(request) → message, Errors }
export async function runGfx({ store, now = new Date(), ai = null, log = () => {} }) {
  const stats = { tasks: 0, closed: 0, progress: 0, fix: 0, checked: 0, aiClosed: 0, missing: 0, aiFailed: 0, ai: ai ? 'on' : 'off' };
  const tasks = (await store.openTasks()).filter(judged);
  stats.tasks = tasks.length;
  if (!tasks.length) return stats;
  const clients = [...new Set(tasks.map((t) => t.client_id))];
  const fromDay = tasks.map((t) => dayKeyIL(new Date(since(t)))).sort()[0];
  const drive = byClient(await store.drive(clients, fromDay));
  const gantt = byClient(await store.gantt(clients));
  const fixes = [];
  for (const t of tasks.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (kindOf(t) === 'fix') { fixes.push(t); continue; }
    const r = judge(t, { drive: drive.get(t.client_id) || [], gantt: gantt.get(t.client_id) || [] });
    if (r.close) {
      if (await store.close(t.id, r.note, r.n)) stats.closed += 1;
    } else if (Number(t.gfx_count) > 0 && r.n !== (Number(t.gfx_done) || 0)) {
      await store.progress(t.id, r.n);
      stats.progress += 1;
    }
  }
  stats.fix = fixes.length;
  if (!ai || !fixes.length) return stats;
  await checkFixes({ store, ai, fixes, drive, now, stats, log });
  return stats;
}

// Stage 3, within its caps (AI in the rules): a run, a day, a task a day.
async function checkFixes({ store, ai, fixes, drive, now, stats, log }) {
  const dayStart = atTimeIL(now, 0).toISOString();
  let today = await store.checksSince(dayStart);
  // Only a task with new graphics in the Drive's counts since it was given (cheap: no Google call).
  const due = fixes.filter((t) => driveSince(drive.get(t.client_id) || [], since(t), t.auto_reopened_at ? t.auto_reopen_base : t.gfx_base).files > 0);
  if (!due.length) return;
  const checks = await store.checks(due.map((t) => t.id));
  const links = await store.drives([...new Set(due.map((t) => t.client_id))]);
  let ran = 0;
  for (const t of due) {
    if (ran >= AI.perRun || today >= AI.perDay) break;
    const mine = checks.filter((c) => c.task_id === t.id);
    if (mine.filter((c) => c.created_at >= dayStart).length >= AI.perTaskDay) continue;
    const seen = new Set(mine.filter((c) => c.status !== 'error').flatMap((c) => c.files || []));
    const folder = folderIdOf(links.get(t.client_id));
    if (!folder) continue;
    let files;
    try {
      ({ files } = await ai.list(folder, new Date(since(t)).toISOString()));
    } catch (e) {
      log(`gfx-auto: the Drive of a client did not open (${e?.code || 'error'})`);
      continue;
    }
    const from = new Date(since(t)).getTime();
    const fresh = (files || [])
      .filter((f) => f.id && !seen.has(f.id) && fileClass(f.mimeType, f.path) === 'graphic' && !isHighlightFolder(f.path)
        && AI_IMAGES.includes(String(f.mimeType)) && new Date(f.createdTime).getTime() > from && !(Number(f.size) > AI.maxImageBytes))
      .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
      .slice(0, AI.maxImages);
    if (!fresh.length) continue;
    const images = [];
    for (const f of fresh) {
      try {
        images.push({ id: f.id, mime: f.mimeType, base64: toBase64(await ai.download(f.id, { maxBytes: AI.maxImageBytes })) });
      } catch (e) {
        log(`gfx-auto: a file did not download (${e?.code || 'error'})`);
      }
    }
    if (!images.length) continue;
    ran += 1;
    today += 1;
    stats.checked += 1;
    const ids = images.map((im) => im.id);
    let message;
    try {
      message = await ai.ask(aiRequest(t, images));
    } catch (err) {
      const f = failureOf(err, ai.Errors);
      log(`gfx-auto: ${f.error} (${err?.status ?? err?.name ?? 'error'})`);
      await store.saveCheck({ task_id: t.id, files: ids, status: 'error', result: { error: f.error, http: err?.status ?? null }, model: AI_MODEL });
      stats.aiFailed += 1;
      if (f.error === 'ai_not_configured' || f.error === 'ai_busy') break;
      continue;
    }
    const answer = readAnswer(message);
    if (answer.error) {
      await store.saveCheck({ task_id: t.id, files: ids, status: 'error', result: { error: answer.error, stop: message?.stop_reason ?? null }, model: message?.model ?? AI_MODEL });
      stats.aiFailed += 1;
      continue;
    }
    const verdicts = aiVerdicts(answer.raw);
    const outcome = aiOutcome(verdicts);
    await store.saveCheck({ task_id: t.id, files: ids, status: outcome, result: verdicts, model: message?.model ?? AI_MODEL });
    if (outcome === 'done') {
      if (await store.close(t.id, aiCloseNote(ids.length), null)) stats.aiClosed += 1;
    } else if (outcome === 'missing') stats.missing += 1;
  }
}
