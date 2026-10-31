// The SQL file for the owner that brings the old system's income records in (docs/ops.md, section 86):
// the migration, the rows, the bookkeeping line, and a check to read. The rows are never in the repository.
// Usage: node scripts/old-income-sql.mjs <rows.json> <out.sql>   (UTF-8, no BOM)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FILE = '20261123100000_old_income.sql';
export const VERSION = '20261123100000';
const COLUMNS = ['old_id', 'deal_date', 'business', 'amount', 'retainer', 'package', 'influencer_group', 'payment_method', 'close_type', 'lead_source'];
const NUMERIC = new Set(['amount', 'retainer']);

// A quoted literal: with standard_conforming_strings, as in Supabase, only the quote needs doubling.
export function literal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('whole shekels only');
    return String(v);
  }
  const s = String(v);
  if (s.includes('\0')) throw new Error('a NUL in the text');
  return `'${s.replaceAll("'", "''")}'`;
}
const cell = (row, c) => {
  const v = row[c];
  if (NUMERIC.has(c) && v !== null && v !== undefined && typeof v !== 'number') throw new Error(`${c} is not a number`);
  return literal(v);
};
export const money = (n) => new Intl.NumberFormat('en-US').format(n);

export function ownerSql(migration, rows) {
  if (!rows.length) throw new Error('no rows');
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const values = rows.map((r) => `  (${COLUMNS.map((c) => cell(r, c)).join(', ')})`).join(',\n');
  return `${migration.trimEnd()}

insert into public.old_income_deals (${COLUMNS.join(', ')}) values
${values}
on conflict (old_id) do nothing;

insert into supabase_migrations.schema_migrations (version, name) values ('${VERSION}', 'old_income') on conflict (version) do nothing;

select count(*) as "שורות (צריך ${rows.length})", sum(amount) as "סכום (צריך ${money(sum)})" from public.old_income_deals;
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [rowsPath, out] = process.argv.slice(2);
  if (!rowsPath || !out) throw new Error('usage: node scripts/old-income-sql.mjs <rows.json> <out.sql>');
  const migration = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), 'utf8');
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
  writeFileSync(out, ownerSql(migration, rows), 'utf8');
  console.log(`${rows.length} rows written`);
}
