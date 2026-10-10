// Who writes which protocol item (scripts/protocol-writers.mjs → private.protocol_writers
// in the latest migration that seeds it; docs/ops.md, section 18). Fails when
// app/protocol.js changes and the database's table was not regenerated, or when an
// app page starts writing a mark the rule does not know about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  writerRows, mayWrite, sqlBlock, latestBlock, ruleKey, CLIENT_PROCS, PAUSE_PROCS, EXTRA_MARKS, EDITOR, EDITOR_FREE,
} from '../scripts/protocol-writers.mjs';
import { PROCESSES } from '../app/protocol.js';

const APP = new URL('../app/', import.meta.url);
const src = (f) => readFileSync(new URL(f, APP), 'utf8');

test('the latest migration seeds private.protocol_writers exactly as app/protocol.js says', () => {
  const got = latestBlock();
  assert.ok(got, 'no migration seeds private.protocol_writers');
  assert.equal(got.block, sqlBlock(), `regenerate: node scripts/protocol-writers.mjs, into a new migration after ${got.file}`);
});

test('the lists copied from browser modules are the same as there', () => {
  const m = /export const CLIENT_PROCS = new Set\(\[([^\]]*)\]\)/.exec(src('protocol-ui.js'));
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/'/g, '')), CLIENT_PROCS);
  // The pause line: the card (pid p22 or p27) and the editor's page (p22.pause).
  assert.match(src('client-card.js'), /pid === 'p22' \|\| pid === 'p27' \? pauseLine\(x\)/);
  assert.deepEqual(PAUSE_PROCS, ['p22', 'p27']);
  for (const k of Object.keys(EXTRA_MARKS)) {
    // The photographer's marks (the key of the raw material per script is a constant of production.js, which shoot.js writes); the editor's.
    const file = k === 'p18b.files' ? 'production.js' : /^p1[678]/.test(k) ? 'shoot.js' : 'editor.js';
    assert.ok(src(file).includes(`'${k}'`), `${k} is written in ${file}`);
  }
});

// Marks that are not items and that only the office writes (no row: denied to the rest).
// (p07.moved is written once, by the migration of protocol v9: no page writes it.)
// (p13.left, protocol v10: Lior says that fixes remained after the Zoom.)
const OFFICE_ONLY = new Set(['p04.ended', 'p07.moved', 'p13.left', 'p13.zoomat', 'p14.seen', 'p16.brief', 'p18.quiet', 'p18.shot', 'p22.decision', 'p22a.reason', 'p22a.shift']);
test('every mark an app page writes is an item, a known rule, a listed extra mark, or the office\'s', () => {
  const items = new Set(PROCESSES.flatMap((p) => p.items.map((i) => i.key)));
  const unknown = [];
  for (const f of readdirSync(APP).filter((x) => x.endsWith('.js'))) {
    const code = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'); // not the comments
    for (const m of code.matchAll(/['`](p\d+[ab]?\.[a-z0-9.]*[a-z0-9])['`]/g)) {
      const k = m[1];
      if (items.has(k) || k in EXTRA_MARKS || OFFICE_ONLY.has(k) || ruleKey(k) || /\.snooze$/.test(k)) continue;
      if ([...items].some((i) => i.startsWith(`${k}.`))) continue; // a prefix of items ('p23.q')
      unknown.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(unknown, [], 'a new mark: add it to EXTRA_MARKS (someone outside the office writes it) or OFFICE_ONLY here');
});

const dana = { editor: 'nadia', rounds: [{ n: 2, editor: 'yariv' }, { n: 3 }] };
const cases = [
  // [person, key, client, note, expected]
  [null, 'p25.approved', dana, null, true],
  ['irit', 'p27.toilai', dana, null, true],
  ['lior', 'p13.zoomat', dana, 'ייבוא', true],
  ['nadia', 'p22.received', dana, null, true],
  ['nadia', 'p25.approved', dana, null, false],
  ['nadia', 'p27.toilai', dana, null, false],
  ['nadia', 'p25.return.1', dana, null, false],
  ['nadia', 'p25.fixed.1', dana, null, true],
  ['nadia', 'p25.fixed.1.3', dana, null, true],
  ['nadia', 'p22.received', dana, 'ייבוא', false],
  ['nadia', 'r2.p22.received', dana, null, false],
  ['yariv', 'r2.p22.received', dana, null, true],
  ['yariv', 'r3.p22.pause', dana, null, true], // round 3 has no editor: any editor may pause
  ['yariv', 'r3.p22.received', dana, null, false],
  ['eli', 'r2.p17b.arrived', dana, null, true],
  ['eli', 'p17b.brollq', dana, null, true],
  ['eli', 'p18.quiet', dana, null, false],
  ['ilai', 'p27.toilai', dana, null, true],
  ['ilai', 'p29.claim', dana, null, true],
  ['ilai', 'p23.return.1', dana, null, false],
  ['ilai', 'r2.p07.made', dana, null, false],
  ['ilai', 'p07.sent', dana, null, false],
  ['anna', 'p05.snooze', dana, null, true],
  ['anna', 'p05.access', dana, null, false],
  [undefined, 'p22.received', dana, null, false],
];
test('mayWrite: the office everything; the rest their own items and marks', () => {
  for (const [person, key, client, note, want] of cases) assert.equal(mayWrite({ person, client, key, note }), want, `${person} ${key} ${note}`);
});

test('the table\'s tokens: people, the editor of that shoot, and any editor while it has none', () => {
  const people = new Set(['irit', 'lior', 'ofir', 'ilai', 'eli', 'nirel', 'nadia', 'yariv', 'anna', EDITOR, EDITOR_FREE]);
  for (const r of writerRows()) for (const p of r.persons) assert.ok(people.has(p), `${r.key}: ${p}`);
  // The placeholder of an unassigned editor is nobody's.
  assert.ok(!writerRows().some((r) => r.persons.includes('editor')));
});
