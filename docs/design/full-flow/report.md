<!-- ' -->
# Full-flow simulation: one new client, from the field deal to the renewal window

Branch `sim/full-flow`, on top of `c689345` (the tip of `idan/rollout`). Application code (`app/`, `supabase/`, `*.html`) was not touched. Everything here ran against an in-memory fake of Supabase on a local server; nothing reached the live site, the Supabase project, WhatsApp or Metricool (every outside address is refused by the simulation).

- The client: "מאפיית הדקל · רונית דקל", package "Social all in one · סמיון, מישל ודניס" (25 videos, 35 graphics, one shoot day), all names invented.
- The calendar: the deal on Sunday 11.10.2026 09:05; signature 09:36; characterization Monday 12.10 10:00 (Ofir); shoot day Tuesday 20.10 10:00; editor Nadia (assigned by the system); publishing 27.10; ongoing work to 26.11.2026; renewal window 12.8.2027 (the contract ends 11.10.2027).
- 84 recorded steps, 732 rows in the reminder log, 92 phone screenshots (390px) in this folder.
- The full step table (every step: protocol, before, act, taps, after, reminders, verdict) is `steps.md` in this folder. It is generated from the saved run.

## How to rerun

```
node tests/sim/run.mjs            # all stages, the two experiments, steps.md (about 15 minutes)
node tests/sim/run.mjs stage6b    # from one stage on (needs the states of the stages before it)
node tests/sim/show.mjs s10 1 short   # the records of the run, short form
node tests/sim/log.mjs s10 late       # the reminder log, filtered by a word
node tests/sim/probe.mjs s5 lior "clients.html#mine" mine   # what a role sees on a page, from a saved state
```

The machinery: `tests/sim/lib.mjs` (a static server, the fake, a clock the script moves, the real `supabase/functions/reminders/tick.js` run minute by minute over the same data), `tests/sim/server.mjs` (the server logic ported from the existing suites: the signing trigger, the deal triggers, the status page, the logins form, the tasks given on the spot, a few stamp triggers), `tests/sim/steps.mjs` (how a role acts), `stage*.mjs` (the scenario), `exp.mjs` (two side experiments), `verdicts.mjs` (the verdict of each step). `npm test` was run on the branch after the work.

## What ran, what was read in code, what was not simulated

**Ran in the browser (Chromium, phone 390px), as the role itself, starting from "המשימות שלי":** the deal form (Stav), the contract builder and the link (Irit), the public signing page (client), every process 2 to 31 and 34 by its owner, the characterization forms (Ofir), the focus call form (Lior), the logins form (client, public link), the status page (client: three approvals, one fix request, one more approval), the card of Ilai (uploads, hand-offs, "קיבלתי", "הגאנט מלא"), the editor page (Nadia: start, ready, fixes, final), quality control on qa.html (Ofir: one return with two fixes, then approval), the daily message, the two daily controls, a nudnik task, an exception and its decision, a question of the owner and its answer.

**Reminders:** the real engine and the real tick, every minute of the simulated calendar (every 5 minutes in the idle month). Each person has one fake device, so a ring is recorded as a push.

**Read in code only (not observed):** why the unsigned-contract rule cannot fire (finding 1.2); that the 08:30 fold exists by design (finding 3.4).

**Not simulated, and why:**
- prep.html and shoot.html (the coordinator, the blockers, the counters, closing the day): the same items were marked with the pill on "המשימות שלי", which accepts them. The scripts page and scripts-view: process 12 was marked without writing a script (this itself is finding 6.1).
- gantt.html rows and Metricool: no real Metricool; "הגאנט מלא" was pressed on an empty Gantt (finding 6.1).
- The Thursday summary per client (the link leads to the daily control; the simulation did not fill it), the monthly cycle items (marked "טיוטה" by the system, starts in month 2), process 35 (the client did not end), a custom contract (not needed), a manual editor assignment by Ofir (the automatic one came first), a brief for Nirel (not called for: Nadia edits a DMS shoot).
- Real phones, real push, WhatsApp sends, row level security of the real database (the fake filters rows per role as tests/roles-world.mjs does), the history log (the fake does not write it), database triggers that were not ported (the "tell the client" task, the date-change log, the scripts approval trigger).
- Between 26.11.2026 and 10.8.2027 the clock jumped with no tick (said in steps.md). No data was nudged anywhere else.

**Artifacts of the simulation, not findings:** the card "ההתראות חסומות" (headless browser); "בקרת הלקוחות של אופיר לא בוצעה 3 ימי עסקים" on the first days (an office with no history); the lines about the free dates of Eli (none were seeded); the bottom bar drawn in the middle of long screenshots; steps 13 and 14 (the driver looked for pills where Ilai has his own card; done in step 19); step 76 (the owner had no row to ask about at that hour; done in step 77).
<!-- ' -->
<!-- ' -->

## The short answer

The main line flows. From the signature to the final versions, every hand-off that is a protocol item reached the next person: it appeared on that person "המשימות שלי" in the same minute, in the right urgency group, and the phone rang where the protocol asks for it (of the 84 steps: 53 flow, 7 flow with a remark, 12 are confusing, 9 miss something the protocol asks for, 3 were not simulated). The client side works end to end from public links. The places that break the owner goal ("everyone knows what to do, and whoever does not do it gets reminders") are few and specific, below. Numbers in brackets are step numbers in steps.md.

## Findings, ranked by how badly they break the flow

Severity: חוסם (blocks) / גבוה / בינוני / נמוך. "Ran" = observed in the run; "Code" = read in code.

### 1. A person would not know what to do next

**1.1 גבוה · Process 3 can be finished without a meeting date, and then the client is stuck silently.** Ran (experiment B, `node tests/sim/exp.mjs`, screenshot `04-irit-exp-p03-no-date.png`).
The card "3 · קביעת פגישת אפיון" on "המשימות שלי" shows 3 items. The fourth ("נקבעה פגישה פיזית…") is hidden until "מי מבצע" and "מועד פגישת האפיון" are filled in the client card, and the card on the home screen does not say that anything is missing (only the client card does: "חסר בפרטי הלקוח…"). Irit marked the 3 items; the card left her list; `char_at` stayed empty. Two days later nobody had anything about the characterization: not Irit, not Ofir, not Lior, not the owner; no reminder mentions the missing date; processes 4 to 10 never start because their clocks hang on that date. Protocol: the meeting is set within 5 minutes, at the earliest date. Agent: logic (the item list of the card), screens (the hint on the card).

**1.2 גבוה · A contract that was sent and not signed is nowhere.** Ran (step 3 and experiment A, screenshots `03-irit-contract-sent-waiting.png`, `05-irit-late-unsigned-next.png`).
After Irit made the signing link the deal card left her list ("חוזה נשלח"). For a business day and a half nobody had a card, a line or a reminder; the rule `contract` ("חוזה נשלח ולא נחתם": Irit after 4 office hours, the list of Lior after a business day) produced 0 rows. Only quotes.html shows "ממתין לחתימה". Code: the rule and the card of process 1 work on a client, and the client row is created by the signing trigger, so on this path there is never an unsigned client. Protocol (process 1): Irit makes sure the client actually signed. Agent: reminders (a rule on the deal or the quote), screens.

**1.3 בינוני · Two things only Irit can do, that the client steps depend on, are not on her list.** Ran [11, 25].
Sending the client the link to the logins form, and creating the link of the status page. Process 5 was closed the moment Ofir saved one login (Instagram) in the meeting; nothing said that Facebook and TikTok were unknown. Without the status link the client cannot approve graphics, scripts or videos. Both are made from the client card. Agent: screens, logic.

**1.4 בינוני · The meeting date and the shoot date are typed in the client card, 11 taps away.** Ran [7, 28]. From the card on "המשימות שלי": the client name, the client card, "השלמת פרטים", the fields, save, back, then the items. For the shoot day the card has the shortcut "סגירת יום הצילום" to prep.html (not driven here).

**1.5 נמוך · The Thursday summary card leads to the daily control page** ("מעבר לסיכום המצב" opens clients.html#control) [73]. Not simulated further.

### 2. Hand-offs that did not reach the next person

**2.1 בינוני · The fix request of the client reaches the editor only.** Ran [60]. The client asked for a fix on the status page: Nadia got a ring ("הערות הלקוח הגיעו") and a task; Irit got nothing, and her card kept saying "הלקוח אישר את הסרטונים", now "באיחור". Protocol (process 27): Irit receives the notes, makes sure they are clear and documents them. An approval, by contrast, does reach Irit quietly [26, 32, 50, 63].

**2.2 בינוני · When the one before you is late, you are not told.** Ran [21, 22, 54]. Ilai was a day late with the 9 graphics; Irit, who reviews them next, heard nothing about him. What she saw was her own review card turning red. The same for Irit while the editor was late.

**2.3 נמוך · Confirmations of other people are marked by the one who asks.** Ran [28, 37]. "ליאור אישר" and "הצלם אישר" of process 11 are items of Irit; "הצלם קיבל את פרטי יום הצילום" of process 16 is an item of Lior. Lior is never asked about the date, and Eli sees only "בקרוב · יום צילום" (he does get the ring "נקבע יום צילום").

**2.4 For the record · The editor assignment did not wait for Ofir.** Ran [44]. In the minute Lior closed the shoot day the server assigned Nadia, marked all four items of 22א (including the check of Irit, "נסגר לבד"), rang Nadia and told Ofir quietly with a folder task. The 3 business days of the editing started then, before the drive physically reached her.
<!-- ' -->
<!-- ' -->

### 3. Missing or wrong reminders and escalations

The three deliberate delays, as the log recorded them (`node tests/sim/log.mjs s10 late`):

| Who was late, on what | Before the deadline | When the deadline passed | Later |
|---|---|---|---|
| Ilai, the 9 graphics (7), due Monday 13:25, done Tuesday 09:45 | 11:25 ring "השעון שלך התחיל"; 12:55 ring "עוד 30 דקות" | 13:40 one quiet batched push to Ofir and to Lior ("2 איחורים חדשים") | 18:00 the summary of the owner: "הכול לפי התוכנית"; next morning one line in the digest of Ilai and of Lior. Irit: nothing about Ilai |
| Irit, the shoot day (11), due the end of Monday, done Tuesday 11:30 | quiet push when it opened; a digest line each morning; 16:00 ring on the due day | nothing at the deadline | next morning a digest line to Irit; 09:15 a quiet batched push to Ofir and Lior |
| Nadia, the editing (22, 24), due the end of Sunday 25.10, done Monday 13:00 | ring when assigned; a digest line each morning ("יום 2 מתוך 3"); 15:00 ring on day 3 | nothing at the deadline | Monday 08:30 digest to Nadia; 09:15 a quiet batched push to Ofir and Lior. Irit: nothing |

**3.1 גבוה · The unsigned contract: no reminder at all** (finding 1.2).

**3.2 בינוני · Once a deadline has passed, the late person is not rung again.** Ran [21, 22, 53, 54, 82]. In all three delays the last ring to the person was before the deadline; after it there is one line in the next morning digest. The escalation the protocols ask for ("עובד אינו עומד בזמן": update Lior) does happen, as one quiet batched push to Ofir and Lior 15 office minutes after the deadline (the next morning at 09:15 for an end-of-day deadline), once per deadline. Nothing repeats, and nobody rings. Against the owner goal ("whoever does not do it gets reminders") this is the main gap of the reminders. Agent: reminders. Question for the owner: should a late item ring its owner again (how often, until when)?

**3.3 בינוני · An ordinary task that is late is mentioned once.** Ran [79, 80]. The task Lior opened for Irit when he decided the exception ("לתאם עם הלקוחה צילום המלצה…", due the next day) got "משימה חדשה", "משימה להיום" in the digest, and one "משימה באיחור" line the morning after (to Irit, Lior and Ofir). Then nothing for 18 business days; on 10.8.2027 it was still on her list, "באיחור 198 ימי עסקים".

**3.4 נמוך · A deal that arrives between 08:30 and 09:30 can swallow its own 10-minute rings.** Ran [1], cause read in code. The deal came at 09:05 with no morning digest sent yet; the tick sent a "תקציר בוקר" at 09:05 and folded into it the two rings that were due at 09:15 ("עברו 10 דקות" to Irit, "חוזה לא נשלח 10 דקות" to Ofir), ten minutes early and as digest lines. Seen in an office of one client; in the real office a digest normally goes out at 08:30, so this needs a check there.

**What rang as the protocol says (ran):** new deal to Irit; 5 minutes passed [6]; group opened to Lior [5]; the evening before the characterization to Ofir [8]; "השעון שלך התחיל" to Ilai, Ofir, Lior and 30 minutes before the target [9]; logins to Ilai, and to Lior after 30 minutes unchecked [12, 16]; urgent task not started in 30 minutes to Lior [16]; graphics ready to Irit [23]; the client did not answer in 10 minutes to Irit [26]; approvals to Ilai and Irit [26, 50]; shoot day set to Eli [28]; ready for quality control to Ofir [55]; returned to the editor [56]; approved to Irit (ring) and Lior [58]; final versions to Ilai [62]; two hours for scheduling to Ilai, then "לשלוח גאנט" to Irit [64, 66]; weekly call missed: Lior ring Thursday 12:00, the owner board at 18:00 [79]; nudnik every 10 minutes until "בוצע", then Irit is told [69]; exception to Lior, the decision back to Nadia, the next action to Irit [75]; question to Irit, the answer to the owner [77]; renewal in 60 days to Lior and Irit [81].

### 4. Deadlines that differ from the written protocol

**4.1 בינוני · The review is due at the same moment as the work it reviews.** Ran [9, 24, 44]. The 7 checks of Irit and Lior on the 9 graphics carry the deadline of making them (2 hours from the meeting). They sat on both lists from the end of the meeting, and showed "באיחור 21 שעות" eleven minutes after Ilai delivered. The 7 checks of Ofir on the rest of the graphics also appear before anything was uploaded.
**4.2 בינוני · Process 14 is daily in the protocol and one-time in the system.** Ran [33]. "מעקב שוטף מדי יום עד יום הצילום": Irit marked the 8 topics once on Thursday and the process was complete; nothing came back on Sunday or Monday before the Tuesday shoot.
**4.3 נמוך · Process 5 is late the minute the meeting ends** [9]: its deadline is the end of the meeting, so pressing "האפיון הסתיים" turns the remaining items (logo, colours, photos) red at once.
**4.4 נמוך · The two checks of Lior in process 2 inherit the 5 minutes from the signature** [6]: late after 8 minutes.
**4.5 נמוך · Process 34 says "מתחילים 60 יום לפני" and is due the same day** [81, 82]: two days later it is "באיחור 2 ימי עסקים".
**4.6 נמוך · 18:00 or midnight.** The editor page says "אצל אופיר עד ראשון 18:00"; the list and the lateness count from 23:59 [45, 54]. Process 11 says "סוף יום העסקים" and is counted to 23:59 [22].
**4.7 נמוך · Process 27 turns late on Irit and on the editor while they wait for the client**, when the editing itself ran late (day 4 had already passed) [60].
<!-- ' -->
<!-- ' -->

### 5. Things a role saw or could do that are not theirs

Checked at each step who else had the process on "המשימות שלי" (the column "לפני" in steps.md says "מופיע גם אצל" / "לא מופיע אצל").

**5.1 בינוני · The review of the 9 graphics is on two lists.** Ran [9, 21, 24]. The 7 checks, "נשלחו ללקוח" and "הלקוח אישר את הגרפיקות" belong to Irit and to Lior together (the protocol: "עירית או ליאור בודקים"). Lior carried the whole card, late, for a day, although Irit did it. Either of them can mark; nobody claimed it.
**5.2 נמוך · The logo sat with two people** [10, 18, 20]: a late item of process 5 on the list of Ofir, and the task "להשלים מהלקוח: לוגו" the form opened for Irit. Closing one did not close the other.
**5.3 נמוך · After Ofir returned the videos for fixes, card 25 stayed on his list and turned late** while the work was with the editor [56, 57]. Known (docs/ops.md, section 46, finding 3).
**Nothing else leaked:** Ofir and Ilai saw nothing of processes 2 and 3; Irit did not see the items of Lior and the other way round (except 5.1); Nadia saw only her editing and her tasks; Eli only his shoot day; Stav only deal.html (clients.html sends him there); the owner saw the running clocks and the nudnik card, no items.

### 6. Confusing wording, too many taps, marks with nothing behind them

**6.1 בינוני · Five marks were accepted with nothing behind them.** Ran.
- Process 12 [30]: "התסריטים מסודרים בעמוד התסריטים במערכת" with no script in the scripts page; the status page then asked the client to approve "התסריטים ליום הצילום", and she did [32].
- Process 29 [66]: "הגאנט מלא" on a Gantt with 0 rows; Irit got "לשלוח גאנט".
- Process 28 [65]: "תוזמנו מראש" with nothing scheduled.
- Process 23 [47]: "מוכן לבדיקה (לאופיר)" with 1 graphic of 26 ("הועלו 1 מתוך 26"); Ofir approved and Irit sent.
- Process 31 [74]: one pill marks "בוצעה שיחה שבועית ותועדה" with no summary of the call.
A question for the owner rather than a defect: which of these should the system refuse.
**6.2 נמוך · Taps from "המשימות שלי".** Most steps: 1 to 3. The long ones: meeting date 11 [7], shoot date 11 [28], the day of Ilai 19 [19], the characterization form 15 [10], a card of 7 or 8 items 8 to 10 (the button "סימון כל הפריטים שלי כבוצעו" makes it 2, except the items that are never marked in bulk).
**6.3 נמוך · The card of Ilai says "בדיקת גישות (30 דק׳) · נבדק"** while two logins from the client are "עוד לא נבדק" in the same card [19].
**6.4 נמוך · Wording:** "מאפיית הדקל חתם 🎉" and "הלקוח אישר" for a woman; "עירית ענה/תה"; "נדיה סימן/ה"; the editor card says "יום 4 · תיקוני הלקוח" while the work is still at the quality control of Ofir [55, 57].

## Questions for the owner

1. A late item: should its owner be rung again after the deadline (3.2), and should the person waiting for it be told (2.2)?
2. A contract that was sent and not signed: who should see it, where, and after how long (1.2)?
3. Which marks should be refused when nothing is behind them (6.1)?
4. Process 14: a daily follow-up until the shoot day, as written, or the one-time list (4.2)?
5. The review of the graphics: one owner (Irit) with Lior as a fallback, or both (5.1)? And its own deadline, counted from the moment the graphics arrive (4.1)?
6. The fix request of the client: should Irit hear it (2.1)?

## After the report: findings 1.1, 1.2 and 3.1 were fixed (8.10.2026)

The owner approved fixing the two places where a client is silently lost; the rest waits for his decisions. What changed and what is still assumed is docs/ops.md, section 47. The two experiments were rerun on the fixed code (`node tests/sim/stage1.mjs`, then `node tests/sim/exp.mjs`); their records are `tests/sim/state/exp-a.json` and `exp-b.json` (`node tests/sim/show.mjs exp-a 1 short`), and the screenshots after the fix sit next to the original ones with the suffix `-fixed`. The step table (`steps.md`) and the findings above describe the system as it was before the fix.

- **1.1 (experiment B):** after Irit ticked the three items, the card of process 3 stays on her list, late, with "עוד לא נקבע מועד לפגישת האפיון." and the button "קביעת מועד" (`04-irit-exp-p03-no-date-fixed.png`, two days later `05-irit-late-p03-no-date-2days-fixed.png`). She rang again at 10:00 on each of the next two business mornings and Lior's list got it once. Setting the date from the card took 3 taps (`06-irit-exp-p03-set-date-dialog-fixed.png`, `07-irit-exp-p03-date-set-fixed.png`); the card left and Ofir's "בקרוב" got the meeting.
- **1.2 and 3.1 (experiment A):** from the minute the contract was sent Irit has the line "ההסכם של מאפיית הדקל מחכה לחתימה" (`03-irit-contract-sent-waiting-fixed.png`, `04-irit-late-unsigned-day-fixed.png`, `05-irit-late-unsigned-next-fixed.png`), which opens the list of sent quotes on the contracts that wait (`05-irit-unsigned-quotes-list-fixed.png`). The rule `unsigned` produced 6 rows: Stav told once and Irit rung a business day later, a line in her digest on each following morning, Lior's list after two business days, and one ring to Irit when the 72 hours ran out unsigned (`07-irit-late-unsigned-expired-fixed.png`: the line is gone then, see the open question in section 47).
<!-- ' -->

## After the report: findings 2.1, 2.2, 3.2 and 3.3 were fixed, and the owners got an end-of-day table (8.10.2026, docs/ops.md section 48)

The owner approved: whoever is late keeps being reminded (3.2, 3.3) and whoever waits for that work is told (2.2); the client's fix request also reaches Irit (2.1); the owners get a table of what is late every working day at 19:00, in place of the 18:00 digest. The rules, the numbers, the exceptions and the open questions are docs/ops.md, section 48. Finding 4.7 changed with it: work that waits for the client's answer is nobody's lateness (nobody is rung or named late for it; the owners' table lists it apart).

**The rerun.** The whole scenario was run again on the changed code, into a separate folder so that the recorded run above stays as it was:

```
SIM_OUT=<folder> SIM_STATE=<folder> node tests/sim/run.mjs
SIM_STATE=<folder> node tests/sim/log.mjs s10        # the reminder log of the rerun
```

84 steps again; the reminder log has 802 rows (732 before). The step table of the rerun is `steps-after-48.md` in this folder (65 flow, 12 confusing, 4 missing, 3 not simulated; the five steps whose verdict changed are the ones below, and `tests/sim/verdicts.mjs` now carries their new words). `steps.md`, the screenshots and `tests/sim/state/s10.json` are still the run from before the fixes. One detail of the rerun: stages 1 to 6 ran one commit earlier than stages 6b to 10; the only difference between the two is that Ofir and Lior are not told "late" about process 27 while the client's fix is being made, which cannot occur before the fix request of stage 6b.

**The three deliberate delays, the fix request and the late task: the reminder rows, before and after** (who, how, the title; "batch" is one grouped push per person).

| Case | Before | After |
|---|---|---|
| Ilai, the 9 graphics (7), due Mon 12.10 13:25, done Tue 09:45 | 13:40 Ofir and Lior: one quiet batched push each. 18:00 the owner: "הכול לפי התוכנית". Ilai: nothing after the deadline. Irit: nothing | 13:40 **Ilai rings** "באיחור: … 7 · הכנת 9 גרפיקות ראשונות"; **Irit** is told "מתעכב אצל עילאי: …" ("בגלל זה הכרטיס שלך מחכה"); Ofir and Lior as before. 14:00 Ilai: "2 דברים באיחור אצלך" (the Gantt and the graphics, one message). 19:00 the owners: "היום: 1 באיחור אצל עובד אחד, אחד מהיום לא בוצע · עילאי: 1 באיחור (הארוך: 5 שעות) · עירית: אחד מהיום לא בוצע". Tue 09:00 Ilai: "עדיין באיחור: …". After he delivered at 09:45 nobody was rung "late" about work that had just landed on them |
| Irit, the shoot date (11), due the end of Mon 12.10, done Tue 11:30 | Tue 09:15 Ofir and Lior: one quiet batched push each. Irit: only the line in her morning digest | Tue 09:15 **Irit rings** "באיחור: … 11 · קביעת יום צילום" (with "תזכורת ב־09:00 וב־14:00 בכל יום עבודה, עד שזה מסומן"); Ofir and Lior as before. Done at 11:30, so no 14:00 reminder |
| Nadia, the editing (22, 24), due the end of Sun 25.10, done Mon 13:00 | Mon 09:15 Ofir and Lior: one quiet batched push each ("2 איחורים חדשים"). Nadia: nothing after the deadline. The owner at 18:00 on both days: "הכול לפי התוכנית" | Sun 19:00 the owners: "היום: אין איחורים, 2 מהיום לא בוצעו · נדיה: 2 מהיום לא בוצעו". Mon 09:15 **Nadia rings once for both**: "2 איחורים חדשים" (22 and 24); Ofir and Lior as before (Ofir is the one who waits for her hand-over, and hears it there). Done at 13:00, so no 14:00 reminder. Irit is not the next in the chain and is not told |
| The client asks for a fix on the videos, Tue 27.10 10:00 | 09:15 Ofir and Lior: "באיחור: … 27 · … · נדיה" (while everybody waited for the client). 10:01 Nadia rings "הערות הלקוח הגיעו". Irit: nothing; her item kept saying "הלקוח אישר את הסרטונים", late | 09:15: nothing (it was the client's turn). 10:01 Nadia rings as before, and **Irit rings** "הלקוח ביקש תיקון: מאפיית הדקל · רונית דקל" · "הלקוח כתב: ״בסרטון 5 המחיר של מגש המאפים שגוי, צריך להיות 120״. לברר שההערות ברורות ולתעד. נדיה מתקן/ת עד ג׳ 27.10." Her item reads "הלקוח ביקש תיקונים: לברר ולתעד" with the client's words under it, and the "client did not answer, call" clock stops (both checked in `tests/status-e2e.mjs`; the simulation does not photograph her list at that minute). 12:01, once Nadia marked the fixes and only the final versions were left with her: Ofir and Lior get the lateness note of 27 |
| The task Lior opened for Irit (due Mon 2.11), never done | Tue 3.11 08:30: one quiet line to Irit, Lior and Ofir. Then nothing: in August 2027 it was still open, "באיחור 198 ימי עסקים" | Tue 3.11 09:15 **Irit rings** "באיחור: …"; Ofir and Lior get their note. 14:00, and then **every working day at 09:00 and 14:00**: "עדיין באיחור: …" (44 such rings on the days the simulation ticks; it jumps over most of the year and rings again on each ticked day of August 2027). Wed 4.11 14:00 **Ofir and Lior ring** "באיחור יום עסקים: …"; Thu 5.11 14:00 **the owners ring** "באיחור יומיים: …". The owners' 19:00 message names it every day: "עירית: 1 באיחור (הארוך: N ימי עסקים)" |

**The owners' day.** The 18:00 "חריגות היום" (which said "הכול לפי התוכנית" on the days of all three delays) is gone; at 19:00 the owners get "סיכום היום" with the numbers, also on a day with nothing late ("היום הכול נסגר בזמן…"), and with the weekly report on Thursdays as before. It opens owner.html#eod (`s48-owner-eod-phone.png` and `s48-owner-eod.png`, taken by `tests/owner-e2e.mjs` on that suite's own office, not on this scenario).

**Still open after the rerun** (not fixed here): Nadia's own page still shows card 27 as "באיחור" while the client's answer is awaited (the reminders no longer say so; the screens were not changed); the reviewer of work that arrived late is reminded on the original deadline from the next 09:00 or 14:00 (finding 4.1 waits for a decision); findings 1.3 to 1.5, 2.3, 2.4, 3.4, 4.1 to 4.6, 5.x and 6.x are as they were.
<!-- ' -->

## After the report: findings 1.3, 1.4, 4.1, 4.2, 4.6, 5.1 and 6.1 were fixed (9.10.2026, docs/ops.md section 49, protocol version 8)

The owner approved four more fixes: the two links only Irit sends are steps of her list (1.3); a review has its own clock from the moment the work arrives, the review of the 9 graphics has one owner, process 14 is a light daily follow-up, and the end of a business day is 18:00 (4.1, 5.1, 4.2, 4.6); a mark with nothing behind it is refused or asked about (6.1); the shoot date is set from the card and process 11 does not close without it (1.4). What changed, the numbers and the open questions are docs/ops.md, section 49.

**The rerun.** The whole scenario was run again on the changed code, into a separate folder, so the recorded run stays as it was (`steps.md`, `steps-after-48.md`, the screenshots and `tests/sim/state/` were not touched):

```
SIM_OUT=<folder> SIM_STATE=<folder> node tests/sim/run.mjs      # here: stage after stage, each as its own command
SIM_STATE=<folder> node tests/sim/show.mjs s10 1 short
```

The step table of the rerun is `steps-after-49.md` in this folder. The scenario is the same client, calendar and deliberate delays; the harness changed only where a role now acts differently (`tests/sim/stage3b.mjs` to `stage8.mjs`, `steps.mjs`): Irit copies each link from its card; she sets the shoot date from the card's dialog; she answers the daily follow-up on every working day until the shoot (once with a stuck topic); Lior, Ilai and the weekly call first press exactly what they pressed in the first run, and the refusal is recorded. Two things were put into the fake directly and are said so in the table ("דחיפות נתונים"): three scripts and four Gantt rows (the simulation does not drive scripts.html or gantt.html, and there is no Metricool). One step was added because the flow changed around it (step 20, below).

**Totals.**

| Run | Steps | Flow | of them with a remark | Confusing | Missing | Not simulated | Reminder log |
|---|---|---|---|---|---|---|---|
| The first run | 84 | 60 | 7 | 12 | 9 | 3 | 732 rows |
| After section 48 | 84 | 65 | | 12 | 4 | 3 | 802 rows |
| After section 49 | 97 | 88 | 30 | 5 | 1 | 3 | 834 rows |

The 13 added steps: the daily follow-ups of Monday, Tuesday, Wednesday, Sunday and Monday (5; Thursday's replaced the old one-time step of process 14), the looks at Irit's list on Friday and on the shoot day (2), the try to close process 11 with no date (1), the press of "הגאנט מלא" on an empty Gantt and the two second presses after the content was put in (3), Lior closing the exception of the follow-up (1), and Ilai ticking "בדיקת גישות" (1). The five confusing steps left are 6 (finding 4.4), 7 (the harness still sets the meeting date through the client card; the dialog of section 47 is shown in experiment B), 18 (5.2), 67 (5.3) and 95 (4.5). The one missing step is 3: in the main run the client signs 25 minutes after the contract is sent, and the line of section 47 is shown in experiment A.

**Every finding of the report, after this rerun.** "Closed" means a step of this rerun shows it.

| Finding | Status | Steps | What the rerun showed |
|---|---|---|---|
| 1.1 Process 3 with no meeting date | closed (section 47) | experiment B, 1 to 4 | Rerun on this code: the card stays, late, with "עוד לא נקבע מועד"; the date is set in 3 taps |
| 1.2 A contract sent and not signed | closed (section 47) | experiment A, 1 to 5 | Rerun: Irit's line "ההסכם של מאפיית הדקל מחכה לחתימה" on each day, and the list of the waiting quotes |
| 1.3 The two links are not on Irit's list | closed | 9, 11, 12, 25, 27 | Card "5ב" from the minute the meeting ended (a ring at 11:25) and card "7א" from the minute the graphics were ready (a ring at 09:45); on each, "העתקת הקישור" made the link and copied the message, then "סיימתי": 2 taps. Process 5 stayed open at Ofir with "נשמרה גישה ל־Instagram בלבד. יש עוד רשתות?" until the client's form closed it by itself at 12:55 |
| 1.4 The meeting date and the shoot date are 11 taps away | closed | 30, 31; experiment B 3 | Shoot date: 3 taps from the card (the button, the date, save), 5 with "ביומן של כולם". With everything else ticked and no date the card stayed, late (step 30). The meeting date: 3 taps (experiment B); step 7 of the main run still walks the old way |
| 1.5 The Thursday summary card leads to the daily control | open | 86 | Not changed, not simulated further |
| 2.1 The client's fix request reaches the editor only | closed (section 48) | 71 | Irit and Nadia both rang, as after section 48 |
| 2.2 The one who waits is not told | closed (section 48) | 23, 65 | Irit: "מתעכב אצל עילאי" at 13:40, and "מתעכב אצל אופיר" on the quality control |
| 2.3 Confirmations of others are marked by the one who asks | open | 31, 47 | Irit still marks "ליאור אישר" and "הצלם אישר" (now also possible inside the dialog); Lior still marks for the photographer |
| 2.4 The editor assignment did not wait for Ofir | open (for the record) | 55 | As before |
| 3.1 The unsigned contract: no reminder | closed (section 47) | experiment A | As after section 47 |
| 3.2 The late person is not rung again | closed (section 48) | 23, 24, 65 | Ilai "באיחור" 15 work minutes after the deadline; Irit on the shoot date at 09:15; Nadia at 09:15 |
| 3.3 An ordinary late task is mentioned once | closed (section 48) | 92 | Rung twice every working day. The weekly call is now really recorded, so the task it opens for Irit ("לוודא שהשיחה השבועית מתועדת…") was also left open in the idle month, and she had two tasks in each reminder |
| 3.4 A deal between 08:30 and 09:30 can swallow its own rings | open | 1 | Not changed |
| 4.1 The review is due with the work it reviews | closed | 25, 26, 58, 59, 60 | Before the hand-over Irit and Lior had nothing of process 7. Ilai delivered at 09:45, a day late; Irit's card read "היום עד 11:45", not late. The rest: Ofir "היום עד 14:00" (an hour from 13:00), then Irit "מחר עד 18:00" |
| 4.2 Process 14 is one-time | closed | 22, 32, 34, 40, 41, 43, 44, 48 | One line "מעקב לפני צילום: לקוח אחד" on Monday, Tuesday, Wednesday, Thursday, Sunday and Monday; never a card; 2 taps for "הכול תקין"; nothing on Friday and nothing on the shoot day. Wednesday: "משהו תקוע", scripts, a note: 5 taps, and an exception for Lior |
| 4.3 Process 5 is late the minute the meeting ends | open | 9 | Unchanged, and more visible now: the question "יש עוד רשתות?" sits on a card that is red from its first minute |
| 4.4 Lior's two checks in process 2 inherit the 5 minutes | open | 6 | As before |
| 4.5 Process 34 is due the day it opens | open | 95 | As before; the deadline is now 18:00 of that day |
| 4.6 18:00 or midnight | closed | 23, 64 | Process 11 was late at 18:05 on its day ("באיחור 5 דק׳"), and the editing at 18:05 on its third day; the lists say "עד 18:00". The "באיחור" rings came at 09:15 the next morning, as before (15 work minutes after 18:00) |
| 4.7 Process 27 late while everybody waits for the client | partly (as after section 48) | 71 | The reminders are quiet; the editor's own page was not changed here |
| 5.1 The review of the 9 graphics is on two lists | closed | 25, 26 | Irit only. Lior had no card of process 7 at any step |
| 5.2 The logo sat with two people | open | 18 | As before |
| 5.3 Card 25 stays with Ofir after he returns the videos | open | 67 | As before |
| 6.1 Five marks accepted with nothing behind them | closed (23: it asks, as decided) | 35, 36, 58, 76, 77, 78, 79, 87 | 12: "עוד אין תסריט בעמוד התסריטים…", not marked (35); 29: "הגאנט עדיין ריק…" (76); 28: "עוד שום תוכן לא סומן ״תוזמן״ בגאנט…" (77); each was taken once there was content (36, 78, 79). 23: "הועלו 6 מתוך 26. לשלוח בכל זאת?", confirmed, and it went on as before (58). 31: no pill; "תיעוד שיחה" opened the dialog, an empty save was refused, one line was saved (87). All of it is checked in the browser only |
| 6.2 Taps | partly | 11, 27, 31 | The shoot date 11 → 5; each link 3 (inside the client card) → 2 (on the list). Ilai's day (19 taps) and the characterization form (15) are as they were |
| 6.3 Ilai's card says "בדיקת גישות · נבדק" too early | partly | 20 | Not fixed, but it did not happen in this run: the early close had been triggered by Irit opening the client card for the link, which she no longer does. Nothing closed it by itself afterwards either (TikTok is "אין רשת" from the client's form), so Ilai ticked it on his card; the card does not say why it stays open |
| 6.4 Wording | open | | Not changed |

**The reminders of what section 49 added, as the log recorded them.** `clientLink`: two rings to Irit (5ב at 11:25 on the meeting's day, 7א at 09:45 the next day). `followup`: a line in Irit's 08:30 digest on each of the five mornings after the first day, and a ring at 12:00 on two days (Monday, when the meeting had ended at 11:25, and Wednesday, when she answered at 15:30). 5ב passed its deadline before she copied the link (the scenario keeps the first run's 12:15, and 5ב is due 30 work minutes after 11:25): "באיחור: … 5ב" rang her at 12:10. Lior was never rung about the review of the graphics.

**Noticed in this rerun, not fixed.**
- On each day the follow-up row said "המערכת מצאה חוסם אחד" while Irit pressed "הכול תקין". Which blocker it was, was not looked into; the two answers do not talk to each other.
- The exception from "משהו תקוע" reached Lior in his 16:00 list, not as a ring (the shoot was more than two business days away). He closed it from his list (step 37).
- The photographer's free days were not shown in the dialog, because in this scenario Eli never handed his month over; the dialog said so ("אלי עוד לא מסר זמינות לאוקטובר"). The chips and the question about a day he did not mark are covered by `tests/flow-fixes-e2e.mjs`, not by this run.
- Findings 1.5, 2.3, 2.4, 3.4, 4.3, 4.4, 4.5, 5.2, 5.3 and 6.4 are as they were.
<!-- ' -->
