// Independently implemented pinhole-camera/spherical geometry. No VFTCam source.
export const rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI;
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const direction=(yaw,pitch)=>[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
export function basis(yaw,pitch,roll=0){const f=direction(yaw,pitch),r=[Math.cos(yaw),0,-Math.sin(yaw)],u=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),-Math.cos(yaw)*Math.sin(pitch)],c=Math.cos(roll),s=Math.sin(roll);return{f,r:r.map((x,i)=>x*c+u[i]*s),u:u.map((x,i)=>x*c-r[i]*s)}}
export function checkFrame(frame){
 if(!frame||!Number.isFinite(frame.hfov)||frame.hfov<35||frame.hfov>100||!Number.isFinite(frame.aspect)||frame.aspect<0.4||frame.aspect>2.5)throw Error('Invalid camera field of view/aspect.');
 for(const k of ['r','u','f'])if(!Array.isArray(frame.pose?.[k])||frame.pose[k].length!==3||frame.pose[k].some(x=>!Number.isFinite(x))||Math.abs(dot(frame.pose[k],frame.pose[k])-1)>.01)throw Error('Invalid camera orientation.');
 if(Math.abs(dot(frame.pose.r,frame.pose.u))>.01||Math.abs(dot(frame.pose.f,frame.pose.u))>.01||Math.abs(dot(frame.pose.r,frame.pose.f))>.01)throw Error('Invalid camera axes.');
 return frame;
}
export function project(ray,frame){const z=dot(ray,frame.pose.f);if(z<=0)return null;const t=Math.tan(rad(frame.hfov)/2),x=dot(ray,frame.pose.r)/z/t,y=dot(ray,frame.pose.u)/z/(t/frame.aspect);return Math.abs(x)<1&&Math.abs(y)<1?{x:(x+1)/2,y:(1-y)/2,weight:Math.pow(1-Math.max(Math.abs(x),Math.abs(y)),2)}:null}
export function plan(hfov=65,aspect=4/3){
 checkFrame({hfov,aspect,pose:basis(0,0)});const vfov=deg(2*Math.atan(Math.tan(rad(hfov)/2)/aspect)),bands=Math.ceil(180/(vfov*.65)),targets=[];
 for(let band=1;band<bands;band++){const pitch=-90+180*band/bands,count=Math.ceil(360*Math.cos(rad(pitch))/(hfov*.65));for(let i=0;i<count;i++)targets.push({id:'target-'+targets.length,yaw:rad(i*360/count),pitch:rad(pitch)});}
 for(const pitch of [90,-90])targets.push({id:'target-'+targets.length,yaw:0,pitch:rad(pitch)});
 if(targets.length>64)throw Error('This lens/aspect needs more than 64 photos. Use a standard rear lens and verify its field of view.');return targets;
}
export function coverage(frames,width=144,height=72){let missing=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const ray=direction((x+.5)/width*2*Math.PI-Math.PI,Math.PI/2-(y+.5)/height*Math.PI);if(!frames.some(f=>project(ray,f)))missing++;}return{missing,total:width*height,percent:100*(1-missing/(width*height))}}
// W3C device axes: right +X, top +Y, outward screen +Z; rear camera looks -Z.
// Rotation is intrinsic Z-X'-Y''. Convert ENU world to X=east,Y=up,Z=north.
export function deviceBasis({alpha,beta,gamma},heading=0){
 if([alpha,beta,gamma].some(x=>!Number.isFinite(x)))throw Error('Motion sensor has no usable orientation.');
 const a=rad(alpha),b=rad(beta),g=rad(gamma),ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cg=Math.cos(g),sg=Math.sin(g);
 const turn=v=>{const x=cg*v[0]+sg*v[2],y=v[1],z=-sg*v[0]+cg*v[2],yy=cb*y-sb*z,zz=sb*y+cb*z,e=ca*x-sa*yy,n=sa*x+ca*yy;return[Math.cos(heading)*e-Math.sin(heading)*n,zz,Math.sin(heading)*e+Math.cos(heading)*n]};
 return{r:turn([1,0,0]),u:turn([0,1,0]),f:turn([0,0,-1])};
}
