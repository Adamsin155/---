// Creates a shareable quote. The price is recomputed here from the same
// pricing engine the builder uses, so the client link never trusts totals
// sent from the browser. ../_shared/app/ is a generated copy of app/
// (node scripts/sync-functions.mjs), deployed together with this file.
//
// Custom (exceptional) contracts, 6.10.2026 (docs/ops.md, section 30): a selection with
// `custom` (anything that differs from the built-in rules) is validated strictly, its
// totals are computed here, and the database stores it as approval 'pending'. No
// token is returned for it: the client's link exists only after a manager approved
// (public.quote_approve). `revise: <quote id>` stores a corrected version of a contract
// that went for approval (public.quote_revise). Both are for the office only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateSelection, buildQuoteModel, normalizeSelection, exceptionOf } from '../_shared/app/pricing.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIMITS = { name: 120, company: 120, companyId: 20, phone: 40, email: 160, notes: 2000 };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function cleanClient(raw: Record<string, unknown> = {}) {
  const out: Record<string, string> = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
    if (value.length > max) throw new Error(`${key} too long`);
    out[key] = value;
  }
  if (!out.name) throw new Error('client name required');
  if (out.companyId && !/^[0-9][0-9-]{3,18}$/.test(out.companyId)) throw new Error('invalid company id');
  return out;
}

function cleanSelection(raw: any) {
  const sel = {
    docType: raw?.docType,
    tier: raw?.tier,
    influencer: raw?.influencer,
    paid: Array.isArray(raw?.paid) ? [...raw.paid] : raw?.paid,
    free: {
      graphics: raw?.free?.graphics,
      simeonStories: raw?.free?.simeonStories,
      simeonJoin: raw?.free?.simeonJoin,
      extraCh14: raw?.free?.extraCh14,
    },
    discount: raw?.discount ?? 0,
  } as Record<string, unknown>;
  // Passed as sent, so that anything unknown in it is refused by the engine.
  if (raw?.custom !== undefined && raw?.custom !== null) sel.custom = raw.custom;
  validateSelection(sel);
  // Whatever equals the built-in rule is dropped: no deviation, a regular quote.
  return normalizeSelection(sel);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json(401, { error: 'not signed in' });

  const { data: isStaff, error: staffError } = await userClient.rpc('is_staff');
  if (staffError || isStaff !== true) return json(403, { error: 'not staff' });

  let selection, client, revise: string | null = null;
  try {
    const body = await req.json();
    selection = cleanSelection(body.selection);
    client = cleanClient(body.client);
    if (body.revise !== undefined && body.revise !== null) {
      if (typeof body.revise !== 'string' || !UUID.test(body.revise)) throw new Error('invalid quote id');
      revise = body.revise;
    }
  } catch (e) {
    return json(400, { error: String((e as Error).message ?? e) });
  }

  const exceptions = exceptionOf(selection);
  // A contract changed by hand, and a corrected version of one: the office only.
  if (exceptions.length || revise) {
    const { data: isOffice, error: officeError } = await userClient.rpc('is_office');
    if (officeError || isOffice !== true) return json(403, { error: 'custom contracts are prepared by the office' });
  }

  const model = buildQuoteModel(selection, client);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (revise) {
    const { data: revised, error: reviseError } = await admin.rpc('quote_revise', {
      p_id: revise, p_model: model, p_client_name: client.name,
      p_monthly_gross: model.totals.monthlyGross, p_term_gross: model.totals.termGross,
      p_exceptions: exceptions, p_by_email: user.email,
    });
    if (reviseError) {
      const known = /quote not found|only a contract that went for approval/.test(reviseError.message ?? '');
      return json(known ? 409 : 500, { error: known ? 'this contract can no longer be changed' : 'could not save quote' });
    }
    // { id, number, created_at, approval, version, token (only when it became a regular quote) }
    return json(200, revised.token ? revised : { ...revised, token: undefined });
  }
  const { data, error } = await admin
    .from('quotes')
    .insert({
      model,
      client_name: client.name,
      monthly_gross_agorot: model.totals.monthlyGross,
      term_gross_agorot: model.totals.termGross,
      created_by: user.id,
      created_by_email: user.email,
      ...(exceptions.length ? { exceptions } : {}),
    })
    .select(exceptions.length ? 'id, token, number, created_at, approval' : 'id, token, number, created_at')
    .single();

  if (error) return json(500, { error: 'could not save quote' });
  if (!exceptions.length) return json(200, data);
  // Waiting for a manager: there is no link to send yet.
  const row = data as unknown as { id: string; number: string; created_at: string; approval: string };
  return json(200, { id: row.id, number: row.number, created_at: row.created_at, approval: row.approval });
});
