// The files in a client's Google Drive folder, for "משיכת קישורים מהדרייב" in the content Gantt
// (the owner's request of 29.10.2026; docs/ops.md, section 74). Everything it does is in
// ./handler.js (node tests run it, tests/drive.test.mjs); the Drive itself is ../_shared/drive.js.
// The secret: GOOGLE_DRIVE_SERVICE_ACCOUNT (the robot account's JSON key).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeHandler } from './handler.js';

Deno.serve(makeHandler({
  env: (name: string) => Deno.env.get(name),
  createClient,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  log: (message: string) => console.error(message),
}));
