// Read a private Wrangler JSON tail; print aggregate paths and numbers only.
import {readFile} from 'node:fs/promises';
const raw=await readFile(process.env.PILOT_TAIL_FILE,'utf8'),events=[];
let start=-1,depth=0,quoted=false,escape=false;
for(let i=0;i<raw.length;i++){
 const c=raw[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}
 else if(c==='"')quoted=true;else if(c==='{'){if(!depth)start=i;depth++;}
 else if(c==='}'&&depth&&! --depth)events.push(JSON.parse(raw.slice(start,i+1)));
}
const groups={};for(const e of events){if(!e.event?.request?.url)continue;const path=new URL(e.event.request.url).pathname;if(!path.startsWith('/api/'))continue;
 const key=e.executionModel+' '+e.event.request.method+' '+path.replace(/[a-f0-9]{32}/g,':id').replace(/\/images\/[^/]+/,'/images/:room');
 (groups[key]??=[]).push(e.cpuTime);
}
for(const[key,values]of Object.entries(groups)){values.sort((a,b)=>a-b);console.log(JSON.stringify({key,n:values.length,p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)}));}
console.log(JSON.stringify({events:events.length,outcomes:Object.fromEntries([...new Set(events.map(e=>e.outcome))].map(o=>[o,events.filter(e=>e.outcome===o).length]))}));
