// "כל הסרטונים הועלו לדרייב" (step 24, p24.drive) only when the client's Drive has the videos (the
// owner, 17.11.2026; app/drive-guard-logic.js; docs/ops.md, section 140): what the mark needs, the
// edited videos of a listing, the verdict and its words. Invented clients; Monday 17.11.2026 in Israel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDriveKey, neededFor, editedOnDrive, driveVerdict, shortText, cannotCheck, CLOSING } from '../app/drive-guard-logic.js';
import { fileClass, kindOf } from '../app/drive-class.js';
import * as shared from '../supabase/functions/_shared/drive.js';

const NOW = new Date('2026-11-17T12:00:00+02:00');
const base = (over = {}) => ({
  id: 'c1', name: 'נקי', business: 'ניקיון והיגיינה', status: 'active', editor: 'yariv', editor2: null, rounds: [],
  deal_at: '2026-10-01T09:00:00+03:00', deliverables: { videos: 48, shoot_days: 1 }, ...over,
});
const vid = (name, at, path = '') => ({ name, mimeType: 'video/mp4', createdTime: at, path });
const many = (n, at = '2026-11-04T10:00:00Z', path = 'סרטונים') => Array.from({ length: n }, (_, i) => vid(`${i + 1}.mp4`, at, path));

test('the mark: p24.drive of the client\'s own shoot, of a round', () => {
  assert.equal(isDriveKey('p24.drive'), true);
  assert.equal(isDriveKey('r3.p24.drive'), true);
  assert.equal(isDriveKey('p24.folder'), false);
  assert.equal(isDriveKey('p24.drive.x'), false);
  assert.equal(isDriveKey(null), false);
});

test('what the mark needs: the shoot\'s part; a round: the shoots up to it, never above the package; a monthly round: its month', () => {
  assert.deepEqual(neededFor(base(), 'p24.drive', NOW), { needed: 48, month: null });
  // Two shoot days: 24 a shoot; the second shoot: 48 together.
  const two = base({ deliverables: { videos: 47, shoot_days: 2 }, rounds: [{ n: 2, shoot_at: '2026-11-10T10:00:00+02:00', editor: 'nadia' }] });
  assert.deepEqual(neededFor(two, 'p24.drive', NOW), { needed: 24, month: null });
  assert.deepEqual(neededFor(two, 'r2.p24.drive', NOW), { needed: 47, month: null }, '24 + 24, capped at the package');
  // Two editors with a split: their total.
  const split = base({ editor2: 'nadia', editor_split: { yariv: 20, nadia: 16 }, deliverables: { videos: 72, shoot_days: 2 } });
  assert.deepEqual(neededFor(split, 'p24.drive', NOW), { needed: 36, month: null });
  // A monthly round: that month's number, only that month's files.
  const monthly = base({ deliverables: { videos_month: 8, videos_month_except: { '2026-11': 10 } }, rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'yariv' }] });
  assert.deepEqual(neededFor(monthly, 'r2.p24.drive', NOW), { needed: 10, month: '2026-11' });
  // A monthly client's own first shoot without a package number: this month's.
  assert.deepEqual(neededFor(monthly, 'p24.drive', NOW), { needed: 10, month: null });
  // No number anywhere: not known (the verdict asks for at least one video).
  assert.deepEqual(neededFor(base({ deliverables: {} }), 'p24.drive', NOW), { needed: null, month: null });
});

test('the edited videos of a listing: videos not in a footage folder, added on or after the deal day', () => {
  const c = base();
  const files = [
    vid('a.mp4', '2026-11-04T10:00:00Z'),                       // the folder itself
    vid('b.mp4', '2026-11-04T10:00:00Z', 'סרטונים ערוכים'),
    vid('c.mov', '2026-11-04T10:00:00Z', 'גלם יום 1/סופי'),     // "סופי" in a footage folder: edited
    vid('raw.mp4', '2026-10-10T10:00:00Z', 'גלם יום 1'),        // footage
    vid('cam.mp4', '2026-10-10T10:00:00Z', 'יום צילום 2'),      // footage
    vid('old.mp4', '2026-09-30T20:00:00Z'),                     // 30.9 23:00 in Israel: before the deal day
    vid('deal.mp4', '2026-09-30T21:30:00Z'),                    // 1.10 00:30 in Israel: the deal day counts
    { name: 'cover.png', mimeType: 'image/png', createdTime: '2026-11-04T10:00:00Z', path: 'גרפיקות' },
    { name: 'סרטונים', mimeType: 'application/vnd.google-apps.folder', createdTime: '2026-11-04T10:00:00Z', path: '' },
    { name: 'x.mp4', mimeType: 'video/mp4', createdTime: null, path: '' },
  ];
  assert.equal(editedOnDrive(files, c), 4);
  assert.equal(editedOnDrive(files, c, { month: '2026-11' }), 3);
  assert.equal(editedOnDrive(null, c), 0);
});

test('the verdict and its words: refused below the need, taken at it', () => {
  const c = base();
  const short = driveVerdict(c, 'p24.drive', { files: many(31) }, NOW);
  assert.equal(short.ok, false);
  assert.equal(short.say, 'בדרייב יש 31 סרטונים ערוכים מתוך 48. אפשר לסמן רק אחרי שכולם עלו לדרייב.');
  assert.deepEqual(driveVerdict(c, 'p24.drive', { files: many(48) }, NOW), { ok: true, count: 48, needed: 48 });
  assert.equal(driveVerdict(c, 'p24.drive', { files: many(60) }, NOW).ok, true);
  // Footage does not fill it.
  assert.equal(driveVerdict(c, 'p24.drive', { files: [...many(31), ...many(40, '2026-11-04T10:00:00Z', 'גלם')] }, NOW).ok, false);
  // The words for none, one, a month, and a folder too big to list whole.
  assert.equal(shortText(0, 48), `בדרייב עוד אין סרטונים ערוכים (צריך 48). ${CLOSING}`);
  assert.equal(shortText(1, 48), `בדרייב יש סרטון ערוך אחד מתוך 48. ${CLOSING}`);
  assert.equal(shortText(3, 8, { month: true }), `בדרייב יש 3 סרטונים ערוכים החודש מתוך 8. ${CLOSING}`);
  assert.match(driveVerdict(c, 'p24.drive', { files: many(10), truncated: true }, NOW).say, /לא כל הקבצים נבדקו/);
  // Nothing known about the package: at least one video.
  const unknown = base({ deliverables: {} });
  assert.equal(driveVerdict(unknown, 'p24.drive', { files: [] }, NOW).ok, false);
  assert.equal(driveVerdict(unknown, 'p24.drive', { files: many(1) }, NOW).ok, true);
  // A monthly round: this month's files only.
  const monthly = base({ deliverables: { videos_month: 8 }, rounds: [{ n: 2, month: '2026-11', monthly: true, editor: 'yariv' }] });
  assert.equal(driveVerdict(monthly, 'r2.p24.drive', { files: [...many(5, '2026-10-20T10:00:00Z'), ...many(7)] }, NOW).say,
    `בדרייב יש 7 סרטונים ערוכים החודש מתוך 8. ${CLOSING}`);
  assert.equal(cannotCheck('אין קישור לתיקיית הדרייב בכרטיס הלקוח.'), 'לא סומן: אי אפשר לבדוק עכשיו שכל הסרטונים בדרייב. אין קישור לתיקיית הדרייב בכרטיס הלקוח.');
});

test('the app and the functions class the files with one rule', () => {
  // The functions' copy (node scripts/sync-functions.mjs) answers the same for every folder kind.
  for (const [m, p] of [['video/mp4', ''], ['video/mp4', 'גלם'], ['video/mp4', 'גלם/סופי'], ['image/jpeg', 'תמונות'], ['image/png', 'היילייטס'], ['application/pdf', ''], ['application/vnd.google-apps.folder', '']]) {
    assert.equal(shared.fileClass(m, p), fileClass(m, p));
    assert.equal(shared.kindOf(m), kindOf(m));
  }
  assert.equal(fileClass('video/mp4', 'גלם יום 1'), 'raw');
  assert.equal(fileClass('video/mp4', 'גלם יום 1/סופי'), 'video');
  assert.equal(fileClass('video/mp4', ''), 'video');
  assert.equal(fileClass('image/png', 'גרפיקות'), 'graphic');
});
