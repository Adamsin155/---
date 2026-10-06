// Exceptional contracts and their approval (the owner's decisions of 6.10.2026): who
// decides, what each person sees of a contract that went for approval, and the words.
// Pure, no DOM and no network: the approvers' card and Irit's states
// (app/approvals-ui.js), quotes.html (app/dashboard.js), the builder and the reminder
// rules (app/reminder-rules.js, also on the server) share it. The database enforces
// all of it (supabase/migrations/20261010100000_custom_contracts.sql); this only
// shapes the screens.
import { addWorkingMinutes, parseDate } from './protocol-logic.js';

export const OWNER = 'owner';
// One of them is enough: the owner (staff.person is null), Ofir and Lior.
export const APPROVERS = [OWNER, 'ofir', 'lior'];
export const APPROVER_NAMES = 'אדם, אופיר או ליאור';
// Nobody decided within this many office minutes: the approvers ring once more, and
// whoever prepared the contract is told quietly.
export const APPROVAL_NUDGE_MINUTES = 30;

// The viewer as a person key ('owner' for the owner's row), or null when unknown.
export const personOfViewer = (viewer) => {
  if (!viewer || viewer.error) return null;
  if (viewer.me) return viewer.me;
  return viewer.scope === 'office' ? OWNER : null;
};
export const canApprove = (viewer) => APPROVERS.includes(personOfViewer(viewer));
// The office prepares custom contracts and sees their state (the quotes are theirs).
export const seesApprovals = (viewer) => !!viewer && !viewer.error && viewer.scope === 'office';

const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
export const preparedBy = (q) => q?.submitted_by_email || q?.created_by_email || '';
// Whether this viewer may decide on this contract: an approver, the contract is
// waiting, and it is not their own (the owner may decide on his own).
export function mayDecide(q, viewer, email) {
  if (!canApprove(viewer) || q?.approval !== 'pending' || q?.status !== 'sent') return false;
  return personOfViewer(viewer) === OWNER || !same(preparedBy(q), email);
}

// The states, as the office reads them.
export const APPROVAL_TEXT = {
  pending: 'ממתין לאישור',
  approved: 'אושר — אפשר לשלוח',
  rejected: 'לא אושר',
};
export function approvalText(q) {
  if (!q || !q.approval || q.approval === 'none') return '';
  if (q.approval === 'rejected') return `${APPROVAL_TEXT.rejected}${q.approval_note ? `: ${q.approval_note}` : ''}`;
  return APPROVAL_TEXT[q.approval] || '';
}
// A contract that went for approval and still needs someone: waiting, sent back, or
// approved and not signed yet. Signed, cancelled and regular quotes are not listed.
export const inApproval = (q) => !!q && q.status === 'sent' && ['pending', 'approved', 'rejected'].includes(q.approval);

export const businessOf = (q) => String(q?.business || q?.model?.client?.company || q?.client_name || q?.model?.client?.name || '').trim();
export const packageOf = (q) => [q?.model?.package?.tierName, q?.model?.package?.influencer].filter(Boolean).join(' · ');
export const deviationsOf = (q) => (Array.isArray(q?.exceptions) ? q.exceptions : []).map((e) => e?.text).filter(Boolean);
export const reviseUrl = (q) => `index.html?revise=${encodeURIComponent(q.id)}`;

// The card of one viewer: what waits for their decision, and the contracts they follow
// (everything else in approval; for an approver, not the ones already in the first list).
export function approvalLists(quotes = [], viewer = null, email = '') {
  const live = quotes.filter(inApproval);
  const pending = live.filter((q) => q.approval === 'pending').sort((a, b) => new Date(a.submitted_at || a.created_at) - new Date(b.submitted_at || b.created_at));
  const toDecide = canApprove(viewer) ? pending : [];
  const rank = { rejected: 0, approved: 1, pending: 2 };
  const follow = live.filter((q) => !toDecide.includes(q))
    .sort((a, b) => (rank[a.approval] - rank[b.approval]) || (new Date(b.submitted_at || b.created_at) - new Date(a.submitted_at || a.created_at)));
  return { toDecide, follow, mine: (q) => same(preparedBy(q), email) };
}

// The reminders' moments for a contract that waits (office time only).
export const approvalNudgeAt = (q) => { const at = parseDate(q?.submitted_at || q?.created_at); return at ? addWorkingMinutes(at, APPROVAL_NUDGE_MINUTES) : null; };

// The message to the client once the contract may go out.
export function shareText(q, link, hours = null) {
  const m = q?.model || {};
  const name = String(m.client?.name || q?.client_name || '').trim();
  const signable = m.signable !== false;
  const term = m.termMonths === 1 ? 'לחודש אחד' : `ל־${m.termMonths || 12} חודשים`;
  const h = hours ?? m.validHours;
  return signable
    ? `שלום ${name}, מצורף הסכם ההתקשרות מאסטרטג (${q.number}) ${term}. אפשר לעיין ולחתום כאן${h ? ` בתוך ${h} שעות` : ''}:\n${link}`
    : `שלום ${name}, מצורפת הצעת המחיר מאסטרטג (${q.number})${h ? `, בתוקף ל־${h} שעות` : ''}. לצפייה:\n${link}`;
}
