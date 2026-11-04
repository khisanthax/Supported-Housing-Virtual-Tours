"""Original procedural sample rooms. No photographs, residents, or third-party image assets.
Requires numpy and Pillow only when regenerating; the website needs neither.
"""
from pathlib import Path
import numpy as np
from PIL import Image

W, H = 3072, 1536
YAW = (np.arange(W, dtype=np.float32) / W - .5) * (2 * np.pi)
PITCH = (.5 - np.arange(H, dtype=np.float32) / H) * np.pi
dx = np.cos(PITCH[:, None]) * np.sin(YAW[None, :])
dy = np.broadcast_to(np.sin(PITCH[:, None]), (H, W)).copy()
dz = -np.cos(PITCH[:, None]) * np.cos(YAW[None, :])
D = np.stack([dx, dy, dz], axis=-1)
O = np.array([0, 1.5, 0], dtype=np.float32)
out = Path(__file__).resolve().parents[1] / 'dist' / 'images'

def render(kind, doors):
    # Every pixel is a ray from the room centre; this is a true spherical 2:1 projection.
    ts = []
    with np.errstate(divide='ignore', invalid='ignore'):
        for axis, limit in [(0, 4), (1, 3.1), (2, 4)]:
            end = np.where(D[..., axis] > 0, limit, 0 if axis == 1 else -limit)
            ts.append(np.where(abs(D[..., axis]) < 1e-7, np.inf, (end - O[axis]) / D[..., axis]))
    faces = np.argmin(ts, axis=0)
    depth = np.min(ts, axis=0)
    hit = O + D * depth[..., None]
    x,y,z = [hit[...,i] for i in range(3)]
    rgb = np.zeros((H,W,3), dtype=np.float32)
    wall = np.array({'living':[220,222,207], 'kitchen':[227,226,210], 'bedroom':[212,220,210]}[kind])
    rgb[:] = wall
    rgb[faces == 0] *= .92
    front = (faces == 2) & (z < 0)
    floor = (faces == 1) & (y < 1)
    ceiling = (faces == 1) & ~floor
    rgb[ceiling] = [239,237,222]
    # Warm plank flooring, with staggered joints and restrained grain.
    grain = 4*np.sin(x*72+np.sin(z*7)) + 2*np.sin(z*87)
    plank = np.floor((x+4)*4)
    shade = (plank%3)*3+grain
    floor_color = np.stack([180+shade,151+shade,115+shade],axis=-1)
    joints = ((x+4)*4 % 1 < .018) | ((z+4+plank%2)*.6 % 1 < .012)
    floor_color[joints] *= .82
    rgb[floor] = floor_color[floor]
    baseboard = (faces != 1) & (y < .13)
    rgb[baseboard] = [241,238,222]
    # Front-wall doorways align precisely with the JSON hotspot yaw values.
    for direction in doors:
        center = direction*4*np.tan(.55)
        frame = front & (abs(x-center)<.69) & (y<2.5)
        rgb[frame] = [234,230,210]
        opening = front & (abs(x-center)<.57) & (y<2.36)
        rgb[opening] = [123,146,128]
        innerwall = opening & (y>.35) & (abs(x-center)<.47)
        rgb[innerwall] = [191,202,181]
        innerfloor = opening & (y < .45 + abs(x-center)*.1)
        rgb[innerfloor] = [153,130,100]
        rgb[opening & (x-center<-.42)] = [94,117,99]
        rgb[opening & (y>2.2)] = [151,169,143]
    # Large left-wall window: frame, panes, soft greenery outdoors.
    window = (faces==0)&(x<0)&(abs(z+1.3)<1.35)&(y>.8)&(y<2.65)
    rgb[window] = [240,238,223]
    glass = window & (abs(z+1.3)<1.22)&(y>.92)&(y<2.53)
    rgb[glass] = [185,210,203]
    trees = glass & (y<1.45+.16*np.sin(z*9)+.08*np.sin(z*23))
    rgb[trees] = [131,164,132]
    bars = glass & ((abs(z+1.3)<.03)|(abs(y-1.7)<.025))
    rgb[bars] = [240,238,223]
    # Framed original abstract art on the wall ahead.
    artframe = front & (abs(x)<.68)&(y>1.25)&(y<2.38)
    rgb[artframe] = [112,97,71]
    art = front & (abs(x)<.62)&(y>1.31)&(y<2.32)
    rgb[art] = [233,224,200]
    rgb[art & ((x+.13)**2+(y-1.93)**2<.12)] = [190,139,92]
    rgb[art & (y<1.68+.16*np.sin(x*4))] = [115,142,113]
    rgb[art & (y<1.49+.1*np.sin(x*5+1))] = [71,105,87]
    # Light falloff helps distinguish the planes without external render dependencies.
    ambient = .91+.09*np.clip((y+1)/4,0,1)
    rgb *= ambient[...,None]

    def box(lo, hi, color):
        nonlocal depth, rgb
        lo=np.array(lo,dtype=np.float32); hi=np.array(hi,dtype=np.float32)
        with np.errstate(divide='ignore', invalid='ignore'):
            a=(lo-O)/D; b=(hi-O)/D
        near=np.minimum(a,b); far=np.maximum(a,b)
        t=np.max(near,axis=-1); end=np.min(far,axis=-1)
        mask=(t>0)&(end>=t)&(t<depth)
        axis=np.argmax(near,axis=-1)
        shade=np.where(axis==1,1.04,np.where(axis==0,.85,.96))
        rgb[mask] = np.array(color)[None,:]*shade[mask,None]
        depth[mask]=t[mask]

    if kind=='living':
        # Sage sofa to the right, with visible arms, cushions, and legs.
        for z0 in [-1.3,.9]:
            for x0 in [2.25,3.3]: box([x0,.05,z0],[x0+.09,.25,z0+.09],[81,69,51])
        box([2.1,.22,-1.5],[3.65,.65,1.25],[125,145,120])
        box([3.28,.58,-1.5],[3.66,1.22,1.25],[135,155,129])
        for z0 in [-1.5,.95]: box([2.1,.5,z0],[3.66,.95,z0+.3],[131,151,124])
        for z0 in [-1.12,-.44,.24]: box([2.12,.65,z0],[3.27,.77,z0+.63],[149,165,137])
        box([2.9,.76,-.95],[3.25,1.13,-.37],[211,200,165])
        box([2.9,.76,.35],[3.25,1.08,.85],[179,131,90])
        box([-.8,.01,-1.8],[1.65,.025,1.6],[209,200,170])
        box([.05,.38,-.55],[1.35,.48,.55],[132,101,67])
        for xx in [.15,1.16]:
            for zz in [-.42,.34]:box([xx,.02,zz],[xx+.07,.38,zz+.07],[104,82,60])
        box([.3,.48,-.25],[.7,.52,.05],[233,225,199])
        box([-.7,0,-3.55],[.7,.65,-3.05],[162,138,102])
    elif kind=='kitchen':
        for z0 in [-2.7,-1.4,-.1,1.2]:
            box([2.95,.06,z0],[3.95,.92,z0+1.25],[151,168,145])
            box([2.9,.92,z0-.03],[3.99,.99,z0+1.28],[234,229,211])
            box([2.92,.65,z0+.46],[2.95,.68,z0+.77],[91,97,79])
        box([3.2,1.55,-2.7],[3.98,2.55,.9],[202,207,186])
        box([2.88,.99,-1.1],[3.75,1.01,-.35],[72,79,68])
        box([-1.2,.74,.6],[1.1,.85,1.9],[180,151,110])
        for xx in [-1.1,.9]:
            for zz in [.7,1.7]:box([xx,.02,zz],[xx+.12,.74,zz+.12],[149,120,83])
        for xx in [-1.1,.7]:
            box([xx,.02,2.2],[xx+.5,.48,2.7],[112,132,107])
            box([xx,.45,2.6],[xx+.5,1.1,2.7],[112,132,107])
    else:
        box([-1.15,.08,.4],[1.15,.45,3.6],[134,111,81])
        box([-1.12,.45,.45],[1.12,.69,3.45],[239,232,212])
        box([-1.13,.69,.5],[1.13,.77,2.9],[167,183,160])
        box([-1.2,.2,3.45],[1.2,1.3,3.65],[130,151,126])
        for xx in [-.98,.12]:box([xx,.69,2.8],[xx+.84,.89,3.36],[244,237,218])
        box([-1.12,.77,.52],[1.12,.8,1.02],[197,160,116])
        box([-2,.02,2.6],[-1.4,.6,3.3],[176,147,109])
        box([1.4,.02,2.6],[2,.6,3.3],[176,147,109])
        box([-.75,0,-3.6],[.75,.85,-3.05],[175,151,113])
        for yy in [.27,.55]:box([-.7,yy,-3.025],[.7,yy+.018,-3.01],[115,100,74])
    # Simple side table and geometric potted plant.
    box([-3.1,.0,-3.3],[-2.65,.5,-2.85],[157,127,91])
    box([-3.03,.5,-3.23],[-2.72,.79,-2.92],[192,148,107])
    box([-2.91,.79,-3.1],[-2.86,1.4,-3.05],[87,108,68])
    box([-3.18,1.0,-3.25],[-2.88,1.12,-2.99],[103,137,87])
    box([-2.89,1.22,-3.15],[-2.6,1.33,-2.91],[118,148,94])
    # A very subtle corner vignette rather than photographic detail.
    rgb=np.clip(rgb,0,255).astype('uint8')
    Image.fromarray(rgb).save(out/f'{kind}.jpg', quality=92, optimize=True)
    print(f'Created {kind}.jpg ({W} x {H})')

out.mkdir(parents=True,exist_ok=True)
for kind,doors in [('living',[1]),('kitchen',[-1,1]),('bedroom',[-1])]: render(kind,doors)
