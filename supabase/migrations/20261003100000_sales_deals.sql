-- The owner's decisions of 3.10.2026 (docs/ops.md, section 19):
--   1. Stav (staff.person 'stav'), the field sales agent: new deals go to Irit from
--      deal.html (public.deal_requests). He reads and adds only his own deals; he
--      sees no client, protocol item, task, vault, quote or payout (row level
--      security below and in the earlier migrations: he is not the office and no
--      client is his). The office reads every deal and moves its status.
--   2. A deal's contract: linking the quote Irit creates (quote_id) makes it "חוזה
--      נשלח"; the quote signed makes it "נחתם" (a trigger on quotes, next to
--      open_client_on_signing). The reminders (app/reminder-rules.js) ring Irit at
--      once and after 10 office minutes, Ofir too, and tell Stav quietly when it is signed.
--   6. The characterization defaults to Ofir (clients.characterizer).
--   Protocol version 6 (app/protocol.js): the shoot day right after the group (11,
--      11ב), Ilai uploads approved graphics (7ב, 23ב), Irit can mark the client's
--      approval of the rest of the graphics (p23.approved). The writers table is
--      regenerated; graphics already approved before this migration count as
--      uploaded (imported history, note 'ייבוא'), so nobody is told to post old work.
--   8. The station-change message (milestone 'station_change') in the templates.
-- Every statement can run again safely. Tested with every migration in a real
-- Postgres: tests/sql/deals.test.mjs.

-- ── Stav on the team, and in the reminders ───
alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'editor'));
alter table public.reminder_log drop constraint if exists reminder_log_person_check;
alter table public.reminder_log add constraint reminder_log_person_check
  check (person in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav'));

-- Sales (PEOPLE[…].sales in app/protocol.js): Stav.
create or replace function private.is_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_person() in ('stav'), false);
$$;
revoke execute on function private.is_sales() from public, anon;
grant execute on function private.is_sales() to authenticated;

-- ── Deals from the field ─────────────────────
create table if not exists public.deal_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  seller text check (seller is null or seller in ('stav')),
  business_name text not null check (length(btrim(business_name)) between 1 and 120),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 7 and 30),
  tier text not null check (tier in ('podcast', 'social', 'social-tv')),
  influencer text not null check (influencer in ('natali', 'simeon')),
  paid text[] not null default '{}' check (paid <@ array['photographer', 'natali-reel', 'natali-story', 'simeon-day']::text[]),
  free jsonb not null default '{}'::jsonb check (jsonb_typeof(free) = 'object'),
  discount_agorot integer not null default 0 check (discount_agorot between 0 and 20000),
  notes text check (notes is null or length(notes) <= 2000),
  -- 'pending' ממתין לחוזה, 'sent' חוזה נשלח, 'signed' נחתם, 'cancelled' בוטל.
  status text not null default 'pending' check (status in ('pending', 'sent', 'signed', 'cancelled')),
  quote_id uuid references public.quotes (id) on delete set null,
  sent_at timestamptz,
  signed_at timestamptz,
  status_by_email text,
  updated_at timestamptz not null default now()
);
create index if not exists deal_requests_status_idx on public.deal_requests (status, created_at desc);
create index if not exists deal_requests_seller_idx on public.deal_requests (created_by_email, created_at desc);
create index if not exists deal_requests_quote_idx on public.deal_requests (quote_id) where quote_id is not null;

-- Who and when come from the database, never from the browser. A new deal is always
-- the signed-in seller's, waiting for its contract. Later, only the office changes it
-- (RLS); the seller and the time it came in never change; linking a quote while it
-- waits makes it "חוזה נשלח"; each status move is stamped.
create or replace function public.deal_requests_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if me <> '' then
      new.created_by_email := me;
      new.seller := public.my_person();
      if new.seller is not null and new.seller not in ('stav') then new.seller := null; end if;
    end if;
    new.status := 'pending';
    new.quote_id := null;
    new.sent_at := null;
    new.signed_at := null;
    new.status_by_email := null;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_email := old.created_by_email;
    new.seller := old.seller;
    if new.quote_id is not null and new.quote_id is distinct from old.quote_id and new.status = 'pending' then
      new.status := 'sent';
    end if;
    if new.status is distinct from old.status then
      new.status_by_email := nullif(me, '');
      if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
      if new.status = 'signed' and new.signed_at is null then new.signed_at := now(); end if;
      if new.status = 'pending' then new.sent_at := null; new.signed_at := null; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.deal_requests_stamp() from public, anon, authenticated;
drop trigger if exists deal_requests_stamp on public.deal_requests;
create trigger deal_requests_stamp before insert or update on public.deal_requests
for each row execute function public.deal_requests_stamp();

alter table public.deal_requests enable row level security;
drop policy if exists "office and own seller read deals" on public.deal_requests;
create policy "office and own seller read deals" on public.deal_requests
  for select to authenticated
  using ((select public.is_office())
    or ((select private.is_sales()) and created_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))));
drop policy if exists "seller adds deals" on public.deal_requests;
create policy "seller adds deals" on public.deal_requests
  for insert to authenticated
  with check ((select private.is_sales()));
drop policy if exists "office moves deals" on public.deal_requests;
create policy "office moves deals" on public.deal_requests
  for update to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
revoke all on public.deal_requests from anon, authenticated;
grant select, insert, update on public.deal_requests to authenticated;

-- The quote of a deal signed: the deal is "נחתם" (the reminders tell the seller,
-- quietly). Never undoes the signature: a failure here is only a warning.
create or replace function public.deal_on_signing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from 'signed' or old.status = 'signed' then
    return new;
  end if;
  begin
    update public.deal_requests
    set status = 'signed', signed_at = coalesce(new.signed_at, now())
    where quote_id = new.id and status <> 'signed';
  exception when others then
    raise warning 'deal_on_signing failed for quote %: %', new.number, sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public.deal_on_signing() from public, anon, authenticated;
drop trigger if exists quotes_deal_signed on public.quotes;
create trigger quotes_deal_signed after update of status on public.quotes
for each row execute function public.deal_on_signing();

-- ── The characterization defaults to Ofir ────
alter table public.clients alter column characterizer set default 'ofir';

-- ── Protocol version 6 ───────────────────────
create or replace function private.protocol_version_current() returns integer
language sql immutable set search_path = '' as $$ select 6 $$;
revoke all on function private.protocol_version_current() from public, anon, authenticated;
alter table public.clients alter column protocol_version set default 6;

-- Graphics the client approved before 7ב and 23ב existed were posted: imported
-- history, so they are done and never counted as work or late.
insert into public.protocol_checks (client_id, item_key, state, note)
select a.client_id, x.posted, 'done', 'ייבוא'
from public.protocol_checks a
join (values ('p07.approved', 'p07b.posted'), ('p23.approved', 'p23b.posted')) as x (approved, posted) on a.item_key = x.approved
where a.state = 'done'
on conflict (client_id, item_key) do nothing;

-- ── The station-change message (milestone) ───
-- The same text as DEFAULT_TEMPLATES in app/messages-logic.js (tests/messages.test.mjs).
-- seed:begin
insert into public.message_templates (key, title, kind, station, body) values
  ('station_change', 'מעבר לשלב הבא', 'milestone', null, $t$היי, אנחנו כרגע לאחר שלב {השלב שהסתיים}, ומתקדמים לשלב {השלב הבא}$t$)
on conflict (key) do nothing;
-- seed:end

-- ── Who writes which protocol item (v6) ──────
-- protocol-writers:begin (generated by scripts/protocol-writers.mjs from app/protocol.js; do not edit by hand)
delete from private.protocol_writers;
insert into private.protocol_writers (key, proc, round, persons) values
  ('@office', null, false, array['irit', 'lior', 'ofir']::text[]),
  ('@editors', null, false, array['anna', 'nadia', 'nirel', 'yariv']::text[]),
  ('p05.newlogo', 'p05', false, array['ilai']::text[]),
  ('p05.@wait', 'p05', false, array['ilai', 'irit', 'lior', 'ofir']::text[]),
  ('p05.@part', 'p05', false, array['ilai', 'irit', 'lior', 'ofir']::text[]),
  ('p06.verified', 'p06', false, array['ilai']::text[]),
  ('p06.newpages', 'p06', false, array['ilai']::text[]),
  ('p06.name', 'p06', false, array['ilai']::text[]),
  ('p06.bio', 'p06', false, array['ilai']::text[]),
  ('p06.details', 'p06', false, array['ilai']::text[]),
  ('p06.phone', 'p06', false, array['ilai']::text[]),
  ('p06.address', 'p06', false, array['ilai']::text[]),
  ('p06.look', 'p06', false, array['ilai']::text[]),
  ('p06.metricool', 'p06', false, array['ilai']::text[]),
  ('p06.@part', 'p06', false, array['ilai', 'lior']::text[]),
  ('p07.made', 'p07', false, array['ilai']::text[]),
  ('p07.@wait', 'p07', false, array['ilai', 'irit', 'lior']::text[]),
  ('p07.@part', 'p07', false, array['ilai', 'irit', 'lior']::text[]),
  ('p07b.posted', 'p07b', false, array['ilai']::text[]),
  ('p07b.@part', 'p07b', false, array['ilai']::text[]),
  ('p09.file', 'p09', false, array['ilai']::text[]),
  ('p09.c.name', 'p09', false, array['ilai']::text[]),
  ('p09.c.months', 'p09', false, array['ilai']::text[]),
  ('p09.c.num', 'p09', false, array['ilai']::text[]),
  ('p09.c.link', 'p09', false, array['ilai']::text[]),
  ('p09.c.day', 'p09', false, array['ilai']::text[]),
  ('p09.c.date', 'p09', false, array['ilai']::text[]),
  ('p09.c.time', 'p09', false, array['ilai']::text[]),
  ('p09.@part', 'p09', false, array['ilai']::text[]),
  ('p17b.arrived', 'p17b', true, array['eli']::text[]),
  ('p17b.drive', 'p17b', true, array['eli']::text[]),
  ('p17b.gear', 'p17b', true, array['eli']::text[]),
  ('p17b.zones', 'p17b', true, array['eli']::text[]),
  ('p17b.broll', 'p17b', true, array['eli']::text[]),
  ('p17b.variety', 'p17b', true, array['eli']::text[]),
  ('p17b.@part', 'p17b', true, array['eli']::text[]),
  ('p18b.order', 'p18b', true, array['eli']::text[]),
  ('p18b.quality', 'p18b', true, array['eli']::text[]),
  ('p18b.numbered', 'p18b', true, array['eli']::text[]),
  ('p18b.@part', 'p18b', true, array['eli']::text[]),
  ('p19b.folders', 'p19b', true, array['eli']::text[]),
  ('p19b.complete', 'p19b', true, array['eli']::text[]),
  ('p19b.opens', 'p19b', true, array['eli']::text[]),
  ('p19b.cards', 'p19b', true, array['eli']::text[]),
  ('p19b.handed', 'p19b', true, array['eli']::text[]),
  ('p19b.notes', 'p19b', true, array['eli']::text[]),
  ('p19b.@part', 'p19b', true, array['eli']::text[]),
  ('p22.received', 'p22', true, array['@editor']::text[]),
  ('p22.check.footage', 'p22', true, array['@editor']::text[]),
  ('p22.check.scripts', 'p22', true, array['@editor']::text[]),
  ('p22.check.logo', 'p22', true, array['@editor']::text[]),
  ('p22.check.phone', 'p22', true, array['@editor']::text[]),
  ('p22.edited', 'p22', true, array['@editor']::text[]),
  ('p22.self.spelling', 'p22', true, array['@editor']::text[]),
  ('p22.self.broll', 'p22', true, array['@editor']::text[]),
  ('p22.self.closing', 'p22', true, array['@editor']::text[]),
  ('p22.self.complete', 'p22', true, array['@editor']::text[]),
  ('p22.@wait', 'p22', true, array['@editor']::text[]),
  ('p22.@pause', 'p22', true, array['@editor', '@editor-free']::text[]),
  ('p22.@part', 'p22', true, array['@editor']::text[]),
  ('p23.made', 'p23', false, array['ilai']::text[]),
  ('p23.@wait', 'p23', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p23.@part', 'p23', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p23b.posted', 'p23b', false, array['ilai']::text[]),
  ('p23b.@part', 'p23b', false, array['ilai']::text[]),
  ('p24.drive', 'p24', true, array['@editor']::text[]),
  ('p24.dropbox', 'p24', true, array['@editor']::text[]),
  ('p24.notify', 'p24', true, array['@editor']::text[]),
  ('p24.@wait', 'p24', true, array['@editor', 'ofir']::text[]),
  ('p24.@part', 'p24', true, array['@editor', 'ofir']::text[]),
  ('p27.fixes', 'p27', true, array['@editor']::text[]),
  ('p27.final', 'p27', true, array['@editor']::text[]),
  ('p27.toilai', 'p27', true, array['ilai']::text[]),
  ('p27.@wait', 'p27', true, array['@editor', 'ilai', 'irit']::text[]),
  ('p27.@pause', 'p27', true, array['@editor', '@editor-free']::text[]),
  ('p27.@part', 'p27', true, array['@editor', 'ilai', 'irit']::text[]),
  ('p28.scheduled', 'p28', true, array['ilai']::text[]),
  ('p28.@part', 'p28', true, array['ilai']::text[]),
  ('p29.filled', 'p29', true, array['ilai']::text[]),
  ('p29.@claim', 'p29', true, array['ilai', 'irit']::text[]),
  ('p29.@part', 'p29', true, array['ilai', 'irit']::text[]),
  ('p17b.brollq', 'p17b', true, array['eli']::text[]),
  ('p22.missing', 'p22', true, array['@editor']::text[]),
  ('p27.fixed', 'p27', true, array['@editor']::text[]),
  ('p25.@qafixed', 'p25', true, array['@editor']::text[]),
  ('p23.@qafixed', 'p23', false, array['ilai']::text[]);
-- protocol-writers:end
