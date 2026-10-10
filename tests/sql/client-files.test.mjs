// The client's files (supabase/migrations/20261003110000_client_files.sql) in a real
// Postgres with every migration (tests/sql/pg.mjs; Storage's tables from the stub):
//   - who reads a client's files (whoever sees the client), who uploads which kind
//     (the owner, Irit, Lior, Ofir: all; Ilai: graphics, highlights, site; an editor:
//     videos, for a client assigned to them), in the table and in the bucket alike;
//   - who and when are the database's, the path, client and kind never change, and
//     only the managers or the uploader delete (softly);
//   - the view-only link (a hash in the table, the token in Vault, revocation) and
//     what a token shows through media_for_token (service role only): the
//     deliverables without staff or file names; on the status page the graphics,
//     split between the first 9 (process 7) and the rest (process 23).
// The kinds, the path and the limits are the same as app/files-logic.js.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDatabase, as } from './pg.mjs';
import { KINDS, objectPath, BUCKET, maxBytes } from '../../app/files-logic.js';

let db;
const users = {};
const ids = {};
const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', yariv: 'yariv', nirel: 'nirel', eli: 'eli' };

before(async () => {
  db = await freshDatabase();
  for (const [key, person] of Object.entries(PEOPLE)) {
    const email = `${key}@astrateg.test`;
    const { rows } = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email]);
    users[key] = { id: rows[0].id, email };
    await db.query('insert into public.staff (email, person, vault) values ($1, $2, true)', [email, person]);
  }
  const add = async (name, fields = {}) => {
    const cols = ['name', ...Object.keys(fields)];
    const vals = [name, ...Object.values(fields)];
    const { rows } = await db.query(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals);
    ids[name] = rows[0].id;
  };
  await add('dana', { business: 'קפה דנה', editor: 'nadia', shoot_type: 'dms' });
  await add('ron', { editor: 'yariv', shoot_type: 'dms' });
  await add('nat', { editor: 'anna', shoot_type: 'natali' });
  await add('ended', { status: 'ended', editor: 'nadia' });
});

const run = (who, fn) => as(db, who === 'anon' ? null : users[who], fn);
const q = (who, sql, params = []) => run(who, async (tx) => {
  const r = await tx.query(sql, params);
  return { rows: r.rows, affected: r.affectedRows };
});
// Committed (as() rolls back).
async function keep(who, sql, params = []) {
  const u = who === 'anon' || who === 'service' ? null : users[who];
  const claims = u ? { sub: u.id, email: u.email, role: 'authenticated' } : { role: who === 'service' ? 'service_role' : 'anon' };
  let out;
  await db.transaction(async (tx) => {
    await tx.query(`set local role ${u ? 'authenticated' : who === 'service' ? 'service_role' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    out = (await tx.query(sql, params)).rows;
  });
  return out;
}
const path = (client, kind, name = 'file.jpg') => objectPath(client, kind, randomUUID(), name);
const insertFile = (who, client, kind, extra = {}) => {
  const p = extra.path || path(client, kind);
  return q(who, 'insert into public.client_files (client_id, kind, label, storage_path, mime, size_bytes, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7) returning *',
    [client, kind, extra.label ?? null, p, extra.mime ?? 'image/jpeg', extra.size ?? 1000, extra.uploaded_by ?? 'someone@else.test']);
};
const upload = (who, name) => q(who, "insert into storage.objects (bucket_id, name, owner_id) values ('client-files', $1, $2) returning name", [name, users[who]?.id ?? null]);

test('the kinds, the bucket and the limits are the same as the page\'s', async () => {
  const check = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'client_files_kind_check'")).rows[0].d;
  assert.deepEqual([...check.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort(), Object.keys(KINDS).sort());
  const b = (await db.query('select * from storage.buckets where id = $1', [BUCKET])).rows[0];
  assert.equal(b.public, false);
  assert.equal(Number(b.file_size_limit), 2 * 1024 ** 3);
  for (const kind of Object.keys(KINDS)) {
    const ok = await insertFile('owner', ids.dana, kind, { size: maxBytes(kind) });
    assert.ok(!ok.error, `${kind}: ${ok.error}`);
    const big = await insertFile('owner', ids.dana, kind, { size: maxBytes(kind) + 1 });
    assert.match(big.error, /client_files_size/, kind);
  }
  assert.equal(maxBytes('image'), 20 * 1024 ** 2);
  assert.equal(maxBytes('deliverable_video'), 2 * 1024 ** 3);
});

test('uploading, by person and kind, in the table and in the bucket', async () => {
  const may = {
    owner: Object.keys(KINDS), irit: Object.keys(KINDS), lior: Object.keys(KINDS), ofir: Object.keys(KINDS),
    // (Protocol v10: Ilai also uploads the logo he makes; "הוכן לוגו חדש" is ticked only once it is in the file.)
    ilai: ['deliverable_graphic', 'deliverable_highlight', 'deliverable_site', 'logo'],
    nadia: ['deliverable_video'], yariv: [], nirel: [], eli: [],
  };
  for (const [who, kinds] of Object.entries(may)) {
    for (const kind of Object.keys(KINDS)) {
      const r = await insertFile(who, ids.dana, kind);
      const s = await upload(who, path(ids.dana, kind));
      if (kinds.includes(kind)) {
        assert.ok(!r.error, `${who} ${kind}: ${r.error}`);
        assert.ok(!s.error, `${who} ${kind} (storage): ${s.error}`);
      } else {
        assert.match(String(r.error), /row-level security/, `${who} ${kind}`);
        assert.match(String(s.error), /row-level security/, `${who} ${kind} (storage)`);
      }
    }
  }
  // Yariv: the videos of his own client; Nirel: not a Natali client she only sees.
  assert.ok(!(await insertFile('yariv', ids.ron, 'deliverable_video')).error);
  assert.match((await insertFile('nirel', ids.nat, 'deliverable_video')).error, /row-level security/);
  // ...but she uploads when it is her editing.
  await db.query("update public.clients set editor = 'nirel' where id = $1", [ids.nat]);
  assert.ok(!(await insertFile('nirel', ids.nat, 'deliverable_video')).error);
  await db.query("update public.clients set editor = 'anna' where id = $1", [ids.nat]);
  // Anonymous: nothing.
  assert.match(String((await insertFile('anon', ids.dana, 'image')).error), /permission denied/);
  assert.match(String((await upload('anon', path(ids.dana, 'image'))).error), /row-level security/);
});

test('the path is <client>/<kind>/<uuid>-<name>, in the table and in the bucket', async () => {
  assert.match((await insertFile('owner', ids.dana, 'image', { path: path(ids.ron, 'image') })).error, /client_files_path_shape/);
  assert.match((await insertFile('owner', ids.dana, 'image', { path: path(ids.dana, 'logo') })).error, /client_files_path_shape/);
  assert.match((await insertFile('owner', ids.dana, 'image', { path: `${ids.dana}/image/x.jpg` })).error, /client_files_path_shape/);
  // The bucket: exactly two folders, a client and a kind the person may upload.
  assert.match(String((await upload('irit', `${ids.dana}/x.jpg`)).error), /row-level security/);
  assert.match(String((await upload('irit', `${ids.dana}/image/sub/x.jpg`)).error), /row-level security/);
  assert.match(String((await upload('irit', `not-a-uuid/image/${randomUUID()}-x.jpg`)).error), /row-level security/);
  assert.match(String((await upload('irit', `${ids.dana}/brochure/${randomUUID()}-x.jpg`)).error), /row-level security/);
  assert.match(objectPath(ids.dana, 'image', randomUUID(), '../../תמונה של דנה?.JPG'), new RegExp(`^${ids.dana}/image/[0-9a-f-]{36}-[^/]+\\.jpg$`));
});

test('who and when are the database\'s; client, kind and path never change', async () => {
  const [row] = await keep('ofir', "insert into public.client_files (client_id, kind, label, storage_path, uploaded_by, created_at, deleted_at) values ($1, 'image', '  חזית  ', $2, 'fake@x', '2020-01-01', now()) returning *", [ids.dana, path(ids.dana, 'image')]);
  assert.equal(row.uploaded_by, 'ofir@astrateg.test');
  assert.ok(Date.now() - new Date(row.created_at) < 60e3);
  assert.equal(row.deleted_at, null);
  assert.equal(row.label, 'חזית');
  for (const [col, v] of [['client_id', ids.ron], ['kind', 'logo'], ['storage_path', path(ids.dana, 'image')], ['uploaded_by', 'x@y'], ['mime', 'text/html'], ['size_bytes', 5]]) {
    const r = await q('owner', `update public.client_files set ${col} = $1 where id = $2`, [v, row.id]);
    assert.match(String(r.error), /permission denied|not allowed/, col);
  }
  // The day it went up and the live post's link.
  const ok = await q('lior', "update public.client_files set posted_on = '2026-10-05', link = 'https://instagram.com/p/x' returning posted_on, link", []);
  assert.ok(!ok.error, ok.error);
  assert.match(String((await q('lior', "update public.client_files set link = 'javascript:alert(1)' where id = $1", [row.id])).error), /client_files_link_https/);
  // Nobody removes a row.
  assert.match(String((await q('owner', 'delete from public.client_files where id = $1', [row.id])).error), /permission denied/);
});

test('reading: whoever sees the client; a deleted file only by the managers', async () => {
  const name = path(ids.dana, 'image');
  await db.query("insert into public.client_files (client_id, kind, storage_path) values ($1, 'image', $2)", [ids.dana, name]);
  await db.query("insert into storage.objects (bucket_id, name) values ('client-files', $1)", [name]);
  const sees = async (who) => ({
    rows: (await q(who, 'select id from public.client_files where storage_path = $1', [name])).rows.length,
    object: (await q(who, 'select name from storage.objects where name = $1', [name])).rows.length,
  });
  for (const who of ['owner', 'irit', 'ofir', 'ilai', 'nadia']) assert.deepEqual(await sees(who), { rows: 1, object: 1 }, who);
  for (const who of ['yariv', 'nirel', 'eli']) assert.deepEqual(await sees(who), { rows: 0, object: 0 }, who);
  // Anonymous: the table is not theirs at all, and the bucket shows nothing.
  assert.match(String((await q('anon', 'select id from public.client_files')).error), /permission denied/);
  assert.equal((await q('anon', 'select name from storage.objects')).rows.length, 0);
  // Eli around the shoot day.
  await db.query("update public.clients set shoot_at = now() + interval '2 days' where id = $1", [ids.dana]);
  assert.deepEqual(await sees('eli'), { rows: 1, object: 1 });
  await db.query('update public.clients set shoot_at = null where id = $1', [ids.dana]);
  // Deleted: the row stays (the office's history), the object is the managers' only.
  await db.query('update public.client_files set deleted_at = now() where storage_path = $1', [name]);
  assert.deepEqual(await sees('nadia'), { rows: 1, object: 0 });
  assert.deepEqual(await sees('ilai'), { rows: 1, object: 0 });
  assert.deepEqual(await sees('irit'), { rows: 1, object: 1 });
});

test('soft delete: the managers and the uploader; only the managers restore', async () => {
  const [mine] = await keep('nadia', "insert into public.client_files (client_id, kind, storage_path, mime) values ($1, 'deliverable_video', $2, 'video/mp4') returning id", [ids.dana, path(ids.dana, 'deliverable_video', 'v.mp4')]);
  const [irits] = await keep('irit', "insert into public.client_files (client_id, kind, storage_path) values ($1, 'deliverable_graphic', $2) returning id", [ids.dana, path(ids.dana, 'deliverable_graphic')]);
  // Ilai edits the day a deliverable went up, but does not delete Irit's graphic.
  const posted = await q('ilai', "update public.client_files set posted_on = '2026-10-04' where id = $1 returning id", [irits.id]);
  assert.equal(posted.rows.length, 1);
  assert.match(String((await q('ilai', 'update public.client_files set deleted_at = now() where id = $1', [irits.id])).error), /only the office or the uploader/);
  // Nadia cannot touch Irit's graphic at all (not her kind, not hers).
  assert.equal((await q('nadia', "update public.client_files set label = 'x' where id = $1", [irits.id])).affected, 0);
  // Nadia deletes her own video; she cannot bring it back; Lior can.
  await keep('nadia', 'update public.client_files set deleted_at = now() where id = $1', [mine.id]);
  assert.ok((await db.query('select deleted_at from public.client_files where id = $1', [mine.id])).rows[0].deleted_at);
  assert.match(String((await q('nadia', 'update public.client_files set deleted_at = null where id = $1', [mine.id])).error), /only the office restores/);
  assert.equal((await q('lior', 'update public.client_files set deleted_at = null where id = $1 returning id', [mine.id])).rows.length, 1);
  // The bucket: a manager removes an object; the uploader only an orphan of theirs.
  const orphan = path(ids.dana, 'deliverable_video', 'o.mp4');
  await keep('nadia', "insert into storage.objects (bucket_id, name, owner_id) values ('client-files', $1, $2)", [orphan, users.nadia.id]);
  assert.equal((await q('yariv', 'delete from storage.objects where name = $1 returning name', [orphan])).rows.length, 0);
  assert.equal((await q('nadia', 'delete from storage.objects where name = $1 returning name', [orphan])).rows.length, 1);
  await db.query("insert into public.client_files (client_id, kind, storage_path) values ($1, 'deliverable_video', $2)", [ids.dana, orphan]);
  assert.equal((await q('nadia', 'delete from storage.objects where name = $1 returning name', [orphan])).rows.length, 0);
  assert.equal((await q('ofir', 'delete from storage.objects where name = $1 returning name', [orphan])).rows.length, 1);
});

test('the view-only link: Irit, Lior and the owner; a hash in the table, the token in Vault', async () => {
  for (const who of ['ofir', 'ilai', 'nadia', 'anon']) {
    assert.match(String((await q(who, 'select public.gallery_link_create($1)', [ids.dana])).error), /not allowed|permission denied/, who);
  }
  const [{ l }] = await keep('irit', 'select public.gallery_link_create($1) as l', [ids.dana]);
  assert.match(l.token, /^[A-Za-z0-9_-]{43}$/);
  const row = (await db.query('select * from public.client_gallery_links where id = $1', [l.id])).rows[0];
  assert.notEqual(row.token_hash, l.token);
  assert.ok(Math.abs(new Date(row.expires_at) - Date.now() - 365 * 864e5) < 60e3);
  assert.equal((await q('lior', 'select public.gallery_link_token($1) as t', [l.id])).rows[0].t, l.token);
  assert.match(String((await q('ofir', 'select public.gallery_link_token($1) as t', [l.id])).error), /not allowed/);
  assert.match(String((await q('ofir', 'select token_hash from public.client_gallery_links')).error), /permission denied/);
  assert.equal((await q('ofir', 'select id from public.client_gallery_links')).rows.length, 1);
  assert.deepEqual((await q('nadia', 'select id from public.client_gallery_links')).rows, []);
  // A new link revokes the old one; its token leaves Vault.
  const [{ l: l2 }] = await keep('lior', 'select public.gallery_link_create($1) as l', [ids.dana]);
  const old = (await db.query('select revoked_at, secret_id from public.client_gallery_links where id = $1', [l.id])).rows[0];
  assert.ok(old.revoked_at);
  assert.equal(old.secret_id, null);
  assert.equal((await db.query("select count(*)::int as n from vault.secrets where name = $1", [`gallery_link:${l.id}`])).rows[0].n, 0);
  assert.equal((await q('lior', 'select public.gallery_link_token($1) as t', [l.id])).rows[0].t, null);
  await keep('owner', 'select public.gallery_link_revoke($1)', [l2.id]);
  assert.equal((await db.query("select count(*)::int as n from vault.secrets where name like 'gallery_link:%'")).rows[0].n, 0);
  // An ended client keeps a gallery.
  assert.ok((await keep('irit', 'select public.gallery_link_create($1) as l', [ids.ended]))[0].l.token);
});

test('what a token shows: service role only; the deliverables, no staff, no file names; the status page\'s graphics by approval', async () => {
  // Fresh client with files of every kind.
  const { rows: [{ id: c }] } = await db.query("insert into public.clients (name, business, editor) values ('מאיה', 'סטודיו מאיה', 'nadia') returning id");
  const put = async (kind, name, at) => {
    const p = objectPath(c, kind, randomUUID(), name);
    await db.query('insert into public.client_files (client_id, kind, storage_path, mime, uploaded_by) values ($1, $2, $3, $4, $5)', [c, kind, p, 'image/png', 'nadia@astrateg.test']);
    if (at) await db.query('update public.client_files set created_at = $1 where storage_path = $2', [at, p]);
    return p;
  };
  await put('logo', 'logo-secret-name.png');
  await put('image', 'img.png');
  const g1 = await put('deliverable_graphic', 'g1-internal-v3.png', new Date(Date.now() - 3 * 864e5).toISOString());
  await put('deliverable_video', 'v1.mp4');
  const gone = await put('deliverable_graphic', 'deleted.png');
  await db.query('update public.client_files set deleted_at = now() where storage_path = $1', [gone]);
  const [{ l }] = await keep('irit', 'select public.gallery_link_create($1) as l', [c]);

  for (const who of ['anon', 'irit']) {
    assert.match(String((await q(who, 'select public.media_for_token($1, $2)', [l.token, 'gallery'])).error), /permission denied/, who);
  }
  const media = async (token, scope) => (await keep('service', 'select public.media_for_token($1, $2) as m', [token, scope]))[0].m;
  const g = await media(l.token, 'gallery');
  assert.equal(g.state, 'ok');
  assert.equal(g.business, 'סטודיו מאיה');
  assert.deepEqual(g.files.map((f) => f.kind).sort(), ['deliverable_graphic', 'deliverable_video']);
  const text = JSON.stringify(g.files.map(({ path: _p, ...rest }) => rest));
  for (const bad of ['nadia', 'astrateg.test', 'internal', 'logo', 'deleted']) assert.ok(!text.includes(bad), bad);
  // Counted, at most once in 5 minutes.
  await media(l.token, 'gallery');
  assert.equal((await db.query('select open_count from public.client_gallery_links where id = $1', [l.id])).rows[0].open_count, 1);
  // Bad, revoked, wrong scope.
  assert.deepEqual(await media('x', 'gallery'), { state: 'invalid' });
  assert.deepEqual(await media('A'.repeat(43), 'gallery'), { state: 'invalid' });
  assert.deepEqual(await media(l.token, 'status'), { state: 'invalid' }); // a gallery token is not a status link
  assert.deepEqual(await media(l.token, 'other'), { state: 'invalid' });

  // The status page: graphics before the first 9 were approved are theirs, later ones the rest's.
  const [{ s }] = await keep('irit', 'select public.status_link_create($1) as s', [c]);
  let st = await media(s.token, 'status');
  assert.deepEqual(st.files.map((f) => [f.path, f.item]), [[g1, 'graphics9']]);
  await db.query("insert into public.protocol_checks (client_id, item_key, state) values ($1, 'p07.approved', 'done')", [c]);
  const g2 = await put('deliverable_graphic', 'g2.png', new Date(Date.now() + 1000).toISOString());
  st = await media(s.token, 'status');
  assert.deepEqual(st.files.map((f) => [f.path, f.item]), [[g1, 'graphics9'], [g2, 'graphics']]);
  assert.deepEqual(st.files.map((f) => f.kind), ['deliverable_graphic', 'deliverable_graphic']);
  assert.ok(!JSON.stringify(st).includes('nadia'));
  // Revoked gallery link.
  await keep('irit', 'select public.gallery_link_revoke($1)', [l.id]);
  assert.deepEqual(await media(l.token, 'gallery'), { state: 'revoked' });
});

test('the migration runs again safely', async () => {
  const { migrationSql } = await import('./pg.mjs');
  await db.exec(migrationSql('20261003110000_client_files.sql'));
  assert.equal((await db.query("select count(*)::int as n from storage.buckets where id = 'client-files'")).rows[0].n, 1);
});
