// Web Push for the reminders function: message encryption (RFC 8291, "aes128gcm",
// RFC 8188) and the VAPID signature (RFC 8292), with the platform's WebCrypto
// only, so the same file runs in Deno (the function) and in node (the tests), and
// nothing is fetched from a package registry when the function starts.
//
// Checked in tests/webpush.test.mjs against the worked example of RFC 8291,
// Appendix A (the exact bytes), and against the reference implementations
// (http_ece by the RFC's author, web-push, and jsr:@negrel/webpush) when it was
// written. A fresh key pair and salt are made for every message, as the RFC asks.
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export function b64uEncode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// A P-256 key from its raw private part and the uncompressed public point.
function jwkOf(d, pub) {
  const p = pub instanceof Uint8Array ? pub : b64uDecode(pub);
  if (p.length !== 65 || p[0] !== 4) throw new Error('bad P-256 public key');
  return { kty: 'EC', crv: 'P-256', x: b64uEncode(p.slice(1, 33)), y: b64uEncode(p.slice(33, 65)), ...(d ? { d } : {}), ext: true };
}

// The push services browsers use (Chrome and Android, Firefox, Edge, Safari and
// iPhone). A subscription elsewhere is refused, so the function never posts to an
// arbitrary server. The same list is a check on push_subscriptions.endpoint.
export const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;

export const RECORD_SIZE = 4096;
// The largest plaintext that fits one record (the 0x02 delimiter and the 16-byte tag).
export const MAX_PAYLOAD = RECORD_SIZE - 17 - 86;

// Encrypts `plaintext` for one subscription: its `p256dh` (the browser's public
// key) and `auth` secret. `asKeys` and `salt` are for the RFC's worked example only.
export async function encryptPayload(plaintext, { p256dh, auth }, { asKeys = null, salt = null } = {}) {
  const body = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  if (body.length > MAX_PAYLOAD) throw new Error('payload too large');
  const uaPublic = b64uDecode(p256dh);
  const authSecret = b64uDecode(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const pair = asKeys
    ? { privateKey: await subtle().importKey('jwk', jwkOf(asKeys.privateKey, asKeys.publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']), publicRaw: b64uDecode(asKeys.publicKey) }
    : await (async () => {
      const k = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      return { privateKey: k.privateKey, publicRaw: new Uint8Array(await subtle().exportKey('raw', k.publicKey)) };
    })();
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  // RFC 8291 §3.4: IKM from the shared secret and the auth secret, then RFC 8188 key and nonce.
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, pair.publicRaw), 32);
  const saltBytes = salt ? b64uDecode(salt) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(saltBytes, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(saltBytes, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the plaintext and the last-record delimiter, no padding.
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(body, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(saltBytes, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = pair.publicRaw.length;
  return concat(header, pair.publicRaw, cipher);
}

// The VAPID Authorization header for one push service (RFC 8292): a JWT signed
// with ES256 for the endpoint's origin, valid for 12 hours, and the public key.
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  if (!/^(mailto:|https:\/\/)/.test(String(subject || ''))) throw new Error('VAPID subject must be mailto: or https:');
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle().importKey('jwk', jwkOf(privateKey, publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto's ECDSA signature is r||s (64 bytes), which is what JWS ES256 wants.
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64uEncode(sig)}, k=${publicKey}`;
}

// Sends one message. Resolves { ok, status, gone }: `gone` when the push service
// says the subscription no longer exists (404 or 410), so it is removed. Never
// throws on a push-service answer; a network failure or timeout is { ok: false, status: 0 }.
export async function sendWebPush(subscription, payload, vapid, { ttl = 4 * 3600, urgency = 'high', timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  if (!PUSH_ENDPOINT.test(String(subscription.endpoint))) return { ok: false, status: 0, gone: true, error: 'not a push service' };
  let body;
  let authorization;
  try {
    body = await encryptPayload(payload, subscription);
    authorization = await vapidAuthorization(subscription.endpoint, vapid);
  } catch (e) {
    return { ok: false, status: 0, gone: /bad subscription keys|bad P-256/.test(String(e?.message)), error: String(e?.message || e) };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(Math.round(ttl)), Urgency: urgency, Authorization: authorization,
      },
      body,
      signal: ctrl.signal,
    });
    await res.arrayBuffer().catch(() => null); // release the connection
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
