// HTTP helpers of the reminders function, free of Deno APIs so node tests them.
// Only the office's own site may call the "test" action from a browser.
export const SITE_ORIGINS = ['https://adamsin155.github.io', 'https://app.astrateg.tech'];

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (SITE_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export const bearer = (header) => /^Bearer\s+(\S+)$/i.exec(String(header || ''))?.[1] || null;

// The actions: 'tick' (pg_cron, with the x-cron-secret header) and 'test' (a
// signed-in staff member sends a test notification to their own devices).
export const ACTIONS = new Set(['tick', 'test']);
