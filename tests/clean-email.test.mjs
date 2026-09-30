// Emails typed on a Hebrew page or phone keyboard can carry invisible direction
// marks; the server refused them ("invalid format"), so "שכחתי סיסמה" failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmail, looksLikeEmail } from '../app/supa.js';
import { cleanEmail as cleanPayouts } from '../app/payouts/client.js';

for (const [name, clean] of [['site', cleanEmail], ['payouts', cleanPayouts]]) {
  test(`${name}: strips direction marks, spaces and case`, () => {
    assert.equal(clean('‏adam@astrateg.com‎'), 'adam@astrateg.com');
    assert.equal(clean(' Adam@Astrateg.COM '), 'adam@astrateg.com');
    assert.equal(clean('‫adam@astrateg.com‬﻿'), 'adam@astrateg.com');
    assert.equal(clean('ａｄａｍ@astrateg.com'), 'adam@astrateg.com'); // full-width letters
    assert.equal(clean(null), '');
    assert.ok(looksLikeEmail(clean('‏adam@astrateg.com')));
  });
}
