import {pipeline} from 'node:stream/promises';
import {createServer} from 'node:http';
import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {readFile,mkdir,rmdir,open} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudflareApi,provision,wranglerRunner,identifier,installationName,SetupError} from './cloudflare.mjs';
import {readUpdateRequests,runInstallationUpdate,installationQueries} from './update-service.mjs';

const random=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('hex');
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
export function createCompanion({origin,clientId,clientSecret,scopes,stateDirectory,build,verifiedFreePlanIds=[],fetcher=fetch,deploy=provision,apiFactory=cloudflareApi,runnerFactory=wranglerRunner,releaseBundle=null,updater=runInstallationUpdate,now=Date.now}){
 const base=new URL(origin),local=['127.0.0.1','localhost'].includes(base.hostname);
 if((base.protocol!=='https:'&&!local)||base.origin!==origin||!clientId||!clientSecret||!scopes||!build||!stateDirectory)throw Error('Configure the exact HTTPS publisher origin, OAuth client, verified scopes/build and protected state directory.');
 const sessions=new Map(),locks=new Set(),starts=new Map();
 const callback=origin+'/oauth/callback';
 const cookieName=local?'lt360_setup':'__Host-lt360_setup';
 const cookie=(token,maxAge=900)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local?'':'; Secure'}`;
 const oauthHeaders={'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(encodeURIComponent(clientId)+':'+encodeURIComponent(clientSecret)).toString('base64')};
 const revoke=async s=>{
  const token=s.accessToken;delete s.accessToken;
  if(!token)return true;
  try{const r=await fetcher('https://dash.cloudflare.com/oauth2/revoke',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:oauthHeaders,body:new URLSearchParams({token,token_type_hint:'access_token'})});return r.ok;}catch{return false;}
 };
 const expire=()=>{for(const [id,s] of sessions)if(s.deadline<=now()&&!s.running){sessions.delete(id);void revoke(s);}for(const [ip,v] of starts)if(v.until<=now())starts.delete(ip);};
 const timer=setInterval(expire,30000);timer.unref();
 const send=(res,status,value,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json',...extra});res.end(JSON.stringify(value));};
 const redirect=(res,path,extra={})=>{res.writeHead(303,{...headers,Location:path,...extra});res.end();};
 const read=async (req,form=false)=>{let n=0,body='';for await(const part of req){n+=part.length;if(n>2048)throw new SetupError('The form is too large.');body+=part;}return form?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body);};
 const server=createServer(async(req,res)=>{
  try{
   expire();const url=new URL(req.url,origin);
   if(url.origin!==origin)return send(res,400,{error:'Invalid website.'});
   const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
   const s=token&&sessions.get(digest(token));
   if(req.method==='GET'&&url.pathname==='/healthz')return send(res,200,{ready:true});
   if(req.method==='GET'&&url.pathname==='/releases/latest')return releaseBundle?send(res,200,{manifest:releaseBundle.bytes.toString('base64'),signature:releaseBundle.signature.toString('base64')}):send(res,404,{error:'No verified release is configured.'});
   if(req.method==='GET'&&['/','/wizard.js','/wizard.css'].includes(url.pathname)){
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const content=await readFile(new URL('./'+name,import.meta.url));
    // Native same-origin form navigation needs an Origin header. OAuth callbacks
    // and credential-bearing responses keep their stricter no-referrer policy.
    res.writeHead(200,{...headers,...(name==='index.html'?{'Referrer-Policy':'same-origin'}:{}),'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});res.end(content);return;
   }
   if(req.method==='GET'&&url.pathname==='/oauth/start'){
    const ip=req.socket.remoteAddress??'unknown',limit=starts.get(ip)??{count:0,until:now()+60000};
    if(limit.until<=now()){limit.count=0;limit.until=now()+60000;}limit.count++;starts.set(ip,limit);
    if(limit.count>8||sessions.size>=1000)return send(res,429,{error:'Please wait a minute before reconnecting.'});
    if(s?.running)return send(res,409,{error:'Your deployment is still running. Return to the setup page.'});
    if(s){sessions.delete(digest(token));await revoke(s);}
    const session=random(),state=random(),verifier=random();
    sessions.set(digest(session),{state,verifier,deadline:now()+10*60000});
    const auth=new URL('https://dash.cloudflare.com/oauth2/auth');
    auth.search=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:scopes,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return redirect(res,auth.href,{'Set-Cookie':cookie(session)});
   }
   if(req.method==='GET'&&url.pathname==='/oauth/callback'){
    if(!s||!s.state||s.deadline<=now()){res.writeHead(403,{...headers,'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><html lang="en"><title>Reconnect to Cloudflare</title><main><h1>Sign-in expired</h1><p>Your installation is preserved.</p><a href="/oauth/start">Reconnect to Cloudflare</a></main></html>');}
    if(url.searchParams.get('state')!==s.state)return send(res,403,{error:'Sign-in could not be verified. Return to setup and reconnect.'});
    delete s.state;
    const code=url.searchParams.get('code');if(!code||code.length>4096){delete s.verifier;return redirect(res,'/?authorization=failed');}
    const r=await fetcher('https://dash.cloudflare.com/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:oauthHeaders,body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:callback,code,code_verifier:s.verifier})});
    delete s.verifier;
    const data=await r.json();
    // The client is registered without refresh_token/offline_access. If the
    // provider still sends a refresh token it is neither used nor retained.
    if(!r.ok||typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<=0)return redirect(res,'/?authorization=failed');
    s.accessToken=data.access_token;s.deadline=now()+Math.min(data.expires_in*1000,10*60000);
    try{s.accounts=await apiFactory(s.accessToken,fetcher)('/accounts?per_page=50');}catch{await revoke(s);return redirect(res,'/?authorization=failed');}
    // A rotated cookie defeats session fixation and removes the callback state.
    const next=random();sessions.delete(digest(token));sessions.set(digest(next),s);
    return redirect(res,'/',{'Set-Cookie':cookie(next)});
   }
   if(url.pathname==='/api/state'&&req.method==='GET')return send(res,200,{connected:!!s?.accessToken,sessionExpired:!!token&&!s,accounts:s?.accounts?.map(a=>({id:a.id,name:a.name}))??[],running:!!s?.running,progress:s?.progress??'',error:s?.error??'',result:s?.result??null,updatesConfigured:!!releaseBundle,freeVerificationAvailable:verifiedFreePlanIds.length>0});
   if(req.method==='POST'&&url.pathname.startsWith('/api/')){
    const downloadForm=url.pathname==='/api/updates/backup' && req.headers['content-type']?.split(';')[0]==='application/x-www-form-urlencoded';
    if(req.headers.origin!==origin||(!downloadForm && req.headers['content-type']!=='application/json'))return send(res,403,{error:'Use the deployment form on this website.'});
    if(!s||s.deadline<=now())return send(res,401,{error:'Reconnect to Cloudflare to continue. Your installation is preserved.'});
    if(url.pathname.startsWith('/api/updates/')){
     if(!s.accessToken)return send(res,401,{error:'Reconnect to Cloudflare to inspect or update your installation.'});
     const input=await read(req,downloadForm),{account,name,requestId}=input;
     if(!identifier.test(account)||!s.accounts?.some(a=>a.id===account)||!installationName.test(name))return send(res,403,{error:'Select an authorized account and original installation name.'});
     const directory=join(stateDirectory,account,name),api=apiFactory(s.accessToken,fetcher);
     if(url.pathname==='/api/updates/list'){
      const found=await readUpdateRequests({directory,api});if(found.state.account!==account||found.state.name!==name)return send(res,403,{error:'Installation identity mismatch.'});return send(res,200,{requests:found.requests});
     }
     if(!/^[a-f0-9]{32}$/.test(requestId??''))return send(res,400,{error:'Select an update request.'});
     if(url.pathname==='/api/updates/backup'){
      const state=JSON.parse(await readFile(join(directory,'installation.json'),'utf8'));if(state.account!==account||state.name!==name)return send(res,403,{error:'Installation identity mismatch.'});
      const query=installationQueries(api,state),row=(await query('SELECT backup_digest,backup_file FROM maintenance_requests WHERE id=? AND installation=?',[requestId,state.installation]))[0];
      if(!row?.backup_digest||!/^snapshot-[a-f0-9]{16}\.lt360backup$/.test(row.backup_file??''))return send(res,404,{error:'A verified encrypted backup is not available.'});
      const file=await open(join(directory,'updates',requestId,row.backup_file),'r');
      try{
       const hash=createHash('sha256');
       for await(const chunk of file.createReadStream({start:0,autoClose:false})){
        if(res.destroyed)return;
        hash.update(chunk);
       }
       if(hash.digest('hex')!==row.backup_digest)return send(res,409,{error:'Backup integrity could not be verified. Ask an authorized infrastructure operator to review it.'});
       if(!s.accessToken||s.deadline<=now())return send(res,401,{error:'Reconnect to Cloudflare to download this backup.'});
       const size=(await file.stat()).size;
       res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Length':size,'Content-Disposition':'attachment; filename="LevelTwo360-encrypted-installation.lt360backup"','X-Backup-SHA256':row.backup_digest});
       const stream=file.createReadStream({start:0,autoClose:false});
       await pipeline(stream,res);return;
      }catch(error){if(res.headersSent||res.destroyed){res.destroy();return;}throw error;}
      finally{await file.close();}

     }
     if(url.pathname==='/api/updates/start'){
      // A stranded terminal request can be reconciled from its verified deployment and journal even if the catalog changed.
      const key=account+':'+name;if(s.running||locks.has(key))return send(res,409,{error:'This installation already has a running job.'});locks.add(key);s.running=true;delete s.result;delete s.error;
      s.job=(async()=>{try{s.result=await updater({account,name,directory,requestId,api,run:runnerFactory({token:s.accessToken,account}),releaseBundle,verifiedFreePlanIds,fetcher,progress:text=>s.progress=text});}catch(e){s.error=e instanceof SetupError?e.message:'The update stopped safely. Inspect its history and reconnect to the same installation to recover.';}finally{s.revoked=await revoke(s);if(s.result)s.result.revoked=s.revoked;s.running=false;locks.delete(key);s.deadline=now()+10*60000;}})();
      return send(res,202,{started:true});
     }
     return send(res,404,{error:'Not found.'});
    }
    if(url.pathname==='/api/disconnect'){
     if(s.running)return send(res,409,{error:'Wait for the current deployment step to finish.'});
     const revoked=await revoke(s);sessions.delete(digest(token));return send(res,200,{revoked},{'Set-Cookie':cookie('',0)});
    }
    if(url.pathname==='/api/deploy'){
     if(!s.accessToken)return send(res,401,{error:'Reconnect to Cloudflare to authorize deployment.'});
     const input=await read(req),{account,name}=input;
     if(!identifier.test(account)||!s.accounts?.some(a=>a.id===account)||!installationName.test(name)||input.freeConfirmed!==true)return send(res,400,{error:'Select your agency account, installation name and confirm Workers Free.'});
     const key=account+':'+name;
     if(s.running||locks.has(key))return send(res,409,{error:'This installation is already being prepared. Wait for it to finish.'});
     locks.add(key);s.running=true;delete s.result;delete s.error;
     // Start only after returning a bounded response. Polling/refresh shares this
     // job; it does not issue a second deployment. No user values enter a shell.
     s.job=(async()=>{
      try{s.result=await deploy({account,name,directory:join(stateDirectory,account,name),api:apiFactory(s.accessToken,fetcher),run:runnerFactory({token:s.accessToken,account}),verifiedFreePlanIds,build,companionOrigin:origin,updatePublicKey:releaseBundle?.publicKey,progress:value=>s.progress=value});}
      catch(e){s.error=e instanceof SetupError?e.message:'Setup stopped safely. Reconnect and retry the same installation. Existing resources and accounts are preserved.';}
      finally{s.revoked=await revoke(s);if(s.result)s.result.revoked=s.revoked;locks.delete(key);s.running=false;s.deadline=now()+10*60000;}
     })();
     return send(res,202,{started:true});
    }
   }
   return send(res,404,{error:'Not found.'});
  }catch{return send(res,400,{error:'The request could not be completed. Reconnect and retry the same installation.'});}
 });
 server.whenIdle=()=>Promise.allSettled([...sessions.values()].map(s=>s.job).filter(Boolean));
 server.on('close',()=>{clearInterval(timer);void server.whenIdle().then(async()=>{await Promise.allSettled([...sessions.values()].map(s=>revoke(s)));sessions.clear();});});
 return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const env=process.env;
 if(env.AGENCY_OAUTH_CLIENT_SECRET_FILE)env.AGENCY_OAUTH_CLIENT_SECRET=(await readFile(env.AGENCY_OAUTH_CLIENT_SECRET_FILE,'utf8')).trim();
 if(!isAbsolute(env.AGENCY_STATE_DIRECTORY??'')||!/^[a-f0-9]{40}$/.test(env.AGENCY_VERIFIED_BUILD??''))throw Error('Use an absolute protected state directory outside the source checkout and the full tested commit hash.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const state=resolve(env.AGENCY_STATE_DIRECTORY);
 if(state.toLowerCase().startsWith(resolve(root).toLowerCase()))throw Error('Installation state must stay outside the source checkout.');
 await mkdir(state,{recursive:true,mode:0o700});
 const lease=join(state,'companion-service.lock');
 try{await mkdir(lease,{mode:0o700});}catch{throw Error('Another companion instance may own this state directory. After a crash, an operator must verify no instance is running before removing the empty companion-service.lock directory.');}
 let releaseBundle=null;
 if(env.AGENCY_RELEASE_DIRECTORY&&env.AGENCY_UPDATE_PUBLIC_KEY_FILE)releaseBundle={bytes:await readFile(join(env.AGENCY_RELEASE_DIRECTORY,'manifest.json')),signature:Buffer.from((await readFile(join(env.AGENCY_RELEASE_DIRECTORY,'release.sig'),'utf8')).trim(),'base64'),artifact:await readFile(join(env.AGENCY_RELEASE_DIRECTORY,'artifact.lt360release')),publicKey:await readFile(env.AGENCY_UPDATE_PUBLIC_KEY_FILE,'utf8')};
 if(releaseBundle){const key=createPublicKey(releaseBundle.publicKey);if(key.asymmetricKeyType!=='ed25519'||!verify(null,releaseBundle.bytes,key,releaseBundle.signature)||createHash('sha256').update(releaseBundle.artifact).digest('hex')!==JSON.parse(releaseBundle.bytes).artifactSha256)throw Error('Configured release verification failed. The companion will not serve this catalog or accept update jobs.');}
 const server=createCompanion({origin:env.AGENCY_ORIGIN,clientId:env.AGENCY_OAUTH_CLIENT_ID,clientSecret:env.AGENCY_OAUTH_CLIENT_SECRET,scopes:env.AGENCY_OAUTH_SCOPES,stateDirectory:env.AGENCY_STATE_DIRECTORY,build:env.AGENCY_VERIFIED_BUILD,verifiedFreePlanIds:(env.AGENCY_VERIFIED_FREE_PLAN_IDS??'').split(',').filter(Boolean),releaseBundle});
 server.on('close',()=>void server.whenIdle().then(()=>rmdir(lease)));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();});
 const host=env.AGENCY_BIND_HOST??'127.0.0.1';if(host!=='127.0.0.1'&&!(host==='0.0.0.0'&&env.AGENCY_CONTAINER_PROXY==='1'))throw Error('Public plaintext listening is disabled. Container mode requires an approved HTTPS proxy and loopback-only host port mapping.');
 server.listen(Number(env.PORT??4198),host,()=>console.log('LevelTwo360 agency companion is listening behind its configured HTTPS proxy.'));
}
