import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {normalizeUsername, usernamePattern, validNewStaffPassword} from './staff-password.mjs';

const codePattern = /^([A-Za-z0-9_-]{43})\.(\d{13})$/;
const idPattern = /^[a-f0-9]{32}$/;
const keyPattern = /^[a-f0-9]{64}$/;
const codeLifetime = 30 * 60 * 1000;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const answer = (value, status = 200) => Response.json(value, {status, headers});
const redirect = path => new Response(null, {status:303, headers:{...headers, Location:path}});
const blocked = () => answer({error:'Setup is not done. Ask your site owner to check the build in Cloudflare. Then open your site again.'}, 503);
const isWorkerOrigin = url => url.protocol === 'https:' && /^([a-z0-9-]+\.){2}workers\.dev$/.test(url.hostname) && !url.port;

function validCode(configured, submitted, now) {
  if (typeof configured !== 'string' || typeof submitted !== 'string' || submitted.length !== 57) return false;
  const fields = codePattern.exec(configured);
  if (!fields || Number(fields[2]) <= now || Number(fields[2]) > now + codeLifetime) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(configured), digest(submitted));
}

function matchesInstallKey(configured, submitted) {
  if (typeof configured !== 'string' || !/^[!-~]{24,128}$/.test(configured) ||
      typeof submitted !== 'string' || submitted.length !== configured.length) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(configured), digest(submitted));
}

async function readSetup(request, url) {
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Content-Type') !== 'application/json') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      length += value.length;
      if (length > 2048) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
}

async function enroll(request, env, url, derivePassword, db) {
  const input = await readSetup(request, url);
  if (!input) return answer({error:'Open the setup form on this website.'}, 400);
  const deployKey = matchesInstallKey(env.LT360_INSTALL_KEY, input.code);
  const deadline = deployKey
    ? (await db.prepare('SELECT expires FROM official_setup_window WHERE id=1').first())?.expires
    : Number(codePattern.exec(env.LT360_SETUP_CODE || '')?.[2]);
  if (!(deadline > Date.now()) || (!deployKey && !validCode(env.LT360_SETUP_CODE, input.code, Date.now())))
    return answer({error:'Check the key you saved in Cloudflare. If you lost it or it ran out, open “I lost my key or setup expired”.'}, 403);
  const username = normalizeUsername(input.username);
  if (!usernamePattern.test(username) || !validNewStaffPassword(input.password))
    return answer({error:'Start your sign-in name with a letter or number. Use 3 to 64 letters, numbers, dots, dashes, or underscores. Use at least 15 characters for your password. Try a shorter password if yours is too long.'},400);
  const installation = randomBytes(16).toString('hex');
  const {verifier} = await derivePassword(input.password);
  // D1 batch means either the installation and Administrator are both committed,
  // or neither is. The unique claim ID prevents a losing request creating a user.
  await env.PHOTOS.get('__lt360_binding_health__');
  const committedAt = Date.now();
  if (deadline <= committedAt)
    return answer({error:'The setup code ran out. Ask your Cloudflare owner to save a new code.'}, 403);
  const results = await db.batch([
    db.prepare(`INSERT INTO official_installation(id,installation_id,origin,guest_key,created)
      SELECT 1,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM official_installation)
      AND NOT EXISTS (SELECT 1 FROM staff_accounts) AND NOT EXISTS (SELECT 1 FROM official_restore)
      AND unixepoch('subsec')*1000 < ?`)
      .bind(installation, url.origin, randomBytes(32).toString('hex'), committedAt, deadline),
    db.prepare(`INSERT INTO staff_accounts(username,password_verifier,role)
      SELECT ?,?,'administrator' WHERE EXISTS (SELECT 1 FROM official_installation WHERE id=1 AND installation_id=?)`)
      .bind(username, verifier, installation)
  ]);
  if (results[1]?.meta?.changes !== 1) return answer({error:'Setup changed. Open your site again.'},409);
  return answer({ok:true});
}

async function asset(env, request, pathname) {
  const result = await env.ASSETS.fetch(new Request(new URL('/official/'+pathname, request.url)));
  const output = new Headers(result.headers);
  for (const [name,value] of Object.entries(headers)) output.set(name,value);
  return new Response(result.body, {status:result.status, headers:output});
}

export async function officialRequest(request, env, serve, derivePassword, privateActor = false) {
  const url = new URL(request.url);
  if (!isWorkerOrigin(url)) return answer({error:'Open the agency’s workers.dev website.'},403);
  const {method} = request;
  const {pathname} = url;
  try {
    if (!privateActor && method === 'GET' && ['setup.js','setup.css'].some(file=>pathname==='/official/'+file))
      return asset(env, request, pathname.slice('/official/'.length));
    const db = env.DB.withSession('first-primary');
    const state = await db.prepare(`SELECT i.*, EXISTS(SELECT 1 FROM official_restore) restoring
      FROM (SELECT 1 as anchor) LEFT JOIN official_installation i ON i.id=anchor`).first();
    if (state.restoring) return answer({error:'Your team is backing up or fixing this site. Try again when the work is done.'},503);
    if (state.installation_id) {
      if (state.origin !== url.origin || !idPattern.test(state.installation_id) || !keyPattern.test(state.guest_key))
        return answer({error:'The site address or settings changed. Ask your Cloudflare owner to check.'},403);
      if (!privateActor && method === 'GET' && (pathname === '/setup' || pathname === '/')) return redirect('/staff');
      if (pathname === '/api/official/enroll') return answer({error:'Setup is done. Sign in with your account.'},409);
      return serve(request, {...env, INSTALLATION_MODE:'agency', INSTALLATION_ID:state.installation_id, APP_ORIGIN:state.origin, GUEST_CODE_KEY:state.guest_key});
    }
    if (privateActor) return blocked();
    if (method === 'GET' && pathname === '/') return redirect('/setup');
    if (method === 'GET' && pathname === '/setup') return asset(env, request, 'setup.html');
    if (method === 'POST' && pathname === '/api/official/enroll') {
      const schema = await db.prepare('SELECT count(*) n,min(version) minimum,max(version) maximum FROM app_migrations').first();
      if (!env.PHOTOS || !env.STAFF_LOGIN || schema?.minimum !== 1 || schema.n !== Number(env.SCHEMA_REQUIRED) || schema.maximum !== schema.n) return blocked();
      return await enroll(request,env,url,derivePassword,db);
    }
    return blocked();
  } catch {
    return blocked();
  }
}
