// Web Push of the reminders function (supabase/functions/reminders/webpush.js):
// the exact bytes of RFC 8291's worked example (Appendix A), a VAPID token that a
// push service accepts (RFC 8292: ES256, the endpoint's origin, 12 hours), and
// what a send reports for each answer of the push service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptPayload, vapidAuthorization, sendWebPush, b64uEncode, b64uDecode, MAX_PAYLOAD } from '../supabase/functions/reminders/webpush.js';
import { VAPID_PUBLIC_KEY } from '../app/push-config.js';

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// A browser's side (RFC 8291 §3.4 and RFC 8188), to read what was sent.
function decrypt(body, uaPrivate, uaPublic, auth) {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16);
  const rs = b.readUInt32BE(16);
  const idlen = b[20];
  const asPublic = b.subarray(21, 21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaPrivate, 'base64url'));
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(uaPublic, 'base64url'), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(auth, 'base64url'), info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = b.subarray(21 + idlen);
  assert.ok(cipher.length <= rs);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain.at(-1), 2, 'last-record delimiter');
  return plain.subarray(0, -1).toString('utf8');
}

function newBrowser() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url'), priv: ecdh.getPrivateKey('base64url') };
}
function newVapid() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
  return { publicKey: pub, privateKey: j.d, subject: 'mailto:ops@example.com' };
}

test('RFC 8291 Appendix A: the exact message body', async () => {
  const out = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { asKeys: { privateKey: RFC.asPrivate, publicKey: RFC.asPublic }, salt: RFC.salt });
  assert.equal(b64uEncode(out), RFC.body);
  assert.equal(decrypt(b64uDecode(RFC.body), RFC.uaPrivate, RFC.uaPublic, RFC.auth), RFC.plaintext);
});

test('every message has a fresh key and salt, and the browser reads it', async () => {
  const br = newBrowser();
  const payload = JSON.stringify({ title: 'הלקוח לא ענה: קפה', body: 'להתקשר ✓', url: 'client.html?id=1#p07' });
  const a = await encryptPayload(payload, br);
  const b = await encryptPayload(payload, br);
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16)); // salt
  assert.notDeepEqual(a.subarray(21, 86), b.subarray(21, 86)); // server key
  assert.equal(decrypt(a, br.priv, br.p256dh, br.auth), payload);
  await assert.rejects(encryptPayload('x'.repeat(MAX_PAYLOAD + 1), br), /too large/);
});

test('VAPID: an ES256 token for the push service\'s origin, which its public key verifies', async () => {
  const v = newVapid();
  const now = Date.UTC(2026, 9, 5, 7);
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', v, now);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, v.publicKey);
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:ops@example.com' });
  const pub = Buffer.from(k, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  await assert.rejects(vapidAuthorization('https://x.test/1', { ...v, subject: 'ops@example.com' }), /subject/);
});

test('the public key in the repository is a P-256 point (the private half is only in Vault)', () => {
  const k = b64uDecode(VAPID_PUBLIC_KEY);
  assert.equal(k.length, 65);
  assert.equal(k[0], 4);
  crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(k.subarray(1, 33)).toString('base64url'), y: Buffer.from(k.subarray(33)).toString('base64url') }, format: 'jwk' });
});

test('a send: 201 is ok; 404 and 410 mean the subscription is gone; other answers and timeouts are failures', async () => {
  const br = newBrowser();
  const sub = { endpoint: 'https://web.push.apple.com/abc', ...br };
  const v = newVapid();
  let seen = null;
  const fake = (status) => async (url, init) => { seen = { url, init }; return new Response(null, { status }); };
  assert.deepEqual(await sendWebPush(sub, '{"title":"x"}', v, { fetchImpl: fake(201), ttl: 60, urgency: 'high' }), { ok: true, status: 201, gone: false });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, '60');
  assert.equal(seen.init.headers.Urgency, 'high');
  assert.match(seen.init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  assert.equal(decrypt(seen.init.body, br.priv, br.p256dh, br.auth), '{"title":"x"}');
  assert.deepEqual(await sendWebPush(sub, 'x', v, { fetchImpl: fake(410) }), { ok: false, status: 410, gone: true });
  assert.deepEqual(await sendWebPush(sub, 'x', v, { fetchImpl: fake(404) }), { ok: false, status: 404, gone: true });
  assert.deepEqual(await sendWebPush(sub, 'x', v, { fetchImpl: fake(500) }), { ok: false, status: 500, gone: false });
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.deepEqual(await sendWebPush(sub, 'x', v, { fetchImpl: hang, timeoutMs: 20 }), { ok: false, status: 0, gone: false, error: 'timeout' });
  const broken = await sendWebPush({ ...sub, p256dh: 'AAAA' }, 'x', v, { fetchImpl: fake(201) });
  assert.equal(broken.ok, false);
  assert.equal(broken.gone, true);
  // Only the browsers' push services: never an arbitrary server.
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/1', 'https://evil.example/fcm', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x']) {
    seen = null;
    const r = await sendWebPush({ ...sub, endpoint }, 'x', v, { fetchImpl: fake(201) });
    assert.deepEqual([r.ok, r.gone, seen], [false, true, null], endpoint);
  }
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc', 'https://web.push.apple.com/abc']) {
    assert.equal((await sendWebPush({ ...sub, endpoint }, 'x', v, { fetchImpl: fake(201) })).ok, true, endpoint);
  }
});
