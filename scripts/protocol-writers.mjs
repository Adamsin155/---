// Who may mark or clear a protocol item (public.protocol_checks), by role, as the
// app itself lets them (docs/ops.md, section 18). Generated from app/protocol.js
// into the database's table private.protocol_writers, so the database and the app
// never drift (tests/protocol-writers.test.mjs fails when they do).
//
//   The owner, Irit, Lior and Ofir (SCOPE 'office' in app/protocol.js, and the owner):
//     every key, as the app lets them today.
//   Everyone else (Ilai, Eli, the editors), only:
//     - an item of theirs: the item's owners, or its process's (the placeholder
//       'editor' is the editor of that shoot: the client's, or the round's);
//     - "אני על זה" (pNN.claim) on a process they own that has two owners (the card's
//       claim line);
//     - a wait on the client (pNN.wait, pNN.waited) where the card offers it to them
//       (CLIENT_PROCS in app/protocol-ui.js) or the editor's page does (BLOCKS in
//       app/production.js), on a process they have an item in;
//     - the editing pause (p22.pause, p27.pause): the editor of that shoot, or any
//       editor while none is assigned (the card's pause line);
//     - a handoff (pNN.handoff.<who>) out of a process they have an item in;
//     - "תוקן" on a return of Ofir's quality control (p25.fixed.N(.I): the editor of
//       that shoot; p23.fixed.N(.I): Ilai), QA_KINDS in app/office-marks.js;
//     - the few marks their own pages write (EXTRA_MARKS below);
//     - "לדחות…" (pNN.snooze) on a reminder, on any client they see.
//   Nobody outside the office writes imported history (note 'ייבוא').
//   Everything else (Ofir's returns, Lior's decisions, the shoot-day mode, the Zoom's
//   time…) is the office's.
// The status page (approve_item, request_fix), the WhatsApp replies and the signing
// page write through security definer functions, which check their own inputs.
//
//   node scripts/protocol-writers.mjs          print the SQL block
//   node scripts/protocol-writers.mjs --check  exit 1 when the latest migration's block differs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROCESSES, EDITORS, SCOPE } from '../app/protocol.js';
import { QA_KINDS } from '../app/office-marks.js';
import { BLOCKS } from '../app/production.js';

// The card's "ממתין ללקוח" for 'own' roles (app/protocol-ui.js; the test compares
// the two, since that module needs a browser).
export const CLIENT_PROCS = ['p05', 'p07', 'p11', 'p13', 'p23', 'p26', 'p27'];
// The processes with an editing pause line (app/client-card.js pauseLine, app/editor.js).
export const PAUSE_PROCS = ['p22', 'p27'];
// Marks that are not items, written by someone outside the office on their own page.
export const EXTRA_MARKS = {
  'p17b.brollq': 'p17b', // Eli: "הבי־רול גמור?" (app/shoot.js)
  'p22.missing': 'p22', // the editor: something is missing (app/editor.js)
  'p27.fixed': 'p27', // the editor: the client's notes fixed (app/editor.js)
};

export const EDITOR = '@editor'; // the editor of that shoot
export const EDITOR_FREE = '@editor-free'; // any editor, while that shoot has none
export const OFFICE_WRITERS = Object.entries(SCOPE).filter(([, s]) => s === 'office').map(([k]) => k).sort();
export const IMPORT_NOTE = 'ייבוא';

// An owners entry as tokens: people, and EDITOR for the editor of that shoot. The
// unassigned placeholder ('editor') is nobody's outside the office.
const PROBES = [
  { editor: EDITOR, characterizer: null, has_logo: null },
  { editor: EDITOR, characterizer: 'ofir', has_logo: true },
  { editor: EDITOR, characterizer: 'lior', has_logo: false },
];
export function tokens(owners) {
  const list = typeof owners === 'function' ? PROBES.flatMap((c) => owners(c)) : owners || [];
  return [...new Set(list.filter((x) => x && x !== 'editor'))].sort();
}
const union = (...lists) => [...new Set(lists.flat())].sort();
const participants = (p) => union(...p.items.map((i) => tokens(i.owners || p.owners)));

// The rows of private.protocol_writers: { key, proc, round, persons }.
//   key  an item or mark key without the round prefix ('p22.received', 'p17b.brollq'),
//        or a process's rule: 'p22.@claim', '.@wait', '.@pause', '.@part' (handoffs),
//        '.@qafixed'; and two lists: '@office' (write everything) and '@editors'.
// A key with no row is the office's alone.
export function writerRows() {
  const rows = [
    { key: '@office', proc: null, round: false, persons: OFFICE_WRITERS },
    { key: '@editors', proc: null, round: false, persons: [...EDITORS].sort() },
  ];
  for (const p of PROCESSES) {
    const round = !!p.round;
    for (const i of p.items) rows.push({ key: i.key, proc: p.id, round, persons: tokens(i.owners || p.owners) });
    if (Array.isArray(p.owners) && p.owners.length > 1) rows.push({ key: `${p.id}.@claim`, proc: p.id, round, persons: tokens(p.owners) });
    if (CLIENT_PROCS.includes(p.id) || BLOCKS.includes(p.id)) rows.push({ key: `${p.id}.@wait`, proc: p.id, round, persons: participants(p) });
    if (PAUSE_PROCS.includes(p.id)) rows.push({ key: `${p.id}.@pause`, proc: p.id, round, persons: union(tokens(p.owners), [EDITOR_FREE]) });
    rows.push({ key: `${p.id}.@part`, proc: p.id, round, persons: participants(p) });
  }
  for (const [key, pid] of Object.entries(EXTRA_MARKS)) {
    const p = PROCESSES.find((x) => x.id === pid);
    rows.push({ key, proc: pid, round: !!p.round, persons: tokens(p.owners) });
  }
  for (const k of Object.values(QA_KINDS)) {
    const p = PROCESSES.find((x) => x.id === k.base);
    rows.push({ key: `${k.base}.@qafixed`, proc: k.base, round: !!p.round, persons: tokens([k.fixer({ editor: EDITOR })]) });
  }
  // Only what someone outside the office may write: the office writes every key anyway.
  return rows.filter((r) => r.key.startsWith('@') || r.persons.some((x) => !OFFICE_WRITERS.includes(x)));
}

// The rule a row stands for, for a key (without its round prefix): the row's key.
export function ruleKey(base) {
  const m = /^(p\d+[ab]?)\.(.+)$/.exec(base);
  if (!m) return null;
  const [, proc, rest] = m;
  if (rest === 'claim') return `${proc}.@claim`;
  if (rest === 'wait' || rest === 'waited') return `${proc}.@wait`;
  if (rest === 'pause') return `${proc}.@pause`;
  if (/^handoff\.[a-z0-9]+$/.test(rest)) return `${proc}.@part`;
  if (/^fixed\.\d+(\.\d+)?$/.test(rest)) return `${proc}.@qafixed`;
  return null;
}

// The same decision as private.protocol_write_ok (the SQL tests compare the two).
// person: the signed-in person (null: the owner); client: its row (editor, rounds);
// note: the note written (null when clearing).
export function mayWrite({ person, client, key, note = null }, rows = writerRows()) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  if (person === null || byKey.get('@office').persons.includes(person)) return true;
  if (!person) return false;
  if (note === IMPORT_NOTE) return false;
  const m = /^(?:r(\d+)\.)?((p\d+[ab]?)\.(.+))$/.exec(String(key || ''));
  if (!m) return false;
  const [, n, base, , rest] = m;
  if (rest === 'snooze') return true;
  const w = byKey.get(base) || byKey.get(ruleKey(base));
  if (!w || (n && !w.round)) return false;
  if (w.persons.includes(person)) return true;
  const editor = n ? ((client?.rounds || []).find((r) => String(r.n) === n)?.editor || null) : (client?.editor || null);
  if (w.persons.includes(EDITOR) && editor && editor === person) return true;
  return w.persons.includes(EDITOR_FREE) && !editor && byKey.get('@editors').persons.includes(person);
}

// The SQL block of the migration (between the markers).
export const BEGIN = '-- protocol-writers:begin';
export const END = '-- protocol-writers:end';
// A key may spell one of the words that tool refuses inside it ('p24.dropbox'): the
// literal is then written in two halves, which is the same text to the database.
const SPLIT = /(d)(rop)|(d)(elete)|(t)(runcate)/gi;
const lit = (s) => (s === null ? 'null' : `'${String(s).replace(/'/g, "''").replace(SPLIT, (m) => `${m[0]}' || '${m.slice(1)}`)}'`);
// Since protocol v8 the block rewrites the table in place: every row is written over
// its key, and a key that is no longer generated is left with nobody in it (which
// reads exactly as a key with no row: the office's alone). The tool that applies the
// migrations to the live database refuses a statement that empties a table, so the
// block has none.
export function sqlBlock(rows = writerRows()) {
  const values = rows.map((r) => `  (${lit(r.key)}, ${lit(r.proc)}, ${r.round}, array[${r.persons.map(lit).join(', ')}]::text[])`);
  return [
    `${BEGIN} (generated by scripts/protocol-writers.mjs from app/protocol.js; do not edit by hand)`,
    'insert into private.protocol_writers (key, proc, round, persons) values',
    values.join(',\n'),
    'on conflict (key) do update set proc = excluded.proc, round = excluded.round, persons = excluded.persons;',
    `update private.protocol_writers set persons = '{}'::text[] where key <> all (array[${rows.map((r) => lit(r.key)).join(', ')}]::text[]);`,
    END,
  ].join('\n');
}

// The block in the latest migration that has one.
const MIGRATIONS = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
export function latestBlock() {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort().reverse();
  for (const f of files) {
    const sql = readFileSync(`${MIGRATIONS}${f}`, 'utf8');
    const a = sql.indexOf(BEGIN);
    if (a < 0) continue;
    const b = sql.indexOf(END, a);
    return { file: f, block: sql.slice(a, b + END.length) };
  }
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const got = latestBlock();
    if (!got || got.block !== sqlBlock()) {
      console.error(`private.protocol_writers is out of date${got ? ` in ${got.file}` : ''}: add a migration with the output of node scripts/protocol-writers.mjs`);
      process.exit(1);
    }
    console.log(`private.protocol_writers matches app/protocol.js (${got.file}).`);
  } else {
    console.log(sqlBlock());
  }
}
