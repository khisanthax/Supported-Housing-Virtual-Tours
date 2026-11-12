import {PERMISSIONS,normalizeRole,effectivePermission} from './access-policy.mjs';
const id=/^[a-f0-9]{32}$/;
export function validatePolicy(key,value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid policy object');
 const role=/^role:(administrator|staff|client)$/.exec(key),user=/^user:([a-z0-9][a-z0-9._-]{2,39})$/.exec(key);
 if(!role&&!user)throw Error('Invalid policy target');
 if(role){if(Object.keys(value).some(k=>!Object.hasOwn(PERMISSIONS,k)))throw Error('Unknown permission');for(const [action,allowed]of Object.entries(value)){if(typeof allowed!=='boolean')throw Error('Use boolean role permissions');const p=PERMISSIONS[action];if(p.protected&&allowed!==(role[1]==='administrator'))throw Error('Protected role permission');if(role[1]==='client'&&allowed!==!!p.client)throw Error('Client boundary is locked');}}
 else {if(value.overrides&&(typeof value.overrides!=='object'||Array.isArray(value.overrides)))throw Error('Invalid override object');if(Object.keys(value).some(k=>!['overrides','scope'].includes(k)))throw Error('Unknown user policy field');for(const [action,mode]of Object.entries(value.overrides??{})){if(!Object.hasOwn(PERMISSIONS,action)||!['allow','deny'].includes(mode))throw Error('Invalid individual override');if(PERMISSIONS[action].protected)throw Error('Protected permission cannot be overridden');}const scope=value.scope;if(scope){if(!['all','selected'].includes(scope.mode)||!Array.isArray(scope.apartments)||scope.apartments.length>1000||new Set(scope.apartments).size!==scope.apartments.length||scope.apartments.some(a=>!id.test(a))||Object.keys(scope).some(k=>!['mode','apartments'].includes(k)))throw Error('Invalid apartment scope');if(scope.mode==='all'&&scope.apartments.length)throw Error('All scope must not contain selections');}}
 return value;
}
export function createPolicyStore(db){
 const stmt=(sql,...args)=>db.prepare(sql).bind(...args),one=(sql,...args)=>stmt(sql,...args).first();
 async function principal(account,suppliedRows){
  if(!account?.username||!normalizeRole(account.role))return null;
  const role=normalizeRole(account.role),rows=suppliedRows?suppliedRows.filter(r=>r.key==='role:'+role||r.key==='user:'+account.username):(await stmt('SELECT key,value FROM uac_policy WHERE key IN (?,?)','role:'+role,'user:'+account.username).all()).results;
  const values=Object.fromEntries(rows.map(r=>[r.key,validatePolicy(r.key,JSON.parse(r.value))])),user=values['user:'+account.username]??{};
  return {...account,role,rolePolicy:values['role:'+role]??{},overrides:user.overrides??{},scope:user.scope??{mode:'all',apartments:[]}};
 }
 async function save({username,sessionHash},key,value,expectedRevision){
  validatePolicy(key,value);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid policy revision');
  const now=Date.now(),target=key.startsWith('user:')?key.slice(5):null;
  if(target&&!await one('SELECT 1 FROM staff_accounts WHERE username=?',target))throw Error('Unknown staff account');
  const apartments=value.scope?.apartments??[];for(let i=0;i<apartments.length;i+=50){const batch=apartments.slice(i,i+50),row=await one('SELECT COUNT(DISTINCT apartment) n FROM versions WHERE apartment IN ('+batch.map(()=>'?').join(',')+')',...batch);if(row.n!==batch.length)throw Error('Unknown apartment');}
  // An INSERT/UPDATE is a single primary D1 transaction; audit trigger runs atomically.
  const result=await stmt(`INSERT INTO uac_policy(key,value,revision,changed_by,changed_at)
   SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM staff_accounts a JOIN staff_sessions s USING(username)
    WHERE a.username=? AND a.role='administrator' AND a.disabled=0 AND s.token=? AND s.expires>?
    AND s.revision=a.revision) AND COALESCE((SELECT revision FROM uac_policy WHERE key=?),0)=?
   ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=uac_policy.revision+1,changed_by=excluded.changed_by,changed_at=excluded.changed_at`,key,JSON.stringify(value),username,now,username,sessionHash,now,key,expectedRevision).run();
  if(!result.meta.changes)throw Error('Policy changed or Administrator session ended');
  return {revision:expectedRevision+1};
 }
 async function inspect(account,suppliedRows){const p=await principal(account,suppliedRows);if(!p)return null;return {...p,effective:Object.fromEntries(Object.keys(PERMISSIONS).map(action=>[action,effectivePermission(p,action)]))};}
 return {principal,save,inspect};
}
