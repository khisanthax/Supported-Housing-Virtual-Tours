const enabled=typeof location!=='undefined'&&location.pathname.startsWith('/staff');
const originalFetch=globalThis.fetch?.bind(globalThis);
export const operationId=()=> 'VT-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
export function beginOperation(category='system',apartment=null,root=null){
 const operation=/^VT-[a-f0-9]{32}$/.test(root??'')?root:operationId(),events=[];let retry=false;
 return {operation,headers:()=>({'X-Operation-ID':operation,'X-Parent-Span':operation,'X-Operation-Retry':retry?'1':'0'}),retry(){retry=true;this.mark('retry');},mark(stage,values={}){if(events.length<24)events.push({stage,...Object.fromEntries(Object.entries(values).filter(([k,v])=>['duration','bytes','width','height','count','status'].includes(k)&&Number.isFinite(v)))});},async send(){if(!enabled||!events.length)return;const batch=events.splice(0);try{await originalFetch('/api/staff/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,category,apartment,events:batch})});}catch{}}};
}
function notice(text){if(!enabled||!document.querySelector('#catalog,#upload-screen,#uac-panel,#migration-list,#diagnostic-results'))return;let n=document.getElementById('operation-notice');if(!n){n=document.createElement('p');n.id='operation-notice';n.setAttribute('role','status');document.querySelector('main')?.prepend(n);}n.textContent=text;}
if(enabled&&originalFetch&&!globalThis.__tourTraceInstalled){
 globalThis.__tourTraceInstalled=true;
 globalThis.fetch=async(input,options)=>{
  const request=new Request(input instanceof Request?input:new URL(input,location.href),options),url=new URL(request.url);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/')||/\/api\/staff\/(events|diagnostics|version)/.test(url.pathname))return originalFetch(request);
  const id=request.headers.get('X-Operation-ID')??operationId();request.headers.set('X-Operation-ID',id);const start=performance.now();
  try{const r=await originalFetch(request);if(!r.ok)notice('Request failed ('+r.status+'). Reference: '+(r.headers.get('X-Operation-ID')??id)+'. Open Help or give this reference to an Administrator.');return r;}
  catch{notice('Connection failed. Reference: '+id+'. Reload to confirm whether any data was saved before retrying.');const t=beginOperation('system',null,id);t.mark('timeout',{status:503,duration:performance.now()-start});t.send();throw new Error('Connection interrupted. Reference: '+id);}
 };
 let failures=0;const report=()=>{if(failures++>=3)return;const t=beginOperation('system');t.mark('javascript',{status:500});t.send();notice('An unexpected browser error occurred. Reference: '+t.operation+'. Reload and report this reference if the problem persists.');};
 addEventListener('error',report);addEventListener('unhandledrejection',report);
 const footer=async()=>{if(document.querySelector('#username-field'))return;try{const r=await originalFetch('/api/staff/version');if(!r.ok)return;const v=await r.json(),n=document.createElement('p');n.className='app-version';n.textContent='Virtual Tours '+v.version+' · '+v.edition+' · '+v.build;const link=document.createElement('a');link.href='/staff/help';link.textContent=' · Help';n.append(link);document.querySelector('main')?.append(n);}catch{}};
 if(document.readyState==='loading')addEventListener('DOMContentLoaded',footer,{once:true});else footer();
}
