import {createHash, randomBytes} from 'node:crypto';
import {authorize} from './access-policy.mjs';

export const supportHours = [2,24,48,72];
const allowed = ['diagnostics','settings','apartments','reset-diagnostics'];
const hour = 3600000;
const keyLifetime = 24 * hour;
const databaseNow = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
const credential = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9]{32}$/;
const cookieName = '__Host-lt360-support';
const noStore = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const error = (message,status) => Response.json({error:message},{status,headers:noStore});
const response = (data,status=200,extra={}) => Response.json(data,{status,headers:{...noStore,...extra}});
const validList = (data,limit,accept) => Array.isArray(data) && data.length <= limit &&
  new Set(data).size === data.length && data.every(accept);

export function supportEnabled(env) {
  return env.INSTALLATION_MODE==='agency' && env.SUPPORT_ENABLED==='1' && env.TOUR_UAC==='1';
}

function hubClient(env) {
  if (!credential.test(env.SUPPORT_HUB_TOKEN??'')) return null;
  let url;
  try {url=new URL(env.SUPPORT_HUB_ORIGIN);} catch {return null;}
  if (url.protocol!=='https:' || url.origin!==env.SUPPORT_HUB_ORIGIN) return null;
  return async (path,body)=>{
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),4000);
    try {
      const reply=await fetch(url.origin+path,{
        method:body===undefined?'GET':'POST',redirect:'manual',signal:abort.signal,
        headers:{Authorization:'Bearer '+env.SUPPORT_HUB_TOKEN,'Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body)
      });
      if(!reply.ok)throw Error('The Help Hub rejected this request.');
      return await reply.json();
    } finally {clearTimeout(timer);}
  };
}

function view(row) {
  return {
    id:row.id, creator:row.creator, created:row.created, redeemBy:row.redeem_by,
    permissions:JSON.parse(row.permissions), apartments:JSON.parse(row.apartments), hours:row.duration,
    activated:row.activated, expires:row.expires, requested:row.requested, decision:row.decision,
    status:row.revoked?'revoked':row.ended_by?'ended':row.ended?'expired':row.activated?'active':'pending'
  };
}

export async function serveSupport(request,env,db,{administrator,readJson,settings,readApartment}) {
  const url = new URL(request.url);
  const {pathname:path} = url;
  const prefix = '/api/support/';
  const admin = path.startsWith(prefix+'admin');
  if (!supportEnabled(env) || url.origin!==env.APP_ORIGIN) return error('Support is unavailable.',404);
  if (request.method!=='GET' && request.headers.get('Origin')!==url.origin) return error('Open the support page on this installation.',403);
  if (admin && !administrator) return error('Administrator access required.',403);
  const installation = env.INSTALLATION_ID;
  const query = (sql,...args) => db.prepare(sql).bind(...args);
  const one = (sql,...args) => query(sql,...args).first();
  const list = async (sql,...args) => (await query(sql,...args).all()).results;
  const run = (sql,...args) => query(sql,...args).run();
  const now = Date.now();
  const audit = (id,event,actor,detail=null) => run(
    'INSERT INTO support_audit(grant_id,installation,event,actor,at,detail) VALUES(?,?,?,?,?,?)',
    id,installation,event,actor,Date.now(),detail===null?null:JSON.stringify(detail)
  );
  const closeExpired = () => run(`UPDATE support_grants SET ended=coalesce(expires,redeem_by)
    WHERE installation=? AND ended IS NULL AND revoked IS NULL AND coalesce(expires,redeem_by)<=${databaseNow}`,installation);

  if (request.method==='POST' && path===prefix+'activate') {
    const bucket = Math.floor(now/60000);
    const limit = await one(`INSERT INTO support_rate(installation,window,attempts) VALUES(?,?,1)
      ON CONFLICT(installation) DO UPDATE SET window=excluded.window,
      attempts=CASE WHEN support_rate.window=excluded.window THEN support_rate.attempts+1 ELSE 1 END
      WHERE support_rate.window<>excluded.window OR support_rate.attempts<12 RETURNING attempts`,installation,bucket);
    if (!limit) return error('Too many attempts. Try again in a minute.',429);
    const {key,grantId} = await readJson(request,4096) ?? {};
    if (grantId!==undefined && (typeof grantId!=='string' || !idPattern.test(grantId))) return error('Invalid support request.',400);
    const session = secret();
    const row = typeof key==='string' && credential.test(key) && await one(`UPDATE support_grants
      SET activated=${databaseNow}, expires=${databaseNow}+duration*?, session_digest=?
      WHERE installation=? AND invite_digest=? AND activated IS NULL AND revoked IS NULL AND ended IS NULL
      AND (? IS NULL OR id=?) AND redeem_by>${databaseNow} RETURNING *`,hour,digest(session),installation,digest(key),grantId??null,grantId??null);
    if (!row) {
      await audit(null,'activation_rejected','support');
      return error('The activation key is invalid, expired or already used.',403);
    }
    return response({...view(row),serverNow:Date.now()},200,{'Set-Cookie':cookieName+'='+session+'; Path=/; HttpOnly; Secure; SameSite=Strict'});
  }

  if (admin) {
    const hub = hubClient(env);
    await closeExpired();
    if (request.method==='GET' && path===prefix+'admin') {
      const grants = await list('SELECT * FROM support_grants WHERE installation=? ORDER BY created DESC LIMIT 100',installation);
      const events = await list('SELECT seq,grant_id,event,actor,at,detail FROM support_audit WHERE installation=? ORDER BY seq DESC LIMIT 100',installation);
      const apartments = await list(`SELECT v.apartment id,v.title FROM versions v WHERE v.seq=
        (SELECT max(seq) FROM versions WHERE apartment=v.apartment)
        AND NOT EXISTS(SELECT 1 FROM apartment_visibility WHERE apartment=v.apartment AND state IN (2,3)) ORDER BY v.title`);
      return response({grants:grants.map(view),events,apartments,hubAvailable:Boolean(hub),serverNow:Date.now()});
    }
    if (request.method==='GET' && path===prefix+'admin/tickets') {
      if (!hub) return error('The Help Hub is not configured.',404);
      try {
        return response(await hub('/agency/tickets'));
      } catch {}
      return error('The Help Hub is temporarily unavailable.',503);
    }
    const input = await readJson(request,4096) ?? {};
    if (request.method==='POST' && path===prefix+'admin') {
      const {hours,permissions,apartments} = input;
      if (!supportHours.includes(hours) || !validList(permissions,allowed.length,key=>allowed.includes(key)) || !permissions.length ||
          !validList(apartments,25,id=>typeof id==='string' && idPattern.test(id)) ||
          permissions.includes('apartments')!==Boolean(apartments.length)) return error('Choose a duration and at least one permission. Apartment access requires selected apartments.',400);
      const issue = typeof input.issue==='string'?input.issue.trim():null;
      if (input.issue!==undefined && (!hub || !issue || issue.length>500)) return error('Enter an issue description of 1 to 500 characters for the Help Hub.',400);
      if (apartments.length) {
        const exists = await one(`SELECT count(DISTINCT apartment) n FROM versions
          WHERE apartment IN (SELECT value FROM json_each(?)) AND NOT EXISTS(
          SELECT 1 FROM apartment_visibility WHERE apartment=versions.apartment AND state IN (2,3))`,JSON.stringify(apartments));
        if (exists?.n!==apartments.length) return error('An apartment is unavailable. Refresh the list and try again.',400);
      }
      const key = secret();
      const row = await one(`INSERT INTO support_grants
        (id,installation,creator,invite_digest,permissions,apartments,duration,created,redeem_by)
        VALUES(?,?,?,?,?,?,?,?,?) RETURNING *`,randomBytes(16).toString('hex'),installation,administrator.username,
        digest(key),JSON.stringify(permissions),JSON.stringify(apartments),hours,now,now+keyLifetime);
      let ticket,hubError;
      if (issue) {
        try {
          ({ticket}=await hub('/agency/tickets',{installation,grant:row.id,key,issue,hours,deadline:row.redeem_by}));
        } catch {
          hubError='The Hub did not confirm receipt. Check Hub tickets before retrying, or use the key below.';
        }
      }
      return response({key,grant:view(row),ticket,hubError},201);
    }
    const action = /^\/api\/support\/admin\/([a-f0-9]{32})\/(revoke|extension)$/.exec(path);
    if (request.method!=='POST' || !action) return error('Support action not found.',404);
    const [,id,operation] = action;
    if (operation==='revoke') {
      const changed = await one(`UPDATE support_grants SET revoked=${databaseNow},decider=?
        WHERE id=? AND installation=? AND revoked IS NULL AND ended IS NULL RETURNING id`,administrator.username,id,installation);
      return changed?response({ok:true}):error('Support is already closed.',409);
    }
    const {approve,hours,requested} = input;
    if (typeof approve!=='boolean' || (approve&&!supportHours.includes(hours)) ||
        !Number.isSafeInteger(requested)) return error('Choose a request and a valid decision.',400);
    const row = await one(`UPDATE support_grants SET requested=NULL, expires=expires+?, decided=${databaseNow},
      decision=?, decision_hours=?, decider=?
      WHERE id=? AND installation=? AND requested=? AND revoked IS NULL AND ended IS NULL
      AND expires>${databaseNow} RETURNING *`,approve?hours*hour:0,approve?'extension_approved':'extension_denied',
      approve?hours:0,administrator.username,id,installation,requested);
    return row?response(view(row)):error('The request is stale or support has ended. A new key is required after expiration.',409);
  }

  const value = request.headers.get('Cookie')?.split(/;\s*/).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!value || !credential.test(value)) return error('Activate support with a valid key.',401);
  const sessionHash = digest(value);
  const row = await one(`SELECT * FROM support_grants WHERE installation=? AND session_digest=?
    AND revoked IS NULL AND ended IS NULL AND expires>${databaseNow}`,installation,sessionHash);
  if (!row) {
    await closeExpired();
    return error('Support access has ended.',401);
  }
  const grant = view(row);
  if (request.method==='GET' && path===prefix+'session') return response({...grant,serverNow:Date.now()});
  if (request.method==='POST' && path===prefix+'end') {
    const changed = await one(`UPDATE support_grants SET ended=${databaseNow},ended_by='support',session_digest=NULL
      WHERE id=? AND installation=? AND session_digest=? AND revoked IS NULL AND ended IS NULL
      AND expires>${databaseNow} RETURNING id`,row.id,installation,sessionHash);
    return changed?response({ok:true},200,{'Set-Cookie':cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}):error('Support access has ended.',401);
  }
  if (request.method==='POST' && path===prefix+'request-time') {
    const changed = await one(`UPDATE support_grants SET requested=${databaseNow},decision=NULL
      WHERE id=? AND installation=? AND session_digest=? AND revoked IS NULL AND ended IS NULL
      AND requested IS NULL AND expires>${databaseNow} RETURNING *`,row.id,installation,sessionHash);
    return changed?response(view(changed)):error('A request is already waiting or support has ended.',409);
  }
  const apartment = /^\/api\/support\/apartments\/([a-f0-9]{32})(?:\/images\/([a-z0-9-]{1,64}))?$/.exec(path);
  const principal = {role:'staff',scope:{mode:'selected',apartments:grant.apartments}};
  if (request.method==='GET' && apartment && grant.permissions.includes('apartments') &&
      authorize(principal,'apartment.view',{id:apartment[1]}).allowed) {
    const result = await readApartment(apartment[1],apartment[2]);
    await audit(row.id,result.ok?'apartment_viewed':'access_denied','support',{apartment:apartment[1]});
    return result;
  }
  const category = path===prefix+'diagnostics'?'diagnostics':path===prefix+'settings'?'settings':null;
  if (request.method==='GET' && category && grant.permissions.includes(category)) {
    const details = category==='settings'?settings:{
      ...await one('SELECT max(version) schema FROM app_migrations'),
      ...await one('SELECT level,days,max_rows FROM diagnostic_settings WHERE id=1'),
      counts:await list("SELECT severity,count(*) count FROM diagnostic_operations WHERE created>=? AND severity IN ('error','warning','info') GROUP BY severity",now-86400000),
      recentFailures:await list(`SELECT created,severity,code FROM diagnostic_operations WHERE created>=?
        AND severity IN ('error','warning') AND code NOT GLOB '*[^A-Z0-9_]*' AND length(code)<=50
        AND apartment IS NULL ORDER BY created DESC LIMIT 20`,now-86400000)
    };
    await audit(row.id,category+'_viewed','support');
    return response(details);
  }
  if (request.method==='POST' && path===prefix+'reset-diagnostics' && grant.permissions.includes('reset-diagnostics')) {
    const statements = await db.batch([
      query(`UPDATE diagnostic_settings SET level='normal',days=7,max_rows=2000 WHERE id=1 AND EXISTS(
        SELECT 1 FROM support_grants WHERE id=? AND installation=? AND session_digest=? AND revoked IS NULL
        AND ended IS NULL AND expires>${databaseNow}) RETURNING id`,row.id,installation,sessionHash),
      query(`INSERT INTO support_audit(grant_id,installation,event,actor,at) SELECT ?,?,'diagnostics_reset','support',${databaseNow} WHERE changes()=1`,row.id,installation)
    ]);
    return statements[0].results.length?response({ok:true}):error('Support access has ended.',401);
  }
  await audit(row.id,'access_denied','support');
  return error('This operation is outside your approved support access.',403);
}
