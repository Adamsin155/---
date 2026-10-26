// The old system's characterizations in the new one (the owner's request of 26.10.2026): how
// the old free text is read into parts the card can show (app/legacy-char-logic.js), the raw
// answers, the dates, and the import (scripts/legacy-characterizations-import.mjs) against a
// stand-in for the database. The database side is tests/sql/legacy-characterizations.test.mjs;
// the browser side is a step of tests/office-flows-e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { charBlocks, answerRows, legacyCharView, legacyCharSum } from '../app/legacy-char-logic.js';
import { importAll, plan } from '../scripts/legacy-characterizations-import.mjs';

// Every word of the text is in the parts, in order (nothing is dropped).
const wordsOf = (s) => s.replace(/[:：#*=—–•-]/g, ' ').split(/\s+/).filter(Boolean);
const partWords = (blocks) => wordsOf(blocks.map((b) => (b.type === 'dl' ? b.items.flat().join(' ') : b.type === 'ul' ? b.items.join(' ') : b.text)).join(' '));

test('a filled characterization: headings, "key: value" lines as one list, paragraphs and lists', () => {
  const text = [
    'רקע על העסק',
    'שם העסק: מספרת רון',
    'תחום: תספורת גברים',
    'שעות פתיחה: 10:00-20:00',
    'אתר: https://ron.example.com',
    '',
    'קהל יעד:',
    'שם: לא חשוב',
    'גיל: 25–45',
    '',
    'שירותים:',
    '- תספורת',
    '- צבע',
    '',
    'מה הלקוח מספר על עצמו',
    'רון פתח את המספרה ב־2015. הוא אוהב לדבר עם הלקוחות',
    'ומאמין בשירות אישי.',
    '',
    '• אווירה צעירה',
    '• מוזיקה',
    '',
    '## מטרות',
    '**מטרה עיקרית:** לקוחות חדשים',
    '=== הערות ===',
    'בשעה 10:30 נפגשים במספרה',
    '----',
    'סיום',
  ].join('\r\n');
  const blocks = charBlocks(text);
  assert.deepEqual(blocks, [
    { type: 'h', text: 'רקע על העסק' },
    { type: 'dl', items: [['שם העסק', 'מספרת רון'], ['תחום', 'תספורת גברים'], ['שעות פתיחה', '10:00-20:00'], ['אתר', 'https://ron.example.com']] },
    { type: 'h', text: 'קהל יעד' },
    { type: 'dl', items: [['שם', 'לא חשוב'], ['גיל', '25–45']] },
    { type: 'dl', items: [['שירותים', '- תספורת\n- צבע']] },
    { type: 'h', text: 'מה הלקוח מספר על עצמו' },
    { type: 'p', text: 'רון פתח את המספרה ב־2015. הוא אוהב לדבר עם הלקוחות\nומאמין בשירות אישי.' },
    { type: 'ul', items: ['אווירה צעירה', 'מוזיקה'] },
    { type: 'h', text: 'מטרות' },
    { type: 'dl', items: [['מטרה עיקרית', 'לקוחות חדשים']] },
    { type: 'h', text: 'הערות' },
    { type: 'p', text: 'בשעה 10:30 נפגשים במספרה' },
    { type: 'p', text: 'סיום' },
  ]);
  assert.deepEqual(partWords(blocks), wordsOf(text));
});

test('lines under a "key: value" continue it; a short line before the next key opens a part', () => {
  assert.deepEqual(charBlocks('הערות: אין הרבה\nרק שהוא מאחר\nמטרות\nמטרה: לגדול'), [
    { type: 'dl', items: [['הערות', 'אין הרבה\nרק שהוא מאחר']] },
    { type: 'h', text: 'מטרות' },
    { type: 'dl', items: [['מטרה', 'לגדול']] },
  ]);
  // "key:" alone with lines under it, ended by a short line that opens the next part.
  assert.deepEqual(charBlocks('מוצרים:\nשמפו\nמסכה\nמחירים\nתספורת: 80'), [
    { type: 'dl', items: [['מוצרים', 'שמפו\nמסכה']] },
    { type: 'h', text: 'מחירים' },
    { type: 'dl', items: [['תספורת', '80']] },
  ]);
  // "key:" right before another part is a heading; at the end too.
  assert.deepEqual(charBlocks('פרטים:\n\nשם: רון\nהערות:'), [{ type: 'h', text: 'פרטים' }, { type: 'dl', items: [['שם', 'רון']] }, { type: 'h', text: 'הערות' }]);
});

test('what is not a "key: value": a time, a link, a sentence, a long line; a key with a question or ח.פ. is', () => {
  for (const line of ['נפגשים ב־10:30 בבוקר', 'https://example.com/a:b', 'הוא אמר. אחר כך: כן', 'וואו! זה: מעולה', `${'מילה '.repeat(11)}: ערך`]) {
    assert.deepEqual(charBlocks(line), [{ type: 'p', text: line }], line);
  }
  assert.deepEqual(charBlocks('מה המטרה? : למכור יותר\nח.פ.: 512345678'), [{ type: 'dl', items: [['מה המטרה?', 'למכור יותר'], ['ח.פ.', '512345678']] }]);
  assert.deepEqual(charBlocks(''), []);
  assert.deepEqual(charBlocks(null), []);
  assert.deepEqual(charBlocks('  \n---\n  '), []);
  // A single sentence and a single short line.
  assert.deepEqual(charBlocks('לקוח שקט, אוהב סרטונים קצרים.'), [{ type: 'p', text: 'לקוח שקט, אוהב סרטונים קצרים.' }]);
  assert.deepEqual(charBlocks('סיום'), [{ type: 'p', text: 'סיום' }]);
});

test('the words go in as text: markup in the old text stays text', () => {
  const blocks = charBlocks('שם: <img src=x onerror=alert(1)>\n<script>alert(1)</script>');
  assert.equal(blocks[0].items[0][1], '<img src=x onerror=alert(1)>\n<script>alert(1)</script>');
  // The page puts them in with createTextNode (app/quote-doc.js h) and never as HTML.
  const ui = readFileSync(new URL('../app/legacy-char-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('the raw answers: by the question\'s number, empty ones left out, any shape as words', () => {
  assert.deepEqual(answerRows({ 10: 'לא', 2: '  כן ', 1: '', 3: null, x: 'אחר', 4: ['א', '', 'ב'], 5: true, 6: { a: 'ב', b: '' }, 7: 0 }), [
    ['2', 'כן'], ['4', 'א · ב'], ['5', 'כן'], ['6', 'a: ב'], ['7', '0'], ['10', 'לא'], ['x', 'אחר']]);
  for (const v of [null, undefined, [], 'x', 5]) assert.deepEqual(answerRows(v), []);
});

test('the view: each part with its date in Israel time ("מולא ב־"), the closed row\'s words; nothing: null', () => {
  // 22:30 UTC on 1.3 is already 2.3 in Israel.
  const v = legacyCharView({ filled_text: 'שם: רון', filled_at: '2025-03-01T22:30:00Z', brief_text: 'בריף', brief_at: '2025-03-05T08:00:00Z',
    script_text: 'תסריט 1: פתיחה', script_at: null, summary_text: '  ', answers: { 1: 'כן' } });
  assert.equal(v.filled.stamp, 'מולא ב־2.3.2025');
  assert.equal(v.brief.stamp, 'עודכן ב־5.3.2025');
  assert.equal(v.script.stamp, null);
  assert.equal(v.summary, null);
  assert.deepEqual(v.answers, [['1', 'כן']]);
  assert.equal(legacyCharSum(v), 'מולא ב־2.3.2025 · בריף · תסריטים');
  assert.equal(legacyCharSum(legacyCharView({ filled_text: 'x' })), 'אפיון ממולא');
  assert.equal(legacyCharSum(legacyCharView({ summary_text: 'x' })), 'סיכום');
  assert.equal(legacyCharSum(legacyCharView({ answers: { 1: 'a', 2: 'b' } })), '2 תשובות');
  for (const row of [null, {}, { filled_text: ' ', answers: { 1: '' } }]) assert.equal(legacyCharView(row), null);
  assert.equal(legacyCharSum(null), null);
});

// ── The import ──
const fakeSupabase = (fail = new Set()) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (fail.has(args.p_client)) return { data: null, error: { message: 'no such client' } };
      return { data: { client_id: args.p_client }, error: null };
    },
  };
};
const OLD = [
  { id: 10, name: 'רון', phone: '050-1234567', email: 'r@x.com', notes: 'פרטי', charterFilledText: 'שם: רון', charterFilledAt: '2025-03-01T08:00:00Z', briefText: '', charterAnswers: { 1: 'כן' } },
  { id: 11, name: 'גיל', charterFilledText: '   ', briefText: null, charterAnswers: { 1: '', 2: [] } },
  { id: 12, name: 'דנה', briefText: 'בריף', briefUpdatedAt: '2025-04-01T08:00:00Z' },
  { id: 13, name: 'לא קיים', charterScript: 'תסריט' },
  { id: 14, name: 'שגיאה', charterSummary: 'סיכום' },
  { id: 15, name: 'תשובות בלבד', charterAnswers: { 3: 'אולי' } },
  null,
  'x',
];
const UUIDS = { 10: 'u-10', 12: 'u-12', 14: 'u-14', 15: 'u-15' };

test('importAll: each client with something, with its new client; nothing is passed over; no client is skipped; a failure is reported; only the characterization is sent', async () => {
  const sb = fakeSupabase(new Set(['u-14']));
  const r = await importAll(sb, OLD, (id) => UUIDS[id] || null);
  assert.deepEqual(r, { ok: [10, 12, 15], skipped: [{ id: 13, clientName: 'לא קיים' }], failed: [{ id: 14, error: 'no such client' }] });
  assert.deepEqual(sb.calls.map(([n, a]) => [n, a.p_client]), [['legacy_characterization_import', 'u-10'], ['legacy_characterization_import', 'u-12'], ['legacy_characterization_import', 'u-14'], ['legacy_characterization_import', 'u-15']]);
  assert.deepEqual(sb.calls[0][1].p_doc, { charterFilledText: 'שם: רון', charterFilledAt: '2025-03-01T08:00:00Z', briefText: '', charterAnswers: { 1: 'כן' } });
  assert.deepEqual(sb.calls[1][1].p_doc, { briefText: 'בריף', briefUpdatedAt: '2025-04-01T08:00:00Z' });
  assert.equal(OLD[0].phone, '050-1234567', 'the file read is left as it was');
  // An async mapper, and one that throws, are both fine.
  const r2 = await importAll(fakeSupabase(), OLD, async (id) => { if (id === 12) throw new Error('x'); return UUIDS[id]; });
  assert.deepEqual([r2.ok, r2.skipped.map((s) => s.id)], [[10, 14, 15], [12, 13]]);
  assert.deepEqual(await importAll(fakeSupabase(), null, () => 'u'), { ok: [], skipped: [], failed: [] });
});

test('plan: counts only, with no session', async () => {
  assert.deepEqual(await plan(OLD, (id) => UUIDS[id] || null), { clients: 6, withSomething: 5, withClient: 4, noClient: 1, filled: 1, brief: 1, script: 1, summary: 1, answers: 2 });
});

test('importAll stands alone (it runs inside a page from its own text); the script writes nothing by itself', () => {
  const src = importAll.toString();
  assert.doesNotMatch(src, /\bimport\b|\brequire\(|process\./);
  assert.match(readFileSync(new URL('../scripts/legacy-characterizations-import.mjs', import.meta.url), 'utf8'), /Nothing was written/);
});
