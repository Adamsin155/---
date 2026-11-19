// "התיקייה בדרייב" in the client's card (the owner, 19.11.2026; docs/ops.md, section 143): when the
// drive-link function found folders that could be the client's but was not sure, the office (Irit)
// picks one in one tap, or "אף אחת". When it connected one by itself, the card says "חובר אוטומטית"
// beside the Drive link. The pick is public.drive_link_pick (into an empty link only).
import { supabase, explainError } from './supa.js';
import { h, toast } from './protocol-ui.js';

// The client's row of public.drive_link_state, or null (none, or not the office's to read).
export async function loadDrivePick(clientId) {
  try {
    const { data, error } = await supabase.from('drive_link_state').select('status, folder_id, folder_name, candidates').eq('client_id', clientId).maybeSingle();
    return error ? null : data || null;
  } catch { return null; }
}

const folderIdOf = (link) => /\/folders\/([\w-]{10,})/.exec(String(link || ''))?.[1] || null;

// "חובר אוטומטית" when the Drive link is the one the function connected.
export function autoLinkedTag(state, driveLink) {
  if (state?.status !== 'auto' || !state.folder_id || folderIdOf(driveLink) !== state.folder_id) return null;
  return h('span', { class: 'auto-tag', id: 'drive-auto-tag', title: 'המערכת מצאה את התיקייה בדרייב וחיברה אותה' }, 'חובר אוטומטית');
}

// The choice, only while the question is open and the card has no Drive link.
export function drivePickBlock(state, { clientId, driveLink, onDone }) {
  const list = Array.isArray(state?.candidates) ? state.candidates.filter((f) => f?.id && f?.name) : [];
  if (state?.status !== 'ask' || String(driveLink || '').trim() || !list.length) return null;
  const pick = async (btn, folder) => {
    const all = btn.closest('.drive-pick').querySelectorAll('button');
    all.forEach((b) => { b.disabled = true; });
    try {
      const { data, error } = await supabase.rpc('drive_link_pick', { p_client: clientId, p_folder: folder?.id ?? null });
      if (error) throw error;
      toast({
        linked: `התיקייה ״${folder?.name}״ חוברה.`,
        none: 'נשמר: אף אחת מהתיקיות. המערכת תמשיך לחפש.',
        taken: 'התיקייה הזו כבר מחוברת ללקוח אחר.',
        kept: 'כבר יש קישור לדרייב בכרטיס.',
      }[data] || 'נשמר.');
      await onDone?.();
    } catch (err) {
      toast(explainError ? explainError(err) : 'לא נשמר. נסו שוב.');
      all.forEach((b) => { b.disabled = false; });
    }
  };
  return h('section', { class: 'drive-pick', id: 'drive-pick', 'aria-label': 'התיקייה בדרייב' },
    h('h2', {}, 'התיקייה בדרייב'),
    h('p', { class: 'hint' }, 'המערכת מצאה תיקיות שאולי של הלקוח, ולא בטוחה. איזו מהן?'),
    h('div', { class: 'drive-pick-acts' },
      ...list.map((f) => h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => pick(e.currentTarget, f) }, f.name)),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: (e) => pick(e.currentTarget, null) }, 'אף אחת')));
}
