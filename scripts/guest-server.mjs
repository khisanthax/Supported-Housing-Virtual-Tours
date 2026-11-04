import http from 'node:http';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpackTour, MAX_TOTAL } from '../dist/tour-package.js';

const dist = new URL('../dist/', import.meta.url);
const pages = new URL('../sharing/', import.meta.url);
const derive = promisify(scrypt);
const hash = text => createHash('sha256').update(text).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const id = () => randomBytes(16).toString('hex');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[a-f0-9]{32}$/;
const hour = 3_600_000;
const assets = {
  'styles.css': 'text/css', 'editor.css': 'text/css', 'app.js': 'text/javascript',
  'tour-data.js': 'text/javascript', 'vendor/marzipano.js': 'text/javascript',
  'tour-editor.js': 'text/javascript', 'tour-package.js': 'text/javascript', 'tour-store.js': 'text/javascript',
  'data/apartment.json': 'application/json', 'images/living.jpg': 'image/jpeg',
  'images/kitchen.jpg': 'image/jpeg', 'images/bedroom.jpg': 'image/jpeg'
};
const commonAssets = new Set(['styles.css', 'app.js', 'tour-data.js', 'vendor/marzipano.js']);
const fail = (status, message) => Object.assign(new Error(message), { status });
function validPass(value, min) {
  return typeof value === 'string' && value.length >= min && Buffer.byteLength(value) <= 256;
}
async function key(passphrase, salt) {
  return derive(passphrase, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
}
function cook(req, name) {
  const value = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
  return tokenPattern.test(value ?? '') ? hash(value) : null;
}
function respond(res, status, content, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(content) : content);
}
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw fail(413, 'File or request is too large.'); }
  const chunks = []; let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) { req.resume(); throw fail(413, 'File or request is too large.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function json(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Send JSON.');
  try {
    const value = JSON.parse(await body(req, 8192));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (e) { throw e.status ? e : fail(400, 'Invalid JSON.'); }
}

export async function createSharingServer({ database, origin, staffPassphrase, tls, synthetic = false, now = Date.now, offlineHours = 24 }) {
  if (!Number.isInteger(offlineHours) || offlineHours < 1 || offlineHours > 168) throw new Error('Offline access must be between 1 and 168 hours.');
  const configured = new URL(origin);
  if (configured.origin !== origin || (tls ? configured.protocol !== 'https:' : configured.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(configured.hostname))) throw new Error('Set the exact server origin. HTTP is only allowed for loopback.');
  if (!validPass(staffPassphrase, 16)) throw new Error('Set TOUR_STAFF_PASSPHRASE to 16–256 characters.');
  const staffSalt = randomBytes(16);
  const staffKey = await key(staffPassphrase, staffSalt);
  const dummySalt = randomBytes(16);
  const db = new DatabaseSync(database);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS apartments(id TEXT PRIMARY KEY, title TEXT NOT NULL, manifest TEXT NOT NULL, start_room TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photos(apartment_id TEXT REFERENCES apartments(id), room TEXT, jpeg BLOB NOT NULL, PRIMARY KEY(apartment_id,room));
    CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, salt BLOB NOT NULL, pass_hash BLOB NOT NULL, expires INTEGER NOT NULL, revoked INTEGER, revision INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS permissions(share_id TEXT REFERENCES shares(id), apartment_id TEXT REFERENCES apartments(id), PRIMARY KEY(share_id,apartment_id));
    CREATE TABLE IF NOT EXISTS guest_sessions(token_hash TEXT PRIMARY KEY, share_id TEXT REFERENCES shares(id), revision INTEGER NOT NULL, expires INTEGER NOT NULL);
  `);
  const sql = (query, ...args) => db.prepare(query).get(...args);
  const rows = (query, ...args) => db.prepare(query).all(...args);
  const run = (query, ...args) => db.prepare(query).run(...args);
  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = callback(); db.exec('COMMIT'); return value; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function insertApartment(tour, photos, replacement) {
    const apartment = replacement || id();
    const manifest = JSON.stringify({...tour, offlineRevision:id()});
    transaction(() => {
      if (replacement) {
        if (!sql('SELECT id FROM apartments WHERE id=?',apartment)) throw fail(404,'Apartment not found.');
        run('UPDATE apartments SET title=?, manifest=?, start_room=? WHERE id=?',tour.title,manifest,tour.startRoom,apartment);
        run('DELETE FROM photos WHERE apartment_id=?',apartment);
      } else run('INSERT INTO apartments VALUES(?,?,?,?)', apartment, tour.title, manifest, tour.startRoom);
      for (const [room, jpeg] of photos) run('INSERT INTO photos VALUES(?,?,?)', apartment, room, jpeg);
    });
    return apartment;
  }
  if (synthetic && !sql('SELECT id FROM apartments LIMIT 1')) {
    const sample = JSON.parse(await readFile(new URL('data/apartment.json', dist), 'utf8'));
    const photos = await Promise.all(sample.rooms.map(async room => [room.id, await readFile(new URL(room.image, dist))]));
    for (const title of ['Willow Sample Apartment', 'Maple Sample Apartment', 'Cedar Sample Apartment']) insertApartment({ ...sample, title }, photos);
  }
  const [staffPage, loginPage, guestPage, index] = await Promise.all([
    readFile(new URL('staff.html', pages), 'utf8'), readFile(new URL('staff-login.html', pages), 'utf8'), readFile(new URL('guest.html', pages), 'utf8'),
    readFile(new URL('index.html', dist), 'utf8')
  ]);
  const viewer = index
    .replace('<body>', '<body data-guest="true">')
    .replace(/(href|src)="(styles\.css|app\.js|vendor\/marzipano\.js)"/g, '$1="/viewer/$2"')
    .replaceAll('The Willow Apartment', 'Shared apartment')
    .replace('Explore a three-room sample apartment in an interactive 360 degree walkthrough.', 'Explore this shared apartment in a 360 degree walkthrough.')
    .replace('Sample apartment</span>', 'Shared tour</span>')
    .replace('Three-room prototype · No real apartment photography', '360° apartment walkthrough')
    .replace(/<section class="editor-bar"[\s\S]*?<\/section>/, '')
    .replace(/<section id="editor-panel"[\s\S]*?<\/section>/, '')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/g, '')
    .replace(/<details class="local-preview"[\s\S]*?<\/details>/, '')
    .replace(/<link rel="stylesheet" href="editor.css">/, '')
    .replace(/<button id="(?:place-on-pano|cancel-on-pano)"[\s\S]*?<\/button>/g, '')
    .replace('<main>', '<main><p class="guest-back"><a href="/guest">← Back to shared apartments</a></p>')
    .replace('href="./"', 'href="/guest"');
  const offlinePanel = await readFile(new URL('offline-panel.html', pages), 'utf8');
  const offlinePage = viewer
    .replace('data-guest="true"', 'data-offline="true" class="offline-locked"')
    .replaceAll('/viewer/', '/offline/')
    .replaceAll('/guest', '/offline/')
    .replace('← Back to shared apartments', '← Available Offline')
    .replace('<head>', '<head><link rel="manifest" href="/offline/app.webmanifest"><link rel="stylesheet" href="/offline/offline.css"><meta name="theme-color" content="#254e3e">')
    .replace('<main>', '<main>' + offlinePanel);
  const offlineFiles = new Map([
    ['app.webmanifest','application/manifest+json'], ['sw.js','text/javascript'],
    ['offline.js','text/javascript'], ['offline-store.js','text/javascript'],
    ['offline.css','text/css'], ['icon-192.png','image/png'], ['icon-512.png','image/png']
  ]);
  const staffSessions = new Map();
  const offlineCatalog = () => rows(`SELECT a.id,a.title,a.manifest,SUM(length(p.jpeg)) AS bytes
    FROM apartments a JOIN photos p ON p.apartment_id=a.id GROUP BY a.id ORDER BY a.title`)
    .map(({id,title,manifest,bytes}) => ({id,title,bytes,revision:hash(manifest)}));
  const attempts = new Map();
  let hashing = 0;
  async function attempt(ip, action) {
    const t = now();
    for (const [address, entry] of attempts) if (entry.until <= t) attempts.delete(address);
    const entry = attempts.get(ip) ?? { count: 0, until: t + 60_000 };
    if (entry.count >= 8 || hashing >= 2 || (!attempts.has(ip) && attempts.size >= 4096)) throw fail(429, 'Too many attempts. Try again in a minute.');
    entry.count++;
    attempts.set(ip, entry);
    hashing++;
    try { return await action(); } finally { hashing--; }
  }
  const setCookie = (res, name, value, age) => res.setHeader('Set-Cookie', `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${tls ? '; Secure' : ''}`);
  const guestSession = req => sql(`SELECT s.id FROM guest_sessions g JOIN shares s ON s.id=g.share_id
    WHERE g.token_hash=? AND g.revision=s.revision AND g.expires>? AND s.expires>? AND s.revoked IS NULL`, cook(req,'sh_guest'), now(), now());
  function requireGuest(req) {
    const session = guestSession(req);
    if (!session) throw fail(401, 'Guest access ended. Reopen the original link and enter its passphrase.');
    return session.id;
  }
  function requireStaff(req) {
    if ((staffSessions.get(cook(req,'sh_staff')) ?? 0) <= now()) throw fail(401, 'Staff sign-in required.');
  }
  const allowed = (share, apartment) => sql('SELECT 1 FROM permissions WHERE share_id=? AND apartment_id=?', share, apartment);
  function selected(value) {
    if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length ||
      value.some(a => typeof a !== 'string' || !uuidPattern.test(a) || !sql('SELECT id FROM apartments WHERE id=?', a))) throw fail(400, 'Select one or more available apartments.');
    return value;
  }
  function replacePermissions(share, apartments) {
    run('DELETE FROM permissions WHERE share_id=?', share);
    for (const a of apartments) run('INSERT INTO permissions VALUES(?,?)', share, a);
  }
  async function serveAsset(res, name) {
    if (!Object.hasOwn(assets,name)) throw fail(404, 'Not found.');
    respond(res, 200, await readFile(new URL(name,dist)), assets[name]);
  }
  async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
    if (tls) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const method = req.method;
      const url = new URL(req.url, origin);
      const route = url.pathname;
      if (req.headers.host !== configured.host) throw fail(400,'Unexpected host.');
      if (method !== 'GET' && req.headers.origin !== origin) throw fail(403, 'Request origin is not allowed.');
      const ip = req.socket.remoteAddress;
      if (method === 'GET' && route === '/') { res.writeHead(302,{ Location:'/guest' }); res.end(); return; }
      if (method === 'GET' && route === '/staff') return respond(res,200,(staffSessions.get(cook(req,'sh_staff')) ?? 0) > now() ? staffPage : loginPage,'text/html; charset=utf-8');
      if (method === 'GET' && route === '/guest') return respond(res,200,guestPage,'text/html; charset=utf-8');
      if (method === 'GET' && route === '/offline/') return respond(res,200,offlinePage,'text/html; charset=utf-8');
      if (method === 'GET' && route.startsWith('/offline/')) {
        const asset = route.slice(9);
        if (commonAssets.has(asset)) return await serveAsset(res,asset);
        if (offlineFiles.has(asset)) return respond(res,200,await readFile(new URL(asset,pages)),offlineFiles.get(asset));
        throw fail(404,'Not found.');
      }
      if (method === 'GET' && /^\/sharing\/(staff\.js|staff-login\.js|guest\.js|sharing\.css)$/.test(route)) {
        const filename = route.split('/').pop();
        if (filename === 'staff.js') {
          requireStaff(req);
        }
        return respond(res,200,await readFile(new URL(filename,pages)),filename.endsWith('.css') ? 'text/css' : 'text/javascript');
      }
      if (method === 'POST' && route === '/api/staff/sign-in') {
        const { passphrase } = await json(req);
        if (!validPass(passphrase,16)) throw fail(401,'Sign-in failed.');
        const candidate = await attempt(ip,() => key(passphrase,staffSalt));
        if (!timingSafeEqual(candidate,staffKey)) throw fail(401,'Sign-in failed.');
        for (const [k, expiry] of staffSessions) if (expiry <= now()) staffSessions.delete(k);
        staffSessions.delete(cook(req,'sh_staff'));
        const token = secret();
        staffSessions.set(hash(token),now()+8*hour);
        setCookie(res,'sh_staff',token,8*3600);
        return respond(res,200,{ ok:true });
      }
      if (method === 'POST' && route === '/api/guest/unlock') {
        const { token, passphrase } = await json(req);
        if (typeof token !== 'string' || !tokenPattern.test(token) || !validPass(passphrase,12)) throw fail(401,'Link or passphrase is invalid.');
        const share = sql('SELECT * FROM shares WHERE token_hash=? AND revoked IS NULL AND expires>?',hash(token),now());
        const candidate = await attempt(ip,() => key(passphrase,share?.salt ?? dummySalt));
        if (!share || !timingSafeEqual(candidate,share.pass_hash)) throw fail(401,'Link or passphrase is invalid.');
        const active = sql('SELECT * FROM shares WHERE id=? AND revision=? AND revoked IS NULL AND expires>?',share.id,share.revision,now());
        if (!active) throw fail(401,'Link or passphrase is invalid.');
        const session = secret();
        const expires = Math.min(active.expires,now()+8*hour);
        run('DELETE FROM guest_sessions WHERE expires<=? OR token_hash=?',now(),cook(req,'sh_guest'));
        run('INSERT INTO guest_sessions VALUES(?,?,?,?)',hash(session),active.id,active.revision,expires);
        setCookie(res,'sh_guest',session,Math.max(1,Math.ceil((expires-now())/1000)));
        return respond(res,200,{ ok:true });
      }
      if (route.startsWith('/api/staff/') || route.startsWith('/staff/editor/')) {
        requireStaff(req);
        if (method === 'GET' && route === '/api/staff/offline') {
          return respond(res,200,{ apartments:offlineCatalog(), now:now() });
        }
        const offlineRoute = /^\/api\/staff\/offline\/([a-f0-9]{32})\/(manifest|images\/([a-z0-9-]+))$/.exec(route);
        if (method === 'GET' && offlineRoute) {
          const [, apartment, , room] = offlineRoute;
          const record = sql('SELECT manifest FROM apartments WHERE id=?',apartment);
          if (!record) throw fail(404,'Apartment not found.');
          if (!room) return respond(res,200,{
            tour:JSON.parse(record.manifest), revision:hash(record.manifest),
            expires:now()+offlineHours*hour,
            images:rows('SELECT room,length(jpeg) AS bytes FROM photos WHERE apartment_id=?',apartment)
          });
          if (url.searchParams.get('revision') !== hash(record.manifest)) throw fail(409,'The apartment changed. Download the new version.');
          const photo = sql('SELECT jpeg FROM photos WHERE apartment_id=? AND room=?',apartment,room);
          if (!photo) throw fail(404,'Photo not found.');
          return respond(res,200,photo.jpeg,'image/jpeg');
        }
        if (method === 'GET' && route === '/staff/editor/') return respond(res,200,index,'text/html; charset=utf-8');
        if (method === 'GET' && route.startsWith('/staff/editor/')) return await serveAsset(res,route.slice(14));
        if (method === 'POST' && route === '/api/staff/sign-out') {
          staffSessions.delete(cook(req,'sh_staff')); setCookie(res,'sh_staff','',0);
          return respond(res,200,{ ok:true });
        }
        if (method === 'GET' && route === '/api/staff/dashboard') {
          const apartments = rows('SELECT id,title FROM apartments ORDER BY title');
          const shares = rows('SELECT id,expires,revoked,created FROM shares ORDER BY created DESC').map(s => ({
            ...s, status: s.revoked ? 'revoked' : s.expires <= now() ? 'expired' : 'active',
            apartments: rows('SELECT apartment_id AS id FROM permissions WHERE share_id=?',s.id).map(a=>a.id)
          }));
          return respond(res,200,{ apartments, shares });
        }
        if (method === 'POST' && route === '/api/staff/apartments') {
          const replacement = url.searchParams.get('replace');
          if (replacement && !uuidPattern.test(replacement)) throw fail(400,'Invalid apartment.');
          if (req.headers['content-type'] !== 'application/octet-stream') throw fail(415,'Choose a .shtour package.');
          let draft;
          try { draft = await unpackTour(new Blob([await body(req, MAX_TOTAL + 131084)])); }
          catch (e) { throw fail(e.status || 400, 'The apartment package is invalid or too large.'); }
          if (draft.tour.rooms.some(r=>r.links.some(l=>l.pending))) throw fail(400,'Position all return arrows before importing this apartment.');
          const photos = [];
          for (const [room, image] of draft.images) photos.push([room, new Uint8Array(await image.arrayBuffer())]);
          requireStaff(req);
          return respond(res,replacement ? 200 : 201,{ id: insertApartment(draft.tour,photos,replacement) });
        }
        if (method === 'POST' && route === '/api/staff/shares') {
          const input = await json(req);
          const apartments = selected(input.apartments);
          if (!validPass(input.passphrase,12)) throw fail(400,'Use a passphrase of at least 12 characters and at most 256 bytes.');
          if (!Number.isSafeInteger(input.expires) || input.expires <= now()) throw fail(400,'Set an expiration in the future.');
          const share = id(), token = secret(), salt = randomBytes(16);
          const digest = await attempt(ip,() => key(input.passphrase,salt));
          requireStaff(req);
          if (input.expires <= now()) throw fail(400,'Set an expiration in the future.');
          transaction(() => {
            run('INSERT INTO shares(id,token_hash,salt,pass_hash,expires,created) VALUES(?,?,?,?,?,?)',share,hash(token),salt,digest,input.expires,now());
            replacePermissions(share,apartments);
          });
          return respond(res,201,{ id:share, url: `${origin}/guest#${token}` });
        }
        const match = /^\/api\/staff\/shares\/([a-f0-9]{32})$/.exec(route);
        if (match && ['PATCH','DELETE'].includes(method)) {
          const share = match[1];
          const input = method === 'PATCH' ? await json(req) : null;
          requireStaff(req);
          if (!sql('SELECT id FROM shares WHERE id=? AND revoked IS NULL AND expires>?',share,now())) throw fail(404,'Active link not found.');
          const apartments = input && selected(input.apartments);
          transaction(() => {
            if (apartments) {
              replacePermissions(share,apartments);
              run('UPDATE shares SET revision=revision+1 WHERE id=?',share);
            } else run('UPDATE shares SET revoked=?, revision=revision+1 WHERE id=?',now(),share);
            run('DELETE FROM guest_sessions WHERE share_id=?',share);
          });
          return respond(res,200,{ ok:true });
        }
        throw fail(404,'Not found.');
      }
      if (method === 'GET' && route.startsWith('/viewer/')) {
        requireGuest(req);
        const asset = route.slice(8);
        if (!commonAssets.has(asset)) throw fail(404,'Not found.');
        return await serveAsset(res,asset);
      }
      if (method === 'GET' && route === '/api/guest/catalog') {
        const share = requireGuest(req);
        return respond(res,200,rows('SELECT a.id,a.title FROM apartments a JOIN permissions p ON p.apartment_id=a.id WHERE p.share_id=? ORDER BY a.title',share));
      }
      const guestRoute = /^\/(guest\/tour|api\/guest\/tours)\/([a-f0-9]{32})(?:\/(manifest|thumbnail|images\/([a-z0-9-]+)))?$/.exec(route);
      if (method === 'GET' && guestRoute) {
        const [, group, apartment, asset, room] = guestRoute;
        const share = requireGuest(req);
        if (!allowed(share,apartment)) throw fail(404,'Tour not found.');
        if (group === 'guest/tour' && !asset) return respond(res,200,viewer,'text/html; charset=utf-8');
        if (group === 'api/guest/tours' && asset === 'manifest') {
          const manifest = sql('SELECT manifest FROM apartments WHERE id=?',apartment);
          return respond(res,200,JSON.parse(manifest.manifest));
        }
        if (group === 'api/guest/tours' && (room || asset === 'thumbnail')) {
          const photo = sql('SELECT jpeg FROM photos WHERE apartment_id=? AND room=?',apartment,room ?? sql('SELECT start_room FROM apartments WHERE id=?',apartment).start_room);
          if (!photo) throw fail(404,'Photo not found.');
          return respond(res,200,photo.jpeg,'image/jpeg');
        }
      }
      throw fail(404,'Not found.');
    } catch (e) {
      if (res.destroyed || res.headersSent) return;
      respond(res,e.status || 500,{ error:e.status ? e.message : 'The server could not complete this request.' });
    }
  }
  const server = tls ? https.createServer(tls,handler) : http.createServer(handler);
  server.requestTimeout = 120_000;
  server.on('close',()=>db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tls = process.env.TOUR_TLS_CERT && process.env.TOUR_TLS_KEY
    ? { cert:await readFile(process.env.TOUR_TLS_CERT), key:await readFile(process.env.TOUR_TLS_KEY) } : null;
  const port = Number(process.env.TOUR_PORT || 4180);
  const host = process.env.TOUR_BIND || '127.0.0.1';
  if (!tls && host !== '127.0.0.1') throw new Error('HTTPS is required to bind outside loopback.');
  const origin = process.env.TOUR_ORIGIN || `${tls ? 'https' : 'http'}://localhost:${port}`;
  const database = path.resolve(process.env.TOUR_DATABASE || 'private-data/guest-sharing.sqlite');
  await mkdir(path.dirname(database), { recursive:true, mode:0o700 });
  const server = await createSharingServer({ database, origin, tls, staffPassphrase:process.env.TOUR_STAFF_PASSPHRASE, synthetic:process.argv.includes('--synthetic'), offlineHours:Number(process.env.TOUR_OFFLINE_HOURS || 24) });
  server.listen(port,host,() => console.log(`Guest sharing server: ${origin}/staff`));
}
