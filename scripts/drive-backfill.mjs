// The one-time Drive back-scan (docs/ops.md, section 140): calls the drive-scan function with
// { backfill: true, after } again and again, each call a part of the clients, until it says done.
// The cron secret is read from the environment only, never printed:
//   CRON_SECRET=<the value of reminders_cron_secret in Vault> node scripts/drive-backfill.mjs
// Optional: AFTER=<client id> to go on from where a run stopped (the last "next" it printed).
const URL_ = 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/drive-scan';
const secret = process.env.CRON_SECRET || '';
if (!secret) { console.error('CRON_SECRET is not set.'); process.exit(1); }
let after = process.env.AFTER || null;
const total = { calls: 0, clients: 0, files: 0, failed: 0 };
const started = Date.now();
for (;;) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify({ backfill: true, after }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`stopped: ${res.status} ${body.error || ''}. Go on with AFTER=${after || ''}`); process.exit(1); }
  total.calls += 1; total.clients += body.clients; total.files += body.files; total.failed += body.failed;
  console.log(`call ${total.calls}: ${body.clients} clients, ${body.failed} failed, ${body.left} left, next=${body.next}`);
  if (body.done) break;
  if (body.next === after) { console.error('no progress; stopping.'); process.exit(1); }
  after = body.next;
}
console.log(`done: ${total.calls} calls, ${total.clients} clients, ${total.files} files, ${total.failed} failed, ${Math.round((Date.now() - started) / 1000)}s`);
