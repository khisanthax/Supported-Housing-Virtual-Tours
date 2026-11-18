import {test} from 'node:test';
import assert from 'node:assert/strict';
import {basis,rad,coverage} from '../capture/math.js';
import {capturePlan,projectTarget,StableTarget,targetLabel,cameraBasis} from '../capture/guidance.js';
test('visual plans begin level, cover horizontal/vertical sphere and never need numeric staff aiming',()=>{
 for(const [hfov,aspect] of [[65,4/3],[50,.75],[65,16/9]]){
  const targets=capturePlan(hfov,aspect);assert.equal(targets[0].yaw,0);assert.equal(targets[0].pitch,0);assert.equal(new Set(targets.map(t=>t.id)).size,targets.length);assert.ok(targets.length<=64);
  assert.equal(coverage(targets.map(t=>({pose:basis(t.yaw,t.pitch),hfov,aspect}))).missing,0);
  for(const t of targets)assert.doesNotMatch(targetLabel(t),/\d|°/);
 }
});
test('target projection follows camera rotation, pitch and roll while centre remains fixed',()=>{
 const target={id:'a',yaw:0,pitch:0};assert.deepEqual([projectTarget(target,basis(0,0),65,4/3).x,projectTarget(target,basis(0,0),65,4/3).y],[.5,.5]);
 assert.ok(projectTarget(target,basis(rad(10),0),65,4/3).x<.5);
 assert.ok(projectTarget(target,basis(0,rad(10)),65,4/3).y>.5);
 assert.match(projectTarget({...target,pitch:Math.PI/2},basis(Math.PI,0),65,4/3).hint,/Look up/);
 assert.equal(projectTarget({...target,yaw:Math.PI},basis(0,0),65,4/3).visible,false);
 assert.ok(projectTarget(target,basis(rad(10),0,Math.PI/2),65,4/3).y<.5);
});
test('auto capture requires fresh stable aligned samples, latches once, and resets for retakes',()=>{
 const gate=new StableTarget(),target={id:'a',yaw:0,pitch:0},pose=basis(0,0);
 for(let now=0;now<=780;now+=60)assert.equal(gate.observe(pose,target,now).ready,false);
 assert.equal(gate.observe(pose,target,900).ready,true);assert.equal(gate.consume(),true);assert.equal(gate.consume(),false);
 assert.equal(gate.observe(pose,target,960).ready,false);
 gate.reset();for(let now=0;now<=960;now+=60)gate.observe(pose,target,now);assert.equal(gate.consume(),true);
 assert.equal(gate.observe(pose,{...target,id:'other'},1020).ready,false);
});
test('fast movement, roll, stale samples, misalignment and sensor discontinuities prevent capture',()=>{
 const target={id:'a',yaw:0,pitch:0};
 for(const kind of ['jitter','roll','outside','stale','disabled']){
  const gate=new StableTarget();for(let i=0;i<25;i++){
   const p=basis(kind==='outside'?rad(12):kind==='jitter'?rad(i%2?2:-2):0,0,kind==='roll'?rad(i%2?2:-2):0);
   assert.equal(gate.observe(p,target,i*(kind==='stale'?400:60),kind!=='disabled').ready,false);
  }
 }
 const gate=new StableTarget();gate.observe(basis(0,0),target,0);assert.equal(gate.observe(basis(rad(80),0),target,60).jump,true);
});

test('display orientation rotates camera axes without changing its optical direction',()=>{
 const e={alpha:0,beta:90,gamma:0},p=cameraBasis(e,0,0),q=cameraBasis(e,0,90);
 assert.deepEqual(q.f,p.f);for(let i=0;i<3;i++){assert.ok(Math.abs(q.r[i]+p.u[i])<1e-9);assert.ok(Math.abs(q.u[i]-p.r[i])<1e-9)}
 const gate=new StableTarget(),t={id:'circle',yaw:0,pitch:0};for(let n=0;n<20;n++)assert.equal(gate.observe(basis(0,0),t,n*60,true,false).ready,false);
});
