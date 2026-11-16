// On-demand operator test tool. Never persist raw tail events, URLs, headers or logs.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const config=process.env.PILOT_TAIL_CONFIG,output=process.env.PILOT_TAIL_OUTPUT;
if(!config||!output)throw Error('Set private PILOT_TAIL_CONFIG and PILOT_TAIL_OUTPUT paths.');
const rows=[],child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail','--config',config,'--format','json'],{windowsHide:true,stdio:['ignore','pipe','ignore']});
let buffer='',depth=0,quoted=false,escaped=false;
const record=x=>{if(rows.length>=3000)return;let path;try{path=new URL(x.event?.request?.url??'https://internal/').pathname.replace(/[a-f0-9]{32}/g,':id');}catch{path='/unknown';}if(!/^\/(api\/|staff|guest|internal)/.test(path))path='/asset';rows.push({at:Date.now(),method:x.event?.request?.method??'internal',path,cpu:Number.isFinite(x.cpuTime)?x.cpuTime:null,wall:Number.isFinite(x.wallTime)?x.wallTime:null,executionModel:['durableObject','stateless','durable','worker'].includes(x.executionModel)?x.executionModel:'other',outcome:['ok','canceled','exception','exceededCpu','exceededMemory','unknown'].includes(x.outcome)?x.outcome:'other'});};
child.stdout.on('data',bytes=>{for(const c of bytes.toString()){if(!depth){if(c!=='{')continue;buffer='{';depth=1;quoted=escaped=false;continue;}buffer+=c;if(escaped){escaped=false;continue;}if(c==='\\'&&quoted){escaped=true;continue;}if(c==='"'){quoted=!quoted;continue;}if(!quoted){if(c==='{')depth++;if(c==='}')depth--;}if(!depth){try{record(JSON.parse(buffer));}catch{}buffer='';}if(buffer.length>8*1024*1024){buffer='';depth=0;}}});
let stop;await new Promise(resolve=>{const timer=setTimeout(()=>{stop();resolve();},Math.min(600000,Number(process.env.PILOT_TAIL_MS)||180000));stop=()=>{if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();child.stdout.destroy();clearTimeout(timer);resolve();};child.on('close',()=>{clearTimeout(timer);resolve();});process.on('SIGINT',stop);});
await writeFile(output,JSON.stringify({format:'virtual-tours-safe-cpu',collected:new Date().toISOString(),rows},null,2));
console.log('Saved '+rows.length+' sanitized invocation samples; raw telemetry was discarded.');
