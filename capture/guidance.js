// Original visual guidance. No VFTCam implementation or assets are used.
import {plan,basis,dot,rad,deviceBasis} from './math.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const angle=(a,b)=>Math.acos(clamp(dot(a,b),-1,1));

// Map device-native horizontal/vertical axes to the current display axes.
// Screen angle changes during a session pause capture; this angle stays fixed.
export function cameraBasis(reading,heading=0,screenAngle=0){
  const p=deviceBasis(reading,heading),a=rad(screenAngle),c=Math.cos(a),s=Math.sin(a);
  return{f:p.f,r:p.r.map((v,i)=>v*c-p.u[i]*s),u:p.u.map((v,i)=>p.r[i]*s+v*c)};
}

export function capturePlan(hfov,aspect){
  const targets=plan(hfov,aspect);
  // Begin level and facing forward, then sweep each row, including both poles.
  if(!targets.some(t=>Math.abs(t.pitch)<.001))targets.push({id:'target-start',yaw:0,pitch:0});
  if(targets.length>64)throw Error('This camera needs too many photographs. Use the standard rear lens.');
  const order=p=>Math.abs(p)<.001?0:p>0?Math.abs(p):Math.PI+Math.abs(p);
  return targets.sort((a,b)=>order(a.pitch)-order(b.pitch)||a.yaw-b.yaw);
}

export function targetLabel(target){
  if(target.pitch>1.3)return 'Ceiling — point straight up';
  if(target.pitch< -1.3)return 'Floor — point straight down';
  const row=Math.abs(target.pitch)<.15?'Middle row':target.pitch>0?'Upper row':'Lower row';
  const names=['front','front right','right','back right','back','back left','left','front left'];
  const i=Math.round(((target.yaw%(Math.PI*2)+Math.PI*2)%(Math.PI*2))/(Math.PI/4))%8;
  return row+' · '+names[i];
}

export function projectTarget(target,pose,hfov,aspect){
  const ray=basis(target.yaw,target.pitch).f,x=dot(ray,pose.r),y=dot(ray,pose.u),z=dot(ray,pose.f),t=Math.tan(rad(hfov)/2);
  const vertical=z<=0&&Math.abs(y)>Math.hypot(x,z);
  const px=z>0?x/z/t:vertical?0:Math.sign(Math.atan2(x,z)||1)*4,py=z>0?-y/z/(t/aspect):-y*4;
  const visible=z>0&&Math.abs(px)<=.88&&Math.abs(py)<=.82;
  const hint=Math.abs(py)>Math.abs(px)?(py<0?'Look up ↑':'Look down ↓'):(px<0?'Turn left ←':'Turn right →');
  return{x:.5+clamp(px,-.88,.88)/2,y:.5+clamp(py,-.82,.82)/2,visible,hint,error:angle(ray,pose.f)};
}

export class StableTarget {
  constructor(){this.reset()}
  reset(){this.previous=null;this.since=null;this.samples=0;this.latched=false;this.target=null;this.state={progress:0,ready:false,aligned:false,steady:false,jump:false}}
  observe(pose,target,now,enabled=true,insideCircle=true){
    if(this.target!==target.id){this.reset();this.target=target.id}
    const previous=this.previous,dt=previous?now-previous.now:0;
    const movement=previous?Math.max(angle(previous.pose.f,pose.f),angle(previous.pose.r,pose.r)):0;
    const jump=!!previous&&dt>0&&dt<250&&movement>rad(40);
    const steady=!!previous&&dt>0&&dt<=250&&movement/(dt/1000)<=rad(10);
    const aligned=insideCircle&&angle(pose.f,basis(target.yaw,target.pitch).f)<=rad(4);
    if(!enabled||!aligned||!steady||jump){this.since=null;this.samples=0}
    else{this.since??=now;this.samples++}
    const progress=this.since===null?0:clamp((now-this.since)/800,0,1);
    this.previous={pose,now};
    return this.state={progress,aligned,steady,jump,ready:enabled&&!this.latched&&progress===1&&this.samples>=6};
  }
  consume(){if(this.latched||!this.state.ready)return false;this.latched=true;return true}
}
