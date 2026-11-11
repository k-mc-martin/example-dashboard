import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import hashes from './common-passwords.json' with { type: 'json' };
import { fail, hash, labDb, token } from './store.ts';
const deny = new Set(hashes);
const salt = () => randomBytes(16).toString('hex');
export const staffCookie = '__Host-secdash_staff';
function allowed(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    [...p].length >= 8 &&
    [...p].length <= 128 &&
    !deny.has(hash(p))
  );
}
export function staff(
  w: string,
  op: string,
  b: Record<string, unknown>,
  cookie: string,
  binding: string,
) {
  const d = labDb(),
    now = Date.now(),
    row = d.prepare('SELECT * FROM staff WHERE w=?').get(w);
  if (op === 'enroll') {
    if (row?.pw) fail(409, 'Already enrolled. Use the staff sign-in form.');
    const code = token();
    d.prepare(
      'INSERT OR REPLACE INTO staff(w,activation,expires) VALUES(?,?,?)',
    ).run(w, hash(code), now + 300000);
    return { activation: code };
  }
  if (!row) fail(401, 'Enroll a fictional staff account first.');
  const sessionOK =
    !!cookie &&
    hash(binding + ':' + cookie) === row.session &&
    Number(row.expires) > now;
  if (op === 'record') {
    if (!sessionOK) fail(401, 'Staff sign-in required.');
    return { record: 'Staff-only dispatch sheet · East warehouse' };
  }
  if (op === 'logout') {
    if (!sessionOK) fail(401, 'No active staff login.');
    d.prepare('UPDATE staff SET session=NULL WHERE w=?').run(w);
    return { cleared: true };
  }
  if (Number(row.failures) >= 5 && now - Number(row.window) < 60000)
    fail(429, 'Five failed attempts. Retry after one minute.');
  function bad(): never {
    const fresh = now - Number(row!.window) >= 60000;
    d.prepare('UPDATE staff SET failures=?,window=? WHERE w=?').run(
      fresh ? 1 : Number(row!.failures) + 1,
      fresh ? now : row!.window,
      w,
    );
    return fail(401, 'Invalid staff credentials.');
  }
  if (op === 'activate') {
    if (
      typeof b.code !== 'string' ||
      !row.activation ||
      hash(b.code) !== row.activation ||
      Number(row.expires) <= now
    )
      bad();
  } else if (op === 'login' || op === 'change') {
    if (op === 'change' && !sessionOK)
      fail(401, 'Sign in before changing the password.');
    if (
      !row.pw ||
      !row.salt ||
      typeof b.password !== 'string' ||
      b.password.length > 512 ||
      !timingSafeEqual(
        scryptSync(b.password, String(row.salt), 32),
        Buffer.from(String(row.pw), 'hex'),
      )
    )
      bad();
  } else fail(400, 'Unknown staff action.');
  if (op === 'activate' || op === 'change') {
    if (!allowed(b.next))
      fail(
        400,
        'Choose 8–128 characters. Common passwords are refused. A longer passphrase is recommended.',
      );
    const s = salt();
    d.prepare(
      'UPDATE staff SET activation=NULL,pw=?,salt=?,session=NULL,failures=0 WHERE w=?',
    ).run(scryptSync(b.next, s, 32).toString('hex'), s, w);
    return {
      cleared: true,
      message: 'Password saved. Sign in with the new password.',
    };
  }
  const sid = token();
  d.prepare('UPDATE staff SET session=?,expires=?,failures=0 WHERE w=?').run(
    hash(binding + ':' + sid),
    now + 900000,
    w,
  );
  return { sid };
}
