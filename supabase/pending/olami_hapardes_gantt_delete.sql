-- WAITING FOR THE OWNER'S APPROVAL. Not a migration: nothing runs this file. NOT RUN.
-- It DELETES rows: it needs the owner's explicit approval for this delete (CLAUDE.md).
--
-- "אולמי הפרדס" (client 4db484e4-eaae-5c5e-96c9-a6363ed78aa1), 11.11.2026; docs/ops.md, section 128.
--
-- בעברית, במשפט אחד: מוחקים מהגאנט של אולמי הפרדס את 108 הסרטונים והגרפיקות (72 סרטונים ו־36
-- גרפיקות) שהתבנית שמה ב־9.10 ואף אחד לא תזמן, סימן, קישר או הזיז, כי מעכשיו הגאנט מראה רק מה
-- שבאמת מתוזמן; כל שאר הגאנט נשאר.
--
-- What was found (read-only, 11.11.2026):
--   - The Gantt was made on 9.10.2026 from the old template: 135 rows, all untouched ('planned',
--     source 'manual', not moved, no link, no file, no note, no Metricool post).
--   - 108 of them are videos (72) and graphics (36): 46 before 11.11 (they read "חסר"), 62 after.
--   - Metricool: the client is not connected to a brand, so no post of it is on the Gantt. (The
--     brand "מסעדת בוכרה" is connected to the other client "מסעדת בוכרה/ בוריס דחקנוב אולמי
--     הפרדס", 38dd8651-…, with 2 extra rows of 7.10 and 5.11: a question for the owner.)
--   - Drive: the card has no Drive folder, so nothing can be read or matched from there.
-- After it runs: the counter on top reads "סרטונים: תוזמנו 0 מתוך 72 בחבילה" and "גרפיקות:
-- תוזמנו 0 מתוך 36 בחבילה"; once the brand and the Drive folder are connected, the sync and
-- "משיכת קישורים מהדרייב" bring the real ones. Kept: the shoot days, the reports, the month
-- plans, the Highlights, the renewal call and the end (27 rows).
begin;

delete from public.client_gantt g
where g.client_id = '4db484e4-eaae-5c5e-96c9-a6363ed78aa1'
  and g.kind in ('video', 'graphic')
  and g.key ~ '^(video|graphic)\.[0-9]+$'
  and g.state = 'planned' and not g.edited and g.source = 'manual'
  and g.link is null and g.file_id is null and g.note is null
  and g.mc_post_id is null and g.mc_status is null and not g.mc_extra
  and g.created_at < timestamptz '2026-10-10';   -- only what the template made on 9.10

-- Expect 108 rows deleted. Check before commit:
--   select kind, count(*) from public.client_gantt where client_id = '4db484e4-eaae-5c5e-96c9-a6363ed78aa1' group by 1;
--   -- expect no 'video' and no 'graphic'; 27 rows in all
commit;
