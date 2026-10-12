// The WhatsApp channel through Jako (docs/ops.md, section 63), and its opt-out by
// reply. No Deno APIs, like ./whatsapp.js: ./wa-server.ts passes the database
// adapters and the Jako client (../_shared/wa-jako.js), tests/whatsapp.test.mjs fakes.
//
// Every template's footer promises "להפסקה: השב/י הסר". With Meta the webhook hears
// the reply at once. Jako has no webhook to register, so the tick asks Jako what each
// person who agreed wrote since the last time: each person at most once in
// POLL_EVERY, at most POLL_MAX people in a tick (public.whatsapp_poll_due chooses
// them and keeps the times), before the tick's own messages go out, so someone who
// wrote "הסר" gets nothing more from this tick on. A stop word withdraws the consent
// through the same database function as the webhook (public.whatsapp_apply, op
// 'withdraw': withdrawn_via = 'whatsapp'). Nothing of what people write is stored.
import { makeWhatsapp } from './whatsapp.js';
import { isStop } from '../_shared/app/wa-logic.js';
import { jakoMessage, jakoTemplateFor, jakoUserId } from '../_shared/app/wa-templates.js';

export const POLL_EVERY = 5 * 6e4;
export const POLL_MAX = 5;
// Jako answers for the last month only.
const POLL_BACK = 29 * 864e5;

/**
 * @param {{ db: { due: (max: number, everyMs: number) => Promise<{ email: string, person: string, phone: string, since: string }[]>,
 *     done: (email: string, until: Date) => Promise<void>, stop: (args: { inbound: string, from: string }) => Promise<string> },
 *   incoming: (args: { userId: string, since: Date, until: Date }) => Promise<any>,
 *   recipients: Map<string, { email: string, phone: string }> }} args
 */
export function makeStopPoll({ db, incoming, recipients }) {
  async function one(p, { now, stats }) {
    try {
      const since = new Date(Math.max(new Date(p.since).getTime() || 0, now.getTime() - POLL_BACK));
      const res = await incoming({ userId: jakoUserId(p.phone), since, until: now });
      // Not read: the next poll asks from the same moment again.
      if (!res.ok) { stats.waPollErrors += 1; return; }
      stats.waPolled += 1;
      const stop = res.messages.find((m) => isStop(m.text));
      if (stop) {
        const result = await db.stop({ inbound: `jako:${p.person}:${stop.id}`.slice(0, 200), from: p.phone });
        if (result === 'withdrawn') {
          stats.waStops += 1;
          recipients.delete(p.person);
        }
      }
      await db.done(p.email, now);
    } catch (err) {
      stats.waPollErrors += 1;
      console.error('reminders: a WhatsApp reply check failed', err?.code || err?.name || 'error');
    }
  }
  return async function poll({ now, stats }) {
    Object.assign(stats, { waPolled: 0, waStops: 0, waPollErrors: 0 });
    let due = [];
    try {
      due = await db.due(POLL_MAX, POLL_EVERY);
    } catch (err) {
      stats.waPollErrors += 1;
      console.error('reminders: the WhatsApp reply check could not start', err?.code || err?.name || 'error');
    }
    await Promise.all(due.slice(0, POLL_MAX).map((p) => one(p, { now, stats })));
  };
}

/**
 * The channel `runTick({ wa })` takes, for provider 'jako': the replies first, then
 * the same rows as with Meta, sent as Jako's three templates. `flows`: { done, onit },
 * the ns of the sub flow each quick reply starts (public.whatsapp_provider).
 * @param {{ db: any, pollDb: any, jako: { begin: () => void, send: (m: object) => Promise<any>, incoming: (a: any) => Promise<any> },
 *   recipients: Map<string, { email: string, phone: string }>, flows?: { done?: string | null, onit?: string | null } }} args
 */
export function makeJakoWhatsapp({ db, pollDb, jako, recipients, flows = {} }) {
  const channel = makeWhatsapp({ db, send: jako.send, recipients, message: (args) => jakoMessage({ ...args, flows }), provider: 'jako', pick: jakoTemplateFor });
  const poll = makeStopPoll({ db: pollDb, incoming: jako.incoming, recipients });
  return {
    async deliver(args) {
      jako.begin(); // one time budget for everything this tick asks of Jako
      await poll(args);
      return channel.deliver(args);
    },
  };
}
