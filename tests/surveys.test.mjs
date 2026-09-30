// The client surveys' shape in one place (app/surveys.js), against the table the
// status page writes (public.client_surveys, 20260930170000_client_status.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readSurvey, scaleOf, lowScore, severeScore, npsOf, SURVEY_KINDS, SURVEY_REPORT_COLS, SURVEY_TABLE,
} from '../app/surveys.js';

const SQL = readFileSync(new URL('../supabase/migrations/20260930170000_client_status.sql', import.meta.url), 'utf8');
const table = SQL.slice(SQL.indexOf(`create table if not exists public.${SURVEY_TABLE} (`), SQL.indexOf('create index if not exists client_surveys_at_idx'));

test('the columns the reports read are the table\'s, and its kinds are the ones known here', () => {
  assert.ok(table.length > 100, 'the table is in the migration');
  for (const col of SURVEY_REPORT_COLS.split(',').map((x) => x.trim())) assert.match(table, new RegExp(`\\n  ${col} `), col);
  assert.match(table, new RegExp(`kind in \\(${SURVEY_KINDS.map((k) => `'${k}'`).join(', ')}\\)`));
  assert.match(table, /kind = 'nps' and score between 0 and 10\) or \(kind <> 'nps' and score between 1 and 5/);
  // The respondent's name is not read by the reports.
  assert.doesNotMatch(SURVEY_REPORT_COLS, /respondent|recorded_by/);
});

test('the thresholds are the database trigger\'s', () => {
  assert.match(SQL, /low boolean := \(new\.kind <> 'nps' and new\.score <= 3\) or \(new\.kind = 'nps' and new\.score <= 6\)/);
  assert.match(SQL, /severe boolean := \(new\.kind <> 'nps' and new\.score <= 2\) or \(new\.kind = 'nps' and new\.score <= 4\)/);
  assert.deepEqual([3, 4].map((n) => lowScore('shoot', n)), [true, false]);
  assert.deepEqual([6, 7].map((n) => lowScore('nps', n)), [true, false]);
  assert.deepEqual([2, 3].map((n) => severeScore('delivery', n)), [true, false]);
  assert.deepEqual([4, 5].map((n) => severeScore('nps', n)), [true, false]);
  assert.deepEqual(scaleOf('nps'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(scaleOf('shoot'), [1, 2, 3, 4, 5]);
});

test('a row is an answer only on its own scale, with a kind and a time', () => {
  const at = '2026-10-05T07:00:00Z';
  assert.deepEqual(readSurvey({ client_id: 'c', kind: 'nps', score: 0, source: 'office', at }), { clientId: 'c', kind: 'nps', score: 0, at: new Date(at), source: 'office' });
  assert.equal(readSurvey({ client_id: 'c', kind: 'shoot', score: 0, at }), null);
  assert.equal(readSurvey({ client_id: 'c', kind: 'delivery', score: 6, at }), null);
  assert.equal(readSurvey({ client_id: 'c', kind: 'nps', score: 4.5, at }), null);
  assert.equal(readSurvey({ client_id: 'c', kind: 'shoot', score: '4', at })?.score, 4);
  assert.equal(readSurvey({ client_id: 'c', kind: 'shoot', score: 4 }), null);
  assert.equal(readSurvey({ client_id: 'c', score: 4, at }), null);
  assert.equal(readSurvey(null), null);
  assert.equal(npsOf([]), null);
  assert.equal(npsOf([10, 9, 8, 0]), 25);
});
