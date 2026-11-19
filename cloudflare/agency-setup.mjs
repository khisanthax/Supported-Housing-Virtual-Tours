import {createHash,timingSafeEqual} from 'node:crypto';
import {normalizeUsername,usernamePattern,validNewStaffPassword} from './staff-password.mjs';
import {release} from './release.mjs';
import {maintenanceReady} from './maintenance.mjs';

export const setupDigest=token=>createHash('sha256').update(token).digest('hex');
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const safeHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const response=(value,status=200)=>Response.json(value,{status,headers:safeHeaders});

// Ticket creation has no HTTP route. Only the authorized deployment process seeds
// a short-lived verifier into this installation's D1 database.
export async function agencySetup(request,env,derivePassword){
 if(env.AGENCY_BROWSER_SETUP!=='1'||env.INSTALLATION_MODE!=='agency')return response({error:'Setup is unavailable.'},404);
 const url=new URL(request.url);
 if(url.origin!==env.APP_ORIGIN||url.protocol!=='https:')return response({error:'Invalid installation.'},403);
 if(!/^[a-f0-9]{64}$/.test(env.GUEST_CODE_KEY??'')||typeof env.PHOTOS?.get!=='function'||typeof env.STAFF_LOGIN?.getByName!=='function')return response({error:'Installation security or storage preparation is incomplete. Return to the deployment wizard.'},503);
 const db=env.DB.withSession('first-primary'),query=(sql,...args)=>db.prepare(sql).bind(...args);
 if(request.method!=='POST'||request.headers.get('Origin')!==url.origin||request.headers.get('Content-Type')!=='application/json')return response({error:'Use the setup form on this website.'},403);
 let input;
 try{
  const reader=request.body?.getReader();let size=0;const chunks=[];
  if(!reader)throw Error();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return response({error:'Setup form is too large.'},413);}chunks.push(value);}
  input=JSON.parse(await new Blob(chunks).text());
 }catch{return response({error:'Invalid setup form.'},400);}
 const now=Date.now();
 const record=await query('SELECT * FROM agency_setup WHERE id=1').first();
 const accounts=await query('SELECT COUNT(*) n FROM staff_accounts').first();
 if(accounts.n||record?.completed)return response({error:'Setup is already complete. Sign in with your existing Administrator account.',complete:true},409);
 if(!record||record.installation!==env.INSTALLATION_ID||record.expires<=now)return response({error:'Setup authorization has expired or is invalid. Return to the deployment wizard and reconnect to Cloudflare.'},403);
 // Bounded global budget, before expensive password work. Ingress checks Origin;
 // no client-controlled forwarding header is used as an authorization input.
 const allowed=await query('INSERT INTO attempts VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<8 RETURNING count','agency-setup:'+Math.floor(now/60000)).first();
 if(!allowed)return response({error:'Too many setup attempts. Wait a minute before retrying.'},429);
 const digest=typeof input?.ticket==='string'&&tokenPattern.test(input.ticket)?setupDigest(input.ticket):'0'.repeat(64);
 const expected=/^[a-f0-9]{64}$/.test(record?.token_digest??'')?record.token_digest:'f'.repeat(64);
 if(!record||record.installation!==env.INSTALLATION_ID||record.expires<=now||!timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(expected,'hex')))return response({error:'Setup authorization has expired or is invalid. Return to the deployment wizard and reconnect to Cloudflare.'},403);
 const username=normalizeUsername(input.username);
 if(!usernamePattern.test(username)||!validNewStaffPassword(input.password))return response({error:'Choose a username of 3–64 lowercase letters, numbers, dots, dashes or underscores, and a password of at least 15 characters (maximum 256 UTF-8 bytes).'},400);
 const schema=await query('SELECT COUNT(*) n,MIN(version) minimum,MAX(version) maximum FROM app_migrations').first();
 if(schema?.n!==release.schema||schema.minimum!==1||schema.maximum!==release.schema)return response({error:'Database preparation is incomplete. Return to the deployment wizard and retry.'},503);
 if(!await maintenanceReady(db))return response({error:'Installation recovery preparation is incomplete. Return to the deployment wizard and retry.'},503);
 const {verifier}=await derivePassword(input.password);
 input.password='';input.ticket='';
 // One D1 statement checks the ticket, deadline and empty account table again.
 // The trigger closes bootstrap in the same transaction as account creation.
 const created=await query(`INSERT INTO staff_accounts(username,password_verifier,role)
 SELECT ?,?,'administrator' WHERE NOT EXISTS(SELECT 1 FROM staff_accounts)
 AND EXISTS(SELECT 1 FROM agency_setup WHERE id=1 AND installation=? AND token_digest=? AND expires>? AND completed IS NULL)
 RETURNING username`,username,verifier,env.INSTALLATION_ID,digest,Date.now()).first();
 if(!created)return response({error:'Setup changed while you were submitting. Sign in if setup has completed, or reconnect to the deployment wizard.',complete:!!(await query('SELECT COUNT(*) n FROM staff_accounts').first()).n},409);
 return response({ok:true,version:release.version,website:url.origin,username});
}
