// Every regular document the builder can make, as one fingerprint: each package ×
// each eligible combination of paid add-ons × both document types × a few free
// add-ons and discounts, the model serialised exactly as the server stores it.
// tests/custom-contract.test.mjs compares it to the fingerprint taken before custom
// contracts existed (6.10.2026): a regular selection must keep producing the very
// same bytes. Run `node tests/regular-models.mjs` to print the fingerprint.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TIERS, INFLUENCERS, PAID_ADDONS } from '../app/catalog.js';
import { emptySelection, paidAddonAvailable, buildQuoteModel, reconcile, computeTotals } from '../app/pricing.js';

const CLIENT = { name: 'דנה לוי', company: 'קפה דנה בע״מ', phone: '050-1234567', email: 'dana@example.co.il', companyId: '514729938', notes: 'הערה' };
const FREE = [
  {},
  { graphics: 24, simeonStories: 3, simeonJoin: true, extraCh14: true },
  { graphics: 5, extraCh14: true },
];
const DISCOUNTS = [0, 10000, 20000];

export function regularSelections() {
  const out = [];
  for (const docType of ['quote', 'agreement']) {
    for (const tier of TIERS) {
      for (const inf of Object.keys(INFLUENCERS)) {
        const probe = { ...emptySelection(), docType, tier: tier.id, influencer: inf };
        const avail = PAID_ADDONS.filter((a) => paidAddonAvailable(a, probe));
        for (let mask = 0; mask < 1 << avail.length; mask += 1) {
          const paid = avail.filter((_, i) => mask & (1 << i)).map((a) => a.id);
          for (const free of FREE) {
            for (const discount of DISCOUNTS) {
              out.push(reconcile({ ...probe, paid, free: { ...probe.free, ...free }, discount }).selection);
            }
          }
        }
      }
    }
  }
  return out;
}

export function regularFingerprint() {
  const hash = createHash('sha256');
  const list = regularSelections();
  for (const sel of list) {
    hash.update(JSON.stringify(buildQuoteModel(sel, CLIENT)));
    hash.update(JSON.stringify(computeTotals(sel)));
  }
  return { count: list.length, sha256: hash.digest('hex') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(regularFingerprint()));
