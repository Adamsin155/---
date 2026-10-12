// The WhatsApp channel of the reminders function, wired to the database (Deno).
// Returns null — push only — unless the owner turned WhatsApp on
// (public.app_settings 'whatsapp_enabled'), the provider's secrets are in Vault
// (public.whatsapp_config_v2 checks both, and reads them for the service role
// only) and someone agreed to it. Before migration 20260930180000 the call fails
// and the tick runs as before.
//
// The provider (public.whatsapp_provider; docs/ops.md, section 63): 'meta', Meta's
// Cloud API directly with its four secrets, or 'jako', the owner's provider with one
// API key (./wa-poll.js). Before migration 20261025100000 there is only Meta.
import { makeWhatsapp } from './whatsapp.js';
import { makeJakoWhatsapp } from './wa-poll.js';
import { waRecipients } from '../_shared/app/wa-logic.js';
import { graphSend } from '../_shared/wa-graph.js';
import { makeJako } from '../_shared/wa-jako.js';

type Row = Record<string, any>;

// Jako's client lives as long as the instance (it remembers the templates'
// namespaces), and is made again when the key in Vault changes.
let jakoCache: { key: string; client: ReturnType<typeof makeJako> } | null = null;
function jakoClient(key: string) {
  if (jakoCache?.key !== key) jakoCache = { key, client: makeJako({ fetch, apiKey: key }) };
  return jakoCache.client;
}

// deno-lint-ignore no-explicit-any
async function config(admin: any): Promise<Row | null> {
  let { data, error } = await admin.rpc('whatsapp_config_v2');
  // The provider migration is not applied yet: Meta only, as before.
  if (error?.code === 'PGRST202') ({ data, error } = await admin.rpc('whatsapp_config'));
  if (error?.code === 'PGRST202') return null; // the WhatsApp migration is not applied yet
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as Row | null;
}

// deno-lint-ignore no-explicit-any
export async function whatsappChannel(admin: any) {
  const cfg = await config(admin);
  const jako = cfg?.provider === 'jako';
  if (!cfg?.enabled || (jako ? !cfg.jako_api_key : !cfg.access_token || !cfg.phone_number_id)) return null;
  const { data: rows, error: listError } = await admin.rpc('whatsapp_recipients');
  if (listError) throw listError;
  const recipients = waRecipients(rows ?? []);
  if (!recipients.size) return null;
  const db = {
    async claim(row: Row) {
      const { data: out, error: e } = await admin.from('whatsapp_messages').upsert(row, { onConflict: 'log_id', ignoreDuplicates: true }).select('id');
      if (e) throw e;
      return out?.[0] ?? null;
    },
    async update(id: number, patch: Row) {
      const { error: e } = await admin.from('whatsapp_messages').update(patch).eq('id', id);
      if (e) throw e;
    },
    async expire(before: Date) {
      const { data: out, error: e } = await admin.from('whatsapp_messages')
        .update({ status: 'failed', error: 'lost: the tick that claimed it stopped', failed_at: new Date().toISOString() })
        .eq('status', 'pending').lt('created_at', before.toISOString()).select('id');
      if (e) throw e;
      return out?.length ?? 0;
    },
  };
  if (jako) {
    // The replies ("הסר"): who is asked now, what was read, and the withdrawal itself.
    const pollDb = {
      async due(max: number, everyMs: number) {
        const { data: out, error: e } = await admin.rpc('whatsapp_poll_due', { p_max: max, p_every_seconds: Math.round(everyMs / 1000) });
        if (e) throw e;
        return (out ?? []) as Row[];
      },
      async done(email: string, until: Date) {
        const { error: e } = await admin.rpc('whatsapp_poll_done', { p_email: email, p_until: until.toISOString() });
        if (e) throw e;
      },
      async stop({ inbound, from }: Row) {
        const { data: out, error: e } = await admin.rpc('whatsapp_apply', { p_inbound: inbound, p_message: null, p_from: from, p_plan: { op: 'withdraw' } });
        if (e) throw e;
        return out as string;
      },
    };
    return makeJakoWhatsapp({ db, pollDb, jako: jakoClient(cfg.jako_api_key), recipients, flows: { done: cfg.jako_flow_done, onit: cfg.jako_flow_onit } });
  }
  const send = (message: Row) => graphSend({ fetch, token: cfg.access_token, phoneNumberId: cfg.phone_number_id, message });
  return makeWhatsapp({ db, send, recipients });
}
