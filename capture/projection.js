// Bounded, one-to-one lens projection shared by fitting and rendering.
export function makeLens(frame,{scale=1,k1=frame.radial??0}={}){
 const t=Math.tan(frame.hfov*Math.PI/360)*scale,tv=t/frame.aspect,hfov=2*Math.atan(t)*180/Math.PI;
 if(!Number.isFinite(t)||!Number.isFinite(tv)||tv<=0||hfov<35-1e-9||hfov>100+1e-9||!Number.isFinite(k1)||Math.abs(k1)>.120001)throw Error('Unsupported camera/lens model; originals kept.');
 const corner=Math.hypot(t,tv);let maxRadius=corner;
 if(k1){let low=0,high=k1<0?Math.sqrt(-1/(3*k1)):corner;
  if(k1<0&&corner>=high*(1+k1*high*high)*.999)throw Error('Lens correction folds the image; no panorama created.');
  for(let i=0;i<32;i++){const r=(low+high)/2;if(r*(1+k1*r*r)<corner)low=r;else high=r;}maxRadius=(low+high)/2;
 }
 return{t,tv,k1,maxRadius,maxRadius2:maxRadius*maxRadius};
}
export function undistortPoint(point,lens){
 if(!point.every(Number.isFinite)||Math.abs(point[0])>1.000001||Math.abs(point[1])>1.000001)throw Error('Invalid feature coordinate.');
 const xd=point[0]*lens.t,yd=point[1]*lens.tv,rd=Math.hypot(xd,yd);if(!rd)return[0,0,1];
 let r=rd;if(lens.k1){let low=0,high=lens.maxRadius;for(let i=0;i<24;i++){const m=(low+high)/2;if(m*(1+lens.k1*m*m)<rd)low=m;else high=m;}r=(low+high)/2;}
 const factor=r/rd,x=xd*factor,y=yd*factor,n=Math.hypot(x,y,1);return[x/n,y/n,1/n];
}
export function projectCamera(cx,cy,lens,out={}){
 const r2=cx*cx+cy*cy;if(!Number.isFinite(r2)||r2>lens.maxRadius2*(1+1e-8)||1+3*lens.k1*r2<=0)return null;
 const d=1+lens.k1*r2,px=cx*d/lens.t,py=cy*d/lens.tv,edge=Math.max(Math.abs(px),Math.abs(py));if(!Number.isFinite(edge)||edge>=1)return null;
 out.x=px;out.y=py;out.edge=edge;return out;
}
export function sampleRGB(pixels,w,h,x,y,out){
 if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Non-finite source coordinate.');
 const xx=Math.max(0,Math.min(w-1,x)),yy=Math.max(0,Math.min(h-1,y)),x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(x0+1,w-1),y1=Math.min(y0+1,h-1),dx=xx-x0,dy=yy-y0;
 for(let c=0;c<3;c++)out[c]=(pixels[(y0*w+x0)*4+c]*(1-dx)+pixels[(y0*w+x1)*4+c]*dx)*(1-dy)+(pixels[(y1*w+x0)*4+c]*(1-dx)+pixels[(y1*w+x1)*4+c]*dx)*dy;
 return out;
}
