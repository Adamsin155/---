// Finding a client by what is typed (the nudnik's search, app/staff-tasks-ui.js, 25–26.10.2026):
// by the business, the way the office names a client, then the contact; every word typed, in
// any order, split on spaces. Used by "אפיון חדש" (intake.html with no client, 27.10.2026).
// No DOM here, so node tests it.

// "העסק · איש הקשר", or only the name when there is no other business name.
export const clientLabel = (c) => (c?.business && c.business !== c.name ? `${c.business} · ${c.name}` : String(c?.name || ''));

export const searchWords = (q) => String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

// The clients whose label holds every word typed, sorted by the label (Hebrew order).
export function searchClients(list, q) {
  const words = searchWords(q);
  return (list || [])
    .map((c) => ({ ...c, label: clientLabel(c) }))
    .filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}
