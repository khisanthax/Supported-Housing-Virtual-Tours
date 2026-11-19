// Device-independent visual/sensor estimate; not certified lens or distortion calibration.
import {basis,checkFrame,dot,deg,rad} from './math.js';
import {capturePlan} from './guidance.js';
export const planningOptions=measured=>({overlap:.4,fovScale:measured ? .95 : .85,maxFrames:96});
export function transposeFOV(hfov,aspect){if(!Number.isFinite(hfov)||hfov<=0||hfov>=180||!Number.isFinite(aspect)||aspect<=0)throw Error('Invalid camera geometry.');return deg(2*Math.atan(Math.tan(rad(hfov)/2)/aspect));}
export function sideMeasurement(reference,pose,side){
 for(const p of[reference,pose])checkFrame({hfov:65,aspect:1,pose:p});
 if(![-1,1].includes(side))throw Error('Choose a left or right calibration marker.');
 const z=dot(reference.f,pose.f),x=dot(reference.f,pose.r),y=dot(reference.f,pose.u);
 if(z<.6||side*x<=0||Math.abs(y/z)>.08)throw Error('Keep the same distant detail on the indicated marker, at the same height. Rotate around the lens.');
 const hfov=deg(2*Math.atan(Math.abs(x/z)/.7));
 if(hfov<35||hfov>100)throw Error('Camera estimate is outside the supported range. Repeat using a distant detail and the standard rear lens.');
 return hfov;
}
export function finishCalibration(left,right,aspect){
 if(![left,right].every(h=>Number.isFinite(h)&&h>=35&&h<=100))throw Error('Complete both camera measurements.');
 const a=Math.tan(rad(left)/2),b=Math.tan(rad(right)/2),spread=Math.abs(a-b)/((a+b)/2);
 if(spread>.1)throw Error('The two measurements disagree. Keep the phone at the same spot and repeat with a distant detail.');
 const hfov=deg(2*Math.atan((a+b)/2));checkFrame({hfov,aspect,pose:basis(0,0)});
 return{method:'visual-two-sided-sensor-estimate',hfov,aspect,spread,status:'estimated',measuredAt:Date.now()};
}
export function withCalibration(session,measurement){
 if(session.frames.length)throw Error('Saved photographs keep their original calibration and targets. Start another capture to calibrate this camera.');
 const {hfov,aspect}=measurement;checkFrame({hfov,aspect,pose:basis(0,0)});
 return{...session,hfov,aspect,plannerVersion:2,cameraCalibration:measurement,targets:capturePlan(hfov,aspect,planningOptions(true)),output:null,report:null};
}
