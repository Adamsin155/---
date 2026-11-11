-- WAITING FOR THE OWNER'S APPROVAL. Not a migration: nothing runs this file. NOT RUN.
--
-- "אולמי הפרדס" (client 4db484e4-eaae-5c5e-96c9-a6363ed78aa1), 11.11.2026; docs/ops.md, section 128.
--
-- בעברית, במשפט אחד: הסרטונים והגרפיקות שלא עלו ולא סומנו באולמי הפרדס מקבלים תאריכים מ־12.11
-- ועד סוף החבילה (אותם ימים ושעות של התבנית, כל 72 הסרטונים ו־36 הגרפיקות), כך ש־46 השורות
-- שנראות עכשיו "חסר" בעבר כבר לא יופיעו כחסרות; שום דבר אחר לא משתנה.
--
-- What was found (read-only, 11.11.2026):
--   - The Gantt was made on 9.10.2026 from the template, all 135 rows untouched: every row is
--     'planned', source 'manual', not moved (edited false), no link, no file, no note.
--   - 46 video/graphic rows sit before 11.11 (July to 9.11) and read "חסר".
--   - Metricool: the client is NOT connected to a brand (clients.metricool_blog_id is null) and
--     its Gantt has no mc_* row. So nothing in the system says any of them went up. (The brand
--     "מסעדת בוכרה" is connected to the other client "מסעדת בוכרה/ בוריס דחקנוב אולמי הפרדס",
--     38dd8651-…, which has no Gantt, only 2 extra rows from Metricool: 7.10 and 5.11, both
--     published. Whether those posts are Olami HaPardes' content is a question for the owner.)
--   - Drive: the card has no Drive folder (clients.links has no 'drive'), so drive_daily and
--     drive_scan_state have nothing for it and the drive function cannot list its files.
--
-- What this does: the 109 template rows whose date changes under the new rule (generatePlan
-- with today = 2026-11-12: videos and graphics, and the Highlights, from that day on) get the new
-- day and time. Only a row still exactly as the template left it is touched (the guard below), so
-- anything someone marked, moved or linked since this file was written stays. No mc_* field is
-- touched; set_config('astrateg.gantt_sync', …) is therefore not needed and not used (the
-- trigger keeps source 'manual' because the state does not change). Nothing is deleted.
-- Run it on 12.11.2026; a later day needs the file made again (the dates start from that day).
--
-- Videos / graphics per calendar month, before -> after:
--   2026-07    6 /  4   ->    0 /  0
--   2026-08    7 /  4   ->    0 /  0
--   2026-09    7 /  4   ->    0 /  0
--   2026-10    7 /  3   ->    0 /  0
--   2026-11    7 /  3   ->    6 /  3
--   2026-12    8 /  3   ->   12 /  7
--   2027-01    6 /  3   ->   10 /  5
--   2027-02    5 /  3   ->   11 /  5
--   2027-03    7 /  3   ->   11 /  6
--   2027-04    5 /  3   ->   11 /  5
--   2027-05    7 /  3   ->   10 /  4
--   2027-06    0 /  0   ->    1 /  1
--
begin;

with v(key, day, time_il, old_day) as (values
    ('highlight.1', date '2026-11-12', time '12:00', date '2026-07-05'),
    ('video.1', date '2026-11-12', time '19:00', date '2026-07-05'),
    ('video.2', date '2026-11-15', time '19:00', date '2026-07-09'),
    ('graphic.1', date '2026-11-16', time '13:00', date '2026-07-08'),
    ('video.3', date '2026-11-19', time '19:00', date '2026-07-14'),
    ('video.4', date '2026-11-22', time '19:00', date '2026-07-19'),
    ('graphic.2', date '2026-11-23', time '13:00', date '2026-07-15'),
    ('video.5', date '2026-11-24', time '19:00', date '2026-07-23'),
    ('graphic.3', date '2026-11-25', time '13:00', date '2026-07-22'),
    ('video.6', date '2026-11-29', time '19:00', date '2026-07-28'),
    ('video.7', date '2026-12-01', time '19:00', date '2026-08-02'),
    ('graphic.4', date '2026-12-02', time '13:00', date '2026-07-29'),
    ('video.8', date '2026-12-03', time '19:00', date '2026-08-04'),
    ('video.9', date '2026-12-06', time '19:00', date '2026-08-09'),
    ('graphic.5', date '2026-12-07', time '13:00', date '2026-08-05'),
    ('video.10', date '2026-12-08', time '19:00', date '2026-08-13'),
    ('video.11', date '2026-12-13', time '19:00', date '2026-08-18'),
    ('graphic.6', date '2026-12-14', time '13:00', date '2026-08-12'),
    ('video.12', date '2026-12-15', time '19:00', date '2026-08-23'),
    ('graphic.7', date '2026-12-16', time '13:00', date '2026-08-24'),
    ('video.13', date '2026-12-17', time '19:00', date '2026-08-27'),
    ('video.14', date '2026-12-20', time '19:00', date '2026-09-01'),
    ('graphic.8', date '2026-12-21', time '13:00', date '2026-08-31'),
    ('video.15', date '2026-12-22', time '19:00', date '2026-09-03'),
    ('video.16', date '2026-12-27', time '19:00', date '2026-09-08'),
    ('graphic.9', date '2026-12-28', time '13:00', date '2026-09-07'),
    ('video.17', date '2026-12-29', time '19:00', date '2026-09-10'),
    ('graphic.10', date '2026-12-30', time '13:00', date '2026-09-14'),
    ('video.18', date '2026-12-31', time '19:00', date '2026-09-17'),
    ('video.19', date '2027-01-03', time '19:00', date '2026-09-24'),
    ('graphic.11', date '2027-01-04', time '13:00', date '2026-09-23'),
    ('video.20', date '2027-01-05', time '19:00', date '2026-09-27'),
    ('video.21', date '2027-01-10', time '19:00', date '2026-10-01'),
    ('graphic.12', date '2027-01-11', time '13:00', date '2026-09-30'),
    ('video.22', date '2027-01-12', time '19:00', date '2026-10-04'),
    ('graphic.13', date '2027-01-13', time '13:00', date '2026-10-07'),
    ('video.23', date '2027-01-14', time '19:00', date '2026-10-08'),
    ('video.24', date '2027-01-19', time '19:00', date '2026-10-13'),
    ('graphic.14', date '2027-01-20', time '13:00', date '2026-10-19'),
    ('video.25', date '2027-01-21', time '19:00', date '2026-10-18'),
    ('video.26', date '2027-01-24', time '19:00', date '2026-10-22'),
    ('graphic.15', date '2027-01-25', time '13:00', date '2026-10-28'),
    ('video.27', date '2027-01-26', time '19:00', date '2026-10-27'),
    ('video.28', date '2027-01-31', time '19:00', date '2026-11-01'),
    ('graphic.16', date '2027-02-01', time '13:00', date '2026-11-09'),
    ('video.29', date '2027-02-02', time '19:00', date '2026-11-03'),
    ('graphic.17', date '2027-02-03', time '13:00', date '2026-11-18'),
    ('video.30', date '2027-02-04', time '19:00', date '2026-11-08'),
    ('video.31', date '2027-02-07', time '19:00', date '2026-11-12'),
    ('video.32', date '2027-02-09', time '19:00', date '2026-11-17'),
    ('graphic.18', date '2027-02-10', time '13:00', date '2026-11-30'),
    ('video.33', date '2027-02-11', time '19:00', date '2026-11-22'),
    ('video.34', date '2027-02-14', time '19:00', date '2026-11-26'),
    ('graphic.19', date '2027-02-17', time '13:00', date '2026-12-09'),
    ('video.35', date '2027-02-18', time '19:00', date '2026-12-01'),
    ('video.36', date '2027-02-21', time '19:00', date '2026-12-03'),
    ('graphic.20', date '2027-02-22', time '13:00', date '2026-12-21'),
    ('video.37', date '2027-02-23', time '19:00', date '2026-12-08'),
    ('video.38', date '2027-02-25', time '19:00', date '2026-12-13'),
    ('video.39', date '2027-02-28', time '19:00', date '2026-12-17'),
    ('graphic.21', date '2027-03-01', time '13:00', date '2026-12-28'),
    ('video.40', date '2027-03-02', time '19:00', date '2026-12-22'),
    ('graphic.22', date '2027-03-03', time '13:00', date '2027-01-06'),
    ('video.41', date '2027-03-04', time '19:00', date '2026-12-27'),
    ('video.42', date '2027-03-07', time '19:00', date '2026-12-31'),
    ('video.43', date '2027-03-09', time '19:00', date '2027-01-05'),
    ('graphic.23', date '2027-03-10', time '13:00', date '2027-01-18'),
    ('video.44', date '2027-03-14', time '19:00', date '2027-01-10'),
    ('video.45', date '2027-03-16', time '19:00', date '2027-01-14'),
    ('graphic.24', date '2027-03-17', time '13:00', date '2027-01-27'),
    ('video.46', date '2027-03-18', time '19:00', date '2027-01-21'),
    ('video.47', date '2027-03-21', time '19:00', date '2027-01-26'),
    ('video.48', date '2027-03-23', time '19:00', date '2027-01-31'),
    ('graphic.25', date '2027-03-24', time '13:00', date '2027-02-08'),
    ('video.49', date '2027-03-28', time '19:00', date '2027-02-07'),
    ('video.50', date '2027-03-30', time '19:00', date '2027-02-11'),
    ('graphic.26', date '2027-03-31', time '13:00', date '2027-02-17'),
    ('video.51', date '2027-04-01', time '19:00', date '2027-02-16'),
    ('video.52', date '2027-04-04', time '19:00', date '2027-02-21'),
    ('graphic.27', date '2027-04-05', time '13:00', date '2027-02-24'),
    ('video.53', date '2027-04-06', time '19:00', date '2027-02-25'),
    ('graphic.28', date '2027-04-07', time '13:00', date '2027-03-08'),
    ('video.54', date '2027-04-08', time '19:00', date '2027-03-02'),
    ('video.55', date '2027-04-11', time '19:00', date '2027-03-07'),
    ('video.56', date '2027-04-13', time '19:00', date '2027-03-11'),
    ('graphic.29', date '2027-04-14', time '13:00', date '2027-03-17'),
    ('video.57', date '2027-04-15', time '19:00', date '2027-03-16'),
    ('video.58', date '2027-04-18', time '19:00', date '2027-03-21'),
    ('graphic.30', date '2027-04-19', time '13:00', date '2027-03-29'),
    ('video.59', date '2027-04-20', time '19:00', date '2027-03-25'),
    ('video.60', date '2027-04-25', time '19:00', date '2027-03-30'),
    ('graphic.31', date '2027-04-26', time '13:00', date '2027-04-07'),
    ('video.61', date '2027-04-29', time '19:00', date '2027-04-04'),
    ('video.62', date '2027-05-02', time '19:00', date '2027-04-08'),
    ('graphic.32', date '2027-05-03', time '13:00', date '2027-04-14'),
    ('video.63', date '2027-05-04', time '19:00', date '2027-04-13'),
    ('video.64', date '2027-05-06', time '19:00', date '2027-04-18'),
    ('graphic.33', date '2027-05-10', time '13:00', date '2027-04-26'),
    ('video.65', date '2027-05-11', time '19:00', date '2027-04-25'),
    ('video.66', date '2027-05-13', time '19:00', date '2027-05-02'),
    ('video.67', date '2027-05-16', time '19:00', date '2027-05-06'),
    ('graphic.34', date '2027-05-19', time '13:00', date '2027-05-05'),
    ('video.68', date '2027-05-20', time '19:00', date '2027-05-11'),
    ('video.69', date '2027-05-23', time '19:00', date '2027-05-16'),
    ('video.70', date '2027-05-25', time '19:00', date '2027-05-20'),
    ('graphic.35', date '2027-05-26', time '13:00', date '2027-05-19'),
    ('video.71', date '2027-05-30', time '19:00', date '2027-05-25'),
    ('video.72', date '2027-06-01', time '19:00', date '2027-05-30'),
    ('graphic.36', date '2027-06-02', time '13:00', date '2027-05-31')
)
update public.client_gantt g
set day = v.day, time_il = v.time_il, template_version = 2
from v
where g.client_id = '4db484e4-eaae-5c5e-96c9-a6363ed78aa1'
  and g.key = v.key
  and g.day = v.old_day           -- still on the template's old day
  and g.state = 'planned' and not g.edited
  and g.link is null and g.file_id is null and g.note is null and g.mc_post_id is null;

-- Expect 109 rows updated. Check before commit:
--   select count(*) from public.client_gantt where client_id = '4db484e4-eaae-5c5e-96c9-a6363ed78aa1'
--     and kind in ('video', 'graphic', 'highlight') and state = 'planned' and day < date '2026-11-12';   -- expect 0
commit;
