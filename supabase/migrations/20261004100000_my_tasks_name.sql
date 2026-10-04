-- The personal work screen is now called "המשימות שלי" (the owner's decision, 3.10.2026).
-- The WhatsApp consent wording names that screen. Nobody has been shown version 1 yet
-- (the switch is off), so the wording is corrected in place; once anyone has decided,
-- a change of wording is a new version, and this statement does nothing.
update public.whatsapp_consent_texts t
   set body = replace(t.body, 'מה עליי', 'המשימות שלי')
 where t.body like '%מה עליי%'
   and not exists (select 1 from public.whatsapp_consent_log);
