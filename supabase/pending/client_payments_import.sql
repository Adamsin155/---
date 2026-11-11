-- "תשלומי לקוחות": the old CRM's deals (old-crm-2710.json, 27.10.2026) into public.client_payments
-- (supabase/migrations/20261212100000_client_payments.sql; docs/ops.md, section 130).
-- NOT RUN. Runs after the migration, as the database owner, after the owner's approval
-- ("מאשר להריץ את ה-SQL"). Only inserts; safe to run twice (old_crm_deal_id is unique: a deal
-- already imported is skipped, and a row an owner corrected since stays as he left it).
-- A deal whose client is not in public.clients (deleted since) is skipped.
-- Only the payment fields are taken from the old CRM: no phone, email or login of any client.
-- Methods: פיימנט = payment, שיקים = checks, העברה בנקאית = transfer, כרטיס אשראי = card, empty = null ("לא הוזן").
-- The cheques' count and first date are kept on a cheques deal only (the table's check).
-- Matching (114 deals): 76 sure (75 by the client's id from the
-- clients import, .playwright-mcp/go-live/import-clients.mjs clientUuid, and 1 by the same business name);
-- 8 probable ones in part B, commented out until the owner confirms each; 30 with no client here.

begin;

-- ── A. Sure (76 deals) ──
insert into public.client_payments (old_crm_deal_id, client_id, amount, retainer, method, checks_count, first_check_date, deal_date, package, source)
select v.deal_id, v.client_id, v.amount, v.retainer, v.method, v.checks_count, v.first_check_date, v.deal_date, v.package, 'old_crm'
from (values
  ('398', 'b48bb092-7d54-571e-acec-6f1ee88da476'::uuid, 21240, 1500, 'payment', null, null::date, '2025-12-02'::date, 'חבילה 1500') /* מזליטו */,
  ('404', '6502a75a-4667-5750-b361-38fd714d71f2'::uuid, 49560, 3500, 'payment', null, null::date, '2025-12-17'::date, 'הרכבה אישית 3500') /* אלקטריק טופ (ירת החשמל) */,
  ('407', '283a5fbf-c98a-53e4-8f5c-f934760d17e0'::uuid, 49560, 3500, 'checks', 12, null::date, '2026-01-15'::date, 'נטלי 3500') /* רות שטיחים */,
  ('408', '17a38e17-577c-5e1b-b8b9-845abb9840c9'::uuid, 28320, 2000, 'payment', null, null::date, '2025-12-31'::date, 'סמיון 2000') /* עוז דנטל מרפאת שיניים */,
  ('412', 'b804f05d-2f2f-5533-9593-84b4b630459e'::uuid, 49560, 3500, 'payment', null, null::date, '2026-01-07'::date, 'חבילה 3500') /* שווארמה לשלום */,
  ('416', '04a076c4-21e7-5185-9ac8-71856656cfef'::uuid, 42480, 3000, 'payment', null, null::date, '2026-01-22'::date, null) /* perfect sin tattoo */,
  ('418', '3f78478e-16b9-504e-a25b-1a076d98fd68'::uuid, 28320, 2000, 'payment', null, null::date, '2026-02-05'::date, null) /* בר בשר */,
  ('419', '58fd8c11-3b50-52a6-9175-995096af48cd'::uuid, 55224, 3900, 'payment', null, null::date, null::date, null) /* פינת החי */,
  ('420', 'e61d5e71-33b2-5145-a96f-426b55202030'::uuid, 55000, 3900, 'payment', null, null::date, '2026-03-09'::date, null) /* לאב מובייל */,
  ('421', '691ab1e5-80de-5d24-8a2b-01c0e1656e24'::uuid, 52392, 3900, 'payment', null, null::date, '2026-04-28'::date, null) /* יוני בי */,
  ('423', '42ae9680-5769-57d4-a99f-f8541b782dd6'::uuid, 55224, 3900, 'payment', null, null::date, '2026-05-03'::date, null) /* פינוק ישראל */,
  ('427', 'f7821e26-fee9-5c44-ba4b-7a6509a8a7ad'::uuid, 55000, 0, 'payment', null, null::date, '2026-05-06'::date, null) /* הברון פט */,
  ('428', '05766113-5cbd-5317-8e8f-8dae3159c0fe'::uuid, 55000, 3900, 'payment', null, null::date, '2026-05-06'::date, null) /* קר ווש סלף */,
  ('429', '030fa1d2-7533-54c3-8f9a-d70925270b02'::uuid, 55000, 3900, 'payment', null, null::date, '2026-05-06'::date, null) /* ד"ר בייגל. י.י.ן אמין ניהול מסעדות בע"מ */,
  ('431', '01d3629b-aeb3-59de-8520-fb3900afd73e'::uuid, 55000, 0, 'payment', null, null::date, '2026-05-17'::date, null) /* דיקור סנטר ירכא */,
  ('432', '49b4f262-27bf-54ec-9c5b-57a9ed34a9c4'::uuid, 55224, 3900, 'payment', null, null::date, '2026-05-20'::date, null) /* גרר גולן בע"מ */,
  ('433', '38dd8651-942d-5265-a30b-474278f7915b'::uuid, 55224, 3900, 'payment', null, null::date, '2026-05-25'::date, null) /* מסעדת בוכרה/ בוריס דחקנוב אולמי הפרדס */,
  ('434', '38dd8651-942d-5265-a30b-474278f7915b'::uuid, 55224, 3900, 'payment', null, null::date, '2026-05-27'::date, null) /* מסעדת בוכרה/ בוריס דחקנוב אולמי הפרדס */,
  ('437', '46d8fae3-b5bc-5d4a-a938-3cd981ea23b4'::uuid, 110448, 0, 'checks', null, null::date, '2026-06-01'::date, '2 עסקים 12 צ׳קים') /* פרש/ י.ד עידה בע"מ */,
  ('438', '25ce2703-3fd7-5024-9622-712252f2a594'::uuid, 55224, 3900, 'payment', null, null::date, '2026-06-03'::date, null) /* הארי משקאות בע"מ */,
  ('440', '389f980d-96f6-5e14-9a57-52fa1ec848cf'::uuid, 53808, 3900, 'payment', null, null::date, '2026-06-15'::date, null) /* Relax manual therapy clinic */,
  ('443', 'b71bd88c-53e0-5cde-8c10-6dcad1e9704a'::uuid, 55224, 3900, 'payment', null, null::date, '2026-06-21'::date, null) /* מיוזיקול הגברה ותאורה */,
  ('445', '2c3d381c-63b6-5bb7-bf27-76c37ba666f3'::uuid, 69384, 3900, 'checks', 12, null::date, '2026-06-24'::date, null) /* יין בעיר בני ברק */,
  ('446', '341738d8-02d5-51cb-b9e1-8671fad9fa41'::uuid, 55224, 3900, 'payment', null, null::date, '2026-06-28'::date, null) /* עולמי הבניה סואיל */,
  ('455', 'add98774-9cee-58c9-955e-69e1bc50053e'::uuid, 23400, 3900, 'checks', null, null::date, '2026-07-20'::date, 'חצי שנתית') /* אולמי שריי */,
  ('456', '9509d529-3aa8-5bc4-9361-da78f28e29fe'::uuid, 62304, 5192, 'checks', 11, null::date, '2026-07-13'::date, '4400 באשראי , השאר ב11 צקים') /* קונקט יבוא וסחר בעמ */,
  ('458', '8cb3f50a-a09b-5dcd-9cd4-5b94cd21cedd'::uuid, 49560, 4130, 'payment', null, null::date, '2026-07-06'::date, '3500 מישל דניס סמיון') /* easy cart home */,
  ('459', '38dd8651-942d-5265-a30b-474278f7915b'::uuid, 55224, 4602, 'payment', null, null::date, '2026-07-15'::date, '3900 נטלי ') /* מסעדת בוכרה/ בוריס דחקנוב אולמי הפרדס */,
  ('460', '05766113-5cbd-5317-8e8f-8dae3159c0fe'::uuid, 52392, 4366, 'payment', null, null::date, '2026-07-15'::date, null) /* קר ווש סלף */,
  ('462', '0c533b4e-6cfe-5636-8905-3a1fd8a348fd'::uuid, 52392, 4366, 'payment', null, null::date, '2026-07-30'::date, '3700 מישל דניס וסמיון') /* צמפיון גיימינג */,
  ('463', '06ec03a6-60a9-52db-b8ac-29ba48a94c30'::uuid, 55224, 4602, 'payment', null, null::date, '2026-07-21'::date, 'נטלי חבילה') /* גוד מיט */,
  ('464', '1ba09c19-a2ca-5563-b311-c2652af21eb6'::uuid, 70800, 5900, 'payment', null, null::date, '2026-07-27'::date, '	גבי דיין בפיימנט - חבילה סמיון מישל דניס ונטלי') /* ש.ר סוכנות לביטוח (2015) בע"מ */,
  ('465', '0792d021-6148-58b6-9c2d-2a4bfb55d677'::uuid, 53100, 4425, 'payment', null, null::date, '2026-07-27'::date, 'נטלי דדון 3750') /* אורה */,
  ('468', '2372c235-d5bb-576f-a19f-10606a400b51'::uuid, 28320, 2360, 'checks', 6, null::date, '2026-02-10'::date, 'סמיון חבילה') /* אובליגור */,
  ('469', '36d2a747-f68f-5a52-8840-487310bd0d51'::uuid, 52392, 4366, 'payment', null, null::date, '2026-08-04'::date, 'מישל דניס וסמיון 3700') /* פיתה בשר */,
  ('1003', '820b4f01-a483-5d3d-a724-6ed7ad8d9950'::uuid, 35400, 2500, null, null, null::date, '2026-08-18'::date, '2500 שח נטלי דדון') /* 7 ברכות */,
  ('1064', '1331a048-103d-5a34-b934-81bf7587b1a8'::uuid, 51684, 3650, 'payment', null, null::date, '2026-08-17'::date, 'מישל דניס וסמיון') /* just meat */,
  ('1104', 'b1847e58-e562-5810-a607-8720a364a9c4'::uuid, 69384, 0, 'payment', null, null::date, '2026-08-11'::date, null) /* פרי ארץ הקודש/נקודת חן */,
  ('1201', 'a0c616d5-ce20-5161-99eb-a1acd9d3960e'::uuid, 99109, 7000, 'checks', null, null::date, '2026-08-19'::date, 'ALL IN ONE') /* סרה מיד בע״מ / queen */,
  ('1223', 'f3e09427-f7ec-5e7e-8e60-bd94013fc69c'::uuid, 31860, 4500, null, null, null::date, '2026-08-19'::date, 'ALL IN ONE') /* דבוש גבעתון בע״מ */,
  ('1242', 'b71a7b71-57e4-5f0d-a6b8-eab35342a8eb'::uuid, 55224, 3900, null, null, null::date, '2026-08-20'::date, 'ALL IN ONE') /* אושי אושי ספוט שירזי בע״מ */,
  ('1379', '45e29134-a1d8-576d-bcf8-7e1cf1c6cbf6'::uuid, 55224, 3900, 'payment', null, null::date, '2026-08-25'::date, 'ALL IN ONE') /* ענת עיצובים */,
  ('3647', 'c0e2845f-f66a-5692-909c-b786de4f087c'::uuid, 69383, 4900, 'payment', null, null::date, '2026-08-26'::date, 'ALL IN ONE') /* מגשימי החלומות/ אור לדוד */,
  ('5276', '58c01673-0302-590e-98bb-83b4e7b2c34e'::uuid, 75000, 5500, 'payment', null, null::date, '2026-08-27'::date, 'ALL IN ONE') /* פיאטו */,
  ('5362', 'fbcccf26-d46d-57b2-bc50-f6d490ec7eb5'::uuid, 55224, 3900, 'payment', null, null::date, '2026-08-30'::date, 'ALL IN ONE') /* בית הצורף */,
  ('7774', '7c2fbb28-36ba-59c9-b97b-320b9c6ebfed'::uuid, 34692, 4900, 'payment', null, null::date, '2026-08-31'::date, 'ALL IN ONE') /* פנסיון כלבים my home */,
  ('7815', 'ff3c01bd-5629-573e-87a3-731294d3b319'::uuid, 55224, 3900, 'payment', null, null::date, '2026-08-31'::date, 'ALL IN ONE') /* סביח פרישמן */,
  ('7897', '91bdaded-43ed-53ea-b0a1-2f6476505781'::uuid, 72216, 5100, 'payment', null, null::date, '2026-09-01'::date, 'ALL IN ONE') /* אומנות השיש והמטבח */,
  ('7946', 'a2e97864-44b6-503a-b54f-3b41c07b2f35'::uuid, 55224, 3900, 'payment', null, null::date, '2026-09-02'::date, 'ALL IN ONE') /* שווארמה טובול */,
  ('7964', 'a8065e04-27aa-58f8-8f92-b322779d63df'::uuid, 55224, 3900, 'payment', null, null::date, '2026-09-02'::date, 'ALL IN ONE') /* אלאור בוטיק */,
  ('8177', 'b3d90e85-889a-5b04-9d3f-b7d9729d19c6'::uuid, 55224, 3900, null, null, null::date, '2026-09-07'::date, 'ALL IN ONE') /* מל"מ */,
  ('8212', '07a676a0-4ab5-5204-a069-fddc95f3cb9d'::uuid, 55224, 3900, null, null, null::date, '2026-09-07'::date, 'ALL IN ONE') /* ניקיון והיגיינה */,
  ('8250', '6c7c6cdf-d42b-570e-bc7d-5d1aeacf0294'::uuid, 55224, 3900, 'payment', null, null::date, '2026-09-08'::date, 'ALL IN ONE') /* שילת תלמי עיצוב שיער */,
  ('8269', 'f118b68e-b917-5604-bda1-962aee5f69a0'::uuid, 55224, 3900, 'payment', null, null::date, '2026-09-08'::date, 'ALL IN ONE') /* א.מ אורסל בע״מ */,
  ('8332', 'd95b77a1-3cec-5c0e-917e-18e0e001c877'::uuid, 55224, 3900, null, null, null::date, '2026-09-09'::date, 'ALL IN ONE') /* קינג מיט */,
  ('8371', 'f381c85b-a98e-58a2-9675-b6d4cdb409a2'::uuid, 55224, 3900, 'payment', null, null::date, '2026-09-10'::date, 'ALL IN ONE') /* מידיקל פלייס  מרפאות מומחים בע״מ */,
  ('8473', '8efd2a0b-cc55-5dc5-ad6d-0e6ca5d0f8c0'::uuid, 55224, 3900, null, null, null::date, '2026-09-15'::date, 'ALL IN ONE') /* clay walls itd בע"מ */,
  ('8477', '1a2cd986-9849-55f0-b07b-cde670a11541'::uuid, 34692, 4900, 'card', null, null::date, '2026-09-15'::date, 'ALL IN ONE') /* energy1 */,
  ('8499', '81aa0969-b288-5d78-9684-3ef977c2c301'::uuid, 25000, 2119, 'checks', null, null::date, '2026-09-15'::date, 'ALL IN ONE') /* בראשית */,
  ('8606', '44df49ae-6ff2-54bf-ac85-e2831a06bbab'::uuid, 83544, 5900, null, null, null::date, '2026-09-17'::date, 'ALL IN ONE') /* אופנת פוז · מידות גדולות חיפה/xxxlarg שיווק */,
  ('8631', 'ee0a0f41-c90a-5363-bbad-0569157ae6b2'::uuid, 55224, 3900, 'checks', null, null::date, '2026-09-17'::date, 'ALL IN ONE') /* מדיקל קליניק ביי שגב בע״מ */,
  ('8639', '0d077031-6f8b-5425-a7d5-eb2d9272d4dc'::uuid, 38232, 2700, null, null, null::date, '2026-09-17'::date, 'ALL IN ONE') /* קרן נווה */,
  ('10392', 'ba2fe946-7073-5224-9816-d82f6741c196'::uuid, 52000, 3672, 'payment', null, null::date, '2026-09-23'::date, 'ALL IN ONE') /* מרפאת אשכול מרפאת שיניים דניאל גפן בע"מ */,
  ('10417', 'f4b18c2e-ef64-5461-8187-80bb2c99332f'::uuid, 35400, 2500, 'payment', null, null::date, '2026-09-23'::date, 'ALL IN ONE') /* מאיה אלימלך */,
  ('10442', '33519443-dba8-55be-97dd-3f3dd0db91ae'::uuid, 63720, 4500, 'payment', null, null::date, '2026-09-23'::date, 'ALL IN ONE') /* ממתקי העיר סיטונאות 26 בע״מ */,
  ('10459', 'f3d899aa-0587-5715-80bb-7b5b4113bffd'::uuid, 55224, 3900, 'payment', null, null::date, '2026-09-23'::date, 'ALL IN ONE') /* בריאות פלוס */,
  ('10582', '0fc8242a-0409-5cb0-9b41-36814d0070c2'::uuid, 55224, 4200, null, null, null::date, '2026-09-24'::date, 'ALL IN ONE') /* SGG / אי אי חברה לציוד עילית בעמ */,
  ('10917', '61d29105-3082-51dc-9bbe-84780197564a'::uuid, 55224, 3900, null, null, null::date, '2026-09-27'::date, 'ALL IN ONE') /* מוסך מאנול */,
  ('10971', '5152328e-bff1-56ac-b036-ee59a101c216'::uuid, 55224, 3900, null, null, null::date, '2026-09-27'::date, 'ALL IN ONE') /* יקב לגזיאל */,
  ('11528', 'b8f5a4e6-39e8-59ba-8075-87664825e5ae'::uuid, 53525, 3780, 'transfer', null, null::date, '2026-10-04'::date, 'ALL IN ONE') /* שיאן פיננסים בע״מ */,
  ('11736', 'aa693dc0-a8ce-505c-b031-b611de3fef60'::uuid, 55224, 3900, null, null, null::date, '2026-10-06'::date, 'ALL IN ONE') /* fix שיפוצים */,
  ('11760', '0a72171b-f8ff-52ed-8389-65c0074bb449'::uuid, 55224, 3900, null, null, null::date, '2026-10-06'::date, 'ALL IN ONE') /* יוסי שבתאי */,
  ('11835', '34552326-127d-59fd-a159-7bef015e0630'::uuid, 35400, 2500, null, null, null::date, '2026-10-07'::date, 'ALL IN ONE') /* ליאת לב - מאמנת מנטלית ויועצת זוגית */,
  ('11988', '9e30dbec-297b-570e-ade3-a6799842d31c'::uuid, 55224, 3900, null, null, null::date, '2026-10-08'::date, 'ALL IN ONE') /* הילה אלבז */,
  ('12047', 'ed18daa6-db33-5c5c-ac20-7d2c8ba49af3'::uuid, 55224, 3900, null, null, null::date, '2026-10-19'::date, 'ALL IN ONE') /* מובילי רן */,
  ('12213', 'b8da19ca-e57a-5794-aefb-4859d84c3b58'::uuid, 55224, 3900, null, null, null::date, '2026-10-26'::date, 'ALL IN ONE') /* סלון מארושקה */
) as v (deal_id, client_id, amount, retainer, method, checks_count, first_check_date, deal_date, package)
where exists (select 1 from public.clients c where c.id = v.client_id)
on conflict (old_crm_deal_id) do nothing;

-- ── B. Probable (8 deals): the owner confirms each match; then remove the "-- " of the
-- rows he confirmed (and of the insert around them) and run this part too. ──
-- insert into public.client_payments (old_crm_deal_id, client_id, amount, retainer, method, checks_count, first_check_date, deal_date, package, source)
-- select v.deal_id, v.client_id, v.amount, v.retainer, v.method, v.checks_count, v.first_check_date, v.deal_date, v.package, 'old_crm'
-- from (values
--   ('435', '9f218e6f-99df-535d-a74e-b61aa2d49e54'::uuid, 55224, 8000, 'transfer', null, null::date, '2026-05-28'::date, null) /* חנות נרגילות => קליאופטרה רעננה (אותו איש קשר) */,
--   ('12173', '4495f940-b323-4323-806f-58cdbf343eac'::uuid, 49560, 3500, null, null, null::date, '2026-10-25'::date, 'ALL IN ONE') /* רוזיטה מדיקל => רוזיטה קליניק (אותו איש קשר) */,
--   ('415', '34552326-127d-59fd-a159-7bef015e0630'::uuid, 28320, 2000, 'payment', null, null::date, '2026-01-20'::date, 'חבילה 2,000') /* מאמן מנטלי => ליאת לב - מאמנת מנטלית ויועצת זוגית */,
--   ('430', '17a38e17-577c-5e1b-b8b9-845abb9840c9'::uuid, 55224, 3900, 'checks', 6, null::date, '2026-05-06'::date, null) /* עוז דנטל => עוז דנטל מרפאת שיניים */,
--   ('439', '8db19be5-4767-53a8-be5f-7b1b50c82c17'::uuid, 55224, 3900, 'payment', null, null::date, '2026-06-14'::date, null) /* שווארמה שפע => שפע שווארמה */,
--   ('441', 'a855adcc-b9c4-5037-9ed7-fa97d86964ac'::uuid, 55224, 3900, 'payment', null, null::date, '2026-06-15'::date, null) /* קליניקה אנה => קליניקת אנה חריש */,
--   ('457', '935706c0-b26b-594f-947a-8f72d0829c50'::uuid, 52392, 4366, 'payment', null, null::date, '2026-08-10'::date, 'נטלי דדון ') /* קליניקה יופי אשדוד אמפייר => אמפייר האקדמיה למקצועות היופי */,
--   ('461', 'dcc3541c-251a-5f06-b121-23ff7dc534d9'::uuid, 69384, 5782, 'payment', null, null::date, '2026-07-15'::date, null) /* מטאפיזיקיה קונדטוריה => מאפיה וקונדטוריה רמו */
-- ) as v (deal_id, client_id, amount, retainer, method, checks_count, first_check_date, deal_date, package)
-- where exists (select 1 from public.clients c where c.id = v.client_id)
-- on conflict (old_crm_deal_id) do nothing;

select count(*) filter (where source = 'old_crm') as from_old_crm, count(distinct client_id) filter (where source = 'old_crm') as clients
from public.client_payments;
commit;
