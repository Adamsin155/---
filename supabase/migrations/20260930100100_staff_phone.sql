-- Handoff buttons (stage 1): each person's WhatsApp number, so passing work on
-- opens a chat with the next person with the message ready (app/handoffs.js).
-- Digits only, in international form without the plus (972501234567); set only
-- through the staff-admin function (team.html: the owner, Irit and Lior), which
-- keeps Israeli mobile numbers only. Staff already read the staff list
-- ("staff read staff", select granted to authenticated), so the app reads the
-- numbers from there; anyone else sees at most their own row.
alter table public.staff add column if not exists phone text
  constraint staff_phone_check check (phone is null or phone ~ '^\+?[0-9]{8,15}$');

-- The team screen's log records who changed a number (never the number itself).
alter table public.staff_admin_log drop constraint if exists staff_admin_log_action_check;
alter table public.staff_admin_log add constraint staff_admin_log_action_check
  check (action in ('upsert', 'remove', 'link', 'phone'));
