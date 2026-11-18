// Original rotation-graph experiment using OpenCV feature correspondences.
import {dot} from './math.js';
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n)};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function cameraRay(point,frame,scale=1,k1=0){
 const t=Math.tan(frame.hfov*Math.PI/360)*scale;
 let x=point[0]*t,y=point[1]*t/frame.aspect;
 // Invert a bounded one-coefficient radial model iteratively.
 const xd=x,yd=y;for(let i=0;i<5;i++){const d=1+k1*(x*x+y*y);x=xd/d;y=yd/d}
 return unit([x,y,1]);
}
const world=(v,p)=>v.map((_,i)=>p.r[i]*v[0]+p.u[i]*v[1]+p.f[i]*v[2]);
function rotate(v,w){const theta=Math.hypot(...w);if(theta<1e-12)return [...v];const a=w.map(x=>x/theta),c=Math.cos(theta),s=Math.sin(theta),ax=cross(a,v),av=dot(a,v);return v.map((x,i)=>x*c+ax[i]*s+a[i]*av*(1-c))}
export function refineRotations(frames,edges,{scale=1,k1=0,iterations=65}={}){
 const poses=frames.map(f=>structuredClone(f.pose));
 const pairs=edges.flatMap(e=>e.matches.map(m=>({i:e.i,j:e.j,a:cameraRay(m.a,frames[e.i],scale,k1),b:cameraRay(m.b,frames[e.j],scale,k1)})));
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
