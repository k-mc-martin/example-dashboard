import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { issueAccess, verifyAccess } from '../lib/security-lab/access-token.ts';
test('Access token checks enforce algorithm, trusted key, issuer, audience, signature and both time boundaries', () => {
  process.env.SECDASH_SESSION_SECRET = randomBytes(40).toString('hex');
  const origin = 'https://work.example',
    t = issueAccess(origin, 'inez', 'mail.read', 120);
  const [h, b, s] = t.split('.');
  assert.equal(verifyAccess(t, origin).sub, 'inez');
  const pack = (x) => Buffer.from(JSON.stringify(x)).toString('base64url'),
    original = JSON.parse(Buffer.from(b, 'base64url'));
  const key = createHmac('sha256', process.env.SECDASH_SESSION_SECRET)
    .update('secdash:connector')
    .digest();
  function sign(header, claims) {
    const payload = pack(header) + '.' + pack(claims);
    return (
      payload +
      '.' +
      createHmac('sha256', key).update(payload).digest('base64url')
    );
  }
  for (const header of [
    { alg: 'none', typ: 'at+jwt' },
    { alg: 'HS384', typ: 'at+jwt' },
    { alg: 'HS256', typ: 'at+jwt', jku: 'https://keys.invalid' },
  ])
    assert.throws(() => verifyAccess(sign(header, original), origin));
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  for (const change of [
    { nbf: original.iat + 60 },
    { exp: original.iat },
    { aud: 'other' },
    { iss: 'upstream' },
  ])
    assert.throws(() =>
      verifyAccess(sign(header, { ...original, ...change }), origin),
    );
  assert.throws(() =>
    verifyAccess(
      h + '.' + b + '.' + (s[0] === 'a' ? 'b' : 'a') + s.slice(1),
      origin,
    ),
  );
  assert.throws(() =>
    verifyAccess(
      issueAccess(origin, 'inez', 'provider.read', 30, true),
      origin,
    ),
  );
});
