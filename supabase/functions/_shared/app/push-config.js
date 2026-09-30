// generated — edit app/ instead. Source: app/push-config.js. Regenerate: node scripts/sync-functions.mjs
// Web Push: the office's VAPID public key (RFC 8292). It is public by design:
// the browser subscribes with it, and push services check that every message
// was signed by its private half. The private key and the contact address live
// only in the database's Vault ('vapid_private_key', 'vapid_subject'), never in
// the repository; the reminders function reads them there (docs/ops.md,
// "מנוע התזכורות"). Replacing the pair means everyone connects their devices again.
export const VAPID_PUBLIC_KEY = 'BInmFsIjG1SWDq0DaEaHHTUt1edu2YZmNapUt1MfBxSJNuD7RkVWU3f3vZIGPCXSSDPbe2qqEtlvpV2ht5zKgBI';
