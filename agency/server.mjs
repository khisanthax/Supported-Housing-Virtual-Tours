import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,mkdir,rmdir} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudflareApi,provision,wranglerRunner,identifier,installationName,SetupError} from './cloudflare.mjs';

const random=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('hex');
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
export function createCompanion({origin,clientId,clientSecret,scopes,stateDirectory,build,verifiedFreePlanIds=[],fetcher=fetch,deploy=provision,apiFactory=cloudflareApi,runnerFactory=wranglerRunner,now=Date.now}){
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
 const read=async req=>{let n=0,body='';for await(const part of req){n+=part.length;if(n>2048)throw new SetupError('The form is too large.');body+=part;}return JSON.parse(body);};
 const server=createServer(async(req,res)=>{
  try{
   expire();const url=new URL(req.url,origin);
   if(url.origin!==origin)return send(res,400,{error:'Invalid website.'});
   const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
   const s=token&&sessions.get(digest(token));
   if(req.method==='GET'&&['/','/wizard.js','/wizard.css'].includes(url.pathname)){
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const content=await readFile(new URL('./'+name,import.meta.url));
    res.writeHead(200,{...headers,'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});res.end(content);return;
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
    if(!s||!s.state||s.deadline<=now()||url.searchParams.get('state')!==s.state)return send(res,403,{error:'This Cloudflare sign-in has expired or does not belong to this browser. Return to setup and reconnect.'});
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
   if(url.pathname==='/api/state'&&req.method==='GET')return send(res,200,{connected:!!s?.accessToken,accounts:s?.accounts?.map(a=>({id:a.id,name:a.name}))??[],running:!!s?.running,progress:s?.progress??'',error:s?.error??'',result:s?.result??null,freeVerificationAvailable:verifiedFreePlanIds.length>0});
   if(req.method==='POST'&&url.pathname.startsWith('/api/')){
    if(req.headers.origin!==origin||req.headers['content-type']!=='application/json')return send(res,403,{error:'Use the deployment form on this website.'});
    if(!s||s.deadline<=now())return send(res,401,{error:'Reconnect to Cloudflare to continue. Your installation is preserved.'});
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
      try{s.result=await deploy({account,name,directory:join(stateDirectory,account,name),api:apiFactory(s.accessToken,fetcher),run:runnerFactory({token:s.accessToken,account}),verifiedFreePlanIds,build,progress:value=>s.progress=value});}
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
 if(!isAbsolute(env.AGENCY_STATE_DIRECTORY??'')||!/^[a-f0-9]{40}$/.test(env.AGENCY_VERIFIED_BUILD??''))throw Error('Use an absolute protected state directory outside the source checkout and the full tested commit hash.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const state=resolve(env.AGENCY_STATE_DIRECTORY);
 if(state.toLowerCase().startsWith(resolve(root).toLowerCase()))throw Error('Installation state must stay outside the source checkout.');
 await mkdir(state,{recursive:true,mode:0o700});
 const lease=join(state,'companion-service.lock');
 try{await mkdir(lease,{mode:0o700});}catch{throw Error('Another companion instance may own this state directory. After a crash, an operator must verify no instance is running before removing the empty companion-service.lock directory.');}
 const server=createCompanion({origin:env.AGENCY_ORIGIN,clientId:env.AGENCY_OAUTH_CLIENT_ID,clientSecret:env.AGENCY_OAUTH_CLIENT_SECRET,scopes:env.AGENCY_OAUTH_SCOPES,stateDirectory:env.AGENCY_STATE_DIRECTORY,build:env.AGENCY_VERIFIED_BUILD,verifiedFreePlanIds:(env.AGENCY_VERIFIED_FREE_PLAN_IDS??'').split(',').filter(Boolean)});
 server.on('close',()=>void server.whenIdle().then(()=>rmdir(lease)));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();});
 server.listen(Number(env.PORT??4198),'127.0.0.1',()=>console.log('LevelTwo360 agency companion is listening behind its configured HTTPS proxy.'));
}
