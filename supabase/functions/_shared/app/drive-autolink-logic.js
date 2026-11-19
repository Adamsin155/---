// generated — edit app/ instead. Source: app/drive-autolink-logic.js. Regenerate: node scripts/sync-functions.mjs
// The clients' Drive folders found and connected by themselves (the owner, 19.11.2026; docs/ops.md,
// section 143). Plain logic, so node tests it (tests/drive-autolink.test.mjs); the edge function
// supabase/functions/drive-link/ runs it.
//   1. who: current clients (active or ending, not archived) with an empty Drive link;
//   2. which folders: those inside the main clients folder that no client is linked to;
//   3. Claude reads only names (the business, the client's name, the folders') and answers per
//      client: one folder it is sure of, a few possible ones, or none;
//   4. the answer is checked here: a folder it does not know is dropped, a folder given to two
//      clients is nobody's sure folder (both are asked about), and a client already asked about the
//      same folders is not asked again.
// "Sure" is the same name, or the same name in another language or spelling ("לאב מובייל" =
// "LAB MOBILE", "דרים סקין" = "Dream skin"). Names that only look alike are different businesses
// ("נוריה" is not "נורית"): never sure (the owner, 19.11.2026).

export const AUTOLINK_MODEL = 'claude-sonnet-5-5'; // the same model as contract-ai (handler.js MODEL)
export const MAX_CLIENTS = 60;
export const MAX_FOLDERS = 400;
export const MAX_CANDIDATES = 3;
const NAME_MAX = 80;

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const folderIdOf = (link) => /\/folders\/([\w-]{10,})/.exec(String(link || ''))?.[1] || null;
export const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

// The clients to find a folder for, and the free folders. `clients`: every client (any status:
// a folder linked to an archived client is still that client's); `folders`: [{ id, name }].
export function autolinkWork(clients, folders) {
  const used = new Set((clients || []).map((c) => folderIdOf(c.links?.drive)).filter(Boolean));
  const free = [];
  const seen = new Set();
  for (const f of folders || []) {
    const id = String(f?.id || '');
    if (!/^[\w-]{10,100}$/.test(id) || used.has(id) || seen.has(id)) continue;
    const name = clean(f.name);
    if (!name) continue;
    seen.add(id);
    free.push({ id, name });
  }
  const want = (clients || []).filter((c) => ['active', 'ending'].includes(c.status) && !c.archived_at
    && !String(c.links?.drive || '').trim() && (clean(c.business) || clean(c.name)));
  return { clients: want.slice(0, MAX_CLIENTS), folders: free.slice(0, MAX_FOLDERS) };
}

// What goes to Claude: short references instead of ids (c1…, f1…), and names only.
export function autolinkPayload(work) {
  const clients = work.clients.map((c, i) => ({ ref: `c${i + 1}`, business: clean(c.business), name: clean(c.name) }));
  const folders = work.folders.map((f, i) => ({ ref: `f${i + 1}`, name: f.name }));
  return { clients, folders };
}

export const AUTOLINK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['client', 'sure', 'maybe'],
        properties: {
          client: { type: 'string' },
          sure: { type: ['string', 'null'] },
          maybe: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export function autolinkSystemPrompt() {
  return [
    'You match the clients of an Israeli marketing office to their folders in Google Drive.',
    'You get the clients (the business name and the client\'s own name) and the folder names, each with a reference. Answer for every client, by meaning:',
    '- sure: the reference of the one folder that is the SAME business: the same name, the same name written in another language or spelling (Hebrew and English: "לאב מובייל" = "LAB MOBILE", "דרים סקין" = "Dream skin"), or the same name with extra words that only add a city, a branch or a kind ("מזליטו" = "מזליטו פרדס חנה"; a legal suffix like בע"מ does not matter).',
    '- Names that only look alike in letters are DIFFERENT businesses and are never sure: "נוריה" is not "נורית", "שירן" is not "שירה". When in doubt, it is not sure.',
    '- A folder named after the client\'s own name (a person) is the client\'s only when nothing else fits better; then it is maybe, not sure.',
    '- maybe: up to three references of folders that could be the client\'s but you are not sure (only real possibilities, not every folder with a common word like "שווארמה" or "קליניקה"). Empty when sure is set or when nothing fits.',
    '- sure null and maybe empty when no folder fits: the folder may not exist yet.',
    'Use only the references given. Never give one folder as sure to two clients.',
  ].join('\n');
}

export function autolinkRequest(payload) {
  return {
    model: AUTOLINK_MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: AUTOLINK_SCHEMA } },
    system: [{ type: 'text', text: autolinkSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  };
}

// The JSON of the answer, or null.
export function answerOf(message) {
  if (!message || message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return null;
  const block = (Array.isArray(message.content) ? message.content : []).find((b) => b?.type === 'text');
  try { return block ? JSON.parse(block.text) : null; } catch { return null; }
}

// Claude's answer checked against what was sent: [{ client, sure: folder|null, maybe: [folder] }],
// one per client that has something. A folder given as sure to two clients is nobody's sure folder.
export function checkAnswer(answer, work) {
  const cRef = new Map(work.clients.map((c, i) => [`c${i + 1}`, c]));
  const fRef = new Map(work.folders.map((f, i) => [`f${i + 1}`, f]));
  const out = new Map();
  for (const m of Array.isArray(answer?.matches) ? answer.matches : []) {
    const c = cRef.get(String(m?.client || ''));
    if (!c || out.has(c.id)) continue;
    const sure = typeof m.sure === 'string' ? fRef.get(m.sure) || null : null;
    const maybe = [];
    for (const r of Array.isArray(m.maybe) ? m.maybe : []) {
      const f = fRef.get(String(r));
      if (f && f !== sure && !maybe.includes(f)) maybe.push(f);
    }
    out.set(c.id, { client: c, sure, maybe: maybe.slice(0, MAX_CANDIDATES) });
  }
  const sureCount = new Map();
  for (const x of out.values()) if (x.sure) sureCount.set(x.sure.id, (sureCount.get(x.sure.id) || 0) + 1);
  for (const x of out.values()) {
    if (x.sure && sureCount.get(x.sure.id) > 1) {
      x.maybe = [x.sure, ...x.maybe.filter((f) => f !== x.sure)].slice(0, MAX_CANDIDATES);
      x.sure = null;
    }
  }
  return [...out.values()].filter((x) => x.sure || x.maybe.length);
}

export const askKeyOf = (folders) => folders.map((f) => f.id).sort().join(',');

// What to do: [{ act: 'link', client, folder }] and [{ act: 'ask', client, candidates, key }].
// `states`: Map client id → its drive_link_state row. The same folders are asked about once:
// not again while the question is open ('ask'), nor after Irit said none of them ('none').
export function autolinkActions(checked, states = new Map()) {
  const out = [];
  for (const x of checked) {
    if (x.sure) { out.push({ act: 'link', client: x.client, folder: x.sure }); continue; }
    const key = askKeyOf(x.maybe);
    const s = states.get(x.client.id);
    if (s && ['ask', 'none'].includes(s.status) && s.ask_key === key) continue;
    out.push({ act: 'ask', client: x.client, candidates: x.maybe.map((f) => ({ id: f.id, name: f.name })), key });
  }
  return out;
}

// The words of the question to Irit and the owners (the reminder rule driveAsk).
export function askWords(name, candidates) {
  const list = (candidates || []).map((f) => `״${f.name}״`).join(' או ');
  return {
    title: `איזו תיקייה בדרייב של ${name}?`,
    body: `המערכת לא בטוחה. אולי ${list}. לבחור בכרטיס הלקוח (או ״אף אחת״).`,
  };
}
