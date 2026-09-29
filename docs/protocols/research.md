# מחקר: פרוטוקול עבודה בכרטיס לקוח

**תאריך:** 2026-09-29
**הוכן על ידי:** סוכן מחקר. המסמך ממליץ בלבד, וההחלטות הסופיות בידי בעל המערכת.

## השאלה

איך בונים בכרטיס הלקוח את פרוטוקול העבודה של אסטרטג: כ־35 תהליכים וכ־150 פריטי סימון, עם אחראי לכל תהליך, זמן ביצוע יחסי לאירוע עוגן, תהליכים מותנים וחוזרים, ותצוגת "מה עליי" לכל עובד בכל הלקוחות, כך שיהיה מסודר ולא יציף, בעברית (RTL), במחשב ובנייד, באתר סטטי מעל Supabase.

## שיטה ומגבלות

- חלק מהמקורות **נקראו במלואם מקוד המקור שלהם ב־GitHub**: GOV.UK Design System (task list, complete multiple tasks, checkboxes), קובץ ה־SCSS של govuk-frontend, WAI-ARIA APG (checkbox), WCAG 2.5.8, מאגר התיעוד הפתוח של Tallyfy ו־hebcal. אלה מסומנים **[נקרא]**.
- הגישה הישירה לאתרי Process Street, monday, ClickUp, Asana, Trello, Linear, Manifestly ו־NN/g נחסמה בפרוקסי של הסביבה. מה שנכתב עליהם מבוסס על **תקצירי מנוע החיפוש** של דפי העזרה הרשמיים, ולכן מסומן **[תקציר]** ומשקלו נמוך יותר. לפני שמסתמכים על פרט מסוים מהם כדאי לפתוח את הקישור.
- בכל ממצא מופיע קודם מה המקור קובע, ואחרי החץ (←) ההסקה שלי עבור אסטרטג.

---

## 1. מבנה המידע: 35 תהליכים בלי להציף

- **GOV.UK, "Complete multiple tasks"** [נקרא] ([דף](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/), [מקור](https://github.com/alphagov/govuk-design-system/blob/main/src/patterns/complete-multiple-tasks/index.md)): כשיש הרבה משימות, מחלקים אותן ל־"steps that represent stages in the process". שמות המשימות מתחילים בפועל. את עמוד המשימות מציגים "at the start of each returning session".
  ← 35 התהליכים יקובצו ל־7–8 שלבים (פתיחה, אפיון וגישות, הקמה, הכנה ליום צילום, יום צילום, הפקה ופרסום, שוטף, חידוש/סיום). כרטיס הלקוח נפתח תמיד על עמוד הפרוטוקול.
- **GOV.UK, Task list** [נקרא] ([דף](https://design-system.service.gov.uk/components/task-list/)): כל שורה כוללת שם משימה וסטטוס. כל השורה לחיצה, כי משתמשים לחצו על הסטטוס. אחרי שכמה משימות הושלמו קשה לזהות את מה שעוד לא הושלם, ולכן "Completed" מוצג כטקסט שחור בלי רקע, כדי למשוך את העין למה שדורש פעולה. טקסט עזרה רק כשיש צורך מוכח, במשפט קצר אחד.
  ← תהליך שהושלם יוצג כשורה שקטה, ורק מה שפתוח יקבל צבע. פריטי החובה (לדוגמה 11 פריטי האפיון) לא יוצגו ברשימה הראשית אלא ייפתחו בתוך התהליך.
- **Tallyfy, Milestones** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/documenting/templates/milestones.mdx)): אבני דרך מקבצות צעדים ל־"collapsible sections" ועוברות מהתבנית לתהליך הרץ.
  ← שלבים מתקפלים הם דפוס מקובל גם במוצרי תהליכים, לא רק בממשלה.
- **Tallyfy, Avoiding task debt** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tutorials/how-to/how-to-avoid-task-debt.mdx)): "Bundle related work… Fewer items means less psychological burden."
  ← תהליך הוא יחידת הסטטוס והאחריות, והפריטים הם רשימת בדיקה בתוכו. ההתקדמות מחושבת לפי תהליכים, ולא לפי 150 פריטים.
- **מדריכי onboarding של סוכנויות** [תקציר] ([Leadsie](https://www.leadsie.com/blog/essential-steps-for-agency-client-onboarding), [ALM Corp](https://almcorp.com/blog/digital-agency-client-onboarding-checklist-best-practices/)): גם הם מחלקים לשלבים (הכנה פנימית, קליטה, kickoff, גישות ונכסים, הקמה, תוצר ראשון, סקירת 30 יום). לפיהם איסוף הגישות הוא השלב שמתעכב הכי הרבה, וצריך לנהל אותו כמשימות נפרדות עם מועד.
  ← החלוקה של אסטרטג תואמת את המקובל. תהליכים 5–6 (גישות ובדיקתן) צריכים להיות בולטים בבקרה.

## 2. תפקידים, הקצאה ו"מה עליי"

- **Tallyfy, Assignment types** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/documenting/templates/edit-templates/understanding-assignment-types.mdx)): יש שלושה סוגי הקצאה: Fixed (אדם או קבוצה), Dynamic (job title, שממלאים בכל הרצה: "you pick who fills that role for that run") ו־Guest.
  ← התבנית תגדיר **תפקיד** ולא אדם ("מבצע אפיון", "כותבת תוכן", "מנהל יום צילום"). לכל לקוח נשמרת טבלת "מי ממלא איזה תפקיד". כך "אופיר או שיראל" בתהליך 4 נפתר פעם אחת, כשעירית קובעת את האפיון בתהליך 3.
- **Process Street, Role assignments** [תקציר] ([דף](https://www.process.st/help/docs/role-assignments/)): שדה "Members" בתוך ההרצה קובע מי ממלא תפקיד, וכל המשימות של התפקיד מוקצות אליו דינמית.
  ← אותו מודל כמו ב־Tallyfy: את שיוך התפקיד לאדם עושים בתוך מופע הלקוח.
- **Tallyfy, Take Over** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tutorials/how-to/make-people-accountable-for-tasks.mdx)): "When multiple people are assigned, nobody owns the task". לחיצה על Take Over מסירה את האחרים ונרשם מי לקח ומתי.
  ← לתהליכים שבהם אחד משניים מבצע באמת בפועל (15–16 "שיראל או ליאור", 6 "עילאי או שיראל"): התהליך מופיע אצל שניהם ומסומן "משותף", ויש כפתור "אני על זה" שנרשם ביומן.
- **monday, My Work** [תקציר] ([דף](https://support.monday.com/hc/en-us/articles/360019300579-My-Work)): הפריטים מקובצים ל־Past dates, Today, This week, Next week, Later ו־Without a date, עם מונה לכל קבוצה. אפשר להסתיר פריטים שבוצעו.
- **Tallyfy, Tasks view** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tracking-and-tasks/tasks-view/index.mdx)): רשימה אישית שמערבבת את כל התהליכים "by design", עם סינון לפי מצב: Overdue, Due Soon, On Time. תצוגה מקובצת לפי תהליך נמצאת במקום אחר (Tracker).
- **Asana, My Tasks** [תקציר] ([דף](https://help.asana.com/s/article/rules-in-my-tasks)): Recently assigned הוא ברירת מחדל, ואת Today/Upcoming/Later בונים עם כללים לפי תאריך יעד. **Linear, My issues** [תקציר] ([דף](https://linear.app/docs/my-issues)): הלשונית Assigned מסודרת לפי "focus order" (דחוף, SLA, חוסמים וכו').
  ← "מה עליי" תהיה רשימה אחת חוצת לקוחות, מקובצת לפי זמן: באיחור, היום, השבוע, בהמשך, ממתין (אין עדיין תאריך עוגן). כל שורה מציגה את שם הלקוח ואת התהליך. תצוגת "הכול לפי לקוח" נשארת בכרטיס הלקוח.
- **Trello, Advanced checklists** [תקציר] ([דף](https://support.atlassian.com/trello/docs/how-to-use-advanced-checklists-to-set-due-dates/)): אפשר להקצות **אדם אחד** ותאריך לפריט ברשימה, והפריטים מופיעים ב־"Your Items".
  ← זה מוכיח שאפשר להקצות גם ברמת הפריט. אצלנו רוב הפריטים שייכים למבצע התהליך, ולכן הקצאה ברמת פריט תשמש רק כחריג (למשל "עירית או ליאור בודקים את הגרפיקות" בתוך תהליך 7 של עילאי).

## 3. תאריכי יעד יחסיים, ימי עסקים ואיחור

- **Tallyfy, How a step deadline is worked out** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/documenting/templates/edit-templates/step-timings.mdx)): מועד מורכב מעוגן, פער (דקות, שעות, ימים, שבועות, חודשים) וכיוון (לפני או אחרי). "A template never holds a real date". כשהעוגן הוא צעד שעוד פתוח, סופרים ממועד היעד שלו, ואחרי שהושלם סופרים ממועד ההשלמה בפועל. "Only tasks that aren't finished yet get moved". שינוי ידני של מועד שייך למופע בלבד.
- **Tallyfy, Customize work week** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/settings/org-settings/how-to-adjust-task-deadlines-to-work-week.mdx)): מועד שנופל ביום או בשעה שאינם עבודה "always pushes it forward", וזה נכון גם לכלל מסוג "before". חגים לאומיים **לא נתמכים**.
- **Process Street, Dynamic due dates** [תקציר] ([דף](https://www.process.st/help/docs/dynamic-due-dates/)): העוגן יכול להיות תחילת ההרצה, השלמת משימה אחרת או **שדה תאריך** בטופס. אפשר לסמן "business days", ואז מועד שנופל בסוף שבוע נדחה ליום העסקים הבא.
- **Asana** [תקציר] ([דף](https://help.asana.com/s/article/project-templates)) ו־**ClickUp** [תקציר] ([דף](https://help.clickup.com/hc/en-us/articles/6326168424471-Remap-dates-in-templates)): Asana מחשבת ימים לפני או אחרי תאריך ההתחלה או הסיום של הפרויקט. ClickUp מציעה "skip weekends", אבל "not possible to skip holidays".
  ← אף מוצר לא פותר חגים. אצלנו צריך טבלת חגים משלנו.
- **hebcal** [נקרא] ([מקור](https://github.com/hebcal/hebcal-es6/blob/main/src/event.ts)): לכל אירוע יש דגלים: `CHAG` (יום טוב), `CHOL_HAMOED`, `EREV`, `MODERN_HOLIDAY` (יום העצמאות ועוד), `IL_ONLY`.
  ← מספיק לזרוע פעם בשנה טבלת `business_holidays` מתוך hebcal (דגלי CHAG, ויום העצמאות בנפרד). ערבי חג וחול המועד נשארים החלטה עסקית של המשרד ויוגדרו בטבלה. לא צריך תלות בזמן ריצה.
- **Tallyfy, Escalating overdue tasks** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tracking-and-tasks/tasks/task-escalation-for-overdue-items.mdx)): "attach escalation to the two or three steps where being late actually costs you something, so nobody gets buried in alerts about the other 37". יש הבחנה בין deadline (קובע איחור) ל־start time (המלצה בלבד).
- **GOV.UK, Complete multiple tasks** [נקרא]: "Do not use the red background colour for any status text except errors."
  ← האיחור יוצג בניסוח עובדתי ומדוד ("באיחור של יום עסקים", "היום עד 11:00"), בצבע כתום, בלי רקע אדום. אדום יישמר לכשל שמירה. התראה פעילה למנהלת תישלח רק על תהליכים קריטיים שיסומנו (חוזה, גישות, קביעת יום צילום, אישור תוכן, יום צילום), ולא על כל איחור.
- **ההסקה לגבי אירועי עוגן:** ה־SLA במסמך הפרוטוקול נסמכים על חמישה עוגנים: קבלת פרטי עסקה או חתימה, מועד פגישת האפיון (מתוכנן ובפועל), יום הצילום, השלמת תהליך קודם ("30 דקות מקבלת הגישות") ותאריך סיום החוזה. כל עוגן יישמר כשדה תאריך בלקוח, כמו שדה התאריך של Process Street. תהליך שהעוגן שלו חסר מקבל "לא ניתן להתחיל עדיין: ממתין לקביעת יום צילום" (GOV.UK: "Cannot start yet", אפור ולא לחיץ). הזזת יום צילום מחשבת מחדש רק תהליכים פתוחים. כלל עם שעה קבועה ("יום לפני הצילום ב־11:00") דורש שדה `at_time` בכלל.

## 4. תהליכים חוזרים ותהליכים מותנים

- **ClickUp, Recurring tasks** [תקציר] ([דף](https://help.clickup.com/hc/en-us/articles/6309885016471-Use-recurring-tasks)): יש שתי אפשרויות: ליצור משימה חדשה בכל מחזור, או למחזר את אותה משימה עם תאריך חדש. ההפעלה יכולה להיות "On schedule… regardless of the task's status" או עם סגירה.
- **Tallyfy, Launch via a schedule** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/launching/triggers/via-recurring-schedule.mdx)): חזרה נבנית כהשקת מופע חדש לפי cron ("Equipment Check - {date}"). **Manifestly** [תקציר] ([דף](https://www.manifest.ly/features/checklists-schedule-recurring)): הרצות יומיות, שבועיות וחודשיות, "pre-assigned to the right roles".
- **Tallyfy, Expiring tasks** [נקרא] (במקור על task debt): משימה שנסגרת מעצמה במועד כדי שלא תצטבר ברשימת האיחורים.
  ← "שיחה שבועית" ו"בקרה יומית" לא יהיו תיבות סימון בפרוטוקול החד־פעמי. הן ייווצרו **כמופעים מתוארכים** (שבוע או יום לכל לקוח פעיל) באזור "שוטף" בכרטיס, וכל מופע יוצג רק בחלון שלו. מופע שעבר בלי סימון ייסגר אוטומטית כ"לא בוצע" (ויישאר ביומן ובדוח), במקום להצטבר כאיחור. בכרטיס רואים את המופע הנוכחי ואת מונה ההיסטוריה.
- **Process Street, Conditional logic** [תקציר] ([דף](https://www.process.st/help/conditional-logic-workflows/)): מסתירים משימות כברירת מחדל ומציגים אותן לפי תשובות בטופס. יש גם הסתרה של תוכן ושדות בתוך משימה.
- **Tallyfy, Visibility actions** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/documenting/templates/automations/actions/visibility-actions.mdx)): IF field … THEN show/hide. "Hidden steps can't be completed".
- **Tallyfy, Manually show or hide tasks** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tracking-and-tasks/tasks/manually-show-hide-tasks.mdx)): הסתרה ידנית נשמרת כסטטוס `auto-skipped` ולא נמחקת, והנתונים נשמרים. אחוז ההשלמה מחושב מחדש. "Manual overrides beat automation". מומלץ להוסיף הערה.
  ← התנאים יהיו מאפיינים של הלקוח שנקבעים בתהליכים מוקדמים: `shoot_type` (נטלי / דניס־מישל־סמיון), `kickoff_by` (אופיר / שיראל), `has_logo`. כל תהליך או פריט מחזיק תנאי פשוט (שדה = ערך). כשהתנאי לא מתקיים, התהליך לא מוצג ולא נספר בהתקדמות. כך ייבנו 11ב (נטלי), "עילאי מכין לוגו", הגרסאות של תהליך 12 ותהליך 5 (אופיר מול ליאור/עירית). אם מאפיין משתנה אחרי שהתחילו לסמן, מה שכבר סומן נשמר.

## 5. תיעוד, ביטול סימון, "לא רלוונטי", הערות ומשימות אד־הוק

- **Tallyfy, Complete or reopen tasks** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tracking-and-tasks/tasks/how-can-i-complete-or-reopen-tasks-in-tallyfy.mdx)): יש Re-Open. אפשר להגביל ל־"Only assigned members can complete or edit" ("Nobody can accidentally complete someone else's work"), ו־Admins תמיד יכולים. אי אפשר להשלים משימה כשיש פריטי חובה שלא סומנו.
- **Manifestly, Skip** [תקציר] ([דף](https://help.manifest.ly/knowledge-base/can-i-skip-a-step-but-still-complete-the-checklist)): צעד שדולגו עליו נחשב סגור, "but the system recognizes it was skipped, different than being completed". אפשר לדלג על צעד או על קטע שלם.
- **Tallyfy, One-off task** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tracking-and-tasks/tasks/how-to-create-a-one-off-task-in-tallyfy.mdx)): משימה עצמאית עם שם, אחראי ו**מועד חובה**, שאפשר לקשר לתהליך רץ. **Tallyfy, template changes** [נקרא]: אפשר להוסיף one-off tasks בתוך תהליך רץ.
- **Process Street** [תקציר] ([דף](https://www.process.st/help/docs/completed-workflow-runs/)): בהרצה שהושלמה אי אפשר לשנות נתונים בלי להפעיל אותה מחדש.
  ← כל סימון, ביטול סימון, "לא רלוונטי" והערה יירשמו ביומן אירועים שאי אפשר לערוך (append-only): מי, מתי, מה ומה היה קודם. בשורה מוצג "סומן ע״י שיראל, 14:32". ביטול סימון מותר למי שסימן ולמנהלת. סימון "לא רלוונטי" דורש סיבה קצרה ונספר כסגור, אבל נראה אחרת מ"בוצע". משימה שנפתחת בשיחה השבועית היא רשומה בטבלת משימות אד־הוק שמקושרת ללקוח ולמופע השיחה, עם אחראי ומועד חובה, ומופיעה ב"מה עליי" כמו כל תהליך.

## 6. גרסאות פרוטוקול

- **Tallyfy, How template changes affect running processes** [נקרא] ([מקור](https://github.com/tallyfy/documentation/blob/main/src/content/docs/pro/tracking-and-tasks/processes/edit-processes/how-do-template-changes-affect-running-processes.mdx), [issue #244](https://github.com/tallyfy/documentation/issues/244)): "Every process that's already running keeps the version of the template it started with". הנימוק: "A new step could land before tasks people have already finished, and a step you deleted might hold data someone already entered". מה עושים במקום: מוסיפים משימה ידנית לתהליך בודד, או משתמשים ב־API לעדכון תהליכים רבים.
- **Process Street, Updates to workflow runs / Run Update Report** [תקציר] ([דף](https://www.process.st/help/docs/updates-to-workflow-runs/), [דוח](https://www.process.st/help/docs/run-update-report/)): הגישה ההפוכה. בפרסום אפשר לדחוף שינויים לכל ההרצות הפעילות או לתת למשתמשים לעדכן כל הרצה ידנית, ודוח מראה את התקדמות העדכון. הנתונים שכבר הוזנו נשמרים.
  ← אצלנו ייבחר מודל של תמונת מצב (Tallyfy), עם כלי עדכון מבוקר (Process Street). כל לקוח קשור ל־`protocol_version`. כשמתפרסמת גרסה חדשה, לקוחות קיימים לא משתנים. המנהלת יכולה להריץ "עדכן לגרסה N" על לקוח או על כמה לקוחות: פעולה שמוסיפה תהליכים ופריטים חדשים שעוד לא הגיע זמנם, מעדכנת טקסטים, ולעולם לא מוחקת פריט שסומן (פריט שהוסר מהגרסה מסומן "הוסר בגרסה N" ונשאר ביומן). הפעולה מחזירה דוח של מה נוסף ומה דולג.

## 7. ממשק בנייד: אזורי מגע, תיבות סימון ועדכון אופטימי

- **GOV.UK, Checkboxes** [נקרא] ([דף](https://design-system.service.gov.uk/components/checkboxes/), [SCSS](https://github.com/alphagov/govuk-frontend/blob/main/packages/govuk-frontend/src/govuk/components/checkboxes/_mixin.scss)): תיבה של 40px, אזור מגע של 44px (40 ועוד 4 מרווח), ותיבה קטנה של 24px. התיבה ממוקמת לצד התווית בתחילת השורה (בעברית: מימין). קבוצת תיבות עוטפים ב־`fieldset` עם `legend`. תיבות קטנות "work well on information dense screens in services designed for repeat use, like caseworking systems". לא מסמנים מראש.
- **WCAG 2.2, 2.5.8 Target Size (Minimum)** [נקרא] ([דף](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)): לפחות 24×24 CSS px, או מרווח מספיק. "For important links/controls, consider aiming for the stricter 2.5.5" (44px).
- **WAI-ARIA APG, Checkbox** [נקרא] ([דף](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/)): רווח מחליף מצב. `aria-checked="mixed"` מיועד לתיבת־אב **ששולטת** בקבוצה. קבוצה מקבלת `role="group"` עם `aria-labelledby`.
  ← משתמשים ב־`<input type="checkbox">` מקורי בתוך `<label>` שמכסה את כל השורה. במובייל אזור המגע הוא 44px לפחות, ובמחשב מותרת תיבה צפופה של 24px. סטטוס התהליך מוצג כטקסט ולא כתיבה משולשת, כי אין "סמן הכול".
- **Linear** [תקציר, מקור משני] ([ניתוח](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)): הממשק מתעדכן מיד ("optimistic updates") והשינוי נשלח לשרת ברקע.
- **NN/g, User control and freedom** [תקציר] ([דף](https://www.nngroup.com/articles/user-control-and-freedom/), [confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)): Undo עדיף על דיאלוג אישור בפעולות שגרתיות, ושימוש יתר באישורים גורם למשתמשים להפסיק לקרוא אותם.
  ← סימון מתעדכן מיד בממשק, וכתיבה ל־Supabase יוצאת ברקע. אם השמירה נכשלת, הסימון חוזר למצבו הקודם ומוצגת הודעה ב־`aria-live`. אחרי סימון מוצגת הודעה עם "בטל" לכמה שניות, בלי חלון אישור. כש־RLS דוחה סימון, זה נחשב כשל שמירה.

---

## החלטות מומלצות

1. **תמונת מצב של תבנית לכל לקוח.** טבלאות `protocol_versions`, `protocol_steps` ו־`protocol_items` לתבנית, ו־`client_steps` ו־`client_items` שמועתקות לכל לקוח בפתיחה עם `protocol_version`.
   *קבלה:* עריכה ופרסום של גרסה חדשה לא משנים אף שורה של לקוח קיים. יש בדיקה אוטומטית שמשווה לפני ואחרי.
2. **שלבים מתקפלים ו"השלב הנוכחי".** כ־8 שלבים. בראש הכרטיס שורת סיכום ("שלב 4 מתוך 8 · 17 מתוך 29 תהליכים הושלמו"). השלב הנוכחי פתוח ושאר השלבים מקופלים עם מונה. פריטי חובה נפתחים רק בתוך תהליך.
   *קבלה:* בנייד ברוחב 375px, המסך הראשון מציג את שורת הסיכום ואת כותרת השלב הנוכחי עם התהליכים הפתוחים שלו, בלי לגלול דרך שלבים שהושלמו.
3. **סטטוסים נגזרים ומעטים.** לתהליך יש ארבעה מצבים: "לא הושלם", "הושלם", "לא ניתן להתחיל עדיין" (עוגן או תלות חסרים, אפור, עם סיבה) ו"לא רלוונטי" (עם סיבה). מעליהם שכבת זמן: "היום" או "באיחור של N ימי עסקים" בכתום. תהליך הושלם כשכל פריטי החובה סומנו או סומנו כלא רלוונטיים.
   *קבלה:* אין סטטוס שנשמר ידנית ברמת התהליך. אדום משמש רק לכשל שמירה. תהליך שהושלם מוצג בטקסט רגיל בלי תג צבעוני.
4. **הקצאה לפי תפקיד ולא לפי אדם.** בכל תהליך יש `owner_role`. בכל לקוח יש `client_roles` (תפקיד לאדם). בתהליך 3 עירית בוחרת "מבצע אפיון", והבחירה מזינה את תהליכים 4 ו־5. תהליך עם שני בעלים אפשריים מופיע אצל שניהם כ"משותף", ויש כפתור "אני על זה" שנרשם ביומן.
   *קבלה:* החלפת מבצע האפיון בלקוח מעדכנת את "מה עליי" של שני העובדים בלי לגעת בתבנית. RLS מאפשר לסמן רק לבעל התפקיד ולמנהלת.
5. **"מה עליי" חוצת לקוחות.** רשימה אחת מקובצת לפי באיחור, היום, השבוע, בהמשך וממתין (אין עוגן), עם מונה לכל קבוצה. כל שורה מציגה לקוח, תהליך ומועד, ומאפשרת לסמן בה פריטים במקום.
   *קבלה:* פונקציית RPC אחת מחזירה את כל הרשימה לעובד. העובד רואה רק את מה שהוקצה לו או לתפקיד שלו.
6. **עוגנים כשדות תאריך בלקוח.** `signed_at`, `kickoff_at`, `shoot_at`, `contract_end_at`, ועוגן מסוג "השלמת תהליך X". הכלל של כל תהליך: עוגן, היסט, יחידה (דקות, שעות, ימי עסקים, ימים), כיוון, ושעה קבועה אופציונלית. שינוי עוגן מחשב מחדש רק תהליכים פתוחים. מועד שנקבע ידנית נשמר בנפרד וגובר.
   *קבלה:* הזזת יום צילום משנה את מועדי תהליכים 15–16 הפתוחים ולא נוגעת בתהליכים שהושלמו. עוגן חסר מציג "ממתין ל…".
7. **ימי עסקים ישראליים בשרת.** פונקציית Postgres `add_business_days(ts, n)`: ימים א׳–ה׳, דילוג על טבלת `business_holidays` שנזרעת שנתית מ־hebcal (יום טוב ויום העצמאות; ערבי חג וחול המועד לפי החלטת המשרד). מועד שנופל מחוץ לשעות עבודה נדחה קדימה בלבד. היסט בשעות נספר בזמן שעון ואז מגולגל לחלון העבודה הבא.
   *קבלה:* בדיקות יחידה: אפיון ביום ה׳ ועוד 3 ימי עסקים נותן יום ג׳. יום לפני צילום של יום א׳ ב־11:00 נותן יום ה׳ ב־11:00 (בהנחה ש"יום לפני" פירושו יום העסקים הקודם; צריך לאשר מול המשרד). מועד שנופל בחג נדחה ליום העסקים הבא.
8. **תהליכים מותנים כמאפייני לקוח.** `shoot_type`, `kickoff_by` ו־`has_logo` נקבעים בתהליכים מוקדמים. לכל תהליך או פריט יש `condition` פשוט (שדה = ערך). תהליך שהתנאי שלו לא מתקיים לא מוצג ולא נספר. הסתרה ידנית דורשת סיבה.
   *קבלה:* לקוח עם יום צילום של דניס/מישל/סמיון לא רואה את 11ב ואת פריטי נטלי. שינוי `shoot_type` אחרי סימון לא מוחק סימונים.
9. **חוזרים כמופעים מתוארכים.** שיחה שבועית ובקרה יומית נוצרות כמופע לכל לקוח פעיל לכל שבוע או יום (pg_cron או יצירה עצלה בכניסה). מופע שחלונו עבר בלי סימון נסגר כ"לא בוצע", נשמר בדוח ולא נערם כאיחור.
   *קבלה:* בכרטיס מוצג מופע אחד נוכחי ומונה היסטוריה. אחרי שבוע של היעדרות אין שבעה איחורים של בקרה יומית ב"מה עליי".
10. **יומן אירועים שאי אפשר לערוך, ומשימות אד־הוק.** `item_events` מתעד check, uncheck, not_applicable, note ו־claim עם `actor` ו־`at`. אפשר רק להוסיף שורות, ו־RLS חוסם עדכון ומחיקה. ביטול סימון מותר לסומן ולמנהלת. משימות שנפתחות בשיחה השבועית נשמרות ב־`client_tasks` (אחראי, מועד חובה, מקור).
    *קבלה:* לכל פריט אפשר לשחזר מי סימן, מתי ומי ביטל. משימה שנפתחה בשיחה מופיעה ב"מה עליי" של האחראי.
11. **עדכון גרסה מבוקר.** הפעולה "עדכן לקוח לגרסה N" מוסיפה תהליכים ופריטים חדשים ומעדכנת טקסטים, ולא מוחקת פריט שסומן. היא מחזירה דוח של מה נוסף, מה עודכן ומה דולג.
    *קבלה:* הרצה כפולה לא יוצרת כפילויות (idempotent). פריט שסומן ונמחק מהגרסה נשאר עם תווית "הוסר בגרסה N".
12. **תיבות סימון נגישות ועדכון אופטימי.** `input type=checkbox` מקורי בתוך `label` שמכסה את כל השורה, כל תהליך ב־`fieldset`/`legend`, ואזור מגע של 44px לפחות בנייד (24px מותר במחשב). הממשק מתעדכן מיד, יש הודעת "בטל" במקום אישור, בכשל הסימון חוזר למצבו עם הודעה ב־`aria-live`, ובקרת המנהלת מציגה איחורים לפי עובד ולפי לקוח.
    *קבלה:* ניווט מקלדת (Tab ורווח) עובד בכל הכרטיס, בדיקת axe ללא שגיאות, סימון נראה תוך פחות מ־100ms גם ברשת איטית, וכשל מדומה ב־Playwright מחזיר את הסימון למצבו הקודם.
