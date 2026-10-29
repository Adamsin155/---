// "למי לשלוח את הדיווח?" (the owner, 29.10.2026): the editor's report of something missing
// (p22.missing) may name Irit, Lior or Ofir. The database part, with every migration
// (tests/sql/pg.mjs): each of the four editors (ניראל, יריב, אנה, נדיה) writes the report
// and the "לא התקבל" of a start check on their own client only, and the reminder rules
// (app/production.js reportTo) read a recipient from it that is one of the three, never
// anyone else, whatever the note says.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, as } from './pg.mjs';
import { reportOf, rowReportNote } from '../../app/production.js';

let db;
const users = {};
const ids = {};
const EDITORS = ['nadia', 'yariv', 'anna', 'nirel'];

before(async () => {
  db = await freshDatabase();
  for (const person of [...EDITORS, 'irit']) {
    const email = `${person}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[person] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, false)', [email, person]);
  }
  // Nirel on a Natali day, the others on a regular shoot.
  for (const editor of EDITORS) {
    const { rows } = await db.query('insert into public.clients (name, shoot_type, editor) values ($1, $2, $3) returning id',
      [`client of ${editor}`, editor === 'nirel' ? 'natali' : 'dms', editor]);
    ids[editor] = rows[0].id;
  }
});

const q = (who, sql, params = []) => as(db, users[who], async (tx) => (await tx.query(sql, params)).rows);
const report = (to) => rowReportNote({}, '', 'logo', { note: 'מטושטש', to });

for (const editor of EDITORS) {
  test(`${editor}: reports on their own client, to Lior and then to Ofir; the recipient read back is the one chosen`, async () => {
    for (const to of ['lior', 'ofir']) {
      const out = await q(editor, `insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22.missing', 'done', $2)
        on conflict (client_id, item_key) do update set note = excluded.note returning item_key, note, by_email, at`, [ids[editor], report(to)]);
      assert.equal(out.error, undefined, JSON.stringify(out));
      assert.equal(out[0].by_email, `${editor}@astrateg.test`);
      assert.equal(reportOf({ 'p22.missing': { ...out[0], state: 'done' } }).to, to);
    }
    // The row's "סיימתי" once it arrived.
    const ok = await q(editor, "insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p22.check.logo', 'done') returning item_key", [ids[editor]]);
    assert.equal(ok.error, undefined, JSON.stringify(ok));
  });

  test(`${editor}: cannot report on another editor's client`, async () => {
    const other = EDITORS.find((e) => e !== editor);
    const out = await q(editor, "insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22.missing', 'done', $2) returning item_key", [ids[other], report('lior')]);
    assert.ok(out.error || out.length === 0, `${editor} wrote on ${other}'s client`);
  });
}

test('a recipient outside the three, written by hand into the note, reads as Irit', async () => {
  for (const to of ['owner', 'stav', 'nadia', 'x@y.z']) {
    const note = JSON.stringify({ what: ['logo'], going: true, to });
    const out = await q('nadia', `insert into public.protocol_checks (client_id, item_key, state, note) values ($1, 'p22.missing', 'done', $2)
      on conflict (client_id, item_key) do update set note = excluded.note returning item_key, note, at`, [ids.nadia, note]);
    assert.equal(reportOf({ 'p22.missing': { ...out[0], state: 'done' } }).to, 'irit');
  }
});
