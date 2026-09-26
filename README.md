# astrateg · מחולל הצעות מחיר

מערכת לבניית הצעות מחיר לאנשי מכירות: בחירת חבילה ומשפיענים, תוספות בתשלום וללא עלות, חישוב מחיר אוטומטי, תצוגה מקדימה, הדפסה והורדה, ו**קישור ללקוח שבו הוא צופה בהצעה וחותם עליה**.

## עמודים

| עמוד | למי | מה עושים בו |
|---|---|---|
| `index.html` | איש מכירות | בונים הצעה, מפיקים תצוגה מקדימה, הדפסה או קובץ HTML, ויוצרים קישור לחתימה |
| `q.html?t=…` | הלקוח | צופה בהצעה, מקליד שם, חותם ומאשר |
| `quotes.html` | צוות | רשימת ההצעות שנשלחו, סטטוס (ממתין, נצפה, נחתם, בוטל), העתקת קישור וביטול |

## איך זה בנוי

- **אתר סטטי** (HTML, CSS ו־JavaScript, בלי שלב בנייה) שמתארח ב־GitHub Pages.
- **מנוע התמחור** נמצא ב־`app/catalog.js` וב־`app/pricing.js`. הוא משקף את [כללי התמחור](docs/pricing-rules.md) ומשמש גם את הדפדפן וגם את השרת.
- **Supabase** (הפרויקט `astrateg-quotes`) שומר הצעות וחתימות:
  - הפונקציה `create-quote` מחשבת את המחיר מחדש בשרת, כך שקישור ללקוח לא נשען על סכום שנשלח מהדפדפן. רק משתמשים שמופיעים בטבלת `staff` יכולים ליצור הצעות.
  - ההצעה נשמרת כתמונת מצב שאי אפשר לשנות, עם טביעת SHA-256 שמזהה בדיוק את המסמך שנחתם.
  - הלקוח ניגש רק להצעה של הקישור שלו (מזהה אקראי של 122 ביט). בחתימה נשמרים שם, תמונת החתימה, זמן, כתובת IP ודפדפן. אחרי החתימה ההצעה ננעלת.
  - מבנה מסד הנתונים: `supabase/migrations/`.

## פרסום וגישה

- **האתר:** https://adamsin155.github.io/---/ . הוא מתפרסם מהענף `gh-pages`. כדי לפרסם גרסה חדשה מריצים `git push origin claude/amazing-tesla-bvt0sx:gh-pages`.
- **כניסת צוות:** משתמש `adam@astrateg.com` קיים ומורשה. את הסיסמה מחליפים בעמוד ״הצעות שנשלחו״, בכפתור ״שינוי סיסמה״.
- **הוספת איש מכירות:** ב־Supabase, Authentication → Users → *Add user* עם *Auto Confirm User*. אחר כך מריצים ב־SQL Editor:
  ```sql
  insert into public.staff (email) values ('name@astrateg.com');
  ```
- **מומלץ:** לכבות הרשמה חופשית (Authentication → Sign In / Providers → *Allow new users to sign up*). גם כשההרשמה פתוחה, משתמש שנרשם לבד לא מקבל שום גישה.

## בדיקות

```bash
npm install
npm test                                # מנוע התמחור: מקרי הקבלה ו־34 צירופים
npx http-server -p 8080 . & node tests/e2e.mjs   # תהליך מלא בדפדפן מול שרת מדומה
```

## מבנה

```
index.html, q.html, quotes.html
app/        catalog.js, pricing.js, quote-doc.js, builder.js, client.js, dashboard.js, supa.js
app/styles/ app.css (ממשק), quote.css (מסמך ההצעה), client.css, quotes.css
app/fonts/  IBM Plex Sans Hebrew + IBM Plex Mono (OFL), מתארחים מקומית
app/vendor/ supabase-js (MIT)
supabase/   migrations, functions/create-quote
docs/       כללי תמחור, חלוקת אחריות, מדריך מותג, מחקר
.claude/agents/  סוכני UX, עיצוב, טכנולוגיה, איכות ומחקר
```

שינוי מחיר, כמות או זכאות: מעדכנים את `docs/pricing-rules.md` ואת `app/catalog.js`, מריצים `npm test`, ופורסים מחדש את הפונקציה `create-quote`.
