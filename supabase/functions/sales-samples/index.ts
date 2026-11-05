// Our videos for the sales CRM's AI brief (handler.js says what and to whom). Server to server only:
// deployed with verify_jwt off, its gate is the secret CRM_SAMPLES_KEY in the header x-crm-key.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeHandler } from './handler.js';

Deno.serve(makeHandler({
  env: (name: string) => Deno.env.get(name),
  createClient,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  log: (message: string) => console.error(message),
}));
