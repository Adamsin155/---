// "קוד הכספת" (app/vault-code.js): what counts as a code, which codes are too weak,
// the words of the dialog and of the owner's card. The database decides everything
// (tests/sql/vault-code.test.mjs); these are the same checks before a code is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCode, weakCode, newCodeProblem, leftText, isOpen, openText, unlockMessage, codeStateText, setError, CODE_LENGTH, UNLOCK_MINUTES, MAX_WRONG, LOCKOUT_MINUTES } from '../app/vault-code.js';

test('a code is exactly 6 digits', () => {
  assert.deepEqual([CODE_LENGTH, UNLOCK_MINUTES, MAX_WRONG, LOCKOUT_MINUTES], [6, 10, 5, 15]);
  for (const ok of ['483920', '000001', '909090']) assert.equal(isCode(ok), true, ok);
  for (const bad of ['', '48392', '4839201', '48392a', ' 483920', '４８３９２０', null, undefined, 483920.5]) assert.equal(isCode(bad), false, String(bad));
});

test('trivially weak codes are refused: one digit, and runs up or down', () => {
  for (const weak of ['000000', '111111', '999999', '123456', '654321', '012345', '456789', '987654', '543210', '890123', '901234', '210987', '12345', 'abcdef']) assert.equal(weakCode(weak), true, weak);
  for (const fine of ['483920', '112233', '135790', '121212', '100000', '123457', '654320']) assert.equal(weakCode(fine), false, fine);
});

test('the owner\'s new code: typed twice, with a plain Hebrew reason when it is refused', () => {
  assert.equal(newCodeProblem('', ''), 'הקלידו קוד של 6 ספרות.');
  assert.equal(newCodeProblem('1234', '1234'), 'הקוד הוא בדיוק 6 ספרות.');
  assert.match(newCodeProblem('123456', '123456'), /קל מדי לניחוש/);
  assert.equal(newCodeProblem('483920', '483921'), 'שני הקודים לא זהים.');
  assert.equal(newCodeProblem('483920', '483920'), null);
  assert.equal(setError(new Error('weak code')), 'הקוד קל מדי לניחוש. בחרו קוד אחר.');
  assert.equal(setError(new Error('not allowed: owner only')), 'רק בעל המשרד מגדיר את קוד הכספת.');
});

test('the dialog: wrong code with what is left, the lockout, and the open line', () => {
  const now = new Date('2026-10-11T10:00:00+03:00');
  assert.equal(unlockMessage({ state: 'wrong', left: 4 }, now), 'קוד שגוי. נותרו 4 ניסיונות.');
  assert.equal(unlockMessage({ state: 'wrong', left: 1 }, now), 'קוד שגוי. נותר ניסיון אחד.');
  assert.equal(unlockMessage({ state: 'locked', until: '2026-10-11T10:15:00+03:00' }, now), 'ננעל ל־15 דקות אחרי 5 קודים שגויים.');
  assert.equal(unlockMessage({ state: 'locked', until: '2026-10-11T10:06:10+03:00' }, now), 'ננעל. אפשר לנסות שוב בעוד 7 דקות.');
  assert.equal(unlockMessage(null, now), 'הקוד לא נבדק. נסו שוב.');
  assert.equal(leftText('2026-10-11T10:10:00+03:00', now), '10:00');
  assert.equal(leftText('2026-10-11T10:09:59+03:00', now), '09:59');
  assert.equal(leftText('2026-10-11T09:59:00+03:00', now), '00:00');
  assert.equal(openText('2026-10-11T10:02:05+03:00', now), 'הכספת פתוחה עוד 02:05');
});

test('until a code is set nothing is locked; with a code, only a live unlock opens', () => {
  const now = new Date('2026-10-11T10:00:00+03:00');
  assert.equal(isOpen({ set: false }, now), true);
  assert.equal(isOpen(null, now), true);
  assert.equal(isOpen({ set: true, openUntil: null }, now), false);
  assert.equal(isOpen({ set: true, openUntil: '2026-10-11T10:05:00+03:00' }, now), true);
  assert.equal(isOpen({ set: true, openUntil: '2026-10-11T09:59:59+03:00' }, now), false);
  const day = () => '11.10.2026';
  assert.match(codeStateText({ set: false }, day), /עוד לא הוגדר קוד\. הכספת עובדת כמו עד היום/);
  assert.equal(codeStateText({ set: true, changedAt: 'x' }, day), 'הוגדר קוד. שונה לאחרונה ב־11.10.2026.');
});
