# מחקר מימוש: חגים, התקנה כאפליקציה והוספה ליומן

**תאריך:** 29.9.2026. **מתייחס ל:** [מפת הדרכים](roadmap.md), פריטים Q1, Q7 ו־Q8. בהמשך ל[מחקר המערכות](research.md), החלטה 7.

**סימונים:**
- **[נקרא]**: העמוד נפתח ונקרא, בדרך כלל מקוד המקור ב־GitHub.
- **[תקציר]**: המידע מבוסס רק על תקציר של מנוע החיפוש, כי האתר נחסם בפרוקסי.
- **[חושב]**: חישוב ידני.
- **[השערה]**: לא אומת. צריך בדיקה על מכשיר.

**אתרים שנחסמו בפרוקסי, ולכן לא אומתו ישירות:** hebcal.com, ‏timeanddate.com, ‏chabad.org, ‏web.dev, ‏developer.chrome.com, ‏webkit.org, ‏developer.mozilla.org (נקרא דרך `mdn/content` ב־GitHub), ‏rfc-editor.org ו־ietf.org (RFC 5545 נקרא מעותק ב־GitHub), ‏wikipedia.org.

---

## 1. ימי חג בחישוב ימי עסקים (Q1)

**השאלה:** באילו תאריכים בשנים 2026–2028 המשרד סגור בימים א׳–ה׳? איך מכניסים אותם ל־`isBusinessDay` בלי שלב בנייה?

**הצלחה:** מועד יעד לא נופל ביום חג. חישוב ימי העסקים מדלג על חגים.

### ממצאים

- **hebcal-es6, ‏`src/modern.ts`** [נקרא] ([מקור](https://github.com/hebcal/hebcal-es6/blob/main/src/modern.ts)): כלל ההזזה של יום הזיכרון, ויום העצמאות למחרתו:
  - פסח חל ביום א׳: יום הזיכרון ב־2 באייר.
  - פסח חל בשבת: יום הזיכרון ב־3 באייר.
  - פסח חל ביום ג׳ (משנת תשס״ד): יום הזיכרון ב־5 באייר.
  - אחרת: יום הזיכרון ב־4 באייר.

  ← לכן יום העצמאות חל תמיד בימים ג׳–ה׳. ב־2028 ה׳ באייר חל ביום ב׳, ויום העצמאות עובר ליום ג׳, 2.5.2028.
- **חישוב** [חושב]: ראש השנה חל 163 ימים אחרי א׳ של פסח. שבועות חל 50 ימים אחרי א׳ של פסח. ה׳ באייר חל 20 יום אחרי א׳ של פסח.
- **הצלבה** [תקציר]: התאריכים הבאים תואמים לתקצירים של [hebcal 2026–2027](https://www.hebcal.com/holidays/2026-2027), ‏[hebcal יום העצמאות 2027](https://www.hebcal.com/holidays/yom-haatzmaut-2027), ‏[hebcal יום העצמאות 2028](https://www.hebcal.com/holidays/yom-haatzmaut-2028), ‏[hebcal פסח 2028](https://www.hebcal.com/holidays/pesach-2028) ו־[chabad 2028](https://www.chabad.org/holidays/default_cdo/year/2028/jewish/holidays-2028.htm):
  - ערב פסח: 1.4.2026, ‏21.4.2027 ו־10.4.2028.
  - יום העצמאות: 22.4.2026, ‏12.5.2027 ו־2.5.2028.
  - ערב ראש השנה: 11.9.2026 ו־1.10.2027.
  - יום כיפור: 21.9.2026, ‏11.10.2027, ו־30.9.2028 (שבת).
  - ערב שבועות: 30.5.2028.
  - שמיני עצרת: 12.10.2028.
- **@hebcal/core לא הורץ.** לסוכן המחקר אין מעטפת, ולכן אי אפשר היה להתקין חבילות. הרשימה חושבה ידנית והוצלבה כמתואר למעלה. כדאי להריץ את הסקריפט שבהמשך פעם אחת ולהשוות לרשימה.

### התאריכים (א׳–ה׳ בלבד, לוח ארץ ישראל)

**סגור** (`HOLIDAYS`):

| שנה | תאריכים |
|---|---|
| 2026 | 2.4 פסח · 8.4 שביעי של פסח · 22.4 יום העצמאות · 13.9 ראש השנה ב׳ · 21.9 יום כיפור |
| 2027 | 22.4 פסח · 28.4 שביעי של פסח · 12.5 יום העצמאות · 3.10 ראש השנה ב׳ · 11.10 יום כיפור |
| 2028 | 11.4 פסח · 17.4 שביעי של פסח · 2.5 יום העצמאות · 31.5 שבועות · 21.9 ראש השנה א׳ · 5.10 סוכות · 12.10 שמיני עצרת |

חגים שחלים בשישי או בשבת לא נכללים ברשימה, כי המערכת כבר לא סופרת את הימים האלה:
- 2026: שבועות, ראש השנה א׳, סוכות ושמיני עצרת.
- 2027: שבועות, ראש השנה א׳, סוכות ושמיני עצרת.
- 2028: ראש השנה ב׳ ויום כיפור.

**ערבי חג** (`EREV`). ברירת המחדל: יום עסקים.

| שנה | תאריכים |
|---|---|
| 2026 | 1.4 · 7.4 (גם חול המועד) · 21.5 · 20.9 ערב יום כיפור |
| 2027 | 21.4 · 27.4 (גם חול המועד) · 10.6 · 10.10 ערב יום כיפור |
| 2028 | 10.4 · 16.4 (גם חול המועד) · 30.5 · 20.9 ערב ראש השנה · 4.10 ערב סוכות · 11.10 הושענא רבה |

**חול המועד** (`CHOL_HAMOED`). ברירת המחדל: יום עסקים.

| שנה | תאריכים |
|---|---|
| 2026 | 5–7.4 · 27.9–1.10 |
| 2027 | 25–27.4 · 17–21.10 |
| 2028 | 12–13.4, 16.4 · 8–11.10 |

יום הזיכרון (21.4.2026, ‏11.5.2027, ‏1.5.2028) אינו ברשימות. זו החלטה של המשרד.

הקובץ המוכן, כמודול ES: ‏`/tmp/claude-0/-home-user/fa16d9a5-a1ec-50f0-b030-ae76b8d677f1/scratchpad/research/holidays.js`. הקובץ מייצא את `HOLIDAYS`, ‏`EREV`, ‏`CHOL_HAMOED` ו־`COVERAGE`. סוכן הטכנולוגיה יעתיק אותו ל־`app/`.

**הפקה שנתית** [השערה, לא הורץ]. הסקריפט רץ ב־Node, מחוץ לאתר:

```js
import { HebrewCalendar, flags } from '@hebcal/core';
const ev = HebrewCalendar.calendar({ start: new Date(2029, 0, 1), end: new Date(2029, 11, 31), il: true });
const pick = (f) => ev.filter((e) => f(e) && e.getDate().greg().getDay() <= 4).map((e) => {
  const d = e.getDate().greg();
  return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, name: e.render('he') };
});
console.log(JSON.stringify({
  HOLIDAYS: pick((e) => (e.getFlags() & flags.CHAG) || e.getDesc() === "Yom HaAtzma'ut" || e.getDesc() === 'Yom Kippur'),
  EREV: pick((e) => e.getFlags() & flags.EREV),
  CHOL_HAMOED: pick((e) => e.getFlags() & flags.CHOL_HAMOED),
}, null, 2));
```

### החלטות

**1.1 רשימת חגים סטטית בצד הדפדפן, ו־`isBusinessDay` בודק אותה לפי מפתח מקומי.**

```js
import { HOLIDAYS, EREV, CHOL_HAMOED } from './holidays.js';
const OFFICE = { erev: 'open', cholHamoed: 'open' }; // החלטת המשרד
const CLOSED = new Set([
  ...HOLIDAYS,
  ...(OFFICE.erev === 'closed' ? EREV : []),
  ...(OFFICE.cholHamoed === 'closed' ? CHOL_HAMOED : []),
].map((h) => h.date));
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isBusinessDay = (d) => d.getDay() !== 5 && d.getDay() !== 6 && !CLOSED.has(key(d));
```

- **מלכודת:** לא להשתמש ב־`toISOString().slice(0, 10)`. הפונקציה מחזירה תאריך לפי UTC, ובישראל חצות מקומית נופלת עוד ביום הקודם לפי UTC.
- **קבלה**, בדיקות יחידה ב־`npm test`:
  - אפיון ב־29.9.2026 ועוד 3 ימי עסקים: 4.10.2026 אם חול המועד פתוח, ו־6.10.2026 אם הוא סגור.
  - 20.9.2026 ועוד יום עסקים אחד: 22.9 (מדלג על יום כיפור).
  - "יום לפני הצילום" לצילום ב־9.4.2026: 7.4.2026 (מדלג על שביעי של פסח).
  - 1.4.2026 ועוד יום עסקים אחד: 5.4.2026 כשחול המועד פתוח.

**1.2 תאריך תפוגה גלוי.** `COVERAGE.to` הוא 2028-12-31. בדיקה נכשלת כשהתאריך הנוכחי קרוב ל־`COVERAGE.to` בפחות מ־90 יום.
- **קבלה:** הרצת הבדיקות עם שעון מדומה ב־2.10.2028 נכשלת עם ההודעה "לעדכן holidays.js".

**1.3 שאלה לבעל המשרד** (כבר פתוחה במפת הדרכים): האם המשרד עובד בערבי חג ובחול המועד? עד שתתקבל תשובה, שניהם ימי עסקים. אם ערב חג הוא חצי יום, זה משפיע רק על יעדים בשעות (Q3).

---

## 2. התקנה כאפליקציה ב־GitHub Pages תחת תת־נתיב (Q7)

**השאלה:** מה נדרש כדי ש־`https://adamsin155.github.io/---/` יותקן במסך הבית באנדרואיד וב־iPhone? איך מונעים הגשה של JS ישן אחרי פריסה?

### ממצאים

- **MDN, ‏Making PWAs installable** [נקרא] ([מקור](https://github.com/mdn/content/blob/main/files/en-us/web/progressive_web_apps/guides/making_pwas_installable/index.md)):
  - Chromium דורש את `name` או `short_name`, את `icons` בגדלים 192 ו־512, את `start_url` ואת `display` ו/או `display_override`. אם `prefer_related_applications` מופיע, ערכו חייב להיות false.
  - נדרש HTTPS.
  - Service Worker הוא "not a requirement for a PWA to be installable".
  - ב־iOS 16.4 ומעלה אפשר להתקין מתפריט השיתוף, גם מ־Chrome, ‏Edge ו־Firefox.
- **Chrome, ‏Revisiting installability criteria** [תקציר] ([דף](https://developer.chrome.com/blog/update-install-criteria)):
  - מגרסה 108 במובייל (ו־112 במחשב) אין צורך ב־fetch handler כדי להתקין מהתפריט.
  - **חלון ההתקנה האוטומטי עדיין דורש fetch handler.**
- **MDN, ‏start_url ו־scope** [נקרא] ([start_url](https://github.com/mdn/content/blob/main/files/en-us/web/progressive_web_apps/manifest/reference/start_url/index.md), ‏[scope](https://github.com/mdn/content/blob/main/files/en-us/web/progressive_web_apps/manifest/reference/scope/index.md)):
  - ערך יחסי נפתר "against the manifest file's URL".
  - `start_url` חייב להיות בתוך `scope`.
  - מומלץ ש־scope יסתיים ב־`/`.

  ← אם `manifest.webmanifest` יושב בשורש המאגר, הערכים `"./"` ו־`"./clients.html#mine"` נפתרים ל־`/---/`, בלי לכתוב את שם המאגר.
- **MDN, ‏`register()`** [נקרא] ([מקור](https://github.com/mdn/content/blob/main/files/en-us/web/api/serviceworkercontainer/register/index.md)):
  - ה־scope שנקבע כברירת מחדל הוא התיקייה של הסקריפט.
  - בברירת המחדל `updateViaCache: 'imports'`, הסקריפט הראשי של ה־SW "always be updated from the network".
- **GitHub Pages שולח `Cache-Control: max-age=600`**, ואין דרך לשנות זאת [נקרא] ([דיון](https://github.com/orgs/community/discussions/11884)).
  ← **כבר היום, בלי SW,** דפדפן יכול להגיש JS ישן עד 10 דקות אחרי פריסה. זה עלול לערבב מודולים ישנים וחדשים. SW עם `cache: 'no-cache'` פותר את זה.
- **MDN, ‏`Request.cache`** [נקרא] ([מקור](https://github.com/mdn/content/blob/main/files/en-us/web/api/request/cache/index.md)): במצב `no-cache` הדפדפן שולח בקשה מותנית "fresh or stale". תשובה 304 זולה.
- **Safari 15.4** [תקציר] ([WebKit](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/), ‏[Lighthouse #14064](https://github.com/GoogleChrome/lighthouse/issues/14064)):
  - Safari תומך באייקונים מה־manifest.
  - `apple-touch-icon` גובר עליהם.
  - הגודל המקובל הוא 180×180.
- [השערה, לבדוק]:
  - באפליקציה שהותקנה ב־iPhone, האחסון נפרד מ־Safari. לכן כל עובד יתחבר מחדש פעם אחת בתוך האפליקציה.
  - iOS ממלא שקיפות באייקון ברקע שחור.

### Snippets

**`manifest.webmanifest`**, בשורש המאגר:

```json
{
  "id": "./",
  "name": "Astrateg — פרוטוקול לקוחות",
  "short_name": "Astrateg",
  "lang": "he",
  "dir": "rtl",
  "start_url": "./clients.html#mine",
  "scope": "./",
  "display": "standalone",
  "background_color": "#FFFFFF",
  "theme_color": "#031432",
  "icons": [
    { "src": "app/assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "app/assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "app/assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- `app/assets/logo-mark.png` אינו ריבועי (בערך 270×165).
- צריך להפיק ממנו ארבעה קבצים. כולם על רקע לבן אטום:
  - `icon-192.png`
  - `icon-512.png`
  - `icon-maskable-512.png`: הסימן בתוך 80% האמצעיים.
  - `apple-touch-icon.png` בגודל 180×180.
- הפריסה והמראה של האייקונים בידי סוכן העיצוב.

**ב־`<head>` של כל עמוד HTML:**

```html
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="app/assets/apple-touch-icon.png">
<meta name="theme-color" content="#031432">
```

**`sw.js`**, בשורש המאגר. אסטרטגיית network-first לכל בקשה מהאתר עצמו: תמיד בקשה לרשת עם אימות מול השרת. המטמון משמש רק כשאין רשת. ה־SW לא נוגע ב־Supabase, כי הבקשות אליה הן cross-origin.

```js
const CACHE = 'shell';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // Supabase ואחרים: בלי התערבות
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || fetch(req)))
  );
});
```

**רישום**, במודול משותף שנטען בכל עמוד:

```js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
```

**מתג חירום.** אם ה־SW גורם לבעיה, מחליפים את `sw.js` בקוד הבא ופורסים:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate(c.url)))
));
```

### החלטות

**2.1 manifest, אייקונים ו־`apple-touch-icon`, עם ערכים יחסיים ובלי שם המאגר.**
- **קבלה:**
  - ב־Chrome באנדרואיד מופיע "התקנת אפליקציה" בתפריט, והאפליקציה נפתחת במסך מלא על "מה עליי".
  - ב־iPhone, "הוספה למסך הבית" מציגה את הסימן על רקע לבן ונפתחת בלי שורת כתובת.
  - בכלי המפתחים של Chrome, בלשונית Application > Manifest, אין שגיאות.

**2.2 ‏SW ברשת קודם, עם `cache: 'no-cache'`, בלי מטמון מוקדם ובלי מספר גרסה.** ה־SW מוסיף שני דברים: חלון התקנה אוטומטי באנדרואיד, ותשתית לדחיפה (U2). הוא גם מבטל את 10 הדקות של JS ישן.
- **קבלה:**
  - אחרי פריסה, טעינה רגילה ראשונה (לא רענון כפוי) מגישה את הקבצים החדשים. אפשר לבדוק לפי שינוי מזהה ב־console או לפי 200/304 בלשונית Network.
  - במצב טיסה, העמוד האחרון שנפתח עדיין מוצג.
  - בקשות ל־`*.supabase.co` לא מופיעות כ־"from ServiceWorker".
  - [השערה] צריך לבדוק ב־Chrome באנדרואיד וב־Safari ב־iOS שבקשת ניווט עם `{cache:'no-cache'}` לא נכשלת. אם היא נכשלת, קוד ה־catch נופל ל־`fetch(req)`.

**2.3 הודעה חד־פעמית ב־iPhone:** "יש להתחבר שוב בתוך האפליקציה". ההחלטה על הניסוח והרצף בידי סוכן ה־UX.
- **קבלה:** QA מאשר על iPhone אמיתי אם נדרשת התחברות נוספת, ומעדכן את ההנחה.

---

## 3. "הוספה ליומן" לאפיון וליום הצילום (Q8)

**השאלה:** איך מפיקים אירוע שנכנס נכון ל־Google Calendar, ליומן של iPhone ול־Outlook? האם להשתמש ב־TZID או ב־UTC? מה כללי ה־escaping לעברית?

### ממצאים

- **RFC 5545** [נקרא] ([עותק ב־GitHub](https://github.com/juxt/tick/blob/master/docs/rfc5545.txt)):
  - ב־`VCALENDAR` חובה `PRODID` ו־`VERSION`. ב־`VEVENT` חובה `UID` ו־`DTSTAMP`. ‏`DTSTART` חובה כשאין `METHOD`.
  - **שורות:** מסתיימות ב־CRLF, באורך של 75 octets לכל היותר. קיפול שורה: CRLF ואחריו רווח. המקור מזהיר מפני קיפול באמצע תו UTF-8 מרובה בתים. תו עברי תופס 2 בתים.
  - **TEXT:** ‏`ESCAPED-CHAR = "\\" / "\;" / "\," / "\N" / "\n"`. הנקודתיים לא מוברחות.
  - **תאריך ושעה:** יש שתי צורות. הראשונה ב־UTC עם `Z`, למשל `19980119T070000Z`. השנייה מקומית עם `TZID=`. ‏"An individual VTIMEZONE calendar component MUST be specified for each unique TZID". ‏TZID אסור על זמן UTC.

  ← **UTC עם `Z` היא הצורה המינימלית והתקנית.** היא לא דורשת בלוק `VTIMEZONE` של Asia/Jerusalem, עם כללי שעון קיץ שצריך לתחזק. היומן ממיר לאזור הזמן של המכשיר. כל הצוות בישראל, אז השעה תוצג נכון.
  ← `TZID=Asia/Jerusalem` בלי `VTIMEZONE` אינו תקני. Google ו־Apple כנראה סובלניים לכך. ב־Outlook למחשב זה לא ודאי [השערה]. לכן לא משתמשים ב־TZID.
- `shoot_at` ו־`char_at` נשמרים כ־`timestamptz` [קוד], ולכן ההמרה ל־UTC ישירה.
- **Google Calendar** [נקרא] ([תיעוד קהילתי](https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/main/services/google.md)). אין לפורמט הזה תיעוד רשמי של Google.
  - כתובת הבסיס: `https://calendar.google.com/calendar/render`. היא אמינה יותר באנדרואיד מ־`/r/eventedit`.
  - `action=TEMPLATE`, ‏`text`, ‏`dates=START/END`: "UTC range only when both halves end with Z". בלי `Z` הזמן מקומי לפי `ctz`.
  - `details`, ‏`location`.
  - `add`: כתובות מוזמנים.
  ← עם `add=` וכתובות הצוות מטבלת `staff`, עירית לוחצת פעם אחת, שומרת, וכולם מקבלים הזמנה. זה בדיוק "ליומן של כולם" מתהליך 11.
- אין לטבלת `clients` שדה כתובת [קוד]. ‏`LOCATION` יישאר ריק עד שיוחלט אחרת.

### Snippets

```js
const pad = (n) => String(n).padStart(2, '0');
const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1');

// קיפול לפי בתים, בלי לחתוך תו: 75 בשורה הראשונה, 74 אחרי הרווח המוביל
function fold(line) {
  const enc = new TextEncoder(); const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function icsEvent({ uid, start, end, title, description, location }) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Astrateg//Protocol//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,                       // קבוע לאירוע, למשל `shoot-${client.id}@astrateg`
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(new Date(start))}`,
    `DTEND:${utc(new Date(end))}`,
    `SUMMARY:${esc(title)}`,
    description && `DESCRIPTION:${esc(description)}`,
    location && `LOCATION:${esc(location)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(text, filename = 'shoot.ics') {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl({ title, start, end, details = '', location = '', guests = [] }) {
  const q = {
    action: 'TEMPLATE', text: title, dates: `${utc(new Date(start))}/${utc(new Date(end))}`,
    ctz: 'Asia/Jerusalem', details, location, add: guests.join(','),
  };
  return 'https://calendar.google.com/calendar/render?' +
    Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
```

- הקישור משתמש ב־`encodeURIComponent` ולא ב־`URLSearchParams`. ‏`URLSearchParams` מקודד רווח כ־`+`, ולא אומת ש־Google מפענח `+` כרווח.
- שם הקובץ נשאר באנגלית, כדי להימנע מבעיות קידוד בהורדה.

**דוגמת פלט:** יום צילום ב־4.10.2026, 10:00–14:00 שעון ישראל (UTC+3):

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Astrateg//Protocol//HE
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:shoot-2f1c…@astrateg
DTSTAMP:20260929T090000Z
DTSTART:20261004T070000Z
DTEND:20261004T110000Z
SUMMARY:יום צילום — מאפיית כהן\, נטלי
DESCRIPTION:צוות: נטלי\, עירית\nכתובת תיבדק בתהליך 16
END:VEVENT
END:VCALENDAR
```

### החלטות

**3.1 כפתור ראשי "הזמנה ביומן Google" עם `add=`, אם המשרד עובד עם Google Calendar.** הכפתור יופיע בתהליך 11 (יום צילום) ובאפיון, ויכלול את כתובות הצוות הרלוונטי מ־`staff`. זו שאלה לבעל המשרד: האם כולם ב־Google Calendar?
- **קבלה:**
  - לחיצה אחת פותחת אירוע ממולא: כותרת בעברית תקינה, שעה נכונה בשעון ישראל, ורשימת מוזמנים.
  - אחרי שמירה, כל מוזמן רואה את האירוע ביומן שלו.
  - `p11.calendar` נסגר בלי הקלדה.

**3.2 קובץ `.ics` בזמני UTC ‏(`Z`), בלי `TZID` ובלי `VTIMEZONE`.** הקובץ ישמש כחלופה ל־iPhone ול־Outlook, ולמי שאינו ב־Google.
- **קבלה**, בדיקת יחידה:
  - `icsEvent` מחזיר שורות CRLF, ואף שורה אינה עולה על 75 בתים.
  - כותרת עם `,` ‏`;` ושבירת שורה יוצאת מוברחת.
  - שעה 10:00 בישראל בקיץ יוצאת `070000Z`, ובחורף (למשל 3.12.2026) יוצאת `080000Z`.
- **קבלה**, QA על מכשירים:
  - הקובץ נפתח ומיובא עם שעה נכונה ועברית תקינה ב־Google Calendar (ייבוא מהמחשב), ביומן של iPhone דרך Safari, וב־Outlook.
  - [השערה] הורדת blob מתוך אפליקציה מותקנת ב־iOS לא נבדקה. אם היא נכשלת, להציג שם רק את קישור Google.

**3.3 `UID` קבוע לכל אירוע.** ה־UID בנוי מסוג האירוע ומזהה הלקוח: `shoot-<id>` או `char-<id>`. אם שעת הצילום משתנה, ייבוא חוזר צפוי לעדכן את האירוע ולא לשכפל אותו [השערה].
- **קבלה:** QA מייבא פעמיים עם שעה שונה ב־iPhone וב־Outlook, ומתעד אם נוצר אירוע כפול.

---

## למי זה עובר

| נושא | סוכן | ההשלכה |
|---|---|---|
| `holidays.js`, ‏`isBusinessDay`, ‏`sw.js`, manifest, ‏`icsEvent` | טכנולוגיה | מימוש לפי ה־snippets. לא לשנות את `protocol.js` |
| ארבעה אייקונים ריבועיים מהסימן | עיצוב | רקע לבן, אזור בטוח של 80% באייקון maskable |
| ניסוח הכפתורים, הודעת ההתחברות ב־iPhone, מיקום הכפתור בתהליך 11 | UX | החלטות 2.3 ו־3.1 |
| בדיקות יחידה לתאריכים, בדיקות מכשיר ל־PWA ולקובץ היומן | QA | קריטריוני הקבלה למעלה |
| עבודה בערבי חג ובחול המועד, יום הזיכרון, האם כולם ב־Google Calendar | בעל המשרד | 1.3 ו־3.1 |

המחקר הזה אינו הצהרה שהמערכת נבדקה.
