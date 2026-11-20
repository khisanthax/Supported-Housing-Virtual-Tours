import{test}from'node:test';import assert from'node:assert/strict';
import{basis,direction,rad,dot}from'../capture/math.js';import{cameraRay,refineRotations,connectedFrames}from'../capture/alignment.js';
test('matched bearings refine sensor rotation errors while preserving source metadata',()=>{
 const truth=[0,30,60].map(y=>basis(rad(y),0)),frames=truth.map((pose,i)=>({pose:basis(rad(i*30+(i?4:0)),rad(i?2:0)),hfov:70,aspect:1})),edges=[];
 for(let i=0;i<2;i++){const matches=[];for(let y=-20;y<=20;y+=4)for(let x=i*30+5;x<i*30+30;x+=3){const ray=direction(rad(x),rad(y)),point=p=>{const z=dot(ray,p.f),t=Math.tan(rad(70)/2);return[dot(ray,p.r)/z/t,dot(ray,p.u)/z/t]};matches.push({a:point(truth[i]),b:point(truth[i+1])})}edges.push({i,j:i+1,matches})}
 const original=JSON.stringify(frames),r=refineRotations(frames,edges,{iterations:200});assert.ok(r.after<r.before*.15,JSON.stringify(r));assert.equal(JSON.stringify(frames),original);assert.equal(connectedFrames(3,edges),true);assert.equal(connectedFrames(4,edges),false);
});
test('camera calibration ray is normalized and radial correction changes off-axis bearings',()=>{const f={hfov:65,aspect:1};assert.deepEqual(cameraRay([0,0],f),[0,0,1]);assert.ok(cameraRay([.8,.6],f,1,.1)[2]>cameraRay([.8,.6],f)[2])});
