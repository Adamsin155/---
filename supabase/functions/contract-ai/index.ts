// "הכנת חוזה עם AI" (the owner, 25.10.2026; docs/ops.md, section 68): the builder sends the deal
// as Irit wrote it, and this function answers with the builder's own settings, checked against
// the catalog. Everything it does is in ./handler.js (node tests run it, tests/contract-ai.test.mjs);
// this file gives it Deno's environment, the Supabase client and the Anthropic SDK.
// ../_shared/app/ is a generated copy of app/ (node scripts/sync-functions.mjs), deployed with it.
//
// The secret: ANTHROPIC_API_KEY (Supabase dashboard → Edge Functions → Secrets). Without it the
// function answers 503 { error: 'ai_not_configured' } and the builder says so quietly.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { makeHandler, TIMEOUT_MS } from './handler.js';

// The new secret key when the project has one, else the legacy service-role key (as the other
// functions do; the owner, 21.10.2026).
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys?.default) return keys.default;
  } catch { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

Deno.serve(makeHandler({
  env: (name: string) => Deno.env.get(name),
  serviceKey,
  createClient,
  // One credential, given here; a bounded wait and one retry, so Irit is never left waiting long.
  makeClient: (apiKey: string) => new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }),
  Errors: Anthropic,
  log: (message: string) => console.error(message),
}));
