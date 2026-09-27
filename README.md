# astrateg · מחולל הצעות מחיר

מערכת לבניית הצעות מחיר לאנשי מכירות: בחירת חבילה ומשפיענים, תוספות בתשלום וללא עלות, חישוב מחיר אוטומטי, תצוגה מקדימה, הדפסה והורדה, ו**קישור ללקוח שבו הוא צופה בהצעה וחותם עליה**.

## עמודים

| עמוד | למי | מה עושים בו |
|---|---|---|
| `index.html` | איש מכירות | בוחרים **הצעת מחיר** (לעיון, ללא חתימה) או **הסכם התקשרות** (עם תנאים משפטיים וחתימה), בונים, ומפיקים תצוגה מקדימה, הדפסה, קובץ HTML או קישור ללקוח |
| `q.html?t=…` | הלקוח | צופה בהצעה, מקליד שם, חותם ומאשר |
| `quotes.html` | צוות | רשימת ההצעות שנשלחו, סטטוס (ממתין, נצפה, נחתם, בוטל), העתקת קישור וביטול |

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

- **האתר:** https://adamsin155.github.io/---/ . הוא מתפרסם מהענף `gh-pages`. כדי לפרסם גרסה חדשה מריצים `git push origin claude/amazing-tesla-bvt0sx:gh-pages`.
- **כניסת צוות:** משתמש `adam@astrateg.com` קיים ומורשה. את הסיסמה מחליפים בעמוד ״הצעות שנשלחו״, בכפתור ״שינוי סיסמה״.
- **שכחתי סיסמה:** כפתור במסך הכניסה שולח קישור איפוס למייל. הקישור פותח את עמוד ״הצעות שנשלחו״ ומבקש סיסמה חדשה. כדי שהקישור יחזור לאתר ולא לכתובת ברירת המחדל, יש להגדיר ב־Supabase (Authentication → URL Configuration): *Site URL* ‏`https://adamsin155.github.io/---/` ולהוסיף ל־*Redirect URLs* את `https://adamsin155.github.io/---/quotes.html`. שירות המייל המובנה של Supabase מוגבל בכמות שליחות; לשימוש קבוע כדאי לחבר SMTP משלכם (Authentication → Emails → SMTP Settings).
- **הוספת איש מכירות:** ב־Supabase, Authentication → Users → *Add user* עם *Auto Confirm User*. אחר כך מריצים ב־SQL Editor:
  ```sql
  insert into public.staff (email) values ('name@astrateg.com');
  ```
- **מומלץ:** לכבות הרשמה חופשית (Authentication → Sign In / Providers → *Allow new users to sign up*). גם כשההרשמה פתוחה, משתמש שנרשם לבד לא מקבל שום גישה.

## בדיקות

```bash
npm install
npm test                                # מנוע התמחור ומנוע התשלומים (מקרה האקסל רץ רק כשקיים private/)
npx http-server -p 8080 . & node tests/e2e.mjs   # תהליך מלא בדפדפן מול שרת מדומה
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
supabase/   migrations, functions/create-quote
docs/       כללי תמחור, חלוקת אחריות, מדריך מותג, מחקר
.claude/agents/  סוכני UX, עיצוב, טכנולוגיה, איכות, מחקר ועוזר משפטי;
                 payouts-*: טכנולוגיה, עיצוב, בקרה ומחקר למערכת התשלומים
private/         נתונים עסקיים רגישים — מוחרג מ־git
```

שינוי מחיר, כמות, זכאות או נוסח ההסכם: מעדכנים את `docs/pricing-rules.md`, `app/catalog.js` או `app/legal.js`, מריצים `npm test`, ופורסים מחדש את הפונקציה `create-quote` (היא כוללת את `app/pricing.js`, `app/catalog.js` ו־`app/legal.js`).
