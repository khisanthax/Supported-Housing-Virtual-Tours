import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {createHelpHub} from './server.mjs';

const name='leveltwo360_operator_rehearsal';
const variable='LT360_HUB_OWNER_TOKEN';
const secret=()=>randomBytes(32).toString('base64url');
const bearer=secret();
const agencyToken=secret();
const hub=createHelpHub({database:':memory:',ownerToken:bearer,key:secret(),
  agencies:[{id:'rehearsal',origin:'https://rehearsal.invalid',label:'Fictional Agency',token:agencyToken}]});
const folder=await mkdtemp(join(tmpdir(),'lt360-sandbox-'));
hub.listen(0,'127.0.0.1');
await once(hub,'listening');
const base='http://127.0.0.1:'+hub.address().port;
const child=spawn(process.argv[2]??'codex',['app-server','-c','sandbox_mode="read-only"',
  '-c','shell_environment_policy.filters={"LT360_HUB_*"="exclude"}',
  '-c','mcp_servers.'+name+'.url="'+base+'/mcp"',
  '-c','mcp_servers.'+name+'.bearer_token_env_var="'+variable+'"',
  '-c','mcp_servers.'+name+'.default_tools_approval_mode="approve"'],
  {cwd:folder,env:{...process.env,[variable]:bearer},windowsHide:true,stdio:['pipe','pipe','pipe']});
const closed=once(child,'close').catch(()=>{});
const transport=createInterface({input:child.stdout});
child.stderr.resume();
let id=0;
const waiters=new Map();
transport.on('line',line=>{
  if(!line.startsWith('{'))return;
  const result=JSON.parse(line);
  const waiter=waiters.get(result.id);
  if(!waiter||result.method)return;
  clearTimeout(waiter.timeout);
  waiters.delete(result.id);
  if(result.error)waiter.reject(new Error(result.error.message));
  else waiter.resolve(result.result);
});
const call=(method,params)=>new Promise((resolve,reject)=>{
  const current=++id;
  const timeout=setTimeout(()=>reject(new Error(method+' timed out.')),35000);
  waiters.set(current,{resolve,reject,timeout});
  child.stdin.write(JSON.stringify({id:current,method,params})+'\n');
});
try{
  const ticket=await fetch(base+'/agency/tickets',{method:'POST',headers:{Authorization:'Bearer '+agencyToken,'Content-Type':'application/json'},
    body:JSON.stringify({installation:'rehearsal',grant:randomBytes(16).toString('hex'),key:secret(),issue:'Synthetic sandbox acceptance',hours:2,deadline:Date.now()+600000})});
  assert.equal(ticket.status,201);
  await call('initialize',{clientInfo:{name:'leveltwo360-rehearsal',title:'Synthetic Launch Profile Rehearsal',version:'1.0.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const effective=await call('config/read',{cwd:folder,includeLayers:false});
  assert.equal(effective.config.shell_environment_policy.filters['LT360_HUB_*'],'exclude');
  const {thread}=await call('thread/start',{cwd:folder,ephemeral:true,sandbox:'read-only',approvalPolicy:'never'});
  const catalog=await call('mcpServerStatus/list',{serverName:name,detail:'toolsAndAuthOnly',threadId:thread.id});
  assert.ok(catalog.data.some(entry=>entry.name===name&&Object.hasOwn(entry.tools,'list_requests')));
  const requests=await call('mcpServer/tool/call',{threadId:thread.id,server:name,tool:'list_requests',arguments:{}});
  assert.equal(requests.isError??false,false);
  assert.equal(JSON.parse(requests.content[0].text)[0].status,'pending');

  const marker=join(folder,'must-not-be-written');
  const code=`const fs=require('node:fs');
    const bearer=Object.hasOwn(process.env,${JSON.stringify(variable)});
    let wrote=false;
    try {fs.writeFileSync(${JSON.stringify(marker)},'synthetic',{flag:'wx'});wrote=true;}
    catch(error){if(!['EROFS','EACCES','EPERM'].includes(error.code))throw error;}
    console.log(JSON.stringify({bearer,wrote}));`;
  const result=await call('command/exec',{command:[process.execPath,'-e',code],cwd:folder,timeoutMs:15000,sandboxPolicy:{type:'readOnly'}});
  assert.ok(!result.stdout.includes(bearer)&&!result.stderr.includes(bearer));
  assert.equal(result.exitCode,0,'The sandboxed check must execute. '+result.stderr.slice(0,700));
  assert.deepEqual(JSON.parse(result.stdout),{bearer:false,wrote:false});
  await assert.rejects(stat(marker),{code:'ENOENT'});
  console.log('Codex MCP discovery passed; its sandboxed child saw no bearer and could not write the synthetic marker.');
} finally{
  for(const waiter of waiters.values())clearTimeout(waiter.timeout);
  child.stdin.end();
  child.kill();
  transport.close();
  await closed;
  await new Promise(resolve=>hub.close(resolve));
  await rm(folder,{recursive:true,force:true});
}
