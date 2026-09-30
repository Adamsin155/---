# תפעול: פריסה, סודות, מיגרציות, גיבויים וכתובת קבועה

*מסמך קצר למי שמפעיל את המערכת. פרויקט ה־Supabase: `astrateg-quotes` (‏`czncjzziqrqtezpwxxpz`). הרקע: [התוכנית, שלב 0 ונספח ב](plan/system-plan.md), [החלטה 5](plan/decisions.md).*

## 1. פונקציות Edge

`create-quote` (עם `verify_jwt=true`) מתוארת כאן. `staff-admin` ו־`reminders` רצות עם `verify_jwt=false` ובודקות את הקורא בקוד; `reminders` מתוארת בסעיף 10. היא מחשבת את המחיר מחדש בשרת עם אותו מנוע תמחור שהדפדפן משתמש בו.

**הקבצים שנפרסים יחד:**

| קובץ | מה זה |
|---|---|
| `supabase/functions/create-quote/index.ts` | הפונקציה |
| `supabase/functions/_shared/app/pricing.js` | עותק של `app/pricing.js` |
| `supabase/functions/_shared/app/catalog.js` | עותק של `app/catalog.js` |
| `supabase/functions/_shared/app/legal.js` | עותק של `app/legal.js` |

- העותקים ב־`_shared/app/` נוצרים בסקריפט, והפונקציה מייבאת רק אותם (`../_shared/app/pricing.js`). כך היא לא תלויה במאגר ציבורי.
- **לא עורכים אותם ביד.** עורכים את `app/` ומריצים `node scripts/sync-functions.mjs`. הסקריפט עוקב אחרי כל ה־import היחסיים, ולכן קובץ חדש ש־`pricing.js` מייבא מתווסף לבד.
- `node scripts/sync-functions.mjs --check` נכשל אם עותק חסר, ישן או מיותר. ה־CI מריץ אותו בכל דחיפה, וגם `npm test` בודק את זה (`tests/sync-functions.test.mjs`).
- פונקציה חדשה שצריכה מודול מ־`app/`, למשל מנוע הפרוטוקול לתזכורות: מוסיפים אותו ל־`ENTRIES` בסקריפט, מריצים, ומייבאים מ־`../_shared/app/…`.

**פריסה:**

1. `node scripts/sync-functions.mjs --check` ו־`npm test`. שניהם צריכים לעבור.
2. אחת משתי הדרכים:
   - **Supabase CLI**, מתיקיית השורש של המאגר:
     ```bash
     supabase functions deploy create-quote --project-ref czncjzziqrqtezpwxxpz --use-api
     ```
     ה־CLI עוקב אחרי ה־import ומעלה את `_shared` יחד עם הפונקציה. `verify_jwt` נשאר `true` כברירת מחדל. אם ה־CLI דורש `supabase/config.toml`, מריצים פעם אחת `supabase init` ובודקים את הקובץ לפני שמוסיפים אותו למאגר.
   - **MCP ‏`deploy_edge_function`** (או ה־Management API): מעלים את ארבעת הקבצים שבטבלה, כל אחד בשם היחסי ל־`supabase/functions/`: ‏`create-quote/index.ts`, ‏`_shared/app/pricing.js`, ‏`_shared/app/catalog.js` ו־`_shared/app/legal.js`. ‏`entrypoint_path` הוא `create-quote/index.ts`, ו־`verify_jwt` הוא `true`. התוכן זהה לקבצים במאגר, כולל שורת הכותרת. עוד לא ניסינו את הדרך הזו בפרויקט. אם היא נכשלת עם השמות האלה, פורסים ב־CLI.
3. בדיקה אחרי הפריסה:
   - ב־`get_edge_function` או בלוח הבקרה מופיעים ארבעת הקבצים, ובקוד אין `raw.githubusercontent`.
   - יוצרים הצעה מהמחולל (`index.html`, כפתור הקישור ללקוח) ומקבלים קישור. אחר כך מבטלים אותה ב״הצעות שנשלחו״.
   - אם משהו נכשל: Edge Functions → create-quote → Logs.

*עד השינוי הזה, גרסה 6 נפרסה עם import מ־`raw.githubusercontent.com` בקומיט `e75a713`. הכתובת הזו תחזיר 404 כשהמאגר ייסגר, ולכן חייבים לפרוס מחדש בשיטה החדשה **לפני** שסוגרים אותו.*

## 2. פרסום האתר (GitHub Pages)

האתר מוגש מהענף `gh-pages`. **כל קובץ בענף הזה ציבורי** לכל מי שמגיע לנתיב שלו, גם כשהמאגר פרטי. לכן מפרסמים רק את קבצי האתר:

- **מתפרסם:** דפי ה־HTML שבשורש (`index.html`, ‏`q.html`, ‏`quotes.html`, ‏`client.html`, ‏`clients.html`), ‏`clients.webmanifest`, התיקיות `app/` ו־`payouts/`, ‏`.nojekyll`, ו־`CNAME` כשהוא קיים.
- **לא מתפרסם:** `docs/`, ‏`supabase/`, ‏`tests/`, ‏`scripts/`, ‏`.claude/`, ‏`.github/`, ‏`README.md` ו־`package*.json`. הרשימה נקבעת ב־`scripts/build-pages.mjs`.
- `app/` ציבורי מעצם טבעו, כי הדפדפן מריץ אותו. זה כולל את `pricing.js`, ‏`catalog.js` ו־`legal.js`. לכן לא שמים ב־`app/` שום דבר שאסור שיראו.

**איך מפרסמים:** עומדים על הענף שרוצים לפרסם. מתפרסם רק מה שנשמר ב־commit.

```bash
git fetch origin gh-pages
node scripts/build-pages.mjs --commit
```

- הסקריפט יוצר commit שיש בו רק את קבצי האתר, מעל `origin/gh-pages`. הוא מדפיס את פקודת הדחיפה, `git push origin <sha>:refs/heads/gh-pages`, ולא דוחף בעצמו. אם הדחיפה נדחית, מריצים שוב את שתי הפקודות.
- **לא** מפרסמים יותר ב־`git push origin <ענף>:gh-pages`. הפקודה הזו מפרסמת את כל המאגר.
- תצוגה מקדימה: `node scripts/build-pages.mjs /tmp/pages`, ומגישים את התיקייה. ה־CI מריץ את בדיקות הדפדפן מול תיקייה כזו, כך שקובץ שהאתר צריך ולא מתפרסם נתפס שם.
- דף HTML חדש בשורש מתפרסם לבד. תיקייה חדשה שהאתר טוען מוסיפים ל־`DIRS` בסקריפט. `tests/build-pages.test.mjs` נכשל אם דף מפנה לקובץ שלא מתפרסם.
- בדיקה אחרי הפרסום: האתר עובד, ו־`https://adamsin155.github.io/---/docs/ops.md` מחזיר 404.
- הפרסומים הקודמים, עם כל המאגר, נשארים בהיסטוריה של `gh-pages`. ‏Pages מגיש רק את ה־commit האחרון, וכשהמאגר פרטי גם ההיסטוריה פרטית.

## 3. סודות ומשתני סביבה (שמות בלבד)

`create-quote` קוראת:

| משתנה | בשביל מה |
|---|---|
| `SUPABASE_URL` | כתובת הפרויקט |
| `SUPABASE_ANON_KEY` (מפתח ישן, JWT) | לקוח Supabase בשם המשתמש שקרא: `auth.getUser()` ו־`rpc('is_staff')` |
| `SUPABASE_SERVICE_ROLE_KEY` (מפתח ישן, JWT) | שמירת ההצעה בטבלה `quotes`, עוקף RLS |
| הכותרת `Authorization` של הבקשה | ה־JWT של איש הצוות המחובר |

- את כל המשתנים האלה Supabase מזריקה לבד. אין סודות שהגדרנו ביד. אם יתווספו (למשל ספק מייל), מגדירים אותם ב־Edge Functions → Secrets או ב־`supabase secrets set`, ולעולם לא בקובץ במאגר.
- המפתחות החדשים זמינים לפונקציות כ־`SUPABASE_PUBLISHABLE_KEYS` ו־`SUPABASE_SECRET_KEYS`: אובייקט JSON, והמפתח הראשי נמצא תחת `default`.
- בדפדפן: `app/supa.js` מחזיק את כתובת הפרויקט ואת המפתח הציבורי `sb_publishable_…`. הוא ציבורי מעצם הגדרתו. ההגנה היא RLS.
- מחוץ למאגר: טוקן הגישה של ה־CLI (`SUPABASE_ACCESS_TOKEN`) וסיסמת מסד הנתונים. הם אישיים ונשמרים רק בלוח הבקרה ובמחשב של מי שפורס.

## 4. מעבר למפתחות החדשים: עד 31.12.2026

לפי Supabase, המפתחות הישנים `anon` ו־`service_role`, שמבוססים על JWT, עובדים עד סוף 2026. האתר כבר משתמש ב־`sb_publishable_`, ורק `create-quote` עוד תלויה במפתחות הישנים. היעד שלנו הוא להשלים את המעבר עד 1.12.2026, כדי להשאיר מרווח.

1. Settings → API Keys: מוודאים שיש מפתח publishable ומפתח secret בשם `default`.
2. ב־`create-quote`:
   - במקום `SUPABASE_ANON_KEY` קוראים `JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!).default`.
   - במקום `SUPABASE_SERVICE_ROLE_KEY` קוראים `JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!).default`.
   - ה־JWT של המשתמש ממשיך לעבור בכותרת `Authorization`, כמו היום.
3. `verify_jwt` המובנה מבין רק JWT. אם עוברים גם למפתחות חתימה חדשים (JWT signing keys), או שפונקציה נקראת עם מפתח `sb_secret_`, מגדירים לה `verify_jwt=false` ובודקים בקוד. `create-quote` כבר בודקת בעצמה (`getUser` מחזיר 401, ו־`is_staff` מחזיר 403).
4. קריאות מ־`pg_net` ומהתזמון לפונקציות: שולחים את מפתח ה־secret בכותרת `apikey`, לא ב־`Authorization`. את המפתח שומרים ב־Vault, לא בטקסט של ה־SQL.
5. כשכלום כבר לא משתמש במפתחות הישנים, מכבים אותם ב־Settings → API Keys. אפשר להדליק אותם שוב אם משהו נשבר.

## 5. מיגרציות

- כל שינוי במסד הוא קובץ חדש: `supabase/migrations/<YYYYMMDDHHMMSS>_<שם>.sql`, עם חותמת זמן מאוחרת מהקובץ האחרון. **לא עורכים מיגרציה שכבר הוחלה**; מתקנים בקובץ חדש.
- מי שמחזיק את הגישה ל־Supabase מחיל אותן, לפי הסדר:
  - בודקים מה כבר הוחל: `list_migrations` ב־MCP, או Database → Migrations.
  - מחילים כל קובץ חסר עם `apply_migration` ב־MCP. השם הוא שם הקובץ בלי החותמת ובלי `.sql`, למשל `drop_set_my_person`.
  - אחרי זה מריצים `get_advisors` (אבטחה) ואת הבדיקות.
- ההיסטוריה במסד נשמרת לפי שעת ההחלה, ולא לפי החותמת שבשם הקובץ. לכן לא משתמשים ב־`supabase db push` בלי ליישר קודם את ההיסטוריה (`supabase migration repair`), כי אחרת הוא ינסה להריץ הכול מחדש.
- `npm test` מריץ את כל המיגרציות, לפי הסדר, על Postgres אמיתי שרץ בתוך Node ‏(PGlite, ‏`tests/sql/`). מיגרציה שלא נטענת מכשילה את הבדיקות עם שם הקובץ. מה ש־Supabase מספקת והבדיקות צריכות (התפקידים `anon`/`authenticated`, ‏`auth.jwt()`, ‏Vault, ‏cron ו־net) נמצא בגרסה מינימלית ב־`tests/sql/supabase-stub.sql`. אם מיגרציה חדשה צריכה משהו שחסר שם, מוסיפים אותו לשם (או ל־`SKIP` ב־`tests/sql/pg.mjs`), עם שורה שמסבירה למה.

## 6. גיבויים

- הפרויקט על **Supabase Pro** (שודרג ב־29.9.2026, החלטה 4). יש גיבוי אוטומטי יומי, ו־7 הימים האחרונים זמינים ב־Database → Backups → Scheduled backups.
- שחזור מחזיר את **כל** המסד לנקודת הגיבוי, והפרויקט לא זמין בזמן השחזור. PITR (שחזור לרגע מסוים) הוא תוסף בתשלום, והוא לא מופעל.
- הגיבוי כולל את כספת הגישות (`vault.secrets`), מוצפנת. הוא לא כולל קבצים ב־Storage, שבה אנחנו לא משתמשים כרגע.
- מומלץ, לפי התוכנית: פעם בשבוע `supabase db dump` מוצפן, שנשמר **מחוץ** למאגר. עדיין לא הוקם.

## 7. לפני שהופכים את המאגר לפרטי

- [ ] `create-quote` נפרסה מחדש מ־`_shared` (גרסה 7 ומעלה), ובקוד שבשרת אין `raw.githubusercontent` (סעיף 1).
- [ ] לחשבון GitHub ‏`Adamsin155` יש **GitHub Pro** (כ־$4 לחודש). בחשבון חינמי, מאגר פרטי מכבה את GitHub Pages. ב־Pro האתר ממשיך לעבוד **והוא ציבורי**: Pages מגיש לכל אחד כל קובץ שבענף `gh-pages`. המאגר הפרטי מסתיר רק את מה שלא פורסם שם.
- [ ] ב־`gh-pages` יש רק קבצי האתר: פרסמו לפחות פעם אחת ב־`node scripts/build-pages.mjs --commit` (סעיף 2), ו־`https://adamsin155.github.io/---/docs/ops.md` מחזיר 404. עד היום נדחף לשם כל המאגר, ובלי הצעד הזה התוכנית, המיגרציות והקוד של הפונקציות יישארו ציבוריים דרך האתר גם אחרי הסגירה. `app/` נשאר ציבורי בכל מקרה (סעיף 2).
- [ ] הכתובת הקבועה עובדת (סעיף 8). עדיף לעשות את זה קודם, כדי לא לשנות שני דברים באותו יום.
- [ ] ב־Supabase, ב־Authentication → URL Configuration: ‏Site URL ו־Redirect URLs כוללים את הכתובת שבשימוש, אחרת קישור איפוס הסיסמה לא יחזור לאתר.
- [ ] מי שצריך גישה לקוד (מפתחים, סוכני Claude דרך אפליקציית GitHub) נוסף כ־collaborator. אחרי הסגירה אי אפשר יותר לקרוא את הקוד בלי הרשאה.
- [ ] דקות של GitHub Actions: במאגר פרטי הן נספרות (ב־Pro יש 3,000 בחודש). הבדיקות בכל דחיפה לוקחות כמה דקות, וזה מספיק.
- [ ] לזכור שהסגירה לא מוחקת את מה שכבר היה ציבורי. היסטוריית ה־git כבר נחשפה. אין בה סודות, רק המפתח הציבורי, ואם יתברר שנכנס סוד, מחליפים אותו.
- [ ] האתר הנפרד `astrateg-payment` (נבנה ב־`scripts/build-payment-site.mjs`) הוא מאגר ציבורי עם עותק של `app/payouts/` ו־`pricing.js`/`catalog.js`/`legal.js`. צריך להחליט אם גם אותו לסגור, או להפסיק לעדכן אותו ולהשתמש ב־`/payouts/` שבכתובת החדשה.

## 8. כתובת קבועה: `app.astrateg.com`

לפי החלטה 5 נשארים על GitHub Pages, רק עם כתובת משלנו.

1. **DNS**, אצל רשם הדומיין: רשומת `CNAME` בשם `app` שמצביעה על `adamsin155.github.io` (בלי שם המאגר ובלי נתיב).
2. **אימות הדומיין ב־GitHub** (מומלץ, מונע השתלטות): ב־Settings של החשבון → Pages → Add a domain ‏`astrateg.com`. מוסיפים את רשומת ה־TXT שהמסך מציג, ולוחצים Verify.
3. **קובץ `CNAME`** בשורש המאגר, עם שורה אחת: `app.astrateg.com`, ב־commit בענף שמפרסמים ממנו. ‏`scripts/build-pages.mjs` מצרף אותו לקבצים שמתפרסמים (סעיף 2). כל פרסום מחליף את כל התוכן של `gh-pages`, ולכן בלי הקובץ במקור הכתובת תימחק בפרסום הבא.
4. ב־Settings של המאגר → Pages → Custom domain: ‏`app.astrateg.com` → Save. כשהתעודה מוכנה (בדרך כלל תוך שעה), מסמנים **Enforce HTTPS**. ‏GitHub שומר את הדומיין גם כ־commit משלו ב־`gh-pages`, ולכן לפני הפרסום הבא מריצים `git fetch origin gh-pages` (כמו בסעיף 2).
5. **נתיבים**: האתר עובר מ־`/---/` לשורש `/`. מעדכנים את `id`, ‏`start_url` ו־`scope` ב־`clients.webmanifest` וב־`payouts/manifest.webmanifest` מ־`/---/…` ל־`/…`, ואת הכתובות ב־`README.md`.
6. **Supabase Auth** → URL Configuration:
   - Site URL: ‏`https://app.astrateg.com/`
   - Redirect URLs: מוסיפים `https://app.astrateg.com/quotes.html` ו־`https://app.astrateg.com/payouts/`
   - את הכתובות הישנות של `adamsin155.github.io` משאירים עד שכולם עברו.
7. **בדיקה:**
   - קישור הצעה ישן (`https://adamsin155.github.io/---/q.html?t=…`) נפתח. GitHub מפנה אוטומטית מהכתובת הישנה לדומיין, וצריך לוודא שהפרמטר `t` נשמר.
   - `/payouts/` נפתח.
   - איפוס סיסמה חוזר לאתר.
8. **מה משתנה לצוות:**
   - הכניסה השמורה, האפליקציה המותקנת במסך הבית וההתראות קשורות לכתובת. כולם יתחברו מחדש, ומי שהתקין יתקין מחדש.
   - לכן מחליפים כתובת **לפני** שמפיצים לצוות את התקנת האפליקציה.

## 9. הרשאות: מי רואה מה

מה כל אחד רשאי לקרוא ולשנות נקבע במסד הנתונים (RLS), לא רק במה שהמסך מציג. כך זה גם בכספת הגישות. המיגרציה: `20260930130000_assignment_rls.sql`.

| מי | לקוחות, סימונים, היסטוריה ומשימות | כספת הגישות | סיכומי המצב של אופיר והבקרות היומיות |
|---|---|---|---|
| המשרד: הבעלים, עירית, ליאור, אופיר ועילאי | כל הלקוחות | כל הלקוחות, למי שמסומנת לו "כספת" בעמוד הצוות | כן |
| עורך (נדיה, יריב, אנה) | לקוחות שהעריכה שלהם אצלו, גם בסבב צילום נוסף, ולקוחות שיש לו בהם משימה פתוחה או שנסגרה ב־30 הימים האחרונים | לא (אין להם "כספת") | לא |
| ניראל | כמו עורך, ובנוסף כל לקוחות נטלי | רק לקוחות שהיא עורכת, או שמישהו אחר פתח לה בהם משימה (פתוחה או שנסגרה ב־30 הימים האחרונים). לא כל לקוחות נטלי, ולא לקוח שהיא פתחה בו משימה לעצמה | לא |
| אלי | לקוחות עם יום צילום (הראשי או של סבב) מלפני 7 ימים ועד 30 יום קדימה, לפי ימים בישראל, ולקוחות עם משימה שלו | לא | לא |

- **כתיבה:** מסמנים פריטים ופותחים משימות רק בלקוח שרואים. באותו לקוח מותר לפתוח משימה גם למישהו אחר, למשל חריגה לליאור או עצירת עריכה. את פרטי הלקוח עצמם (שם, מועדים, העורך המשויך, סבבים וכמויות) מוסיף ומשנה רק המשרד.
- **משימה נשארת אצל מי שהיא שלו:** רק המשרד מעביר משימה לאדם אחר או ללקוח אחר, ורק המשרד פותח מחדש משימה שנסגרה לפני יותר מ־30 יום. ביטול "בוצע" מיד אחרי הסימון עובד לכולם. כך אי אפשר להשתלט על משימה של מישהו אחר כדי להגיע ללקוח או לכספת שלו.
- **מסכי הבעלים** (`20260930120000_owner_screens.sql`): היסטוריית שינויי התאריכים (`client_date_changes`) מוצגת לפי אותו כלל של הלקוחות. השאלות לאחראי (`client_questions`) נשארות בכלל שלהן: המשרד שואל וקורא, ומי שנשאל קורא ועונה על שלו, גם על לקוח שכבר אינו שלו.
- **כשהעבודה עוברת:** כשאופיר מעביר עריכה לעורך אחר, העורך הקודם מפסיק לראות את הלקוח, אלא אם יש לו שם משימה. סימון שהוא מנסה לשמור בכרטיס שעדיין פתוח אצלו נדחה עם הסבר. מי שפותח קישור ללקוח שאינו שלו מקבל "אין לך גישה ללקוח הזה" וקישור ל"מה עליי".
- **לא השתנה:** טבלת הצעות המחיר פתוחה לקריאה לכל איש צוות, ואפליקציית התשלומים רק לבעלי התשלומים. מי שיש לו גישה ל־SQL Editor או למפתח ה־service role עוקף את כל ההרשאות האלה (נספח ב בתוכנית), ולכן הגישה ללוח הניהול מוגבלת.
- **איפה הכללים:** `public.can_see_client(id)` ו־`public.can_use_client_vault(id)` ללקוח אחד (כמה חיפושים באינדקס, אפשר לקרוא להן לכל שורה), `public.is_office()` ו־`public.my_person()`. המדיניות על הטבלאות משתמשת באותו כלל בצורת קבוצה, `private.my_clients()` ו־`private.my_assigned_clients()`, שמחושבות פעם אחת לכל שאילתה. לא קוראים לצורת הקבוצה פעם לכל שורה. חלון הימים של אלי נמצא במקום אחד, `private.shoot_in_window()`. שינוי בכלל הוא מיגרציה חדשה שמגדירה מחדש את שתי הצורות, והבדיקה מוודאת שהן מסכימות.
- **סדר ההחלה:** קודם `20260930120000_owner_screens.sql` (מסכי הבעלים), ואחריה `20260930130000_assignment_rls.sql`. אם ההרשאות הוחלו קודם, מריצים את הקובץ שלהן שוב ב־SQL Editor אחרי מסכי הבעלים. הוא בטוח להרצה חוזרת, ובריצה הזו הוא מצמצם גם את `client_date_changes`.
- **בדיקות:** `tests/sql/rls.test.mjs` (בתוך `npm test`) טוען את כל המיגרציות ל־Postgres אמיתי, ובודק מה כל אחד קורא וכותב: הבעלים, עירית, ליאור, אופיר, עילאי, נדיה עם שיוך (גם בסבב) ובלי שיוך, אנה בלי כלום, ניראל בלקוח של נטלי, בבריף ובמשימה שפתחה לעצמה, ואלי עם צילום בקצוות החלון לפי ימים בישראל. `tests/rls-e2e.mjs` בודק שהמסכים מסתדרים כשהמסד מחזיר רק חלק מהשורות.
- **בדיקה אחרי ההחלה**, ב־SQL Editor. ממלאים את המייל ואת ה־id של משתמש מ־Authentication → Users, וכלום לא נשמר:
  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub": "<user id>", "email": "<email>", "role": "authenticated"}', true);
  select public.my_person(), public.is_office(), count(*) from public.clients;
  rollback;
  ```
  עורך מקבל רק את מספר הלקוחות שלו, ואיש משרד את כולם.

## 10. מנוע התזכורות

*שלב 3 ([התוכנית, עיקרון 4 וסעיף 5](plan/system-plan.md), החלטות 7–24). הכללים עצמם הם נתונים ב־`app/reminder-rules.js`; ההרצה ב־`app/reminder-engine.js`.*

**איך זה עובד:** בכל דקה `pg_cron` מריץ את `public.reminders_tick()`, שקוראת לפונקציה `reminders` עם סוד מה־Vault. הפונקציה טוענת את הלקוחות, הסימונים והמשימות (במפתח השירות), מחשבת בשעון ישראל אילו שלבים בסולמות הגיעו, ורושמת כל שלב ב־`public.reminder_log` עם מפתח ייחודי. לכן כל שלב יוצא פעם אחת, גם כששתי הרצות חופפות. אחר כך היא שולחת Web Push לטלפונים שב־`public.push_subscriptions`.

- **רמות:** צלצול (פוש), שקט (רק ב"התראות" במערכת), שורה בתקציר, ולוח הבעלים.
- **שעות שליחה:** א׳–ה׳ 08:30–19:00, לא בחגים. מה שמגיע מחוץ להן ממתין לתקציר הבא. אירועי יום צילום (התדריך ב־17:00, הבדיקה ב־20:00, שעוני ההגעה) יוצאים בכל מקרה.
- **תקרה:** עד 6 צלצולים ביום לאדם, לא כולל שעוני פרוטוקול, יום צילום ודחוף. מה שמעבר נכנס לתקציר הבא.
- **תקצירים:** 08:30 לכל אחד (עד 5 שורות, קודם מה שבאיחור, וגם מה שמתוזמן ל־09:00–09:30). ליאור גם ב־12:00 וב־16:00. הבעלים ב־18:00 (בחמישי עם הדוח השבועי), וביום העסקים הראשון בשבוע ב־08:30 "השבוע הקרוב".
- **יום צילום של ליאור (החלטה 8):** החריגות שלו עוברות לאופיר, ושאר ההודעות שלו מחכות לסיכום אחד אחרי היום.
- **עצירה:** "בוצע", "אני על זה", "ממתין ללקוח", עצירת עריכה ו"לדחות עד…" עוצרים את הסולם. שלב שהיה צריך לצאת לפני יותר מכמה שעות (למשל בהפעלה הראשונה) נרשם כ־`stale` ולא נשלח באיחור.

**מה נפרס** (הפונקציה `reminders`, ‏`verify_jwt=false`, כי היא בודקת בעצמה את סוד ה־cron ואת המשתמש):

| קובץ | מה זה |
|---|---|
| `supabase/functions/reminders/index.ts` | הפונקציה: `tick` מה־cron, `test` מהטלפון |
| `supabase/functions/reminders/tick.js` | הרצה אחת: שלבים, יומן, תקצירים ושליחה |
| `supabase/functions/reminders/webpush.js` | הצפנת Web Push וחתימת VAPID (WebCrypto בלבד) |
| `supabase/functions/reminders/http.js` | CORS וכותרות |
| `supabase/functions/_shared/app/reminder-engine.js`, `reminder-rules.js`, `office-marks.js`, `protocol-logic.js`, `protocol.js`, `clocks.js`, `tz.js`, `holidays.js`, `catalog.js`, `push-config.js` | עותקים של `app/` (סעיף 1). לא עורכים ביד |

**הפעלה, לפי הסדר:**

1. מיגרציות: `20260930110000_reminders.sql` ו־`20260930110001_task_started.sql`.
2. שלושה סודות ב־Vault (ב־SQL Editor, לא בקובץ ולא בצ'אט ציבורי):
   ```sql
   select vault.create_secret('<סוד ה-cron>', 'reminders_cron_secret', 'reminders: pg_cron → function');
   select vault.create_secret('<המפתח הפרטי של VAPID>', 'vapid_private_key', 'reminders: Web Push signing key');
   select vault.create_secret('mailto:<כתובת של המשרד>', 'vapid_subject', 'reminders: VAPID contact');
   ```
   - סוד ה־cron: מחרוזת אקראית של 32 תווים לפחות (למשל `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`).
   - המפתח הפרטי של VAPID: ה־base64url של המפתח הפרטי (32 בתים) שתואם למפתח הציבורי ב־`app/push-config.js`. לא נכנס למאגר.
   - החלפה: `select vault.update_secret(id, '<ערך חדש>') from vault.secrets where name = '<שם>';`
3. פריסת הפונקציה עם כל הקבצים שבטבלה: `supabase functions deploy reminders --project-ref czncjzziqrqtezpwxxpz --use-api` (ההגדרה `verify_jwt = false` נמצאת ב־`supabase/config.toml`), או `deploy_edge_function` ב־MCP עם `entrypoint_path` ‏`reminders/index.ts` ו־`verify_jwt: false`.
4. מיגרציה `20260930110002_reminders_cron.sql`: מפעילה את `pg_cron` ומתזמנת את `reminders-tick` כל דקה (ואת ניקוי ההיסטוריה של ה־cron פעם ביום). בלי סוד ב־Vault ההרצה לא קוראת לשום דבר, כך שהסדר לא מסוכן.
5. פרסום האתר (סעיף 2). `sw.js` בשורש הוא ה־service worker של האתר, והוא מתפרסם עם הדפים.

**תזמון ועצירה:**
```sql
select jobname, schedule, active from cron.job;                        -- מה מתוזמן
select cron.unschedule('reminders-tick');                              -- עצירה
select cron.schedule('reminders-tick', '* * * * *', 'select public.reminders_tick()');  -- הפעלה מחדש
```

**בדיקה:**
- הרצה ידנית: `select public.reminders_tick();`, ואחרי כמה שניות:
  ```sql
  select id, status_code, content from net._http_response order by id desc limit 3;   -- 200 עם מספרים, או 202 busy
  select * from public.reminder_runs order by id desc limit 5;                         -- ok, stats, error
  ```
  ‏401 = הסוד ב־Vault לא תואם; 500 עם `vapid_missing` ב־`reminder_runs.error` = חסר מפתח VAPID או subject.
- בטלפון: "מה עליי" ← "הפעלת התראות" ← מגיעה התראת ניסיון ← "קיבלתי". באייפון קודם "הוספה למסך הבית" (iOS 16.4 ומעלה), ופותחים מהמסך הבית.
- בעמוד הצוות רואים לכל אחד כמה מכשירים מחוברים ומתי התקבלה התראה לאחרונה.

**קריאת היומן:**
```sql
-- מה יצא היום, למי ואיך
select created_at at time zone 'Asia/Jerusalem' as at, person, level, channel, status, reason, title
from public.reminder_log where created_at > now() - interval '1 day' order by id desc;
-- צלצולים לאדם ביום (מול היעדים שבסעיף 5 בתוכנית)
select person, (created_at at time zone 'Asia/Jerusalem')::date as day, count(*)
from public.reminder_log where level = 'ring' and channel = 'push' and status = 'sent' and not exempt group by 1, 2 order by 2 desc, 1;
-- תקלות שליחה ומכשירים בעייתיים
select created_at, person, title, reason from public.reminder_log where status = 'failed' order by id desc limit 20;
select email, fail_count, last_error, last_ok_at from public.push_subscriptions where fail_count > 0;
```
- מכשיר שה־push service מחזיר עליו 404 או 410 נמחק לבד. כל תקלה אחרת נרשמת בשורה (`failed`) ובמכשיר (`fail_count`, ‏`last_error`).
- `reminder_runs` נשמר 14 יום, `cron.job_run_details` שבוע.

**אבטחה:**
- המפתח הפרטי של VAPID וסוד ה־cron נמצאים רק ב־Vault. רק פונקציות של `service_role` קוראות אותם (`reminders_vapid`, ‏`reminders_check_secret`), וסוד ה־cron נבדק בתוך מסד הנתונים.
- כל אחד רואה ומוחק רק את המכשירים שלו, ומכשיר עובר למי שחיבר אותו אחרון. את היומן כל אחד קורא רק לעצמו; הבעלים וליאור רואים את כולו (החלטה 22).
- מי שיש לו גישה ל־SQL Editor או למפתח השירות יכול לקרוא את ה־Vault, כמו בכספת הגישות (סעיף 3).
- החלפת זוג המפתחות של VAPID מנתקת את כל הטלפונים: כל אחד מחבר מחדש מהכרטיס ב"מה עליי".

## 11. זרימות המשרד: אופיר, ליאור ועילאי

*שלב 3, חלק 2 ([התוכנית, סעיף 3](plan/system-plan.md)). המסכים: `qa.html` (אופיר: תור בקרת איכות, אפיונים של היום, שיוך עורכים), `pass.html` (אופיר: המעבר על הלקוחות, תקינות נתונים, סיכום חמישי, "אין מי שייצא לאפיון", בקשת שינוי) ו־`decisions.html` (ליאור: "החלטות"). עילאי מקבל את "יום אפיון: שעתיים" בראש "מה עליי". אופיר וליאור נוחתים על המסך הראשון שלהם כשהלשונית נפתחת על `clients.html`.*

- **האירועים הם סימונים** ב־`protocol_checks`, עם מפתחות קבועים (`app/office-marks.js`): החזרה לתיקון ותיקוניה (`p25.return.N`, `p25.fixed.N`, `p23.…`), סיבת השיוך (`p22a.reason`), הזזת מועדי עריכה (`p22a.shift`), החלטה על עריכה עצורה (`p22.decision`) וסגירת גישה שבורה (`p06.fixed.<רשת>`). מנוע התזכורות קורא אותם בלי טבלה חדשה, ולכן אחרי המיזוג פורסים מחדש את הפונקציה `reminders` (סעיף 10; `office-marks.js` נוסף לעותקים).
- **המיגרציה** `20260930150000_office_flows.sql` (אחרי `20260930130000_assignment_rls.sql`): הטבלאות `office_passes`, `task_decisions` ו־`change_requests` עם RLS (‏`is_office()` ו־`can_see_client()`), סוג הבקרה `campaigns` ב־`office_reviews`, מקום לרשימת בעיות בהערה של סימון (עד 8000 תווים), והפונקציה `ofir_meetings()` שמחזירה לעורך רק את שעות האפיונים של אופיר ("אופיר באפיון, בקרה עד…"). בטוחה להרצה חוזרת. עד שהיא מוחלת המסכים עובדים בלי השמירה של המעבר, ההחלטות ובקשות השינוי, ואומרים את זה.
- **בדיקות:** `tests/office-flows.test.mjs`, `tests/sql/office-flows.test.mjs` (בתוך `npm test`) ו־`tests/office-flows-e2e.mjs`.
