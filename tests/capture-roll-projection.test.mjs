import {test} from 'node:test';
import assert from 'node:assert/strict';
import {basis,rad,checkFrame} from '../capture/math.js';
import {orientationError,StableTarget,cameraBasis} from '../capture/guidance.js';
import {makeLens,projectCamera,undistortPoint,sampleRGB} from '../capture/projection.js';
import {interpolateScale,pixelResidual} from '../capture/alignment.js';
import {OverlapQuality,previewReviewable} from '../capture/stitch-quality.js';

test('steady sideways poses are blocked at walls, ceiling and floor',()=>{
 for(const pitch of [0,rad(45),Math.PI/2,-Math.PI/2])for(const yaw of [0,rad(90)]){
  const target={id:'aim',yaw,pitch};
  for(const roll of [rad(9),rad(30),rad(-30),rad(90)]){
   const pose=basis(yaw,pitch,roll),error=orientationError(pose,target),gate=new StableTarget();
   assert.ok(error.aim<1e-7);assert.equal(error.aligned,false);
   for(let now=0;now<=1800;now+=60)assert.equal(gate.observe(pose,target,now).ready,false);
  }
  for(const roll of [0,rad(7),rad(-7)]){
   const gate=new StableTarget();for(let now=0;now<=960;now+=60)gate.observe(basis(yaw,pitch,roll),target,now);
   assert.equal(gate.state.ready,true);assert.equal(gate.consume(),true);assert.equal(gate.consume(),false);
  }
 }
 assert.match(orientationError(basis(0,0,rad(20)),{yaw:0,pitch:0}).correction,/right/);
 assert.match(orientationError(basis(0,0,rad(-20)),{yaw:0,pitch:0}).correction,/left/);
});

test('full-axis orientation handles portrait, landscape and inverted screen transforms',()=>{
 for(const [angle,reading] of [[0,{alpha:0,beta:90,gamma:0}],[90,{alpha:90,beta:0,gamma:-90}],[180,{alpha:180,beta:-90,gamma:0}],[270,{alpha:-90,beta:0,gamma:90}]]){
  const pose=cameraBasis(reading,0,angle),error=orientationError(pose,{yaw:0,pitch:0});
  assert.equal(error.aligned,true);assert.ok(error.rotation<1e-7);
 }
 const gate=new StableTarget(),target={id:'reset',yaw:0,pitch:0};
 for(let t=0;t<1000;t+=60)gate.observe(basis(0,0,rad(20)),target,t);
 gate.reset();assert.equal(gate.observe(basis(0,0),target,2000).ready,false);
 for(let t=2060;t<=3020;t+=60)gate.observe(basis(0,0),target,t);
 assert.equal(gate.state.ready,true);
});

test('lens model rejects the remote folded branch and roundtrips valid image points',()=>{
 const frame={hfov:65,aspect:.75};
 for(const k1 of [-.12,-.06,0,.06,.12]){
  const lens=makeLens(frame,{k1});
  for(const point of [[0,0],[.2,.6],[-.7,.5],[.9,-.9]]){
   const ray=undistortPoint(point,lens),pixel=projectCamera(ray[0]/ray[2],ray[1]/ray[2],lens);
   assert.ok(pixel);assert.ok(Math.abs(pixel.x-point[0])<1e-6);assert.ok(Math.abs(pixel.y-point[1])<1e-6);
  }
 }
 const remote=Math.sqrt(1/.12),oldPixel=remote*(1-.12*remote*remote)/Math.tan(rad(65)/2);
 assert.ok(Math.abs(oldPixel)<1e-10,'Old polynomial incorrectly maps a remote ray to image centre');
 assert.equal(projectCamera(remote,0,makeLens(frame,{k1:-.12})),null);
 assert.throws(()=>makeLens({hfov:95,aspect:.75},{k1:-.12}),/folds/);
 assert.throws(()=>makeLens(frame,{k1:NaN}),/Unsupported/);
 assert.throws(()=>undistortPoint([NaN,0],makeLens(frame)),/Invalid/);
});

test('bilinear sampling clamps every border and never reads a neighbouring row as a column',()=>{
 const px=Uint8Array.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),rgb=new Float64Array(3);
 assert.deepEqual([...sampleRGB(px,2,2,1,1,rgb)],[255,255,255]);
 assert.deepEqual([...sampleRGB(px,2,2,1,0,rgb)],[0,255,0]);
 assert.deepEqual([...sampleRGB(px,2,2,0,.5,rgb)],[127.5,0,127.5]);
 assert.throws(()=>sampleRGB(px,2,2,NaN,0,rgb),/Non-finite/);
 const p=basis(0,0);assert.throws(()=>checkFrame({hfov:65,aspect:1,pose:{...p,r:[-1,0,0]}}),/Reflected/);
});

test('overlap disagreement rejects inconsistent images and legacy/diagnostic previews cannot be accepted',()=>{
 const good=new OverlapQuality(),bad=new OverlapQuality(),empty=new OverlapQuality();
 for(let i=0;i<256;i++){good.add(i,[110,120,130]);good.add(i,[112,123,134]);bad.add(i,[10,20,30]);bad.add(i,[200,210,220]);}
 const passed=good.assess();assert.equal(passed.reviewable,true);assert.equal(bad.assess().status,'rejected');assert.equal(empty.assess().reviewable,false);
 const report={verification:passed,missing:0,originalFrames:2,usedFrames:2,alignment:{usedFrames:2,originalFrames:2,excludedUnmatchedFrames:[],heldoutPixels:{rms:1,p90:2,invalid:0}}};assert.equal(previewReviewable(report),true);assert.equal(previewReviewable({...report,usedFrames:1}),false);assert.equal(previewReviewable({...report,alignment:null}),false);
 for(const report of [{},{verification:passed,missing:1},{verification:passed,missing:0,diagnostic:true},{verification:bad.assess(),missing:0}])assert.equal(previewReviewable(report),false);
});

test('bounded focal interpolation and held-out image-space validation use actual image coordinates',()=>{
 const truth=.91,profile=[.75,.85,.95,1,1.1].map(scale=>({scale,error:Math.sqrt((Math.log(scale)-Math.log(truth))**2+.001)}));assert.ok(Math.abs(interpolateScale(profile)-truth)<1e-10);assert.equal(interpolateScale([{scale:.5,error:1},{scale:1,error:2}]),null);
 const frames=[{hfov:65,aspect:1},{hfov:65,aspect:1}],poses=[basis(0,0),basis(0,0)],features=[{w:800,h:800},{w:800,h:800}];
 const good=pixelResidual(frames,[{i:0,j:1,matches:[{a:[0,0],b:[0,0]}]}],poses,features);assert.equal(good.rms,0);assert.equal(good.invalid,0);
 const bad=pixelResidual(frames,[{i:0,j:1,matches:[{a:[0,0],b:[.05,0]}]}],poses,features);assert.ok(bad.rms>19);assert.ok(bad.p90>19);
});
