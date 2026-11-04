const keysUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const signingKeys = new Map();
let keysExpire = 0;
export const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const normalizeUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const firebaseUidPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,189}$/;

export async function firebaseRequest(apiKey, action, data) {
  return fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + action + '?key=' + encodeURIComponent(apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(8000), redirect: 'error'
  });
}

export async function verifyFirebaseToken(token, project, now) {
  if (typeof token !== 'string' || token.length > 3500 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  const [head, body, signature] = token.split('.');
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url'));
    claims = JSON.parse(Buffer.from(body, 'base64url'));
  } catch { return null; }
  const seconds = Math.floor(now / 1000);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' ||
      claims?.aud !== project || claims.iss !== 'https://securetoken.google.com/' + project ||
      typeof claims.sub !== 'string' || !firebaseUidPattern.test(claims.sub) ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= seconds || claims.exp > seconds + 3660 ||
      !Number.isSafeInteger(claims.iat) || claims.iat > seconds + 60 ||
      !Number.isSafeInteger(claims.auth_time) || claims.auth_time > seconds + 60 ||
      claims.firebase?.sign_in_provider !== 'password') return null;
  if (now >= keysExpire) {
    const response = await fetch(keysUrl, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('Firebase signing keys unavailable.');
    const { keys } = await response.json();
    signingKeys.clear();
    for (const key of keys) if (key.kty === 'RSA') signingKeys.set(key.kid, key);
    const ttl = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1] ?? 60);
    keysExpire = now + Math.min(ttl, 3600) * 1000;
  }
  const jwk = signingKeys.get(header.kid);
  if (!jwk) return null;
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  return await crypto.subtle.verify(algorithm, key, Buffer.from(signature, 'base64url'), Buffer.from(head + '.' + body))
    ? claims : null;
}
