// Claude accounts of the owners, Lior and Ofir read the system and prepare a contract draft, each with
// their own login (docs/ops.md, section 84). Everything it does is in ./handler.js (node tests run it,
// tests/mcp.test.mjs); this file gives it Deno's environment and the Supabase client.
// ../_shared/app/ is a generated copy of app/ (node scripts/sync-functions.mjs). It also deploys
// ../ask/tools.js and ../ask/handler.js, whose tools and walls it uses: after a change there, deploy both.
//
// The secrets are the ones already in place: the service key (only for public.mcp_usage) and, for the
// Drive, GOOGLE_DRIVE_SERVICE_ACCOUNT (without it the drive tool answers "הדרייב עוד לא מחובר").
// `verify_jwt = false` in supabase/config.toml: an MCP client's first request has no token and must be
// answered with 401 and where to sign in; the token is checked in code on every request.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeHandler } from './handler.js';

// The new secret key when the project has one, else the legacy service-role key (as the other functions do).
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
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  log: (message: string) => console.error(message),
}));
