// "שאלו את המערכת" answers "איפה…" / "איך…" from the asker's own screens (app/ask-guide.js; the
// owner's request of 29.10.2026; docs/ops.md, section 78): per role, the personal menu and, for
// whoever has it, "מבט מנהל"; no screen of another role ever shows; the tool app_guide; the copy
// the function deploys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE, scopeOf } from '../app/protocol.js';
import { menuOf, profileMenu } from '../app/shell-rules.js';
import { hasProfiles } from '../app/manager-rules.js';
import { guideOf, guideFor, screensOf, SITE, clientLink, ganttLink } from '../app/ask-guide.js';
import { examplesFor, HOWTO_EXAMPLES } from '../app/ask-logic.js';
import { runTool, guardDb, TOOLS, OUTPUT_MAX } from '../supabase/functions/ask/tools.js';
import { ENTRIES, check, deployFiles } from '../scripts/sync-functions.mjs';
import { fakeClient } from './fake-pgrest.mjs';

const v = (me) => ({ me, scope: scopeOf(me), error: null });
const OWNER = v(null);
const ROLES = ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos'];
const ids = (list) => list.map((s) => s.id);
const TAB_IDS = ['team-work', 'control', 'performance'];
const qs = (g) => g.howto.map((h) => h.q);

test('the guide: everyone on the staff has one; nobody else', () => {
  for (const viewer of [OWNER, ...ROLES.map(v)]) assert.ok(guideOf(viewer), viewer.me || 'owner');
  assert.equal(guideOf(null), null);
  assert.equal(guideOf({ me: null, scope: 'own', error: null }), null, 'the generic editor account');
  assert.equal(guideOf({ me: 'lior', scope: 'office', error: new Error('x') }), null);
});

test('mine and manager: exactly the two profiles of the menu, nothing twice', () => {
  for (const viewer of [OWNER, ...ROLES.map(v)]) {
    const who = viewer.me || 'owner';
    const g = guideOf(viewer);
    const mineMenu = profileMenu(viewer, 'mine').map((it) => it.id);
    assert.deepEqual(ids(g.mine).filter((id) => !TAB_IDS.includes(id)), mineMenu, who);
    if (!hasProfiles(viewer)) {
      assert.deepEqual(g.manager, [], who);
      assert.equal(g.switch, undefined, who);
      continue;
    }
    const mgrMenu = profileMenu(viewer, 'manager').map((it) => it.id).filter((id) => !mineMenu.includes(id));
    assert.deepEqual(ids(g.manager).filter((id) => !TAB_IDS.includes(id)), mgrMenu, who);
    const all = [...ids(g.mine), ...ids(g.manager)];
    assert.equal(all.length, new Set(all).size, who);
    assert.equal(g.switch.label, 'מבט מנהל');
    // Every manager screen is reached through the button first; no personal one is.
    for (const s of g.manager) assert.match(s.path, /^כפתור "מבט מנהל" בראש המסך/, `${who}: ${s.id}`);
    for (const s of g.mine) assert.doesNotMatch(s.path, /מבט מנהל/, `${who}: ${s.id}`);
  }
});

test('no leaks: a screen or a how-to is in a guide only when the person has its screen', () => {
  for (const viewer of [OWNER, ...ROLES.map(v)]) {
    const who = viewer.me || 'owner';
    const g = guideOf(viewer);
    const menu = menuOf(viewer).map((it) => it.id);
    for (const s of [...g.mine, ...g.manager]) {
      assert.ok(menu.includes(s.id) || (TAB_IDS.includes(s.id) && hasProfiles(viewer)), `${who}: ${s.id}`);
      assert.ok(s.link.startsWith(SITE), s.link);
      assert.ok(s.what.length > 20 && s.what.length < 260, `${who}: ${s.id}`);
    }
    // A how-to's link is one of this person's own screens.
    const links = new Set([...g.mine, ...g.manager].map((s) => s.link));
    for (const h of g.howto) assert.ok(links.has(h.link), `${who}: ${h.q}`);
    assert.ok(JSON.stringify(g).length < OUTPUT_MAX / 1.5, who);
  }
  // The editors: their clients, their editing, the calendar and the bot; no office screen, no money.
  for (const ed of ['nirel', 'nadia', 'yariv', 'anna']) {
    const g = guideOf(v(ed));
    assert.deepEqual(ids(g.mine), ['mine', 'clients', 'editor', 'calendar', 'ask'], ed);
    assert.equal(g.mine[1].label, 'הלקוחות שלי');
    assert.ok(qs(g).includes('איך מדווחים שלוגו / טלפון / חומר לא התקבל?'), ed);
    const text = JSON.stringify(g);
    for (const word of ['מבט מנהל', 'הצעות שנשלחו', 'לקוח חדש', 'עריכת פרטים', 'הכספת', 'פיימנט', 'צוות וכניסות', 'החלפת עורך', 'שליחת זימון']) assert.ok(!text.includes(word), `${ed}: ${word}`);
  }
  // Eli: his shoot days; Ilai: his Gantt and the Drive links; the field sales: their deals only.
  assert.deepEqual(ids(guideOf(v('eli')).mine), ['mine', 'clients', 'shoot', 'calendar', 'ask']);
  const ilai = guideOf(v('ilai'));
  assert.deepEqual(ids(ilai.mine), ['mine', 'clients', 'gantt', 'ask']);
  assert.ok(qs(ilai).includes('איך מושכים קישורים מהדרייב לגאנט?'));
  assert.ok(!qs(ilai).includes('איך מוסיפים לקוח חדש?'));
  for (const s of ['stav', 'amos']) {
    const g = guideOf(v(s));
    assert.deepEqual(ids(g.mine), ['deal', 'ask'], s);
    assert.deepEqual(qs(g), ['איך שולחים עסקה חדשה?'], s);
    assert.equal(g.client_pages, undefined, s);
  }
  // The other roles: what is not theirs is not in their guide.
  const has = (who, q) => qs(guideOf(who)).includes(q);
  assert.equal(has(v('lior'), 'איפה רואים את ההצעות והעסקאות שנשלחו החודש?'), false, 'Lior has no sent quotes');
  assert.equal(has(v('lior'), 'איך מחליפים עורך ללקוח?'), false, '"בקרה ושיוך" is not in his menu');
  for (const who of ['irit', 'lior', 'ofir']) assert.equal(has(v(who), 'איפה סיכום הערב (19:00)?'), false, who);
  assert.equal(has(OWNER, 'איפה סיכום הערב (19:00)?'), true);
  assert.equal(has(v('ofir'), 'איך מושכים קישורים מהדרייב לגאנט?'), false, 'Ofir reads the Gantt only');
  for (const who of [OWNER, v('irit'), v('lior'), v('ofir')]) assert.equal(has(who, 'איך מוסיפים לקוח חדש?'), true, who.me || 'owner');
  assert.ok(!ids(guideOf(v('lior')).mine).includes('quotes') && !ids(guideOf(v('lior')).manager).includes('quotes'));
  assert.ok(!JSON.stringify(guideOf(v('irit'))).includes('פיימנט'));
});

test('the paths: in clicks from the menu, through "מבט מנהל" when the screen is there', () => {
  const howto = (viewer, q) => guideOf(viewer).howto.find((h) => h.q === q);
  // Ofir's sent quotes are behind "מבט מנהל" (29.10.2026); Irit's are in her own menu.
  const ofir = howto(v('ofir'), 'איפה רואים את ההצעות והעסקאות שנשלחו החודש?');
  assert.match(ofir.path, /^כפתור "מבט מנהל" בראש המסך ← בתפריט ← הצעות שנשלחו/);
  assert.equal(ofir.link, 'https://app.astrateg.tech/quotes.html');
  assert.match(howto(v('irit'), 'איפה רואים את ההצעות והעסקאות שנשלחו החודש?').path, /^בתפריט ← הצעות שנשלחו/);
  assert.match(guideOf(v('ofir')).howto.find((h) => h.q.startsWith('איפה רואים את ההצעות')).path, /הסכומים|נחתם/);
  // A new client: from the clients list, the button and the form's own words.
  const nc = howto(OWNER, 'איך מוסיפים לקוח חדש?');
  assert.match(nc.path, /^בתפריט ← לקוחות ← הכפתור "לקוח חדש" למעלה ← "עסקה חדשה".*"פתיחת כרטיס לקוח"/);
  assert.equal(nc.link, 'https://app.astrateg.tech/clients.html#clients');
  // The Drive link: the card's links row, a folder link.
  assert.match(howto(v('lior'), 'איך מחברים ללקוח קישור לדרייב?').path, /"עריכת קישורים".*"תיקיית הסרטונים ב־Drive".*drive\.google\.com\/drive\/folders/);
  // The owner's evening summary: the button, then the tab.
  assert.match(howto(OWNER, 'איפה סיכום הערב (19:00)?').path, /^כפתור "מבט מנהל" בראש המסך ← לשונית "סיכום היום"/);
  // Irit's daily review is a tab of her clients list, in her own profile; the owner's behind the button.
  assert.equal(guideOf(v('irit')).mine.find((s) => s.id === 'control').path, 'בתפריט ← לקוחות ← לשונית "בקרה יומית"');
  assert.match(guideOf(OWNER).manager.find((s) => s.id === 'control').path, /^כפתור "מבט מנהל".*לשונית "בקרה יומית"/);
  // Lior's "מבט מנהל" opens on "כל הלקוחות במבט" (he has no screen 1).
  assert.equal(guideOf(v('lior')).switch.link, 'https://app.astrateg.tech/owner.html#all');
  assert.equal(guideOf(OWNER).switch.link, 'https://app.astrateg.tech/owner.html#now');
  // The calendar: "שליחת זימון" only for the office.
  assert.match(howto(v('ofir'), 'איפה היומן ואיך שולחים זימון?').path, /שליחת זימון/);
  assert.doesNotMatch(howto(v('eli'), 'איפה היומן שלי?').path, /זימון/);
  // A client's own pages.
  assert.equal(clientLink('a b'), 'https://app.astrateg.tech/client.html?id=a%20b');
  assert.equal(ganttLink('x'), 'https://app.astrateg.tech/gantt.html?id=x');
});

test('a topic puts what fits first; the whole guide still goes', () => {
  const g = guideFor(v('ofir'), 'איך מוסיפים לקוח חדש?');
  assert.equal(g.likely[0], 'איך מוסיפים לקוח חדש?');
  assert.equal(g.howto.length, guideOf(v('ofir')).howto.length);
  assert.equal(guideFor(v('ofir'), '').likely, undefined);
  assert.equal(guideFor(v('nadia'), 'הצעות שנשלחו').likely, undefined, 'nothing of hers fits: nothing invented');
  assert.equal(guideFor(null, 'x'), null);
});

test('the chips: one or two how-tos for each role, of its own screens', () => {
  assert.deepEqual(examplesFor(OWNER).slice(-2), HOWTO_EXAMPLES.office);
  assert.ok(examplesFor(v('lior')).includes('איך מוסיפים לקוח חדש?'));
  assert.ok(examplesFor(v('nadia')).includes('איפה אני רואה מה באיחור?'));
  assert.ok(!examplesFor(v('nadia')).includes('איך מוסיפים לקוח חדש?'));
  assert.deepEqual(examplesFor(v('stav')), ['כמה עסקאות שלחתי החודש?', 'איך שולחים עסקה חדשה?']);
  assert.deepEqual(examplesFor({ me: null, scope: 'own', error: null }), []);
});

test('the tool app_guide: the caller\'s guide, reads nothing, keeps nothing of others', async () => {
  assert.ok(TOOLS.some((t) => t.name === 'app_guide' && /מבט מנהל/.test(t.description)));
  const raw = fakeClient({});
  const run = async (viewer, input) => {
    const r = await runTool({ db: guardDb(raw), seesMoney: viewer === OWNER, drive: null, now: () => new Date(), viewer }, 'app_guide', input);
    assert.equal(r.isError, false);
    return JSON.parse(r.content);
  };
  const lior = await run(v('lior'), { topic: 'לקוח חדש' });
  assert.deepEqual(lior, guideFor(v('lior'), 'לקוח חדש'), 'nothing taken out by the money net');
  const ofir = await run(v('ofir'), {});
  assert.ok(ids(ofir.manager).includes('quotes'));
  const nadia = await run(v('nadia'), { topic: 'מבט מנהל' });
  assert.deepEqual(nadia.manager, []);
  assert.ok(!JSON.stringify(nadia).includes('owner.html'));
  const stav = await run(v('stav'), {});
  assert.deepEqual(ids(stav.mine), ['deal', 'ask']);
  assert.equal(raw.reads.length, 0, 'the guide reads nothing');
  // Without a viewer (never from the function): an error line, not someone else's guide.
  assert.match((await run(undefined, {})).error, /אין מדריך/);
});

test('the function deploys the guide and the menu rules with it', () => {
  assert.ok(ENTRIES.includes('ask-guide.js'));
  const files = deployFiles('ask');
  for (const f of ['_shared/app/ask-guide.js', '_shared/app/shell-rules.js', '_shared/app/manager-rules.js', '_shared/app/team-rules.js']) assert.ok(files.includes(f), f);
  assert.deepEqual(check(), { missing: [], stale: [], extra: [] });
  // The screens a guide lists come from the same rules as the menu; nothing of the DOM.
  assert.ok(screensOf(OWNER).mine.length >= 4);
  assert.ok(Object.keys(PEOPLE).length > 10);
});
