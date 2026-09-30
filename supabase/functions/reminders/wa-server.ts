// The WhatsApp channel of the reminders function, wired to the database (Deno).
// Returns null — push only — unless the owner turned WhatsApp on
// (public.app_settings 'whatsapp_enabled'), all four secrets are in Vault
// (public.whatsapp_config checks both, and reads the token for the service role
// only) and someone agreed to it. Before migration 20260930180000 the call fails
// and the tick runs as before.
import { makeWhatsapp } from './whatsapp.js';
import { waRecipients } from '../_shared/app/wa-logic.js';
import { graphSend } from '../_shared/wa-graph.js';

type Row = Record<string, any>;

// deno-lint-ignore no-explicit-any
export async function whatsappChannel(admin: any) {
  const { data, error } = await admin.rpc('whatsapp_config');
  if (error?.code === 'PGRST202') return null; // the migration is not applied yet
  if (error) throw error;
  const cfg = (Array.isArray(data) ? data[0] : data) as Row | null;
  if (!cfg?.enabled || !cfg.access_token || !cfg.phone_number_id) return null;
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
  const send = (message: Row) => graphSend({ fetch, token: cfg.access_token, phoneNumberId: cfg.phone_number_id, message });
  return makeWhatsapp({ db, send, recipients });
}
