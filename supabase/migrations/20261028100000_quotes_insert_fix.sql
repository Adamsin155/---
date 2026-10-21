-- A new quote could not be saved (the owner, 21.10.2026: "הפעולה לא הושלמה" on "יצירת קישור לחתימה";
-- the last quote in the system was from 5.10.2026). create-quote inserts with the server's role, and the
-- BEFORE INSERT trigger public.quotes_set_hash() (20261010100000_custom_contracts.sql) asks
-- private.quote_is_exceptional(), which that role may not reach: "permission denied for schema private".
-- The trigger only fills fields of the new row, so it runs as its owner, like the other trigger
-- functions of quotes that reach private (quotes_log_submitted is already security definer).
alter function public.quotes_set_hash() security definer;
alter function public.quotes_set_hash() set search_path = '';
revoke execute on function public.quotes_set_hash() from public, anon, authenticated;
