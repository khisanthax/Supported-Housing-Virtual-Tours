import {test} from 'node:test';
import assert from 'node:assert/strict';
import {basis,rad,overlapStats} from '../capture/math.js';
import {capturePlan} from '../capture/guidance.js';
import {transposeFOV,sideMeasurement,finishCalibration,withCalibration,planningOptions} from '../capture/calibration.js';
import {saveSession,getSession,deleteSession} from '../capture/store.js';
import 'fake-indexeddb/auto';
test('visual camera estimate measures different camera FOVs and reciprocal orientations without device names',()=>{
 for(const hfov of[40,50,65,80,95])for(const aspect of[.75,1,4/3,16/9]){
  const angle=Math.atan(.7*Math.tan(rad(hfov)/2)),ref=basis(.4,0),left=sideMeasurement(ref,basis(.4+angle,0),-1),right=sideMeasurement(ref,basis(.4-angle,0),1),m=finishCalibration(left,right,aspect);
  assert.ok(Math.abs(m.hfov-hfov)<1e-9);assert.equal(m.status,'estimated');assert.ok(Math.abs(transposeFOV(transposeFOV(hfov,aspect),1/aspect)-hfov)<1e-9);
 }
 assert.throws(()=>sideMeasurement(basis(0,0),basis(0,0),-1),/same distant detail/);
 assert.throws(()=>sideMeasurement(basis(0,0),basis(.4,.3),-1),/same distant detail/);
 assert.throws(()=>finishCalibration(45,75,.75),/disagree/);assert.throws(()=>finishCalibration(NaN,65,.75),/Complete/);
});
test('new adaptive plans add overlap and tolerate moderate FOV uncertainty across camera shapes',()=>{
 const old=capturePlan(65,.75);assert.equal(old.length,25);const measured65=withCalibration({frames:[]},finishCalibration(65,65,.75));assert.equal(measured65.targets.length,38,'Visual setup must retain uncertainty margin; do not regress to a sparse 26-frame plan');
 for(const aspect of[.75,1,4/3,16/9]){
  const targets=capturePlan(65,aspect,planningOptions());assert.ok(targets.length<=96);assert.ok(targets.length>capturePlan(65,aspect).length);
  const stats=overlapStats(targets.map(t=>({hfov:60,aspect,pose:basis(t.yaw,t.pitch)})));assert.equal(stats.missing,0);assert.ok(stats.multiCoveredPercent>95);
 }
 assert.throws(()=>capturePlan(35,2.5,planningOptions()),/more than/);
 const newStats=overlapStats(capturePlan(65,.75,planningOptions()).map(t=>({hfov:55,aspect:.75,pose:basis(t.yaw,t.pitch)})));
 const oldStats=overlapStats(old.map(t=>({hfov:55,aspect:.75,pose:basis(t.yaw,t.pitch)})));assert.ok(newStats.multiCoveredPercent>oldStats.multiCoveredPercent);
});
test('calibration cannot modify completed captures, JPEGs, targets or recovery metadata',async()=>{
 const blob=new Blob(['original capture bytes']),saved={id:crypto.randomUUID(),apartment:'fov-preservation',frames:[{id:'target-0',blob}],hfov:65,aspect:.75,targets:capturePlan(65,.75),heading:.2};await saveSession(saved);const revision=saved.revision;
 assert.throws(()=>withCalibration(saved,finishCalibration(60,60,.75)),/Start another capture/);
 const loaded=await getSession(saved.id);assert.equal(loaded.revision,revision);assert.deepEqual(loaded.targets,saved.targets);assert.equal(loaded.heading,.2);assert.equal(await loaded.frames[0].blob.text(),'original capture bytes');await deleteSession(saved.id);
 const empty={id:crypto.randomUUID(),apartment:'new',frames:[],revision:0};const next=withCalibration(empty,finishCalibration(60,60,.75));assert.equal(next.plannerVersion,2);assert.ok(Math.abs(next.hfov-60)<1e-9);assert.equal(empty.hfov,undefined);await saveSession(next);assert.equal((await getSession(next.id)).cameraCalibration.method,'visual-two-sided-sensor-estimate');await deleteSession(next.id);
});
test('denser v2 captures remain bounded and revision protected',async()=>{
 const s={id:crypto.randomUUID(),apartment:'v2-limit',plannerVersion:2,frames:Array.from({length:96},()=>({blob:new Blob(['x'])}))};await saveSession(s);await assert.rejects(saveSession({...s,frames:[...s.frames,{blob:new Blob(['x'])}]}),/limit/);assert.equal((await getSession(s.id)).frames.length,96);await deleteSession(s.id);
});
