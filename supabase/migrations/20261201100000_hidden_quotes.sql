-- A signed quote that is not listed in "הצעות שנשלחו" (the owner, 5.11.2026: האלופים פחחות וצבע
-- signed twice, AST-2026-0062 and AST-2026-0064, for one business). A signed quote never changes
-- (signed quotes are immutable), so it is not cancelled or removed: it is named here, with why, and
-- the list and its sums skip it (app/dashboard.js; docs/ops.md, section 107).
--
-- Who: reads, whoever reads the quotes (the office, and whoever sees the quotes' money). Nobody
-- writes from the site: a row is added by the office's SQL, at the owner's request.
--
-- Only adds. Safe to run again.

create table if not exists public.hidden_quotes (
  quote_id uuid primary key references public.quotes (id),
  reason text not null check (char_length(reason) between 1 and 300),
  created_at timestamptz not null default now()
);

alter table public.hidden_quotes enable row level security;
revoke all on table public.hidden_quotes from public, anon, authenticated;
grant select on table public.hidden_quotes to authenticated;

drop policy if exists "quote readers read hidden quotes" on public.hidden_quotes;
create policy "quote readers read hidden quotes" on public.hidden_quotes
  for select to authenticated
  using ((select public.is_office()) or (select public.sees_quote_money()));

-- The first one: the duplicate of האלופים פחחות וצבע.
insert into public.hidden_quotes (quote_id, reason)
select q.id, 'כפילות של AST-2026-0064 (האלופים פחחות וצבע). התיק שנפתח ממנה בארכיון.'
  from public.quotes q
 where q.number = 'AST-2026-0062'
on conflict (quote_id) do nothing;

select q.number as "הצעה", h.reason as "למה מוסתרת"
  from public.hidden_quotes h join public.quotes q on q.id = h.quote_id;
