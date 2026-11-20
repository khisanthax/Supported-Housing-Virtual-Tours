// Camera pose predicts a search area. Only image evidence can add an edge.
import {dot} from './math.js';

function calibration(frame, width, height) {
  const cx=(width-1)/2, cy=(height-1)/2, t=Math.tan(frame.hfov*Math.PI/360);
  return {cx,cy,fx:cx/t,fy:-cy*frame.aspect/t};
}

function homography(a,b,ka,kb) {
  const axes=a.pose;
  const columns=[
    axes.r.map(v=>v/ka.fx),
    axes.u.map(v=>v/ka.fy),
    axes.f.map((v,i)=>v-ka.cx*axes.r[i]/ka.fx-ka.cy*axes.u[i]/ka.fy)
  ];
  const rows=[b.pose.r.map((v,i)=>kb.fx*v+kb.cx*b.pose.f[i]),
              b.pose.u.map((v,i)=>kb.fy*v+kb.cy*b.pose.f[i]),b.pose.f];
  return rows.flatMap(row=>columns.map(col=>dot(row,col)));
}

async function grayFrame(cv,frame) {
  const bitmap=await createImageBitmap(frame.blob);
  try {
    const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
    const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const src=cv.matFromImageData(ctx.getImageData(0,0,canvas.width,canvas.height)),gray=new cv.Mat();
    try {cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);return gray}
    catch(error){gray.delete();throw error}
    finally {src.delete();canvas.width=canvas.height=1}
  } finally {bitmap.close()}
}

function search(cv,from,to,x,y,radius) {
  const half=11, size=2*half+1;
  if(x<half||y<half||x+half>=from.cols||y+half>=from.rows)return null;
  const left=Math.max(0,x-radius-half),top=Math.max(0,y-radius-half);
  const right=Math.min(to.cols,x+radius+half+1),bottom=Math.min(to.rows,y+radius+half+1);
  if(right-left<size||bottom-top<size)return null;
  const tile=from.roi(new cv.Rect(x-half,y-half,size,size));
  const area=to.roi(new cv.Rect(left,top,right-left,bottom-top)),scores=new cv.Mat();
  try {
    cv.matchTemplate(area,tile,scores,cv.TM_CCOEFF_NORMED);
    const {maxVal,maxLoc}=cv.minMaxLoc(scores);
    if(!Number.isFinite(maxVal)||maxVal<.80)return null;
    const values=scores.data32F,rows=scores.rows,cols=scores.cols;
    for(let v=0;v<rows;v++)for(let u=0;u<cols;u++){
      if(Math.abs(u-maxLoc.x)<=5&&Math.abs(v-maxLoc.y)<=5)continue;
      if(values[v*cols+u]>maxVal-.045)return null;
    }
    return [left+maxLoc.x+half,top+maxLoc.y+half];
  } finally {tile.delete();area.delete();scores.delete()}
}

function guidedPair(cv,a,b,fa,fb) {
  const ka=calibration(fa,a.cols,a.rows),kb=calibration(fb,b.cols,b.rows);
  const transform=cv.matFromArray(3,3,cv.CV_64F,homography(fa,fb,ka,kb));
  const inverse=homography(fb,fa,kb,ka);
  const projected=new cv.Mat(),corners=new cv.Mat(),dstSize=new cv.Size(b.cols,b.rows);
  const matches=[];
  try {
    cv.warpPerspective(a,projected,transform,dstSize);
    const footprint=new cv.Mat(a.rows,a.cols,cv.CV_8UC1,new cv.Scalar(255));
    const supportMask=new cv.Mat(),kernel=cv.Mat.ones(25,25,cv.CV_8U);
    try {
      cv.warpPerspective(footprint,supportMask,transform,dstSize);
      cv.erode(supportMask,supportMask,kernel);
      cv.goodFeaturesToTrack(projected,corners,240,.003,11,supportMask);
    }finally{kernel.delete();supportMask.delete();footprint.delete()}
    for(let i=0;i<corners.rows;i++){
      const x=Math.round(corners.data32F[i*2]),y=Math.round(corners.data32F[i*2+1]);
      const z=inverse[6]*x+inverse[7]*y+inverse[8];
      if(z<=0)continue;
      const u=(inverse[0]*x+inverse[1]*y+inverse[2])/z,v=(inverse[3]*x+inverse[4]*y+inverse[5])/z;
      // Also verify the footprint of the warped template stays inside the source.
      if(![-12,12].every(dx=>[-12,12].every(dy=>{
        const px=x+dx,py=y+dy,w=inverse[6]*px+inverse[7]*py+inverse[8];
        const sx=(inverse[0]*px+inverse[1]*py+inverse[2])/w,sy=(inverse[3]*px+inverse[4]*py+inverse[5])/w;
        return w>0&&sx>=1&&sx<a.cols-1&&sy>=1&&sy<a.rows-1;
      })))continue;
      const found=search(cv,projected,b,x,y,50);
      if(!found)continue;
      const back=search(cv,b,projected,...found,50);
      if(!back||Math.hypot(back[0]-x,back[1]-y)>1.5)continue;
      matches.push({a:[u/ka.cx-1,1-v/ka.cy],b:[found[0]/kb.cx-1,1-found[1]/kb.cy],
        gain:Math.log(Math.max(15,projected.ucharAt(y,x))/Math.max(15,b.ucharAt(found[1],found[0]))),
        src:[u,v],dst:found});
    }
    if(matches.length<12)return [];
    const src=cv.matFromArray(matches.length,1,cv.CV_32FC2,matches.flatMap(m=>m.src));
    const dst=cv.matFromArray(matches.length,1,cv.CV_32FC2,matches.flatMap(m=>m.dst)),mask=new cv.Mat();
    let h;
    try {
      h=cv.findHomography(src,dst,cv.RANSAC,2,mask);
      if(h.empty())return [];
      const inliers=matches.filter((_,i)=>mask.data[i]);
      if(inliers.length<12||inliers.length<matches.length*.5)return [];
      const points=cv.matFromArray(inliers.length,1,cv.CV_32FC2,inliers.flatMap(m=>m.dst)),hull=new cv.Mat();
      try {cv.convexHull(points,hull);return cv.contourArea(hull)>=b.rows*b.cols*.008?inliers:[]}
      finally{points.delete();hull.delete()}
    } finally {h?.delete();src.delete();dst.delete();mask.delete()}
  } finally {projected.delete();corners.delete();transform.delete()}
}

export async function recoverPoseOverlaps(cv,frames,edges,progress) {
  const used=new Set(edges.flatMap(e=>[e.i,e.j])),added=[];
  const missing=frames.map((_,i)=>i).filter(i=>!used.has(i));
  // Bound retry cost on a phone. Duplicate pairs cannot become independent evidence.
  if(!used.size||missing.length>8)return added;
  const attempted=new Set();
  let frontier=missing;
  while(frontier.length){
    const anchors=Array.from(used);
    const pending=[];
    for(const i of frontier){
      const neighbors=anchors.map(j=>({j,similarity:dot(frames[i].pose.f,frames[j].pose.f)}))
        .filter(n=>n.similarity>.25).sort((a,b)=>b.similarity-a.similarity).slice(0,10)
        .filter(({j})=>!attempted.has(i+':'+j));
      if(!neighbors.length){pending.push(i);continue}
      const a=await grayFrame(cv,frames[i]);
      try {
        for(const {j} of neighbors){
          attempted.add(i+':'+j);
          progress({stage:'guided-overlap',done:i+1,total:frames.length});
          const b=await grayFrame(cv,frames[j]);
          try {
            let matches=guidedPair(cv,a,b,frames[i],frames[j]);
            if(!matches.length){
              matches=guidedPair(cv,b,a,frames[j],frames[i]).map(m=>({a:m.b,b:m.a,gain:-m.gain}));
            }
            if(matches.length){
              edges.push({i,j,matches});
              added.push({i,j,inliers:matches.length});
              used.add(i);
            }
          }finally{b.delete()}
        }
      }finally{a.delete()}
      if(!used.has(i))pending.push(i);
    }
    if(pending.length===frontier.length)break;
    frontier=pending;
  }
  return added;
}
