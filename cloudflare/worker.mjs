import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import words from './phrase-words.mjs';
import { inspectJpeg, MAX_ROOMS } from '../dist/tour-package.js';
import { validateApartment } from '../dist/tour-data.js';

const idPattern = /^[a-f0-9]{32}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const MAX_JPEG = 4 * 1024 * 1024;
const hour = 3600000;
const draftOnly = Number.MAX_SAFE_INTEGER;
const id = () => randomBytes(16).toString('hex');
const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
const codePattern = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const keyPattern = /^[a-f0-9]{64}$/;
export const guestCodeVerifier = (key, share, salt, code) =>
  'hmac-v1:'+createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify([share,salt,code])).digest('hex');
export const normalizePhrase = value => typeof value==='string' && value.length<=100
  ? value.trim().toLowerCase().replace(/[\s-]+/g,'-') : '';
export function generatePhrase(length=3) {
  if (![3,5,7].includes(length)) fail(400,'Choose a 3, 5, or 7 word phrase.');
  return Array.from({length},()=>words[randomInt(words.length)]).join('-');
}
const phraseVerifier = (key,share,salt,phrase) =>
  'phrase-v1:'+guestCodeVerifier(key,share,salt,phrase).slice('hmac-v1:'.length);
const validPass = (value,min) => typeof value==='string' && value.length>=min && new TextEncoder().encode(value).length<=256;
const headers = {
  'Cache-Control':'private, no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
function output(value,status=200,extra={}) {
  return Response.json(value,{status,headers:{...headers,...extra}});
}
function cookie(request,name) {
  const token = request.headers.get('Cookie')?.split(';').map(part=>part.trim())
    .find(part=>part.startsWith(name+'='))?.slice(name.length+1);
  return tokenPattern.test(token ?? '') ? hash(token) : '';
}
function setCookie(name,value,seconds,secure) {
  return {'Set-Cookie':`${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`};
}
async function limitedBody(request,max) {
  if (Number(request.headers.get('Content-Length'))>max) fail(413,'Request is too large.');
  const reader=request.body?.getReader();
  if (!reader) fail(400,'Request body is required.');
  const parts=[];
  let size=0;
  while (true) {
    const {value,done}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>max) { await reader.cancel(); fail(413,'Request is too large.'); }
    parts.push(value);
  }
  return new Blob(parts);
}
async function json(request) {
  if (request.headers.get('Content-Type')?.split(';')[0]!=='application/json') fail(415,'Send JSON.');
  const blob=await limitedBody(request,131072);
  try {
    const value=JSON.parse(await blob.text());
    if (!value || Array.isArray(value) || typeof value!=='object') throw new Error();
    return value;
  } catch { fail(400,'Invalid JSON.'); }
}

export default {
  async fetch(request,env) {
    try { return await route(request,env); }
    catch (error) {
      if (!error.status) console.error('Prototype request failed:',error.message);
      return output({error:error.status ? error.message : 'The prototype could not complete this request.'},error.status || 500);
    }
  }
};

async function route(request,env) {
  const url=new URL(request.url);
  const local = env.LOCAL_SYNTHETIC_ONLY==='1' && ['localhost','127.0.0.1'].includes(url.hostname);
  const pilot = env.SYNTHETIC_EDGE_PILOT==='1' && url.protocol==='https:' &&
    url.origin===env.PILOT_ORIGIN && url.hostname.endsWith('.workers.dev');
  if (!local && !pilot) fail(403,'Synthetic pilot only.');
  if (!keyPattern.test(env.GUEST_CODE_KEY ?? '')) fail(503,'Guest access is unavailable.');
  const path=url.pathname;
  const method=request.method;
  if (method!=='GET' && request.headers.get('Origin')!==url.origin) fail(403,'Invalid request origin.');
  const db=env.DB.withSession('first-primary');
  const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
  const one=(sql,...args)=>stmt(sql,...args).first();
  const all=async (sql,...args)=>(await stmt(sql,...args).all()).results;
  const run=(sql,...args)=>stmt(sql,...args).run();
  const now=Date.now();
  const staff=()=>one('SELECT token FROM sessions WHERE token=? AND share IS NULL AND expires>?',cookie(request,'kv_staff'),now);
  const guest=()=>one(`SELECT s.id FROM sessions g JOIN shares s ON s.id=g.share
    WHERE g.token=? AND g.expires>? AND s.expires>? AND s.revoked IS NULL AND s.revision=g.revision`,cookie(request,'kv_guest'),now,now);
  const requireStaff=async()=>{ if (!await staff()) fail(401,'Staff sign-in required.'); };
  const requireGuest=async()=>{
    const session=await guest();
    if (!session) fail(401,'Reopen the guest link and enter its access code.');
    return session.id;
  };
  const current=(apartment,published=false)=>one(
    'SELECT * FROM versions WHERE apartment=?'+(published?' AND available<=?':'')+' ORDER BY seq DESC LIMIT 1',
    ...[apartment,...(published?[now]:[])]
  );
  async function throttle(scope, identity) {
    const minute=Math.floor(now/60000);
    const client=request.headers.get('CF-Connecting-IP') || 'local';
    const bucket=minute+':'+hash(scope+':'+(identity ?? client));
    const count=await one(`INSERT INTO attempts VALUES(?,1) ON CONFLICT(bucket)
      DO UPDATE SET count=count+1 WHERE count<8 RETURNING count`,bucket);
    if (!count) fail(429,'Too many attempts. Try again in a minute.');
    if (!identity) await run('DELETE FROM attempts WHERE bucket<?',String(minute-2)+':');
  }
  async function asset(path) {
    const target=new URL(path,url);
    const response=await env.ASSETS.fetch(new Request(target,{redirect:'manual'}));
    const safe=new Headers(response.headers);
    for (const [key,value] of Object.entries(headers)) safe.set(key,value);
    return new Response(response.body,{status:response.status,headers:safe});
  }
  async function session(name,share,revision,expires) {
    const token=secret();
    await db.batch([
      stmt('DELETE FROM sessions WHERE expires<=? OR token=?',now,cookie(request,name)),
      stmt('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),expires,share,revision)
    ]);
    return output({ok:true},200,setCookie(name,token,Math.ceil((expires-now)/1000),url.protocol==='https:'));
  }
  if (method==='GET' && path==='/') return Response.redirect(new URL('/staff',url),302);
  if (method==='GET' && path==='/staff') return asset(await staff()?'/sharing/staff.html':'/sharing/staff-login.html');
  if (method==='GET' && ['/staff/editor/','/staff/editor/index.html'].includes(path) && !await staff()) {
    return new Response(null,{status:303,headers:{...headers,Location:'/staff'}});
  }
  if (method==='GET' && path==='/guest') return asset('/sharing/guest.html');
  if (method==='GET' && /^\/sharing\/(sharing\.css|guest\.js|staff-login\.js)$/.test(path)) return asset(path);
  if (method==='GET' && (/^\/sharing\/(staff|worker-import)\.js$/.test(path) || path.startsWith('/staff/editor/'))) {
    await requireStaff();
    return asset(path==='/staff/editor/' ? path+'index.html' : path);
  }
  if (method==='GET' && /^\/viewer\/(styles\.css|app\.js|tour-data\.js|vendor\/marzipano\.js)$/.test(path)) {
    await requireGuest();
    return asset(path);
  }
  if (method==='POST' && path==='/api/staff/sign-in') {
    if (!keyPattern.test(env.STAFF_RANDOM_HASH ?? '')) fail(503,'Staff sign-in has not been configured.');
    await throttle('staff');
    const {passphrase}=await json(request);
    if (!validPass(passphrase,16)) fail(401,'Sign-in failed.');
    if (!timingSafeEqual(Buffer.from(hash(passphrase),'hex'),Buffer.from(env.STAFF_RANDOM_HASH,'hex'))) fail(401,'Sign-in failed.');
    return session('kv_staff',null,null,now+8*hour);
  }
  if (method==='POST' && path==='/api/guest/unlock') {
    await throttle('guest');
    const {token,code}=await json(request);
    const wrong=()=>fail(401,'That phrase or code did not match. Check your invitation and try again.');
    if (typeof token!=='string' || !tokenPattern.test(token) || typeof code!=='string') wrong();
    const share=await one('SELECT * FROM shares WHERE token=? AND revoked IS NULL AND expires>?',hash(token),now);
    if (!share) wrong();
    await throttle('share',share.id);
    let candidate;
    if (/^hmac-v1:[a-f0-9]{64}$/.test(share.verifier) && codePattern.test(code)) {
      candidate=guestCodeVerifier(env.GUEST_CODE_KEY,share.id,share.salt,code);
    } else if (/^phrase-v1:[a-f0-9]{64}$/.test(share.verifier)) {
      const normalized=normalizePhrase(code);
      if (!/^[a-z]{3,8}(?:-[a-z]{3,8}){2}(?:(?:-[a-z]{3,8}){2}){0,2}$/.test(normalized)) wrong();
      candidate=phraseVerifier(env.GUEST_CODE_KEY,share.id,share.salt,normalized);
    }
    if (!candidate || !timingSafeEqual(Buffer.from(candidate),Buffer.from(share.verifier))) wrong();
    return session('kv_guest',share.id,share.revision,Math.min(share.expires,now+8*hour));
  }
  if (path.startsWith('/api/staff/')) {
    await requireStaff();
    if (method==='POST' && path==='/api/staff/sign-out') {
      await run('DELETE FROM sessions WHERE token=?',cookie(request,'kv_staff'));
      return output({ok:true},200,setCookie('kv_staff','',0,url.protocol==='https:'));
    }
    if (method==='POST' && path==='/api/staff/photos') {
      if (request.headers.get('Content-Type')!=='image/jpeg') fail(415,'Send one stitched JPEG.');
      const blob=await limitedBody(request,MAX_JPEG);
      try {
        const {width,height}=await inspectJpeg(blob);
        if (width>8192 || height>4096) fail(400,'JPEG dimensions exceed 8192 × 4096.');
        const end=new Uint8Array(await blob.slice(-2).arrayBuffer());
        if (end[0]!==255 || end[1]!==217) fail(400,'JPEG is truncated.');
      } catch (error) { fail(400,error.message); }
      const photo=id();
      try { await db.batch([
        stmt(`INSERT INTO photos(id,bytes) SELECT ?,? WHERE
          (SELECT COUNT(*) FROM photo_age WHERE created>=?)<800`,photo,blob.size,now-now%86400000),
        stmt('INSERT INTO photo_age SELECT ?,? WHERE EXISTS(SELECT 1 FROM photos WHERE id=?)',photo,now,photo)
      ]).then(([reservation])=>{ if (!reservation.meta.changes) fail(429,'Daily pilot upload limit reached. Retry after midnight UTC.'); }); }
      catch(error) { if (error.message.includes('photo budget exceeded')) fail(507,'Private photo storage limit reached.'); throw error; }
      // Reservations count even if a write fails ambiguously, so parallel uploads cannot exceed the budget.
      await env.PHOTOS.put(photo,await blob.arrayBuffer());
      await run('UPDATE photos SET ready=1 WHERE id=? AND ready=0',photo);
      return output({id:photo,bytes:blob.size},201);
    }
    if (method==='POST' && path==='/api/staff/apartments') {
      const {tour,photos,replacement,expectedVersion}=await json(request);
      try { validateApartment(tour); } catch (error) { fail(400,error.message); }
      if (tour.rooms.length>MAX_ROOMS) fail(400,'Tour is too large.');
      if (!photos || Object.keys(photos).length!==tour.rooms.length ||
          tour.rooms.some(room=>typeof photos[room.id]!=='string' || !idPattern.test(photos[room.id]))) fail(400,'One uploaded JPEG is required per room.');
      const ids=[...new Set(Object.values(photos))];
      if (replacement && !idPattern.test(replacement)) fail(400,'Invalid apartment.');
      const apartment=replacement || id();
      if (replacement && (!Number.isSafeInteger(expectedVersion) || expectedVersion<1)) fail(409,'Reopen the latest apartment draft before saving.');
      const prior=replacement ? expectedVersion : 0;
      const seq=prior+1;
      const available=draftOnly;
      try {
        const saved=await run(`INSERT INTO versions SELECT ?,?,?,?,?,?
          WHERE NOT EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=2)
          AND COALESCE((SELECT MAX(seq) FROM versions WHERE apartment=?),0)=?
          AND (SELECT COUNT(*) FROM photos WHERE ready=1 AND id IN (${ids.map(()=>'?').join(',')}))=?`,
          apartment,seq,tour.title,JSON.stringify(tour),JSON.stringify(photos),available,apartment,apartment,prior,...ids,ids.length);
        if (!saved.meta.changes) fail(409,'Apartment or uploads changed. Reload and try again.');
      } catch(error) { if (error.message.includes('UNIQUE')) fail(409,'This apartment changed. Refresh and try again.'); throw error; }
      return output({id:apartment,version:seq,available},201);
    }
    const staffTour=/^\/api\/staff\/tours\/([a-f0-9]{32})\/(manifest|images\/([a-z0-9-]+))$/.exec(path);
    const lifecycle=/^\/api\/staff\/apartments\/([a-f0-9]{32})$/.exec(path);
    if (method==='PATCH' && lifecycle) {
      const apartment=lifecycle[1];
      const {action,expectedVersion}=await json(request);
      const latest=await current(apartment);
      const state=await one('SELECT state FROM apartment_visibility WHERE apartment=?',apartment);
      if (!latest || state?.state===2) fail(404,'Apartment not found.');
      if (latest.seq!==expectedVersion) fail(409,'This apartment changed. Reopen it before continuing.');
      const guard='?=(SELECT MAX(seq) FROM versions WHERE apartment=?) AND NOT EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=2)';
      const args=[latest.seq,apartment,apartment];
      if (action==='publish') {
        if (JSON.parse(latest.manifest).rooms.some(room=>room.links.some(link=>link.pending))) fail(400,'Position every return arrow before publishing.');
        const result=await db.batch([
          stmt(`UPDATE versions SET available=? WHERE apartment=? AND seq<>? AND ${guard}
            AND EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=1)`,draftOnly,apartment,latest.seq,...args,apartment),
          stmt(`UPDATE versions SET available=MIN(available,?) WHERE apartment=? AND seq=? AND ${guard}`,now+60000,apartment,latest.seq,...args),
          stmt(`DELETE FROM apartment_visibility WHERE apartment=? AND ${guard}`,apartment,...args)
        ]);
        if (!result[1].meta.changes) fail(409,'This apartment changed. Reopen it.');
      } else if (action==='unpublish' || action==='remove') {
        const result=await run(`INSERT INTO apartment_visibility SELECT ?,? WHERE ${guard}
          ON CONFLICT(apartment) DO UPDATE SET state=excluded.state`,apartment,action==='remove'?2:1,...args);
        if (!result.meta.changes) fail(409,'This apartment changed. Reopen it.');
      } else fail(400,'Unknown apartment action.');
      return output({ok:true});
    }
    if (method==='GET' && staffTour) {
      if (await one('SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=2',staffTour[1])) fail(404,'Tour not found.');
      const version=await current(staffTour[1]);
      if (url.searchParams.has('version') && String(version?.seq)!==url.searchParams.get('version')) fail(409,'Tour changed. Export again.');
      return tourAsset(version,staffTour[3],env);
    }
    const draftRoute=/^\/api\/staff\/drafts\/([a-f0-9]{32})$/.exec(path);
    if (method==='GET' && draftRoute) {
      const apartment=draftRoute[1];
      if (await one('SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=2',apartment)) fail(404,'Tour not found.');
      const version=await current(apartment);
      if (!version) fail(404,'Tour not found.');
      return output({tour:JSON.parse(version.manifest),photos:JSON.parse(version.photos),revision:version.seq});
    }
    if (method==='POST' && path==='/api/staff/cleanup') {
      // Keep the current draft, the live publication and every version still warming.
      const pruned=await run(`DELETE FROM versions WHERE rowid IN (SELECT v.rowid FROM versions v
        WHERE EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment AND h.state=2)
        OR (v.seq<(SELECT MAX(d.seq) FROM versions d WHERE d.apartment=v.apartment)
          AND (v.available=? OR (v.available<=? AND v.seq<
            (SELECT MAX(p.seq) FROM versions p WHERE p.apartment=v.apartment AND p.available<=?))))
        LIMIT 50)`,draftOnly,now,now);
      // Legacy uploads acquire a grace period the first time maintenance runs.
      await run('INSERT OR IGNORE INTO photo_age SELECT id,? FROM photos WHERE id NOT IN (SELECT id FROM photo_age) LIMIT 50',now);
      const reserved=await all(`UPDATE photos SET ready=-1 WHERE id IN (
        SELECT p.id FROM photos p JOIN photo_age a ON a.id=p.id WHERE
          (p.ready=-1 OR a.created<?) AND NOT EXISTS (
            SELECT 1 FROM versions v, json_each(v.photos) j WHERE j.value=p.id)
        LIMIT 10) RETURNING id`,now-24*hour);
      let deleted=0;
      for (const photo of reserved) {
        await env.PHOTOS.delete(photo.id);
        const result=await db.batch([
          stmt('DELETE FROM photos WHERE id=? AND ready=-1',photo.id),
          stmt('DELETE FROM photo_age WHERE id=? AND NOT EXISTS(SELECT 1 FROM photos WHERE id=?)',photo.id,photo.id)
        ]);
        deleted+=result[0].meta.changes;
      }
      return output({versions:pruned.meta.changes,photos:deleted});
    }
    if (method==='GET' && path==='/api/staff/dashboard') {
      const apartments=await all(`SELECT v.apartment AS id,v.title,v.seq AS version,v.available,
        NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment)
          AND EXISTS(SELECT 1 FROM versions p WHERE p.apartment=v.apartment AND p.available<?) AS published
        FROM versions v WHERE v.seq=(SELECT MAX(seq) FROM versions WHERE apartment=v.apartment)
          AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment AND h.state=2)
        ORDER BY v.title`,draftOnly);
      const shares=await all(`SELECT s.id,s.expires,s.revoked,CASE WHEN s.revoked IS NOT NULL THEN 'revoked'
        WHEN s.expires<=? THEN 'expired' ELSE 'active' END AS status,
        (SELECT json_group_array(p.apartment) FROM permissions p WHERE p.share=s.id) AS apartments
        FROM shares s ORDER BY s.expires DESC`,now);
      return output({apartments,shares:shares.map(s=>({...s,apartments:JSON.parse(s.apartments)}))});
    }
    async function selection(apartments) {
      if (!Array.isArray(apartments) || !apartments.length || apartments.length>25 || new Set(apartments).size!==apartments.length ||
          apartments.some(a=>typeof a!=='string'||!idPattern.test(a))) fail(400,'Select one or more apartments.');
      const records=await all(`SELECT DISTINCT apartment FROM versions WHERE available<? AND apartment IN (${apartments.map(()=>'?').join(',')})
        AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=versions.apartment)`,draftOnly,...apartments);
      if (records.length!==apartments.length) fail(400,'Select only published apartments.');
      return apartments;
    }
    if (method==='POST' && path==='/api/staff/shares') {
      const input=await json(request);
      const apartments=await selection(input.apartments);
      if (Object.hasOwn(input,'passphrase') || Object.hasOwn(input,'code')) fail(400,'Guest access codes are generated by the server.');
      if (!Number.isSafeInteger(input.expires) || input.expires<=now) fail(400,'Choose a future expiration.');
      await throttle('create');
      const token=secret(), share=id(), salt=id();
      const code=generatePhrase(input.wordCount);
      const verifier=phraseVerifier(env.GUEST_CODE_KEY,share,salt,code);
      await db.batch([
        stmt('INSERT INTO shares(id,token,salt,verifier,expires) VALUES(?,?,?,?,?)',share,hash(token),salt,verifier,input.expires),
        ...apartments.map(a=>stmt('INSERT INTO permissions VALUES(?,?)',share,a))
      ]);
      return output({id:share,url:url.origin+'/guest#'+token,code},201);
    }
    const rotation=/^\/api\/staff\/shares\/([a-f0-9]{32})\/phrase$/.exec(path);
    if (method==='POST' && rotation) {
      await throttle('create');
      const {wordCount}=await json(request);
      const code=generatePhrase(wordCount), salt=id(), share=rotation[1];
      const result=await run(`UPDATE shares SET salt=?,verifier=?,revision=revision+1
        WHERE id=? AND expires>? AND revoked IS NULL`,salt,phraseVerifier(env.GUEST_CODE_KEY,share,salt,code),share,now);
      if (!result.meta.changes) fail(404,'Active share not found.');
      return output({code});
    }
    const edit=/^\/api\/staff\/shares\/([a-f0-9]{32})$/.exec(path);
    if (edit && ['PATCH','DELETE'].includes(method)) {
      const share=edit[1];
      const existing=await one('SELECT revision FROM shares WHERE id=? AND expires>? AND revoked IS NULL',share,now);
      if (!existing) fail(404,'Active share not found.');
      if (method==='DELETE') {
        await run('UPDATE shares SET revoked=?,revision=revision+1 WHERE id=? AND revoked IS NULL',now,share);
      } else {
        const apartments=await selection((await json(request)).apartments);
        // Each statement is conditional on the same prior revision, changed last in this atomic batch.
        const guard='EXISTS(SELECT 1 FROM shares WHERE id=? AND revision=? AND expires>? AND revoked IS NULL)';
        const args=[share,existing.revision,Date.now()];
        const result=await db.batch([
          stmt(`DELETE FROM permissions WHERE share=? AND ${guard}`,share,...args),
          ...apartments.map(a=>stmt(`INSERT INTO permissions SELECT ?,? WHERE ${guard}`,share,a,...args)),
          stmt(`UPDATE shares SET revision=revision+1 WHERE id=? AND ${guard}`,share,...args)
        ]);
        if (!result.at(-1).meta.changes) fail(409,'This link changed. Refresh and try again.');
      }
      return output({ok:true});
    }
    fail(404,'Not found.');
  }
  if (method==='GET' && path==='/api/guest/catalog') {
    const share=await requireGuest();
    return output(await all(`SELECT v.apartment AS id,v.title FROM versions v JOIN permissions p ON p.apartment=v.apartment
      WHERE p.share=? AND v.seq=(SELECT MAX(seq) FROM versions WHERE apartment=v.apartment AND available<=?)
        AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment)
      ORDER BY v.title`,share,now));
  }
  const tour=/^\/(guest\/tour|api\/guest\/tours)\/([a-f0-9]{32})(?:\/(manifest|thumbnail|images\/([a-z0-9-]+)))?$/.exec(path);
  if (method==='GET' && tour) {
    const [,group,apartment,kind,room]=tour;
    // One primary query checks authorization and selects a published version in the same snapshot.
    const version=await one(`SELECT v.* FROM sessions g JOIN shares s ON s.id=g.share
      JOIN permissions p ON p.share=s.id JOIN versions v ON v.apartment=p.apartment
      WHERE g.token=? AND g.expires>? AND s.expires>? AND s.revoked IS NULL AND s.revision=g.revision
        AND v.apartment=? AND v.available<=?
        AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment)
        ORDER BY v.seq DESC LIMIT 1`,cookie(request,'kv_guest'),now,now,apartment,now);
    if (!version) { await requireGuest(); fail(404,'Tour not found or preparing.'); }
    if (group==='guest/tour' && !kind) return asset('/viewer/index.html');
    if (group==='api/guest/tours' && kind) return tourAsset(version,kind==='thumbnail'?JSON.parse(version.manifest).startRoom:room,env);
  }
  fail(404,'Not found.');
}

export async function tourAsset(version,room,env) {
  if (!version) fail(404,'Tour not found.');
  if (!room) return output(JSON.parse(version.manifest),200,{'X-Tour-Version':String(version.seq)});
  const photos=JSON.parse(version.photos);
  if (!Object.hasOwn(photos,room)) fail(404,'Photo not found.');
  const value=await env.PHOTOS.get(photos[room],{type:'stream',cacheTtl:30});
  if (!value) return output({error:'Photo is still preparing. Retry shortly.'},503,{'Retry-After':'30'});
  return new Response(value,{headers:{...headers,'Content-Type':'image/jpeg'}});
}
