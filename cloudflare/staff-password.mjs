import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const normalizeUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

// OWASP's scrypt profile with 32 MiB of workspace. Version 1 always uses these costs.
const parameters = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const verifierPattern = /^scrypt-v1\$([A-Za-z0-9_-]{21}[AQgw])\$([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;
const encoder = new TextEncoder();
const dummySalt = Buffer.alloc(16);
const dummyPassword = Buffer.alloc(16);
const dummyDigest = Buffer.alloc(32);

function encodePassword(value) {
  if (typeof value !== 'string' || value.length > 256 || !value.isWellFormed() ||
      Array.from(value).length < 15) return null;
  const bytes = encoder.encode(value);
  if (bytes.length <= 256) return bytes;
  bytes.fill(0);
  return null;
}

export function validNewStaffPassword(value) {
  const bytes = encodePassword(value);
  bytes?.fill(0);
  return bytes !== null;
}

export function hashStaffPassword(password) {
  const bytes = encodePassword(password);
  if (!bytes) throw new Error('Use at least 15 characters and no more than 256 UTF-8 bytes.');
  const salt = randomBytes(16);
  try {
    const digest = scryptSync(bytes, salt, 32, parameters);
    return 'scrypt-v1$' + salt.toString('base64url') + '$' + digest.toString('base64url');
  } finally {
    bytes.fill(0);
  }
}

export function verifyStaffPassword(password, verifier) {
  const bytes = encodePassword(password);
  const record = typeof verifier === 'string' && verifier.length === 76
    ? verifierPattern.exec(verifier) : null;
  const salt = record ? Buffer.from(record[1], 'base64url') : dummySalt;
  const expected = record ? Buffer.from(record[2], 'base64url') : dummyDigest;
  try {
    // Missing and malformed records still cost one derivation after the login rate limit.
    const digest = scryptSync(bytes ?? dummyPassword, salt, 32, parameters);
    return timingSafeEqual(digest, expected) && bytes !== null && record !== null;
  } finally {
    bytes?.fill(0);
  }
}
