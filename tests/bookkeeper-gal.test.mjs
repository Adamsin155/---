// Gal, the office's bookkeeper (the owner's request of 16.11.2026; docs/ops.md, section 137), without
// a browser. Invented names and numbers only.
//   - the logic (app/bookkeeper-logic.js): the amounts with VAT as she reads them and as the copy
//     button gives them, "—" and a note when nothing is written (never a guess), where an amount comes
//     from, the search (names, ח.פ, phone with or without dashes, email), the count, the order;
//   - who she is: one screen in the menu, no bar, her landing from any page, no calendar, no bot, no
//     tasks, notes or notifications, on the team screen (to add her login) and in the team function;
//   - the statuses and VAT the database function uses are the app's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moneyWords, moneyCopy, clientOf, search, sortClients, countWords, FIELDS, WHY_WORDS, SOURCE_WORDS, DASH } from '../app/bookkeeper-logic.js';
import { PEOPLE, STAFF_PEOPLE, TEAM_PEOPLE, ASSIGNABLE_PEOPLE, CLIENT_STATUS, scopeOf, isBookkeeper, isSilent, oneScreenOf } from '../app/protocol.js';
import { menuOf, barOf, homeHref, homeLink, afterSignIn } from '../app/shell-rules.js';
import { seesCalendar } from '../app/calendar-view.js';
import { ASSIGNEES } from '../app/staff-tasks-logic.js';
import { NOTE_PEOPLE } from '../app/staff-notes-logic.js';
import { canAsk, mayAsk } from '../app/ask-logic.js';
import { landingOf } from '../app/deal-logic.js';
import { firstScreenOf } from '../app/office-ui.js';
import { REMINDER_PEOPLE } from '../app/reminder-rules.js';
import { VAT_RATE_PERCENT } from '../app/catalog.js';
import { PERSONS, OFFICE_PERSONS } from '../supabase/functions/staff-admin/rules.js';

const SQL = readFileSync(new URL('../supabase/migrations/20261215100000_bookkeeper_gal.sql', import.meta.url), 'utf8');
const row = (o = {}) => ({
  contact_name: 'דנה כהן', business: 'אלף יוגה', company_id: '512345678', phone: '050-1234567', email: 'alef@example.test', status: 'active',
  monthly_agorot: 531000, total_agorot: 6372000, months: 12, source: 'legacy', why: null, ...o,
});

test('the amounts: shekels with VAT as she reads them; the bare number on the clipboard', () => {
  assert.equal(moneyWords(531000), '5,310 ₪');
  assert.equal(moneyWords(6372000), '63,720 ₪');
  assert.equal(moneyWords(472050), '4,720.50 ₪');
  assert.equal(moneyCopy(531000), '5310');
  assert.equal(moneyCopy(472050), '4720.50');
  assert.equal(moneyCopy(6372000), '63720');
  for (const none of [null, undefined, '']) { assert.equal(moneyWords(none), null); assert.equal(moneyCopy(none), null); }
  // Postgres bigint comes back as a string through the API.
  assert.equal(moneyWords('590000'), '5,900 ₪');
});

test('a card: every field with its copy value; "—" and no copy for an empty one; the months and the source', () => {
  const c = clientOf(row());
  assert.equal(c.title, 'אלף יוגה');
  assert.deepEqual(FIELDS.map((f) => f.label), ['שם', 'שם העסק לחשבונית', 'ח.פ', 'טלפון', 'מייל', 'לחודש כולל מע״מ', 'לכל החוזה כולל מע״מ']);
  assert.deepEqual(c.fields.company_id, { text: '512345678', copy: '512345678' });
  assert.deepEqual(c.fields.monthly, { text: '5,310 ₪', copy: '5310' });
  assert.deepEqual(c.fields.total, { text: '63,720 ₪', copy: '63720' });
  assert.equal(c.months, 12);
  assert.equal(c.source, SOURCE_WORDS.legacy);
  assert.equal(c.note, null);
  assert.equal(c.ending, false);
  const bare = clientOf(row({ business: '  ', company_id: null, email: '', monthly_agorot: null, total_agorot: null, months: null, source: null, why: 'none' }));
  assert.equal(bare.title, 'דנה כהן', 'no business: the contact\'s name');
  for (const k of ['business', 'company_id', 'email', 'monthly', 'total']) assert.deepEqual(bare.fields[k], { text: null, copy: null }, k);
  assert.equal(bare.note, WHY_WORDS.none);
  assert.match(bare.note, /אין סכום/);
  assert.equal(DASH, '—');
  const ending = clientOf(row({ status: 'ending' }));
  assert.equal(ending.ending, true);
  assert.equal(ending.statusText, 'מסיים התקשרות');
  // A monthly price without a whole-contract total: the note says why; nothing is made up.
  const odd = clientOf(row({ total_agorot: null, months: null, source: 'payments', why: 'unclear' }));
  assert.deepEqual(odd.fields.total, { text: null, copy: null });
  assert.equal(odd.fields.monthly.text, '5,310 ₪');
  assert.match(odd.note, /לא מתאים/);
  for (const why of ['no_term', 'no_total', 'no_monthly']) assert.ok(clientOf(row({ why })).note, why);
});

test('the search: names, the business, ח.פ, the phone with or without a dash, the email; every word must match', () => {
  const list = sortClients([
    row(),
    row({ contact_name: 'רון לוי', business: 'בית הקפה של רון', company_id: '036666666', phone: '052-7654321', email: 'ron@example.test' }),
    row({ contact_name: 'מאיה', business: 'גן "מאיה"', company_id: null, phone: null, email: null }),
  ].map(clientOf));
  assert.deepEqual(list.map((c) => c.title), ['אלף יוגה', 'בית הקפה של רון', 'גן "מאיה"']);
  const titles = (q) => search(list, q).map((c) => c.title);
  assert.equal(search(list, '').length, 3);
  assert.equal(search(list, '   ').length, 3);
  assert.deepEqual(titles('רון'), ['בית הקפה של רון']);
  assert.deepEqual(titles('קפה רון'), ['בית הקפה של רון']);
  assert.deepEqual(titles('קפה דנה'), []);
  assert.deepEqual(titles('0366'), ['בית הקפה של רון']);
  assert.deepEqual(titles('0527654321'), ['בית הקפה של רון']);
  assert.deepEqual(titles('052-765'), ['בית הקפה של רון']);
  assert.deepEqual(titles('ALEF@'), ['אלף יוגה']);
  assert.deepEqual(titles('גן מאיה'), ['גן "מאיה"']);
  assert.equal(countWords(3, 3), '3 לקוחות פעילים');
  assert.equal(countWords(1, 1), 'לקוח פעיל אחד');
  assert.equal(countWords(1, 3), '1 מתוך 3 לקוחות');
  assert.equal(countWords(0, 3), 'לא נמצא לקוח');
  assert.equal(countWords(0, 0), '');
});

test('who she is: one screen, her landing from anywhere, nothing else of the system', () => {
  assert.equal(PEOPLE.gal.name, 'גל');
  assert.equal(PEOPLE.gal.role, 'מנהלת חשבונות');
  assert.equal(isBookkeeper('gal'), true);
  assert.equal(isBookkeeper('tal'), false);
  assert.equal(scopeOf('gal'), 'bookkeeper');
  const v = { me: 'gal', scope: 'bookkeeper', error: null };
  assert.deepEqual(menuOf(v), [{ id: 'bookkeeper', href: 'bookkeeper.html', label: 'לקוחות לחשבוניות' }]);
  assert.deepEqual(barOf(menuOf(v), v), { bar: [], more: [] });
  assert.equal(homeHref(v), 'bookkeeper.html');
  assert.equal(homeLink(v).label, 'מעבר ללקוחות לחשבוניות');
  assert.deepEqual(afterSignIn(v, { pathname: '/clients.html' }), { go: 'bookkeeper.html' });
  assert.equal(landingOf('gal'), 'bookkeeper.html');
  assert.equal(firstScreenOf('gal'), 'bookkeeper.html');
  assert.equal(oneScreenOf('gal'), 'bookkeeper.html');
  assert.equal(oneScreenOf('tal'), 'makeup.html');
  assert.equal(oneScreenOf('lior'), null);
  assert.equal(seesCalendar(v), false);
  assert.equal(canAsk(v), false);
  assert.equal(mayAsk({ office: false, person: 'gal' }), false);
  // No task, note, decision or notification; not in anyone's digest or the 19:00 table.
  assert.ok(!STAFF_PEOPLE().some((p) => p.key === 'gal'));
  assert.ok(!ASSIGNABLE_PEOPLE().some((p) => p.key === 'gal'));
  assert.ok(!ASSIGNEES().some((p) => p.key === 'gal'));
  assert.ok(!NOTE_PEOPLE().some((p) => p.key === 'gal'));
  assert.equal(isSilent('gal'), true);
  assert.equal(REMINDER_PEOPLE.has('gal'), false);
  // On the team screen, to add her login; the team function stores her row; not the office.
  assert.ok(TEAM_PEOPLE().some((p) => p.key === 'gal'));
  assert.ok(PERSONS.includes('gal'));
  assert.ok(!OFFICE_PERSONS.includes('gal'));
  // Nobody else changed: Tal keeps hers, an editor keeps "המשימות שלי".
  assert.equal(homeHref({ me: 'tal', scope: 'makeup', error: null }), 'makeup.html');
  assert.equal(homeHref({ me: 'nadia', scope: 'own', error: null }), 'clients.html#mine');
  assert.equal(menuOf({ me: 'lior', scope: 'office', error: null }).some((i) => i.id === 'bookkeeper'), false);
});

test('the database function: the app\'s VAT and statuses, her key, and her page\'s single call', () => {
  assert.equal(VAT_RATE_PERCENT, 18);
  assert.match(SQL, /\* 1\.18\)/);
  assert.match(SQL, /c\.status in \('active', 'ending'\) and c\.archived_at is null/);
  assert.deepEqual(['active', 'ending'].map((s) => CLIENT_STATUS[s]), ['פעיל', 'מסיים התקשרות']);
  assert.match(SQL, /array\['gal'\]::text\[\]/);
  assert.match(SQL, /revoke all on function public\.bookkeeper_clients\(\) from public, anon, authenticated;\s*grant execute on function public\.bookkeeper_clients\(\) to authenticated;/);
  // Her page reads the one function and no table.
  const data = readFileSync(new URL('../app/bookkeeper-data.js', import.meta.url), 'utf8');
  assert.match(data, /rpc\('bookkeeper_clients'\)/);
  assert.doesNotMatch(data, /\.from\(/);
  const page = readFileSync(new URL('../app/bookkeeper.js', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /supabase|\.from\(|push/);
});
