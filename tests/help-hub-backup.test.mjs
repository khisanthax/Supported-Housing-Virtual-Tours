import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {backUpHub,restoreHub} from '../help-hub/backup.mjs';
import {approveTicket,createHelpHub} from '../help-hub/server.mjs';

const secret=()=>randomBytes(32).toString('base64url');
const headers=token=>({Authorization:'Bearer '+token,'Content-Type':'application/json',Connection:'close'});

test('authenticated Hub backups retain allowed history and exclude restored credentials and purged tickets',async context=>{
  const path=await mkdtemp(join(tmpdir(),'lt360-hub-backup-test-'));
  const db=join(path,'source.sqlite'),archive=join(path,'hub.backup'),restored=join(path,'fresh.sqlite');
  const agency=secret(),ownerToken=secret(),key=secret(),backupKey=secret();
  const temporarySession=secret();
  const options={ownerToken,key,agencies:[{id:'fictional',origin:'https://fictional.invalid',label:'Fictional',token:agency}],
    async fetchAgency(_url,request){
      const {grantId}=JSON.parse(request.body);
      return Response.json({id:grantId,hours:2,expires:Date.now()+7200000,permissions:['diagnostics'],apartments:[]},
        {headers:{'Set-Cookie':'__Host-lt360-support='+temporarySession+'; Path=/; Secure; HttpOnly'}});
    }};
  let host;
  const start=async database=>{
    host=createHelpHub({...options,database});
    host.listen(0,'127.0.0.1');await once(host,'listening');
    return 'http://127.0.0.1:'+host.address().port;
  };
  const stop=async()=>{
    await new Promise(resolve=>host.close(resolve));host=null;
  };
  const call=async(origin,name,args)=>{
    const response=await fetch(origin+'/mcp',{method:'POST',headers:headers(ownerToken),
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    return (await response.json()).result;
  };
  try{
    const origin=await start(db);
    const invite=secret();
    const add=async issue=>{
      const reply=await fetch(origin+'/agency/tickets',{method:'POST',headers:headers(agency),
        body:JSON.stringify({installation:'fictional',grant:randomBytes(16).toString('hex'),key:invite,issue,hours:2,deadline:Date.now()+600000})});
      assert.equal(reply.status,201);
      return (await reply.json()).ticket;
    };
    const keep=await add('Synthetic issue retained in recovery.');
    const remove=await add('Synthetic issue later deleted.');
    const aged=await add('Synthetic record beyond its retention window.');
    const active=await add('Synthetic active session.');
    assert.equal((await call(origin,'send_note',{ticket:keep,note:'Synthetic operator note.'})).isError,undefined);
    const fixture=new DatabaseSync(db);
    try{
      approveTicket(fixture,active);
      fixture.prepare('UPDATE tickets SET approved=? WHERE seq=1').run(Date.now()+300000);
      fixture.prepare("UPDATE tickets SET status='closed',sealed=NULL,transition=0 WHERE seq=?").run(Number(aged.slice(3)));
    }finally{fixture.close();}
    assert.equal((await call(origin,'activate_support',{ticket:active})).isError,undefined);
    await stop();

    await backUpHub(db,archive,backupKey);
    await assert.rejects(backUpHub(db,archive,backupKey),{code:'EEXIST'});
    const ciphertext=await readFile(archive);
    for(const plaintext of ['SQLite format','fictional',invite,temporarySession,'Synthetic issue','Synthetic operator note.'])
      assert.ok(!ciphertext.includes(plaintext));
    await assert.rejects(restoreHub(archive,restored,secret(),[remove]),/authentication failed/);
    await assert.rejects(stat(restored),{code:'ENOENT'});
    const altered=join(path,'changed.backup');
    ciphertext[9]^=1;
    await writeFile(altered,ciphertext);
    await assert.rejects(restoreHub(altered,restored,backupKey,[remove]),/authentication failed/);
    const monthLater=Date.now()+31*86400000;
    const clock=context.mock.method(Date,'now',()=>monthLater);
    try{await assert.rejects(restoreHub(archive,restored,backupKey,[remove]),/retention window/);}
    finally{clock.mock.restore();}

    await restoreHub(archive,restored,backupKey,[remove]);
    await assert.rejects(restoreHub(archive,restored,backupKey,[remove]),{code:'EEXIST'});
    const recovered=new DatabaseSync(restored,{readOnly:true});
    try{
      assert.equal(recovered.prepare('SELECT count(*) n FROM tickets WHERE sealed IS NOT NULL OR approved IS NOT NULL').get().n,0);
      assert.equal(recovered.prepare('SELECT count(*) n FROM tickets').get().n,2);
    }finally{recovered.close();}
    const recoveredOrigin=await start(restored);
    const detail=JSON.parse((await call(recoveredOrigin,'get_request',{ticket:keep})).content[0].text);
    assert.equal(detail.status,'closed');
    assert.equal(detail.issue,'Synthetic issue retained in recovery.');
    assert.ok(detail.history.some(event=>event.note==='Synthetic operator note.'));
    for(const ticket of [remove,aged])assert.equal((await call(recoveredOrigin,'get_request',{ticket})).isError,true);
    assert.equal((await call(recoveredOrigin,'activate_support',{ticket:keep})).isError,true);
    assert.equal((await call(recoveredOrigin,'get_support_session',{ticket:active})).isError,true);
  }finally{
    if(host)await stop();
    await rm(path,{recursive:true,force:true});
  }
});
