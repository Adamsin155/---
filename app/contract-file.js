// The client's signed contract as a file (the owner's request of 27.10.2026): a contract
// signed on paper, or anywhere outside the system, goes into the client's files ("תיק לקוח",
// public.client_files) as a file of the kind 'material_other' with the label "חוזה חתום",
// from the "לקוח חדש" form or from the card's "החוזה והחבילה". The table's kinds are fixed
// (its check); this label is what marks the contract among the client's other files.
// Who may: whoever manages the client's files (the owner, Irit, Lior and Ofir;
// public.can_upload_client_file). No DOM here, so node tests it.
export const CONTRACT_KIND = 'material_other';
export const CONTRACT_LABEL = 'חוזה חתום';
export const CONTRACT_ACCEPT = 'application/pdf,image/*,.pdf,.heic,.heif';
export const CONTRACT_MAX = 25 * 1024 * 1024;

export const isContractFile = (f) => !!f && f.kind === CONTRACT_KIND && String(f.label || '').trim() === CONTRACT_LABEL && !f.deleted_at;
export const contractFiles = (files) => (files || []).filter(isContractFile)
  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

// Why this file cannot be the contract (in Hebrew), or null: a PDF or a picture, up to 25MB.
export function contractFileProblem(file) {
  if (!file) return 'לא נבחר קובץ.';
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  const ok = type === 'application/pdf' || type.startsWith('image/') || /\.(pdf|jpe?g|png|heic|heif|webp)$/.test(name);
  if (!ok) return 'החוזה: קובץ PDF או תמונה בלבד.';
  if (!(file.size > 0)) return 'הקובץ ריק.';
  if (file.size > CONTRACT_MAX) return 'הקובץ גדול מ־25MB. אפשר לסרוק שוב באיכות נמוכה יותר.';
  return null;
}
