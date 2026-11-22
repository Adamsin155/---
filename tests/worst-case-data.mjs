// The data of tests/worst-case-sweep-e2e.mjs (docs/ops.md, section 147), in a file of its own so a
// one-page look (a probe while fixing) opens the same office.
import { NOW, emailOf, cid } from './late-world.mjs';
import { worstWorld, LONG_BUSINESS, LONG_NAME, UNBROKEN } from './worst-world.mjs';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// ── The data ─────────────────────────────────────────────────────────────────────────────
export function world() {
  const db = worstWorld();
  for (const [i, c] of db.clients.entries()) {
    c.deliverables = {
      ...(c.deliverables || {}), videos: 99, graphics: 99, shoot_days: 12,
      tracking: {
        ...(c.deliverables?.tracking || {}),
        videos: { done: i % 4 === 0 ? 9999 : 2140, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 48, of: 99 } },
        graphics: { done: i % 4 === 1 ? 9999 : 1367, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 30, of: 99 } },
        shoots: { agreed: 12, held: 11, by: 'irit', at: '2026-10-19T09:00:00+03:00' },
      },
    };
    c.contract_end ||= '2027-10-11';
    c.metricool_blog_id ||= 1000 + i;
  }
  const at = (d) => new Date(NOW.getTime() - d * 864e5).toISOString();
  db.quotes = Array.from({ length: 40 }, (_, i) => ({
    id: `f0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, token: `t${i}`, number: `AST-2026-${String(9000 + i)}`,
    client_name: i % 3 === 0 ? LONG_NAME : i % 3 === 1 ? UNBROKEN : 'לקוח',
    monthly_gross_agorot: 81537528, term_gross_agorot: 978450336, created_at: at(i % 18), created_by_email: emailOf(i % 2 ? 'irit' : 'owner'),
    status: ['sent', 'signed', 'expired'][i % 3], first_viewed_at: i % 2 ? at(1) : null, signed_at: i % 3 === 1 ? at(i % 18) : null, signer_name: LONG_NAME,
    tier: 'Social + TV all in one', influencer: 'סמיון, מישל ודניס', doc: 'הסכם התקשרות', signable: 'true', expires_at: new Date(NOW.getTime() + 7 * 864e5).toISOString(),
    phone: '+972-50-1234567', approval: 'none', approval_by: null, approval_note: null, approval_at: null, term: '12', valid: '168',
    company: i % 2 ? LONG_BUSINESS : UNBROKEN, email: 'x@example.test', prepared_by: null, exceptions: null,
    model: { client: { company: LONG_BUSINESS, phone: '+972-50-1234567' }, package: { tierName: 'Social + TV all in one', influencer: 'סמיון, מישל ודניס' }, docTitle: 'הסכם התקשרות', signable: true, termMonths: 12, validHours: 168 },
  }));
  return db;
}
// The functions the fake world does not answer, with big numbers.
export function extraRoutes(db) {
  return async (r) => {
    const p = new URL(r.request().url()).pathname;
    const json = async (data) => { await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: CORS }); return true; };
    if (p === '/rest/v1/rpc/content_months') {
      const rows = [];
      for (const c of db.clients.slice(0, 50)) for (const month of ['2026-09', '2026-10', '2026-11']) rows.push({ client_id: c.id, first_month: '2026-01', month, posted: 999, planned: 1234 });
      return json(rows);
    }
    if (p === '/rest/v1/rpc/sales_shoot_days') {
      return json(Array.from({ length: 20 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, n: (i % 4) + 1 })));
    }
    return null;
  };
}

