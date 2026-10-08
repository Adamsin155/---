// What "המשימות שלי" reads for its counted lines only (app/mine-flow.js; docs/ops.md,
// section 46): the rows of the queues that are worked on another page. Each person is
// asked only for what their own lines count (flowNeeds), in parallel with the rest of
// the page's first rows, so the lines are in the list when it is first shown. A load
// that fails gives null and its line is simply not drawn: the page never waits on it
// for more than the request itself, and never breaks for it.
import { supabase } from './supa.js';
import { loadAccessRows, loadChangeRequests } from './office-data.js';
import { loadMessagesSince } from './owner-data.js';
import { askOf } from './availability-logic.js';
import { atTimeIL } from './tz.js';

const LOADERS = {
  // Lior: the logins (status only is used) and Ofir's change requests.
  access: () => loadAccessRows(),
  requests: () => loadChangeRequests(),
  // Irit: who already got a message today.
  messages: ({ now }) => loadMessagesSince(atTimeIL(now, 0).toISOString()),
  // The photographer's free dates of next month: was the month handed in.
  availability: async ({ now }) => {
    const ask = askOf(now);
    const { data, error } = await supabase.from('photographer_months').select('person, month').gte('month', `${ask.month}-01`).lte('month', `${ask.month}-01`);
    if (error) throw error;
    return { months: data || [] };
  },
  // Ofir: is Lior on a shoot day now (the engine's own rule; loaded only for him).
  liorShoot: async ({ now, clients, checks, stateOf }) => {
    const { liorShoot } = await import('./reminder-engine.js');
    const live = clients.filter((c) => c.status === 'active' || c.status === 'ending');
    return liorShoot({ now, clients: live, checksOf: (c) => checks[c.id] || {}, stateOf }).active;
  },
};

// { name: rows | null } for the names asked for.
export async function loadFlowExtra(needs, ctx) {
  const got = await Promise.allSettled(needs.map((n) => LOADERS[n](ctx)));
  return Object.fromEntries(needs.map((n, i) => [n, got[i].status === 'fulfilled' ? got[i].value : null]));
}
