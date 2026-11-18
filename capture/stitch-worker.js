import{checkFrame}from'./math.js';
self.onmessage=async({data})=>{
 let sums,weights,rgba;const start=performance.now();
 try{
  const {frames,width=2048,quality=.92}=data;if(![1024,2048,4096].includes(width)||!Number.isFinite(quality)||quality<.7||quality>.98||!Array.isArray(frames)||frames.length<2||frames.length>64)throw Error('Invalid stitch settings.');
  if(frames.reduce((n,f)=>n+(f.blob?.size??0),0)>64*1024*1024)throw Error('Capture source size exceeds the local processing limit.');
  for(const f of frames){checkFrame(f);if(!(f.blob instanceof Blob)||f.blob.size>4*1024*1024)throw Error('Invalid capture frame.');}
  const height=width/2,n=width*height;sums=new Float32Array(n*3);weights=new Float32Array(n);const sin=new Float32Array(width),cos=new Float32Array(width);for(let x=0;x<width;x++){const lon=(x+.5)/width*2*Math.PI-Math.PI;sin[x]=Math.sin(lon);cos[x]=Math.cos(lon)}
  for(let i=0;i<frames.length;i++){
   const frame=frames[i];let bitmap;
   try{bitmap=await createImageBitmap(frame.blob);if(bitmap.width>1920||bitmap.height>1920||Math.abs(bitmap.width/bitmap.height-frame.aspect)>.02)throw Error('Capture dimensions changed; keep the same phone orientation.');
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data,w=bitmap.width,h=bitmap.height,t=Math.tan(frame.hfov*Math.PI/360),tv=t/frame.aspect,{r,u,f}=frame.pose;
    for(let y=0;y<height;y++){const lat=Math.PI/2-(y+.5)/height*Math.PI,wy=Math.sin(lat),cl=Math.cos(lat);for(let x=0;x<width;x++){
     const wx=cl*sin[x],wz=cl*cos[x],z=wx*f[0]+wy*f[1]+wz*f[2];if(z<=0)continue;const px=(wx*r[0]+wy*r[1]+wz*r[2])/z/t,py=(wx*u[0]+wy*u[1]+wz*u[2])/z/tv,edge=Math.max(Math.abs(px),Math.abs(py));if(edge>=1)continue;
     const xx=(px+1)*.5*(w-1),yy=(1-py)*.5*(h-1),x0=Math.floor(xx),y0=Math.floor(yy),dx=xx-x0,dy=yy-y0,index=y*width+x,weight=(1-edge)**2;
     for(let c=0;c<3;c++){const q=(y0*w+x0)*4+c,value=(pixels[q]*(1-dx)+pixels[q+4]*dx)*(1-dy)+(pixels[q+w*4]*(1-dx)+pixels[q+w*4+4]*dx)*dy;sums[index*3+c]+=value*weight}weights[index]+=weight;
    }}canvas.width=canvas.height=1;
   }finally{bitmap?.close()}
   self.postMessage({type:'progress',done:i+1,total:frames.length});
  }
  rgba=new Uint8ClampedArray(n*4);let missing=0;for(let j=0;j<n;j++){if(weights[j]===0){missing++;continue}for(let c=0;c<3;c++)rgba[j*4+c]=sums[j*3+c]/weights[j];rgba[j*4+3]=255}
  if(missing)throw Error('Missing coverage: '+(missing/n*100).toFixed(3)+'% of output pixels. Retake missing directions; captured photographs were kept.');
  const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);const blob=await canvas.convertToBlob({type:'image/jpeg',quality});canvas.width=canvas.height=1;
  const report={width,height,bytes:blob.size,quality,frames:frames.length,missing,ms:Math.round(performance.now()-start),estimatedWorkingBytes:n*(12+4+4)+1920*1920*8};
  if(blob.size>4*1024*1024)throw Error('Panorama is '+(blob.size/1048576).toFixed(2)+' MiB, over the existing 4 MiB limit. Explicitly choose a different resolution/quality and retry; no automatic quality reduction occurred.');
  self.postMessage({type:'result',blob,report});
 }catch(error){self.postMessage({type:'error',message:error.message})}finally{sums=weights=rgba=null;self.close()}
};
