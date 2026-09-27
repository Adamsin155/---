# מחקר — מערכת התשלומים החודשית

תאריך: 27 בספטמבר 2026. היקף: חוויית "אפליקציה" באתר סטטי, פריסה לטלפון ולמחשב, נגישות, אבטחת נתוני שכר ועמלות, ונכונות כספית. המסמך משלים את [כללי החישוב](rules.md) ואינו חוזר עליהם. אין בו סכומים, אחוזים או שמות.

**שיטה ומגבלות.** הגישה הישירה ל־MDN, ‏W3C, ‏web.dev, ‏WebKit, ‏gov.il, נבו ואיגוד האינטרנט נחסמה בפרוקסי של סביבת העבודה. לכן:
- את MDN, ‏WCAG 2.2, ‏W3C i18n, ‏GOV.UK Design System, ‏Material ו־GitHub Docs קראתי **מתוך מאגרי המקור הרשמיים שלהם ב־GitHub** (אותו תוכן שמתפרסם בעמודים). הקישורים שלמטה מפנים לעמודים המתפרסמים.
- את התיעוד של Supabase קראתי דרך כלי החיפוש הרשמי בתיעוד שלהם.
- את בלוג WebKit ואת התקנות הישראליות **לא הצלחתי לפתוח**. ראיתי רק תקצירי תוצאות חיפוש, והם מסומנים **[לא נפתח]**. אין להסתמך עליהם בלי אימות.
- **נצפה**: מה שהרצתי בפועל (Node 22.22, ‏ICU 78.2). **הסקה**: מסקנה שלי ולא קביעה של המקור.

---

## 1. "כמו אפליקציה" באתר סטטי (PWA)

**מה המקורות קובעים**
- כדי שדפדפני Chromium יציעו התקנה, המניפסט צריך לכלול `name` או `short_name`, ‏`icons` עם 192px ו־512px, ‏`start_url`, ‏`display` ו־`prefer_related_applications` שאינו `true`. נדרש HTTPS. **service worker אינו תנאי להתקנה.** ב־Android רק Chrome (עם GMS) ו־Samsung Internet מתקינים אפליקציה אמיתית (WebAPK). ב־iOS 16.4 ומעלה אפשר להתקין מתפריט השיתוף ב־Safari, ‏Chrome, ‏Edge, ‏Firefox ו־Orion. `beforeinstallprompt`, כלומר כפתור "התקנה" משלנו, לא נתמך ב־iOS. [MDN — Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- `scope` נבדק **כהתאמת תחילית של מחרוזת**, ולא לפי מבנה תיקיות: ‏`/prefix` תואם גם את `/prefix-of/`. בלי `scope` הוא נגזר מ־`start_url`. ניווט אל מחוץ ל־scope אינו נחסם, אבל הדפדפן מציג שורת כתובת. [MDN — scope](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope). ‏`id` מזהה את האפליקציה. בלעדיו משמש `start_url`, ושינוי שלו אחר כך יוצר "אפליקציה אחרת". [MDN — id](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
- ה־scope של service worker הוא כברירת מחדל התיקייה שבה נמצא הקובץ שלו. הרחבה מעבר לתיקייה מחייבת כותרת HTTP ‏`Service-Worker-Allowed`. [MDN — register()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
- service worker שהותקן מופעל גם אם המשתמש לא התקין את האפליקציה. ל־Cache API אין תפוגה: התוכן נשאר עד שהקוד מוחק אותו. אסטרטגיית "מטמון קודם" לא מתעדכנת עד גרסה חדשה של ה־worker, ובקשות POST אינן מתאימות למטמון. [MDN — Caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)
- נתוני התאימות של MDN (browser-compat-data) קובעים: ‏`display` (כולל `standalone`) ו־`scope` נתמכים ב־Safari iOS מגרסה 11.3. ‏`icons` מהמניפסט נתמך מגרסה 15.4, **"רק כשאין `apple-touch-icon`"**. לכן `apple-touch-icon` גובר ב־iOS.
- `viewport-fit=cover` מרחיב את הדף אל שולי המסך, ו־MDN ממליץ ללוות אותו ב־`env(safe-area-inset-*)`. [MDN — viewport](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), [MDN — env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- GitHub Pages: אתר פרויקט מתפרסם ב־`<owner>.github.io/<repo>`. [GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). **הסקה:** כל אתרי הפרויקטים של אותו חשבון חולקים מקור (origin) אחד, ולכן גם `localStorage` אחד. [MDN — localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) קובע שהאחסון שייך למקור.
- **[לא נפתח]** WebKit: מאז iOS 16.4 מניפסט עם `display: standalone` הופך את האתר ל"אפליקציית מסך בית", ומאז iOS 26 כל אתר שמוסף למסך הבית נפתח כאפליקציה כברירת מחדל. לאפליקציית מסך בית יש אחסון נפרד מ־Safari, והיא פטורה ממחיקת האחסון אחרי 7 ימים בלי שימוש ב־Safari. [WebKit — Web Push for Web Apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit — Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [WebKit — Full Third-Party Cookie Blocking](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)

**הסקה.** מקור משותף מחייב לתחום את המודול בתיקייה משלו. אחרת ההתקנה או ה־worker עלולים לתפוס את `q.html` (הקישור ללקוח) ואת `index.html`. ה־worker אינו נחוץ להתקנה, והוא מוסיף שני סיכונים בכלי כספי: קוד חישוב ישן שמוגש מהמטמון אחרי תיקון, ונתונים רגישים שנשארים על המכשיר. ב־iOS הבעלים יתחבר פעם אחת בתוך האפליקציה המותקנת, כי האחסון שלה נפרד (לאמת בבדיקה).

**החלטה מומלצת.** המודול יושב ב־`/---/payouts/` עם מניפסט משלו (`id`, ‏`start_url` ו־`scope` כולם `/---/payouts/`, **עם לוכסן סוגר**), ‏`display: standalone`, אייקונים 192 ו־512, ‏`apple-touch-icon` ו־`viewport-fit=cover` עם safe-area. **בשלב ראשון אין service worker.** אם יתווסף בהמשך, הוא ישב בתוך `/---/payouts/`, יטפל רק בניווט ובקבצים סטטיים מאותו מקור לפי "רשת קודם", ויציג עמוד "אין חיבור". לעולם לא ייגע בבקשות ל־Supabase ולא ישמור נתונים.

**קריטריון קבלה.** ב־DevTools של Chrome ‏(Application → Manifest) המניפסט תקין ואין שגיאות התקנה. ב־Service Workers אין רישום בכלל, גם לא בעמודי הצעות המחיר. באייפון אמיתי, "הוספה למסך הבית" פותחת בלי שורת כתובת, עם האייקון הנכון, ושום תוכן לא נחתך תחת ה־notch או פס הבית. מעבר מהאפליקציה ל־`q.html` מציג שורת כתובת.

---

## 2. פריסה לטלפון ולמחשב

**מה המקורות קובעים**
- Material: סרגל ניווט תחתון מתאים ל־3–5 יעדים, עם אייקון ותווית, בחלונות צרים ובינוניים. במסכים גדולים מחליף אותו navigation rail. [Material — Navigation bar](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md), [Navigation rail](https://github.com/material-components/material-components-android/blob/master/docs/components/NavigationRail.md)
- מספרים: לשלמים `inputmode="numeric"`, לעשרוניים `inputmode="decimal"`. **לא** להשתמש ב־`type="number"`, שבו גלילה משנה ערך בטעות ואין משוב על קלט שגוי. מקלדות מסוימות לא מציגות מינוס, ולכן ערך שלילי דורש `type="text"` בלי `inputmode`. [GOV.UK — Text input](https://design-system.service.gov.uk/components/text-input/). ‏`inputmode` הוא רמז למקלדת ולא ולידציה. [MDN — inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode)
- תאריכים: בוחר בסגנון לוח שנה מתאים לתאריך בעבר הקרוב, אבל תמיד לצד אפשרות להקליד. [GOV.UK — Dates](https://design-system.service.gov.uk/patterns/dates/). GOV.UK ממליץ להתחיל ב"שאלה אחת בכל עמוד". [GOV.UK — Question pages](https://design-system.service.gov.uk/patterns/question-pages/)
- טבלאות: עמודות מספרים מיושרות לצד אחד. כשיש הרבה נתונים, עדיף לפצל לכמה טבלאות. [GOV.UK — Table](https://design-system.service.gov.uk/components/table/). ‏WCAG 1.4.10 פוטר טבלאות נתונים מגלילה דו־ממדית, "אבל לא תאים בודדים". הדוגמה שעוברת היא טבלה **בתוך מיכל גלילה משלה**, כשהכותרת והטקסט סביבה נשארים ברוחב 320px. [Understanding 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)

**הסקה.** GOV.UK כותבים לציבור שממלא טופס פעם אחת. בעל העסק מזין עסקאות שוב ושוב, ולכן טופס אחד קצר עם ברירות מחדל מהיר יותר מאשף בשלבים. דוח "כמה לשלם לכל אחד" הוא בעיקרו זוג (אדם, סכום), ולכן רשימה מתאימה לו יותר מטבלה. לוח העסקאות הרחב הוא טבלה אמיתית.

**החלטה מומלצת.**
- **ניווט:** עד 760px סרגל תחתון עם 4 יעדים (החודש, עסקאות, אנשים והוצאות, הגדרות) וכפתור "עסקה חדשה" בולט. מעל 760px סרגל צד עם אותם יעדים. זו אותה נקודת שבירה כמו ב־`app.css` הקיים.
- **הזנת עסקה:** טופס אחד. התאריך הוא `<input type="date">` עם ברירת מחדל של היום. איש המכירות מתמלא לפי העסקה הקודמת. אם העסקה נוצרת מהצעה חתומה, החבילה, התוספות וההנחה מתמלאות ממנה. סכומים ב־`inputmode="decimal"`. אחוזים ומשכורות נקבעים רק במסך ההגדרות, לא בטופס. מתחת לטופס מוצג סיכום חי: שווי העסקה, בסיס העמלה והעמלה.
- **דוח חודשי בטלפון:** רשימת כרטיסים, אדם וסכום לכל כרטיס, ממוינת לפי סוג (עמלות, הפקה, משכורות, הוצאות, שותפים). פירוט לפי עסקה נפתח ב־`<details>`. שורת "סה״כ לתשלום" קבועה מעל הסרגל התחתון.
- **טבלת עסקאות:** `<table>` עם `<caption>` ו־`<th scope="row">` (שם הלקוח), בתוך מיכל עם `role="region"`, ‏`aria-labelledby`, ‏`tabindex="0"` ו־`overflow-x:auto`. עמודת הכותרת דביקה, ומספרים ב־`tabular-nums` מיושרים לאותו צד.

**קריטריון קבלה.** ברוחב 320px ובזום 400% אין גלילה אופקית בעמוד, אלא רק בתוך מיכל הטבלה, שנגלל גם במקלדת. הזנת עסקה טיפוסית בטלפון מסתיימת בלי להקליד תאריך ובלי מקלדת אותיות בשדות הסכום. בדוח החודשי בטלפון כל סכום מופיע באותו כרטיס עם שם המקבל, בלי צורך לגלול הצידה.

---

## 3. נגישות

**מה המקורות קובעים (WCAG 2.2, נוסח נורמטיבי)** — [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- **2.5.8 (AA):** מטרת הצבעה בגודל 24×24 פיקסלי CSS לפחות, או מרווח שעיגול בקוטר 24 סביב המטרה לא חותך מטרה אחרת. יש חריגים: קישור בתוך טקסט, פקד של הדפדפן, או פקד חלופי זמין.
- **2.4.11 (AA):** רכיב שמקבל פוקוס לא מוסתר **כולו** על ידי תוכן שהמחבר יצר. ב־Understanding כותרת ותחתית דביקות הן הדוגמה המרכזית, והפתרון המוצע הוא `scroll-padding`. [Understanding 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- **3.3.7 (A):** מידע שכבר הוזן באותו תהליך מתמלא אוטומטית או זמין לבחירה. **3.3.8 (AA):** לא דורשים מבחן קוגניטיבי בכניסה, אלא אם יש מנגנון עזר, למשל מנהל סיסמאות או הדבקה.
- **3.3.1 (A) ו־3.3.3 (AA):** שגיאה מזוהה ומתוארת בטקסט, עם הצעה לתיקון. **3.3.4 (AA):** בפעולה שמשנה נתונים שמורים, הפעולה הפיכה, נבדקת או מאושרת לפני סיום. **4.1.3 (AA):** הודעת סטטוס מוכרזת בלי להעביר אליה פוקוס.
- תאימות: "תוכן שעומד ב־WCAG 2.2 עומד גם ב־2.0 וב־2.1", וסעיף 4.1.1 הוסר. [WCAG 2.2 — מבוא](https://www.w3.org/TR/WCAG22/)
- אזורים חיים: `role="status"` שקול ל־`aria-live="polite"` עם `aria-atomic="true"`. יוצרים את האזור ריק מראש, ורק אחר כך מעדכנים אותו. `assertive` שמור למקרים דחופים. [MDN — Live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions), [MDN — status](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role). ‏`aria-invalid="true"` נקבע רק אחרי ולידציה, ותמיד עם הודעה. [MDN — aria-invalid](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid). סיכום שגיאות בראש הטופס מקבל פוקוס ומקשר לכל שדה שגוי, ולפני כל הודעה מופיע "שגיאה:" נסתר. [GOV.UK — Error summary](https://design-system.service.gov.uk/components/error-summary/), [Error message](https://design-system.service.gov.uk/components/error-message/)
- דו־כיווניות: לטקסט שהכיוון שלו לא ידוע מראש עוטפים ב־`<bdi>` או ב־`dir="auto"`. מאפיין `dir` על אלמנט גם מבודד אותו מהטקסט שסביבו. [W3C — Inline markup and bidirectional text](https://www.w3.org/International/articles/inline-bidi-markup/)
- **נצפה:** ‏`Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'})` מחזיר מחרוזת עם תווי כיוון בלתי נראים: RLM ‏(U+200F) לפני המספר ולפני ₪, ו־LRM לפני סימן מינוס, ורווח קשיח לפני ₪. לדוגמה `‏1,234.50 ‏₪`. המערכת הקיימת משתמשת ב־`formatILS` (מספר + " ₪", בתוך `span dir="ltr"`) ולא בסגנון currency.
- **[לא נפתח]** תקנה 35 לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), תשע״ג־2013: לפי תקצירי החיפוש, התקנה חלה על אתר שנותן שירות או מידע על שירות **לציבור**, ברמת AA לפי ת״י 5568. [נבו](https://www.nevo.co.il/law_html/law01/500_865.htm), [איגוד האינטרנט](https://www.isoc.org.il/freedom-of-internet/accessibility/rules-and-regulations-accessibility-internet)

**הסקה.** כלי פנימי שרק הבעלים רואים הוא כנראה לא "שירות לציבור", אבל הבעלים עצמם עשויים להזדקק להתאמות. **לא אימתתי** את נוסח התקנה, את גרסת ת״י 5568 ואת גרסת ה־WCAG שהוא מאמץ. זו שאלה לעוזר המשפטי. היעד המעשי הוא WCAG 2.2 AA, שמכסה ממילא 2.0 ו־2.1. תווי הכיוון מ־`Intl` שוברים השוואות מחרוזות בבדיקות והעתקה לגיליון. לכן עדיף מנגנון עיצוב אחד לכל המערכת.

**החלטה מומלצת.** יעד WCAG 2.2 AA, והקפדה על הנקודות האלה:
- **מטרות מגע:** לפחות 44px בסרגל התחתון ובכפתורים, כמו `min-height` של 46–48 ב־`app.css`. בשום מקרה פחות מ־24.
- **פוקוס:** ‏`scroll-padding-bottom` בגובה הסרגל התחתון ושורת הסה״כ, כמו `scroll-padding-top` הקיים.
- **סכומים:** כל סכום עובר דרך `formatILS` הקיים בתוך `<span class="num" dir="ltr">`. מינוס מוצג כמילה ("החזר", "הפסד") ולא רק כסימן.
- **עדכון חי:** אזור `role="status"` אחד בסיכום של הטופס, שמתעדכן רק כשיוצאים משדה ולא בכל הקשה. דוח החודש עצמו אינו אזור חי.
- **שגיאות:** סיכום שגיאות עם קישורים, ‏`aria-invalid` ו־`aria-describedby` לכל שדה.
- **כניסה:** ‏`autocomplete="username"` ו־`autocomplete="current-password"`, בלי חסימת הדבקה, כמו ב־`quotes.html`.
- **סגירת חודש:** מסך אישור (3.3.4).

**קריטריון קבלה.**
- בדיקת axe: אין הפרות. שם החלון לא מוסתר.
- מעבר עם Tab בטלפון ובמחשב: אף פקד בפוקוס לא מוסתר כולו מאחורי הסרגל.
- כל מטרת מגע גדולה או שווה ל־24px (נמדד).
- ב־VoiceOver וב־NVDA:
  - שינוי בשדה מכריז פעם אחת על העמלה המחושבת.
  - שליחה שגויה מעבירה פוקוס לסיכום השגיאות.
  - סכום נקרא כמספר תקין עם ₪.
- **רק אחרי בדיקה חוזרת:** לפני שמצהירים על עמידה בתקן הישראלי, העוזר המשפטי מאמת את תחולת תקנה 35.

---

## 4. אבטחה ופרטיות על ריפו ציבורי

**מה המקורות קובעים (Supabase)**
- RLS **חייב** להיות פעיל בכל טבלה בסכמה חשופה (ברירת המחדל: `public`). טבלה שנוצרת ב־SQL לא מקבלת RLS אוטומטית. כש־RLS פעיל ואין מדיניות, אין גישה. מדיניות ל־UPDATE מחייבת גם מדיניות SELECT. כדאי לציין `to authenticated` בכל מדיניות. [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- פונקציית `security definer` רצה בהרשאות היוצר ועוקפת RLS. **"לעולם אין ליצור פונקציות security definer בסכמה חשופה."** כשפונקציה כזו נקראת מתוך מדיניות, עוטפים אותה ב־`(select ...)` לביצועים. ‏`user_metadata` ניתן לשינוי בידי המשתמש ואסור להסתמך עליו להרשאות. ‏`app_metadata` לא ניתן לשינוי, אבל ה־JWT לא תמיד מעודכן. Views עוקפים RLS אלא אם הוגדרו עם `security_invoker = true`. מפתח service אסור בדפדפן. [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- בפוסטגרס כל פונקציה חדשה ניתנת להרצה ב־`PUBLIC` כברירת מחדל, ו־Supabase מוסיפה הרשאה ל־`anon` ול־`authenticated`. לכן פונקציית `security definer` ב־`public` נגישה לכל משתמש מחובר דרך `/rest/v1/rpc/<name>`. התיקון הוא `revoke execute ... from public, anon, authenticated`, או להעביר את הפונקציה מהסכמה החשופה. [Supabase — Lint 0029](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable), [Lint 0028](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0028_anon_security_definer_function_executable)
- אפשר לדרוש MFA במדיניות מגבילה (`as restrictive ... (select auth.jwt()->>'aal') = 'aal2'`). [Supabase — RLS / MFA](https://supabase.com/docs/guides/database/postgres/row-level-security). הסשן נשמר ב־local storage או בעוגיות. אפשר להגביל את משך הסשן ולהגדיר תפוגה אחרי חוסר פעילות (בתוכנית Pro ומעלה). [Supabase — Sessions](https://supabase.com/docs/guides/auth/sessions)

**ממצא מקריאת הקוד.** `public.is_staff()` הקיימת היא `security definer` בסכמה החשופה, וניתנת להרצה ל־`authenticated`. זה מכוון (היא מחזירה רק בוליאני על המשתמש עצמו) ולכן מקרה "Option 3" בתיעוד. אבל **אין להעתיק את הדפוס** לתפקיד הבעלים. ‏`supa.js` שומר את הסשן ב־`localStorage` (`persistSession: true`).

**הסקה.** בגלל המקור המשותף ב־`adamsin155.github.io`, כל עמוד באתר פרויקט אחר של אותו חשבון יכול לקרוא את טוקן הסשן של הבעלים. דוגמה: המאגר `landing`, אם הוא מתפרסם ב־Pages. RLS לא מגן מפני טוקן גנוב. עם הבעלים עובד רק בידוד מקור: דומיין מותאם לאתר הזה, למשל תת־דומיין של החברה, או הקפדה שאין אתר Pages אחר בחשבון. בנוסף, ריפו ציבורי אומר שגם המיגרציות, הבדיקות וצילומי המסך ציבוריים. [כללי החישוב](rules.md) כבר קובעים שהערכים נשמרים רק ב־Supabase ובקובץ פרטי מוחרג.

**החלטה מומלצת.**
- **טבלת בעלים:** טבלה `owners (user_id uuid primary key references auth.users)`, נפרדת מ־`staff`, לפי `user_id` ולא לפי אימייל.
- **פונקציית בדיקה:** ‏`private.is_owner()` כ־`security definer` עם `set search_path = ''`, בסכמה `private` שאינה חשופה. למדיניות נותנים `usage` על הסכמה ו־`execute` רק ל־`authenticated`.
- **טבלאות המודול:** בכל אחת RLS, עם מדיניות נפרדת לכל פעולה, `to authenticated` ו־`using ((select private.is_owner()))`. ל־`anon` לא ניתנת שום הרשאה.
- **זיהוי בעלים בדפדפן:** בדיקה אם קיימת שורה ב־`owners` עבור המשתמש, לפי מדיניות "רואה את השורה של עצמו". לא דרך RPC חדש ב־`public`.
- **בלי views** על נתונים רגישים. אם בכל זאת נדרש view, הוא מוגדר עם `security_invoker = true`.
- **הגנות נוספות:**
  - מומלץ: MFA לבעלים עם מדיניות `restrictive` של `aal2`.
  - אם התוכנית מאפשרת: תפוגת סשן אחרי חוסר פעילות.
  - ביציאה נמחק הסשן מהאחסון.
- **ריפו ציבורי:** אין ערכים בקוד, במיגרציות, ב־seed, בבדיקות או בצילומי מסך. בבדיקות משתמשים בנתונים מלאכותיים.
- **בידוד מקור:** שאלה לבעל העסק. לפני העלאת נתונים אמיתיים צריך לבחור דומיין מותאם, או לאשר שאין אתר Pages אחר בחשבון.

**קריטריון קבלה.** Security Advisor של Supabase לא מציג ממצאים על טבלאות ופונקציות המודול. בבדיקה אוטומטית מול הפרויקט:
- ‏`anon` ומשתמש שנמצא רק ב־`staff` מקבלים 0 שורות ושגיאת הרשאה ב־select, ‏insert, ‏update, ‏delete ו־rpc על כל טבלאות המודול.
- בעלים מקבל גישה מלאה.

בנוסף, חיפוש בריפו (`git grep`) אחר ערכים מהקובץ הפרטי מחזיר 0 תוצאות.

---

## 5. נכונות כספית ונעילת חודש

**מה המקורות קובעים**
- מספר ב־JavaScript הוא double. שלמים מדויקים רק עד 2^53−1 (`Number.MAX_SAFE_INTEGER`). [MDN — Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)
- `Math.round` מעגל חצי **כלפי +∞**, כך ש־`Math.round(-5.5)` שווה ‎-5. זה שונה מ"חצי הרחק מאפס" המקובל בשפות אחרות. [MDN — Math.round](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round)
- ב־Postgres, ‏`round(numeric)` שובר שוויון **הרחק מאפס**. ב־double התוצאה תלויה בפלטפורמה. [PostgreSQL — Math functions](https://www.postgresql.org/docs/current/functions-math.html)

**הסקה.** לסכומים חיוביים שלוש השיטות מסכימות על "חצי כלפי מעלה", שנקבע ב[כללים](rules.md). בסכומים שליליים, כמו הפסד שמתחלק בין שותפים או תיקון, JS ו־SQL ייתנו תוצאה שונה. לכן החישוב צריך להיות במקום אחד בלבד. בחלוקה לשותפים, עיגול של כל חלק בנפרד לא תמיד מסתכם לרווח (שארית של אגורה). הדפוס הקיים במערכת (`pricing.js` משמש גם את הדפדפן וגם את `create-quote`) הוכיח את עצמו.

**החלטה מומלצת.**
- **מנוע חישוב אחד:** מודול JS טהור (למשל `app/payouts-calc.js`) שמשמש לתצוגה מקדימה בדפדפן וגם ב־Edge Function ‏`close-month`. הפונקציה רצה עם ה־JWT של הבעלים (RLS חל) ושומרת את התוצאה. אין חישוב שני ב־SQL.
- **כללי חישוב:**
  - אגורות ונקודות בסיס כשלמים.
  - מכפלה ואחר כך חלוקה עם עיגול "חצי הרחק מאפס" מפורש, ולא `Math.round`.
  - בדיקה שכל ביניים קטן מ־2^53.
  - חלוקת רווח (או הפסד) לשותפים בשיטת **השארית הגדולה**, עם שובר שוויון קבוע, כך שסכום החלקים שווה בדיוק לרווח.
- **מבנה נתונים (עיקרון):**

| טבלה | תפקיד | נעילה |
|---|---|---|
| `payees` | אנשים וספקים: סוג (מכירות, משפיען, צלם, עובד, שותף, ספק) | — |
| `settings_versions` | אחוזים, עלויות רכיבים ועלויות הפקה, עם `effective_from` | שורות לא נערכות. שינוי הוא גרסה חדשה |
| `deals` | עסקה: ‏`closed_on date`, חבילה, תוספות, הנחה, צ׳ופרים, איש מכירות, `quote_id` אופציונלי, ו**עותק** של האחוזים והעלויות בתוקף | נחסמת לעריכה כשהחודש שלה סגור |
| `extra_income` | הכנסה נוספת לפי חודש קבלה | כמו `deals` |
| `month_costs` | משכורות והוצאות לכל חודש, מועתקות מהחודש הקודם | כמו `deals` |
| `periods` | חודש (`YYYY-MM-01`), סטטוס פתוח או סגור, מי סגר ומתי, טביעת SHA-256 | — |
| `payout_lines` | תמונת מצב: מקבל, סוג, סכום באגורות, פירוט (jsonb) | אי אפשר לשנות אותה (טריגר, כמו `quotes_freeze_model`) |
| `adjustments` | תיקון שמפנה לשורה מקורית ונרשם בחודש פתוח | — |

- העותק ב־`deals` נלקח **בשרת** בזמן ההכנסה: טריגר קורא את הגרסה שבתוקף ב־`closed_on`. כך שינוי אחוז בעתיד לא משנה עסקה קיימת, והעבר נשמר גם אם יש באג בדפדפן.
- אם החודש נפתח מחדש, כפי שהכללים מאפשרים, הפתיחה נרשמת עם סיבה. סגירה חוזרת יוצרת תמונת מצב חדשה, והקודמת נשמרת.

**קריטריון קבלה.**
- בדיקות `node --test` עם נתונים מלאכותיים מכסות:
  - חודשים של 28, 29, 30 ו־31 ימים.
  - עסקה ביום האחרון בחודש.
  - הפסד שמתחלק בין השותפים.
  - סכום שורות ששווה לסך בכל דוח.
  - שינוי אחוז אחרי סגירת חודש, שמשאיר את `payout_lines` זהים עד האגורה (אותה טביעה).
- כל ניסיון לערוך עסקה או שורה בחודש סגור נכשל בשרת.
- מקרה הקבלה מהקובץ הפרטי רץ מקומית ומשחזר את האקסל.

---

## החלטות ליישום

| עדיפות | החלטה | ראיית קבלה |
|---|---|---|
| ראשונה | טבלת `owners` נפרדת, `private.is_owner()` בסכמה לא חשופה, RLS לכל פעולה בכל טבלה, בלי הרשאות ל־`anon` | בדיקת הרשאות: ‏`anon` ו־`staff` נכשלים בכל פעולה. ב־Security Advisor אין ממצאים על טבלאות ופונקציות המודול |
| ראשונה | אין ערכים עסקיים בריפו. בבדיקות רק נתונים מלאכותיים | ‏`git grep` על ערכי הקובץ הפרטי מחזיר 0 |
| ראשונה | מנוע חישוב JS אחד לדפדפן ול־Edge Function. אגורות, נקודות בסיס, עיגול מפורש ושארית גדולה לשותפים | ‏`npm test` עובר, כולל הפסד וחודשים של 28–31 ימים. סכום השורות שווה לסך |
| ראשונה | עותק של הגדרות לכל עסקה (טריגר בשרת), נעילת חודש ו־`payout_lines` שאי אפשר לשנות | שינוי אחוז אחרי סגירה לא משנה את טביעת החודש. עריכה בחודש סגור נדחית בשרת |
| שנייה | מודול ב־`/---/payouts/` עם מניפסט עם scope מפורש ו־`apple-touch-icon`. בלי service worker בשלב ראשון | מניפסט תקין ב־DevTools. אין רישום SW. התקנה באייפון וב־Android נפתחת במסך מלא. ‏`q.html` לא בתוך ה־scope |
| שנייה | ניווט תחתון בטלפון וסרגל צד במחשב. טופס עסקה אחד עם ברירות מחדל ומילוי מהצעה חתומה | הזנת עסקה בטלפון בלי להקליד תאריך. ‏`inputmode` נכון. אין גלילה אופקית ב־320px |
| שנייה | דוח חודשי ככרטיסים בטלפון. טבלת עסקאות במיכל גלילה נגיש | כל סכום באותו כרטיס עם שם המקבל. המיכל נגלל במקלדת ויש לו שם |
| שנייה | WCAG 2.2 AA: מטרות מגע, ‏`scroll-padding` מול הסרגל, `role="status"` בסיכום, סיכום שגיאות, אישור לפני סגירת חודש | axe נקי. VoiceOver ו־NVDA מכריזים על העמלה פעם אחת. פוקוס לא מוסתר |
| שלישית | בידוד מקור (דומיין מותאם) ו־MFA לבעלים | החלטה של בעל העסק מתועדת לפני העלאת נתונים אמיתיים |
| שלישית | אימות משפטי של תקנה 35 ות״י 5568 לכלי פנימי | חוות דעת של העוזר המשפטי ב־`docs/legal/` |

**שאלות שחוזרות לבעל העסק**, בנוסף לשאלות הפתוחות ב[כללים](rules.md):
- האם להפריד את האתר לדומיין משלו?
- האם לחייב MFA?
- איך מטפלים בחודש הפסדי: חלוקת הפסד או העברה לחודש הבא?
