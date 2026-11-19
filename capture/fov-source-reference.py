# Optional local reference utility; requires separately installed OpenCV/numpy.
# Never a runtime dependency or a certified camera calibration.
import os
os.environ.setdefault('OPENCV_IO_MAX_IMAGE_PIXELS','4000000')
import cv2,numpy as np,zipfile,json,sys
from pathlib import Path
if len(sys.argv)!=3:raise SystemExit('Usage: python capture/fov-source-reference.py SOURCE.zip PRIVATE_REPORT.json')
archive=Path(sys.argv[1])
if archive.stat().st_size>100*1024*1024:raise ValueError('Archive exceeds analysis bound')
z=zipfile.ZipFile(archive)
if sum(i.file_size for i in z.infolist())>70*1024*1024 or z.getinfo('capture.json').file_size>1024*1024:raise ValueError('Extracted data exceeds analysis bound')
meta=json.loads(z.read('capture.json'));fs=meta['frames']
if not 2<=len(fs)<=96:raise ValueError('Unsupported frame count')
det=cv2.SIFT_create(nfeatures=2500);cv2.setNumThreads(2);features=[]
for f in fs:
 if z.getinfo(f['file']).file_size>4*1024*1024:raise ValueError('Image exceeds source bound')
 im=cv2.imdecode(np.frombuffer(z.read(f['file']),np.uint8),0);h,w=im.shape;scale=min(1,800/max(w,h));im=cv2.resize(im,(round(w*scale),round(h*scale)));h,w=im.shape;kp,de=det.detectAndCompute(cv2.equalizeHist(im),None);points=np.array([[2*k.pt[0]/(w-1)-1,1-2*k.pt[1]/(h-1)] for k in kp]);features.append((points,de,w,h))
pairs=[];matcher=cv2.BFMatcher(cv2.NORM_L2)
for i in range(len(fs)):
 for j in range(i+1,len(fs)):
  if np.dot(fs[i]['pose']['f'],fs[j]['pose']['f'])<.05:continue
  a,da,wa,ha=features[i];b,db,wb,hb=features[j]
  if da is None or db is None or len(da)<12 or len(db)<12:continue
  ms=[m for m,n in matcher.knnMatch(da,db,k=2) if m.distance<.72*n.distance]
  if len(ms)<12:continue
  pa=np.array([a[m.queryIdx] for m in ms]);pb=np.array([b[m.trainIdx] for m in ms]);pix=lambda p,w,h:(p*np.array([1,-1])+1)*np.array([w,h])/2
  H,mask=cv2.findHomography(pix(pa,wa,ha),pix(pb,wb,hb),cv2.RANSAC,2.5)
  if mask is None or mask.sum()<12 or mask.mean()<=.35:continue
  pairs.append((i,j,pa[mask.ravel()>0][:100],pb[mask.ravel()>0][:100]))
def world(points,f,h):
 t=np.tan(np.deg2rad(h)/2);v=np.column_stack([points[:,0]*t,points[:,1]*t/f['aspect'],np.ones(len(points))]);v/=np.linalg.norm(v,axis=1)[:,None];return v@np.array([f['pose'][k] for k in ['r','u','f']])
def errs(pair,h):
 i,j,a,b=pair;va=world(a,fs[i],h);vb=world(b,fs[j],h);return np.rad2deg(np.arccos(np.clip((va*vb).sum(axis=1),-1,1)))
allPairs=len(pairs);pairs=[p for p in pairs if np.median(errs(p,65))<10];
if len(pairs)<3:raise ValueError('Too few plausible pairs for a diagnostic FOV fit')
grid=np.arange(35,90.01,.5);curves=np.array([[np.median(errs(p,h)) for h in grid] for p in pairs]);each=grid[np.argmin(curves,axis=1)];aggregate=np.median(curves,axis=0);best=float(grid[np.argmin(aggregate)])
report={'frames':len(fs),'homographyPairs':allPairs,'pairs':len(pairs),'pairBestHFOV':each.tolist(),'medianPairErrorAt65':float(np.median([np.median(errs(p,65)) for p in pairs])),'candidateHFOV':best,'medianPairErrorAtCandidate':float(aggregate.min()),'leaveOnePairOutHFOV':[float(grid[np.argmin(np.median(np.delete(curves,k,axis=0),axis=0))]) for k in range(len(pairs))],'pairDetails':[{'i':p[0],'j':p[1],'inliers':len(p[2]),'bestHFOV':float(each[k]),'at65':float(np.median(errs(p,65)))} for k,p in enumerate(pairs)],'warning':'Sensor poses, parallax and lens distortion are confounded; this is a diagnostic fit, not trusted intrinsic calibration.'}
out=Path(sys.argv[2]);out.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:report[k] for k in ['frames','homographyPairs','pairs','candidateHFOV','medianPairErrorAt65','medianPairErrorAtCandidate','warning']}))
