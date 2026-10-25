-- "הכנת חוזה עם AI" (the owner's decisions of 25.10.2026; docs/ops.md, section 68).
--   1. public.contract_ai_runs: every preparation the contract-ai edge function made: who, when,
--      the words the office wrote, the result after the check against the catalog, and what was
--      left out of it. Written by that function only (the server's role); read by whoever reads
--      all the quotes (the owners and Irit, private.quote_reader()) and by the person who made it.
--   2. public.quotes.prepared_by ('ai', or null by hand) and ai_run_id: a contract prepared with
--      "הכנת חוזה עם AI" and reviewed by the office goes to the client without a manager's
--      approval, even when it differs from the package (the owner: the whole AI flow without
--      approval; a contract filled by hand keeps the approval as before). The database decides it
--      here, from the run itself: honoured only for a successful run of the creator's own from
--      the last 24 hours, and a run prepares one contract only. Anything else is a contract by
--      hand. What differs from the package (exceptions) stays stored with an AI contract, so the
--      owners can see later what it changed; the list shows "הוכן ע״י AI".
--   3. A corrected version (public.quote_revise) is not changed: a contract that went for
--      approval stays with the managers.
-- Only adds and replaces (no table, column, row or policy is taken away). Every statement can run
-- again safely. Tested in tests/sql/contract-ai.test.mjs.

-- ── 1. The preparations ──────────────────────
create table if not exists public.contract_ai_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null,
  by_email text,
  status text not null,
  deal_text text not null,
  result jsonb,
  left_out jsonb,
  model text,
  constraint contract_ai_runs_status_check check (status in ('ok', 'error')),
  constraint contract_ai_runs_text_check check (char_length(deal_text) between 1 and 2000),
  constraint contract_ai_runs_result_check check (result is null or jsonb_typeof(result) = 'object'),
  constraint contract_ai_runs_left_out_check check (left_out is null or jsonb_typeof(left_out) = 'array')
);
create index if not exists contract_ai_runs_user_idx on public.contract_ai_runs (user_id, created_at desc);
alter table public.contract_ai_runs enable row level security;
revoke all on public.contract_ai_runs from public, anon, authenticated;
grant select on public.contract_ai_runs to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'contract_ai_runs' and policyname = 'who reads an ai run') then
    create policy "who reads an ai run" on public.contract_ai_runs
      for select to authenticated
      using ((select private.quote_reader()) = 'all' or user_id = (select auth.uid()));
  end if;
end $$;

-- ── 2. Who prepared a quote ──────────────────
alter table public.quotes
  add column if not exists prepared_by text,
  add column if not exists ai_run_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_prepared_by_check' and conrelid = 'public.quotes'::regclass) then
    alter table public.quotes add constraint quotes_prepared_by_check check (prepared_by is null or prepared_by = 'ai');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_ai_run_fkey' and conrelid = 'public.quotes'::regclass) then
    alter table public.quotes add constraint quotes_ai_run_fkey foreign key (ai_run_id) references public.contract_ai_runs (id);
  end if;
end $$;
-- One run, one contract.
create unique index if not exists quotes_ai_run_once on public.quotes (ai_run_id) where ai_run_id is not null;

-- Creating a quote: as 20261010100000_custom_contracts.sql (security definer since
-- 20261028100000_quotes_insert_fix.sql), and now the AI preparation.
create or replace function public.quotes_set_hash() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hours int := nullif(new.model ->> 'validHours', '')::int;
  v_ai boolean := false;
begin
  new.version := 1;
  new.approval_by_email := null;
  new.approval_by := null;
  new.approval_at := null;
  new.approval_note := null;
  new.submitted_by_email := lower(nullif(new.created_by_email, ''));
  -- Prepared with "הכנת חוזה עם AI": a successful run of the creator's own, from the last 24 hours.
  if new.prepared_by = 'ai' and new.ai_run_id is not null and new.created_by is not null then
    v_ai := exists (
      select 1 from public.contract_ai_runs r
      where r.id = new.ai_run_id and r.user_id = new.created_by and r.status = 'ok'
        and r.created_at > now() - interval '24 hours');
  end if;
  if not v_ai then
    new.prepared_by := null;
    new.ai_run_id := null;
  end if;
  if private.quote_is_exceptional(new.model) and not v_ai then
    new.approval := 'pending';
    new.submitted_at := new.created_at;
    new.expires_at := null;
  else
    new.approval := 'none';
    -- An AI contract keeps what it changed, for the owners to see.
    if not v_ai then
      new.exceptions := null;
    end if;
    new.submitted_at := null;
    if v_hours is not null then
      new.expires_at := new.created_at + make_interval(hours => v_hours);
    end if;
  end if;
  new.model := new.model
    || jsonb_build_object('number', new.number, 'createdAt', new.created_at)
    || case when new.expires_at is null then '{}'::jsonb
            else jsonb_build_object('validUntil', new.expires_at) end;
  new.doc_hash := encode(extensions.digest(new.model::text, 'sha256'), 'hex');
  return new;
end $$;
revoke execute on function public.quotes_set_hash() from public, anon, authenticated;

-- Nothing changes outside the approval functions: as 20261010100000_custom_contracts.sql, and
-- who prepared the quote is fixed at its creation like the rest.
create or replace function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
declare flow boolean := coalesce(current_setting('astrateg.quote_flow', true), '') = 'on';
begin
  if old.status = 'signed' then
    raise exception 'signed quotes are immutable';
  end if;
  if new.prepared_by is distinct from old.prepared_by or new.ai_run_id is distinct from old.ai_run_id then
    raise exception 'who prepared a quote is fixed at its creation';
  end if;
  if not flow then
    if new.model is distinct from old.model or new.doc_hash is distinct from old.doc_hash
       or new.expires_at is distinct from old.expires_at then
      raise exception 'quote content is immutable';
    end if;
    if new.approval is distinct from old.approval or new.approval_by_email is distinct from old.approval_by_email
       or new.approval_by is distinct from old.approval_by or new.approval_at is distinct from old.approval_at
       or new.approval_note is distinct from old.approval_note or new.exceptions is distinct from old.exceptions
       or new.version is distinct from old.version or new.submitted_at is distinct from old.submitted_at
       or new.submitted_by_email is distinct from old.submitted_by_email then
      raise exception 'the approval of a quote changes only through its functions';
    end if;
  end if;
  if new.status = 'signed' and new.approval in ('pending', 'rejected') then
    raise exception 'this contract awaits a manager''s approval' using errcode = '42501';
  end if;
  if new.status = 'signed' then
    new.first_viewed_at := coalesce(old.first_viewed_at, new.signed_at);
  end if;
  return new;
end $$;
revoke all on function public.quotes_freeze_model() from public, anon, authenticated;
