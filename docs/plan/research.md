# מחקר רקע לתוכנית המערכת

> שישה דוחות מחקר מ־29.9.2026 שעליהם נשענת [התוכנית](system-plan.md). נכתבו באנגלית על ידי סוכני המחקר. חלק מהאתרים נחסמו לגישה ישירה, ולכן חלק מהמספרים (בעיקר מחירים) מבוססים על תקצירי חיפוש ומסומנים ככאלה. מחירים יאומתו לפני כל שלב שתלוי בהם.


---

# How agency platforms organise client delivery, and what Astrateg should copy

**Method note:** this session's network policy blocked direct fetches of monday.com, clickup.com, asana.com, productive.io and developers.facebook.com. The facts below come from search-indexed official help and pricing pages where possible. Where a fact comes from a third-party site, it says so. Prices are list USD per user per month, billed annually, unless stated. Anything I could not confirm is marked [unverified].

---

## 1. Bottom line

- **Build, don't buy.** Keep Astrateg's own system (GitHub Pages + Supabase) and copy the proven patterns from the big tools. Three reasons:
  1. None of the three biggest tools (monday, ClickUp, Asana) has a Hebrew interface with full right-to-left layout (section 3).
  2. Astrateg's protocol is very specific: role rules such as "Nirel edits Natali's videos only", business-day deadlines, and Sunday–Thursday weeks with Israeli holidays.
  3. The client card, "my work", daily control, escalations and access vault already exist. Moving tools would mean rebuilding them and retraining everyone.
- **What's missing** is the machinery the best tools share:
  - a protocol template engine: one master blueprint, and each client gets its own live copy
  - deadlines counted in business days from a start point
  - stage gates (one stage can't start until the previous one is done)
  - a **server-side reminder and escalation engine**
  - an owner view of all clients, colour-coded by status
  - a full audit log
- **WhatsApp:**
  - Automated reminders to staff: send them one-to-one through Meta's official WhatsApp API.
  - Messages to client groups: keep them sent by a person (Irit), with one-tap pre-written messages. Automating groups through the official API is effectively closed to a small agency, and unofficial tools can get the business number banned (section 4).

---

## 2. Key findings: patterns worth copying

### A. One master process, one live copy per client
- ClickUp agency consultants (ZenPilot) keep a "Process Library" of master templates. Each client gets a folder created from a template in one click, with lists, fields, views, automations and an onboarding checklist already in place ([ZenPilot](https://www.zenpilot.com/blog/how-to-set-up-clickup-for-agencies/)).
- Asana templates carry sections, tasks, assignees, due dates, dependencies, rules and fields. Due dates are relative to the date the template is used ([Asana](https://asana.com/features/workflow-automation/project-task-templates)).
- In Teamwork.com templates, dates are "day 1, 3, 5" from a starting date, with a "skip weekends" option ([Teamwork support](https://support.teamwork.com/projects/templates/task-list-templates)). Its "weekend" means Saturday–Sunday, which doesn't match Israel's Friday–Saturday.
- ClickUp can re-time all template dates from a new start or end date and skip non-working days ([ClickUp help](https://help.clickup.com/hc/en-us/articles/6326168424471-Remap-dates-in-templates)).
- Productive: automations stored in a template are copied into every project made from it ([Productive help](https://help.productive.io/en/articles/2179607-project-templates)).
- Accelo handles monthly retainers with "periods". Each new period automatically creates that period's recurring tasks ([Accelo](https://www.accelo.com/resources/help/guides/user/modules/retainers/recurring-tasks/)). This fits Astrateg's monthly posting cycle well.

### B. Stage gates, dependencies and conditional steps
- **Process Street:**
  - "Stop tasks" block progress until a step is done, and hold back notifications to later assignees.
  - Conditional logic shows or hides tasks depending on earlier answers.
  - Due dates can be calculated from a date field or from when another task was completed ([Process Street](https://www.process.st/help/docs/workflows/), [conditional logic](https://www.process.st/help/docs/conditional-logic/)).
- **monday** has three dependency modes ([monday support](https://support.monday.com/hc/en-us/articles/360007402599-Dependencies-on-monday-com)):
  - Flexible: dates move only if tasks would overlap.
  - Strict: dates move by exactly the same amount, with optional lead or lag time.
  - No action: the dependency is shown but nothing moves.
- **Asana** can shift dependent task dates automatically and asks first before shifting. It never shifts completed tasks ([Asana help](https://help.asana.com/s/article/auto-shifting-dates-for-dependent-tasks?language=en_US)).
- **ClickUp** reschedules dependent tasks by the same number of days and can use a work calendar with holidays ([ClickUp help](https://help.clickup.com/hc/en-us/articles/6304547785367-Rescheduling-dependencies)).
- **Scoro** can chain project phases so each one starts only after the previous one ends ([Scoro](https://support.scoro.com/hc/en-us/articles/12163596753677-Project-templates)).

### C. A personal "My work" view for each role
- monday "My Work" collects everything assigned to a person across all boards into six date groups. It only works if every item has an assigned person ([monday](https://support.monday.com/hc/en-us/articles/360019300579-My-Work)).
- Asana "My tasks" stopped moving tasks between sections automatically. Users now set up rules for that, and tasks without a due date never surface ([Asana](https://asana.com/inside-asana/customize-my-tasks), [forum](https://forum.asana.com/t/disable-auto-promote-feature-in-my-tasks/46444)).
- Process Street and Manifestly assign steps to a **role**, then name the actual person per run ([Process Street](https://www.process.st/help/docs/workflows/), [Manifestly](https://www.manifest.ly/features/workflow-role-based-assignments)).
- Trainual attaches responsibilities and SOPs to roles, with tests and sign-offs ([Trainual help](https://help.trainual.com/en/articles/5544258-responsibilities), [Trainual](https://trainual.com/roles-responsibilities)).

### D. Service deadlines (SLA)
- monday service has an SLA timer that shows Within, Paused or Breached. It counts only during defined working hours and pauses on chosen statuses such as "Awaiting customer" ([monday support](https://support.monday.com/hc/en-us/articles/30628237276690-SLA-column-on-monday-service)).
- Manifestly sets due dates relative to the start of a run and sends reminders by email, Slack, Teams, SMS or push ([Manifestly](https://www.manifest.ly/features/workflow-relative-due-dates)).
- Asana's "due date is approaching" trigger fires around midnight, according to forum reports ([forum](https://forum.asana.com/t/automation-due-date-is-approaching-triggers-at-end-of-due-date-period/976297)). That is a bad time to remind anyone.

### E. Automations and rules
- monday has "When a date arrives → notify" and "Every time period → create item" automations ([alerts](https://support.monday.com/hc/en-us/articles/360000227739-Alerts-and-Reminders-with-Automations), [recurring](https://support.monday.com/hc/en-us/articles/360000221159-How-to-create-recurring-tasks)).
- monday's monthly automation limits are 250 actions on Standard and 25,000 on Pro ([monday](https://support.monday.com/hc/en-us/articles/360002826680-Automations-and-integrations-pricing)).
- ClickUp's monthly automation actions are 1,000 on Unlimited, 5,000 on Business and 25,000 on Business Plus. Automations pause for the rest of the month when the limit is hit ([ClickUp](https://help.clickup.com/hc/en-us/articles/23477062949911-Automations-feature-availability-and-limits)).

### F. Handoffs and approvals
- Productive's handoff pattern: when a task moves to "Review", it is assigned to QA and a comment is added ([Productive](https://help.productive.io/en/articles/8822365-automations-examples-and-best-practices)). For Astrateg, that means editor → Ofir.
- Asana approval tasks give three buttons: Approve, Request changes, Reject ([Asana](https://help.asana.com/s/article/how-to-use-approvals?language=en_US)).
- Teamwork lets people approve proofs without an account, straight from an emailed link ([Teamwork](https://support.teamwork.com/projects/proofing/review-and-approve-proofs)).

### G. Workload
- Asana: set a weekly capacity per person, and the view turns red when someone is over it ([Asana](https://help.asana.com/s/article/portfolio-workload-and-universal-workload?language=en_US)).
- monday: colour bubbles per person, based on each team's work schedule and time off ([monday](https://support.monday.com/hc/en-us/articles/360010166559-Resource-management-with-Workload)).
- Teamwork: capacity is working hours minus estimated task time ([Teamwork](https://support.teamwork.com/projects/workload/managing-capacity-in-the-workload)).

### H. Owner overview
- Asana Portfolios show every project as On track, At risk, Off track or On hold, and you can drill down into each ([Asana](https://help.asana.com/s/article/portfolio-progress-and-reporting?language=en_US)). This is the model for Adam's screen.
- Function Point describes a "traffic manager" who moves every job through its stages ([Function Point](https://functionpoint.com/blog/traffic-managers-production-managers-roles-at-agency-2)). At Astrateg, that is effectively Ofir's control role.

### I. Audit trail
- monday's board activity log records who changed which date, status or group. Filtering is on Pro and above, and Enterprise keeps up to 5 years ([monday](https://support.monday.com/hc/en-us/articles/115005310745-The-Activity-Log)).
- Process Street logs every assignment, completion, approval and edit per run, including changes made by automations ([Process Street](https://www.process.st/help/docs/workflow-run-activity-feed/)).
- Asana has a field-level activity log per task. Its account-wide audit log API is Enterprise+ only and keeps events for 90 days ([Asana dev](https://developers.asana.com/docs/audit-log-events)).

### J. Client access
- Teamwork: client user seats are free ([Teamwork](https://support.teamwork.com/projects/subscription/license-types)).
- Productive: client portal is free, with a builder to choose exactly what clients see ([Productive](https://productive.io/client-portal/)).
- monday Pro: unlimited guests ([monday](https://support.monday.com/hc/en-us/articles/360000305419-Pricing-for-guests)).

### K. Evidence that checklists work
- The WHO 19-item surgical checklist cut deaths from 1.5% to 0.8% and complications from 11% to 7% ([NEJM 2009](https://www.nejm.org/doi/full/10.1056/NEJMsa0810119)). Short checklists at handoff points change what people actually do.
- Agency surveys cite poor communication (clients having to chase for updates) as a top reason clients leave ([Promethean Research](https://prometheanresearch.com/client-retention-strategies-for-agencies/)) [unverified: vendor blog, method unclear].

---

## 3. Hebrew and right-to-left support (decisive for Astrateg)

| Tool | Hebrew interface | Right-to-left layout | Source |
|---|---|---|---|
| monday.com | Not among its 15 interface languages | Right-to-left text only in forms (2023); full board right-to-left is still a feature request | [languages](https://support.monday.com/hc/en-us/articles/360003503760-Available-languages-for-monday-com), [blog](https://monday.com/blog/product/kick-off-2023-with-muted-notifications-and-rtl-text/), [request](https://community.monday.com/feature-requests/post/native-right-to-left-rtl-support-for-boards-and-main-tables-OhQqmiUQPq79XP7) |
| ClickUp | No | Requested since 2018; only Chrome extensions, which don't work on mobile | [feedback](https://feedback.clickup.com/feature-requests/p/rtl-support-and-interface-language) |
| Asana | No | Right-to-left text shows left-to-right; Hebrew garbled in CSV exports (reported) | [forum](https://forum.asana.com/t/native-right-to-left-rtl-language-support/1136707) |
| Teamwork, Productive, Scoro, Accelo, Function Point | No evidence found [unverified] | [unverified] | none |
| **Astrateg's own system** | **Yes** | **Yes, on mobile too** | none |

---

## 4. WhatsApp: what is possible

- **Official API for one-to-one messages (recommended for staff reminders).**
  - Meta has charged per delivered template message since July 1, 2025 ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
  - From **October 1, 2026 (two days from now)**, replies inside the 24-hour customer-service window are also charged, at the utility rate, after 1,000 free per number per month. Meta stops delivery for businesses with no payment method on file ([360dialog](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/), [Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)).
  - A utility message in Israel costs about **$0.0061** ([EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing)) [third-party].
  - 10 staff × 2 messages × 22 business days ≈ 440 messages ≈ **$3 a month**.
- **Official Groups API (not realistic for client groups):**
  - It requires an Official Business Account (the verified badge). Meta grants that only to notable brands with press coverage, and applications must go through an approved provider ([360dialog](https://docs.360dialog.com/docs/waba-management/official-business-account), [respond.io](https://respond.io/help/whatsapp/whatsapp-official-business-account-blue-tick)).
  - Groups can have at most 8 participants, and people join by invite link only ([Periskope](https://periskope.app/blog/whatsapp-groups-api-requirements-eligibility-limits)) [third-party].
  - Groups are not available for numbers that also run the WhatsApp Business app ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)).
- **Same number in the app and the API ("coexistence"):** possible. The app must be opened at least every 13 days, and messages sync both ways ([360dialog](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)).
- **Unofficial tools (whatsapp-web.js, Green API and similar):** automating the consumer app breaks WhatsApp's terms. Bans can be permanent and cover the phone number itself ([OnCloudAPI](https://oncloudapi.com/blogs/whatsapp-api-ban-risk-official-cloud-api-vs-unofficial-apis), [bot.space](https://www.bot.space/blog/whatsapp-api-vs-unofficial-tools-a-complete-risk-reward-analysis-for-2025)) [third-party summaries of the terms]. **Do not risk Irit's number.**
- **Safe semi-automation:** a link of the form `https://wa.me/?text=<message>` opens WhatsApp with the text already written and lets the user pick any chat, including a group ([WhatsApp FAQ](https://faq.whatsapp.com/5913398998672934)).
- **monday's WhatsApp support** comes only through third-party marketplace apps ([TimelinesAI listing](https://monday.com/marketplace/listing/10000385/whatsapp-sync-by-timelinesai)).

---

## 5. Costs for 10 seats (Adam, Irit, Lior, Ofir, Ilai, Nirel, Nadia, Yariv, Anna, Eli)

| Option | Per user / month | About 10 users / month | Notes |
|---|---|---|---|
| monday Work Management Standard / Pro | $12 / $19 | $120 / $190 | Sold in seat bundles of 3, 5, 10, 15; an 11th person means paying for 15 ([support](https://support.monday.com/hc/en-us/articles/4405633151634-Plans-and-pricing-for-monday-com)); prices from [third-party](https://www.rock.so/blog/monday-pricing) |
| monday service Standard / Pro | $31 / $45 | $310 / $450 | Prices rose 18% on Feb 10, 2026 ([support](https://support.monday.com/hc/en-us/articles/31768213864466-Pricing-model-adjustment-for-monday-service-February-2026)) |
| ClickUp Unlimited / Business | $7 / $12 ($19 monthly) | $70 / $120 | [ClickUp](https://clickup.com/pricing), [tech.co](https://tech.co/project-management-software/clickup-pricing) |
| Asana Starter / Advanced | $10.99 / $24.99 | $110 / $250 | [tech.co](https://tech.co/project-management-software/asana-pricing) [third-party] |
| Teamwork Deliver / Grow | $10.99 / $19.99 | $110 / $200 | Minimum 3 users; client users free ([G2](https://www.g2.com/products/teamwork-com/pricing)) |
| Productive Essential / Professional | $10 / $25 | $100 / $250 | Minimum 3 seats ([Productive](https://productive.io/pricing/)) [via third-party] |
| Scoro | $19.90–$49.90 | $199–$499 | Minimum 5 seats ([Scoro](https://www.scoro.com/pricing/)) |
| Accelo | $50–$90 | $500–$900 | Prices not published [unverified] ([Capterra](https://www.capterra.com/p/225762/Accelo/pricing/)) |
| Function Point | about $53–$68 | about $530–$680 | [unverified] ([Findstack](https://findstack.com/products/function-point/pricing)) |
| Process Street | Not published | none | [unverified] ([Hackceleration](https://hackceleration.com/labs/process-street-pricing)) |
| SweetProcess | Flat $99 for up to 10 | $99 | [Capterra](https://www.capterra.com/p/188134/SweetProcess/) [third-party] |
| Manifestly Business | $10 | $100 | [G2](https://www.g2.com/products/manifestly-checklists/pricing) |
| Trainual | Quote only | about $249 | [unverified] ([TrustRadius](https://www.trustradius.com/products/trainual/pricing)) |
| **Build (current stack)** | none | **About $25–35** | Supabase Pro $25 ([Supabase](https://supabase.com/pricing)) + WhatsApp about $3–10; GitHub Pages free |

- Supabase's free plan pauses a project after a week of inactivity. Pro is never paused and keeps 7 days of daily backups ([pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [backups](https://supabase.com/docs/guides/platform/backups)). **Use Pro for production.**

---

## 6. Build vs buy

- **Buying** gives polished Gantt, workload and mobile apps immediately.
- **Against buying:**
  - no Hebrew interface or right-to-left layout
  - Astrateg's role rules would have to be forced into generic boards
  - WhatsApp only through extra paid apps
  - monday Standard's 250 automations a month would run out quickly
  - the vault, quotes, e-signing and payouts systems would still live elsewhere, so there would be two sources of truth
  - staff would need retraining
- **Building** keeps one Hebrew system, already integrated: e-signing opens a new client automatically. It costs about **$30 a month** plus development time.
- **Verdict: build.** Copy the patterns, not the products. Skip what the big agency platforms (Productive, Scoro, Accelo) are built around: time tracking, budgets and invoicing are overkill for package pricing at 10 people.

---

## 7. What to copy: concrete recommendations for Astrateg (in order)

1. **Turn protocol v4 into data: master template → one live copy per client** (copied from ZenPilot, Asana and Process Street).
   - Each step records: stage, task, **role** (not a person), deadline in business days, dependencies, gate, a "definition of done" (for example, a Drive link is required), and conditions.
   - Each client's copy stays on the template version it started with, so moving to v5 doesn't break clients already running.
2. **Assign by role, then map roles to people per client** (Process Street and Manifestly role assignments).
   - Example roles: office/operations (Irit), manager (Lior), control & QA (Ofir), design & posting (Ilai), editor (Nadia, Yariv, Anna), Natali's editor (Nirel, automatically when the influencer is Natali), photographer (Eli).
   - Add a one-click "reassign for vacation".
3. **Conditional steps by package** (Process Street).
   - "Social + TV" adds the Channel 14 tasks.
   - The influencer choice (Natali or DMS) sets the editor rule and the shoot-day brief.
   - Campaign tasks appear only if the package includes Meta campaigns.
4. **Stage gates.** A stage can't start until its gate passes. Examples to align with v4:
   - Signed → Irit collects access → Ilai checks access and sets up pages → **gate: access verified**
   - Ofir's characterization meeting → Lior's content call and scripts → **gate: client approves scripts on Zoom** (Approve / Request changes, as in Asana)
   - Shoot day (Eli arrives 1 hour early; organised Drive handed to Lior) → **gate: footage delivered**
   - Ofir assigns editors → **SLA: 3 business days to videos in Drive, 4 to close including client fixes** → **gate: Ofir's QA**
   - Graphics → QA → scheduling and posting (Ilai: Gantt, Metricool)
   - Use monday's "flexible" dependency mode: move later tasks only when they would overlap, and never move completed tasks (as in Asana).
5. **A business-day calendar.** Sunday–Thursday, with Israeli holidays from Hebcal's API with its Israel setting on ([Hebcal](https://hebcal.github.io/api/)), stored in a table. All deadlines, SLAs and reminders use it. Don't adopt any tool's Saturday–Sunday weekend assumption.
6. **SLA timers with pause** (monday service): "waiting for the client" pauses the clock and shows in a separate colour, so the team isn't blamed for client delays.
7. **A server-side reminder and escalation engine.** Supabase's scheduler calls an Edge Function every 15 minutes during business hours ([Supabase](https://supabase.com/docs/guides/functions/schedule-functions)), converting times to Israel time and daylight saving.
   - **08:00 personal summary:** due today, overdue, and "stages waiting on you".
   - One business day before a deadline: reminder. On the day at 14:00: another nudge if not done.
   - One business day overdue: the task goes onto Ofir's daily-control list.
   - Two days overdue: escalated to Lior, and the client turns red on Adam's screen.
   - Recurring items: Ofir's Thursday status note per client, daily control every 2 business days, Irit's daily client messages, and each new month's posting cycle (Accelo's period pattern).
   - Channels: in-app, web push, and WhatsApp one-to-one to staff through the official API with pre-approved utility templates.
   - Web push on iPhone works only after the site is added to the Home Screen, on iOS 16.4 or later, and permission is granted by a tap ([OneSignal](https://documentation.onesignal.com/docs/en/web-push-for-ios)).
   - No messages on Friday, Saturday or holidays. Log every reminder sent.
8. **Irit's client messages stay human, with one tap.** Each client card gets a pre-written message button that opens WhatsApp with the text ready, using the `wa.me/?text=` link. The system marks it as sent when Irit taps. It follows WhatsApp's rules, and her number stays safe.
9. **Adam's screen** (Asana Portfolios): one row per client, one column per stage. Colours are calculated automatically (on track, at risk, off track, waiting on client), with the reason one tap away. Add a workload strip: open tasks this week versus capacity per person. Send a weekly summary every Sunday morning.
10. **Audit log** (monday and Process Street): an append-only table filled automatically by the database, recording who changed what, when, and the old and new value. Show it as a "History" tab on each client card and task.
11. **"My role" page per employee** (Trainual): each person's protocol responsibilities, checklists and briefs (for example, Nirel's exact brief format), with a one-time sign-off.
12. **Later: a read-only client status link** (Teamwork and Productive). It shows the current stage, the next milestone, "what we need from you" (access, approvals), and Approve / Request changes buttons for scripts. It opens with a secret link, not a login, and never shows internal notes or passwords.
13. **Rollout:** pilot with 2 clients for 2 weeks, then everyone. Make one screen per person the only to-do list. Adam runs the weekly meeting from his screen.

---

## 8. Pitfalls

- **Notification fatigue.** monday built board muting because of exactly this ([monday](https://monday.com/blog/product/kick-off-2023-with-muted-notifications-and-rtl-text/)). Prefer a daily summary plus escalations over a message for every event.
- **Tasks without an owner or a due date disappear** from "my work" views (monday, Asana). Every task the template generates must have both.
- **Shadow spreadsheets.** A rollout fails quietly when people keep tracking in their own sheets ([UC Today](https://www.uctoday.com/productivity-automation/why-most-project-management-tool-rollouts-fail-and-how-to-fix-adoption-in-2026/)).
- **WhatsApp:**
  - service-message charges start Oct 1, 2026, and delivery stops without a payment method on file
  - templates need Meta approval, and staff must opt in
  - never use unofficial group automation on the business number
  - with coexistence, the WhatsApp Business app must be opened at least every 13 days
- **The repository is public.** The WhatsApp token and phone number ID go only in Supabase's secret storage. Staff phone numbers live only in the database with access rules. No keys or phone numbers in commits or in the front end.
- **Changing the protocol template mid-run.** Keep a version per client run and never silently change running clients.
- **Timezones and daylight saving.** Supabase's scheduler runs on UTC, so convert to Asia/Jerusalem inside the function. Asana's midnight trigger timing is a warning example.
- **Workload views need estimates.** Start with simple task counts per person; add hours only if someone actually uses them.
- **Don't copy platform bloat:** time tracking, budgets, heavy Gantt charts and AI add-ons.

---

## 9. Not verified — check before relying on these

- Official per-seat prices for monday, Asana, Productive and Teamwork. Direct fetches were blocked, so these come from third-party sites or search snippets.
- Accelo, Function Point, Process Street and Trainual pricing.
- Whether Teamwork, Productive, Scoro, Accelo or Function Point support Hebrew or right-to-left layout.
- The exact Israel WhatsApp rates.
- The Groups API limits (8 participants, invite link only), which come from a third-party site.
- The agency client-churn statistics.

---

# Reminders and notifications for Astrateg: research findings and recommended design

> **How this was researched:** WebFetch was blocked by the network egress proxy for every primary domain I tried: developers.facebook.com, business.whatsapp.com, twilio.com, webkit.org, 360dialog.com and engagelab.com. Every claim below comes from web-search results that pointed to the cited URLs. Meta's official doc pages are cited where search surfaced them, but I could not open them to confirm the exact wording. **Check the Israel prices in Meta's official rate card before go-live.**

---

## 1. Key findings

### WhatsApp Business Platform (Cloud API)

- **Meta charges per message, not per conversation.** This started July 1, 2025. From that date, utility templates sent inside an open 24-hour customer service window were free. [Meta pricing updates](https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/), [YCloud](https://www.ycloud.com/blog/whatsapp-api-pricing-update)
- **Another pricing change starts October 1, 2026, two days from today.**
  - Service messages (free-form replies inside the 24h window) will be charged at each country's utility rate. Each business phone number gets its first **1,000 service messages per month free**.
  - Utility templates sent inside the window stop being free. [Meta: non-template pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages), [360dialog](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/), [Wati](https://www.wati.io/en/blog/whatsapp-service-message-pricing/)
- **Israel rates (secondary sources, US dollars per delivered message):**
  - Utility: **about $0.0061** until September 30, 2026 and **about $0.0053** from October 1, 2026. The sources disagree slightly.
  - Marketing: **about $0.0406**, so a marketing message costs about 7 times a utility message.
  - The rate is set by the recipient's country code. [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing), [Blueticks](https://blueticks.co/blog/whatsapp-business-pricing-marketing-messages-2026), [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) [exact figures unverified against Meta's rate card]
- **The 24-hour rule.**
  - Messages the business starts must use a pre-approved template (marketing, utility or authentication).
  - Free-form text is allowed only within 24 hours of the user's last message.
  - A tap on a template's quick-reply button counts as a user message. It opens the window and returns a `payload` to your webhook. A template can have up to 3 quick-reply buttons of 20 characters each. [Zoice](https://zoice.ai/blog/whatsapp-business-api-without-bsp/), [Kaleyra](https://developers.kaleyra.io/docs/whatsapp-api-create-a-template-with-dynamic-payload), [Vonage](https://developer.vonage.com/en/messages/code-snippets/whatsapp/send-button-quick-reply)
- **Template approval and category.**
  - Meta reviews every template. Review is usually immediate for a verified business and takes up to 24 hours otherwise.
  - Since April 9, 2025, Meta approves a template submitted as "utility" as **marketing** if it looks promotional or does not clearly relate to the user's own request or transaction.
  - Hebrew templates are supported (language code `he`). [Meta: template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization), [Wati](https://support.wati.io/en/articles/12320234-understanding-meta-s-latest-updates-on-template-approval), [Meta: supported languages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages)
- **Sending directly from Astrateg's own server.**
  - The Cloud API has no platform fee. You only pay Meta's per-message fees.
  - Setup steps: Meta Business account → phone number → display name approval → access token → templates and webhooks.
  - Meta provides a test number that can send to **up to 5 registered recipients**, which is enough for a pilot. [Zoice](https://zoice.ai/blog/whatsapp-business-api-without-bsp/), [Meta: get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- **Sending limits.**
  - Since October 2025, limits apply per business portfolio, not per phone number.
  - An unverified business can message **250 unique recipients per 24 hours**. Once verified, the limit jumps to 100K (the 2K and 10K tiers are being removed).
  - 250 is plenty for about 10 staff plus about 30 clients. [Meta: messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits), [Chatarmin](https://chatarmin.com/en/blog/whats-app-messaging-limits), [Woztell](https://woztell.com/whatsapp-api-2026-updates-pacing-limits-usernames/)
- **Opt-in.** Meta requires consent before a business messages anyone.
  - Since November 2024 a general consent is acceptable, and it can be collected on any channel except WhatsApp itself.
  - The consent must name the business and say that the person can opt out. [Meta: getting opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in), [Infobip](https://www.infobip.com/docs/whatsapp/compliance/user-opt-ins)
- **Groups API.** Groups created through the API have at most **8 participants**, members join only by invite link, and interactive buttons are not supported.
  - It requires an **Official Business Account**.
  - It is **not available for numbers that also run the WhatsApp Business app**.
  - **Consequence:** the existing client groups, which live on Irit's phone, cannot be automated through the official API. [Meta: groups](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups), [Periskope](https://periskope.app/blog/whatsapp-groups-api-requirements-eligibility-limits), [imbee](https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026)
- **Coexistence (one number in both the Business app and the Cloud API).** Israel has full support.
  - It turns off some app features, including broadcast lists, message editing, deleting for everyone and disappearing messages.
  - It caps throughput at 20 messages per second.
  - The app must be opened at least every 13 days. [360dialog: coexistence](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence), [Chakra: support by country](https://chakrahq.com/product/whatsapp/tools/whatsapp-coexistence-support/)
- **Alternatives to going direct:**
  - **Twilio** adds **$0.005 per message**, inbound and outbound, on top of Meta's fee. [Twilio](https://www.twilio.com/en-us/whatsapp/pricing), [Landbot](https://landbot.io/blog/twilio-whatsapp-pricing) (Some Twilio write-ups still say service replies are free. That is out of date after October 1, 2026.)
  - **360dialog** charges **€49 per number per month** (Regular plan) with no markup on Meta fees. [360dialog pricing](https://360dialog.com/pricing)
- **Unofficial gateways** (Green-API, whatsapp-web.js and similar) automate WhatsApp Web.
  - WhatsApp says unofficial apps violate its Terms of Service.
  - Numbers used this way can be **banned permanently**, and the chat history can be lost.
  - Green-API itself publishes guides on how to avoid being blocked. [WhatsApp FAQ](https://faq.whatsapp.com/1217634902127718), [Green-API](https://green-api.com/en/blog/reduce-the-risk-of-WA-blocking/), [Omnichat](https://blog.omnichat.ai/unofficial-whatsapp-business-api/)
- **Free fallback with no API:** a `wa.me/<number>?text=<url-encoded>` link opens WhatsApp with the message already typed, and a person taps Send. [BusinessChat](https://help.businesschat.io/en/articles/6517838-how-to-build-a-whatsapp-click-to-chat-url-wa-me)

### Web Push for installed web apps (PWAs)

- **iPhone and iPad (iOS 16.4 and later):** push works **only after the site is added to the Home Screen**. Permission can only be requested from a direct user tap, never on page load. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- **Reliability on iOS:**
  - If the app receives a push and does not show a notification, iOS revokes the subscription.
  - Subscriptions sometimes disappear with no obvious cause. [Apple forum](https://developer.apple.com/forums/thread/727372), [Webscraft](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
  - **Declarative Web Push** (iOS 18.4 and later) removes the revocation penalty and adds a fallback, so delivery is more reliable. [WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)
  - A secondary source estimates delivery at about 70–85% on iOS versus 90–95% on Android. [unverified]
  - The EU restriction on iOS web apps does not apply in Israel.
- **Android:** push works without installing the app. A message without `Urgency: high` may be held while the phone is idle (Doze mode). The standard behind this is RFC 8030 ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html)).
- **Supabase building blocks:**
  - `pg_cron` plus `pg_net` can call an Edge Function on a schedule. Keys should be stored in Vault, not inside the cron job. [Supabase: schedule functions](https://supabase.com/docs/guides/functions/schedule-functions)
  - For sending, use the outbox pattern: queue messages in a table and send them with retries. [Supabase: push notifications](https://supabase.com/docs/guides/functions/examples/push-notifications), [reference implementation](https://github.com/Alex-Bancila/osubb-app/issues/70)

### Email and SMS

- **Email:** Resend's free plan allows **3,000 emails per month and 100 per day**, with one domain. [Resend](https://resend.com/pricing)
- **SMS to Israel:** Twilio charges **$0.2575 per SMS**, about 45 times a WhatsApp utility message ([Twilio IL](https://www.twilio.com/en-us/sms/pricing/il)). Local routes run about $0.125 to €0.25 per message ([BudgetSMS](https://www.budgetsms.net/sms-gateway-pricing/il/israel/)) [unverified for Israeli providers].
- **Israeli anti-spam law (Communications Law §30A)** requires written opt-in for *advertisements* sent by SMS or email. Israeli courts distinguish advertisements from informational content. [law.co.il](https://www.law.co.il/en/news/2016/08/19/israeli-anti-spam-law-amended-for-first-time/), [Lexology](https://www.lexology.com/library/detail.aspx?g=99eb0abc-6efe-499c-a974-800d4891d2ee)

### Notification fatigue, digests and escalation

- **Batching:** a randomized field study (n=237) found that delivering notifications **3 times a day** made people less stressed, happier and more productive. Hourly batching made little difference. Turning notifications off entirely *increased* anxiety. [Fitz et al. 2019](https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596)
- **No notifications at all:** a day without notifications made people more productive but anxious about being unresponsive. [Pielot & Rello 2017](https://arxiv.org/abs/1612.02314)
- **Interruptions:** interrupted people finish tasks faster, but with more stress and frustration. [Mark et al., CHI 2008](https://ics.uci.edu/~gmark/chi08-mark.pdf)
- **Scale of interruptions:** Microsoft 365 users are interrupted every 2 minutes on average, about 275 times a day. [Microsoft Work Trend Index 2025](https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday)
- **Alert fatigue:** repeated alerts are ignored more often. In one study, acceptance fell **30% for each additional reminder** per encounter. [Embi & Leonard / BMC](https://link.springer.com/article/10.1186/s12911-017-0430-8)
- **Reminders do work:** in a Cochrane review, attendance was 78.6% with SMS reminders versus 67.8% with none. [Cochrane](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD007458.pub2/full)
- **Escalation practice:** each level has a timeout, and the timeout should match how critical the item is. [PagerDuty](https://support.pagerduty.com/main/docs/escalation-policies)
- **After-hours messages in Israel:** there is no "right to disconnect" law. A labor court refused to rule that every after-hours text counts as overtime. Quiet hours are therefore company policy, and they also lower the risk of disputes. [Globes](https://en.globes.co.il/en/article-will-israel-ever-provide-employees-with-right-to-disconnect-1001477801)
- **Holidays and Shabbat:** Hebcal's API returns Israeli holidays (`i=on`, `yomtov` flag) and Shabbat times as JSON. [Hebcal calendar API](https://www.hebcal.com/home/195/jewish-calendar-rest-api), [Shabbat API](https://www.hebcal.com/home/197/shabbat-times-rest-api)
- **Privacy law:** Amendment 13 to the Privacy Protection Law took effect August 14, 2025. Employers must tell employees why their data is collected, collect only what is needed, and use it only for that purpose. [Ius Laboris](https://iuslaboris.com/insights/major-amendment-to-privacy-law-in-israel/), [Herzog](https://herzoglaw.co.il/en/news-and-insights/israeli-employment-law-did-you-know-privacy-update/)

---

## 2. Recommended architecture for Astrateg

### Principles

1. **The system is the single source of truth.** WhatsApp and push only nudge people, and every message links back to the item in the system.
2. **Default to a digest.** Send a real-time message only when it changes what someone does today.
3. **Automatic escalation.** Each item follows a ladder that counts business days (remind before due, at due, after due, then manager).
4. **Hard caps.** At most 3 individual WhatsApp messages per person per day. The same reminder is never sent twice.
5. **Quiet hours and Shabbat are enforced in code.** Anything that comes up during quiet hours is held for the next business morning.

### Components (Supabase)

| Component | What it does |
|---|---|
| `business_calendar` | Filled once a year from Hebcal (`i=on`). Stores Sun–Thu working days, holidays, eves of holidays and Shabbat. All deadlines, including the "3/4 business days" editor deadlines, use it. |
| `notification_rules` | One row per reminder type: when it fires relative to the due date, the channel, who receives it, and which level escalates to whom. Adam can edit these without touching code. |
| `notification_prefs` | Per person: channels, digest time, quiet hours, and whether the phone is set up for Web Push. **Phone numbers live here, protected by row-level security (RLS). Never in the public repo.** |
| `notification_outbox` | Messages waiting to go out. A unique key (`item_id`, `stage`, `recipient`) makes sending safe to repeat without duplicates. |
| `notification_log` | Delivery statuses from the WhatsApp webhook and button taps, for control and for measuring fatigue. |
| `push_subscriptions` | Browser push endpoints per device. |
| **pg_cron** (every 10 minutes, 07:30–19:30 Israel time, Sun–Thu) | Runs a SQL function that finds due, overdue and escalation items and writes them to the outbox. |
| **Edge Function `dispatch`** | Sends through the WhatsApp Cloud API, Web Push (VAPID) or Resend. Retries with backoff and applies quiet hours and caps. |
| **Edge Function `wa-webhook`** | Receives button taps ("✅ בוצע" (done), "⏰ מחר" (tomorrow), "🆘 צריך עזרה" (need help)) and delivery/read statuses, then updates the item and the log. It must verify Meta's signature header. [unverified detail] |
| **Secrets** | WhatsApp token and phone number ID, VAPID keys and the Resend key go in Supabase secrets and Vault only. The GitHub repo is public. |

### WhatsApp setup

- **Go direct to Meta's Cloud API, with no provider in between.** The platform is free and the message cost is lowest. Take Twilio or 360dialog only if Astrateg wants paid support.
- **Get a dedicated new number**, for example "אסטרטג – מערכת" (Astrateg – System). Do not put Irit's number or the office number into coexistence. Coexistence disables app features, needs the app opened every 13 days, and blocks the Groups API.
- **Collect staff consent** with a one-time signed notice. It also covers the Amendment 13 disclosure duty.
- **Collect client consent** with a checkbox in the existing quote and e-signing flow ("מאשר/ת קבלת עדכוני עבודה בוואטסאפ מאסטרטג" (I agree to receive work updates on WhatsApp from Astrateg)). Meta accepts consent collected outside WhatsApp.
- **Submit about 6 neutral Hebrew *utility* templates**, each with a link button to the item and quick-reply buttons:
  1. `task_assigned`: "משימה חדשה: {{1}} | לקוח: {{2}} | יעד: {{3}}" (New task / Client / Due)
  2. `task_due`: "תזכורת: {{1}} ללקוח {{2}} – היעד {{3}}" (Reminder: [task] for client [client], due [date])
  3. `task_overdue`
  4. `escalation`: "{{1}} באיחור של {{2}} ימי עסקים אצל {{3}}" ([task] is [N] business days late with [person])
  5. `daily_digest`: "יש לך היום {{1}} משימות, {{2}} באיחור" (You have [N] tasks today, [M] overdue)
  6. `shoot_day`: date, call time, location, script link
- **Keep templates free of any promotional wording**, so Meta does not reclassify them as marketing.
- **Client WhatsApp groups stay manual.** The system builds the daily client messages and opens them as `wa.me` links (or copy buttons) for Irit to send with one tap. **Do not use Green-API or similar tools on Irit's number.** A ban would wipe out every client group.

### Channel for each reminder type

| Reminder | Recipient | Channel | Timing |
|---|---|---|---|
| Personal morning digest (today, tomorrow, overdue) | Everyone | WhatsApp `daily_digest` (1 per day), plus the "my work" page | 08:45 Sun–Thu |
| New assignment with a deadline of 1 business day or less | Owner | WhatsApp immediately | Real time |
| New assignment with a longer deadline | Owner | In-app and Web Push; appears in the next digest | Real time (push) |
| Editor assignment (Nadia, Yariv, Anna, Nirel) | Editor | WhatsApp `task_assigned` with the brief link and the due date (day 3 to Drive, day 4 to close) | Real time; nudge day 2 at 13:00; "due today" day 3 at 09:00 |
| Video delivered, waiting for QA | Ofir | Web Push, plus a count in the digest | Real time |
| Script or Zoom approval waiting on Lior | Lior | WhatsApp if waiting more than 4 business hours, otherwise the digest | Batched |
| Daily control (every 2 days) | Ofir | WhatsApp at 09:00 on the due day | Scheduled |
| Thursday per-client status summary | Ofir | WhatsApp Thursday 11:00; escalates to Lior at 16:00 if missing | Scheduled |
| Access missing or client not responding for more than N days | Irit | Digest, plus a ready-to-send `wa.me` message to the client | Batched |
| Posting tomorrow but content not approved | Ilai, then Lior | WhatsApp 1 business day before, 12:00 | Scheduled |
| Shoot day | Eli, Lior, Irit | WhatsApp `shoot_day` 2 days before (checklist), 1 day before at 16:00 (logistics), and on the day, 1 hour before call time. Allowed on a Friday if the shoot is on a Friday. | Scheduled |
| After the shoot: organized Drive handed to Lior | Eli | WhatsApp the next business day at 10:00 | Scheduled |
| Overdue item, level 1 | Owner | WhatsApp `task_overdue` | Due + 1 business day at 09:30 |
| Overdue item, level 2 | Editors → Ofir; everyone else → Lior | WhatsApp `escalation` | Due + 2 business days (critical items: due + 1 at 12:00) |
| Overdue item, level 3 | Adam | Exception report only (no per-task messages) | Due + 3 business days |
| Control summary for Adam | Adam | WhatsApp at 18:00 (overdue counts by person and client, clients at risk, open escalations) plus an email every Thursday | Daily / weekly |
| Weekly status per client (archive) | Adam, Lior | Email via Resend | Thursday |
| Clients: approvals, access requests, shoot confirmation (phase 3) | Client | WhatsApp *utility* template from the system number, only with consent | Scheduled |
| SMS | Nobody by default | Only as a fallback for critical escalations when WhatsApp delivery fails | Rare |

### Quiet hours

- No WhatsApp or push outside 08:30–19:00 on Sun–Thu.
- None from Friday 12:00 (or candle-lighting on the eve of a holiday) until the next business morning.
- None on Israeli holidays. Deadlines move automatically.
- The only exception is a shoot-day event that explicitly allows it.

### Measuring whether it works

- Per template: the share of messages that lead to a "done" tap or status change within 24 hours.
- If that share falls, merge the reminder into the digest or cut it (the alert-fatigue signal).
- Show Adam response time per person and per client.
- WhatsApp read receipts can be logged, but present them as service quality, not surveillance.

---

## 3. Estimated monthly cost

| Item | Assumption | Cost |
|---|---|---|
| WhatsApp via direct Cloud API | 10 staff × about 3 messages × 22 days ≈ 700, plus escalations and clients, about 1,000–1,500 utility messages at ~$0.0053–0.0061 | **About $5–9 (≈₪20–35)** [rate unverified against Meta's card; exchange rate ~3.7 unverified] |
| Replies inside the 24h window | Under 1,000 per number per month | $0 |
| Twilio instead (optional) | +$0.005 per inbound and outbound message | +$6–10 per month |
| 360dialog instead (optional) | €49 per number per month plus Meta fees | About ₪200+ per month |
| Web Push | Edge Functions and cron already in Supabase | $0 [depends on plan quota, unverified] |
| Email | Resend free plan (3,000/month) | $0 |
| SMS | $0.2575 per message on Twilio | Avoid, or fallback only |
| Dedicated SIM or virtual number | — | About ₪20–40 per month [unverified] |

---

## 4. Suggested rollout

1. **Weeks 1–2, no Meta fees:**
   - Business-day calendar from Hebcal.
   - Rules, outbox and preferences tables.
   - pg_cron plus the `dispatch` function with Web Push only.
   - An "install on home screen + enable notifications" screen that shows each person's status. Adam should see who is not connected.
2. **Weeks 2–3:**
   - Meta Business account, dedicated number, 6 templates.
   - Pilot on the test number with 5 recipients: Adam, Lior, Ofir, one editor, Irit.
3. **Weeks 3–4:**
   - Escalation ladder, quick-reply buttons through the webhook, Adam's 18:00 summary, caps and quiet hours.
   - Complete Meta business verification.
4. **Month 2:** client-facing messages, only for clients who consented through the quote and e-signing flow.

---

## 5. Pitfalls

- **The October 1, 2026 price change** means in-window utility messages and service messages above 1,000 per month now cost money. The amounts are still small, but cost estimates made before this change are wrong.
- **Utility or marketing:** one promotional word can get a template reclassified as marketing, at about 7 times the price. Review template wording before submitting.
- **Templates are fixed:** any text change needs re-approval (up to 24 hours). Build a few generic templates with variables and a link.
- **Groups:** existing client groups cannot be automated through the official API (8-member limit, Official Business Account required, not available on app numbers). Unofficial tools risk a permanent ban.
- **iOS push is fragile:** it needs a Home Screen install and a user tap, and subscriptions get lost. Never make push the only channel for critical items. Show "push connected" status per person.
- **Android Doze:** send due-now pushes with `Urgency: high`.
- **Time zone:** cron runs in UTC [unverified for this project's config]. Convert to Asia/Jerusalem, which changes with daylight saving time.
- **Duplicates:** enforce the unique key per (item, stage, recipient). Without it, a cron retry sends a reminder twice, which feeds alert fatigue.
- **Public repo:** phone numbers, tokens, the phone number ID and VAPID or Resend keys stay in Supabase only. Messages carry a client name, a task and a link, **never passwords or access details**. Those stay in the Vault.
- **Privacy:** under Amendment 13, give employees a written notice of why their phone numbers are used, and keep log retention limited.
- **Too many pings:** every reminder you add lowers the response to the others. Digest first, real time only when it changes what someone does today, and escalate to Adam by exception only.

---

# Research: what keeps Astrateg's clients satisfied and renewing

**How this was researched.** The egress proxy blocked WebFetch for most sites, including setup.us, productive.io, help.honeybook.com and developers.facebook.com. The claims below therefore come from search-engine excerpts of the cited pages, not full-page reads. **[unverified]** marks a claim that rests on a secondary or vendor source, or that I couldn't cross-check.

---

## 1. What matters most, ranked

1. **Deliver on time, every time.** Clients most often leave because of delivery and value, not price. Build an internal deadline engine that escalates before the client notices a delay.
2. **Update clients before they ask.** A client should never have to write "what's happening?". Use the Thursday status plus automatic messages when something happens (a stage ends, something is waiting on the client, a delay).
3. **Get the first 30–90 days right.** Send a welcome within 24h, hold the characterization meeting within days, and get a visible first win quickly (first post live, first video).
4. **Make approvals easy.** One link, no login, a deadline, and a revision counter.
5. **Promise a WhatsApp response time and measure it.**
6. **Give Adam an early-warning light per client**, green / yellow / red, based on data.
7. **Run pulse surveys at the high points.** After the shoot day and after month 1, plus NPS well before renewal.
8. **Start renewal 45–90 days before the end**, with a results recap.
9. **Client portal: useful but second.** In Israel WhatsApp is the channel. Build a read-only status page that opens from a WhatsApp link, not a portal clients have to log into.

---

## 2. Key findings (with sources)

### Why clients leave and why they renew
- **Setup 2025 Marketing Relationship Survey:**
  - The top reasons clients end agency relationships are dissatisfaction with delivery (61%) and with value (61%). Next come "agency didn't understand our business" (44%) and dissatisfaction with the relationship (41%).
  - Agencies wrongly believe budget cuts and leadership changes are the main causes.
  - Clients gave their current agency an average NPS of 7/10, which is "passive" territory, even when they didn't plan to switch.
  - The respondents are mostly large US brands, so treat this as directional for Israeli small businesses.
  - https://setup.us/blog/2025-marketing-relationship-survey-results
- **Earlier Setup survey:** delivery dissatisfaction was 48% (up 14 points), and agencies ranked delivery only 7th as a reason. https://setup.us/blog/why-do-clients-end-agency-relationships-8-years-of-surveys-point-to-a-clear-pattern
- **Price is not the main issue:** it ranks about 6th (37%). Discounts don't fix retention. https://www.swydo.com/blog/client-retention/
- **Swydo figures [unverified, primary source not identified]:** lack of proactive strategic guidance 68%, poor communication 57%, inability to show value 53%. https://www.swydo.com/blog/client-retention/
- **Showing the work raises perceived value.** Buell & Norton (Management Science, 2011) found people value a service more when they can see the work being done, even when they wait longer. This is the research case for a client-facing progress view. https://pubsonline.informs.org/doi/10.1287/mnsc.1110.1376
- **Peak-end rule:** people remember an experience by its peak and its ending. For Astrateg, the peak is the shoot day and the ending is the end of the month or package. https://www.cmswire.com/customer-experience/using-the-peak-end-rule-for-better-customer-journeys/
- **Retention economics:** Reichheld (Bain) found 5% more retention gives 25–95% more profit, but the numbers come from financial-services cases. https://hbr.org/2014/10/the-value-of-keeping-the-right-customers

### Onboarding
- **About 43% of churn happens in the first 90 days** [unverified, secondary]. https://agiled.app/statistics/client-retention-statistics
- **Recommended onboarding steps:**
  - Welcome within 24h of signing, naming the primary contact, the timeline and the assets needed.
  - Kickoff within 3–7 days.
  - A timeline covering 2 weeks, 30 days and 90 days.
  - A quick win within 14 days.
  - Formal check-ins at 30, 60 and 90 days.
  - https://www.swydo.com/blog/client-onboarding/ ; https://www.searchenginejournal.com/why-agencies-lose-clients-in-the-first-90-days-and-how-to-stop-it/582895/
- **Weekly cadence for new clients:** for the first 60–90 days, a short weekly check-in: "what we did / what we're doing / what we need from you". https://www.swydo.com/blog/client-retention/

### Proactive updates and reporting
- **Early delay notices work.** 98% of consumers told about a late parcel in advance never contact support. This is from logistics, but it applies to late videos. https://nshift.com/blog/why-proactive-communication-is-a-game-changer-for-reducing-customer-care-costs-and-boosting-satisfaction
- **Proactive service may cut inbound contacts by 20–30%** [vendor claim, unverified]. https://www.socialintents.com/blog/proactive-customer-service/
- **Reporting cadence (AgencyAnalytics, 3.8M reports from about 7,000 agencies):** 58% of agencies send monthly reports and 15% send weekly. Clients increasingly want short updates between the big reports. https://agencyanalytics.com/blog/marketing-agency-benchmarks-client-reporting-trends

### What client portals show

| Tool | What the client sees and can do | Source |
|---|---|---|
| Productive | Free client invites. Sees only their own projects; tasks, comments, attachments, budgets, live dashboards. Internal time and financials are hidden. Shared Docs with "what was done / what's next". | https://productive.io/client-portal/ |
| monday.com (Gorilla "Client Portal Builder" app) | A board per client, or filtered items and columns. Comments with files, custom domain and branding, Google login. | https://getgorilla.app/products/client-portal/docs/getting-started |
| ClickUp | No built-in portal. Guests get view, comment or edit access to a folder, list, task, dashboard or doc. | https://fast.io/resources/clickup-client-portal/ ; https://help.clickup.com/hc/en-us/articles/6311803642903-Use-ClickUp-as-a-guest-or-limited-member |
| Accelo | Projects, tickets, Gantt milestones. File sign-offs (view, comment, approve), quote approvals, invoices. | https://help.accelo.com/guides/user/client-portal/signoffs/ ; https://www.accelo.com/features/approvals-and-signoffs |
| HoneyBook | Files, messages, signing contracts, paying invoices, project timeline with upcoming milestones, mobile. Magic-link login. | https://www.honeybook.com/blog/announcing-the-new-client-portal ; https://help.honeybook.com/en/articles/6428603-what-clients-can-see-and-do-in-the-client-portal |
| Dubsado | Contracts, invoices, files, questionnaires, scheduler with reminders. Automations triggered by client actions (signed, paid, booked). | https://www.dubsado.com/access-client-portals ; https://help.dubsado.com/en/articles/3186297-workflow-actions |

**What every portal has in common:**
1. A timeline with "what's next".
2. A list of what is waiting on the client (approve, upload, sign, pay).
3. Files.
4. One message thread.
5. Branding.
6. Login without a password.
7. Internal data hidden.

### Content approvals
- **Planable:** clients approve from a shareable link with no account. Approval can be none, optional, required or multi-level, and a post can auto-schedule once approved. https://planable.io/guides/content-approvals-in-planable/
- **Metricool (Ilai already uses it):**
  - "Send to review" goes to external reviewers by email, into a reviewer portal that needs no account.
  - Reviewers can approve in bulk and switch between list and calendar views.
  - It requires the Advanced or Custom plan.
  - https://help.metricool.com/how-to-send-posts-for-review-with-metricools-approval-system-yvdr0
- **Video review:**
  - Frame.io share links are free, need no login and support comments tied to a moment in the video. Paid plans start at $15/user/month. https://frame.io/pricing ; https://picflow.com/compare/video-review/frame-io
  - Filestage adds due dates and automatic reminders to reviewers. https://filestage.io/video-review-software/
- **Contract norms:**
  - Client feedback within about 3 business days, with 1–2 free revision rounds.
  - "No reply counts as approval" only for low-risk organic posts, agreed in advance, and never for paid campaigns.
  - https://www.kontentino.com/blog/social-media-client-approval/ ; https://onesuite.io/blog/social-media-contract-template/

### Response times
- **HubSpot:** 90% of customers rate an immediate response as essential or very important, and 60% define "immediate" as 10 minutes or less. https://blog.hubspot.com/service/customer-responsiveness
- **Social media:** 39% of users expect a reply within 60 minutes. https://blog.hubspot.com/service/social-media-response-time
- **Agency SLA practice is tiered:** urgent within about 2 business hours, standard the same business day, low priority within 1 business day. https://front.com/guides/service-level-agreement-rules ; https://sakasandcompany.com/agency-service-level-agreements/
- **Israel:** about 99% of the population uses WhatsApp (Israel Internet Association 2025 report, via JPost). https://www.jpost.com/business-and-innovation/article-871715

### NPS and CSAT surveys
- **Timing:**
  - Relationship NPS about quarterly in B2B, just before a review meeting, and at least 60 days before renewal.
  - Milestone surveys within 24–72h of the event.
  - Don't send a relationship survey right after a milestone survey.
  - https://customergauge.com/blog/relational-transactional-nps-surveys ; https://www.zonkafeedback.com/blog/relationship-transactional-nps ; https://www.gainsight.com/blog/best-time-to-send-nps-survey-how-to-maximize-responses/
- **Channel:** WhatsApp surveys reach 45–55% response in markets where WhatsApp dominates, versus 5–15% for a one-way SMS link [vendor claim, unverified]. https://www.zonkafeedback.com/blog/sms-surveys-one-way-and-two-way-vs-whatsapp-surveys

### Early-warning signals of churn
- **Signals to watch:**
  - Slower replies, and the client stops starting conversations.
  - A junior stand-in comes to meetings, or meetings are rescheduled twice.
  - Decisions and approvals get delayed.
  - Silence after a deliverable.
  - The tone of messages shifts.
  - https://agencyanalytics.com/blog/reengaging-churned-customers ; https://amplifyam.com/blog/early-warning-signs-of-churn-how-to-spot-and-address-client-risk-before-its-too-late
- **Health scores:**
  - Weight 4–6 signals into one score.
  - Gainsight's version uses sentiment, engagement, open items and response time, with red / yellow / green bands.
  - https://support.gainsight.com/Staircase_AI/Configurations/Staircase_AI_Health_Score ; https://www.gainsight.com/blog/customer-health-scores/

### Renewal
- **Typical timeline:**
  - T-120 days: health review.
  - T-90: renewal proposal.
  - T-60: handle objections.
  - T-30: sign.
  - https://swotbee.com/posts/renewal-playbook-template/ ; https://resources.rework.com/libraries/professional-services-growth/client-renewal-process
- **Quarterly reviews** are "where renewals are won or lost". Talk about results, not a list of outputs. https://almcorp.com/blog/quarterly-business-reviews-digital-agency-client-retention-template

### Channel, technical and legal facts
- **WhatsApp pricing:**
  - Billing has been per message since July 1, 2025.
  - From Oct 1, 2026, utility templates sent inside the 24h window are charged.
  - Free-form service replies are charged after the first 1,000 per month per number.
  - https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026 ; https://www.courier.com/blog/whatsapp-pricing-changes-october-2026 ; official page (not fetched): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- **Israel WhatsApp rates:** about $0.0053 per utility message and $0.0406 per marketing message [secondary, verify on Meta's rate card]. https://sleekflow.io/en-us/blog/whatsapp-business-price ; https://www.engagelab.com/blog/whatsapp-business-api-pricing
- **WhatsApp providers:**
  - Meta Cloud API direct: no platform fee.
  - 360dialog: from €49 per number per month, no markup on Meta fees. https://360dialog.com/pricing
  - Twilio: +$0.005 per message on top of Meta's fee. https://www.twilio.com/en-us/whatsapp/pricing
- **Groups API limits:**
  - Only Official Business Accounts can use it.
  - Max 8 participants per group.
  - There is no endpoint to add participants directly.
  - So it cannot automate Irit's existing client groups.
  - https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026 ; https://developers.facebook.com/documentation/business-messaging/whatsapp/groups
- **Unofficial automation is banned.** Automating the regular WhatsApp app with unofficial tools violates WhatsApp's terms and the number can be banned. https://faq.whatsapp.com/1217634902127718 ; https://oncloudapi.com/blogs/whatsapp-api-ban-risk-official-cloud-api-vs-unofficial-apis
- **Supabase:**
  - pg_cron + pg_net can call Edge Functions on a schedule, with keys stored in Vault. https://supabase.com/docs/guides/functions/schedule-functions
  - Edge Functions: 500K invocations free, 2M on Pro ($25/month). https://supabase.com/docs/guides/functions/pricing ; https://supabase.com/pricing
  - Email magic link and OTP are built in. https://supabase.com/docs/guides/auth/auth-email-passwordless
  - Phone OTP over WhatsApp works only with Twilio or Twilio Verify. https://supabase.com/docs/guides/auth/phone-login
- **iPhone push:** iOS 16.4+ supports Web Push for web apps added to the Home Screen. Staff can get free reminders even when the page is closed. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- **Israeli holidays:** the Hebcal REST API returns Israel holidays as JSON (`i=on`, with a `yomtov` flag). https://www.hebcal.com/home/195/jewish-calendar-rest-api
- **Privacy law:**
  - Amendment 13 to the Privacy Protection Law took effect on Aug 14, 2025. The 2017 Data Security Regulations still apply.
  - Fines for small businesses are capped at about ₪140K per year [secondary].
  - https://www.pearlcohen.com/israel-significant-amendment-to-the-privacy-law-takes-effect/ ; https://www.clym.io/blog/amendment-13-israels-updated-privacy-protection-law-and-what-businesses-must-do-now
- **Anti-spam law:** Communications Law section 30A requires prior written consent for commercial messages. https://www.law.co.il/en/news/2016/08/19/israeli-anti-spam-law-amended-for-first-time/ Whether renewal or upsell messages count as "advertising" is my interpretation [unverified, ask a lawyer]. Add a consent line to the quote the client signs.

---

## 3. Recommendations for Astrateg

### 3.1 The client journey: automatic touchpoints (mapped to protocol v4 owners)

Each line lists the trigger, the owner, the message to the client, and the internal reminder and escalation.

1. **Quote signed** (the client card already opens automatically)
   - **Owner:** Irit.
   - **Client:** a welcome within 24h that names the contacts, gives the first 3 dates, and promises the Thursday update.
   - **Internal:** if it isn't sent by the end of the day, Irit gets a reminder. The next day it escalates to Lior.
2. **Collecting access**
   - **Owner:** Irit, with Ilai checking the access and setting up pages.
   - **Client:** a checklist with progress ("3 of 5 received") and a reminder every 2 business days.
   - **Internal:** after 7 business days it escalates to Lior.
3. **Characterization meeting**
   - **Owner:** Ofir.
   - **Client:** a confirmation plus a reminder 24h before. Within 1 business day after the meeting, a short "what we understood about your business" summary. This answers the "didn't understand our business" churn reason (44%).
4. **Scripts and Zoom approval**
   - **Owner:** Lior.
   - **Client:** an approval link with a deadline tied to the shoot date, plus a reminder the day before the deadline.
   - **Internal:** the clock stops while the item is "waiting on client".
5. **Shoot day** (the peak moment)
   - **Owners:** Lior as shoot manager, Eli as photographer, plus the influencer.
   - **T-3:** a preparation checklist to the client.
   - **T-1:** time, address and who is coming.
   - **On the day:** a photo from the set.
   - **T+1:** a thank-you, a one-question CSAT, and "first videos by date X".
6. **Editing**
   - **Owners:** Nadia, Yariv, Anna and Nirel; QA by Ofir.
   - **Internal:** a reminder to the editor at the end of day 2. On day 3, if the videos aren't in Drive, it goes to Ofir. At day 4 without closing, it goes to Lior.
   - **Client:** a review link with a deadline and "fix round 1 of 2". Promise the client a date with a buffer beyond the internal target.
7. **Scheduling and posting**
   - **Owner:** Ilai, in Metricool.
   - **Client:** approval through Metricool's reviewer portal or the Astrateg page. When the first post goes live, send a "first post is live" message as the quick win.
8. **Every Thursday**
   - **Owner:** Ofir.
   - **Client:** a 3-line status that the system pre-fills from protocol data: what we did / what's next / what we need from you. Ofir edits it and sends with one tap.
9. **Days 30, 60 and 90**
   - **Owners:** Lior; at day 90, Adam calls in person.
   - **Client:** a short check-in plus a pulse survey after month 1.
10. **Renewal** (compressed for monthly or short packages)
    - **T-45:** results recap plus NPS.
    - **T-30:** renewal proposal through the existing quotes and signing system.
    - **T-14:** follow-up.
    - **T-7:** Adam calls if it isn't signed.
11. **A deadline at risk**
    - **Owner:** whoever owns the item.
    - **Trigger:** 1 business day before an internal deadline that's at risk.
    - **Client:** the system suggests a proactive delay message. Send it before the deadline, never after.

### 3.2 Ready-to-send message templates (Hebrew, placeholders in braces)

- **Welcome:** «היי {שם}, שמחים שהצטרפת לאסטרטג. עירית מלווה אותך ביום-יום, וליאור אחראי על התוכן והקמפיינים. השלבים הקרובים: 1) השלמת גישות לעמודים – עד {תאריך}; 2) פגישת אפיון עם אופיר – {תאריך}; 3) יום צילום – יעד {תאריך}. בכל יום חמישי יגיע אליך סיכום קצר: מה עשינו, מה הלאה, ומה אנחנו צריכים ממך.»
- **Access reminder:** «היי {שם}, התקבלו {x} מתוך {y} גישות. חסר: {רשימה}. ברגע שנקבל אותן נוכל לקבוע את יום הצילום.»
- **Script approval:** «התסריטים מוכנים לאישורך: {קישור}. נשמח לאישור עד {תאריך} כדי לשמור על יום הצילום ב-{תאריך}.»
- **Day before the shoot:** «מחר מצטלמים! {שעה}, {כתובת}. אלי הצלם יגיע שעה לפני כדי להכין את הסט. כדאי להכין: {רשימה}.»
- **After the shoot:** «תודה על יום צילום מעולה. שאלה אחת קצרה: מ-1 עד 5, כמה היית מרוצה מיום הצילום? הסרטונים הראשונים יגיעו עד {תאריך}.»
- **Videos for approval:** «{n} סרטונים מוכנים לצפייה: {קישור}. אפשר לאשר או לכתוב תיקונים עד {תאריך} (סבב תיקונים {k} מתוך 2).»
- **Thursday status:** «סיכום שבועי – {לקוח}: ✔ השבוע: {…} ➜ בשבוע הבא: {…} ⏳ צריכים ממך: {…}» (the ✔ ➜ ⏳ symbols can be swapped for plain text)
- **Proactive delay:** «רצינו לעדכן מראש: {פריט} יגיע ב-{תאריך חדש} במקום {תאריך}, בגלל {סיבה}. כדי שלא תפסיד/י, {פעולה מפצה}.»
- **Pre-renewal NPS:** «מ-0 עד 10, כמה סביר שתמליץ/י על אסטרטג לחבר בעל עסק? ומה דבר אחד שהיה הופך אותנו למושלמים?»

### 3.3 Features by priority

**Phase 1: weeks 1–4, no new vendors**
- **Server-side reminder engine.**
  - How it runs: pg_cron every 10–15 minutes, then an Edge Function.
  - Business days: Sun–Thu, with holidays loaded from Hebcal and cached in a table.
  - What it computes: which protocol items are due, overdue or at risk.
  - How staff are reached: Web Push on phones (free, needs the app added to the Home Screen) plus the existing morning digest.
  - Escalation ladder: item owner, then Ofir or Lior, then Adam.
- **"Waiting on client" status with its own clock.**
  - The internal SLA clock stops while the client is responsible.
  - The client gets reminders during that time.
  - Performance scores stay fair to staff.
- **One-tap sending of templates.**
  - How it works: a wa.me link with the message pre-filled, or copy the text.
  - Result: messages go from Irit's or Ofir's own WhatsApp, costing nothing and carrying no ban risk.
- **Thursday status composer**, pre-filled from what was completed, what's due next week, and what is open on the client's side.
- **Owner dashboard: one row per client** showing:
  - Stage.
  - Next milestone with its date.
  - Overdue items.
  - Waiting-on-client items.
  - Days since the last client touchpoint.
  - Health light.
  - Keep it to at most 5 numbers at the top.

**Phase 2: weeks 5–8**
- **Client status page** (Hebrew, right-to-left, branded, mobile), opened from a WhatsApp link:
  - A stage bar and the next 3 milestones with dates.
  - A "what we need from you" checklist.
  - The latest Thursday status.
  - Links to videos in Drive.
  - Access: a signed link that expires and can be revoked, or Supabase email OTP, with database security rules limiting each client to their own data.
  - Hidden: internal deadlines, staff performance, costs.
- **Approvals.** Videos: approve or request a fix, with a comment and revision counter, on the page itself or through free Frame.io links. Posts: Metricool's reviewer portal (check that Astrateg's Metricool plan includes approvals).
- **Pulse surveys.** A one-question CSAT the day after the shoot and after month 1. NPS at T-45 and roughly every quarter. Delivered by WhatsApp link and stored per client.
- **Health score** (section 3.4).

**Phase 3: month 3 onward, only if volume justifies it**
- **Official WhatsApp Business Platform** on a dedicated business number, never Irit's personal one. Use it for automated 1:1 client notices and staff reminders. Client groups stay manual (the Groups API limits make it unsuitable).
- **Renewal automation** connected to the quotes system, plus a monthly results report (Metricool plus Meta).

### 3.4 Health score (my suggested weights; recalibrate after 3 months)

| Signal (automatic unless noted) | Weight |
|---|---|
| Overdue protocol items on Astrateg's side for this client | 25 |
| Latest CSAT or NPS (CSAT of 3 or less, or NPS of 6 or less, counts against) | 20 |
| Client's average approval time vs. the agreed time | 15 |
| More than 2 revision rounds on videos | 10 |
| Access still missing after 7 business days | 10 |
| Irit's weekly mood flag, green / yellow / red with a one-line reason (manual) | 20 |

- **75 or above:** green.
- **50–74:** yellow, reviewed in Ofir's daily control.
- **Below 50:** red. Lior calls within 1 business day. Red two weeks in a row: Adam calls.

### 3.5 Response-time promise (put it in the welcome message and the contract)

- **When it applies:** business hours, Sun–Thu; the exact hours are Adam's decision.
- **Standard:** acknowledge within 2 business hours, answer or solve within 1 business day.
- **Urgent** (wrong post live, campaign broken): Lior within 1 hour.
- **How to measure it:**
  - Phase 1: Irit logs each "client request" with one tap, which starts the clock.
  - Phase 3: automatic measurement through the API (1:1 conversations only).

---

## 4. Costs

| Item | Cost |
|---|---|
| pg_cron, pg_net, Edge Functions | Included in Supabase. Pro at $25/month is recommended for business-critical reminders; free projects can pause when inactive [unverified]. |
| Web Push for staff, wa.me one-tap, Hebcal API, in-house surveys, status page | $0 |
| WhatsApp official, Meta fees | About $0.0053 per utility message in Israel. Example: 30 clients × 12 messages/month plus 10 staff × 44 reminders/month is about 800 messages, roughly **$4–5/month**. Marketing templates are about 8x more expensive. |
| WhatsApp provider | Meta direct: $0 platform fee. 360dialog: €49/month. Twilio: +$0.005 per message. |
| Frame.io | Free share links; Pro $15/user/month. |
| Metricool approvals | Needs the Advanced plan or higher [plan price not verified]. |

---

## 5. Pitfalls

- **A portal nobody opens.** Every client-facing page must open from a WhatsApp link and make sense in 10 seconds on a phone.
- **Over-messaging.** Bundle updates into the Thursday status. At most one automatic client message per day, approvals excepted.
- **Unofficial WhatsApp automation** (linked-device tools and the like) can get Irit's number banned. That would mean losing every client group.
- **Measuring staff without the "waiting on client" pause** gives unfair performance scores, and staff will resist the system.
- **"No reply counts as approval"** must be in the contract, and only for organic posts. Never for Meta campaigns or Channel 14 TV.
- **Survey fatigue.** Leave about 2 weeks between a CSAT and an NPS. After a known failure, fix it and follow up before sending any survey.
- **Meta can reclassify templates.** If a "utility" template reads as promotional, Meta can charge it as marketing. Keep renewal and upsell messages as manual sends or as approved marketing templates, and have client consent (anti-spam law).
- **Pricing changed on Oct 1, 2026.** Service replies beyond 1,000 per month per number are now charged.
- **Public repo:**
  - Keep templates, client data and schedules in the database, not the repo.
  - Keep API tokens in Supabase Vault or Edge Function secrets.
  - No phone numbers, emails or costs in code.
  - Status-page links must be unguessable, expiring and limited to one client.
  - Log who viewed what, in line with Amendment 13 and the security regulations.
- **Holiday edge cases.** Decide a policy for holiday eves (half day or not) and code it once in the business-day calculator.
- **Promised dates vs. internal targets.** Show clients promised dates that include a buffer. If internal targets were shown, every small slip would look like a broken promise.

---

# Owner control without micromanaging: research for Astrateg

**How this was researched.** WebFetch was blocked by the egress proxy for every domain I tried (businessmap.io, getnave.com, help.asana.com, support.atlassian.com, productive.io, perceptualedge.com, supabase.com, hebcal.com, wikipedia). The WebSearch budget ran out partway through. So each claim below rests on the search-engine summary of the page it cites, not a full read. Anything that comes only from third-party or vendor-marketing summaries is marked **[unverified]**. I also read the repo (`/home/user/---`) so the recommendations build on what already exists.

---

## 1. Key findings (with sources)

### A. Management by exception
- Management by exception (MBE) means only significant deviations from plan reach management, so the manager's attention goes only where action is needed ([AccountingTools](https://www.accountingtools.com/articles/what-is-management-by-exception.html)).
- It has four steps: set targets, monitor automatically, alert on deviation, intervene only on the alert ([Tallyfy](https://tallyfy.com/management-by-exception/)).
- Thresholds need to be reviewed from time to time. Otherwise you get either noise or missed problems ([myshyft](https://www.myshyft.com/blog/exception-based-reporting/), [AccountingTools](https://www.accountingtools.com/articles/what-is-management-by-exception.html)).
- Lean "visual management" says the same thing: the display should make "normal vs abnormal right now" obvious at a glance ([Learn Lean Sigma](https://www.learnleansigma.com/lean-manufacturing/visual-management-explained-how-to-make-problems-visible-in-lean/), [Tractian](https://tractian.com/en/glossary/visual-management)).
- A common rule of thumb is "1-3-10": the purpose is clear in 1 second, the current condition in 3, the countermeasures in 10. **[unverified: the search did not show which page states it]**

### B. Dashboard design for "at a glance"
- Stephen Few defines a dashboard as "a visual display of the most important information needed to achieve one or more objectives; consolidated and arranged on a single screen so the information can be monitored at a glance" ([Perceptual Edge course PDF](https://www.perceptualedge.com/files/Dashboard_Design_Course.pdf), [Dashboard Confusion Revisited](http://perceptualedge.com/articles/visual_business_intelligence/dboard_confusion_revisited.pdf)).
- Two of Few's 13 pitfalls apply directly here: going beyond a single screen, and showing too much detail or precision ([Common Pitfalls PDF](https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf), [The Data School summary](https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/)).

### C. Bottleneck and aging detection (flow metrics)
- An **aging WIP chart** shows only in-progress items. Stages are on the x-axis and days in the current stage on the y-axis. Percentile lines (such as 50th and 85th) flag items taking longer than usual *while they are still in progress*, so you can act before they are late ([Kanbanize KB](https://knowledgebase.kanbanize.com/hc/en-us/articles/115001141531-The-Aging-Work-In-Progress-chart), [Businessmap](https://businessmap.io/kanban-resources/kanban-analytics/kanban-aging-wip), [Nave](https://getnave.com/blog/aging-work-in-kanban/), [Kanban Zone](https://kanbanzone.com/2019/aging-work-in-progress/)).
- Nave argues that WIP age is the one metric to start with ([Nave](https://getnave.com/blog/start-with-wip-age/)).
- **Little's Law** (WIP = throughput × cycle time): the more you have in progress, the longer each item takes. If cycle times are too long, first reduce WIP ([Businessmap](https://businessmap.io/continuous-flow/littles-law), [Kanban Zone](https://kanbanzone.com/resources/lean/littles-law/), [Scrum.org](https://www.scrum.org/resources/blog/professional-scrum-kanban-psk-dont-just-limit-wip-optimize-it-post-1-3)).
- In a cumulative flow diagram, a band that keeps widening is the classic sign of a bottleneck: work enters that stage faster than it leaves ([Atlassian CFD docs](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-cumulative-flow-diagram/), [Atlassian server docs](https://confluence.atlassian.com/jirasoftwareserver/cumulative-flow-diagram-938845656.html)).
- Good standups "walk the board right to left": start with what is closest to done and with blocked or aging items, instead of asking each person for a report ([Brodzinski](https://brodzinski.com/2011/12/effective-standups.html), [Scrum.org](https://www.scrum.org/resources/blog/daily-scrums-kanban), [Martin Fowler](https://martinfowler.com/articles/itsNotJustStandingUp.html)).

### D. SLA compliance mechanics (Jira Service Management as the model)
- An SLA has start, pause and stop conditions and runs on a **calendar with working hours and holidays**. Pausing on statuses like "Waiting for customer" is standard, and the pause pushes the deadline out ([Atlassian SLA docs](https://confluence.atlassian.com/servicedeskcloud/slas-732528967.html), [ResumeLens explainer](https://www.resumelens.org/blog/jira/jira-service-management-sla)).
- JSM separates "breached" from "at risk". The claim that at-risk defaults to 20% of the time remaining comes only from a third-party explainer **[unverified]** ([ResumeLens](https://www.resumelens.org/blog/jira/jira-service-management-sla)).
- The SLA-aware "time to resolution" report respects the business calendar. The plain "resolution time" report counts 24/7 ([Atlassian KB](https://support.atlassian.com/jira/kb/the-difference-between-resolution-time-and-time-to-resolution-in-jsm/)).

### E. Workload and capacity
- Asana Workload shows each person's load across projects, by task count or by effort. Once a manager sets a capacity per person, anyone over it gets a **red line** ([Asana Workload](https://asana.com/features/resource-management/workload), [Asana help](https://help.asana.com/s/article/manage-workload?language=en_US), [Asana blog](https://blog.asana.com/2019/07/workload-effort/)).

### F. Digests
- Asana merges "due today" notifications into one Daily Summary. The email version covers tasks due in the next 5 days plus overdue tasks. Asana also offers weekly reports ([Asana forum: daily summary](https://forum.asana.com/t/new-daily-summary-inbox-notification/102655), [overdue in daily summary](https://forum.asana.com/t/include-overdue-tasks-in-daily-summary/47709), [notification settings](https://help.asana.com/s/article/notification-settings)).

### G. Audit trail and accountability
- monday.com's board Activity Log records, for every change: when, who, which item and column, the old value and the new value. Changes made by automations show with a **robot icon** instead of a person ([monday support](https://support.monday.com/hc/en-us/articles/115005310745-The-Activity-Log)).
- The account-level security Audit Log is Enterprise-only ([monday Audit Log](https://support.monday.com/hc/en-us/articles/360001259429-The-Audit-Log)).
- **One owner per task (DRI)**: shared ownership usually means nobody owns it. Productive deliberately allows only one assignee per task ([Productive](https://productive.io/blog/one-task-one-assignee-apple-method/), [Productive help](https://help.productive.io/en/articles/5623598-why-can-t-i-assign-multiple-assignees-to-a-task), [Tettra](https://tettra.com/article/directly-responsible-individuals-guide/)).

### H. Status colors: use rules, not opinions
- Asana projects and portfolios use on track / at risk / off track / on hold / complete. "At risk" examples include missed due dates and delayed client approvals ([Asana status updates](https://asana.com/features/project-management/status-updates), [Asana portfolio guide](https://www2.asana.com/guide/help/premium/portfolios-status-updates)).
- Red/amber/green status is subjective and tends toward "watermelon" reporting: green outside, red inside. The recommended fix is to require observable evidence for each color ([Cultivated Management](https://www.cultivatedmanagement.com/watermelon-reporting/), [Tempo](https://www.tempo.io/blog/rag-status)).
- Customer-success tools compute a **health score** from 4 to 6 signals, shown as red/yellow/green. Each signal is rule-based, for example "red if an escalation is open" ([Gainsight](https://www.gainsight.com/blog/customer-health-scores/), [Gainsight scorecards](https://www.gainsight.com/blog/scorecards-quantifying-customer-health/)).

### I. Gantt vs board vs timeline
- Gantt charts suit planning, dependencies and committing to dates. Kanban boards suit daily flow, parallel work and spotting bottlenecks. Most teams plan in a Gantt and run the day on a board ([Smartsheet](https://www.smartsheet.com/content/gantt-vs-kanban), [monday.com](https://monday.com/blog/rnd/gantt-vs-kanban/), [Aha!](https://www.aha.io/blog/gantt-charts-and-kanban-boards-what-are-they-good-for)).

### J. Agency KPIs, leading vs lagging
- Leading indicators are inputs you can still influence. Lagging indicators are outcomes that only tell you what already happened ([Intrafocus](https://www.intrafocus.com/lead-and-lag-indicators/), [Whatfix](https://whatfix.com/blog/leading-vs-lagging-indicators/)).
- Agency benchmarks from vendor blogs **[unverified; not studies]**:
  - On-time delivery above 85%; below 80% points to a scope, resourcing or approval problem.
  - About 2 to 3 revision rounds per deliverable; more than 3 points to an unclear brief or weak internal QA.
  - First-time approval rate of 85% or more.
  - Sources: [ManyRequests](https://www.manyrequests.com/blog/kpi-reports), [Screendragon](https://www.screendragon.com/blog/top-agency-kpis-metrics/), [Atlassian creative ops](https://www.atlassian.com/agile/design/creative-operations).
- Delays usually come from waiting for approvals, not from doing the work. Agencies write client review SLAs into contracts, such as 2 to 3 business days and one consolidated round of feedback ([Workzone](https://www.workzone.com/blog/client-approval-process-agencies/), [Kontentino](https://www.kontentino.com/blog/social-media-client-approval/), [Sakas & Co](https://sakasandcompany.com/agency-service-level-agreements/)).
- The claim that approval turnaround drops from 5–7 days to 1–2 is vendor marketing **[unverified]**.

### K. Pitfalls in the literature
- **Goodhart's law**: "When a measure becomes a target, it ceases to be a good measure." People game metrics that are tied to rewards ([DevIQ](https://deviq.com/laws/goodharts-law/), [Jellyfish](https://jellyfish.co/blog/goodharts-law-in-software-engineering-and-how-to-avoid-gaming-your-metrics/)).
- **Alert fatigue**: frequent, non-actionable alerts get skimmed or ignored, including the important ones ([Atlassian](https://www.atlassian.com/incident-management/on-call/alert-fatigue), [BMC Systematic Reviews protocol](https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-017-0627-z), [MeisterTask](https://www.meistertask.com/blog/notification-fatigue-the-productivity-killer-explained)).
- A "30% lower acceptance per repeated reminder" figure turned up in a search summary without a traceable study **[unverified]**.

---

## 2. What Astrateg already has (from the repo), and the gaps

Already built. This is more than most agencies have, so extend it rather than replace it:
- **Business-day calendar with Israeli holidays:** `app/holidays.js` (covers 2026-01-01 to 2028-12-31), plus `addBusinessDays` and `businessDaysBetween` in `app/protocol-logic.js`.
- **"Waiting on client"** (`waitOf`, with a reason and a recheck date) and **"paused"** (`pauseOf`). These are the same idea as the JSM SLA pause.
- **Audit trail:** the `protocol_log` table records client, item, action (done / na / clear), who and when. `client_access_log` does the same for the access vault.
- **`performanceReport()`:** on-time % and median start-to-finish time per process and per person over 30 days.
- **Tabs** in `app/clients.js`: `mine`, `clients`, `control`, `performance`. Daily control reviews are stored in `office_reviews` (kinds p32 and p33).
- **Shared logic:** `protocol-logic.js` depends only on `protocol.js`, `catalog.js` and `holidays.js`, and none of these import anything else. A Supabase Edge Function (Deno) could therefore run **the same logic** for server-side reminders, so screens and digests never disagree.

Gaps for "control at a glance":
1. No owner screen that shows exceptions only.
2. No time-in-current-stage measured against a norm (aging).
3. No computed per-client health color with a stated reason.
4. No server-side scheduler or digest.
5. No weekly trend snapshots.
6. Client fixes are a checkbox (for example `p27.fixes`), not a count, so revisions per video cannot be measured.
7. No deal-to-first-shoot metric.
8. `na` (marked "not applicable") and due-date changes are not surfaced, which leaves room for gaming.
9. Needs checking: whether client-wait time is excluded from on-time %. `performanceReport` compares `completedAt <= dueAt`.

---

## 3. The minimal set: 3 screens and 2 digests

### Screen 1. Adam's "what needs me" (exceptions only; opens by default for the owner, phone first)
- **Top row, 4 numbers only:**
  - Clients red / amber / green.
  - Overdue items now.
  - On-time % over the last 30 business days, with an 8-week sparkline.
  - Shoot days in the next 7 days.
- **Below, at most about 10 rows**, sorted by severity and then by business days late:
  1. **Past deadline:** client, step, **one name**, "late by N business days".
  2. **Stuck:** days in the current stage above the norm (the protocol SLA, such as editors' 3 business days to Drive and 4 to close; later the historical 85th percentile once there are about 20 or more completions per stage).
  3. **Waiting on client more than 2 business days:** shown in a separate color from "we are late".
  4. **Open escalations** to Lior.
  5. **Process compliance:** daily control (every 2 days) not done, or Thursday status notes missing for some clients.
  6. **Silent client:** an active client with no `protocol_log` event in X business days (the data may be stale).
- **Each row** has one tap to open the item and one tap to open a WhatsApp message to the owner of the item (the `whatsappLink` helper already exists).
- **When nothing is wrong**, the screen says "Everything is on schedule" and stays empty. That empty screen is how MBE is supposed to work.

### Screen 2. "Clients at a glance" (portfolio; one row per client)
Each row shows:
- Client name, package, and contract month (for example "month 2 of 12").
- A **phase strip**: Onboarding, Characterization, Scripts / Zoom, Shoot day, Editing, QA (Ofir), Posting, Monthly routine. The current phase is highlighted.
- **Health color with a one-line reason**, computed by rule, never set by hand.
- Days in the current phase, the next milestone with its date and owner, and a waiting-on-client marker.
- Deliverables pacing, for example "videos 18/36, graphics 9/12, this month's posts 14/20".

Red rows come first. Use a phase strip for the owner, not a Gantt: a Gantt shows too much detail for this purpose (Few's pitfalls). Keep the Gantt where it belongs, in Ilai's monthly posting schedule. A stage board across all clients, with an age on each card, is useful for Ofir and Lior, not for Adam.

### Screen 3. Client card (exists; add a header and a timeline)
- **A 3-line header:**
  1. Color and why, for example: "Red: video editing 2 business days late (Nadia)."
  2. Now: current step, who, due date.
  3. Next: the next milestone or shoot day, plus any open wait on the client.
- **A vertical timeline:**
  - Done: from `protocol_log`, with who and when. Automatic actions get their own marker, like monday's robot icon.
  - Now.
  - Planned: future due dates from `resolveTime`.
- This is the "understand a client in 10 seconds" view.

### Optional Screen 4. Team load (for Adam and Lior; weekly use)
- **Per person:** open items, overdue items, due this week, on-time % over 30 days, and median time vs the norm.
- **Editors:** videos in progress and days since assignment vs the 3/4 business-day SLA.
- **Overload** is a red line: count items against a set limit per person, for example open videos per editor. Use counts, because there is no time tracking. This mirrors Asana Workload.
- **Visibility:** role-scoped. Employees see only their own row. Avoid public ranking.

### Digest 1. Daily, 08:30 Sunday to Thursday, skipping holidays
- **Per person:** overdue, today, tomorrow, and what they are waiting on from the client. This is the existing copyable morning summary, sent automatically from the server instead.
- **Adam:** exceptions only, at most 10 lines, with a link to Screen 1.

### Digest 2. Weekly, Thursday afternoon, to Adam
Timed to follow Ofir's Thursday status notes. It contains:
- The KPIs compared with last week.
- Clients whose color changed.
- The top 3 bottleneck stages: the most items above the norm, or a growing queue (the idea behind a cumulative flow diagram, sent as a sentence rather than a chart).
- On-time % per person.
- The count of `na` marks and due-date changes this week.

---

## 4. Metric definitions for Astrateg

All metrics count business days and exclude time spent waiting on the client, unless the line says otherwise.

**Leading (daily; you can still act on these):**
1. Items older than the stage norm (the aging signal).
2. Client response delay: open waits and their age; the target is 2 business days or less, and it should be written into the contract.
3. Editor queue: videos not in Drive by business day 3 after assignment.
4. Access status `broken` or `missing` for more than 1 business day (it blocks posting and Meta campaigns).
5. Scripts approved at least X business days before the shoot, and a shoot date set within N days of signing.
6. Process compliance: daily control done on schedule, and Thursday notes posted for 100% of active clients.

**Lagging (weekly or monthly):**
1. On-time delivery %. Start with a target of 85% or more and raise it once the data is trusted **[the target is an unverified benchmark]**.
2. Deal to first shoot: median business days from e-signature, since signing already opens the client.
3. Revisions per video: an average of 2 or fewer is healthy; more than 3 means a brief problem, which is especially relevant to Nirel, who needs precise briefs. **This needs a counter field.**
4. Deliverables delivered vs the package, per month.
5. Renewals and churn.

**Health rule (computed, with a stated reason):**
- **Red** if any of these is true:
  - A critical-path item is more than 2 business days overdue.
  - A shoot date has slipped.
  - Deliverables are behind the monthly pace by more than X.
  - Access has been broken for more than 2 business days.
  - An escalation is open.
- **Amber** if any of these is true:
  - An item is due within 1 business day and has not started.
  - A client wait is older than 2 business days.
  - A video is on its 3rd or later revision.
  - The client is silent (no activity in X business days).
- **Green** otherwise.

---

## 5. Build order and costs

1. **Phase 1: screens 1–3 and the health rule** (client-side only, using the existing data). Cost: none.
2. **Phase 2: server engine.**
   - Supabase pg_cron plus pg_net calls an Edge Function that imports the shared `protocol-logic.js`. It writes a `daily_snapshot` table for trends and sends the digests ([Supabase docs](https://supabase.com/docs/guides/functions/schedule-functions)).
   - pg_cron runs in UTC ([Crontap guide](https://crontap.com/guides/supabase-cron-jobs)). Israel moves between UTC+2 and UTC+3, so the function should check the local hour in `Asia/Jerusalem` and skip Friday, Saturday and holidays.
   - Failures show up in two places: `cron.job_run_details` and the function logs.
   - Cost: included in the plan. Pro is $25/month per organization with about 2M Edge Function calls **[unverified; third-party: [UI Bakery](https://uibakery.io/blog/supabase-pricing)]**.
3. **Phase 3: WhatsApp delivery** through the Cloud API using utility templates.
   - Israel's utility rate is about $0.0053 per message and marketing about $0.0353 **[unverified; aggregators: [Sleekflow](https://sleekflow.io/en-us/blog/whatsapp-business-price), [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing); official rate card: [Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)]**.
   - About 10 staff × 21 business days × 1–2 messages is roughly $1–3 per month in Meta fees, before any provider (BSP) fee **[unverified]**.
   - Meta's pricing changes on 2026-10-01, 2 days after this report ([Meta page on the change](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)). Confirm the rates before building.
   - Also needed: a dedicated number, Meta business verification, and templates approved by Meta.
   - Until then, use Web Push or email. The app already has a `.webmanifest`.
4. **Phase 4: new data capture.** A revision counter per video, a timestamp on deal-to-shoot, and a log entry for every due-date change with a reason.

---

## 6. Pitfalls specific to Astrateg

- **Stale data looks like control.** Staff live in WhatsApp. If they do not mark items in the system, the dashboard is wrong while looking right (the watermelon problem). Mitigations: make marking done one tap from the digest, show "last updated" on each client, and flag silent clients as amber.
- **Too many alerts.** Send one scheduled digest per person, not a message per item. Real-time pings only for escalations and shoot-day problems.
- **Goodhart.** If on-time % affects pay, people will push due dates, mark items `na`, or close work early. Log every due-date change and `na`, and show their counts weekly. Pair speed metrics with quality metrics (revisions, Ofir's QA rejections).
- **Blaming the team for client delays.** Waiting on the client must never count as "late" for staff. Keep it in a separate color and a separate metric, like the JSM pause.
- **Shared ownership.** Every row shows one name, and a shared process shows whoever claimed it (`claimOf`).
- **Public repo.**
  - Never hardcode phone numbers or emails in the Edge Function. Keep them in an RLS-protected table.
  - Keep WhatsApp and API tokens in Edge Function secrets or Vault.
  - Keep per-person performance data behind RLS.
- **Holiday calendar runs out.** `holidays.js` stops at 2028-12-31. Add an alert to the owner digest when it is 90 days from the end. The free Hebcal API needs no key, has an Israel-schedule option, and could automate the update ([Hebcal](https://www.hebcal.com/home/developer-apis)).
- **Scope creep.** Few's "one screen" rule applies. Screen 1 is not a place for charts. Aging and flow charts belong to Ofir and Lior.

Repo files referenced: `/home/user/---/app/protocol-logic.js`, `/home/user/---/app/holidays.js`, `/home/user/---/app/clients.js`, `/home/user/---/app/protocol.js`, `/home/user/---/supabase/migrations/20260929120000_client_protocol.sql`, `/home/user/---/supabase/migrations/20260929180000_protocol_batch3.sql`

---

# Research: an operations system Astrateg's staff will actually use (adoption, checklists, reminders, accessibility)

## Method and source labels

- **Limits in this session.** The session's shared web-search budget ran out after 4 searches. WebFetch and curl were blocked for every outside site except GitHub raw files. So I read authoritative sources through their public GitHub copies: the W3C WCAG 2.2 repo, MDN browser-compat-data, the GOV.UK Design System and the Tallyfy docs. I read Supabase's docs through the Supabase docs tool.
- **[read]**: I opened the full text.
- **[search summary]**: I only saw a search-engine summary, so it carries less weight.
- **[unverified]**: from memory, not checked this session.
- **[code]**: something I saw in this repo.

---

## 1. Key findings

### A. Adoption and change management
- **Visible sponsorship matters most.** In Prosci's studies, projects with extremely effective sponsors met their objectives 73–79% of the time. With very ineffective sponsors the figure was 27–29%. Sponsorship came out as the top success factor in 11 of 11 studies, 4 times more often than the next factor. Organisations with excellent change management were 7 times more likely to meet objectives. [search summary] [Prosci best practices](https://www.prosci.com/blog/change-management-best-practices), [Prosci success](https://www.prosci.com/change-management-success)
  - For Astrateg: Adam is the sponsor. He has to ask for status from the system, not on WhatsApp.
- **People keep using a tool if they find it useful.** In the Technology Acceptance Model (Davis 1989, doi:10.2307/249008), "perceived usefulness" predicts use more strongly than "ease of use". [unverified]
  - For Astrateg: every screen must save each person time from day 1, for example the morning list and auto-filled dates. A screen that only serves control will be avoided.
- **Tallyfy's advice on getting tasks done:**
  - Explain *why* each task matters.
  - Pair digital reminders with personal follow-up for critical delays: calls, team meetings, chat nudges.
  - Keep tasks meaningful, because too many small ones cause "approval fatigue".
  - [read] [Tallyfy: Ensure task completion](https://github.com/tallyfy/documentation/blob/HEAD/src/content/docs/pro/tutorials/how-to/ensure-task-completion.mdx)

### B. Checklist design (Checklist Manifesto, Gawande with Boeing's Daniel Boorman)
- **Two checklist types.** With READ-DO, people do each step as they read it, like a recipe. With DO-CONFIRM, people work from memory, then pause and confirm. [search summary] [Sketchplanations](https://sketchplanations.com/read-do-do-confirm-checklists), [runn.io summary](https://www.runn.io/blog/the-checklist-manifesto-summary). The same point appears in a secondary full-text summary [read]: [book summary](https://github.com/chintaal/textbook-app/blob/HEAD/KnowledgeBaseParsing/San/The%20Checklist%20Manifesto.md)
- **Rules for writing one** (same sources):
  - Define a clear "pause point".
  - Keep it to 5–9 items. After 60–90 seconds people start taking shortcuts.
  - Include only "killer items": the steps most dangerous to miss that still get missed.
  - Checklists "are not supposed to be how-to guides".
  - Use simple, exact words the users already use. Fit on one page. Avoid clutter and colour.
  - Test it with real users, then revise.
  - Involve the team in writing it.
  - Also: [ProjectManagement.com](https://www.projectmanagement.com/blog-post/21259/creating-a-killer-checklist--lessons-from--the-checklist-manifesto-) [search summary], [Checklist for checklists (paraphrase)](https://github.com/ryangclark/djibb/blob/HEAD/docs/seeds/checklist-for-checklists.md) [read, secondary]
- **Name who calls the pause.** In WHO simulations the team found nobody had been named to start the checklist. They gave that job to the circulating nurse. [read, secondary summary above]
- **Results.** The final WHO checklist had 19 checks at 3 pause points and took about 2 minutes. In 8 hospitals, major complications fell 36% and deaths fell 47%. [read, secondary] The primary paper is Haynes et al., NEJM 2009, doi:10.1056/NEJMsa0810119. [unverified]

### C. Reminders and alert fatigue
- **Escalate only the 2–3 steps that matter.** Tallyfy puts escalation on single steps: "attach escalation to the two or three steps where being late actually costs you something, so nobody gets buried in alerts about the other 37." Only the deadline decides "overdue"; a start time is just a suggestion. [read] [Tallyfy escalation](https://github.com/tallyfy/documentation/blob/HEAD/src/content/docs/pro/tracking-and-tasks/tasks/task-escalation-for-overdue-items.mdx)
- **Digests instead of a stream.** Tallyfy's reminders are a digest at 6 AM local time with tasks due soon or overdue. The default days are Monday, Wednesday and Friday, and each user can change them. A manual instant reminder is also available. [read] [Tallyfy notifications](https://github.com/tallyfy/documentation/blob/HEAD/src/content/docs/pro/settings/personal-settings/how-can-i-manage-email-notifications-in-tallyfy.mdx)
- **"Task debt"** builds up when overdue items pile up. Tallyfy's fixes:
  - "Expiring" tasks that close themselves at their deadline, used for FYI items.
  - Bundling related items.
  - Realistic deadlines.
  - "If a task consistently gets skipped without consequences, it probably shouldn't exist."
  - Monthly reviews, and asking the team to flag tasks that add no value.
  - [read] [Tallyfy task debt](https://github.com/tallyfy/documentation/blob/HEAD/src/content/docs/pro/tutorials/how-to/how-to-avoid-task-debt.mdx)
- **Banners get ignored.** GOV.UK: "Use notification banners sparingly. There's evidence that people often miss them, and using them too often is likely to make this problem worse." [read] [GOV.UK notification banner](https://github.com/alphagov/govuk-design-system/blob/main/src/components/notification-banner/index.md)

### D. Less typing: auto-fill and defaults
- **WCAG 2.2 SC 3.3.7 Redundant Entry (Level A):** information already entered in the same process must be filled in automatically or offered for selection. "Don't ask for the same information twice." [read] [Understanding Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) (read via [GitHub](https://github.com/w3c/wcag/tree/main/understanding/22))
- **GOV.UK:** "Start by asking one question per page." [read] [GOV.UK question pages](https://github.com/alphagov/govuk-design-system/blob/main/src/patterns/question-pages/index.md)
- **Assign by role.** Tallyfy recommends assigning by job title rather than by person. This "prevents bottlenecks when someone's unavailable". A "Take Over" button stops a task sitting unowned when it is assigned to a group. [read] (task-debt link above)

### E. Mobile, one tap, and what phones support
- **Web Push on iPhone** needs iOS 16.4 or later, and only works for a web app **saved to the Home Screen**. Chrome desktop has supported push since version 42, and Chrome on Android follows it. [read] [MDN BCD PushManager](https://github.com/mdn/browser-compat-data/blob/main/api/PushManager.json)
- **App-icon badge** (`navigator.setAppBadge`):
  - iOS 16.4+, Home Screen apps only. Passing `0` clears the badge.
  - Chrome desktop 81+.
  - **Not supported in Chrome on Android.**
  - [read] [MDN BCD Navigator](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json)
- **Tap-target size:**
  - WCAG 2.5.8 requires at least 24×24 CSS px, or enough spacing (AA).
  - GOV.UK uses a 44px touch area for checkboxes, and a small 24px box for dense desktop screens.
  - [read] [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [GOV.UK checkboxes](https://design-system.service.gov.uk/components/checkboxes/) (read in the earlier repo research, `docs/protocols/research.md`)

### F. Role-based views
- **"My work" grouped by time.** Mainstream tools group each person's list by time (overdue, today, this week, later) and show a count for each group. [search summary, from the earlier repo research] [monday My Work](https://support.monday.com/hc/en-us/articles/360019300579-My-Work)
- **Only the assignee can complete.** Tallyfy offers "Only assigned members can complete or edit"; admins always can. [read in earlier repo research]

### G. Gamification pitfalls
- **Rewards can backfire.** A meta-analysis of 128 experiments (Deci, Koestner and Ryan 1999, doi:10.1037/0033-2909.125.6.627) found that expected tangible rewards tied to a task undermine intrinsic motivation. [unverified]
- **Effects depend on context.** A literature review (Hamari, Koivisto and Sarsa 2014, doi:10.1109/HICSS.2014.377) found mostly positive but context- and user-dependent effects. [unverified]
- **Counting ticks invites gaming.** Goodhart's law: when a measure becomes a target, people optimise the measure (ticks) instead of the goal (a happy client). [unverified]
- **For Astrateg:** a leaderboard of 10 people in different roles compares things that are not comparable.

### H. Accessibility: WCAG 2.2 and Israeli Standard 5568
- **WCAG 2.2 covers the older versions.** Content that conforms to WCAG 2.2 also conforms to 2.0 and 2.1. The only criterion removed is 4.1.1 Parsing. W3C recommends 2.2 as the target even where a policy names an older version. [read] [WCAG 2.2 source](https://github.com/w3c/wcag/blob/main/guidelines/index.html)
- **New 2.2 criteria that matter here** [read]:
  - 2.4.11 Focus Not Obscured: sticky bars must not fully hide the focused item.
  - 2.5.7 Dragging Movements: any drag, such as a kanban board, needs a no-drag alternative.
  - 2.5.8 Target Size.
  - 3.2.6 Consistent Help: help sits in the same place on every page.
  - 3.3.7 Redundant Entry.
  - 3.3.8 Accessible Authentication: no memory test to log in unless there is an alternative or a helper. Password managers and paste count as that helper.
- **Existing criteria that matter** [read]:
  - 4.1.3 Status Messages: use `aria-live`.
  - 2.2.1 Timing Adjustable.
  - 1.4.10 Reflow.
- **IS 5568** has legal force under the Service Accessibility Regulations. Its technical core is WCAG 2.0 AA; some sources say 2.1. It also requires [search summary]:
  - Hebrew subtitles on video.
  - A published accessibility statement naming an accessibility coordinator.
  - Sources: [BOIA](https://www.boia.org/blog/israels-digital-accessibility-laws-an-overview), [EqualWeb IS 5568](https://www.equalweb.com/academy/standards/is5568.html), [Clym](https://www.clym.io/regulations/israeli-standard-5568-is-5568)
- **Open legal questions:**
  - Whether the service regulations cover an *internal* staff tool, or whether it falls under employment-accommodation duties instead. [unverified]
  - The details of any small-business exemption. [unverified]
  - Client-facing pages, such as the `q.html` quote-signing page or a future client portal, are clearly public-facing services.

---

## 2. Design rules for Astrateg (concrete and testable)

1. **Each role opens on its own screen.**
   - Staff land on "מה עליי" (my work).
   - Adam lands on an owner overview.
   - Editors (Nadia, Yariv, Anna, Nirel) and Eli land on one assignment page, reached by a scoped link with an expiry, like the `q.html` token.
   - Nobody sees another role's checklist by default.
2. **Sort each of the 139 mandatory items per client into one of four kinds:**
   - (a) **Killer item**, a tap.
   - (b) **System event**, ticked automatically. Examples: signing, a date entered, a calendar invite created, a Drive link pasted, an editor assigned.
   - (c) **Know-how**, shown as a "איך?" (how?) text under the item, not a checkbox.
   - (d) **FYI**, an expiring item.
   - Goal: at most 9 taps per pause point, and roughly half of today's manual taps removed.
3. **Every pause point has one named owner who "calls the pause"** (see §3).
4. **One tap to complete. No confirm dialogs.**
   - The screen updates instantly, and an "בטל" (undo) button appears.
   - The undo stays until the next action or at least 10 seconds (WCAG 2.2.1).
   - A failed save puts the tick back and announces it via `aria-live`.
5. **Defaults everywhere.**
   - The assignee comes from the client's role map.
   - Dates come from the anchor events: signing, characterization meeting, shoot day.
   - "Done at" defaults to now.
   - "לא רלוונטי" (not relevant) offers preset reason chips instead of free text.
   - The same data is never typed twice (WCAG 3.3.7).
6. **Status is text, not colour alone.**
   - Orange for "late by N business days".
   - Red only for a failed save (GOV.UK practice, in the earlier repo research).
   - Completed items are shown quietly.
7. **Mobile first.**
   - Touch targets at least 44px on phones (24px is allowed on desktop).
   - The main button sits within thumb reach.
   - No drag-only actions.
   - Sticky bars never cover the focused item.
   - The page reflows at 320px.
8. **Help in one fixed place on every page** (WCAG 3.2.6): a "צריך עזרה / משהו לא נכון?" (need help / something wrong?) button that opens a short feedback form.
9. **Gender-neutral Hebrew in the interface.** Use infinitives and nouns ("לסמן", "סימון") rather than gendered imperatives. Hebrew captions on all training videos.
10. **Login without memory tests.**
    - Today the login uses `autocomplete="username"` and `"current-password"` [code], so password managers work, which meets WCAG 3.3.8.
    - Keep `persistSession` on so staff rarely log in again.
11. **Privacy, because the repo is public.**
    - Phone numbers and emails for reminders live only in a Supabase table protected by RLS.
    - API tokens live in Edge Function secrets or Vault.
    - Nothing personal goes in the repo.

## 3. Pause points: applying the Checklist Manifesto to protocol v4

| # | Pause point (protocol processes) | Calls the pause | Type | Killer items (examples, at most 9) |
|---|---|---|---|---|
| 1 | Handoff after signing (1–3) | Irit | Do-Confirm | Package and influencer auto-filled from the signed quote. WhatsApp group opened with the right members. Characterization meeting booked. Access request sent |
| 2 | Characterization meeting (4) | Ofir | Read-Do (meeting agenda) | The 11 characterization items become form fields on one screen, not ticks |
| 3 | Access verified and pages set up (5–6) | Ilai | Do-Confirm | Every network's access works. Pages set up. Logo needed yes/no |
| 4 | Content-approval Zoom (13) | Lior | Do-Confirm | Scripts approved. Changes logged. Shoot date confirmed |
| 5 | Day before the shoot (15–16) | Lior | Do-Confirm | Influencer confirmed. Client confirmed. Address. Scripts in shoot order. Makeup and transport. Eli briefed. Drive folder created |
| 6 | Shoot-day start (17) | Eli | Read-Do | Arrive 1 hour early. B-roll list. Shoot in script order |
| 7 | Shoot-day end (19) | Eli, then Lior | Do-Confirm | Every script shot (count). Drive organized. Handed to Lior |
| 8 | Editor brief (22) | Ofir | Do-Confirm | Brief complete (extra detail for Nirel). Editor assigned. Due date auto-set to +3 business days (+4 to close) |
| 9 | Before videos go to the client (25–26) | Ofir | Do-Confirm | QA passed. Fixes logged |
| 10 | Before the posting month (28–29) | Ilai | Do-Confirm | Gantt filled. Metricool scheduled. Gantt sent to client |
| 11 | Recurring: daily control every 2 days, Thursday status (31–33) | Ofir | Expiring instances | A missed instance closes as "not done" and stays in the report. It does not pile up as overdue |

**Validation.** Run each list once with its owner on a real client. Time it: it should take 60–90 seconds. Revise, and print a version number and date in the app.

## 4. Reminder ladder, by stage

**Where the timing comes from.** All timings count in Israeli business days: Sunday to Thursday, minus holidays from the `business_holidays` table.

**What fires, from first to last:**
1. **Morning digest, about 08:30 Sunday to Thursday, for each person.**
   - Web Push, plus the WhatsApp text that can already be copied.
   - At most 5 lines: overdue first, then today. It links straight into "מה עליי".
2. **Pre-deadline nudge, only for killer deadlines.** Examples: "יום לפני הצילום 11:00" (day before the shoot, 11:00), "עריכה מחר" (edit due tomorrow), "גישות לא התקבלו" (access not received).
3. **Escalation to Lior** after the deadline plus a grace of 1 business day, killer items only (the Tallyfy pattern).
4. **Adam sees it** at 2 or more business days late, as red on the owner overview and in a Thursday owner digest. Adam gets no real-time pushes.
5. **"Waiting on client"** stops our clock but starts Irit's follow-up reminder.

**Limits:**
- No pushes outside 08:00–19:00, and none on Friday, Saturday or holidays.
- At most 3 pushes a day per person besides the digest. Anything beyond that is bundled.
- Web Push is useless on an iPhone until the app is saved to the Home Screen. The badge shows the overdue count on iOS and desktop, but not on Android.

## 5. Owner overview for Adam (one screen, no typing)

1. **Clients at risk.** Red and amber clients, each with the stage (1–8), what is stuck, with whom, and since when.
2. **This week.** Shoot days, deliveries and campaign launches.
3. **Team rhythm.**
   - Was daily control done? Were the Thursday status notes written?
   - Overdue count per person, shown as a count and not as a ranking.

Tapping a client opens its timeline. The screen should look at the process, not at each person's clicks.

## 6. Adoption plan

**Week 0 (before launch):**
- Fix the causes of false "overdue" first: holidays, night-time deals, and starting the clock at signing (roadmap items Q1–Q3). If the colours are wrong on day 1, the team stops trusting them.
- Adam announces the "why": happy clients, nobody forgets. He commits to asking about status only through the system.
- Hold a 30-minute co-design session per role to cut each list down to killer items.

**Week 1 (pilot):**
- Run 1–2 new clients with Irit, Ilai and Lior.
- Sit with each person for 10 minutes: install the app on the Home Screen, turn on notifications, tick the first item.

**Weeks 2–3:**
- Fix what the pilot showed.
- Switch on the morning digest and the escalation ladder.
- Record a 60–90 second screen video per role, in Hebrew with captions.
- Make one in-app page per role: "היום שלך במערכת" (your day in the system).

**Week 4:**
- Roll out to all staff.
- Editors and Eli get only their assignment page.
- Make Irit the operations champion and Lior the managers' champion, with a weekly 10-minute office hour.

**Ongoing:**
- Run the Thursday 10-minute review from inside the system.
- Each month, prune using the data: items marked "not relevant" more than half the time, or always ticked late, go up for review.
- Publish a protocol version with a "what changed" note, crediting the staff feedback behind each change.

**Metrics** (the targets are my suggestions):

| Metric | Target |
|---|---|
| Staff who open the app on at least 4 of 5 business days | 90% by week 4 |
| Killer items done on time | 85% or more by week 6 |
| Share of items ticked automatically | Rising month to month |
| Time from signing to characterization meeting | Tracked |
| Client satisfaction: one 1–5 question on WhatsApp after the shoot day and after the first month | Tracked |
| One question to staff every Thursday: "what annoyed you this week?" | Collected |

## 7. Costs

- **Supabase Pro, $25 a month (recommended).**
  - Free-plan projects are paused after 7 days of low activity, and their backups can't be downloaded. Pro projects are never paused for inactivity. [read] [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
  - Edge Function calls: 500K a month free, 2M on Pro, then $2 per million. Reminder volume (tens a day) costs nothing extra. [read] [Supabase functions pricing](https://supabase.com/docs/guides/functions/pricing)
- **Web Push:** no per-message fee, because it uses the browsers' own push services. [unverified]
- **WhatsApp Cloud API:**
  - Setup needs Meta business verification, a dedicated phone number and approved message templates. Meta charges per template message. [unverified]
  - Rough volume: 10 people × 2 messages × 22 days ≈ 440 messages a month. That is likely around $15 a month or less. [unverified rates]
  - Unofficial WhatsApp Web automation risks getting the number banned. [unverified]
  - Recommendation: start with free Web Push. Add WhatsApp only for killer reminders if the push opt-in rate stays low.
- **Staff time:** about 3 hours in total for co-design, 10–45 minutes of onboarding per person, and 10 minutes a week for the review.

## 8. Pitfalls

1. **Too many checkboxes.** People tick without reading, and overdue items pile up.
2. **Alert fatigue and banner blindness** from sending too many reminders.
3. **False "overdue" at launch** (holidays, night-time deals). The team stops trusting the colours.
4. **Control that feels like surveillance.** People start gaming it. Show managers' own items in the same way. [unverified evidence]
5. **Leaderboards, points and tick counts** (Goodhart's law).
6. **Adam bypassing the system.** If he keeps asking for status on WhatsApp, the system dies. Sponsorship is the top factor in Prosci's research.
7. **iPhones not installed to the Home Screen.** Those staff get no push at all.
8. **The free Supabase plan pausing,** which stops reminders without any warning in the app.
9. **Personal data in the public repo.**
10. **Login friction for editors and the photographer.**
11. **Drag-only kanban** (fails WCAG 2.5.7) **and toasts that vanish too fast** (fails 2.2.1).
12. **Untested legal assumptions.** Have the IS 5568 duties for internal tools and the client-facing pages confirmed by a lawyer. [unverified]

**Files I read in this repo:**
- /home/user/---/docs/protocols/research.md
- /home/user/---/docs/protocols/roadmap.md
- /home/user/---/docs/protocols/general.md
- /home/user/---/app/clients.js
- /home/user/---/client.html

---

# Astrateg operations system: technical architecture research

**Method and limits.** Web search was used up, and the network proxy blocked supabase.com, developers.facebook.com, developers.google.com, docs.github.com and developers.cloudflare.com. I took sources from three other places instead:
- the official Supabase docs, through the Supabase docs search tool;
- official docs repositories on GitHub (github/docs, cloudflare/cloudflare-docs, mdn/browser-compat-data, googleapis discovery files), plus a GitHub mirror of Meta's WhatsApp docs (kapso-meta-docs);
- a read-only look at the live Supabase project and the repository.

Anything not confirmed from a primary or official source is marked **[unverified]**, and anything taken from a second-hand source is marked **[secondary]**.

---

## 1. Key findings

### 1.1 Current state (checked on 2026-09-29)
- **The Supabase organization is on the Free plan** (read from the live org). The `astrateg-quotes` project is in eu-central-1.
- **None of the tools needed for reminders are switched on yet:** `pg_cron`, `pg_net`, `pgmq` and `pgaudit` are all off. Vault is on (`supabase_vault`, version 0.3.1).
- **Only one Edge Function is deployed** (`create-quote`, verify_jwt on). It reads the old key variables `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (`supabase/functions/create-quote/index.ts`).
- **The server can already run code from the website folder.** `create-quote` imports `../../../app/pricing.js`. So a reminders function could import the same protocol engine (`app/protocol-logic.js`, `protocol.js`, `holidays.js`) without keeping a second copy.
- **Time-zone bug risk.** `app/protocol-logic.js` works in "the viewer's local time zone" (`getDay`, `setHours`). If it runs unchanged on the server, business hours and business days will be counted in UTC. **[unverified: that the Edge runtime is on UTC]**
- **The office domain is already behind Cloudflare.** `astrateg.com` resolves to 172.67.159.188, which is Cloudflare's range. This suggests the DNS is already on Cloudflare **[unverified]**.

### 1.2 Supabase

**Scheduling (Cron)**
- Supabase Cron is pg_cron. It "can run anywhere from every second to once a year." Supabase recommends "no more than 8 Jobs run concurrently" and each job "no more than 10 minutes" (https://supabase.com/docs/guides/cron).
- Run history is kept in `cron.job_run_details`, which "are not cleaned up automatically" (https://supabase.com/docs/guides/cron/quickstart).
- The official way to run an Edge Function on a schedule is `cron.schedule` + `net.http_post`, with the URL and key stored in Vault (https://supabase.com/docs/guides/functions/schedule-functions).
- The database runs on UTC by default, and Supabase "strongly recommend[s] keeping it this way." Their cron examples are written in GMT (https://supabase.com/docs/guides/database/postgres/configuration).
- pg_cron supports up to 32 concurrent jobs. If the scheduler worker dies, it is revived with a fast reboot (https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz).

**Outgoing web calls (pg_net)**
- pg_net is asynchronous, and requests start only after the transaction commits.
- The default `timeout_milliseconds` is **2000**, and responses are kept in `net._http_response` for **6 hours**.
- The API is labelled beta (https://supabase.com/docs/guides/database/extensions/pg_net).

**Database Webhooks** are triggers built on pg_net and fire after INSERT, UPDATE or DELETE (https://supabase.com/docs/guides/database/webhooks). They are labelled beta (https://supabase.com/docs/guides/getting-started/features).

**Queues (pgmq)**
- They offer "guaranteed delivery," "exactly once … within a customizable visibility window," archiving, and RLS through the `pgmq_public` wrappers (https://supabase.com/docs/guides/queues, https://supabase.com/docs/guides/queues/quickstart).

**Edge Function limits**
- 256 MB memory, **2 s CPU per request**, and a wall-clock limit of **150 s on Free and 400 s on paid plans**.
- Up to 100 secrets of up to 48 KiB each. Outgoing ports 25 and 587 (email) are blocked (https://supabase.com/docs/guides/functions/limits).
- `EdgeRuntime.waitUntil` lets a function answer immediately and keep working in the background (https://supabase.com/docs/guides/functions/background-tasks).
- Shared code goes in `supabase/functions/_shared`, and plain JavaScript files are supported (https://supabase.com/docs/guides/functions/development-tips).

**API keys (deadline)**
- The old `anon` and `service_role` keys "keep working until the end of 2026."
- The new `sb_secret_…` keys are not JWTs. They must be sent in the `apikey` header, and functions called with them need `verify_jwt = false` and must check the key in their own code (https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

**Vault**
- Secrets are encrypted with authenticated encryption. The key is kept outside the database, and anyone who can read `vault.decrypted_secrets` sees the plain text (https://supabase.com/docs/guides/database/vault).
- The Supabase features table lists Vault as **public alpha** (https://supabase.com/docs/guides/getting-started/features).

**Realtime** allows 200 concurrent connections on Free and 500 on Pro. Postgres Changes checks RLS for each subscriber (https://supabase.com/docs/guides/realtime/limits, https://supabase.com/docs/guides/realtime/benchmarks). This is ample for about 10 staff.

**Backups and plans**
- Daily backups exist only on paid plans. Pro keeps 7 days. Free projects should export with `supabase db dump` and keep copies elsewhere (https://supabase.com/docs/guides/platform/backups).
- Point-in-time recovery (PITR, restore to any moment) costs about $100 a month for 7 days, needs at least Small compute, and replaces the daily backups (same page).
- Free projects are paused after 7 days of low activity. Paid projects are never paused (https://supabase.com/docs/guides/platform/free-project-pausing).

**Pricing**
- Pro costs $25 a month and includes $10 of compute credits, which cover a Micro instance (about $10 a month) (https://supabase.com/docs/guides/platform/manage-your-usage/compute).
- Edge Function calls: 500,000 on Free, 2 million on Pro, then $2 per million (https://supabase.com/docs/guides/functions/pricing).

**Audit**
- PGAudit writes to the Postgres logs and can only be configured per role on Supabase. Supabase does not support `pgaudit.log_parameter` because it could log Vault secrets (https://supabase.com/docs/guides/database/extensions/pgaudit). It is a security tool, not a business record of who did what.

**Production checklist** (https://supabase.com/docs/guides/deployment/going-into-prod):
- MFA on the Supabase account and several organization owners;
- your own SMTP server for login emails;
- consider MFA for users, RLS on every table, and the Security Advisor.

### 1.3 WhatsApp Cloud API

**Pricing** (Meta docs, last updated Dec 10, 2025; https://developers.facebook.com/docs/whatsapp/pricing, read through the mirror https://github.com/kapso-meta-docs/documentation/blob/HEAD/documentation/whatsapp/pricing.mdx):
- Since July 1, 2025, WhatsApp charges per delivered template message.
- **Free:** non-template messages inside the 24-hour customer service window, **utility templates inside that window**, and everything inside a 72-hour free entry point.
- **Always charged:** marketing templates.
- The rate depends on the template category, the recipient's country code and the monthly volume tier.
- **Israel rates: [unverified].** From memory, roughly $0.005 per utility template and $0.035 per marketing template. Check Meta's rate card.

**Templates**
- A template is required outside the 24-hour window. Categories are marketing, utility and authentication. Review "typically takes up to 24 hours," and you supply the Hebrew text yourself (template language code) (mirror of templates/overview, Dec 5, 2025).

**Sending limits**
- New accounts can message 250 unique users per 24 hours. This rises to 2,000 after business verification or a record of high-quality messages (https://github.com/8x8Cloud/public-developer-docs/blob/HEAD/docs/connect/docs/whatsapp/concepts-fundamentals.md, a WhatsApp provider's docs).
- Throughput is 80 messages per second by default, and 20 per second in coexistence mode (mirror of throughput.mdx).

**Groups API: not realistic for Astrateg.**
- Groups have at most 8 participants and join only through an invite link.
- It requires an Official Business Account plus "a messaging limit of at least 100,000" (mirror of groups.mdx, Nov 14, 2025).
- In practice, the client WhatsApp groups that Irit manages cannot be automated through the official API.

**Coexistence** (same number in the WhatsApp Business app and the Cloud API):
- **Group chats are not synced.**
- Disappearing and view-once messages are turned off.
- Broadcast lists become read-only.
- Messages sent by hand from the app stay free.
- Source: https://github.com/8x8Cloud/public-developer-docs/blob/HEAD/docs/connect/docs/whatsapp/whatsapp-business-app-coexistence.md. **Whether it is available in Israel: [unverified].**

### 1.4 Web Push
- **iPhone:** iOS 16.4 and later, "web apps saved to the home screen" only.
- **Android and Firefox:** Chrome Android 42 and later needs `applicationServerKey` (VAPID). Firefox 72 and later needs a user gesture to subscribe (https://github.com/mdn/browser-compat-data/blob/main/api/PushManager.json).
- Push needs an active service worker, and the subscription endpoint is a secret (anyone who knows it can send pushes) (https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
- **Server library:** `jsr:@negrel/webpush` is a Deno library implementing RFC 8291 and RFC 8292 (https://github.com/negrel/webpush). **[unverified]** on the Supabase Edge runtime specifically, and **[unverified]** whether `npm:web-push` works there.

### 1.5 Google Calendar and Drive
- **Calendar:** "Service accounts need to use domain-wide delegation of authority to populate the attendee list" (Calendar API discovery file: https://github.com/googleapis/google-api-go-client/blob/main/calendar/v3/calendar-api.json).
  - The practical workaround is a company calendar shared with the service account, holding events without attendees, which staff subscribe to **[unverified: the sharing steps; Google's docs page was blocked]**.
- **Drive:** a service account gets `403 storageQuotaExceeded – "Service Accounts do not have storage quota. Leverage shared drives, or use OAuth delegation"` when it tries to upload to a normal My Drive **[secondary: https://github.com/vishal-h/aetheris-agents/blob/HEAD/drive/runbook.md]**.
  - Creating folders inside a Shared Drive where the service account is a member works. Shared Drives need Google Workspace **[unverified: which editions]**.
- **OAuth apps in "Testing":** an External app in Testing status receives "a refresh token expiring in 7 days" (https://developers.google.com/identity/protocols/oauth2#expiration). **[secondary: quoted in several repos; primary page blocked]**

### 1.6 Hosting
- **GitHub Pages restrictions:**
  - It is "not intended for or allowed to be used as a free web-hosting service to run your online business … or … providing commercial software as a service (SaaS)."
  - Soft limit of 100 GB bandwidth a month.
  - It "shouldn't be used for sensitive transactions like sending passwords."
  - Free accounts can use it only from **public** repositories.
  - Sources: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits, https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages.
  - No custom headers, and a fixed `Cache-Control: max-age=600` (per earlier research in `docs/protocols/research-implementation.md`, citing https://github.com/orgs/community/discussions/11884).
- **Cloudflare:**
  - Pages free plan: 500 builds a month, 20,000 files, 25 MiB per file, 100 custom domains, and a `_headers` file (up to 100 rules) for security and cache headers (https://developers.cloudflare.com/pages/platform/limits/, https://developers.cloudflare.com/pages/configuration/headers/).
  - Workers static assets: "Requests to static assets are free and unlimited" (https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
  - Cloudflare Zero Trust features are free for up to 50 users (https://developers.cloudflare.com/reference-architecture/architectures/sase/).
- **Vercel:** the Hobby plan is "restricted to non-commercial personal use only" (https://vercel.com/docs/limits/fair-use-guidelines) **[secondary]**. Commercial use needs Pro **[unverified: price]**.

### 1.7 Israeli privacy law
- Amendment 13 to the Privacy Protection Law took effect on Aug 14, 2025. It requires "immediate" notification of serious security incidents, expands the regulator's (PPA) powers, and adds damages of up to NIS 10,000 without proof of harm **[secondary: https://github.com/skills-il/security-compliance/blob/HEAD/israeli-appsec-scanner/SKILL.md; verify with gov.il/PPA]**.
- This matters because the system holds client logins.

---

## 2. Recommended target architecture

```
Staff phones (installed web app + Web Push) ─┐       Client token links (approvals/status)
Owner dashboard (live board, reminder log) ──┤                 │
                                             ▼                 ▼
      Cloudflare Pages/Workers, app.astrateg.com (private repo, _headers: CSP, cache, service worker)
                                             │  publishable key + user login (JWT)
                                             ▼
Supabase Pro ── Postgres (RLS) ── tables: clients, checks, tasks, protocol_log (existing)
   │                               + notification_outbox, push_subscriptions, notify_prefs,
   │                                 audit_log, secret_access_log, integration_refs
   ├─ pg_cron (every 5 min, UTC) ──pg_net(apikey from Vault)──► Edge fn "reminders"
   │                                                             (imports app/protocol-logic.js,
   │                                                              holidays.js; Asia/Jerusalem time)
   │                                                             → writes due events to the outbox
   ├─ Edge fn "dispatch" ─► channels: in-app inbox | Web Push (VAPID) | WhatsApp Cloud API (utility templates)
   ├─ Edge fn "wa-webhook" ◄─ Meta delivery/read statuses and replies (signature checked)
   ├─ Edge fn "google-sync" ─► Calendar (company shoot calendar) + Drive (Shared Drive client folders)
   └─ Vault: client credentials (read only through an RPC that is logged); Edge secrets: WhatsApp token, VAPID private key, Google key
```

**Main design choices**

1. **One protocol engine, run in two places.** The browser keeps using `app/protocol-logic.js`. The `reminders` Edge Function imports the same file, the way `create-quote` imports `pricing.js`.
   - First, rework the engine so it takes an explicit time zone (`Asia/Jerusalem`) through `Intl.DateTimeFormat` for its "local" calculations.
   - Add a test that runs it with `TZ=UTC` and gets the same results as in Israel.
   - Holidays keep one source of truth: `app/holidays.js`.
2. **An outbox table, not sending straight away.** Every reminder becomes a row with `dedupe_key UNIQUE`, for example `due:{client}:{item}:{due_date}:{person}:L1`. The job inserts with `on conflict do nothing`, so running every 5 minutes cannot cause duplicate sends.
   - Each row tracks its status (pending, sent, delivered, read, failed), the number of attempts, the next attempt time and the provider's message ID.
   - This table is also Adam's control screen: what was sent to whom, when, and whether it was read or acted on.
   - A plain table using `FOR UPDATE SKIP LOCKED` is enough at this volume. pgmq is an option later.
3. **Local-time scheduling done inside the function.** pg_cron runs on UTC and Israel changes to and from daylight saving time. So cron fires every 5 minutes, and the function decides whether it is 08:00 on a business day in Jerusalem (morning summary), Thursday (Ofir's status summaries), and so on.
4. **Escalation ladder, applied only to critical processes.**
   - Level 1: the person responsible.
   - Level 2: the person responsible plus the protocol's escalation owner (Lior for escalations, Ofir for QA and control, Irit for items waiting on the client).
   - Level 3: flagged on Adam's board. There is no push to Adam unless he chooses it.
   - Everything else goes into the Sunday to Thursday morning summary.
   - "On it", "waiting for client" and "snooze until…" stop the ladder.
   - Quiet hours are set per person. Shoot-day alerts ignore quiet hours.
5. **Which channel for whom.**
   - **Staff:** in-app plus Web Push (free) first; WhatsApp utility templates for the morning summary and critical overdue alerts. Those are free when the employee has written to the number in the last 24 hours.
   - **Editors (Nadia, Yariv, Anna) and photographer Eli:** WhatsApp templates plus a personal link that shows only their tasks.
   - **Clients:** 1:1 reminders (day before the shoot, approval pending) as templates from a **new dedicated business number**.
   - **Client WhatsApp groups stay human.** The system prepares the text and sends it with one tap through `wa.me`, as it does today.
6. **Google.** One service account, with its key kept only in Edge Function secrets.
   - **Calendar:** writes characterization meetings and shoot days to one company calendar shared with the service account, with no attendees. Staff subscribe to that calendar.
   - **Drive:** creates a client folder template inside a Shared Drive when a client opens, then shares an editor subfolder when an editor is assigned. Google IDs are stored in `integration_refs`, so a repeated call does not create a second copy.
   - If Astrateg is not on Google Workspace, use OAuth as a company account instead. The app must be published, not left in "Testing", or the token dies after 7 days.
7. **Client logins.** Only a `security definer` function called `reveal_secret(client, field)` can read them.
   - It checks the caller's role, requires the user to have MFA (`aal2`) **[unverified: exact check syntax]**, and writes a row to `secret_access_log` every time.
   - Never return secrets in list queries.
   - Prefer partner access (Meta Business partner access, delegated Google access) over storing passwords.
8. **Audit.** Keep `protocol_log`, and add a general append-only `audit_log` trigger on clients, tasks, assignments and settings (who, what, before, after, when).
   - Revoke UPDATE and DELETE on the audit tables.
   - PGAudit only if a security need comes up.

**Build step or framework: not now.** The current setup (plain HTML, ES modules, no build) already shares code with the server, and there are Playwright tests. Adding React or Vite now brings rework without changing any outcome for staff.
- Add now: a service worker with a versioned cache, a manifest, and optionally `// @ts-check` with JSDoc and `tsc --noEmit` in CI.
- Revisit only if:
  - the client portal grows into a real app, or
  - mobile load time becomes a problem because of too many small module requests, or
  - a second developer joins who works in a framework.

**When to leave GitHub Pages: now, before push notifications.** Push subscriptions, installed web apps and localStorage are tied to the site address (origin), so every one of them breaks if the address changes after launch.
- Moving also lets the repo go **private**. That fixes the risk of phone numbers or business logic ending up in a public repo; the published JS is still public either way.
- It adds CSP and cache headers.
- It removes the grey area around the "online business / SaaS" rule.
- Recommended target: Cloudflare Pages or Workers static assets, deployed from a private GitHub repo, on `app.astrateg.com`. Cloudflare Access can optionally hide `payouts/` completely; never put the client portal behind Access.

---

## 3. Phased plan

| Phase | Contents | Effort | Done when |
|---|---|---|---|
| **0. Foundations** | • Upgrade the Supabase org to Pro<br>• MFA plus a second owner, and move organization ownership to a company account<br>• Your own SMTP server<br>• Enable pg_cron and pg_net<br>• Switch `create-quote` and any new function to `sb_secret` keys (apikey header, verify_jwt=false with a check in code) **before 2026-12-31**<br>• Move hosting to Cloudflare with a private repo, then update Supabase Auth Site URL and redirects<br>• Weekly `db dump`, encrypted, sent outside the public repo | 2–3 days | Site served from the new address; daily backups visible; old keys unused |
| **1. Reminder engine** | • Time-zone-safe engine plus a test<br>• Outbox, notification settings and push subscription tables<br>• `reminders` and `dispatch` functions<br>• Web app manifest, service worker and Web Push<br>• In-app inbox<br>• Morning summary Sun–Thu 08:00 Jerusalem time<br>• Ladder on the critical processes only<br>• Reminder log screen for Adam<br>• `audit_log` | 1.5–2 weeks | Each overdue item gets exactly one Level 1 reminder; a Thursday 18:00 deal is not "late" on Sunday; one week of logs checked |
| **2. WhatsApp** | • Meta business verification<br>• Dedicated number<br>• Hebrew utility templates: staff summary, overdue alert, shoot D-1 for Eli and influencer coordination, client approval pending<br>• `wa-webhook` for statuses and replies<br>• Recorded opt-in<br>• Push as fallback | 1–2 weeks + Meta review time | Staff get the summary on WhatsApp; delivered and read status visible in the log |
| **3. Google** | • Company shoot calendar through a service account<br>• Shared Drive client folder template made at client opening<br>• Editor subfolder shared on assignment | ~1 week | Folder and events created without anyone typing; nothing duplicated when run twice |
| **4. Client portal** | • Token links (the existing 122-bit signing pattern) for approving scripts, graphics and videos<br>• Status page<br>• Approvals written to the audit trail | 2–3 weeks | Most approvals come through links; approval time is measured |
| **5. Insights and hardening** | • Actual time vs target per process and per person<br>• Live board (Realtime)<br>• PITR if the database grows or a client requires it | ongoing | — |

---

## 4. Costs (monthly, approximate)

| Item | Cost |
|---|---|
| Supabase Pro (Micro compute covered by credits) | **$25** |
| Edge Function calls: cron every 5 min is about 8,640 a month, plus sends; well under the 2M included | $0 |
| PITR, 7 days (optional, later) plus Small compute | about +$100 + $5 |
| WhatsApp Cloud API, directly from Meta with no provider fee: about 440 staff templates + 300 client templates a month at the Israeli utility rate **[unverified ≈$0.005]**; utility messages inside the 24-hour window are free | about **$0–5** |
| Web Push | $0 |
| Cloudflare Pages/Workers static hosting, Access up to 50 users | $0 |
| Google APIs | $0 **[unverified: quota pricing]**; Workspace licences only if not already paid |
| **Core total** | **about $30 a month** |

---

## 5. Pitfalls
1. **Staying on Free with real client data.** No backups, a pause risk during quiet holiday weeks, and a 150-second function limit. Upgrade before rollout.
2. **UTC and daylight saving.** Cron is on UTC, and the engine uses local-time methods. Get either wrong and reminders fire an hour off or on holidays.
3. **pg_net's 2-second default timeout.** Make the function answer at once and use `waitUntil`, or raise the timeout. Add a cleanup cron job for `cron.job_run_details`.
4. **Duplicate or flood reminders.** Without a `dedupe_key` a 5-minute cron sends repeats. Too many instant alerts will get notifications muted, so keep instant alerts to the 2–3 processes where lateness really costs something.
5. **iPhone push only after "Add to Home Screen" (iOS 16.4+).** Onboarding must walk every employee through it. Expired subscriptions must be deleted; handling 404/410 responses is **[unverified: RFC detail]**.
6. **Changing the site address after launching push or the web app** silently breaks both. Move hosting first.
7. **WhatsApp:**
   - Groups cannot be automated.
   - Moving Irit's existing number to the Cloud API without coexistence takes it out of the WhatsApp app **[unverified]**, and coexistence breaks group sync anyway.
   - Unofficial WhatsApp libraries risk a ban **[unverified: ToS citation]**.
   - Meta may re-classify a template as marketing, which is more expensive.
8. **Google:**
   - A service account cannot add attendees.
   - A service account cannot own uploads outside a Shared Drive.
   - An OAuth app left in Testing expires its tokens after 7 days.
9. **Public repo and CI.** Never dump the database in a public repo's Actions workflow or artifacts. Never commit phone numbers, tokens, the VAPID private key or the Google key; they belong only in Edge Function secrets or the database.
10. **Vault is public alpha, and access to its decrypted view means plain-text passwords.** Allow reading only through the logged RPC.
11. **Old Supabase keys end at the end of 2026**, and `create-quote` depends on them.

## 6. Decisions needed from Adam
1. Is astrateg.com on Google Workspace? This decides between a service account with a Shared Drive and OAuth.
2. Approve a dedicated WhatsApp number and Meta business verification.
3. Which client reminders are sent automatically, and which stay one-tap?
4. Quiet hours, and who receives Level 2 escalations.
5. Approve Supabase Pro at about $25 a month now, and PITR later.
