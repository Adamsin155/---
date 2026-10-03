-- The client's files ("תיק לקוח"): every file, videos included, is uploaded into the
-- system itself (Supabase Storage), not linked from Drive (the owner's decision,
-- 3.10.2026).
--
--   storage bucket 'client-files'  private. An object's path is
--                                  <client_id>/<kind>/<uuid>-<safe file name>.
--                                  At most 2 GB a file (the project's global upload
--                                  limit must be raised to match: docs/ops.md, 19).
--   public.client_files            one row per file: which client, what kind, a
--                                  label, the path, type and size, the day it went
--                                  up on the client's networks (posted_on, for the
--                                  yearly Gantt), an optional link (the live post),
--                                  who uploaded and when, and a soft delete.
--   public.client_gallery_links    a secret view-only link for the client (like the
--                                  status page's: a hash in the table, the token in
--                                  Vault), opening gallery.html with the deliverables.
--
-- The kinds. From the client (collected by Ofir at the meeting, or later):
--   logo, image, video_existing, material_other (a custom label)
-- What we made for the client:
--   deliverable_graphic, deliverable_video, deliverable_highlight,
--   deliverable_site (a site or landing page: a link, a file or both),
--   deliverable_other (a custom label)
--
-- Who:
--   - reads a client's files: whoever sees the client (public.can_see_client:
--     the office, the editor of the client, Nirel for Natali, Eli around a shoot day,
--     anyone with a task there; 20260930130000_assignment_rls.sql);
--   - uploads: the owner, Irit, Lior and Ofir any kind; Ilai graphics, highlights and
--     the site; an editor (Nadia, Yariv, Anna, Nirel) only videos, and only for a
--     client assigned to them (their editing, or a task someone opened for them);
--   - edits the label, the day posted and the link: whoever may upload that kind
--     there, the uploader, the managers above, and Ilai on any deliverable (he
--     schedules and posts them);
--   - deletes (soft: deleted_at): the managers and the uploader. Nobody removes a
--     row; the objects of soft-deleted files stay, readable by the managers only.
-- Storage's policies mirror the table: the first folder of the object's name is the
-- client (storage.foldername(name)[1]), the second the kind.
--
-- The client's side (anonymous, by token) never reads a table or the bucket: the
-- edge function client-media (supabase/functions/client-media) checks the token
-- through public.media_for_token() (service role only) and signs short-lived URLs.
-- It gives the gallery (the deliverables, no staff names, no internal dates, no file
-- names) and, for the status page, the uploaded graphics next to the approval of
-- the first 9 graphics and of the rest (p07 / p23). approve_item is not changed.
--
-- Every statement can run again safely. Tested in a real Postgres with every
-- migration: tests/sql/client-files.test.mjs.

-- ── Who may do what ──────────────────────────
-- The managers of the files: the owner, Irit, Lior and Ofir (the office without
-- Ilai, whose screens are his own work: app/protocol.js, SCOPE).
create or replace function public.can_manage_client_files() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir')));
$$;

-- May the signed-in person upload a file of this kind for this client?
create or replace function public.can_upload_client_file(p_client uuid, p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select coalesce(p_client is not null and public.can_see_client(p_client)
    and p_kind in ('logo', 'image', 'video_existing', 'material_other', 'deliverable_graphic',
      'deliverable_video', 'deliverable_highlight', 'deliverable_site', 'deliverable_other') and (
    public.can_manage_client_files()
    or (me.p = 'ilai' and p_kind in ('deliverable_graphic', 'deliverable_highlight', 'deliverable_site'))
    or (me.p in ('nadia', 'yariv', 'anna', 'nirel') and p_kind = 'deliverable_video' and private.is_assigned(p_client))), false)
  from me;
$$;

-- The client of an object's path (its first folder), or null when it is not a uuid.
create or replace function private.client_file_folder(p_name text) returns uuid
language sql stable set search_path = '' as $$
  select case when pg_input_is_valid(coalesce((storage.foldername(p_name))[1], ''), 'uuid')
              then ((storage.foldername(p_name))[1])::uuid end;
$$;

revoke execute on function public.can_manage_client_files() from public, anon;
revoke execute on function public.can_upload_client_file(uuid, text) from public, anon;
grant execute on function public.can_manage_client_files() to authenticated;
grant execute on function public.can_upload_client_file(uuid, text) to authenticated;

-- ── The table ────────────────────────────────
create table if not exists public.client_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('logo', 'image', 'video_existing', 'material_other', 'deliverable_graphic',
    'deliverable_video', 'deliverable_highlight', 'deliverable_site', 'deliverable_other')),
  label text,
  storage_path text not null,
  mime text,
  size_bytes bigint,
  posted_on date null,
  link text null,
  uploaded_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz default now(),
  deleted_at timestamptz null
);
create index if not exists client_files_client_idx on public.client_files (client_id, kind, created_at desc);
create unique index if not exists client_files_path_idx on public.client_files (storage_path);

alter table public.client_files drop constraint if exists client_files_path_shape;
alter table public.client_files add constraint client_files_path_shape
  check (storage_path ~ ('^' || client_id::text || '/' || kind || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^/]{1,180}$'));
alter table public.client_files drop constraint if exists client_files_label_len;
alter table public.client_files add constraint client_files_label_len check (label is null or char_length(label) <= 120);
alter table public.client_files drop constraint if exists client_files_link_https;
alter table public.client_files add constraint client_files_link_https
  check (link is null or (char_length(link) <= 2000 and link ~ '^https://[^\s"<>]+$'));
alter table public.client_files drop constraint if exists client_files_mime_len;
alter table public.client_files add constraint client_files_mime_len check (mime is null or char_length(mime) <= 200);
-- Images (the logo, photos, graphics) up to 20 MB; everything else up to 2 GB.
alter table public.client_files drop constraint if exists client_files_size;
alter table public.client_files add constraint client_files_size check (size_bytes is null or size_bytes between 0 and
  case when kind in ('logo', 'image', 'deliverable_graphic') then 20971520 else 2147483648 end);

-- Who and when are the database's: the uploader's email and the server's time.
-- The path, client, kind, type, size and uploader never change; only the managers
-- and the uploader delete, and only the managers bring a file back.
create or replace function public.client_files_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    if me <> '' then new.uploaded_by := me; end if;
    new.created_at := now();
    new.deleted_at := null;
    new.label := nullif(btrim(coalesce(new.label, '')), '');
    return new;
  end if;
  -- The database's own jobs and the SQL editor (no email in the token) may fix a row.
  if me = '' then return new; end if;
  if new.id is distinct from old.id or new.client_id is distinct from old.client_id or new.kind is distinct from old.kind
     or new.storage_path is distinct from old.storage_path or new.mime is distinct from old.mime
     or new.size_bytes is distinct from old.size_bytes or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'not allowed: a file keeps its client, kind, path and uploader' using errcode = '42501';
  end if;
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  if new.deleted_at is distinct from old.deleted_at then
    if old.deleted_at is null and not (public.can_manage_client_files() or old.uploaded_by = me) then
      raise exception 'not allowed: only the office or the uploader deletes a file' using errcode = '42501';
    end if;
    if old.deleted_at is not null and not public.can_manage_client_files() then
      raise exception 'not allowed: only the office restores a file' using errcode = '42501';
    end if;
    if new.deleted_at is not null then new.deleted_at := now(); end if;
  end if;
  return new;
end $$;
revoke execute on function public.client_files_stamp() from public, anon, authenticated;
drop trigger if exists client_files_stamp on public.client_files;
create trigger client_files_stamp before insert or update on public.client_files
for each row execute function public.client_files_stamp();

alter table public.client_files enable row level security;
revoke all on public.client_files from anon, authenticated;
grant select, insert on public.client_files to authenticated;
grant update (label, posted_on, link, deleted_at) on public.client_files to authenticated;

drop policy if exists "files of own clients" on public.client_files;
create policy "files of own clients" on public.client_files
  for select to authenticated
  using ((select public.is_office()) or client_id in (select private.my_clients()));
drop policy if exists "upload by kind" on public.client_files;
create policy "upload by kind" on public.client_files
  for insert to authenticated
  with check (public.can_see_client(client_id) and public.can_upload_client_file(client_id, kind));
drop policy if exists "edit by kind or uploader" on public.client_files;
create policy "edit by kind or uploader" on public.client_files
  for update to authenticated
  using ((select public.can_manage_client_files())
    or (public.can_see_client(client_id) and (
      uploaded_by = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      or ((select public.my_person()) = 'ilai' and kind like 'deliverable\_%')
      or public.can_upload_client_file(client_id, kind))))
  with check ((select public.can_manage_client_files())
    or (public.can_see_client(client_id) and (
      uploaded_by = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      or ((select public.my_person()) = 'ilai' and kind like 'deliverable\_%')
      or public.can_upload_client_file(client_id, kind))));

-- May the signed-in person read this object? The client is theirs and the file is
-- live (a managed one also when deleted, or not yet in the table).
create or replace function private.client_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  with c as (select private.client_file_folder(p_name) as id)
  select coalesce(c.id is not null and public.can_see_client(c.id) and (
    public.can_manage_client_files()
    or exists (select 1 from public.client_files f where f.storage_path = p_name and f.client_id = c.id and f.deleted_at is null)), false)
  from c;
$$;

-- ── The bucket ───────────────────────────────
-- Private (no public URL); 2 GB a file. Types are not limited here: the custom
-- material may be a PDF, a menu or a font; the card asks for the right kind of file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-files', 'client-files', false, 2147483648, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ── Storage's policies (storage.objects) ─────
-- Read: as the table (whoever sees the client), a live file; the uploader reads what
-- they just uploaded (before its row exists). Upload: by kind, as the table, into
-- <client>/<kind>/ exactly. No overwrite (no update policy). Remove: the managers,
-- and the uploader of an object that has no row (an upload whose save failed).
drop policy if exists "client files: read" on storage.objects;
create policy "client files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-files'
    and (owner_id = (select auth.uid())::text or private.client_file_readable(name)));
drop policy if exists "client files: upload" on storage.objects;
create policy "client files: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-files'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 2
    and public.can_upload_client_file(private.client_file_folder(name), (storage.foldername(name))[2]));
drop policy if exists "client files: remove" on storage.objects;
create policy "client files: remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-files' and (
    ((select public.can_manage_client_files()) and private.client_file_folder(name) is not null)
    or (owner_id = (select auth.uid())::text
        and not exists (select 1 from public.client_files f where f.storage_path = name))));

revoke execute on function private.client_file_folder(text) from public, anon;
revoke execute on function private.client_file_readable(text) from public, anon;
grant execute on function private.client_file_folder(text) to authenticated;
grant execute on function private.client_file_readable(text) to authenticated;

-- ── The view-only link for the client ────────
-- Like the status page's (20260930170000_client_status.sql): 32 random bytes,
-- base64url; the table keeps a SHA-256 hash, Vault keeps the token so Irit, Lior and
-- the owner can copy the link again (can_manage_status_links()). A year by default.
-- A new link revokes the one before it; a revoked link's token leaves Vault. Opens
-- for an active, ending or ended client (the deliverables stay theirs), not a
-- cancelled one.
create table if not exists public.client_gallery_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  secret_id uuid,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  last_opened_at timestamptz,
  open_count integer not null default 0
);
create index if not exists client_gallery_links_client_idx on public.client_gallery_links (client_id, created_at desc);
alter table public.client_gallery_links enable row level security;
revoke all on public.client_gallery_links from anon, authenticated;
grant select (id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by, last_opened_at, open_count)
  on public.client_gallery_links to authenticated;
drop policy if exists "office reads gallery links" on public.client_gallery_links;
create policy "office reads gallery links" on public.client_gallery_links
  for select to authenticated using ((select public.is_office()));

create or replace function public.client_gallery_links_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end $$;
revoke execute on function public.client_gallery_links_cleanup() from public, anon, authenticated;
drop trigger if exists client_gallery_links_cleanup on public.client_gallery_links;
create trigger client_gallery_links_cleanup after delete on public.client_gallery_links
for each row execute function public.client_gallery_links_cleanup();

-- The link a token opens, and why not: 'invalid', 'revoked', 'expired' or 'closed'.
create or replace function private.gallery_check(p_token text)
returns table (link_id uuid, client_id uuid, expires_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_gallery_links;
  st text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select * into l from public.client_gallery_links g where g.token_hash = private.status_token_hash(p_token);
  if not found then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select c.status into st from public.clients c where c.id = l.client_id;
  return query select l.id, l.client_id, l.expires_at,
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at <= now() then 'expired'
         when st is null or st not in ('active', 'ending', 'ended') then 'closed'
         else null end;
end $$;
revoke execute on function private.gallery_check(text) from public, anon, authenticated;

-- Revokes a client's live gallery links and removes their tokens from Vault.
create or replace function private.gallery_revoke_all(p_client uuid, p_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r record;
begin
  for r in update public.client_gallery_links set revoked_at = now(), revoked_by = me
           where client_id = p_client and revoked_at is null and (p_id is null or id = p_id)
           returning id, secret_id
  loop
    if r.secret_id is not null then
      delete from vault.secrets where id = r.secret_id;
      update public.client_gallery_links set secret_id = null where id = r.id;
    end if;
  end loop;
end $$;
revoke execute on function private.gallery_revoke_all(uuid, uuid) from public, anon, authenticated;

create or replace function public.gallery_link_create(p_client uuid, p_days integer default 365) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_token text;
  v_id uuid := gen_random_uuid();
  v_secret uuid;
  v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 365), 1), 730));
begin
  if not public.can_manage_status_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.clients where id = p_client and status in ('active', 'ending', 'ended')) then
    raise exception 'client not open' using errcode = '22023';
  end if;
  perform private.gallery_revoke_all(p_client);
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_secret := vault.create_secret(v_token, 'gallery_link:' || v_id::text, 'client media gallery link');
  insert into public.client_gallery_links (id, client_id, token_hash, secret_id, created_by, expires_at)
  values (v_id, p_client, private.status_token_hash(v_token), v_secret, me, v_exp);
  return jsonb_build_object('id', v_id, 'token', v_token, 'expiresAt', v_exp);
end $$;

create or replace function public.gallery_link_token(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_token text;
begin
  if not public.can_manage_status_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  select secret_id into v_secret from public.client_gallery_links
  where id = p_id and revoked_at is null and expires_at > now();
  if v_secret is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  return v_token;
end $$;

create or replace function public.gallery_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
begin
  if not public.can_manage_status_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  select client_id into v_client from public.client_gallery_links where id = p_id;
  if v_client is not null then perform private.gallery_revoke_all(v_client, p_id); end if;
end $$;

revoke all on function public.gallery_link_create(uuid, integer) from public, anon;
revoke all on function public.gallery_link_token(uuid) from public, anon;
revoke all on function public.gallery_link_revoke(uuid) from public, anon;
grant execute on function public.gallery_link_create(uuid, integer) to authenticated;
grant execute on function public.gallery_link_token(uuid) to authenticated;
grant execute on function public.gallery_link_revoke(uuid) to authenticated;

-- ── What a token shows (the edge function only) ──
-- p_scope 'gallery' (a gallery link): the deliverables, newest first (at most 300),
-- and the business name; each opening counted (at most once in 5 minutes).
-- p_scope 'status' (a status page link): the graphics, each with the approval it
-- belongs to: 'graphics9' (the first 9, process 7) when uploaded before the first 9
-- were approved (or when they are not approved yet), else 'graphics' (the rest,
-- process 23).
-- Each file: id, kind, label, mime, size, postedOn, link, at, and the path the
-- function signs (and drops before answering). Never who uploaded, the file's own
-- name is only in the path, and no internal date or note.
-- Or { state: 'invalid' | 'revoked' | 'expired' | 'closed' }.
create or replace function public.media_for_token(p_token text, p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  v_cut timestamptz;
begin
  if p_scope = 'gallery' then
    select * into l from private.gallery_check(p_token);
  elsif p_scope = 'status' then
    select * into l from private.status_check(p_token);
  else
    return jsonb_build_object('state', 'invalid');
  end if;
  if l.reason is not null then return jsonb_build_object('state', l.reason); end if;
  select * into c from public.clients where id = l.client_id;
  if p_scope = 'gallery' then
    update public.client_gallery_links set last_opened_at = now(), open_count = open_count + 1
    where id = l.link_id and (last_opened_at is null or last_opened_at < now() - interval '5 minutes');
    return jsonb_build_object('state', 'ok', 'scope', 'gallery', 'expiresAt', l.expires_at,
      'business', coalesce(nullif(btrim(c.business), ''), c.name),
      'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'label', f.label, 'mime', f.mime,
                  'size', f.size_bytes, 'postedOn', f.posted_on, 'link', f.link, 'at', f.created_at, 'path', f.storage_path)
                  order by f.created_at desc)
                from (select * from public.client_files x where x.client_id = c.id and x.deleted_at is null
                        and x.kind in ('deliverable_graphic', 'deliverable_video', 'deliverable_highlight', 'deliverable_site', 'deliverable_other')
                      order by x.created_at desc limit 300) f), '[]'::jsonb));
  end if;
  select s.at into v_cut from public.protocol_checks s
  where s.client_id = c.id and s.item_key = 'p07.approved' and s.state in ('done', 'na');
  return jsonb_build_object('state', 'ok', 'scope', 'status',
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'label', f.label, 'mime', f.mime,
                'size', f.size_bytes, 'at', f.created_at, 'path', f.storage_path,
                'item', case when v_cut is null or f.created_at <= v_cut then 'graphics9' else 'graphics' end)
                order by f.created_at)
              from (select * from public.client_files x where x.client_id = c.id and x.deleted_at is null
                      and x.kind = 'deliverable_graphic'
                    order by x.created_at desc limit 120) f), '[]'::jsonb));
end $$;
revoke all on function public.media_for_token(text, text) from public, anon, authenticated;
grant execute on function public.media_for_token(text, text) to service_role;
