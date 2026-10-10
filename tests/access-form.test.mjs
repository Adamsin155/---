// The client's logins form (app/access-logic.js; the owner's request of 6.10.2026):
// the link and its states, what the page checks before it lets the client send, what
// goes to the database (never a password the choice does not need), the mapping to
// the vault's statuses and what follows (Ilai's check is not done by a status the
// client gave), the welcome message with the link, the nudge, and the two reminder
// rules. `npm test` runs this under UTC, America/New_York and Asia/Jerusalem.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKEN, LINK_DAYS, accessUrl, tokenFrom, insecure, secureUrl, redactAccessLinks, hasRedactedLink, linkState, linkStateText, currentLink, waitingLink,
  REQUIRED, EXTRA_PLATFORMS, CHOICES, STATUS_OF, ACCESS_STATUS_LABEL, CLIENT_BY, CLIENT_BY_NAME, byClient, MAX_ENTRIES, emptyForm, canAddExtra,
  mainProblems, extraProblems, formProblems, waitingText, buildPayload, payloadProblem, summaryOf, confirmLines, summaryText, sentFor,
  PAGE_TEXT, CLOSED_TEXT, accessLinkMessage, accessLine, ACCESS_FALLBACK, withAccessVar, accessVars,
} from '../app/access-logic.js';
import { nudgeTimes, nudgeRef, nudgeDue, NUDGE_KEY } from '../app/access-nudge.js';
import { suggestFor, dayQueue, templatesByKey, messageText, unfilledIn, unknownVars, templateVars, DEFAULT_TEMPLATES } from '../app/messages-logic.js';
import { accessChecked, toCheck } from '../app/ilai-logic.js';
import { shootPrep } from '../app/shoot-prep.js';
import { clientState } from '../app/protocol-logic.js';
import { computeReminders } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const TOK = 'Ab3_'.repeat(10) + 'xY-';
const T = templatesByKey();

// ── The link ────────────────────────────────
test('the link: the token rides in the fragment; an http address is refused; a kept text loses the token', () => {
  assert.equal(TOK.length, 43);
  assert.ok(TOKEN.test(TOK));
  const url = accessUrl('https://app.astrateg.tech/client.html?id=7#access', TOK);
  assert.equal(url, `https://app.astrateg.tech/access.html#t=${TOK}`);
  assert.equal(accessUrl('https://adamsin155.github.io/---/messages.html', TOK), `https://adamsin155.github.io/---/access.html#t=${TOK}`);
  // The page reads the fragment, and an address with ?t= as well.
  assert.equal(tokenFrom(new URL(url)), TOK);
  assert.equal(tokenFrom({ hash: '', search: `?t=${TOK}` }), TOK);
  assert.equal(tokenFrom({ hash: '#other', search: '' }), '');
  assert.equal(tokenFrom(), '');
  // https only (a developer's own machine aside).
  assert.equal(insecure({ protocol: 'https:', hostname: 'app.astrateg.tech' }), false);
  assert.equal(insecure({ protocol: 'http:', hostname: 'app.astrateg.tech' }), true);
  assert.equal(insecure({ protocol: 'http:', hostname: 'localhost' }), false);
  assert.equal(insecure({ protocol: 'http:', hostname: '127.0.0.1' }), false);
  assert.equal(insecure({ protocol: 'http:', hostname: 'localhost.evil.example' }), true);
  assert.equal(secureUrl({ host: 'app.astrateg.tech', pathname: '/access.html', search: '', hash: `#t=${TOK}` }), url);
  // What is recorded of a sent message.
  const kept = redactAccessLinks(`היי דנה\n${accessLine(url)}\nתודה`);
  assert.ok(!kept.includes(TOK));
  assert.ok(kept.includes('https://app.astrateg.tech/access.html#t=…'));
  assert.ok(hasRedactedLink(kept) && !hasRedactedLink('היי'));
  assert.equal(redactAccessLinks(`x access.html?t=${TOK} y`), 'x access.html?t=… y');
  assert.equal(redactAccessLinks('status.html?t=abc'), 'status.html?t=abc');
});

test('where a link stands: none, waiting, filled, expired, revoked, locked; and the words of the card', () => {
  const now = IL(2026, 10, 8, 12);
  const made = { id: 'l1', created_at: IL(2026, 10, 6, 10).toISOString(), expires_at: IL(2026, 10, 20, 10).toISOString(), revoked_at: null, submitted_at: null, attempts: 0 };
  assert.equal(LINK_DAYS, 14);
  assert.equal(linkState(null, now), 'none');
  assert.equal(linkState(made, now), 'waiting');
  assert.equal(linkState({ ...made, submitted_at: IL(2026, 10, 7, 9, 5).toISOString() }, now), 'filled');
  assert.equal(linkState({ ...made, revoked_at: IL(2026, 10, 7).toISOString() }, now), 'revoked');
  assert.equal(linkState(made, IL(2026, 10, 20, 10)), 'expired');
  assert.equal(linkState({ ...made, attempts: 5 }, now), 'locked');
  // Filled wins over everything that came after it.
  assert.equal(linkState({ ...made, submitted_at: IL(2026, 10, 7).toISOString(), attempts: 5 }, IL(2026, 11, 1)), 'filled');
  assert.equal(linkStateText(null, now), 'עוד לא נוצר קישור.');
  assert.equal(linkStateText(made, now), 'ממתין ללקוח מאז 6.10.2026 · הקישור תקף עד 20.10.2026.');
  assert.equal(linkStateText({ ...made, submitted_at: IL(2026, 10, 7, 9, 5).toISOString() }, now), 'מולא ב־7.10.2026 בשעה 09:05.');
  assert.equal(linkStateText(made, IL(2026, 10, 21)), 'תוקף הקישור הסתיים ב־20.10.2026, והלקוח לא מילא.');
  assert.equal(linkStateText({ ...made, revoked_at: IL(2026, 10, 7).toISOString() }, now), 'הקישור בוטל ב־7.10.2026.');
  // The card shows the link that waits; else the one filled; else the newest.
  const filled = { ...made, id: 'l0', created_at: IL(2026, 10, 1).toISOString(), submitted_at: IL(2026, 10, 2).toISOString() };
  const revoked = { ...made, id: 'l2', created_at: IL(2026, 10, 7).toISOString(), revoked_at: IL(2026, 10, 7, 1).toISOString() };
  assert.equal(currentLink([filled, made], now).id, 'l1');
  assert.equal(currentLink([filled, revoked], now).id, 'l0');
  assert.equal(currentLink([revoked], now).id, 'l2');
  assert.equal(currentLink([], now), null);
  assert.equal(waitingLink([filled, revoked], now), null);
  assert.equal(waitingLink([filled, made], now).id, 'l1');
});

// ── The form ────────────────────────────────
test('the three mandatory cards: a login, "אין כיום, צריך לפתוח", or "יש, וצריך לחדש סיסמה"', () => {
  assert.deepEqual(REQUIRED, ['instagram', 'facebook', 'tiktok']);
  assert.deepEqual(CHOICES.map(([, l]) => l), ['יש לי פרטי כניסה', 'אין כיום, צריך לפתוח', 'יש, וצריך לחדש סיסמה']);
  assert.deepEqual(mainProblems({ choice: '' }), { choice: 'בחרו אחת משלוש האפשרויות.' });
  assert.deepEqual(mainProblems({ choice: 'have', username: '', password: '' }), { username: 'חסר שם משתמש.', password: 'חסרה סיסמה.' });
  assert.deepEqual(mainProblems({ choice: 'have', username: 'dana', password: '   ' }), { password: 'חסרה סיסמה.' });
  assert.deepEqual(mainProblems({ choice: 'have', username: 'dana', password: 'x' }), {});
  assert.deepEqual(mainProblems({ choice: 'none', username: '', password: '' }), {});
  assert.deepEqual(mainProblems({ choice: 'reset', username: '', password: '' }), {}); // the user name is optional
  assert.match(mainProblems({ choice: 'have', username: 'u'.repeat(201), password: 'x' }).username, /ארוך מדי/);
  assert.match(mainProblems({ choice: 'have', username: 'a\nb', password: 'x' }).username, /בשורה אחת/);
  assert.match(mainProblems({ choice: 'have', username: 'a', password: 'p'.repeat(201) }).password, /ארוכה מדי/);

  const f = emptyForm();
  let p = formProblems(f);
  assert.deepEqual([p.ok, p.mainOk, p.missing], [false, false, ['Instagram', 'Facebook', 'TikTok']]);
  assert.equal(waitingText(p.missing), 'כדי להמשיך חסר: Instagram, Facebook, TikTok.');
  f.main.instagram = { choice: 'have', username: 'dana_cafe', password: 'סוד1' };
  f.main.facebook = { choice: 'none', username: '', password: '' };
  p = formProblems(f);
  assert.deepEqual([p.mainOk, p.missing, Object.keys(p.errors)], [false, ['TikTok'], ['tiktok.choice']]);
  f.main.tiktok = { choice: 'reset', username: '', password: '' };
  p = formProblems(f);
  assert.deepEqual([p.ok, p.mainOk, p.missing, waitingText(p.missing)], [true, true, [], '']);
  assert.equal(payloadProblem(buildPayload(f)), null);
});

test('"הוספת פלטפורמה": a name, a user name and a password; no platform twice; up to 12 in all', () => {
  assert.deepEqual(EXTRA_PLATFORMS.map((x) => x.label), ['YouTube', 'Google Business', 'Meta Business', 'LinkedIn', 'אתר / דומיין', 'אחר']);
  assert.deepEqual(extraProblems({ platform: '', label: '', username: '', password: '' }), { platform: 'בחרו פלטפורמה.', username: 'חסר שם משתמש.', password: 'חסרה סיסמה.' });
  assert.deepEqual(extraProblems({ platform: 'custom', label: ' ', username: 'u', password: 'p' }), { label: 'כתבו את שם הפלטפורמה.' });
  assert.match(extraProblems({ platform: 'custom', label: 'x'.repeat(41), username: 'u', password: 'p' }).label, /עד 40 תווים/);
  assert.deepEqual(extraProblems({ platform: 'youtube', label: '', username: 'u', password: 'p' }), {});
  const yt = { id: 'x1', platform: 'youtube', label: '', username: 'u', password: 'p' };
  assert.deepEqual(extraProblems({ ...yt, id: 'x2' }, [yt]), { platform: 'הפלטפורמה הזו כבר ברשימה.' });
  const li = { id: 'x1', platform: 'linkedin', label: '', username: 'u', password: 'p' };
  assert.deepEqual(extraProblems({ id: 'x2', platform: 'custom', label: ' linkedin', username: 'u', password: 'p' }, [li]), { label: 'הפלטפורמה הזו כבר ברשימה.' });
  // One of the three mandatory ones typed by name: it has a card of its own.
  assert.deepEqual(extraProblems({ id: 'x2', platform: 'custom', label: 'TikTok', username: 'u', password: 'p' }), { label: 'הפלטפורמה הזו כבר ברשימה.' });

  const f = emptyForm();
  for (const n of REQUIRED) f.main[n] = { choice: 'none', username: '', password: '' };
  for (let i = 0; i < MAX_ENTRIES - 3; i += 1) {
    assert.equal(canAddExtra(f), true);
    f.extra.push({ id: `x${i}`, platform: 'custom', label: `פלטפורמה ${i}`, username: 'u', password: 'p' });
  }
  assert.equal(canAddExtra(f), false);
  assert.equal(formProblems(f).ok, true);
  const payload = buildPayload(f);
  assert.equal(payload.entries.length, 12);
  assert.equal(payloadProblem(payload), null);
  // An added card that is not finished keeps the form from being sent, with its own message.
  f.extra[0].password = '';
  assert.deepEqual(formProblems(f).errors, { 'x0.password': 'חסרה סיסמה.' });
  f.extra[0].password = 'p';
  f.notes = 'n'.repeat(301);
  assert.match(formProblems(f).errors.notes, /עד 300 תווים/);
});

test('what is sent: only what each choice needs; the summary and the confirmation never hold a password', () => {
  const f = emptyForm();
  f.main.instagram = { choice: 'have', username: '  dana_cafe ', password: ' Pa ss ' };
  f.main.facebook = { choice: 'none', username: 'typed-before', password: 'typed-before' };
  f.main.tiktok = { choice: 'reset', username: 'dana.tt', password: 'typed-before' };
  f.extra = [
    { id: 'x1', platform: 'google', label: '', username: 'dana@cafe.co.il', password: 'G-1' },
    { id: 'x2', platform: 'site', label: '', username: 'admin', password: 'W-1' },
    { id: 'x3', platform: 'custom', label: '  Pinterest ', username: 'dana', password: 'P-1' },
  ];
  f.notes = '  הקוד מגיע לדנה  ';
  const p = buildPayload(f);
  assert.deepEqual(p, {
    entries: [
      { network: 'instagram', label: null, choice: 'have', username: 'dana_cafe', password: ' Pa ss ' },
      { network: 'facebook', label: null, choice: 'none', username: null, password: null },
      { network: 'tiktok', label: null, choice: 'reset', username: 'dana.tt', password: null },
      { network: 'google', label: null, choice: 'have', username: 'dana@cafe.co.il', password: 'G-1' },
      { network: 'other', label: 'אתר / דומיין', choice: 'have', username: 'admin', password: 'W-1' },
      { network: 'other', label: 'Pinterest', choice: 'have', username: 'dana', password: 'P-1' },
    ],
    notes: 'הקוד מגיע לדנה',
  });
  assert.equal(payloadProblem(p), null);
  assert.ok(!JSON.stringify(p).includes('typed-before'));
  const summary = summaryOf(p);
  assert.deepEqual(summary[0], { network: 'instagram', label: null, choice: 'have' });
  const lines = confirmLines(p);
  assert.deepEqual(lines.map((l) => `${l.platform}: ${l.choice}${l.username ? ` (${l.username})` : ''}`), [
    'Instagram: יש לי פרטי כניסה (dana_cafe)', 'Facebook: אין כיום, צריך לפתוח', 'TikTok: יש, וצריך לחדש סיסמה (dana.tt)',
    'Google Business: יש לי פרטי כניסה (dana@cafe.co.il)', 'אתר / דומיין: יש לי פרטי כניסה (admin)', 'Pinterest: יש לי פרטי כניסה (dana)',
  ]);
  for (const kept of [JSON.stringify(summary), JSON.stringify(lines), summaryText(summary)]) {
    for (const secret of ['Pa ss', 'G-1', 'W-1', 'P-1']) assert.ok(!kept.includes(secret), secret);
  }
  assert.ok(!JSON.stringify(summary).includes('dana'), 'the summary keeps no user name either');
  assert.equal(summaryText(summary), 'Instagram, Google Business, אתר / דומיין, Pinterest: התקבלו פרטי כניסה · Facebook: אין כיום, צריך לפתוח · TikTok: צריך לחדש סיסמה');
  assert.deepEqual(sentFor(summary, 'tiktok'), { network: 'tiktok', label: null, choice: 'reset' });
  assert.equal(sentFor(summary, 'youtube'), null);
  assert.equal(sentFor(summary, 'other'), null);
});

test('the words of the page: reassuring, and a plain message for every dead link', () => {
  assert.match(PAGE_TEXT.points.join(' '), /מוצפנים/);
  assert.match(PAGE_TEXT.points.join(' '), /רק אנשי הצוות שמטפלים בחשבון/);
  assert.match(PAGE_TEXT.points.join(' '), /אי אפשר לקרוא את הפרטים מהדף הזה/);
  assert.match(PAGE_TEXT.notesWarn, /^אל תכתבו כאן סיסמאות./); // said on its own line since 6.10.2026 (ops.md 36)
  for (const k of ['invalid', 'expired', 'revoked', 'closed', 'locked', 'done', 'insecure', 'error']) assert.ok(CLOSED_TEXT[k][0], k);
  assert.deepEqual(CLOSED_TEXT.done, ['הפרטים התקבלו', '']);
  assert.equal(CLOSED_TEXT.insecure[0], 'פתחו את הקישור בכתובת מאובטחת');
  // Nothing internal on the client's page: no staff name.
  const all = JSON.stringify([PAGE_TEXT, CLOSED_TEXT]);
  for (const name of ['עירית', 'ליאור', 'אופיר', 'עילאי', 'כספת']) assert.ok(!all.includes(name), name);
});

// ── The vault ───────────────────────────────
test('the statuses: a login from the client is "new", and Ilai\'s check is not done by it', () => {
  assert.deepEqual(STATUS_OF, { have: 'new', none: 'missing', reset: 'broken' });
  assert.equal(ACCESS_STATUS_LABEL.new, 'התקבל מהלקוח, עוד לא נבדק');
  assert.deepEqual(Object.keys(ACCESS_STATUS_LABEL).sort(), ['broken', 'missing', 'new', 'ok']);
  assert.deepEqual([CLIENT_BY, CLIENT_BY_NAME], ['client-form', 'הלקוח (בטופס)']);
  const at = IL(2026, 10, 20, 12);
  const later = IL(2026, 10, 20, 12, 5).toISOString();
  const same = at.toISOString();
  // 'new' is never a check, whenever it was set.
  assert.equal(accessChecked([{ status: 'new', updated_at: later }, { status: 'ok', updated_at: later }], at), false);
  // What the client's form set ("אין כיום", "לחדש סיסמה"), at the very moment it marked 5, is the client's word.
  assert.equal(accessChecked([{ status: 'missing', updated_at: same, by_client: true }, { status: 'broken', updated_at: same, by_client: true }], at), false);
  assert.equal(accessChecked([{ status: 'missing', updated_at: same, updated_by: CLIENT_BY }], at), false);
  assert.equal(byClient({ updated_by: 'ofir@x' }), false);
  // Once Ilai (or anyone of the office) saved every row, it is checked, as before.
  assert.equal(accessChecked([{ status: 'ok', updated_at: later, by_client: false }, { status: 'missing', updated_at: later, updated_by: 'ilai@x' }], at), true);
  assert.deepEqual(toCheck([{ status: 'new', network: 'instagram' }, { status: 'ok', network: 'tiktok' }]).map((a) => a.network), ['instagram']);
});

test('before a shoot day: a login from the client that nobody checked is a blocker of Ilai\'s', () => {
  const c = { id: 'c1', name: 'דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], deal_at: IL(2026, 10, 1, 9).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 10).toISOString() };
  const now = IL(2026, 10, 12, 10);
  const prep = (access) => shootPrep(c, {}, clientState(c, {}, now), { tasks: [], access, now })[0];
  const none = prep([]);
  const withNew = prep([{ client_id: 'c1', network: 'instagram', status: 'new' }, { client_id: 'other', network: 'tiktok', status: 'new' }]);
  const added = withNew.blockers.filter((b) => !none.blockers.some((x) => x.id === b.id));
  assert.deepEqual(added.map((b) => [b.topic, b.text, b.who]), [['access', 'גישה מהלקוח שעוד לא נבדקה: Instagram', 'ilai']]);
});

// ── The welcome message ─────────────────────
const client = { id: 'c1', name: 'דנה', business: 'קפה דנה', phone: '050-1234567', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-14T10:00:00+03:00' };
const opened = { 'p02.opened': { state: 'done', at: '2026-10-11T09:10:00+03:00', note: null } };
const link = { id: 'aaaaaaaa-1111-4222-8333-444444444444', client_id: 'c1', created_at: '2026-10-11T09:20:00+03:00', expires_at: '2026-10-25T09:20:00+03:00', revoked_at: null, submitted_at: null, attempts: 0 };
const URL1 = `https://app.astrateg.tech/access.html#t=${TOK}`;

test('the welcome carries the link while it waits: one line, in the template\'s place', () => {
  const now = new Date('2026-10-11T10:00:00+03:00');
  const o = suggestFor(client, opened, [], now, null, { accessLinks: [link], accessUrl: URL1 }).options[0];
  assert.deepEqual([o.key, o.access, o.accessUrl], ['welcome', 'waiting', URL1]);
  const text = messageText(o, T);
  assert.ok(text.includes(`את הגישות לרשתות לא שולחים בהודעה.\nכדי שנוכל להתחיל, מלאו כאן את פרטי הכניסה לרשתות: ${URL1}\n\nבכל יום חמישי`), text);
  assert.equal(text.split(URL1).length, 2, 'the link once');
  assert.deepEqual(unfilledIn(text), []);
  assert.equal(accessLine(URL1), `כדי שנוכל להתחיל, מלאו כאן את פרטי הכניסה לרשתות: ${URL1}`);
  // The placeholder is one the system fills: the office may move it in the template.
  assert.ok(templateVars('welcome').includes('פרטי כניסה'));
  assert.deepEqual(unknownVars('welcome', 'היי {לקוח}\n{פרטי כניסה}'), []);
  assert.deepEqual(unknownVars('thursday', '{פרטי כניסה}'), ['פרטי כניסה']);
});

test('no link, or a link the sender cannot copy: a plain sentence, and the page offers to make one', () => {
  const now = new Date('2026-10-11T10:00:00+03:00');
  const none = suggestFor(client, opened, [], now).options[0];
  assert.deepEqual([none.access, none.accessUrl], ['none', null]);
  const text = messageText(none, T);
  assert.ok(text.includes(`את הגישות לרשתות לא שולחים בהודעה.\n${ACCESS_FALLBACK}\n\nבכל יום חמישי`), text);
  assert.ok(!text.includes('access.html'));
  assert.deepEqual(unfilledIn(text), []);
  // Filled already: nothing to send, nothing to offer.
  const filled = suggestFor(client, opened, [], now, null, { accessLinks: [{ ...link, submitted_at: '2026-10-11T09:40:00+03:00' }], accessUrl: null }).options[0];
  assert.deepEqual([filled.access, filled.accessUrl], ['filled', null]);
  assert.ok(!messageText(filled, T).includes('access.html'));
  // Revoked or expired: as none.
  assert.equal(suggestFor(client, opened, [], now, null, { accessLinks: [{ ...link, revoked_at: '2026-10-11T09:30:00+03:00' }] }).options[0].access, 'none');
  // Waiting, but the address is not known (the token could not be read): never a broken line.
  const blind = suggestFor(client, opened, [], now, null, { accessLinks: [link], accessUrl: null }).options[0];
  assert.equal(blind.access, 'waiting');
  assert.ok(messageText(blind, T).includes(ACCESS_FALLBACK));
});

test('a welcome the office edited before the form existed still works: the line is added at its end', () => {
  const now = new Date('2026-10-11T10:00:00+03:00');
  const edited = templatesByKey([{ key: 'welcome', title: 'ברוכים הבאים', body: 'היי {לקוח}, ברוכים הבאים.\nהנוסח שלנו.\n' }]);
  const o = suggestFor(client, opened, [], now, null, { accessLinks: [link], accessUrl: URL1 }).options[0];
  assert.equal(messageText(o, edited), `היי דנה, ברוכים הבאים.\nהנוסח שלנו.\n\nכדי שנוכל להתחיל, מלאו כאן את פרטי הכניסה לרשתות: ${URL1}`);
  // Without a link the office's words stay exactly as they wrote them.
  assert.equal(messageText(suggestFor(client, opened, [], now).options[0], edited), 'היי דנה, ברוכים הבאים.\nהנוסח שלנו.\n');
  assert.equal(withAccessVar('שלום {פרטי כניסה} להתראות', URL1), 'שלום {פרטי כניסה} להתראות');
  assert.equal(withAccessVar('שלום', null), 'שלום');
  assert.deepEqual(accessVars(null), { 'פרטי כניסה': ACCESS_FALLBACK });
  // The message from the card.
  const msg = accessLinkMessage({ name: 'דנה' }, URL1);
  assert.match(msg, /^היי דנה, כדי שנוכל להתחיל לעבוד על הרשתות שלכם/);
  assert.ok(msg.includes(URL1) && /מוצפנים/.test(msg) && /14 יום/.test(msg));
  // No template of the office ever holds a password or a place for one.
  for (const t of DEFAULT_TEMPLATES) assert.doesNotMatch(t.body, /\{סיסמה\}|password/i, t.key);
});

// ── The nudge ───────────────────────────────
test('the nudge: from the end of the next business day, once more two business days later, never a third', () => {
  // Made on Sunday 11.10: the end of Monday 12.10, then Wednesday 14.10.
  assert.deepEqual(nudgeTimes(link).map((d) => d.toISOString()), [IL(2026, 10, 12, 18).toISOString(), IL(2026, 10, 14, 18).toISOString()]);
  // Made on a Thursday: Sunday evening, then Tuesday (the weekend is not counted).
  assert.deepEqual(nudgeTimes({ created_at: IL(2026, 10, 15, 16).toISOString() }).map((d) => d.toISOString()), [IL(2026, 10, 18, 18).toISOString(), IL(2026, 10, 20, 18).toISOString()]);
  assert.equal(nudgeRef(link, 1), 'access_nudge_aaaaaaaa_1');
  assert.match(nudgeRef(link, 2), /^(r[0-9]+\.)?[a-z0-9_]+$/); // client_messages.ref
  const at = (y, m, d, h, mi = 0) => IL(y, m, d, h, mi);
  assert.equal(nudgeDue(link, [], at(2026, 10, 12, 17, 59)), 0);
  assert.equal(nudgeDue(link, [], at(2026, 10, 12, 18)), 1);
  assert.equal(nudgeDue(link, [], at(2026, 10, 15, 9)), 1, 'the first was never sent: it is still the first');
  const first = [{ ref: nudgeRef(link, 1), template_key: NUDGE_KEY, sent_at: at(2026, 10, 13, 9).toISOString() }];
  assert.equal(nudgeDue(link, first, at(2026, 10, 13, 12)), 0);
  assert.equal(nudgeDue(link, first, at(2026, 10, 14, 18)), 2);
  const both = [...first, { ref: nudgeRef(link, 2), template_key: NUDGE_KEY, sent_at: at(2026, 10, 15, 9).toISOString() }];
  assert.equal(nudgeDue(link, both, at(2026, 10, 20, 9)), 0);
  // Filled, revoked or expired: nothing.
  assert.equal(nudgeDue({ ...link, submitted_at: at(2026, 10, 12, 10).toISOString() }, [], at(2026, 10, 13, 9)), 0);
  assert.equal(nudgeDue({ ...link, revoked_at: at(2026, 10, 12, 10).toISOString() }, [], at(2026, 10, 13, 9)), 0);
  assert.equal(nudgeDue(link, [], at(2026, 10, 26, 9)), 0);
});

test('the nudge is in Irit\'s queue, with the link; it never pushes the day\'s own milestone aside', () => {
  const welcomeSent = [{ kind: 'milestone', template_key: 'welcome', ref: 'welcome', sent_at: '2026-10-11T10:05:00+03:00' }];
  const tue = new Date('2026-10-13T09:30:00+03:00');
  const s = suggestFor(client, opened, welcomeSent, tue, null, { accessLinks: [link], accessUrl: URL1 });
  assert.deepEqual(s.options.map((o) => o.key), [NUDGE_KEY, 'daily.join']);
  const o = s.options[0];
  assert.deepEqual([o.kind, o.ref], ['milestone', 'access_nudge_aaaaaaaa_1']);
  assert.equal(o.reason, 'הלקוח עוד לא מילא את פרטי הכניסה לרשתות (הקישור נוצר ביום א׳ 11.10)');
  const text = messageText(o, T);
  assert.match(text, /^היי דנה, תזכורת קטנה:/);
  assert.ok(text.includes(`\n${URL1}\n`));
  assert.deepEqual(unfilledIn(text), []);
  // Before its time: not in the queue.
  const mon = new Date('2026-10-12T12:00:00+03:00');
  assert.ok(!suggestFor(client, opened, welcomeSent, mon, null, { accessLinks: [link], accessUrl: URL1 }).options.some((x) => x.key === NUDGE_KEY));
  // The second, and no third.
  const sent1 = [...welcomeSent, { kind: 'milestone', template_key: NUDGE_KEY, ref: o.ref, sent_at: '2026-10-13T09:35:00+03:00' }];
  const thu = new Date('2026-10-15T09:30:00+03:00');
  const second = suggestFor(client, opened, sent1, thu, null, { accessLinks: [link], accessUrl: URL1 }).options.find((x) => x.key === NUDGE_KEY);
  assert.equal(second.ref, 'access_nudge_aaaaaaaa_2');
  assert.match(second.reason, /תזכורת שנייה ואחרונה/);
  const sent2 = [...sent1, { kind: 'milestone', template_key: NUDGE_KEY, ref: second.ref, sent_at: '2026-10-15T09:35:00+03:00' }];
  assert.ok(!suggestFor(client, opened, sent2, new Date('2026-10-19T09:30:00+03:00'), null, { accessLinks: [link], accessUrl: URL1 }).options.some((x) => x.key === NUDGE_KEY));
  // The address unknown to this sender: the message waits for it to be pasted.
  const blind = suggestFor(client, opened, welcomeSent, tue, null, { accessLinks: [link], accessUrl: null }).options[0];
  assert.deepEqual(unfilledIn(messageText(blind, T)), ['{קישור}']);
  // The queue of the day passes each client its own links.
  const q = dayQueue([client, { ...client, id: 'c2', name: 'רון' }], { c1: opened, c2: opened }, { c1: welcomeSent, c2: welcomeSent }, tue, { c1: { accessLinks: [link], accessUrl: URL1 } });
  assert.deepEqual(q.map((e) => [e.client.id, e.options[0].key]), [['c1', NUDGE_KEY], ['c2', 'daily.join']]);
});

// ── The reminder rules ──────────────────────
const STAFF = [{ email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }];
const world = (c, checks = {}, extra = {}) => ({ clients: [c], checks: { [c.id]: checks }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, ...extra });
const mark = (key, at, note = null, by = 'system') => ({ [key]: { client_id: 'c1', item_key: key, state: 'done', note, at: at.toISOString(), by_email: by } });
const rc = { id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 10, 11, 9).toISOString(), created_by_email: 'irit@x' };
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const of = (list, rule) => list.filter((r) => r.rule === rule).map((r) => `${r.step}@${r.person}:${r.level}`).sort();
const SUMMARY = [{ network: 'instagram', label: null, choice: 'have' }, { network: 'facebook', label: null, choice: 'none' }, { network: 'tiktok', label: null, choice: 'reset' }];

test('the two rules are declared once each, as data', () => {
  for (const id of ['accessForm', 'accessLink', 'access', 'broken']) assert.equal(RULES.filter((r) => r.id === id).length, 1, id);
});

test('the client filled the form: Irit hears quietly; Ilai\'s "קיבלת גישות" and his 30 office minutes start from the submission', () => {
  const at = IL(2026, 10, 12, 10, 0); // Monday
  const filled = { ...link, submitted_at: at.toISOString(), summary: SUMMARY };
  // The submission marked 5's "access received" (and "in the vault"), as the database does.
  const checks = { ...mark('p05.access', at, 'מהלקוח, בטופס פרטי הכניסה: Instagram, Facebook, TikTok'), ...mark('p05.vault', at) };
  const access = [{ id: 'a1', client_id: 'c1', network: 'instagram', status: 'new', updated_at: at.toISOString() }, { id: 'a3', client_id: 'c1', network: 'tiktok', status: 'broken', broken_since: at.toISOString(), updated_at: at.toISOString() }];
  const w = world(rc, checks, { accessLinks: [filled], access });
  const now = due(w, new Date(at.getTime() + 60e3));
  assert.deepEqual(of(now, 'accessForm'), ['irit@irit:quiet']);
  const irit = now.find((r) => r.rule === 'accessForm');
  assert.equal(irit.title, 'הלקוח מילא את פרטי הכניסה לרשתות: קפה דנה · דנה');
  assert.equal(irit.body, 'Instagram: התקבלו פרטי כניסה · Facebook: אין כיום, צריך לפתוח · TikTok: צריך לחדש סיסמה');
  assert.equal(irit.url, 'client.html?id=c1#access');
  // The existing rules do the rest: Ilai's ring (once), and Lior's "גישה שבורה" for the reset.
  assert.deepEqual(of(now, 'access'), ['now@ilai:ring']);
  const ilai = now.find((r) => r.rule === 'access');
  assert.equal(ilai.title, 'קיבלת גישות: קפה דנה · דנה');
  assert.match(ilai.body, /יעד היום 10:30/);
  assert.deepEqual(of(now, 'broken'), ['now@lior:ring']);
  // 30 office minutes later and not checked: Lior, by the existing rule; and Ilai himself, at his own deadline (protocol v10).
  assert.deepEqual(of(due(w, IL(2026, 10, 12, 10, 31)), 'access'), ['ilai30@ilai:ring', 'lior@lior:ring', 'now@ilai:ring']);
  // Each once.
  assert.deepEqual(due(w, IL(2026, 10, 12, 10, 40), now.map((r) => ({ key: r.key }))).filter((r) => r.rule === 'accessForm'), []);
  // Nothing of the reminders holds a secret or the link.
  const all = JSON.stringify(due(w, IL(2026, 10, 12, 12)));
  assert.ok(!all.includes('access.html') && !/t=[A-Za-z0-9_-]{20}/.test(all));
});

test('the form came after the meeting (5 was marked long ago): Ilai is rung for what the client sent now; Lior after 30 office minutes', () => {
  const met = IL(2026, 10, 12, 12);
  const at = IL(2026, 10, 14, 9, 30);
  const filled = { ...link, submitted_at: at.toISOString(), summary: SUMMARY };
  const checks = { ...mark('p05.access', met, 'מסיום האפיון: Instagram', 'ofir@x'), ...mark('p06.verified', IL(2026, 10, 12, 12, 20), null, 'ilai@x') };
  const access = [{ id: 'a1', client_id: 'c1', network: 'instagram', status: 'new', updated_at: at.toISOString() }];
  const w = world(rc, checks, { accessLinks: [filled], access });
  const now = due(w, new Date(at.getTime() + 60e3));
  assert.deepEqual(of(now, 'accessForm'), ['ilai@ilai:ring', 'irit@irit:quiet']);
  assert.deepEqual(of(now, 'access'), [], 'the old ladder is long over');
  const ilai = now.find((r) => r.step === 'ilai');
  assert.equal(ilai.title, 'קיבלת גישות מהלקוח: קפה דנה · דנה');
  assert.match(ilai.body, /הלקוח מילא בטופס: Instagram\. יש לך 30 דקות לבדוק אותן מהכספת\. יעד היום 10:00\./);
  assert.deepEqual(of(due(w, IL(2026, 10, 14, 10, 1)), 'accessForm'), ['ilai@ilai:ring', 'irit@irit:quiet', 'lior@lior:ring']);
  // Checked meanwhile (no login is "new" any more): Lior is not rung.
  assert.deepEqual(of(due({ ...w, access: [{ ...access[0], status: 'ok' }] }, IL(2026, 10, 14, 10, 1)), 'accessForm'), ['ilai@ilai:ring', 'irit@irit:quiet']);
  // The client only asked to open and to reset: nothing for Ilai to check.
  const none = world(rc, checks, { accessLinks: [{ ...filled, summary: SUMMARY.slice(1) }], access: [] });
  assert.deepEqual(of(due(none, IL(2026, 10, 14, 10, 1)), 'accessForm'), ['irit@irit:quiet']);
});

test('the link was not filled: Irit, quietly, at the end of the next business day and once more two business days later', () => {
  const w = world(rc, {}, { accessLinks: [link] }); // made Sunday 11.10 at 09:20
  assert.deepEqual(of(due(w, IL(2026, 10, 12, 17, 59)), 'accessLink'), []);
  const first = due(w, IL(2026, 10, 12, 18, 0));
  assert.deepEqual(of(first, 'accessLink'), ['nudge1@irit:quiet']);
  const r = first.find((x) => x.rule === 'accessLink');
  assert.equal(r.title, 'הלקוח עוד לא מילא את פרטי הכניסה: קפה דנה · דנה');
  assert.equal(r.body, 'הקישור נוצר ביום א׳ 11.10.2026. נוסח תזכורת מוכן מחכה ב״הודעות ללקוחות״.');
  assert.equal(r.url, 'messages.html');
  const known = first.map((x) => ({ key: x.key }));
  assert.deepEqual(of(due(w, IL(2026, 10, 13, 12), known), 'accessLink'), []);
  const second = due(w, IL(2026, 10, 14, 18, 0), known);
  assert.deepEqual(of(second, 'accessLink'), ['nudge2@irit:quiet']);
  assert.match(second.find((x) => x.rule === 'accessLink').body, /תזכורת אחרונה ללקוח[^.]*; הקישור תקף עד יום א׳ 25\.10\.2026\./);
  // Never a third.
  assert.deepEqual(of(due(w, IL(2026, 10, 22, 12), [...known, ...second.map((x) => ({ key: x.key }))]), 'accessLink'), []);
  // Filled, revoked or expired before its time: the ladder stops.
  for (const patch of [{ submitted_at: IL(2026, 10, 12, 11).toISOString(), summary: SUMMARY }, { revoked_at: IL(2026, 10, 12, 11).toISOString() }]) {
    assert.deepEqual(of(due(world(rc, {}, { accessLinks: [{ ...link, ...patch }] }), IL(2026, 10, 12, 18, 5)), 'accessLink'), [], JSON.stringify(patch));
  }
  assert.deepEqual(of(due(w, IL(2026, 10, 25, 9, 21)), 'accessLink'), []);
  // A client that ended: nothing.
  assert.deepEqual(of(due(world({ ...rc, status: 'ended' }, {}, { accessLinks: [link] }), IL(2026, 10, 12, 18, 5)), 'accessLink'), []);
  // A world without the table (before the migration): the engine runs as before.
  assert.deepEqual(of(due(world(rc, {}), IL(2026, 10, 12, 18, 5)), 'accessLink'), []);
});
