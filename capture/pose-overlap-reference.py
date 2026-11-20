"""Local experiment: compare overlapping texture at directions predicted by phone poses.
Run with the private source ZIP and an output folder outside the checkout.
Requires native OpenCV, NumPy, SciPy. Outputs contain private photographs.
"""
import argparse
from pathlib import Path
import json
import os
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS","4000000")
import zipfile
import numpy as np
import cv2 as cv
from scipy.spatial.transform import Rotation
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix

W,H = 480,640
def camera(frame):
    tang=np.tan(np.deg2rad(frame['hfov'])/2)
    return np.array([[(W-1)/2/tang,0,(W-1)/2],[0,-(H-1)*frame['aspect']/2/tang,(H-1)/2],[0,0,1.]])

def transfer(points, matrix):
    p=np.column_stack((points,np.ones(len(points))))@matrix.T
    return p[:,:2]/p[:,2,None]

def search(tile,image,x,y,radius):
    h,w=tile.shape
    x0=max(0,x-radius-w//2);y0=max(0,y-radius-h//2)
    roi=image[y0:min(H,y+radius+h//2+1),x0:min(W,x+radius+w//2+1)]
    scores=cv.matchTemplate(roi,tile,cv.TM_CCOEFF_NORMED)
    _,score,_,(u,v)=cv.minMaxLoc(scores)
    scores[max(0,v-5):v+6,max(0,u-5):u+6]=-1
    if score<.80 or score-float(scores.max())<.045:return None
    return x0+u+w//2,y0+v+h//2

def pair(a,b,matrix):
    warped=cv.warpPerspective(a,matrix,(W,H))
    mask=cv.warpPerspective(np.full_like(a,255),matrix,(W,H))
    mask=cv.erode(mask,np.ones((25,25),np.uint8),borderType=cv.BORDER_CONSTANT,borderValue=0)
    corners=cv.goodFeaturesToTrack(warped,240,.003,11,mask=mask)
    if corners is None:return None
    left=[];right=[]
    for x,y in corners.reshape(-1,2).astype(int):
        r=11
        target=search(warped[y-r:y+r+1,x-r:x+r+1],b,x,y,50)
        if target is None:continue
        u,v=target
        back=search(b[v-r:v+r+1,u-r:u+r+1],warped,u,v,50)
        if back is None or np.hypot(back[0]-x,back[1]-y)>1.5:continue
        left.append([x,y]);right.append(target)
    if len(left)<12:return None
    axy=transfer(left,np.linalg.inv(matrix));bxy=np.array(right,dtype=float)
    _,mask=cv.findHomography(axy,bxy,cv.RANSAC,2.0)
    if mask is None or mask.sum()<12 or mask.mean()<.5:return None
    keep=mask.ravel()>0;axy=axy[keep];bxy=bxy[keep]
    if cv.contourArea(cv.convexHull(bxy.astype(np.float32)))<W*H*.008:return None
    return axy,bxy

def sift_pair(a,b,matrix,detector,reference):
    warped=cv.warpPerspective(a,matrix,(W,H))
    mask=cv.erode(cv.warpPerspective(np.full_like(a,255),matrix,(W,H)),np.ones((25,25),np.uint8),borderType=cv.BORDER_CONSTANT,borderValue=0)
    kp,desc=detector.detectAndCompute(warped,mask)
    kp2,desc2=reference
    if desc is None or desc2 is None:return None
    coords=np.float32([k.pt for k in kp]);dest=np.float32([k.pt for k in kp2])
    # Only compare within the pose-predicted search window.
    allowed=np.uint8(np.sum((coords[:,None]-dest[None,:])**2,axis=2)<50**2)
    ms=cv.BFMatcher(cv.NORM_L2).knnMatch(desc,desc2,k=2,mask=allowed)
    good=[r[0] for r in ms if len(r)==2 and r[0].distance<.72*r[1].distance]
    # Do not count several orientations at the same corner as separate evidence.
    chosen=[];seen=set()
    for m in sorted(good,key=lambda m:m.distance):
        cell=tuple(np.floor(dest[m.trainIdx]/6).astype(int))
        if cell not in seen:chosen.append(m);seen.add(cell)
    if len(chosen)<12:return None
    aa=transfer(coords[[m.queryIdx for m in chosen]],np.linalg.inv(matrix));bb=dest[[m.trainIdx for m in chosen]]
    _,mask=cv.findHomography(aa,bb,cv.RANSAC,2.)
    if mask is None or mask.sum()<12 or mask.mean()<.5:return None
    take=mask.ravel()>0
    if cv.contourArea(cv.convexHull(bb[take]))<W*H*.008:return None
    return aa[take],bb[take]

def project_errors(x,rots,ks,ii,jj,aa,bb):
    rr=Rotation.from_rotvec(x[:-1].reshape(-1,3)).as_matrix()@rots
    focal=np.exp(x[-1])
    rays=np.stack(((aa[:,0]-ks[ii,0,2])/ks[ii,0,0]/focal,(aa[:,1]-ks[ii,1,2])/ks[ii,1,1]/focal,np.ones(len(ii))),axis=1)
    world=(rr[ii]@rays[:,:,None])
    dst=(rr[jj].transpose(0,2,1)@world)[:,:,0]
    xy=dst[:,:2]/np.maximum(dst[:,2,None],.01)
    return xy*np.stack((ks[jj,0,0],ks[jj,1,1]),axis=1)*focal+ks[jj,:2,2]-bb

def render(colors,rots,ks,scale,path):
    w,h=2048,1024
    yaw,pitch=np.meshgrid(((np.arange(w)+.5)/w-.5)*2*np.pi,(.5-(np.arange(h)+.5)/h)*np.pi)
    world=np.stack((np.sin(yaw)*np.cos(pitch),np.sin(pitch),np.cos(yaw)*np.cos(pitch)),axis=2).astype('float32')
    sums=np.zeros((h,w,3),'float32');total=np.zeros((h,w),'float32');owner=np.zeros_like(sums);best=total.copy()
    for im,rot,k in zip(colors,rots,ks):
        rays=world@rot.astype('float32');z=np.maximum(rays[:,:,2],.001)
        u=rays[:,:,0]/z*(k[0,0]*scale)+k[0,2];v=rays[:,:,1]/z*(k[1,1]*scale)+k[1,2]
        weight=np.maximum(0,1-np.maximum(abs(u/k[0,2]-1),abs(v/k[1,2]-1)))**2*(rays[:,:,2]>0)
        view=cv.remap(im,u.astype('float32'),v.astype('float32'),cv.INTER_LINEAR)
        sums+=weight[:,:,None]*view;total+=weight
        keep=weight>best;owner[keep]=view[keep];best[keep]=weight[keep]
    mixed=sums/np.maximum(total[:,:,None],1.e-10)
    for label,img in [('blend',mixed),('single',owner)]:
        img[pitch<np.deg2rad(-70)]=42
        cv.imwrite(str(path.with_name(path.name+'-'+label+'.jpg')),np.uint8(np.clip(img,0,255)))

def seam_preview(colors,rots,ks,scale,out):
    # Choose seams on a reduced sphere, then composite at double that resolution.
    w,h=1024,512
    def layers(w,h):
        x,y=np.meshgrid(((np.arange(w)+.5)/w-.5)*2*np.pi,(.5-(np.arange(h)+.5)/h)*np.pi)
        ray=np.stack([np.sin(x)*np.cos(y),np.sin(y),np.cos(x)*np.cos(y)],axis=2).astype('float32')
        for color,rot,k in zip(colors,rots,ks):
            vec=ray@rot.astype('float32');z=np.maximum(.001,vec[:,:,2])
            u=vec[:,:,0]/z*k[0,0]*scale+k[0,2];v=vec[:,:,1]/z*k[1,1]*scale+k[1,2]
            score=np.maximum(0,1-np.maximum(abs(u/k[0,2]-1),abs(v/k[1,2]-1)))*(vec[:,:,2]>0)
            yield cv.remap(color,u.astype('float32'),v.astype('float32'),cv.INTER_LINEAR),score
    views=list(layers(w,h));best=np.maximum.reduce([s for _,s in views])
    origins=[];images=[];masks=[]
    for im,weight in views:
        mask=np.uint8((weight>.001)&(weight>=best*.65))*255
        x,y,ww,hh=cv.boundingRect(mask)
        if not ww:raise ValueError('Photograph has no owned area')
        origins.append((x,y));images.append(im[y:y+hh,x:x+ww].astype('float32'));masks.append(cv.UMat(mask[y:y+hh,x:x+ww]))
    cut=cv.detail_GraphCutSeamFinder('COST_COLOR_GRAD').find(images,origins,masks)
    result=np.zeros((h*2,w*2,3),'uint8');highest=np.full((h*2,w*2),-1.,'float32');owners=np.full(highest.shape,-1)
    for i,((im,weight),mask,(x,y)) in enumerate(zip(layers(w*2,h*2),cut,origins)):
        small=np.zeros((h,w),'uint8');patch=mask.get();hh,ww=patch.shape;small[y:y+hh,x:x+ww]=patch
        score=weight+cv.resize(small,(w*2,h*2),interpolation=cv.INTER_NEAREST)/255
        keep=(weight>0)&(score>highest);result[keep]=im[keep];highest[keep]=score[keep];owners[keep]=i
    start=int(np.ceil(h*2*160/180-.5));result[start:]=42
    cv.imwrite(str(out/'guided-seams-diagnostic.jpg'),result)
    return np.bincount(owners[:start][owners[:start]>=0],minlength=len(colors)).tolist()

def main():
    p=argparse.ArgumentParser();p.add_argument('zip');p.add_argument('out',type=Path);args=p.parse_args()
    out=args.out.resolve()
    if out.is_relative_to(Path(__file__).resolve().parents[1]):raise ValueError('Private output must be outside the checkout')
    out.mkdir(exist_ok=True,parents=True)
    cv.setNumThreads(2)
    with zipfile.ZipFile(args.zip) as z:
        if sum(info.file_size for info in z.infolist())>75*1024**2:raise ValueError('Archive too large')
        m=json.loads(z.read('capture.json'));floor={t['id'] for t in m['targets'] if abs(t['pitch']+np.pi/2)<1.e-6}
        frames=[f for f in m['frames'] if f['id'] not in floor]
        if not 2<=len(frames)<=96 or any(z.getinfo(f['file']).file_size>4*1024**2 for f in frames):raise ValueError('Unsupported source size or frame count')
        colors=[cv.resize(cv.imdecode(np.frombuffer(z.read(f['file']),np.uint8),1),(W,H),interpolation=cv.INTER_AREA) for f in frames]
    imgs=[cv.cvtColor(c,cv.COLOR_BGR2GRAY) for c in colors]
    rots=np.array([np.array([f['pose'][k] for k in ('r','u','f')]).T for f in frames]);ks=np.array([camera(f) for f in frames])
    edges=[];done=set()
    detector=cv.SIFT_create(nfeatures=1800,contrastThreshold=.015)
    reference=[detector.detectAndCompute(im,None) for im in imgs]
    for i in range(len(frames)):
        near=np.argsort(-(rots[:,:,2]@rots[i,:,2]))
        for j in near[1:11]:
            key=tuple(sorted((i,int(j))))
            if key in done:continue
            done.add(key)
            if rots[i,:,2]@rots[j,:,2]<.25:continue
            matrix=ks[j]@rots[j].T@rots[i]@np.linalg.inv(ks[i])
            match=pair(imgs[i],imgs[j],matrix)
            if match is None:
                match=sift_pair(imgs[i],imgs[j],matrix,detector,reference[j])
            if match is None:
                reverse=sift_pair(imgs[j],imgs[i],np.linalg.inv(matrix),detector,reference[i])
                if reverse is not None:match=reverse[::-1]
            if match is not None:edges.append((i,int(j),*match))
    degree=[sum(i==k or j==k for i,j,*_ in edges) for k in range(len(frames))]
    print('pairs',len(edges),'degree',degree,flush=True)
    if not edges:return
    # Private scratch cache for local render comparisons.
    np.savez_compressed(out/'edges.npz',**{f'{i}-{j}':np.column_stack((a,b)) for i,j,a,b in edges})
    n=len(frames);rows=[(i,j,a,b,k%5==0) for i,j,aa,bb in edges for k,(a,b) in enumerate(zip(aa,bb))]
    ii,jj,aa,bb,test=map(np.array,zip(*rows));train=~test
    x=np.zeros(3*n+1)
    jac=lil_matrix((2*int(train.sum()),len(x)),dtype=int)
    for row,(i,j) in enumerate(zip(ii[train],jj[train])):
        for idx in (i,j):jac[2*row:2*row+2,3*idx:3*idx+3]=1
    jac[:,-1]=1
    def err(x,sel):return project_errors(x,rots,ks,ii[sel],jj[sel],aa[sel],bb[sel])
    fit=least_squares(lambda x:err(x,train).ravel(),x,jac_sparsity=jac.tocsr(),loss='soft_l1',f_scale=2,bounds=(-.35,.35),max_nfev=80)
    old=np.linalg.norm(err(x,test),axis=1);new=np.linalg.norm(err(fit.x,test),axis=1)
    def stats(a):return dict(count=len(a),rms=round(float(np.sqrt(np.mean(a*a))),2),p90=round(float(np.percentile(a,90)),2)) if len(a) else {}
    result=dict(frameCount=n,pairs=len(edges),focalScale=float(np.exp(fit.x[-1])),before=stats(old),after=stats(new),perFrame=[])
    for k,f in enumerate(frames):
        sel=(ii[test]==k)|(jj[test]==k)
        result['perFrame'].append(dict(file=f['file'],neighbors=degree[k],before=stats(old[sel]),after=stats(new[sel])))
    (out/'metrics.json').write_text(json.dumps(result,indent=2))
    render(colors,rots,ks,1,out/'sensor');render(colors,Rotation.from_rotvec(fit.x[:-1].reshape(-1,3)).as_matrix()@rots,ks,np.exp(fit.x[-1]),out/'guided')
    np.savez(out/'cameras.npz',rot=Rotation.from_rotvec(fit.x[:-1].reshape(-1,3)).as_matrix()@rots,ks=ks,scale=np.exp(fit.x[-1]))
    result['seamPreviewVisiblePixels']=seam_preview(colors,Rotation.from_rotvec(fit.x[:-1].reshape(-1,3)).as_matrix()@rots,ks,np.exp(fit.x[-1]),out)
    (out/'metrics.json').write_text(json.dumps(result,indent=2))
    print(result['before'],result['after'],flush=True)
if __name__=='__main__':main()
