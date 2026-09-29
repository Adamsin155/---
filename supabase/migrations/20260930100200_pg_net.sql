-- HTTP calls from the database (pg_net): used to check the edge functions from
-- inside the project, and by the reminder engine's scheduler (stage 3). Kept in
-- the extensions schema, not public (Supabase security advisor 0014).
create extension if not exists pg_net with schema extensions;
