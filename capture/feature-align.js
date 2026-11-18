import {dot} from './math.js';
import {cameraRay,refineRotations,connectedFrames} from './alignment.js';
export async function alignFrames(frames,progress=()=>{}){
 await import('./vendor/opencv.js');const cv=globalThis.cv;
 if(!cv?.Mat)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('OpenCV initialization timed out. Sources kept.')),30000);cv.onRuntimeInitialized=()=>{clearTimeout(timer);resolve()}});
 const features=[];let edges=[];let orb,matcher;
 try{
  orb=new cv.AKAZE();orb.setThreshold(.004);matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  for(let i=0;i<frames.length;i++){
   const bitmap=await createImageBitmap(frames[i].blob),scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);bitmap.close();
   const pixels=ctx.getImageData(0,0,w,h),src=cv.matFromImageData(pixels),gray=new cv.Mat(),mask=new cv.Mat(),kp=new cv.KeyPointVector(),desc=new cv.Mat();
   try{cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.equalizeHist(gray,gray);orb.detectAndCompute(gray,mask,kp,desc);const points=[],light=[];for(let j=0;j<kp.size();j++){const p=kp.get(j).pt;points.push([2*p.x/(w-1)-1,1-2*p.y/(h-1)]);const at=(Math.round(p.y)*w+Math.round(p.x))*4;light.push((pixels.data[at]+pixels.data[at+1]+pixels.data[at+2])/3)}features.push({points,light,desc,w,h})}catch(e){desc.delete();throw e}finally{src.delete();gray.delete();mask.delete();kp.delete();canvas.width=canvas.height=1}
   progress({stage:'features',done:i+1,total:frames.length});
  }
  for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++){
   if(dot(frames[i].pose.f,frames[j].pose.f)<.05)continue; // Bounded nearby pairs; reject invalid legacy pose conventions.

   const a=features[i],b=features[j];if(a.desc.rows<12||b.desc.rows<12)continue;
   const knn=new cv.DMatchVectorVector(),candidate=[];
   try{matcher.knnMatch(a.desc,b.desc,knn,2);for(let k=0;k<knn.size();k++){const row=knn.get(k);try{if(row.size()<2)continue;const m=row.get(0),n=row.get(1);if(m.distance<.72*n.distance)candidate.push(m)}finally{row.delete()}}}finally{knn.delete()}
   if(candidate.length<12)continue;
   let from,to,H,mask;try{
    from=cv.matFromArray(candidate.length,1,cv.CV_32FC2,candidate.flatMap(m=>[...a.points[m.queryIdx]].map((v,k)=>(k===0?v+1:1-v)*(k===0?a.w:a.h)/2)));
    to=cv.matFromArray(candidate.length,1,cv.CV_32FC2,candidate.flatMap(m=>[...b.points[m.trainIdx]].map((v,k)=>(k===0?v+1:1-v)*(k===0?b.w:b.h)/2)));
    mask=new cv.Mat();H=cv.findHomography(from,to,cv.RANSAC,2.5,mask);if(H.empty())continue;
    const matches=candidate.filter((m,k)=>mask.data[k]).slice(0,100).map(m=>({a:a.points[m.queryIdx],b:b.points[m.trainIdx],gain:Math.log(Math.max(15,a.light[m.queryIdx])/Math.max(15,b.light[m.trainIdx]))}));
    const priorErrors=matches.map(m=>{const ray=(p,f)=>{const v=cameraRay(p,f);return v.map((_,k)=>f.pose.r[k]*v[0]+f.pose.u[k]*v[1]+f.pose.f[k]*v[2])};return Math.acos(Math.max(-1,Math.min(1,dot(ray(m.a,frames[i]),ray(m.b,frames[j])))))}).sort((a,b)=>a-b);
    if(matches.length>=12&&matches.length/candidate.length>.35&&priorErrors[Math.floor(priorErrors.length/2)]<.18)edges.push({i,j,matches});
   }finally{from?.delete();to?.delete();H?.delete();mask?.delete()}
  }
  const retained=frames.map((f,i)=>i).filter(i=>edges.some(e=>e.i===i||e.j===i)),excluded=frames.filter((f,i)=>!retained.includes(i)).map(f=>f.id);
  if(retained.length<frames.length*.8)throw Error('Too many photographs lack reliable feature matches. Sources retained.');
  const index=new Map(retained.map((old,i)=>[old,i]));edges=edges.map(e=>({...e,i:index.get(e.i),j:index.get(e.j)}));frames=retained.map(i=>frames[i]);
  if(!connectedFrames(frames.length,edges))throw Error('Feature graph has disconnected components: '+edges.map(e=>frames[e.i].id+'-'+frames[e.j].id).join(' ')+' Sources retained; no guessed alignment.');
  let best;for(const scale of [.45,.55,.65,.75,.85,.95,1,1.1,1.2]){const r=refineRotations(frames,edges,{scale});if(!best||r.after<best.after)best={...r,scale,k1:0};progress({stage:'alignment',scale,error:r.after})}
  for(const k1 of [-.12,-.06,.06,.12]){const r=refineRotations(frames,edges,{scale:best.scale,k1});if(r.after<best.after)best={...r,scale:best.scale,k1}}
  const gains=frames.map(()=>0);for(let n=0;n<50;n++){const sums=frames.map(()=>0),counts=frames.map(()=>0);for(const e of edges){const values=e.matches.map(m=>m.gain).sort((a,b)=>a-b),g=values[Math.floor(values.length/2)];sums[e.j]+=gains[e.i]+g;sums[e.i]+=gains[e.j]-g;counts[e.i]++;counts[e.j]++}for(let i=1;i<frames.length;i++)if(counts[i])gains[i]=Math.max(-.5,Math.min(.5,sums[i]/counts[i]))}
  const exposureBefore=Math.sqrt(edges.reduce((sum,e)=>sum+e.matches.reduce((n,m)=>n+m.gain*m.gain,0),0)/best.pairs),exposureAfter=Math.sqrt(edges.reduce((sum,e)=>sum+e.matches.reduce((n,m)=>n+(m.gain+gains[e.i]-gains[e.j])**2,0),0)/best.pairs);
  if(best.after>2.5)throw Error('Residual alignment '+best.after.toFixed(3)+' exceeds the experimental quality limit; likely parallax, wrong lens or bad matches. Originals kept.');
  return{frames:frames.map((f,i)=>({...f,pose:best.poses[i],hfov:2*Math.atan(Math.tan(f.hfov*Math.PI/360)*best.scale)*180/Math.PI,radial:best.k1,gain:Math.exp(gains[i])})),report:{exposureBeforeLogRMS:exposureBefore,exposureAfterLogRMS:exposureAfter,excludedUnmatchedFrames:excluded,engine:'OpenCV AKAZE/RANSAC + bounded rotation graph',edges:edges.length,pairs:best.pairs,beforeDegrees:best.before,afterDegrees:best.after,focalScale:best.scale,radialK1:best.k1,wasmHeapBytes:cv.HEAPU8?.buffer.byteLength??null}};
 }finally{for(const f of features)f.desc.delete();orb?.delete();matcher?.delete()}
}
