# astrateg · מחולל הצעות מחיר

מערכת לבניית הצעות מחיר לאנשי מכירות: בחירת חבילה ומשפיענים, תוספות בתשלום וללא עלות, חישוב מחיר אוטומטי, תצוגה מקדימה, הדפסה והורדה, ו**קישור ללקוח שבו הוא צופה בהצעה וחותם עליה**.

## עמודים

| עמוד | למי | מה עושים בו |
|---|---|---|
| `index.html` | איש מכירות | בוחרים **הצעת מחיר** (לעיון, ללא חתימה) או **הסכם התקשרות** (עם תנאים משפטיים וחתימה), בונים, ומפיקים תצוגה מקדימה, הדפסה, קובץ HTML או קישור ללקוח |
| `q.html?t=…` | הלקוח | צופה בהצעה, מקליד שם, חותם ומאשר |
| `quotes.html` | צוות | רשימת ההצעות שנשלחו, סטטוס (ממתין, נצפה, נחתם, בוטל), העתקת קישור וביטול |
| `clients.html` | צוות | **פרוטוקול עבודה:** ״מה עליי״ (הפריטים הפתוחים של כל עובד בכל הלקוחות), רשימת לקוחות עם שלב והתקדמות, ובקרה יומית (תהליכים 32–33). פתיחת לקוח חדש, גם מהסכם חתום |
| `client.html?id=…` | צוות | כרטיס לקוח: הפרוטוקול לפי שלבים, סימון וי לפי תפקיד (מי ומתי), ״לא רלוונטי״, מועדי יעד מחושבים, משימות והיסטוריה |
| `team.html` | הבעלים, עירית וליאור | **צוות וכניסות:** מי מחובר ומי עוד לא, הוספת כתובת מייל, גישה לכספת (הבעלים), ו**קישור כניסה אישי** לשליחה בוואטסאפ, לכניסה ראשונה או לסיסמה שנשכחה, בלי מייל. הקישור פותח את `clients.html` ומבקש לבחור סיסמה. גם **מספר הוואטסאפ** של כל אחד (נייד ישראלי בלבד), שכפתורי ההעברה פותחים איתו שיחה. הפונקציה: `supabase/functions/staff-admin` |

**פרוטוקול העבודה:** [איך זה בנוי ואיך מוסיפים פרוטוקול](docs/protocols/README.md).

**למפתח שמשלב את המערכת במערכת אחרת:** [מסמך מסירה](docs/HANDOFF.md).

## אסטרטג פיימנט — מערכת התשלומים החודשית

`payouts/` — אפליקציה לבעלים בלבד (אפשר להוסיף אותה למסך הבית בטלפון). מזינים עסקאות שנסגרו, הכנסה נוספת והוצאות חד־פעמיות, והמערכת מחשבת לכל חודש קלנדרי עמלות, תשלומים למשפיענים ולספקים, משכורות, הוצאות קבועות וחלוקת רווח לשותפים. לכל מקבל עמלה יש דוח להצגה שמראה רק את הניכויים לחישוב העמלה.

- **כתובת:** https://adamsin155.github.io/---/payouts/
- **שיטת החישוב:** [כללי החישוב](docs/payouts/rules.md). המנוע: `app/payouts/engine.js`.
- **הערכים העסקיים** (אחוזים, עלויות, משכורות, שותפים) נשמרים ב־Supabase בטבלה `payout_settings` ונערכים ממסך ״הגדרות״. הם **לא** נשמרים בריפו, כי הוא ציבורי. עותק מקומי נמצא ב־`private/` (מוחרג מ־git).
- **גישה:** רק משתמשים בטבלה `payout_owners`, שנפרדת מ־`staff` של הצעות המחיר. הוספת בעלים: יוצרים משתמש ב־Authentication → Users (*Add user*, *Auto Confirm User*) ומריצים ב־SQL Editor:
  ```sql
  insert into public.payout_owners (user_id, email)
  select id, email from auth.users where email = 'name@astrateg.com';
  ```
- **נעילת חודש:** אחרי תשלום סוגרים את החודש במסך ״החודש״. השרת חוסם שינוי עסקאות, הכנסות, הוצאות והגדרות שנוגעים לחודש נעול.

## איך זה בנוי

- **אתר סטטי** (HTML, CSS ו־JavaScript, בלי שלב בנייה) שמתארח ב־GitHub Pages.
- **נוסח ההסכם** ופרטי אסטרטג כצד להסכם נמצאים ב־`app/legal.js`. הסכום בסעיף התמורה נלקח מהחבילה והתוספות שנבחרו.
- **מנוע התמחור** נמצא ב־`app/catalog.js` וב־`app/pricing.js`. הוא משקף את [כללי התמחור](docs/pricing-rules.md) ומשמש גם את הדפדפן וגם את השרת.
- **Supabase** (הפרויקט `astrateg-quotes`) שומר הצעות וחתימות:
  - הפונקציה `create-quote` מחשבת את המחיר מחדש בשרת, כך שקישור ללקוח לא נשען על סכום שנשלח מהדפדפן. רק משתמשים שמופיעים בטבלת `staff` יכולים ליצור הצעות.
  - ההצעה נשמרת כתמונת מצב שאי אפשר לשנות, עם טביעת SHA-256 שמזהה בדיוק את המסמך שנחתם.
  - הלקוח ניגש רק להצעה של הקישור שלו (מזהה אקראי של 122 ביט). בחתימה נשמרים שם, תמונת החתימה, זמן, כתובת IP ודפדפן. אחרי החתימה ההצעה ננעלת.
  - מבנה מסד הנתונים: `supabase/migrations/`.

## פרסום וגישה

- **האתר:** https://adamsin155.github.io/---/ . הוא מתפרסם מהענף `gh-pages`, שמכיל רק את קבצי האתר, כי כל מה שבו ציבורי. כדי לפרסם גרסה חדשה, עומדים על `claude/amazing-tesla-bvt0sx` אחרי commit, מריצים `git fetch origin gh-pages && node scripts/build-pages.mjs --commit`, ואז את פקודת ה־`git push` שהסקריפט מדפיס. פרטים: [מדריך התפעול](docs/ops.md), סעיף 2.
- **כניסת צוות:** משתמש `adam@astrateg.com` קיים ומורשה. את הסיסמה מחליפים בעמוד ״הצעות שנשלחו״, בכפתור ״שינוי סיסמה״.
- **שכחתי סיסמה:** כפתור במסך הכניסה שולח קישור איפוס למייל. הקישור פותח את עמוד ״הצעות שנשלחו״ ומבקש סיסמה חדשה. כדי שהקישור יחזור לאתר ולא לכתובת ברירת המחדל, יש להגדיר ב־Supabase (Authentication → URL Configuration): *Site URL* ‏`https://adamsin155.github.io/---/` ולהוסיף ל־*Redirect URLs* את `https://adamsin155.github.io/---/quotes.html`. שירות המייל המובנה של Supabase מוגבל בכמות שליחות; לשימוש קבוע כדאי לחבר SMTP משלכם (Authentication → Emails → SMTP Settings).
- **הוספת איש מכירות:** ב־Supabase, Authentication → Users → *Add user* עם *Auto Confirm User*. אחר כך מריצים ב־SQL Editor:
  ```sql
  insert into public.staff (email) values ('name@astrateg.com');
  ```
- **מומלץ:** לכבות הרשמה חופשית (Authentication → Sign In / Providers → *Allow new users to sign up*). גם כשההרשמה פתוחה, משתמש שנרשם לבד לא מקבל שום גישה.

## בדיקות

**אוטומטי:** בכל דחיפה של קוד, GitHub Actions מריץ את כל הבדיקות (`.github/workflows/checks.yml`). **אחרי כל שינוי** אפשר להפעיל גם את הסוכן [שומר המערכת](.claude/agents/payouts-guardian.md), שבודק את כל המערכת מול הכללים ומתקן באגים.


```bash
npm install
npm test                                # מנועי התמחור, הפרוטוקול והתשלומים, שלוש פעמים: UTC, ניו יורק וירושלים (מקרה האקסל רץ רק כשקיים private/)
npx http-server -p 8080 . & node tests/e2e.mjs   # תהליך מלא בדפדפן מול שרת מדומה
node tests/protocol-e2e.mjs                       # כרטיס הלקוח בדפדפן מול שרת מדומה
node tests/protocol-office-e2e.mjs                # מה עליי, בקרה, ביצועים וסיכום בוקר מול שרת מדומה
node tests/team-e2e.mjs                           # צוות וכניסות, קישור כניסה, מספרי וואטסאפ ובחירת סיסמה מול שרת מדומה
node tests/handoffs-e2e.mjs                       # כפתורי העברה: וואטסאפ מוכן לאדם הבא, מ״מה עליי״ ומכרטיס הלקוח
node tests/payouts-e2e.mjs                       # מערכת התשלומים בדפדפן, בטלפון ובמחשב, מול שרת מדומה
```

## מבנה

```
index.html, q.html, quotes.html
payouts/    אפליקציית התשלומים: index.html, manifest, אייקונים
app/        catalog.js, pricing.js, quote-doc.js, builder.js, client.js, dashboard.js, supa.js
app/payouts/ engine.js (חישוב), data.js (Supabase), app.js (מסכים)
app/styles/ app.css (ממשק), quote.css (מסמך ההצעה), client.css, quotes.css
app/fonts/  Rubik + JetBrains Mono (OFL), מתארחים מקומית
app/vendor/ supabase-js (MIT)
supabase/   migrations, functions/create-quote, functions/staff-admin, functions/_shared/app (עותק שנוצר מ־app/)
scripts/    sync-functions (עותק app/ לפונקציות), build-pages (מה שמתפרסם ל־gh-pages), build-payment-site
docs/       כללי תמחור, חלוקת אחריות, מדריך מותג, מחקר
.claude/agents/  סוכני UX, עיצוב, טכנולוגיה, איכות, מחקר ועוזר משפטי;
                 payouts-*: טכנולוגיה, עיצוב, בקרה ומחקר למערכת התשלומים
private/         נתונים עסקיים רגישים — מוחרג מ־git
```

שינוי מחיר, כמות, זכאות או נוסח ההסכם: מעדכנים את `docs/pricing-rules.md`, `app/catalog.js` או `app/legal.js`, מריצים `node scripts/sync-functions.mjs` (מעדכן את העותק של `pricing.js`, `catalog.js` ו־`legal.js` ב־`supabase/functions/_shared/app/`) ו־`npm test`, ופורסים מחדש את הפונקציה `create-quote` עם העותק. הפונקציה לא טוענת קוד מהמאגר. פריסה, סודות, מיגרציות, גיבויים וכתובת קבועה: [מדריך התפעול](docs/ops.md).
