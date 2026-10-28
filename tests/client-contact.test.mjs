// The client's email and company number in the client's details (the owner, 28.10.2026;
// app/client-contact.js): what the office may type, and what is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyIdValue, emailValue } from '../app/client-contact.js';

test('ח.פ / ת.ז: 9 digits, spaces and dashes taken away, an 8-digit ID number gets its zero', () => {
  for (const [typed, kept] of [['514729938', '514729938'], ['51-472-993-8', '514729938'], [' 514 729 938 ', '514729938'], ['51.472.9938', '514729938'],
    ['12345678', '012345678'], ['012345678', '012345678'], ['', null], ['   ', null], [null, null]]) {
    assert.deepEqual(companyIdValue(typed), { value: kept }, String(typed));
  }
  for (const typed of ['1234567', '1234567890', '51472993a', 'ח.פ 514729938', '+972501234']) {
    assert.match(companyIdValue(typed).error || '', /^ח\.פ \/ ת\.ז: /, typed);
  }
  assert.equal(companyIdValue('1234').error, 'ח.פ / ת.ז: צריך 9 ספרות, ונכתבו 4.');
});

test('the email: loosely an address, kept in lower case', () => {
  for (const [typed, kept] of [['Ruth@Example.co.il', 'ruth@example.co.il'], ['  a.b+c@gmail.com ', 'a.b+c@gmail.com'], ['', null], [undefined, null]]) {
    assert.deepEqual(emailValue(typed), { value: kept }, String(typed));
  }
  for (const typed of ['ruth', 'ruth@', '@x.co', 'ruth@x', 'ru th@x.co', 'a@b@c.co', `${'a'.repeat(250)}@x.co`]) {
    assert.equal(emailValue(typed).error, 'האימייל לא נראה תקין. למשל: name@gmail.com', typed);
  }
});
