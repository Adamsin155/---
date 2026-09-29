-- Client protocol, second batch: links, package quantities, extra shoot
-- rounds, daily review records, and a client that opens by itself when an
-- agreement is signed.

-- Links to the client's working places (never passwords), package quantities
-- with delivered counters, and extra shoot rounds.
alter table public.clients
  add column address text,
  add column links jsonb not null default '{}'::jsonb,
  add column deliverables jsonb not null default '{}'::jsonb,
  add column rounds jsonb not null default '[]'::jsonb,
  add column verified_at timestamptz,
  add column verified_by text,
  add column closed_reason text check (closed_reason is null or length(closed_reason) <= 1000);

-- A client whose agreement was cancelled is closed with a reason, never deleted.
alter table public.clients drop constraint clients_status_check;
alter table public.clients add constraint clients_status_check
  check (status in ('active', 'ending', 'ended', 'cancelled'));

-- One client per signed agreement.
create unique index clients_quote_id_key on public.clients (quote_id) where quote_id is not null;

-- Tasks opened from the weekly call are marked so the next call can show them.
alter table public.client_tasks add column source text check (source is null or source in ('p31', 'p33'));

alter table public.clients
  add constraint clients_links_object check (jsonb_typeof(links) = 'object'),
  add constraint clients_deliverables_object check (jsonb_typeof(deliverables) = 'object'),
  add constraint clients_rounds_array check (jsonb_typeof(rounds) = 'array');

-- Round items are keyed `r2.p12.read`; process marks `p06.claim`, `p01.wait`.
alter table public.protocol_checks drop constraint protocol_checks_item_key_check;
alter table public.protocol_checks add constraint protocol_checks_item_key_check
  check (item_key ~ '^(r[0-9]+\.)?p[0-9]+b?\.[a-z0-9.]+$');

-- Actions taken by the system itself (not a signed-in person) are stamped 'system'.
create or replace function public.protocol_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.by_email := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  new.at := now();
  return new;
end $$;

-- Who created a client, who confirmed its details and who last changed the
-- delivered quantities always come from the session.
create or replace function public.clients_touch() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by_email := me;
    new.verified_at := null;
    new.verified_by := null;
  else
    new.created_at := old.created_at;
    new.created_by_email := old.created_by_email;
    if new.verified_at is distinct from old.verified_at then
      new.verified_at := case when new.verified_at is null then null else now() end;
      new.verified_by := case when new.verified_at is null then null else me end;
    else
      new.verified_by := old.verified_by;
    end if;
    -- Who last changed the delivered counts is stamped here, never taken from the browser.
    new.deliverables := new.deliverables - 'updated_by' - 'updated_at';
    if new.deliverables -> 'done' is distinct from old.deliverables -> 'done' then
      new.deliverables := new.deliverables || jsonb_build_object('updated_by', me, 'updated_at', now());
    elsif old.deliverables ? 'updated_by' then
      new.deliverables := new.deliverables || jsonb_build_object('updated_by', old.deliverables -> 'updated_by', 'updated_at', old.deliverables -> 'updated_at');
    end if;
  end if;
  -- Each extra shoot round has its own number: its items are keyed by it.
  if (select count(*) <> count(distinct r ->> 'n') from jsonb_array_elements(new.rounds) r) then
    raise exception 'round numbers must be unique';
  end if;
  return new;
end $$;

-- Daily reviews (processes 32 and 33): one row per day and review.
create table public.office_reviews (
  day date not null,
  kind text not null check (kind in ('p32', 'p33')),
  note text check (note is null or length(note) <= 2000),
  by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  at timestamptz not null default now(),
  primary key (day, kind)
);

alter table public.office_reviews add column note_by text, add column note_at timestamptz;

-- Who marked the review and when stay as first recorded; adding notes later
-- stamps only the note.
create function public.office_reviews_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if tg_op = 'INSERT' then
    new.by_email := me;
    new.at := now();
    new.note_by := case when new.note is null then null else me end;
    new.note_at := case when new.note is null then null else now() end;
  else
    new.by_email := old.by_email;
    new.at := old.at;
    if new.note is distinct from old.note then
      new.note_by := me;
      new.note_at := now();
    else
      new.note_by := old.note_by;
      new.note_at := old.note_at;
    end if;
  end if;
  return new;
end $$;

create trigger office_reviews_stamp before insert or update on public.office_reviews
for each row execute function public.office_reviews_stamp();

alter table public.office_reviews enable row level security;
create policy "staff manage reviews" on public.office_reviews
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke delete, truncate on public.office_reviews from anon, authenticated;

-- Package quantities for a signed agreement. Mirrors SPECS in app/catalog.js
-- (tests/protocol.test.mjs checks that they agree).
create function public.package_deliverables(model jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with p as (
    select model -> 'package' ->> 'id' as id,
           coalesce(model -> 'selection' -> 'paid', '[]'::jsonb) as paid,
           coalesce(model -> 'selection' -> 'free', '{}'::jsonb) as free
  ), s as (
    select p.*, v.videos, v.graphics, v.shoot_days, v.collabs, v.stories, v.ch14
    from p join (values
      ('podcast-natali', 20, 20, 0, 0, 0, 0),
      ('podcast-simeon', 20, 20, 0, 0, 0, 0),
      ('social-simeon', 25, 35, 1, 1, 0, 0),
      ('social-tv-simeon', 42, 42, 2, 3, 3, 1),
      ('social-natali', 25, 35, 1, 0, 0, 0),
      ('social-tv-natali', 42, 42, 1, 0, 0, 1)
    ) as v (id, videos, graphics, shoot_days, collabs, stories, ch14) on v.id = p.id
  )
  select coalesce((
    select jsonb_build_object(
      'videos', videos,
      'graphics', graphics + coalesce((free ->> 'graphics')::int, 0),
      'shoot_days', shoot_days + case when paid ? 'simeon-day' then 1 else 0 end,
      'collabs', collabs + case when paid ? 'natali-reel' then 1 else 0 end,
      'stories', stories + coalesce((free ->> 'simeonStories')::int, 0) + case when paid ? 'natali-story' then 1 else 0 end,
      'ch14', ch14 + case when coalesce((free ->> 'extraCh14')::boolean, false) then 1 else 0 end,
      'monthly', case when paid ? 'photographer' then 96 else 0 end)
    from s), '{}'::jsonb);
$$;

-- When an agreement is signed, its client opens by itself: details, package,
-- influencers, quantities, contract end, and process 1 marked done. The deal
-- clock starts at the signature. A failure here never blocks the signature.
create function public.open_client_on_signing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  cid uuid;
  months int;
  signed timestamptz;
begin
  if new.status is distinct from 'signed' or old.status = 'signed' then
    return new;
  end if;
  -- Everything that reads the agreement runs inside the protected block, so a
  -- surprising value can never undo the signature.
  begin
    m := new.model;
    -- Agreements are signable; older ones saved before the flag existed are too.
    if coalesce((m ->> 'signable')::boolean, true) is not true then
      return new;
    end if;
    if exists (select 1 from public.clients where quote_id = new.id) then
      return new;
    end if;
    months := coalesce(round((m ->> 'termMonths')::numeric)::int, 12);
    signed := coalesce(new.signed_at, now());
    insert into public.clients (name, business, phone, package_name, shoot_type, deal_at, contract_end, quote_id, deliverables)
    values (
      coalesce(nullif(btrim(m -> 'client' ->> 'name'), ''), new.client_name),
      nullif(btrim(m -> 'client' ->> 'company'), ''),
      nullif(btrim(m -> 'client' ->> 'phone'), ''),
      concat_ws(' · ', m -> 'package' ->> 'tierName', m -> 'package' ->> 'influencer'),
      case m -> 'selection' ->> 'influencer' when 'natali' then 'natali' when 'simeon' then 'dms' end,
      signed,
      ((signed at time zone 'Asia/Jerusalem')::date + make_interval(months => months))::date,
      new.id,
      public.package_deliverables(m)
    )
    returning id into cid;
    insert into public.protocol_checks (client_id, item_key, state, note)
    select cid, k, 'done', 'נחתם במערכת: ' || new.number
    from unnest(array['p01.prepared', 'p01.sent', 'p01.signed']) as k;
  exception when others then
    raise warning 'open_client_on_signing failed for quote %: %', new.number, sqlerrm;
  end;
  return new;
end $$;

revoke execute on function public.open_client_on_signing() from public, anon, authenticated;

create trigger quotes_open_client after update of status on public.quotes
for each row execute function public.open_client_on_signing();
