// "שאלו את המערכת" (the owner's request of 29.10.2026; docs/ops.md, section 74): the owners, Lior
// and Ofir ask about anything in the system, and Claude answers from read-only tools that read the
// database as the person who asked. Everything it does is in ./handler.js and ./tools.js (node tests
// run them, tests/ask.test.mjs); this file gives it Deno's environment, the Supabase client and the
// Anthropic SDK. ../_shared/app/ is a generated copy of app/ (node scripts/sync-functions.mjs).
//
// The secrets: ANTHROPIC_API_KEY (as contract-ai; without it 503 { error: 'ai_not_configured' }),
// and, for the Drive, GOOGLE_DRIVE_SERVICE_ACCOUNT (the robot account's JSON key; without it the
// drive tool answers "הדרייב עוד לא מחובר" and everything else works).
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { makeHandler, TIMEOUT_MS } from './handler.js';

Deno.serve(makeHandler({
  env: (name: string) => Deno.env.get(name),
  createClient,
  makeClient: (apiKey: string) => new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }),
  Errors: Anthropic,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  log: (message: string) => console.error(message),
}));
