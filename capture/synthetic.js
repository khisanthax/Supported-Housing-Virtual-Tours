import{plan,basis}from'./math.js';
// Analytic synthetic environment, not agency photography. Separate from the stitcher.
export function sceneColor(v){const yaw=Math.atan2(v[0],v[2]),pitch=Math.asin(v[1]),line=Math.abs(Math.sin(yaw*8))<.07||Math.abs(Math.sin(pitch*8))<.07;return line?[245,245,245]:v.map(x=>Math.round(110+90*x))}
export async function syntheticFrames({width=360,height=480,hfov=50,roll=0,exposure=false}={}){
 const aspect=width/height,targets=plan(hfov,aspect),frames=[];
 for(let i=0;i<targets.length;i++){const target=targets[i],pose=basis(target.yaw,target.pitch,roll*(i%2?1:-1)),canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height),t=Math.tan(hfov*Math.PI/360);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const px=(2*(x+.5)/width-1)*t,py=(1-2*(y+.5)/height)*t/aspect,v=pose.f.map((z,j)=>z+pose.r[j]*px+pose.u[j]*py),len=Math.hypot(...v),c=sceneColor(v.map(z=>z/len)),at=(y*width+x)*4,gain=exposure?(i%2?.8:1.2):1;for(let j=0;j<3;j++)image.data[at+j]=c[j]*gain;image.data[at+3]=255}ctx.putImageData(image,0,0);const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.98});frames.push({id:target.id,blob,pose,hfov,aspect,confidence:'synthetic',captured:Date.now()});canvas.width=canvas.height=1;
 }return{frames,targets,hfov,aspect};
}
