// The owner's requests of 27.10.2026, without the DOM: the signed contract as a file
// (app/contract-file.js), the client search of "אפיון חדש" (app/client-search.js) and the
// address of the characterization form alone (app/intake-ui.js). The database side is
// tests/sql/batch-2710.test.mjs; the screens are steps of tests/batch-2710-e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTRACT_KIND, CONTRACT_LABEL, isContractFile, contractFiles, contractFileProblem, CONTRACT_MAX } from '../app/contract-file.js';
import { clientLabel, searchWords, searchClients } from '../app/client-search.js';
import { charEditHref } from '../app/intake-ui.js';
import { KINDS } from '../app/files-logic.js';

test('the contract\'s file: a kind the table has, a label of its own; a PDF or a picture up to 25MB', () => {
  assert.ok(KINDS[CONTRACT_KIND], 'a kind of the client\'s files');
  assert.equal(CONTRACT_LABEL, 'חוזה חתום');
  const f = (kind, label, extra = {}) => ({ id: label + kind, kind, label, created_at: '2026-10-27T10:00:00Z', ...extra });
  assert.equal(isContractFile(f('material_other', 'חוזה חתום')), true);
  assert.equal(isContractFile(f('material_other', ' חוזה חתום ')), true);
  assert.equal(isContractFile(f('material_other', 'תפריט')), false);
  assert.equal(isContractFile(f('logo', 'חוזה חתום')), false);
  assert.equal(isContractFile(f('material_other', 'חוזה חתום', { deleted_at: '2026-10-27' })), false);
  const list = contractFiles([f('material_other', 'חוזה חתום', { id: 'a', created_at: '2026-10-01' }), f('image', 'x'), f('material_other', 'חוזה חתום', { id: 'b', created_at: '2026-10-20' })]);
  assert.deepEqual(list.map((x) => x.id), ['b', 'a']);
  const file = (name, type, size = 1000) => ({ name, type, size });
  assert.equal(contractFileProblem(file('contract.pdf', 'application/pdf')), null);
  assert.equal(contractFileProblem(file('scan.jpg', 'image/jpeg')), null);
  assert.equal(contractFileProblem(file('IMG_1.HEIC', '')), null, 'a phone\'s picture with no type');
  assert.match(contractFileProblem(file('contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), /PDF או תמונה/);
  assert.match(contractFileProblem(file('a.pdf', 'application/pdf', 0)), /ריק/);
  assert.match(contractFileProblem(file('a.pdf', 'application/pdf', CONTRACT_MAX + 1)), /25MB/);
  assert.match(contractFileProblem(null), /לא נבחר/);
});

test('"אפיון חדש": every word typed, in any order, split on spaces; by the business first', () => {
  const list = [
    { id: 1, name: 'רון לוי', business: 'מספרת רון' },
    { id: 2, name: 'דנה כהן', business: 'קפה דנה' },
    { id: 3, name: 'Sushi Bar', business: null },
    { id: 4, name: 'שירן', business: 'שירן' },
  ];
  assert.deepEqual(list.map(clientLabel), ['מספרת רון · רון לוי', 'קפה דנה · דנה כהן', 'Sushi Bar', 'שירן']);
  assert.deepEqual(searchWords('  רון   לוי '), ['רון', 'לוי']);
  // "s" is a letter, not a space (the nudnik's bug of 26.10.2026).
  assert.deepEqual(searchWords('sushi bar'), ['sushi', 'bar']);
  const ids = (q) => searchClients(list, q).map((c) => c.id);
  assert.deepEqual(ids(''), [3, 1, 2, 4].sort((a, b) => clientLabel(list[a - 1]).localeCompare(clientLabel(list[b - 1]), 'he')));
  assert.deepEqual(ids('לוי רון'), [1]);
  assert.deepEqual(ids('דנה'), [2]);
  assert.deepEqual(ids('BAR sushi'), [3]);
  assert.deepEqual(ids('רון כהן'), []);
  assert.equal(searchClients(null, 'x').length, 0);
});

test('the form alone: its address; the button and the page are the four writers\'', () => {
  assert.equal(charEditHref('a b'), 'intake.html?id=a%20b&only=char');
  const card = readFileSync(new URL('../app/intake-ui.js', import.meta.url), 'utf8');
  assert.match(card, /me !== undefined && writesChar\(\{ me, scope \}\)/);
  const page = readFileSync(new URL('../app/intake.js', import.meta.url), 'utf8');
  assert.match(page, /if \(!writesChar\(v\)\)/);
  // Apart from the meeting nothing is marked: the form alone saves the characterization only.
  const only = page.slice(page.indexOf('async function submitCharOnly'), page.indexOf('// ── "אפיון חדש"'));
  assert.match(only, /saveCharacterization\(/);
  assert.doesNotMatch(only, /saveChecks|setCheck|addTask|formChecks/);
});
