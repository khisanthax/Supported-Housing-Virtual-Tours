// Original rotation-graph experiment using OpenCV feature correspondences.
import {dot} from './math.js';
import {makeLens,undistortPoint,projectCamera} from './projection.js';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function cameraRay(point,frame,scale=1,k1=0,lens=makeLens(frame,{scale,k1})){return undistortPoint(point,lens);}

const world=(v,p)=>v.map((_,i)=>p.r[i]*v[0]+p.u[i]*v[1]+p.f[i]*v[2]);
function rotate(v,w){const theta=Math.hypot(...w);if(theta<1e-12)return [...v];const a=w.map(x=>x/theta),c=Math.cos(theta),s=Math.sin(theta),ax=cross(a,v),av=dot(a,v);return v.map((x,i)=>x*c+ax[i]*s+a[i]*av*(1-c))}
export function refineRotations(frames,edges,{scale=1,k1=0,iterations=65}={}){
 const poses=frames.map(f=>structuredClone(f.pose)),lenses=frames.map(f=>makeLens(f,{scale,k1}));
 const pairs=edges.flatMap(e=>e.matches.map(m=>({i:e.i,j:e.j,a:cameraRay(m.a,frames[e.i],scale,k1,lenses[e.i]),b:cameraRay(m.b,frames[e.j],scale,k1,lenses[e.j])})));
 const error=()=>{let sum=0;for(const p of pairs){const a=world(p.a,poses[p.i]),b=world(p.b,poses[p.j]);sum+=Math.acos(Math.max(-1,Math.min(1,dot(a,b))))**2}return Math.sqrt(sum/Math.max(1,pairs.length))*180/Math.PI};
 const before=error();
 for(let iteration=0;iteration<iterations;iteration++){
  const delta=poses.map(()=>[0,0,0]),weight=poses.map(()=>0);
  for(const p of pairs){const a=world(p.a,poses[p.i]),b=world(p.b,poses[p.j]),v=cross(b,a),norm=Math.hypot(...v),w=Math.min(1,.035/Math.max(norm,1e-8));for(let k=0;k<3;k++){delta[p.j][k]+=v[k]*w;delta[p.i][k]-=v[k]*w}weight[p.i]+=w;weight[p.j]+=w}
  for(let i=1;i<poses.length;i++)if(weight[i]){const w=delta[i].map(x=>x/weight[i]*.7);for(const key of ['f','r','u'])poses[i][key]=rotate(poses[i][key],w)}
 }
 return{poses,before,after:error(),pairs:pairs.length};
}
export function connectedFrames(count,edges){const seen=new Set([0]);for(let n=0;n<count;n++)for(const e of edges){if(seen.has(e.i))seen.add(e.j);if(seen.has(e.j))seen.add(e.i)}return seen.size===count}

export function bearingResidual(frames,edges,poses,{scale=1,k1=0}={}){
 const lenses=frames.map(f=>makeLens(f,{scale,k1}));let sum=0,count=0;
 for(const e of edges)for(const m of e.matches){const a=world(cameraRay(m.a,frames[e.i],scale,k1,lenses[e.i]),poses[e.i]),b=world(cameraRay(m.b,frames[e.j],scale,k1,lenses[e.j]),poses[e.j]);sum+=Math.acos(Math.max(-1,Math.min(1,dot(a,b))))**2;count++;}
 return{degrees:Math.sqrt(sum/Math.max(1,count))*180/Math.PI,pairs:count};
}

// One bounded interpolation, rather than unconstrained distortion fitting.
export function interpolateScale(profile){
 const p=[...profile].sort((a,b)=>a.scale-b.scale),i=p.findIndex(v=>v.error===Math.min(...p.map(x=>x.error)));if(i<1||i>=p.length-1)return null;
 const [a,b,c]=p.slice(i-1,i+2),x0=Math.log(a.scale),x1=Math.log(b.scale),x2=Math.log(c.scale),y0=a.error**2,y1=b.error**2,y2=c.error**2,d01=(y1-y0)/(x1-x0),d12=(y2-y1)/(x2-x1),A=(d12-d01)/(x2-x0),B=d01-A*(x0+x1),x=-B/(2*A);
 return A>0&&x>x0&&x<x2?Math.exp(x):null;
}
export function pixelResidual(frames,edges,poses,features,{scale=1,k1=0}={}){
 const lenses=frames.map(f=>makeLens(f,{scale,k1})),errors=[];let invalid=0;
 for(const e of edges)for(const m of e.matches)for(const [i,j,a,b]of[[e.i,e.j,m.a,m.b],[e.j,e.i,m.b,m.a]]){
  const ray=world(cameraRay(a,frames[i],scale,k1,lenses[i]),poses[i]),z=dot(ray,poses[j].f),pixel=z>0?projectCamera(dot(ray,poses[j].r)/z,dot(ray,poses[j].u)/z,lenses[j]):null;
  if(!pixel){invalid++;continue}errors.push(Math.hypot((pixel.x-b[0])*(features[j].w-1)/2,(pixel.y-b[1])*(features[j].h-1)/2));
 }
 errors.sort((a,b)=>a-b);return{rms:Math.sqrt(errors.reduce((n,e)=>n+e*e,0)/Math.max(1,errors.length)),p90:errors[Math.min(errors.length-1,Math.floor(errors.length*.9))]??Infinity,samples:errors.length,invalid};
}
