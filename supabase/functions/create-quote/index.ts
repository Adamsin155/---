// Creates a shareable quote. The price is recomputed here from the same
// pricing engine the builder uses, so the client link never trusts totals
// sent from the browser. ../_shared/app/ is a generated copy of app/
// (node scripts/sync-functions.mjs), deployed together with this file.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateSelection, buildQuoteModel } from '../_shared/app/pricing.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  };
  validateSelection(sel);
  return sel;
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

  let selection, client;
  try {
    const body = await req.json();
    selection = cleanSelection(body.selection);
    client = cleanClient(body.client);
  } catch (e) {
    return json(400, { error: String((e as Error).message ?? e) });
  }

  const model = buildQuoteModel(selection, client);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin
    .from('quotes')
    .insert({
      model,
      client_name: client.name,
      monthly_gross_agorot: model.totals.monthlyGross,
      term_gross_agorot: model.totals.termGross,
      created_by: user.id,
      created_by_email: user.email,
    })
    .select('id, token, number, created_at')
    .single();

  if (error) return json(500, { error: 'could not save quote' });
  return json(200, data);
});
