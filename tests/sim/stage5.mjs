// '
// Stage 5, the day before the shoot (Monday 19.10.2026) and the shoot day (Tuesday 20.10.2026, 10:00):
// the reminders to everyone (15), the briefing of the photographer (16), the day itself (17 to 21, with
// the photographer: 17ב, 18ב, 19ב), and the drive back (22א). Run: node tests/sim/stage5.mjs
import { Sim, IL } from "./lib.mjs";
import { proto, letPass } from "./steps.mjs";

const sim = await Sim.start("s5", "s4b");

// Thursday afternoon to Monday morning: the weekend. Nobody acts.
await letPass(sim, IL(2026, 10, 19, 9, 30), { id: "weekend-1", step: "מיום ה׳ 15.10 עד יום ב׳ 19.10 09:30: סוף שבוע, אף אחד לא נוגע", proc: "p14→p15", role: "lior", watch: ["lior", "irit", "eli"] });

// 15: the reminders of the day before (around 11:00), Lior; Irit checks at the same hour.
await sim.until(IL(2026, 10, 19, 10, 40));
await proto(sim, { id: "p15-lior", step: "ליאור: תזכורות למשפיענים, ללקוחה ולצוות, ושיחת הסבר (יום לפני, 11:00)", proc: "p15", role: "lior", shot: "p15-eve",
  keys: ["p15.influencers", "p15.client", "p15.crew", "p15.d.time", "p15.d.address", "p15.d.content", "p15.d.details", "p15.explain"], peek: ["irit", "eli"], next: ["irit"] });
await proto(sim, { id: "p15-irit", step: "עירית מוודאת שהתזכורות נשלחו ושאין משימה פתוחה שתפגע ביום הצילום", proc: "p15", role: "irit", shot: "p15-irit", wait: 8, keys: ["p15.irit"], peek: [], next: [] });
// 16: the briefing of the photographer, in the evening.
await sim.until(IL(2026, 10, 19, 17, 30));
await proto(sim, { id: "p16", step: "ליאור: תדרוך הצלם והכנת יום הצילום (בערב שלפני)", proc: "p16", role: "lior", shot: "p16-briefing",
  keys: ["p16.photographer", "p16.plan", "p16.early", "p16.drive", "p16.content", "p16.open"], peek: ["eli"], next: ["eli"] });

// The shoot day. The photographer arrives an hour before the influencers (09:00).
await sim.until(IL(2026, 10, 20, 9, 5));
await proto(sim, { id: "p17b", step: "אלי (הצלם): הגעה, כונן, ציוד, אזורי צילום ובי־רול לפני המשפיענים", proc: "p17b", role: "eli", shot: "p17b-arrival",
  keys: ["p17b.arrived", "p17b.drive", "p17b.gear", "p17b.zones", "p17b.broll", "p17b.variety"], peek: ["lior"], next: [], gap: 6 });
await proto(sim, { id: "p17", step: "ליאור: הגעה מוקדמת והכנת המקום", proc: "p17", role: "lior", shot: "p17-arrival",
  keys: ["p17.handdrive", "p17.plan", "p17.place", "p17.client", "p17.order", "p17.zones", "p17.brief", "p17.broll"], peek: ["eli"], next: [] });
// The influencers arrive at 10:00; about five hours of shooting.
await sim.until(IL(2026, 10, 20, 15, 20));
await proto(sim, { id: "p21", step: "ליאור: ניהול יום הצילום עם דניס, מישל וסמיון", proc: "p21", role: "lior", shot: "p21-day", keys: ["p21.break", "p21.fun", "p21.explain", "p21.interviews"], peek: [], next: [] });
await proto(sim, { id: "p18", step: "ליאור: עבדנו לפי סדר התסריטים, וכל הכמות צולמה (המונה של יום הצילום)", proc: "p18", role: "lior", shot: "p18-count", keys: ["p18.order", "p18.all"], peek: ["eli"], next: [] });
await proto(sim, { id: "p18b", step: "אלי: צילום לפי הסדר, בדיקת איכות, מספור החומר", proc: "p18b", role: "eli", shot: "p18b", keys: ["p18b.order", "p18b.quality", "p18b.numbered"], peek: [], next: [] });
await proto(sim, { id: "p19b", step: "אלי: סידור הכונן ומסירה לליאור", proc: "p19b", role: "eli", shot: "p19b-drive", keys: ["p19b.folders", "p19b.complete", "p19b.opens", "p19b.cards", "p19b.handed"], peek: ["lior"], next: ["lior"] });
await proto(sim, { id: "p19", step: "ליאור: סיום יום הצילום (הכול צולם, סרטון המלצה, הכונן חזר)", proc: "p19", role: "lior", shot: "p19-close", wait: 5,
  keys: ["p19.all", "p19.testimonial", "p19.drive", "p19.took"], peek: ["eli"], next: ["ofir", "ilai", "irit"] });
sim.save();
await sim.stop();
// '
