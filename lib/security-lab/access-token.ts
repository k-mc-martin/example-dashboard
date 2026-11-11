import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fail } from './store.ts';
function mac(input: string, context: string) {
  const root = process.env.SECDASH_SESSION_SECRET;
  if (!root || root.length < 32) throw Error('Signing key unavailable');
  const key = createHmac('sha256', root)
    .update('secdash:' + context)
    .digest();
  return createHmac('sha256', key).update(input).digest();
}
const encode = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
export function issueAccess(
  origin: string,
  actor: string,
  scope: string,
  seconds: number,
  upstream = false,
) {
  const now = Math.floor(Date.now() / 1000),
    ctx = upstream ? 'provider' : 'connector';
  const head = encode({ alg: 'HS256', typ: 'at+jwt' });
  const body = encode({
    iss: origin + '/' + ctx,
    aud: origin + (upstream ? '/provider' : '/api/demo/mcp'),
    sub: actor,
    scope,
    iat: now,
    nbf: now,
    exp: now + seconds,
    jti: randomBytes(24).toString('hex'),
  });
  return (
    head + '.' + body + '.' + mac(head + '.' + body, ctx).toString('base64url')
  );
}
export function verifyAccess(value: string, origin: string) {
  const bad = () =>
    fail(401, 'Invalid token signature, audience or validity period.');
  if (value.length > 2048 || !/^[-\w]+\.[-\w]+\.[-\w]+$/.test(value))
    return bad();
  const [h, b, s] = value.split('.');
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (
      header.alg !== 'HS256' ||
      header.typ !== 'at+jwt' ||
      Object.keys(header).length !== 2
    )
      return bad();
    const expected = mac(h + '.' + b, 'connector').toString('base64url');
    if (
      s.length !== expected.length ||
      !timingSafeEqual(Buffer.from(s), Buffer.from(expected))
    )
      return bad();
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')),
      now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== origin + '/connector' ||
      claims.aud !== origin + '/api/demo/mcp' ||
      !Number.isSafeInteger(claims.nbf) ||
      !Number.isSafeInteger(claims.exp) ||
      now < claims.nbf ||
      now >= claims.exp
    )
      return bad();
    return claims;
  } catch {
    return bad();
  }
}
