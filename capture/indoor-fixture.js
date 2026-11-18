// Procedural room, window, doorway, table and sofa. No real photographs.
export function indoorColor(v){
 const origin=[0,1.6,0],boxes=[{lo:[1.1,0,-1.5],hi:[2.7,.9,.4],c:[100,65,40]},{lo:[-1,.6,1],hi:[.3,.8,2.2],c:[150,85,40]}];let near=Infinity,point,side,base;
 for(const [axis,value]of[[0,-3],[0,3],[1,0],[1,3],[2,-4],[2,4]]){const t=(value-origin[axis])/v[axis];if(t>0&&t<near){near=t;point=v.map((x,i)=>origin[i]+t*x);side=axis;base=axis===1?(value===0?[145,110,75]:[215,213,202]):[185,170,145]}}
 for(const b of boxes){let enter=0,exit=Infinity,hitAxis=0;for(let k=0;k<3;k++){let a=(b.lo[k]-origin[k])/v[k],z=(b.hi[k]-origin[k])/v[k];if(a>z)[a,z]=[z,a];if(a>enter){enter=a;hitAxis=k}exit=Math.min(exit,z)}if(exit>enter&&enter>0&&enter<near){near=enter;point=v.map((x,i)=>origin[i]+enter*x);base=b.c;side=hitAxis}}
 const axes=[0,1,2].filter(i=>i!==side),u=point[axes[0]],w=point[axes[1]],ix=Math.floor(u*13),iy=Math.floor(w*13),hash=Math.sin(ix*127.1+iy*311.7)*43758.5453,f=hash-Math.floor(hash);
 if(side===0&&point[0]<-2.99&&point[2]>-.9&&point[2]<1.2&&point[1]>.9&&point[1]<2.4)return Math.abs(point[2])<.04||Math.abs(point[1]-1.65)<.04?[235,235,230]:[65,130,180];
 if(side===2&&point[2]>3.99&&Math.abs(point[0])<.7&&point[1]<2.3)return Math.abs(Math.abs(point[0])-.65)<.05?[230,230,220]:[65,55,45];
 const edge=Math.abs(u*13-Math.round(u*13))<.07||Math.abs(w*13-Math.round(w*13))<.07;
 return base.map((x,i)=>Math.max(0,Math.min(255,x+(edge?-45:(f-.5)*50)+((ix+iy)%7===0?20:0))));
}
