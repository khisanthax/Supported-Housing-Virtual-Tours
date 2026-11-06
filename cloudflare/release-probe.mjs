// Synthetic only. Credentials enter through the environment; results contain no credentials or invitations.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const origin=process.env.PILOT_PROBE_ORIGIN;
assert.ok(origin&&process.env.PILOT_PROBE_STAFF&&process.env.PILOT_RELEASE_OUTPUT);
const samples=[],tag='release-'+Date.now();let admin,draft,revision,accountNames=[],shares=[];
async function call(path,method='GET',body,cookie=admin,status=200,type='application/json'){
 if(process.env.PILOT_PROBE_DELAY_MS)await new Promise(r=>setTimeout(r,Number(process.env.PILOT_PROBE_DELAY_MS)));
 const started=performance.now(),r=await fetch(origin+path+'?probe='+tag,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':type},body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});
 const bytes=Buffer.from(await r.arrayBuffer());samples.push({path:path.replace(/[a-f0-9]{32}/g,':id'),method,status:r.status,ms:Math.round(performance.now()-started)});
 assert.equal(r.status,status,method+' '+path);return {data:type==='application/json'&&r.headers.get('Content-Type')?.includes('application/json')?JSON.parse(bytes):bytes,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(username,password,status=200){
 try{return await call('/api/staff/sign-in','POST',{username,password},null,status);}
 catch(error){if(error.actual!==429)throw error;
  // The real shared ingress bucket covers this probe and concurrent browser probes.
  // Respect it rather than rotating addresses or weakening the limiter.
  await new Promise(r=>setTimeout(r,61000-Date.now()%60000));
  return call('/api/staff/sign-in','POST',{username,password},null,status);
 }
}
try{
 admin=(await login(process.env.PILOT_PROBE_USERNAME,process.env.PILOT_PROBE_STAFF)).cookie;
 const catalog=(await call('/api/staff/dashboard')).data;
 const sources=catalog.apartments.filter(a=>a.published&&!a.archived&&/^Synthetic (Cedar|Maple|Willow)$/.test(a.title)).slice(0,2);assert.equal(sources.length,2);
 const data=(await call('/api/staff/drafts/'+sources[0].id)).data;
 const tour=structuredClone(data.tour);tour.title='Synthetic release acceptance '+Date.now();
 const created=(await call('/api/staff/apartments','POST',{tour,photos:data.photos},admin,201)).data;draft=created.id;revision=created.version;
 for(let i=0;i<12;i++){
  await Promise.all([call('/api/staff/drafts/'+draft),call('/api/staff/tours/'+draft+'/images/'+tour.startRoom)]);
  const saved=(await call('/api/staff/apartments','POST',{tour,photos:data.photos,replacement:draft,expectedVersion:revision},admin,201)).data;revision=saved.version;
 }
 const jpeg=await readFile(new URL('./sample-images/living.jpg',import.meta.url));
 for(let i=0;i<6;i++)await call('/api/staff/photos','POST',jpeg,admin,201,'image/jpeg');
 for(let i=0;i<6;i++){
  const share=(await call('/api/staff/shares','POST',{apartments:sources.map(a=>a.id),expires:Date.now()+300000,wordCount:3},admin,201)).data;shares.push(share.id);
  const guest=(await call('/api/guest/unlock','POST',{token:new URL(share.url).hash.slice(1),code:share.code.toUpperCase().replaceAll('-',' ')},null)).cookie;
  assert.equal((await call('/api/guest/catalog','GET',undefined,guest)).data.length,2);
  await call('/api/staff/drafts/'+draft,'GET',undefined,guest,401);
  await call('/api/guest/tours/'+draft+'/manifest','GET',undefined,guest,404);
  await call('/api/guest/tours/'+sources[0].id+'/images/'+tour.startRoom,'GET',undefined,guest);
  await call('/api/staff/shares/'+share.id,'DELETE');shares.pop();
  await call('/api/guest/catalog','GET',undefined,guest,401);
 }
 const secret=()=>randomBytes(24).toString('base64url');
 for(const role of ['administrator','editor']){
  const username='release-'+role+'-'+Date.now(),password=secret(),replacement=secret();accountNames.push(username);
  await call('/api/staff/accounts','POST',{username,password,role},admin,201);
  let session=(await login(username,password)).cookie;
  if(role==='editor')await Promise.all([login(username,password),login(username,password)]);
  await call('/api/staff/accounts','GET',undefined,session,role==='administrator'?200:403);
  await call('/api/staff/accounts','PATCH',{username,action:'reset',password:replacement});
  await call('/api/staff/dashboard','GET',undefined,session,401);
  await login(username,password,401);session=(await login(username,replacement)).cookie;
  await call('/api/staff/accounts','PATCH',{username,action:'disable'});
  await call('/api/staff/dashboard','GET',undefined,session,401);await login(username,replacement,401);
 }
 await call('/api/staff/accounts','POST',{username:'public',password:secret(),role:'administrator'},null,401);
 console.log('PASS repeated/two-concurrent reads, 12 stale-guarded saves, 6 JPEG uploads, 6 two-apartment invitations/revocations, Administrator/Editor enrollment, reset, disabled login/session denial and public registration denial.');
}finally{
 for(const id of shares)await call('/api/staff/shares/'+id,'DELETE').catch(()=>{});
 for(const username of accountNames)await call('/api/staff/accounts','PATCH',{username,action:'disable'}).catch(()=>{});
 if(draft)await call('/api/staff/apartments/'+draft,'PATCH',{action:'remove',expectedVersion:revision}).catch(()=>{});
 if(admin)await call('/api/staff/sign-out','POST',{}).catch(()=>{});
 await writeFile(process.env.PILOT_RELEASE_OUTPUT,JSON.stringify({tag,samples}));
 const times=samples.map(s=>s.ms).sort((a,b)=>a-b);console.log(JSON.stringify({requests:samples.length,latencyP95:times[Math.ceil(times.length*.95)-1],latencyMax:times.at(-1)}));
}
