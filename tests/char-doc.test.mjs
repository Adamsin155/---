// "מסמך אפיון" (the owner, 8.11.2026; app/char-doc.js): the whole characterization as one
// document, text and Word, never with a login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charDoc, docText, docWordHtml, docFileName, EMPTY } from '../app/char-doc.js';
import { FORM_FIELDS } from '../app/characterization.js';

const client = { id: 'c1', name: 'מוסך הדוגמה <בע"מ>', business: 'מוסך', has_logo: true };
const char = {
  fields: {
    address: 'הרצל 1, חולון', phone: '03-0000000', services: 'פחחות וצבע\nטיפולים', audiences: 'נהגים', goals: 'לידים',
    ad_budget: '1,500 ₪', ad_account: 'yes', colors: 'כחול ולבן', logo_url: 'https://example.com/logo.png',
    materials: { photos: 'got', videos: 'missing' },
    networks: [{ network: 'instagram', status: 'ok', username: 'secret-user', password: 'secret-pass' }, { network: 'tiktok', status: 'missing' }],
  },
};
const briefs = [{ round: 2, fields: { summary: 'סבב שני' } }, { round: 1, fields: { summary: 'להדגיש מהירות', messages: 'אחריות לשנה', dont: 'לא מחירים' } }];

test('every field in the protocol order, empty ones said, the campaign in words, brand, networks and both rounds', () => {
  const doc = charDoc({ client, char, briefs, byName: 'אופיר', dateText: '3.11' });
  assert.equal(doc.title, 'מסמך אפיון · מוסך הדוגמה <בע"מ>');
  assert.deepEqual(doc.meta, ['מוסך', 'אפיון 3.11 · אופיר', `מולאו 5 מתוך ${FORM_FIELDS.length} השדות`]);
  assert.deepEqual(doc.sections.map((s) => s.key), ['char', 'ads', 'brand', 'nets', 'brief-1', 'brief-2']);
  assert.deepEqual(doc.sections[0].rows.map((r) => r.label), FORM_FIELDS.map((f) => f.label));
  assert.equal(doc.sections[0].rows.find((r) => r.label === 'טלפון העסק').ltr, true);
  assert.equal(doc.sections[1].rows.find((r) => r.label === 'יש ללקוח חשבון מודעות?').value, 'כן, יש');
  assert.deepEqual(doc.sections[2].rows.map((r) => [r.label, r.value]), [['לוגו', 'https://example.com/logo.png'], ['צבעי המותג', 'כחול ולבן'], ['תמונות', 'התקבל'], ['סרטונים קיימים', 'חסר'], ['תפריט או מחירון', '']]);
  assert.deepEqual(doc.sections[3].rows.map((r) => [r.label, r.value]), [['Instagram', 'יש גישה תקינה'], ['TikTok', 'אין רשת']]);
  assert.deepEqual(doc.sections[4].rows.map((r) => r.label), ['סיכום דגשים', ...doc.sections[4].rows.slice(1).map((r) => r.label)]);
  assert.equal(doc.sections[4].rows.length, 3);
});

test('the text: every question with its answer, empty ones as "לא מולא", no login anywhere', () => {
  const text = docText(charDoc({ client, char, briefs, byName: 'אופיר', dateText: '3.11' }));
  assert.match(text, /^מסמך אפיון · מוסך הדוגמה/);
  assert.match(text, /■ מה הלקוח סיפר באפיון\nכתובת מלאה של העסק:\nהרצל 1, חולון\n/);
  assert.match(text, /שירותים ומוצרים:\nפחחות וצבע\nטיפולים\n/);
  assert.match(text, new RegExp(`יתרונות העסק:\n${EMPTY}\n`));
  for (const out of [text, docWordHtml(charDoc({ client, char, briefs }))]) {
    assert.doesNotMatch(out, /secret-user|secret-pass/);
  }
});

test('the Word file: right to left, escaped, line breaks kept; the file name is safe', () => {
  const html = docWordHtml(charDoc({ client, char, briefs }));
  assert.ok(html.startsWith('﻿<html'));
  assert.match(html, /<body dir="rtl">/);
  assert.match(html, /מוסך הדוגמה &lt;בע&quot;מ&gt;/);
  assert.match(html, /פחחות וצבע<br>טיפולים/);
  assert.match(html, /<td dir="ltr" style="text-align:right">03-0000000<\/td>/);
  assert.equal(docFileName(client), 'אפיון - מוסך הדוגמה <בע מ>.doc'.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').replace(' .doc', '.doc'));
  assert.doesNotMatch(docFileName({ name: 'a/b:c' }), /[\/:]/);
});

test('nothing saved yet: the address from the card, everything else empty, no networks section', () => {
  const doc = charDoc({ client: { name: 'חדש', address: 'רחוב 2' }, char: null });
  assert.equal(doc.saved, false);
  assert.equal(doc.sections[0].rows[0].value, 'רחוב 2');
  assert.ok(!doc.sections.some((s) => s.key === 'nets'));
});
