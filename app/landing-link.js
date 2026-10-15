// The personal link to the taking-in (intake-link.html; the owner, 15.10.2026): the intake
// screen of one person, opened by a token in the address, with no sign-in, no menu and
// nothing else of the system. The token is checked by the database on every read and
// write (supabase/migrations/20261027100000_landing_links.sql); the screen is the
// signed-in one (app/landing-ui.js), started with the link's own reads and writes.
import { PEOPLE } from './protocol.js';
import { $, formatDay } from './protocol-ui.js';
import { linkRead, linkTake, tokenOf } from './landing-data.js';
import { startLink } from './landing-ui.js';

function refuse() {
  $('state').textContent = '';
  $('land-page').hidden = true;
  $('no-access').hidden = false;
  $('app').hidden = false;
}

async function boot() {
  const token = tokenOf(location.hash);
  if (!token) { refuse(); return; }
  let first;
  try {
    first = await linkRead(token);
  } catch {
    refuse();
    return;
  }
  const person = first.person;
  const name = PEOPLE[person]?.name || '';
  $('land-hello').textContent = `${name ? `שלום ${name}. ` : ''}זה הקישור האישי שלך לקליטה${first.expires_at ? `, והוא פעיל עד ${formatDay(first.expires_at)}` : ''}. אין צורך בסיסמה.`;
  $('app').hidden = false;
  let pending = first;
  await startLink(person, {
    // The first read is the one just made; every later one asks again.
    load: async () => { if (pending) { const r = pending; pending = null; return r; } return linkRead(token); },
    take: (id, marks, done, waiting) => linkTake(token, id, marks, done, waiting),
  });
}

boot();
