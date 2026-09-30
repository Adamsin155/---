// The reminder engine's second channel (stage 4): a WhatsApp copy of the rings and
// digests a tick sends, for whoever agreed to it. No Deno APIs, like ./tick.js:
// ./wa-server.ts passes the database adapter and the sender, and
// tests/whatsapp.test.mjs passes fakes of both.
//
// It adds nothing to what push sends: the rows are the ones the tick already chose
// (sending hours, the daily cap, Lior's shoot day, the log's dedupe). Each row goes
// out on WhatsApp at most once: public.whatsapp_messages has one row per
// reminder_log row, claimed before sending (a row a later tick takes again finds
// its claim). A claim whose send never finished (the tick died) is marked failed
// after WA_LOST, never sent twice.
import { waPlan } from '../_shared/app/wa-logic.js';
import { templateMessage, taskIdOf } from '../_shared/app/wa-templates.js';

export const WA_LOST = 10 * 6e4;
const PARALLEL = 5;

/**
 * @param {{ db: { claim: (row: object) => Promise<object | null>, update: (id: number, patch: object) => Promise<void>, expire: (before: Date) => Promise<number> },
 *   send: (message: object) => Promise<{ ok: boolean, id?: string, status?: number, error?: string }>,
 *   recipients: Map<string, { email: string, phone: string }> }} args
 */
export function makeWhatsapp({ db, send, recipients }) {
  async function one({ row, kind }, { tasks, now, stats }) {
    const recipient = recipients.get(row.person);
    const plan = waPlan({ row, kind, now, recipient, task: tasks.get(taskIdOf(row)) || null });
    if (plan.skip) {
      if (plan.skip === 'quiet_hours') stats.waQuiet += 1;
      return;
    }
    try {
      const claimed = await db.claim({ log_id: row.id, person: row.person, email: recipient.email, phone: plan.to, template: plan.template, status: 'pending' });
      if (!claimed) return; // this reminder already went out on WhatsApp
      const res = await send(templateMessage({ template: plan.template, to: plan.to, row })).catch(() => ({ ok: false, status: 0, error: 'error' }));
      if (res.ok) {
        await db.update(claimed.id, { status: 'sent', wa_message_id: res.id, sent_at: now.toISOString() });
        stats.waSent += 1;
      } else {
        await db.update(claimed.id, { status: 'failed', error: String(res.error || 'error').slice(0, 200), failed_at: now.toISOString() });
        stats.waFailed += 1;
      }
    } catch (err) {
      stats.waErrors += 1;
      console.error('reminders: a WhatsApp send was not recorded', row.rule, err?.code || err?.name || 'error');
    }
  }
  return {
    async deliver({ sends, env, now, stats }) {
      Object.assign(stats, { waSent: 0, waFailed: 0, waQuiet: 0, waErrors: 0, waLost: 0 });
      try {
        stats.waLost = await db.expire(new Date(now.getTime() - WA_LOST));
      } catch (err) {
        stats.waErrors += 1;
        console.error('reminders: WhatsApp cleanup failed', err?.code || err?.name || 'error');
      }
      const tasks = new Map([...(env.tasks || []), ...(env.doneTasks || [])].map((t) => [t.id, t]));
      for (let i = 0; i < sends.length; i += PARALLEL) {
        await Promise.all(sends.slice(i, i + PARALLEL).map((s) => one(s, { tasks, now, stats })));
      }
      return stats;
    },
  };
}
