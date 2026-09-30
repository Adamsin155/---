// generated — edit app/ instead. Source: app/holidays.js. Regenerate: node scripts/sync-functions.mjs
// Days the office is closed although they fall Sunday–Thursday: Israeli office holidays for business-day math, 2026-01-01 .. 2028-12-31.
// Israel schedule (one day of yom tov). Only days that fall Sunday–Thursday are listed;
// Friday/Saturday are already non-business days.
//
// Source of dates: computed by hand from the fixed Hebrew-calendar offsets
// (Rosh Hashana = Pesach I + 163 days; Shavuot = Pesach I + 50; 5 Iyar = Pesach I + 20)
// and the Yom HaAtzma'ut move rules as coded in hebcal-es6 src/modern.ts
// (Pesach on Sun -> 3 Iyar; Pesach on Sat -> 4 Iyar; Pesach on Tue -> 6 Iyar; else 5 Iyar).
// Cross-checked against hebcal.com / chabad.org search snippets:
// Pesach 2026-04-01 eve, Yom HaAtzma'ut 2026-04-22, RH 5787 eve 2026-09-11, YK 2026-09-21,
// Pesach 2027-04-21 eve, RH 5788 eve 2027-10-01, YK 2027-10-11, Yom HaAtzma'ut 2027-05-12,
// Pesach 2028-04-10 eve, Yom HaAtzma'ut 2028-05-02, Shavuot 2028-05-30 eve,
// YK 2028-09-30 (Sat), Shemini Atzeret 2028-10-12.
// Verified 2026-09-29 against @hebcal/core (Israel schedule): the closed days match exactly.
// Regenerate before 2029 (script in docs/protocols/research-implementation.md);
// a unit test fails from 90 days before COVERAGE.to.
//
// Dates are Israel calendar days. Look them up with the lookups at the end of
// this file (an Israel day key from tz.js), never with the device's local date
// or toISOString() (a phone abroad or UTC shifts the day).
import { dayKeyIL, daysBetweenIL, dayFromKeyIL } from './tz.js';

export const COVERAGE = { from: '2026-01-01', to: '2028-12-31' };

// Office closed (yom tov + Yom HaAtzma'ut), Sunday–Thursday only.
export const HOLIDAYS = [
  // 2026 (Shavuot 05-22 Fri, RH I 09-12 Sat, Sukkot I 09-26 Sat, Shemini Atzeret 10-03 Sat — not listed)
  { date: '2026-04-02', name: 'פסח' },
  { date: '2026-04-08', name: 'שביעי של פסח' },
  { date: '2026-04-22', name: 'יום העצמאות' },
  { date: '2026-09-13', name: 'ראש השנה (יום ב׳)' },
  { date: '2026-09-21', name: 'יום כיפור' },
  // 2027 (Shavuot 06-11 Fri, RH I 10-02 Sat, Sukkot I 10-16 Sat, Shemini Atzeret 10-23 Sat — not listed)
  { date: '2027-04-22', name: 'פסח' },
  { date: '2027-04-28', name: 'שביעי של פסח' },
  { date: '2027-05-12', name: 'יום העצמאות' },
  { date: '2027-10-03', name: 'ראש השנה (יום ב׳)' },
  { date: '2027-10-11', name: 'יום כיפור' },
  // 2028 (RH II 09-22 Fri, Yom Kippur 09-30 Sat — not listed)
  { date: '2028-04-11', name: 'פסח' },
  { date: '2028-04-17', name: 'שביעי של פסח' },
  { date: '2028-05-02', name: 'יום העצמאות' }, // 5 Iyar is Monday -> moved to Tuesday
  { date: '2028-05-31', name: 'שבועות' },
  { date: '2028-09-21', name: 'ראש השנה (יום א׳)' },
  { date: '2028-10-05', name: 'סוכות' },
  { date: '2028-10-12', name: 'שמיני עצרת ושמחת תורה' },
];

// Erev chag: a business day, but the office closes at 13:00 (WORK_HOURS.erevEnd
// in protocol.js; decision 2). Days that are also Chol HaMoed appear in both lists,
// and the erev rule wins.
export const EREV = [
  // 2026 (erev RH 09-11, erev Sukkot 09-25, Hoshana Raba 10-02 are Fridays — not listed)
  { date: '2026-04-01', name: 'ערב פסח' },
  { date: '2026-04-07', name: 'ערב שביעי של פסח' },
  { date: '2026-05-21', name: 'ערב שבועות' },
  { date: '2026-09-20', name: 'ערב יום כיפור' },
  // 2027 (erev RH 10-01, erev Sukkot 10-15, Hoshana Raba 10-22 are Fridays — not listed)
  { date: '2027-04-21', name: 'ערב פסח' },
  { date: '2027-04-27', name: 'ערב שביעי של פסח' },
  { date: '2027-06-10', name: 'ערב שבועות' },
  { date: '2027-10-10', name: 'ערב יום כיפור' },
  // 2028 (erev Yom Kippur 09-29 is Friday — not listed)
  { date: '2028-04-10', name: 'ערב פסח' },
  { date: '2028-04-16', name: 'ערב שביעי של פסח' },
  { date: '2028-05-30', name: 'ערב שבועות' },
  { date: '2028-09-20', name: 'ערב ראש השנה' },
  { date: '2028-10-04', name: 'ערב סוכות' },
  { date: '2028-10-11', name: 'הושענא רבה (ערב שמיני עצרת)' },
];

// Chol HaMoed, Sunday–Thursday only: a normal business day (decision 2).
export const CHOL_HAMOED = [
  // 2026
  { date: '2026-04-05', name: 'חול המועד פסח' },
  { date: '2026-04-06', name: 'חול המועד פסח' },
  { date: '2026-04-07', name: 'חול המועד פסח' },
  { date: '2026-09-27', name: 'חול המועד סוכות' },
  { date: '2026-09-28', name: 'חול המועד סוכות' },
  { date: '2026-09-29', name: 'חול המועד סוכות' },
  { date: '2026-09-30', name: 'חול המועד סוכות' },
  { date: '2026-10-01', name: 'חול המועד סוכות' },
  // 2027
  { date: '2027-04-25', name: 'חול המועד פסח' },
  { date: '2027-04-26', name: 'חול המועד פסח' },
  { date: '2027-04-27', name: 'חול המועד פסח' },
  { date: '2027-10-17', name: 'חול המועד סוכות' },
  { date: '2027-10-18', name: 'חול המועד סוכות' },
  { date: '2027-10-19', name: 'חול המועד סוכות' },
  { date: '2027-10-20', name: 'חול המועד סוכות' },
  { date: '2027-10-21', name: 'חול המועד סוכות' },
  // 2028
  { date: '2028-04-12', name: 'חול המועד פסח' },
  { date: '2028-04-13', name: 'חול המועד פסח' },
  { date: '2028-04-16', name: 'חול המועד פסח' },
  { date: '2028-10-08', name: 'חול המועד סוכות' },
  { date: '2028-10-09', name: 'חול המועד סוכות' },
  { date: '2028-10-10', name: 'חול המועד סוכות' },
  { date: '2028-10-11', name: 'הושענא רבה' },
];

// Lookups by the Israel calendar day of a moment.
const byDay = (list) => new Map(list.map((h) => [h.date, h]));
const CLOSED = byDay(HOLIDAYS);
const EREV_DAYS = byDay(EREV);
export const holidayOn = (d) => CLOSED.get(dayKeyIL(d)) || null;
export const erevOn = (d) => (CLOSED.has(dayKeyIL(d)) ? null : EREV_DAYS.get(dayKeyIL(d)) || null);

// Days from the Israel day of `now` to the last day the lists cover.
export const coverageDaysLeft = (now = new Date()) => daysBetweenIL(now, dayFromKeyIL(COVERAGE.to));
