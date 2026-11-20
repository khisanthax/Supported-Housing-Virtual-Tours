export const DATABASE='leveltwo360-capture-prototype-v1';
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function open(){const r=indexedDB.open(DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions',{keyPath:'id'});return request(r)}
export async function saveSession(session,expected=session.revision??0){
 if(session.frames.length>(session.plannerVersion===2?96:64)||session.frames.reduce((n,f)=>n+f.blob.size,0)>64*1024*1024)throw Error('Capture storage limit reached; existing photos were kept.');
 const db=await open();try{return await new Promise((resolve,reject)=>{const t=db.transaction('sessions','readwrite'),s=t.objectStore('sessions');let problem;const get=s.get(session.id);get.onsuccess=()=>{if((get.result?.revision??0)!==expected){problem=Error('Capture changed in another tab. Reopen it; no photos were overwritten.');t.abort();return}s.put({...session,revision:expected+1,updated:Date.now()})};t.oncomplete=()=>{session.revision=expected+1;resolve(session)};t.onabort=t.onerror=()=>reject(problem??Error('Capture could not be saved on this device. Previous photos were kept. Check browser storage.'))})}finally{db.close()}
}
export async function findSession(apartment){const db=await open();try{const all=await request(db.transaction('sessions').objectStore('sessions').getAll());return all.filter(s=>s.apartment===apartment&&s.state!=='committed').sort((a,b)=>b.updated-a.updated)[0]??null}finally{db.close()}}
export async function getSession(id){const db=await open();try{return await request(db.transaction('sessions').objectStore('sessions').get(id))}finally{db.close()}}
export async function deleteSession(id){const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction('sessions','readwrite');t.objectStore('sessions').delete(id);t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error)})}finally{db.close()}}

export async function listSessions(apartment){const db=await open();try{return (await request(db.transaction('sessions').objectStore('sessions').getAll())).filter(s=>s.apartment===apartment).sort((a,b)=>b.updated-a.updated)}finally{db.close()}}
