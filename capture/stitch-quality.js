// Conservative overlap rejection guard, not a certification of photographic quality.
export class OverlapQuality {
 constructor(width=256,height=128){this.width=width;this.height=height;const n=width*height;this.count=new Uint8Array(n);this.sum=new Float32Array(n*3);this.square=new Float32Array(n*3);}
 add(index,rgb){this.count[index]++;for(let c=0;c<3;c++){this.sum[index*3+c]+=rgb[c];this.square[index*3+c]+=rgb[c]*rgb[c];}}
 assess(){const errors=[];let bad=0;for(let i=0;i<this.count.length;i++){const n=this.count[i];if(n<2)continue;let variance=0;for(let c=0;c<3;c++)variance+=Math.max(0,(this.square[i*3+c]-this.sum[i*3+c]**2/n)/(n-1));const rms=Math.sqrt(2*variance/3);if(!Number.isFinite(rms))throw Error('Invalid overlap samples; originals kept.');errors.push(rms);if(rms>40)bad++;}
  errors.sort((a,b)=>a-b);const sampled=errors.length,badFraction=bad/Math.max(1,sampled),p90=errors[Math.min(sampled-1,Math.floor(sampled*.9))]??0,mean=errors.reduce((s,x)=>s+x,0)/Math.max(1,sampled),rejected=sampled<128||badFraction>.25||p90>85;
  return{version:1,status:rejected?'rejected':'checks-passed-review-required',reviewable:!rejected,sampled,meanPairRGBRMS:mean,p90PairRGBRMS:p90,badFraction,thresholds:{pairRGBRMS:40,maxBadFraction:.25,maxP90:85,minSamples:128},limitations:'Sampled colour agreement can miss geometric errors and can reject exposure/moving-object differences. Visual review required.'};
 }
}
export function previewReviewable(report){const a=report?.alignment,p=a?.heldoutPixels;return report?.verification?.version===1&&report.verification.reviewable===true&&report.missing===0&&!report.diagnostic&&report.originalFrames>=2&&report.usedFrames===report.originalFrames&&a?.usedFrames===report.originalFrames&&a.originalFrames===report.originalFrames&&a.excludedUnmatchedFrames?.length===0&&Number.isFinite(p?.rms)&&p.rms<=3&&p.p90<=6&&p.invalid===0;}
