// "תיקיית הדרייב" on the content Gantt (docs/ops.md, section 132): the pasted link is read as the
// drive function reads it, kept in one form, and saved over the client's links without touching
// the others (the replaced folder goes to drive_old).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFolderLink, withFolder, folderIdOf as appFolderIdOf } from '../app/drive-folder.js';
import { folderIdOf } from '../supabase/functions/_shared/drive.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-012';
const URL1 = `https://drive.google.com/drive/folders/${ID}`;

test('a folder link, in every form Drive gives, is kept as /drive/folders/<id>', () => {
  for (const v of [
    URL1, `  ${URL1}  `, `${URL1}?usp=sharing`, `${URL1}?usp=drive_link`, `https://drive.google.com/drive/u/0/folders/${ID}`,
    `https://drive.google.com/drive/u/1/folders/${ID}?usp=sharing#x`, `https://drive.google.com/open?id=${ID}`,
  ]) assert.deepEqual(readFolderLink(v), { url: URL1 }, v);
});

test('a Drive folder with ?resourcekey= (or another query) is kept without it', () => {
  for (const v of [`${URL1}?resourcekey=0-AbCdEf_123`, `${URL1}?usp=sharing&resourcekey=0-AbC`, `https://drive.google.com/drive/u/0/folders/${ID}?resourcekey=0-x#y`, `${URL1}?token=abc`]) {
    assert.deepEqual(readFolderLink(v), { url: URL1 }, v);
  }
});

test('the id is the one the drive function reads', () => {
  for (const v of [URL1, `${URL1}?usp=sharing`, `https://drive.google.com/drive/u/0/folders/${ID}`, `https://drive.google.com/open?id=${ID}`,
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view', 'https://docs.google.com/document/d/1AbCdEfGhIjKl/edit', 'http://drive.google.com/drive/folders/1AbCdEfGhIjKl']) {
    assert.equal(appFolderIdOf(v), folderIdOf(v), v);
  }
});

test('anything else is refused, in Hebrew', () => {
  const cases = {
    '': /הדביקו/,
    '   ': /הדביקו/,
    'drive.google.com/drive/folders/1AbCdEfGhIjKl': /https:\/\//,
    [ID]: /https:\/\//, // a bare id: the full address is asked for
    'http://drive.google.com/drive/folders/1AbCdEfGhIjKl': /https:\/\//,
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing': /לא קישור לתיקייה/,
    'https://docs.google.com/document/d/1AbCdEfGhIjKl/edit': /לא קישור לתיקייה/,
    'https://www.dropbox.com/sh/abc/folders/1AbCdEfGhIjKl': /לא קישור לתיקייה/,
    'https://drive.google.com.evil.example/drive/folders/1AbCdEfGhIjKl': /לא קישור לתיקייה/,
    'https://drive.google.com/drive/folders/short': /לא קישור לתיקייה/,
    'https://drive.google.com/drive/my-drive': /לא קישור לתיקייה/,
    'https://user:pw@drive.google.com/drive/folders/1AbCdEfGhIjKl': /סיסמאות/,
    'https://user:pw@drive.google.com/drive/folders/1AbCdEfGhIjKl?usp=sharing': /סיסמאות/,
    'https://example.com/folder?token=abc': /סיסמאות/,
    'https://docs.google.com/document/d/1AbCdEfGhIjKl/edit?resourcekey=0-abc': /סיסמאות/,
    'https://www.dropbox.com/s/x?password=1': /סיסמאות/,
  };
  for (const [v, re] of Object.entries(cases)) {
    const got = readFolderLink(v);
    assert.equal(got.url, undefined, v);
    assert.match(got.error, re, v);
    assert.match(got.error, /[א-ת]/);
  }
});

test('the first folder: only drive is set, every other key stays', () => {
  const links = { whatsapp: 'https://chat.whatsapp.com/x', scripts_doc: 'https://docs.google.com/document/d/abc', custom: 'k' };
  const out = withFolder(links, URL1);
  assert.deepEqual(out, { ...links, drive: URL1 });
  assert.equal('drive_old' in out, false);
  assert.deepEqual(links, { whatsapp: 'https://chat.whatsapp.com/x', scripts_doc: 'https://docs.google.com/document/d/abc', custom: 'k' }, 'not changed in place');
  assert.deepEqual(withFolder(null, URL1), { drive: URL1 });
  assert.deepEqual(withFolder(undefined, URL1), { drive: URL1 });
  assert.deepEqual(withFolder({ drive: '  ' }, URL1), { drive: URL1 });
});

test('a replace keeps the folder before in drive_old', () => {
  const OLD = 'https://drive.google.com/drive/folders/0OldOldOldOld?usp=sharing';
  const links = { drive: OLD, drive_old: 'https://drive.google.com/drive/folders/0Older0Older0', metricool: 'https://app.metricool.com/x' };
  assert.deepEqual(withFolder(links, URL1), { drive: URL1, drive_old: OLD, metricool: 'https://app.metricool.com/x' });
  // The same folder again: nothing moves to drive_old.
  assert.deepEqual(withFolder({ drive: URL1, drive_old: OLD }, URL1), { drive: URL1, drive_old: OLD });
  // No folder now but one from before: drive_old stays.
  assert.deepEqual(withFolder({ drive_old: OLD }, URL1), { drive: URL1, drive_old: OLD });
});
