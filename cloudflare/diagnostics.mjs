import {randomBytes} from 'node:crypto';
import {release} from './release.mjs';
export const tracePattern=/^VT-[a-f0-9]{32}$/;
export const newTrace=()=> 'VT-'+randomBytes(16).toString('hex');
const stages=new Set(['request','authorization','validation','storage','database','response','password-verification','open','room-create','viewpoint-change','doorway-place','doorway-move','doorway-delete','layout-change','save','backup-export','backup-import','migration-preview','migration-import','duplicate','upload-start','upload-request','upload-complete','retry','javascript','timeout']);
const categories=new Set(['authentication','apartment','upload','editor','sharing','backup','migration','system','performance']);
const actions={401:['AUTH_REQUIRED','known','Sign in again; confirm the account is enabled.'],403:['ACCESS_DENIED','known','Ask an Administrator to check action permissions and apartment scope.'],409:['REVISION_CONFLICT','known','Reload the current draft before retrying.'],429:['RATE_LIMIT','known','Wait for the retry period; repeated retries cannot bypass the limit.'],507:['STORAGE_LIMIT','known','Review storage usage and retain backups before safe cleanup.'],503:['SERVICE_UNAVAILABLE','unknown','Retry later. For a new panorama, allow KV propagation; this is not proof of the cause.'],400:['INVALID_INPUT','known','Check the selected package, JPEG limits and required fields.'],413:['INPUT_LIMIT','known','Reduce the file or batch size.'],415:['UNSUPPORTED_FORMAT','known','Choose the supported JPEG or tour package format.'],404:['NOT_AVAILABLE','unknown','Confirm the resource still exists and access is authorized.']};
export function classify(status,error){
 if(error?.diagnosticCode==='SCHEMA_UPGRADE_REQUIRED')return {code:'SCHEMA_UPGRADE_REQUIRED',cause:'known',message:'The installed migration sequence does not match this application.',suggestion:'An authorized operator must apply the ordered additive migrations before writing.'};
 if(['SESSION_EXPIRED','ACCOUNT_DISABLED'].includes(error?.diagnosticCode))return {code:error.diagnosticCode,cause:'known',message:'The current account/session cannot authorize the request.',suggestion:error.diagnosticCode==='ACCOUNT_DISABLED'?'Ask an Administrator to review account status.':'Sign in again; the session expired.'};
 if(error?.diagnosticCode==='DATABASE_FAILURE')return {code:'DATABASE_FAILURE',cause:'unknown',message:'A database operation failed.',suggestion:'Retry once; inspect database availability/quotas. No raw SQL or values are included.'};
 if(error?.diagnosticCode==='STORAGE_FAILURE')return {code:'STORAGE_FAILURE',cause:'unknown',message:'A private image storage operation failed.',suggestion:'Retry later and check storage availability/limits. A reservation may require later cleanup.'};
 const a=actions[status];return a?{code:a[0],cause:a[1],message:'Request ended with HTTP '+status+'.',suggestion:a[2]}:{code:status>=500?'UNEXPECTED_FAILURE':'OK',cause:status>=500?'unknown':'known',message:status>=500?'An unexpected runtime failure occurred.':'Operation completed.',suggestion:status>=500?'Use this operation ID and diagnostic report; the underlying cause is unverified.':'No troubleshooting required.'};
}
export function browserFamily(ua=''){const match=/(Edg|Firefox|Chrome|Version)\/(\d{1,3})/.exec(ua);return match?(match[1]==='Version'?'Safari':match[1])+' '+match[2]:'Other';}
export function createDiagnostic(request,env){
 const operation=tracePattern.test(request.headers.get('X-Operation-ID')??'')?request.headers.get('X-Operation-ID'):newTrace();
 const span=newTrace(),parent=tracePattern.test(request.headers.get('X-Parent-Span')??'')?request.headers.get('X-Parent-Span'):null,start=performance.now();
 const path=new URL(request.url).pathname;
 const category=/sign-in|sign-out|accounts/.test(path)?'authentication':/photos|uploads/.test(path)?'upload':/shares|guest/.test(path)?'sharing':/apartments|drafts|tours/.test(path)?'apartment':'system';
 const context={operation,span,parent,actor:'anonymous',apartment:path.match(/[a-f0-9]{32}/)?.[0]??null,category,events:[],stage:'request',auditId:null,retry:request.headers.get('X-Operation-Retry')==='1',dbMs:0};
 context.mark=(stage,extra={})=>{context.stage=stages.has(stage)?stage:'request';if(context.events.length>=24)return;const safe={stage:context.stage,at:Math.round((performance.now()-start)*100)/100};for(const k of ['duration','bytes','width','height','count','status'])if(Number.isFinite(extra[k])&&extra[k]>=0&&extra[k]<=2**31)safe[k]=Math.round(extra[k]*100)/100;context.events.push(safe);};
 context.time=async(stage,work)=>{const at=performance.now();if(stage==='database')context.stage=stage;else context.mark(stage);try{const result=await work();if(stage!=='database'||context.events.filter(e=>e.stage==='database').length<4)context.mark(stage,{duration:performance.now()-at});if(stage==='database')context.dbMs+=performance.now()-at;return result;}catch(error){if(stage==='database')error.diagnosticCode='DATABASE_FAILURE';if(stage==='storage')error.diagnosticCode='STORAGE_FAILURE';throw error;}};
 context.finish=(status,error)=>({...context,status,...classify(status,error),duration:Math.round((performance.now()-start)*100)/100,version:release.version,build:/^[a-f0-9]{7,40}$/i.test(env.APP_BUILD??'')?env.APP_BUILD:release.version,deployment:String(env.CF_VERSION_METADATA?.id??'unavailable').slice(0,64),browser:browserFamily(request.headers.get('User-Agent')),saved:status>=200&&status<300&&request.method!=='GET'?'confirmed':status===409||status===400||status===403?'not-committed':'unknown'});
 context.mark('request');return context;
}
export async function storeDiagnostic(db,d,{source='server',levelOverride}={}){
 const settings=await db.prepare('SELECT * FROM diagnostic_settings WHERE id=1').bind().first();
 const level=levelOverride??settings?.level??'off';if(level==='off'||(level==='error'&&d.status<400))return;
 const severity=d.status>=500?'error':d.status>=400?'warning':'info';
 const events=d.events.slice(0,level==='detail'?24:16);
 events.push({stage:'response',status:d.status,cause:d.cause,message:d.message,suggestion:d.suggestion,browser:d.browser??'Other',action:d.action??null,requestedScope:Array.isArray(d.requestedScope)?d.requestedScope.filter(id=>/^[a-f0-9]{32}$/.test(id)).slice(0,25):undefined,requestedExpires:Number.isSafeInteger(d.requestedExpires)?d.requestedExpires:undefined,rollback:d.status>=200&&d.status<300?'not-required':'unverified',databaseMs:Math.round((d.dbMs??0)*100)/100});
 await db.prepare(`INSERT INTO diagnostic_operations(operation,span,parent,actor,apartment,category,severity,code,stage,created,duration,version,build,deployment,source,saved,retry,events,audit_id)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(d.operation,d.span,d.parent,d.actor,d.apartment,d.category,severity,d.code,d.stage,Date.now(),d.duration,d.version,d.build,d.deployment,source,d.saved,d.retry?1:0,JSON.stringify(events),d.auditId||null).run();
}
export function validateClientEvents(body){
 if(!tracePattern.test(body.operation??'')||!Array.isArray(body.events)||!body.events.length||body.events.length>24||!categories.has(body.category))throw Error('Invalid diagnostic batch.');
 return body.events.map(e=>{if(!stages.has(e.stage))throw Error('Unknown diagnostic stage.');const event={stage:e.stage};for(const k of ['duration','bytes','width','height','count','status'])if(e[k]!==undefined){if(!Number.isFinite(e[k])||e[k]<0||e[k]>2**31)throw Error('Invalid diagnostic measurement.');event[k]=e[k];}return event;});
}
export async function diagnosticQuery(db,url){
 const args=[],where=[];for(const [query,column]of [['operation','operation'],['code','code'],['user','actor'],['apartment','apartment'],['category','category'],['severity','severity']]){const value=url.searchParams.get(query);if(value){if(value.length>80)throw Error('Filter is too long.');where.push(column+'=?');args.push(value);}}
 for(const [query,operator]of [['from','>='],['to','<=']]){const value=url.searchParams.get(query);if(value){const time=Date.parse(value);if(!Number.isFinite(time))throw Error('Invalid time range.');where.push('created'+operator+'?');args.push(time);}}
 const rows=(await db.prepare('SELECT * FROM diagnostic_operations'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY id DESC LIMIT 200').bind(...args).all()).results;
 return {operations:rows.map(r=>({...r,events:JSON.parse(r.events)})),settings:await db.prepare('SELECT * FROM diagnostic_settings WHERE id=1').bind().first(),summary:await db.prepare('SELECT COUNT(*) count,ROUND(AVG(duration),2) averageMs,MAX(duration) maximumMs,SUM(CASE WHEN severity=\'error\' THEN 1 ELSE 0 END) errors FROM diagnostic_operations WHERE created>?').bind(Date.now()-86400000).first()};
}
