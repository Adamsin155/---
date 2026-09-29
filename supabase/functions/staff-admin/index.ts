// Team accounts for the team screen (team.html, "צוות וכניסות"): who has a login,
// adding a staff row, and a personal sign-in link that the office sends by
// WhatsApp, because Supabase's own email is rate-limited.
//
// Deployed with verify_jwt=false (supabase/config.toml): the caller's token is
// checked here, and the caller must be the owner (staff.person is null), Irit or
// Lior. The rules are in ./rules.js (tested in tests/staff-admin.test.mjs).
// Deploy both files together, e.g. `supabase functions deploy staff-admin`.
//
// POST JSON { action, ... }:
//   list                           → { caller, rows }
//   upsert { email, person?, vault?, mode? } → { ok }  (mode 'add': a new row only)
//   remove { email }               → { ok }            (owner only; the login itself stays)
//   link   { email, redirectTo }   → { link, type }    ('invite' or 'recovery')
//   phone  { email, phone }        → { ok, phone }     (WhatsApp number for the handoff
//                                    buttons; empty clears it; stored as 972XXXXXXXXX)
// Errors: { error: code } with the codes in ERR. Links and tokens are never logged.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  ERR, normEmail, roleOf, bearer, corsHeaders, planUpsert, planRemove, planLink, planPhone, linkTypeFor,
  buildLoginLink, summarize, linkErrorCode,
} from './rules.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = { email: string; person: string | null; vault: boolean; phone?: string | null; created_at?: string };
// What the rules return: { ok: true, ... } or { ok: false, status, error }.
type Plan = { ok: boolean; status?: number; error?: string; [key: string]: any };
type AuthUser = { id: string; email?: string; email_confirmed_at?: string; last_sign_in_at?: string; invited_at?: string };

// All logins by email. The office has a few dozen at most.
async function authUsers(): Promise<Map<string, AuthUser>> {
  const out = new Map<string, AuthUser>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) out.set(u.email.toLowerCase(), u as AuthUser);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function staffRow(email: string): Promise<Row | null> {
  const { data, error } = await admin.from('staff').select('email, person, vault, created_at').eq('email', email).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

// The whole staff list for the team screen. Until the phone column exists (its
// migration, 20260930100100_staff_phone.sql), the list is read without it.
async function staffList(): Promise<Row[]> {
  const withPhone = await admin.from('staff').select('email, person, vault, phone, created_at').order('created_at');
  if (!withPhone.error) return withPhone.data as Row[];
  if (withPhone.error.code !== '42703') throw withPhone.error;
  const { data, error } = await admin.from('staff').select('email, person, vault, created_at').order('created_at');
  if (error) throw error;
  return data as Row[];
}

// payout_owners is keyed by the login, not by the staff row. An error stops the
// link (throws) rather than skipping the check.
async function isPayoutOwner(userId: string): Promise<boolean> {
  const { data, error } = await admin.from('payout_owners').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return !!data;
}

// The latest link made for each email (the log is optional: without its table the list still works).
async function lastLinks() {
  const out = new Map<string, { at: string; by_email: string }>();
  const { data, error } = await admin.from('staff_admin_log').select('target_email, by_email, at')
    .eq('action', 'link').order('at', { ascending: false }).limit(500);
  if (error) return out;
  for (const r of data) if (!out.has(r.target_email)) out.set(r.target_email, r);
  return out;
}

async function log(by: string, action: string, target: string, detail: Record<string, unknown> = {}) {
  const { error } = await admin.from('staff_admin_log').insert({ by_email: by, action, target_email: target, detail });
  if (error) console.warn('staff-admin: log not written', error.code);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'), req.headers.get('access-control-request-headers'));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: ERR.badRequest });

  const token = bearer(req.headers.get('authorization'));
  if (!token) return json(401, { error: ERR.notSignedIn });
  const { data: who, error: whoError } = await admin.auth.getUser(token);
  const user = who?.user;
  if (whoError || !user?.email) return json(401, { error: ERR.notSignedIn });
  if (!user.email_confirmed_at) return json(403, { error: ERR.notAllowed });
  const callerEmail = user.email.toLowerCase();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
  } catch {
    return json(400, { error: ERR.badRequest });
  }

  try {
    const me = await staffRow(callerEmail);
    const role = roleOf(me);
    if (!role) return json(403, { error: ERR.notAllowed });

    switch (body.action) {
      case 'list': {
        const [rows, users, links] = await Promise.all([staffList(), authUsers(), lastLinks()]);
        return json(200, {
          caller: { email: callerEmail, person: me!.person ?? null, owner: role === 'owner', vault: !!me!.vault },
          rows: rows.map((r) => summarize(r, users.get(r.email) ?? null, links.get(r.email) ?? null)),
        });
      }

      case 'upsert': {
        const email = normEmail(body.email);
        if (!email) return json(400, { error: ERR.badEmail });
        const existing = await staffRow(email);
        // What only a manager's request is checked against (see planUpsert): another
        // row with the same person, and a login that is not on the staff list yet.
        let personTaken = false;
        let hasLogin = false;
        if (role === 'manager') {
          if (typeof body.person === 'string' && body.person !== existing?.person) {
            const { count, error } = await admin.from('staff').select('email', { count: 'exact', head: true })
              .eq('person', body.person).neq('email', email);
            if (error) throw error;
            personTaken = (count ?? 0) > 0;
          }
          if (!existing) hasLogin = (await authUsers()).has(email);
        }
        const plan: Plan = planUpsert({ role, callerEmail, existing, input: body, personTaken, hasLogin });
        if (!plan.ok) return json(plan.status!, { error: plan.error });
        const { error } = plan.insert
          ? await admin.from('staff').insert(plan.row)
          : await admin.from('staff').update({ person: plan.row.person, vault: plan.row.vault }).eq('email', email);
        if (error) throw error;
        await log(callerEmail, 'upsert', email, { person: plan.row.person, vault: plan.row.vault, insert: plan.insert });
        return json(200, { ok: true });
      }

      case 'remove': {
        const email = normEmail(body.email);
        if (!email) return json(400, { error: ERR.badEmail });
        const existing = await staffRow(email);
        const plan: Plan = planRemove({ role, callerEmail, existing });
        if (!plan.ok) return json(plan.status!, { error: plan.error });
        const { error } = await admin.from('staff').delete().eq('email', email);
        if (error) throw error;
        await log(callerEmail, 'remove', email, { person: existing!.person });
        return json(200, { ok: true });
      }

      case 'link': {
        const email = normEmail(body.email);
        if (!email) return json(400, { error: ERR.badEmail });
        const target = await staffRow(email);
        const authUser = target ? (await authUsers()).get(email) ?? null : null;
        const targetIsPayoutOwner = role === 'manager' && authUser ? await isPayoutOwner(authUser.id) : false;
        const plan: Plan = planLink({ role, me, target, redirectTo: body.redirectTo, targetIsPayoutOwner });
        if (!plan.ok) return json(plan.status!, { error: plan.error });
        const type = linkTypeFor(authUser);
        const options = { redirectTo: plan.page as string };
        const { data, error } = type === 'invite'
          ? await admin.auth.admin.generateLink({ type: 'invite', email, options })
          : await admin.auth.admin.generateLink({ type: 'recovery', email, options });
        const hashed = data?.properties?.hashed_token;
        if (error || !hashed) {
          const code = error ? linkErrorCode(error) : ERR.linkFailed;
          console.warn('staff-admin: link not created', code, error?.status ?? '');
          return json(code === ERR.tooSoon ? 429 : 502, { error: code });
        }
        await log(callerEmail, 'link', email, { type });
        return json(200, { link: buildLoginLink(plan.page, type, hashed), type });
      }

      case 'phone': {
        const email = normEmail(body.email);
        if (!email) return json(400, { error: ERR.badEmail });
        const target = await staffRow(email);
        const plan: Plan = planPhone({ role, target, input: body });
        if (!plan.ok) return json(plan.status!, { error: plan.error });
        const { error } = await admin.from('staff').update({ phone: plan.phone }).eq('email', email);
        if (error) throw error;
        // Who changed a number, not the number itself.
        await log(callerEmail, 'phone', email, { cleared: plan.phone === null });
        return json(200, { ok: true, phone: plan.phone });
      }

      default:
        return json(400, { error: ERR.unknownAction });
    }
  } catch (e) {
    // Only a short code: messages from the database are not written to the log.
    console.error('staff-admin: failed', String(body.action), (e as { code?: string })?.code ?? (e as Error)?.name ?? 'error');
    return json(500, { error: ERR.server });
  }
});
