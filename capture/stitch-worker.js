import{checkFrame,photographedRows}from'./math.js';
import{makeLens,projectCamera,sampleRGB}from'./projection.js';
import{OverlapQuality}from'./stitch-quality.js';
self.onmessage=async({data})=>{
 let sums,weights,rgba;const start=performance.now();
 try{
  let {frames,width=2048,quality=.92}=data;let alignment=null;const improved=['features','features-ownership'].includes(data.engine),singleSource=data.engine==='features-ownership';if(![1024,2048,4096].includes(width)||!Number.isFinite(quality)||quality<.7||quality>.98||!Array.isArray(frames)||frames.length<2||frames.length>(data.plannerVersion===2?96:64))throw Error('Invalid stitch settings.');
  if(frames.reduce((n,f)=>n+(f.blob?.size??0),0)>64*1024*1024)throw Error('Capture source size exceeds the local processing limit.');
  for(const f of frames){checkFrame(f);makeLens(f);if(!Number.isFinite(f.gain??1)||(f.gain??1)<.5||(f.gain??1)>2)throw Error('Invalid exposure gain.');if(!(f.blob instanceof Blob)||f.blob.size>4*1024*1024)throw Error('Invalid capture frame.');}
  const originalFrames=frames.length;
  if(improved){const {alignFrames}=await import('./feature-align.js');const result=await alignFrames(frames,p=>self.postMessage({type:'alignment-progress',...p}));frames=result.frames;alignment=result.report;}
  if(frames.length!==originalFrames)throw Error('A source photo was omitted; no panorama created.');
  for(const f of frames){checkFrame(f);makeLens(f);if(!Number.isFinite(f.gain??1)||(f.gain??1)<.5||(f.gain??1)>2)throw Error('Invalid refined exposure gain.');}
  const height=width/2,rows=photographedRows(height,data.omitFloor===true),n=width*height,overlap=new OverlapQuality(),stride=width/overlap.width,half=Math.floor(stride/2);sums=new Float32Array(n*3);weights=new Float32Array(n);const sin=new Float32Array(width),cos=new Float32Array(width);for(let x=0;x<width;x++){const lon=(x+.5)/width*2*Math.PI-Math.PI;sin[x]=Math.sin(lon);cos[x]=Math.cos(lon)}
  for(let i=0;i<frames.length;i++){
   const frame=frames[i];let bitmap;
   try{bitmap=await createImageBitmap(frame.blob);if(bitmap.width>1920||bitmap.height>1920||Math.abs(bitmap.width/bitmap.height-frame.aspect)>.02)throw Error('Capture dimensions changed; keep the same phone orientation.');
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data,w=bitmap.width,h=bitmap.height,lens=makeLens(frame),point={},rgb=new Float64Array(3),{r,u,f}=frame.pose;
    for(let y=0;y<rows;y++){const lat=Math.PI/2-(y+.5)/height*Math.PI,wy=Math.sin(lat),cl=Math.cos(lat);for(let x=0;x<width;x++){
     const wx=cl*sin[x],wz=cl*cos[x],z=wx*f[0]+wy*f[1]+wz*f[2];if(z<=0)continue;const cx=(wx*r[0]+wy*r[1]+wz*r[2])/z,cy=(wx*u[0]+wy*u[1]+wz*u[2])/z;if(!projectCamera(cx,cy,lens,point))continue;
     const xx=(point.x+1)*.5*(w-1),yy=(1-point.y)*.5*(h-1),index=y*width+x,weight=(1-point.edge)**2;
     sampleRGB(pixels,w,h,xx,yy,rgb);for(let c=0;c<3;c++)rgb[c]*=frame.gain??1;
     if(weight>.04&&y%stride===half&&x%stride===half)overlap.add(Math.floor(y/stride)*overlap.width+Math.floor(x/stride),rgb);
     if(singleSource&&weight<=weights[index])continue;for(let c=0;c<3;c++){if(singleSource)sums[index*3+c]=rgb[c]*weight;else sums[index*3+c]+=rgb[c]*weight}if(singleSource)weights[index]=weight;else weights[index]+=weight;
    }}canvas.width=canvas.height=1;
   }finally{bitmap?.close()}
   self.postMessage({type:'progress',done:i+1,total:frames.length});
  }
  rgba=new Uint8ClampedArray(n*4);let missing=0;for(let j=0;j<n;j++){if(!Number.isFinite(weights[j])||!Number.isFinite(sums[j*3])||!Number.isFinite(sums[j*3+1])||!Number.isFinite(sums[j*3+2]))throw Error('Invalid projected pixels; no panorama created. Originals kept.');if(j>=rows*width){rgba.fill(42,j*4,j*4+3);rgba[j*4+3]=255;continue}if(weights[j]===0){missing++;continue}for(let c=0;c<3;c++)rgba[j*4+c]=sums[j*3+c]/weights[j];rgba[j*4+3]=255}
  if(missing&&!data.diagnosticMissingCoverage)throw Error('Missing coverage: '+(missing/n*100).toFixed(3)+'% of output pixels. Retake missing directions; captured photographs were kept.');
  const verification=overlap.assess(),rejected=!!missing||!verification.reviewable,diagnostic=rejected||!improved||singleSource;if(rejected&&!data.diagnosticQuality){const error=Error('Photographs disagree in overlapping areas or lack verification. No usable panorama was created. Original photos are kept.');error.diagnostics={verification,coverage:{missing,total:n,percent:100*(1-missing/n)},originalFrames,usedFrames:frames.length};throw error;}
  if(!improved||singleSource){verification.colourStatus=verification.status;verification.reviewable=false;verification.status=!improved?'diagnostic-only-no-feature-validation':'diagnostic-only-unvalidated-composition';}
  const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);const blob=await canvas.convertToBlob({type:'image/jpeg',quality});canvas.width=canvas.height=1;
  const cameraSolution=frames.map(f=>({id:f.id,pose:f.pose,hfov:f.hfov,aspect:f.aspect,radial:f.radial??0,gain:f.gain??1}));
  const report={floorCapDegrees:data.omitFloor===true?20:0,cameraSolution,engine:data.engine??"baseline",generatedAt:Date.now(),projectionVersion:2,verification,diagnostic,originalFrames,usedFrames:frames.length,alignment,composition:singleSource?'single-source ownership (diagnostic; no graph-cut seam)':improved?'refined feather (no optimized seam)':'feather baseline',width,height,bytes:blob.size,quality,frames:frames.length,missing,ms:Math.round(performance.now()-start),estimatedWorkingBytes:n*(12+4+4)+1920*1920*8+overlap.sum.byteLength+overlap.square.byteLength+overlap.count.byteLength};
  if(blob.size>4*1024*1024)throw Error('Panorama is '+(blob.size/1048576).toFixed(2)+' MiB, over the existing 4 MiB limit. Explicitly choose a different resolution/quality and retry; no automatic quality reduction occurred.');
  self.postMessage({type:'result',blob,report});
 }catch(error){self.postMessage({type:'error',message:error.message,diagnostics:error.diagnostics})}finally{sums=weights=rgba=null;self.close()}
};
