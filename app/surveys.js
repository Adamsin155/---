// The client surveys as the database keeps them (public.client_surveys, migration
// 20260930170000_client_status.sql; decision 28). One place that knows the shape,
// for every page that reads the table: the owner's insights (app/insights.js), the
// renewals list (app/renewals.js) and the client card (app/status-link-ui.js).
// Pure: no DOM and no database.
//
// A row: client_id, kind ('shoot' | 'delivery' | 'nps'), score (1–5 for shoot and
// delivery, 0–10 for nps; a check constraint holds it), respondent, question,
// source ('page' | 'office'), at (the server's time of the answer). One per client
// and kind (client_surveys_once). Read by the office only (RLS "office reads
// surveys": the owner, Irit, Lior, Ofir and Ilai); nobody else gets a row.

export const SURVEY_TABLE = 'client_surveys';
// The columns the reports read (never the respondent's name or who recorded it).
export const SURVEY_REPORT_COLS = 'client_id, kind, score, source, at';
export const SURVEY_KINDS = ['shoot', 'delivery', 'nps'];
// The two 1–5 questions (the day after the shoot, the first delivery) and the 0–10 one.
export const FIVE_KINDS = ['shoot', 'delivery'];
export const isNps = (kind) => kind === 'nps';
export const scaleMax = (kind) => (isNps(kind) ? 10 : 5);
export const scaleOf = (kind) => (isNps(kind) ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5]);
// Lior calls: 3 or less of 5, 6 or less of 10. The owner hears too: 2 or less, 4 or less
// (the same thresholds as the database's trigger public.client_surveys_stamp).
export const lowScore = (kind, score) => (isNps(kind) ? score <= 6 : score <= 3);
export const severeScore = (kind, score) => (isNps(kind) ? score <= 4 : score <= 2);

// A row as the reports use it, or null when it is not a real answer (an unknown kind,
// a score off its scale, no time).
export function readSurvey(r) {
  if (!r || !SURVEY_KINDS.includes(r.kind)) return null;
  const score = typeof r.score === 'number' ? r.score : r.score === null || r.score === undefined || r.score === '' ? NaN : Number(r.score);
  if (!Number.isInteger(score)) return null;
  const [lo, hi] = isNps(r.kind) ? [0, 10] : [1, 5];
  if (score < lo || score > hi) return null;
  const at = r.at ? new Date(r.at) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return { clientId: r.client_id || null, kind: r.kind, score, at, source: r.source || null };
}

// The standard NPS: promoters 9–10 minus detractors 0–6, in percent of the answers.
export function npsOf(scores) {
  if (!scores.length) return null;
  const promoters = scores.filter((v) => v >= 9).length;
  const detractors = scores.filter((v) => v <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}
export const average = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
