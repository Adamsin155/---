// Three fixes of the owner's test drafts (18.11.2026), through the Claude-account draft (app/mcp-draft.js):
// a way of paying in the special terms replaces "פיימנט בלבד"; videos and graphics not written beside an
// influencer are said in "לבדוק"; a heading with nothing under it is not printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftOf } from '../app/mcp-draft.js';

const paymentLine = (m) => m.legal.find((s) => s.title === 'התמורה ותנאי תשלום').items[1];

test('the way of paying written for the client is clause 2.2, as written, and leaves the special terms', () => {
  const base = { mode: 'free', influencer: 'natali', quantities: [{ key: 'videos', value: 30 }, { key: 'graphics', value: 30 }], monthlyPrice: 320000 };
  const special = (m) => m.legal.find((s) => s.title === 'תנאים מיוחדים')?.items || [];
  const bank = draftOf({ ...base, specialClauses: ['ללא Highlights', 'התשלום בהוראת קבע'] }).model;
  assert.equal(paymentLine(bank), 'התשלום בהוראת קבע.');
  assert.ok(special(bank).includes('ללא Highlights'));
  assert.ok(!special(bank).includes('התשלום בהוראת קבע'), 'not said twice');
  assert.equal(paymentLine(draftOf({ ...base, specialClauses: ["צ'קים"] }).model), "התשלום יתבצע באמצעות צ'קים.");
  assert.equal(paymentLine(draftOf({ ...base, specialClauses: ['פיימנט'] }).model), 'התשלום יתבצע באמצעות פיימנט.');
  assert.equal(paymentLine(draftOf({ ...base, specialClauses: ['במזומן'] }).model), 'התשלום יתבצע במזומן.');
  const only = draftOf({ ...base, specialClauses: ['התשלום בהוראת קבע'] }).model;
  assert.equal(special(only).length, 0, 'no chapter of special terms left with nothing in it');
  for (const terms of [['ללא Highlights'], ['ביטול בהודעה של 30 יום'], ['התשלום יתחיל בחודש הבא'], []]) {
    const m = draftOf({ ...base, ...(terms.length ? { specialClauses: terms } : {}) }).model;
    assert.match(paymentLine(m), /מערכת פיימנט בלבד/, terms.join(','));
  }
});

test('beside an influencer, videos and graphics not written are said in "לבדוק"', () => {
  const r = draftOf({ mode: 'free', influencer: 'simeon', quantities: [{ key: 'videos', value: 40 }], monthlyPrice: 380000 });
  assert.ok(r.check.includes('גרפיקות: לא נכתבו בטקסט, ולכן 35 כמו בחבילה. לבדוק.'), r.check.join(' | '));
  assert.ok(!r.check.some((c) => c.startsWith('סרטונים:')), 'the videos were written');
  const all = draftOf({ mode: 'free', influencer: 'simeon', quantities: [{ key: 'videos', value: 40 }, { key: 'graphics', value: 20 }], monthlyPrice: 380000 });
  assert.ok(!all.check.some((c) => /לא נכתבו בטקסט/.test(c)), all.check.join(' | '));
});

test('a monthly photographer only: no empty "הפקת תוכן ווידאו מקיפה:" heading', () => {
  const m = draftOf({ mode: 'free', influencer: 'none', monthlyShoot: true, monthlyContents: 10, monthlyPrice: 200000, months: 3 }).model;
  assert.ok(m.wording.package.groups.every((g) => g.items.length > 0));
  assert.ok(!m.wording.package.groups.some((g) => g.title === 'הפקת תוכן ווידאו מקיפה:'));
  assert.ok(m.paid.some((p) => p.id === 'photographer' && /10 תכנים/.test(p.detail)), 'the photographer is in the document');
  const full = draftOf({ mode: 'free', influencer: 'natali', quantities: [{ key: 'videos', value: 30 }], monthlyPrice: 320000 }).model;
  assert.equal(full.wording.package.groups[0].title, 'הפקת תוכן ווידאו מקיפה:');
});
