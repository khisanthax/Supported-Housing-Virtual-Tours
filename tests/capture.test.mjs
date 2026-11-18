import{test}from'node:test';
import assert from'node:assert/strict';
import 'fake-indexeddb/auto';
import{plan,basis,coverage,project,deviceBasis}from'../capture/math.js';
import{saveSession,listSessions,getSession,deleteSession}from'../capture/store.js';
test('capture geometry covers sphere including poles with bounded adaptive plans',()=>{for(const[h,a]of[[50,.75],[65,4/3],[65,16/9]]){const targets=plan(h,a);assert.ok(targets.length<=64);assert.equal(coverage(targets.map(t=>({hfov:h,aspect:a,pose:basis(t.yaw,t.pitch)}))).missing,0)}assert.ok(coverage([{hfov:65,aspect:4/3,pose:basis(0,0)}]).missing>0);assert.equal(project([0,0,1],{hfov:65,aspect:1,pose:basis(0,0)}).x,0.5);assert.ok(deviceBasis({alpha:0,beta:90,gamma:0}).f.every(Number.isFinite))});
test('capture sessions retain bytes, scope apartments and reject stale or oversized writes',async()=>{const blob=new Blob(['synthetic bytes']),s={id:crypto.randomUUID(),apartment:'a',frames:[{blob}],state:'capturing'};await saveSession(s);const stale={...s};s.name='Retake';await saveSession(s);await assert.rejects(saveSession(stale),/another tab/);assert.equal(await(await getSession(s.id)).frames[0].blob.text(),'synthetic bytes');assert.equal((await listSessions('b')).length,0);assert.equal((await listSessions('a')).length,1);await assert.rejects(saveSession({...s,frames:Array(65).fill({blob})}),/limit/);assert.equal((await getSession(s.id)).name,'Retake');await deleteSession(s.id);assert.equal(await getSession(s.id),undefined)});

