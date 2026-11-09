import {shareExpiration} from './share-expiration.mjs';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import words from './phrase-words.mjs';
import { emailPattern, firebaseRequest, firebaseUidPattern, verifyFirebaseToken } from './firebase-auth.mjs';
import { hashStaffPassword, normalizeUsername, usernamePattern, validNewStaffPassword, verifyStaffPassword } from './staff-password.mjs';
import { inspectJpeg, MAX_ROOMS } from '../dist/tour-package.js';
import { validateApartment } from '../dist/tour-data.js';
import { visitorManifest } from '../dist/layout-state.js';
import { publicationView } from '../dist/graph-tour.js';

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
function invitationCode(key,share,salt,wordCount) {
  if (wordCount===undefined || wordCount===0) {
    const code=randomBytes(16).toString('base64url');
    return {code,verifier:guestCodeVerifier(key,share,salt,code)};
  }
  const code=generatePhrase(wordCount);
  return {code,verifier:phraseVerifier(key,share,salt,code)};
}
const validPass = (value,min) => typeof value==='string' && value.length>=min && new TextEncoder().encode(value).length<=256;
const headers = {
  'Cache-Control':'private, no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
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
async function json(request,max=131072) {
  if (request.headers.get('Content-Type')?.split(';')[0]!=='application/json') fail(415,'Send JSON.');
  const blob=await limitedBody(request,max);
  try {
    const value=JSON.parse(await blob.text());
    if (!value || Array.isArray(value) || typeof value!=='object') throw new Error();
    return value;
  } catch { fail(400,'Invalid JSON.'); }
}

const passwordWorkOrigin='https://staff-password.internal';
async function passwordWork(request) {
  const path=new URL(request.url).pathname;
  if (request.method!=='POST' || !['/hash','/verify'].includes(path)) return output({error:'Not found.'},404);
  const {password,verifier}=await json(request,2048);
  if (path==='/hash') return output({verifier:hashStaffPassword(password)});
  return output({valid:verifyStaffPassword(password,verifier)});
}

async function derivePassword(env,url,operation,data) {
  const target=new URL('/'+operation,passwordWorkOrigin);
  const label=url.searchParams.get('acceptance');
  if (label && /^local-kdf-[a-z0-9:-]{1,80}$/.test(label)) target.searchParams.set('acceptance',label);
  const response=await env.STAFF_LOGIN.getByName('password-hash-v1').fetch(new Request(target,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
  }));
  if (!response.ok) fail(503,'Staff password service is temporarily unavailable.');
  return response.json();
}

async function handleRequest(request,env,privateStaffOnly=false) {
  try {
    if (privateStaffOnly && env.STAFF_AUTH_MODE==='password' && new URL(request.url).origin===passwordWorkOrigin) {
      return await passwordWork(request);
    }
    return await route(request,env,privateStaffOnly);
  }
  catch (error) {
    if (!error.status) console.error('Prototype request failed:',error.message);
    return output({error:error.status ? error.message : 'The prototype could not complete this request.'},error.status || 500);
  }
}

export default { fetch: (request,env) => handleRequest(request,env) };

export class StaffLogin {
  constructor(_state,env) {
    this.env=env;
  }

  fetch(request) {
    return handleRequest(request,this.env,true);
  }
}

async function route(request,env,privateStaffOnly) {
  const url=new URL(request.url);
  const local = env.LOCAL_SYNTHETIC_ONLY==='1' && ['localhost','127.0.0.1'].includes(url.hostname);
  const pilot = env.SYNTHETIC_EDGE_PILOT==='1' && url.protocol==='https:' &&
    url.origin===env.PILOT_ORIGIN && url.hostname.endsWith('.workers.dev');
  if (!local && !pilot) fail(403,'Synthetic pilot only.');
  if (!keyPattern.test(env.GUEST_CODE_KEY ?? '')) fail(503,'Guest access is unavailable.');
  const path=url.pathname;
  const method=request.method;
  if (method!=='GET' && request.headers.get('Origin')!==url.origin) fail(403,'Invalid request origin.');
  const passwordAccounts=env.STAFF_AUTH_MODE==='password';
  const individualAccounts=passwordAccounts || env.STAFF_ACCOUNTS==='1';
  const namedLogin=individualAccounts && method==='POST' && path==='/api/staff/sign-in';
  const staffDashboard=individualAccounts && method==='GET' && path==='/api/staff/dashboard';
  const accountList=passwordAccounts && method==='GET' && path==='/api/staff/accounts';
  const credentialMutation=passwordAccounts && path==='/api/staff/accounts' && ['POST','PATCH'].includes(method);
  const privateStaffRoute=namedLogin || staffDashboard || accountList || credentialMutation;
  const privateTourRoute=env.TOUR_API_BACKEND==='durable-object' &&
    (/^\/api\/(staff|guest)\//.test(path) || /^\/guest\/tour\//.test(path));
  if (privateStaffOnly && !privateStaffRoute && !privateTourRoute) fail(404,'Not found.');
  if (!privateStaffOnly && privateTourRoute) {
    if (!env.STAFF_LOGIN) fail(503,'Tour service is temporarily unavailable.');
    const forwarded=new Request(request);
    // Only ingress supplies this identity; callers cannot choose distributed rate buckets.
    forwarded.headers.set('X-Staff-Login-Client',request.headers.get('CF-Connecting-IP') || 'local');
    return env.STAFF_LOGIN.getByName('tour-api-v2').fetch(forwarded);
  }
  if (!privateStaffOnly && privateStaffRoute && (passwordAccounts || env.STAFF_LOGIN_BACKEND==='durable-object')) {
    if (!env.STAFF_LOGIN) fail(503,'Staff service is temporarily unavailable.');
    if (staffDashboard || accountList) {
      // A fresh instance avoids dispatching an added route to an actor still running older code.
      return env.STAFF_LOGIN.getByName(passwordAccounts?'password-dashboard-v2':'staff-dashboard').fetch(request);
    }
    const forwarded=new Request(request);
    forwarded.headers.set('X-Staff-Login-Client',request.headers.get('CF-Connecting-IP') || 'local');
    return env.STAFF_LOGIN.getByName(passwordAccounts?'password-credentials-v4':'staff-login').fetch(forwarded);
  }
  const db=env.DB.withSession('first-primary');
  const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
  const one=(sql,...args)=>stmt(sql,...args).first();
  const all=async (sql,...args)=>(await stmt(sql,...args).all()).results;
  const run=(sql,...args)=>stmt(sql,...args).run();
  const now=Date.now();
  const staffAccountTable=passwordAccounts?'staff_accounts':'firebase_staff_accounts';
  const staffSessionTable=passwordAccounts?'staff_sessions':'firebase_staff_sessions';
  const namedCookie=passwordAccounts?'__Host-sht_staff':'kv_firebase_staff';
  const staffCookie=individualAccounts?namedCookie:'kv_staff';
  const staffCredential=individualAccounts ? request.headers.get('Cookie')?.split(';').map(part=>part.trim())
    .find(part=>part.startsWith(namedCookie+'='))?.slice(namedCookie.length+1) ?? '' : '';
  const opaqueStaffCookie=tokenPattern.test(staffCredential);
  const legacyStaffCookie=!passwordAccounts && staffCredential.length<=3544 && staffCredential[43]==='~' &&
    tokenPattern.test(staffCredential.slice(0,43));
  const staffTokenHash=opaqueStaffCookie || legacyStaffCookie ? hash(staffCredential) : '';
  const firebaseReady=env.FIREBASE_PROJECT_ID && env.FIREBASE_AUTH_API_KEY;
  const staff=async()=>{
    if (!individualAccounts) return one('SELECT token FROM sessions WHERE token=? AND share IS NULL AND expires>?',cookie(request,'kv_staff'),now);
    if (!staffTokenHash || (!passwordAccounts && !firebaseReady)) return null;
    const account=await one(`SELECT a.username,a.role,a.revision${passwordAccounts?'':',a.firebase_uid'} FROM ${staffSessionTable} s
      JOIN ${staffAccountTable} a USING(username)
      WHERE s.token=? AND s.expires>? AND a.disabled=0 AND s.revision=a.revision`,staffTokenHash,now);
    if (!account || opaqueStaffCookie) return account;
    // Existing JWT-bearing sessions retain their original validation until they expire.
    const claims=await verifyFirebaseToken(staffCredential.slice(44),env.FIREBASE_PROJECT_ID,Date.now());
    return claims?.sub===account.firebase_uid ? account : null;
  };
  const guest=()=>one(`SELECT s.id FROM sessions g JOIN shares s ON s.id=g.share
    WHERE g.token=? AND g.expires>? AND s.expires>? AND s.revoked IS NULL AND s.revision=g.revision`,cookie(request,'kv_guest'),now,now);
  const requireStaff=async()=>{
    const account=await staff();
    if (!account) fail(401,'Staff sign-in required.');
    return account;
  };
  const requireGuest=async()=>{
    const session=await guest();
    if (!session) fail(401,'Reopen the guest link and enter its access code.');
    return session.id;
  };
  const current=(apartment,published=false)=>one(
    'SELECT * FROM versions WHERE apartment=?'+(published?' AND available<=?':'')+' ORDER BY seq DESC LIMIT 1',
    ...[apartment,...(published?[now]:[])]
  );
  const minute=Math.floor(now/60000);
  const client=request.headers.get(privateStaffOnly?'X-Staff-Login-Client':'CF-Connecting-IP') || 'local';
  const attemptSql=`INSERT INTO attempts VALUES(?,1) ON CONFLICT(bucket)
    DO UPDATE SET count=count+1 WHERE count<8 RETURNING count`;
  const attemptBucket=(scope,identity=client)=>minute+':'+hash(scope+':'+identity);
  async function throttle(scope, identity) {
    const count=await one(attemptSql,attemptBucket(scope,identity));
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
  if (method==='GET' && path==='/staff') return asset(await staff()?'/sharing/gallery.html':'/sharing/staff-login.html');
  if (method==='GET' && path==='/staff/guest-links') { if(!await staff()) return new Response(null,{status:303,headers:{...headers,Location:'/staff'}}); return asset('/sharing/staff.html'); }
  if (method==='GET' && path==='/api/staff/sign-in-mode') return output({individualAccounts});
  if (method==='GET' && (path==='/staff/accounts' || path==='/sharing/staff-accounts.js')) {
    const account=await staff();
    if (!account && path==='/staff/accounts') return new Response(null,{status:303,headers:{...headers,Location:'/staff'}});
    if (!account) fail(401,'Staff sign-in required.');
    if (account.role!=='administrator') fail(403,'Administrator access required.');
    return asset(path==='/staff/accounts'?'/sharing/staff-accounts.html':path);
  }
  if (method==='GET' && ['/staff/editor/','/staff/editor/index.html'].includes(path) && !await staff()) {
    return new Response(null,{status:303,headers:{...headers,Location:'/staff'}});
  }
  if (method==='GET' && path==='/guest') return asset('/sharing/guest.html');
  if (method==='GET' && /^\/offline\/(?:app\.webmanifest|sw\.js|offline(?:-store)?\.js|offline\.css|icon-(?:192|512)\.png|styles\.css|app\.js|tour-data\.js|room-grid\.js|builder-data\.js|graph-tour\.js|layout-state\.js|vendor\/marzipano\.js)?$/.test(path)) {
    return asset(path==='/offline/'?'/offline/index.html':path);
  }
  if (method==='GET' && /^\/sharing\/(sharing\.css|guest\.js|staff-login\.js)$/.test(path)) return asset(path);
  if (method==='GET' && ['/sharing/gallery.js','/sharing/qr.js','/sharing/sharing-gallery.css'].includes(path)) { await requireStaff(); return asset(path); }
  if (method==='GET' && (/^\/sharing\/(staff|worker-import)\.js$/.test(path) || path.startsWith('/staff/editor/'))) {
    await requireStaff();
    return asset(path==='/staff/editor/' ? path+(url.searchParams.has('legacy')?'legacy.html':'index.html') : path);
  }
  if (method==='GET' && /^\/viewer\/(styles\.css|app\.js|tour-data\.js|room-grid\.js|builder-data\.js|graph-tour\.js|layout-state\.js|vendor\/marzipano\.js)$/.test(path)) {
    await requireGuest();
    return asset(path);
  }
  if (method==='POST' && path==='/api/staff/sign-in') {
    if (individualAccounts) {
      const input=await json(request,2048);
      const username=normalizeUsername(input.username);
      const throttleScope=passwordAccounts?'password-staff':'staff';
      if (!passwordAccounts && !firebaseReady) fail(503,'Staff sign-in has not been configured.');
      if (!usernamePattern.test(username) || !validPass(input.password,1)) {
        if (!passwordAccounts) await throttle(throttleScope);
        fail(401,'Sign-in failed.');
      }
      const nextAttempt=attemptSql.replace('VALUES(?,1)','SELECT ?,1 WHERE changes()>0');
      const accountFields=passwordAccounts?'password_verifier':'firebase_uid,email';
      const usernameBucket=attemptBucket(throttleScope+'-account',username);
      const globalBucket=passwordAccounts?attemptBucket('password-staff-global','all'):'';
      const ipAttempt=passwordAccounts
        ? stmt(attemptSql.replace('VALUES(?,1)',`SELECT ?,1 WHERE NOT EXISTS (
            SELECT 1 FROM attempts WHERE (bucket=? AND count>=8) OR (bucket=? AND count>=32)
          )`),attemptBucket(throttleScope),usernameBucket,globalBucket)
        : stmt(attemptSql,attemptBucket(throttleScope));
      const limits=[
        ipAttempt,
        stmt(nextAttempt,usernameBucket)
      ];
      if (passwordAccounts) limits.push(stmt(nextAttempt.replace('count<8','count<32'),globalBucket));
      const results=await db.batch([
        ...limits,
        stmt(`SELECT ${accountFields},disabled,revision FROM ${staffAccountTable} WHERE username=?`,username),
        stmt('DELETE FROM attempts WHERE bucket<?',String(minute-2)+':')
      ]);
      if (results.slice(0,limits.length).some(limit=>!limit.results.length)) fail(429,'Too many attempts. Try again in a minute.');
      const account=results[limits.length].results[0];
      let expires;
      if (passwordAccounts) {
        const {valid}=await derivePassword(env,url,'verify',{password:input.password,verifier:account?.password_verifier});
        if (!valid || !account || account.disabled) fail(401,'Sign-in failed.');
        expires=Date.now()+hour;
      } else {
        if (!account || account.disabled) fail(401,'Sign-in failed.');
        const response=await firebaseRequest(env.FIREBASE_AUTH_API_KEY,'signInWithPassword',{
          email:account.email,password:input.password,returnSecureToken:true
        });
        if (response.status===429) fail(429,'Too many attempts. Try again later.');
        if (response.status>=500) fail(503,'Staff sign-in is temporarily unavailable.');
        if (!response.ok) fail(401,'Sign-in failed.');
        const {idToken}=await response.json();
        const claims=await verifyFirebaseToken(idToken,env.FIREBASE_PROJECT_ID,Date.now());
        if (claims?.sub!==account.firebase_uid) fail(401,'Sign-in failed.');
        expires=claims.exp*1000;
      }
      const token=secret();
      const result=await db.batch([
        stmt(`DELETE FROM ${staffSessionTable} WHERE expires<=? OR token=?`,now,staffTokenHash),
        stmt(`INSERT INTO ${staffSessionTable} SELECT ?,username,revision,? FROM ${staffAccountTable}
          WHERE username=? AND disabled=0 AND revision=?`,hash(token),expires,username,account.revision)
      ]);
      if (!result[1].meta.changes) fail(401,'Sign-in failed.');
      return output({ok:true},200,setCookie(staffCookie,token,Math.floor((expires-Date.now())/1000),passwordAccounts || url.protocol==='https:'));
    }
    await throttle('staff');
    if (!keyPattern.test(env.STAFF_RANDOM_HASH ?? '')) fail(503,'Staff sign-in has not been configured.');
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
    const account=await requireStaff();
    if (path==='/api/staff/accounts') {
      if (account.role!=='administrator') fail(403,'Administrator access required.');
      const administratorGuard=`EXISTS(SELECT 1 FROM ${staffAccountTable} a JOIN ${staffSessionTable} s USING(username)
        WHERE a.username=? AND a.revision=? AND a.role='administrator' AND a.disabled=0
        AND s.token=? AND s.revision=a.revision AND s.expires>?)`;
      const administratorSession=()=>[account.username,account.revision,staffTokenHash,Date.now()];
      if (method==='GET') return output({passwordAccounts,currentUsername:account.username,
        accounts:await all(`SELECT username,role,disabled FROM ${staffAccountTable} ORDER BY username`)});
      if (method==='POST') {
        const input=await json(request,2048);
        const username=normalizeUsername(input.username);
        const {firebaseUid,email,role,password}=input;
        if (!usernamePattern.test(username) || !['editor','administrator'].includes(role)) fail(400,'Enter a valid username and role.');
        let result;
        if (passwordAccounts) {
          if (!validNewStaffPassword(password)) fail(400,'Use at least 15 characters and at most 256 UTF-8 bytes.');
          const {verifier}=await derivePassword(env,url,'hash',{password});
          result=await run(`INSERT INTO staff_accounts(username,password_verifier,role)
            SELECT ?,?,? WHERE ${administratorGuard} ON CONFLICT DO NOTHING`,
            username,verifier,role,...administratorSession());
        } else {
          if (typeof firebaseUid!=='string' || !firebaseUidPattern.test(firebaseUid) ||
            typeof email!=='string' || !emailPattern.test(email)) fail(400,'Enter a Firebase user UID and email.');
          result=await run(`INSERT INTO firebase_staff_accounts(username,firebase_uid,email,role)
            SELECT ?,?,?,? WHERE ${administratorGuard} ON CONFLICT DO NOTHING`,username,firebaseUid,email,role,...administratorSession());
        }
        if (!result.meta.changes) fail(409,'Username or administrator session changed.');
        return output({ok:true},201);
      }
      if (method==='PATCH') {
        const input=await json(request,2048);
        const username=normalizeUsername(input.username);
        if (!usernamePattern.test(username) || username===account.username) fail(400,'Choose another staff account.');
        const reset=input.action==='reset';
        if (!['reset','disable','enable'].includes(input.action)) fail(400,'Choose a valid account action.');
        const target=await one(`SELECT ${passwordAccounts?'username':'email'} FROM ${staffAccountTable} WHERE username=?`,username);
        if (!target) fail(404,'Staff account not found.');
        if (reset && passwordAccounts) {
          if (!validNewStaffPassword(input.password)) fail(400,'Use at least 15 characters and at most 256 UTF-8 bytes.');
          const {verifier}=await derivePassword(env,url,'hash',{password:input.password});
          const result=await run(`UPDATE staff_accounts SET password_verifier=?,revision=revision+1
            WHERE username=? AND ${administratorGuard}`,verifier,username,...administratorSession());
          if (!result.meta.changes) fail(409,'Account or administrator session changed.');
          return output({ok:true});
        }
        const result=await run(`UPDATE ${staffAccountTable} SET disabled=CASE WHEN ? THEN disabled ELSE ? END,
          revision=revision+1 WHERE username=? AND ${administratorGuard}`,Number(reset),Number(input.action==='disable'),username,...administratorSession());
        if (!result.meta.changes) fail(409,'Account or administrator session changed.');
        if (reset) {
          await throttle('staff-reset',username);
          const response=await firebaseRequest(env.FIREBASE_AUTH_API_KEY,'sendOobCode',{
            requestType:'PASSWORD_RESET',email:target.email
          });
          if (!response.ok) fail(503,'Firebase could not send the reset email.');
        }
        return output({ok:true});
      }
    }
    if (method==='POST' && path==='/api/staff/sign-out') {
      await run(individualAccounts?`DELETE FROM ${staffSessionTable} WHERE token=?`:'DELETE FROM sessions WHERE token=?',
        individualAccounts?staffTokenHash:cookie(request,'kv_staff'));
      return output({ok:true},200,setCookie(staffCookie,'',0,passwordAccounts || url.protocol==='https:'));
    }
    if (method==='GET' && path==='/api/staff/offline') {
      const apartments=await all(`SELECT v.apartment AS id,v.title,CAST(v.seq AS TEXT) AS revision,v.manifest,
        (SELECT SUM(p.bytes) FROM json_each(v.photos) j JOIN photos p ON p.id=j.value WHERE NOT EXISTS(SELECT 1 FROM json_each(v.manifest,'$.builder.excluded') e WHERE e.value=j.key)) AS bytes
        FROM versions v WHERE v.seq=(SELECT MAX(seq) FROM versions WHERE apartment=v.apartment)
        AND json_array_length(v.manifest,'$.rooms')>0
        AND (json_extract(v.manifest,'$.grid.mode')='graph' OR (COALESCE(json_array_length(v.manifest,'$.builder.unplaced'),0)=0 AND COALESCE(json_array_length(v.manifest,'$.builder.missing'),0)=0
        AND NOT EXISTS(SELECT 1 FROM json_each(v.manifest,'$.rooms') r,json_each(r.value,'$.links') l WHERE json_extract(l.value,'$.pending')=1)))
        AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment AND h.state IN (2,3))
        ORDER BY v.title`);
      return output({apartments:apartments.flatMap(({manifest,...a})=>{try{validateApartment(JSON.parse(manifest));return [a];}catch{return [];}}),now});
    }
    const offline=/^\/api\/staff\/offline\/([a-f0-9]{32})\/(manifest|images\/([a-z0-9-]+))$/.exec(path);
    if (method==='GET' && offline) {
      const [,apartment,,room]=offline;
      const version=await one(`SELECT v.*${room?'':`,(SELECT json_group_array(json_object('room',j.key,'bytes',p.bytes))
        FROM json_each(v.photos) j JOIN photos p ON p.id=j.value) AS offline_images`} FROM versions v WHERE v.apartment=?
        AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment AND h.state IN (2,3))
        ORDER BY v.seq DESC LIMIT 1`,apartment);
      if (!version) fail(404,'Offline tour not found.');
      let offlineTour;try { const tour=validateApartment(JSON.parse(version.manifest));offlineTour=tour; if(tour.rooms.some(r=>r.links.some(l=>l.pending)))throw Error('Unpositioned doorway.'); } catch(error) { fail(409,'Finish this apartment before downloading it offline.'); }
      const revision=String(version.seq);
      if (room) {
        if (url.searchParams.get('revision')!==revision) fail(409,'The apartment changed. Download the new version.');
        if(!offlineTour.rooms.some(r=>r.id===room))fail(404,'Viewpoint is excluded.');return tourAsset(version,room,env);
      }
      const images=JSON.parse(version.offline_images).filter(i=>offlineTour.rooms.some(r=>r.id===i.room));
      const offlineHours=env.TOUR_OFFLINE_HOURS===undefined ? 24 : Number(env.TOUR_OFFLINE_HOURS);
      if (!Number.isInteger(offlineHours) || offlineHours<1 || offlineHours>168) fail(503,'Offline access duration is not configured correctly.');
      return output({tour:offlineTour,revision,expires:now+offlineHours*hour,images});
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
      try { validateApartment(tour,{draft:true}); } catch (error) { fail(400,error.message); }
      if (tour.rooms.length>MAX_ROOMS) fail(400,'Tour is too large.');
      const complete= tour.rooms.filter(room=>!tour.builder?.missing.includes(room.id));
      if (!photos || Object.keys(photos).length!==complete.length ||
          complete.some(room=>typeof photos[room.id]!=='string' || !idPattern.test(photos[room.id]))) fail(400,'One uploaded JPEG is required per complete viewpoint.');
      const ids=[...new Set(Object.values(photos))];
      if (replacement && !idPattern.test(replacement)) fail(400,'Invalid apartment.');
      const apartment=replacement || id();
      if (replacement && (!Number.isSafeInteger(expectedVersion) || expectedVersion<1)) fail(409,'Reopen the latest apartment draft before saving.');
      const prior=replacement ? expectedVersion : 0;
      const seq=prior+1;
      const available=draftOnly;
      try {
        const saved=await run(`INSERT INTO versions SELECT ?,?,?,?,?,?
          WHERE NOT EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=? AND state IN (2,3))
          AND COALESCE((SELECT MAX(seq) FROM versions WHERE apartment=?),0)=?
          AND (SELECT COUNT(*) FROM photos WHERE ready=1 AND id IN (${ids.map(()=>'?').join(',')||'NULL'}))=?`,
          apartment,seq,tour.title,JSON.stringify(tour),JSON.stringify(photos),available,apartment,apartment,prior,...ids,ids.length);
        if (!saved.meta.changes) fail(409,'Apartment or uploads changed. Reload and try again.');
      } catch(error) { if (error.message.includes('UNIQUE')) fail(409,'This apartment changed. Refresh and try again.'); throw error; }
      return output({id:apartment,version:seq,available},201);
    }
    const staffTour=/^\/api\/staff\/tours\/([a-f0-9]{32})\/(manifest|thumbnail|images\/([a-z0-9-]+))$/.exec(path);
    const lifecycle=/^\/api\/staff\/apartments\/([a-f0-9]{32})$/.exec(path);
    if (method==='PATCH' && lifecycle) {
      const apartment=lifecycle[1];
      const {action,expectedVersion}=await json(request);
      const latest=await current(apartment);
      const state=await one('SELECT state FROM apartment_visibility WHERE apartment=?',apartment);
      if (!latest || state?.state===2) fail(404,'Apartment not found.');
      if (latest.seq!==expectedVersion) fail(409,'This apartment changed. Reopen it before continuing.');
      if (state?.state===3 && action!=='restore') fail(409,'Restore the archived apartment before editing or publishing.');
      const guard='?=(SELECT MAX(seq) FROM versions WHERE apartment=?) AND NOT EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=? AND state IN (2,3))';
      const args=[latest.seq,apartment,apartment];
      if (action==='publish') {
        try { validateApartment(JSON.parse(latest.manifest)); } catch(error) { fail(400,error.message); }
        if (validateApartment(JSON.parse(latest.manifest)).rooms.some(room=>room.links.some(link=>link.pending))) fail(400,'Position every return arrow before publishing.');
        const result=await db.batch([
          stmt(`UPDATE versions SET available=? WHERE apartment=? AND seq<>? AND ${guard}
            AND EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=1)`,draftOnly,apartment,latest.seq,...args,apartment),
          stmt(`UPDATE versions SET available=MIN(available,?) WHERE apartment=? AND seq=? AND ${guard}`,now+60000,apartment,latest.seq,...args),
          stmt(`DELETE FROM apartment_visibility WHERE apartment=? AND ${guard}`,apartment,...args)
        ]);
        if (!result[1].meta.changes) fail(409,'This apartment changed. Reopen it.');
      } else if (action==='restore') {
        const result=await run(`UPDATE apartment_visibility SET state=1 WHERE apartment=? AND state=3
          AND ?=(SELECT MAX(seq) FROM versions WHERE apartment=?)`,apartment,latest.seq,apartment);
        if (!result.meta.changes) fail(409,'Only an archived apartment can be restored.');
      } else if (['unpublish','remove','archive'].includes(action)) {
        const result=await run(`INSERT INTO apartment_visibility SELECT ?,? WHERE ${guard}
          ON CONFLICT(apartment) DO UPDATE SET state=excluded.state`,apartment,{unpublish:1,remove:2,archive:3}[action],...args);
        if (!result.meta.changes) fail(409,'This apartment changed. Reopen it.');
      } else fail(400,'Unknown apartment action.');
      return output({ok:true});
    }
    if (method==='GET' && staffTour) {
      if (await one('SELECT 1 FROM apartment_visibility WHERE apartment=? AND state=2',staffTour[1])) fail(404,'Tour not found.');
      const version=await current(staffTour[1]);
      if(staffTour[2]==='thumbnail'&&(!version||!JSON.parse(version.photos)[JSON.parse(version.manifest).startRoom]))fail(404,'No starting-room image yet.');
      if (url.searchParams.has('version') && String(version?.seq)!==url.searchParams.get('version')) fail(409,'Tour changed. Export again.');
      return tourAsset(version,staffTour[2]==='thumbnail'?JSON.parse(version.manifest).startRoom:staffTour[3],env);
    }
    const draftRoute=/^\/api\/staff\/drafts\/([a-f0-9]{32})$/.exec(path);
    if (method==='GET' && draftRoute) {
      const apartment=draftRoute[1];
      if (await one('SELECT 1 FROM apartment_visibility WHERE apartment=? AND state IN (2,3)',apartment)) fail(404,'Draft not found.');
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
      const apartments=await all(`SELECT v.apartment AS id,v.title,v.seq AS version,v.available,v.rowid AS recent,json_array_length(v.manifest,'$.rooms') AS viewpoints,
        (SELECT COUNT(DISTINCT COALESCE(json_extract(r.value,'$.roomName'),json_extract(r.value,'$.name'))) FROM json_each(v.manifest,'$.rooms') r) AS roomCount,
        EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment AND h.state=3) AS archived,
        NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment)
          AND EXISTS(SELECT 1 FROM versions p WHERE p.apartment=v.apartment AND p.available<?) AS published
        FROM versions v WHERE v.seq=(SELECT MAX(seq) FROM versions WHERE apartment=v.apartment)
          AND NOT EXISTS(SELECT 1 FROM apartment_visibility h WHERE h.apartment=v.apartment AND h.state=2)
        ORDER BY v.title`,draftOnly);
      const shares=await all(`SELECT s.id,s.expires,s.revoked,CASE WHEN s.revoked IS NOT NULL THEN 'revoked'
        WHEN s.expires<=? THEN 'expired' ELSE 'active' END AS status,
        (SELECT json_group_array(p.apartment) FROM permissions p WHERE p.share=s.id) AS apartments
        FROM shares s ORDER BY s.expires DESC`,now);
      return output({apartments,staffRole:account.role,shares:shares.map(s=>({...s,apartments:JSON.parse(s.apartments)}))});
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
      if(input.expirationPreset){try{input.expires=shareExpiration(input.expirationPreset,now);}catch{fail(400,'Choose a valid expiration.');}}
      const apartments=await selection(input.apartments);
      if (Object.hasOwn(input,'passphrase') || Object.hasOwn(input,'code')) fail(400,'Guest access codes are generated by the server.');
      if (!Number.isSafeInteger(input.expires) || input.expires<=now) fail(400,'Choose a future expiration.');
      await throttle('create');
      const token=secret(), share=id(), salt=id();
      const {code,verifier}=invitationCode(env.GUEST_CODE_KEY,share,salt,input.wordCount);
      await db.batch([
        stmt('INSERT INTO shares(id,token,salt,verifier,expires) VALUES(?,?,?,?,?)',share,hash(token),salt,verifier,input.expires),
        ...apartments.map(a=>stmt('INSERT INTO permissions VALUES(?,?)',share,a))
      ]);
      return output({id:share,url:url.origin+'/guest#'+token,code,expires:input.expires},201);
    }
    const rotation=/^\/api\/staff\/shares\/([a-f0-9]{32})\/phrase$/.exec(path);
    if (method==='POST' && rotation) {
      await throttle('create');
      const {wordCount}=await json(request);
      const salt=id(), share=rotation[1];
      const {code,verifier}=invitationCode(env.GUEST_CODE_KEY,share,salt,wordCount);
      const result=await run(`UPDATE shares SET salt=?,verifier=?,revision=revision+1
        WHERE id=? AND expires>? AND revoked IS NULL`,salt,verifier,share,now);
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
    if (group==='api/guest/tours' && kind) return tourAsset(version,kind==='thumbnail'?JSON.parse(version.manifest).startRoom:room,env,true);
  }
  fail(404,'Not found.');
}

export async function tourAsset(version,room,env,guest=false) {
  if (!version) fail(404,'Tour not found.');
  if (!room) { const tour=JSON.parse(version.manifest); return output(guest?visitorManifest(tour):tour,200,{'X-Tour-Version':String(version.seq)}); }
  if(guest&&!publicationView(JSON.parse(version.manifest)).rooms.some(r=>r.id===room))fail(404,'Viewpoint is excluded.');
  const photos=JSON.parse(version.photos);
  if (!Object.hasOwn(photos,room)) fail(404,'Photo not found.');
  const value=await env.PHOTOS.get(photos[room],{type:'stream',cacheTtl:30});
  if (!value) return output({error:'Photo is still preparing. Retry shortly.'},503,{'Retry-After':'30'});
  return new Response(value,{headers:{...headers,'Content-Type':'image/jpeg'}});
}
