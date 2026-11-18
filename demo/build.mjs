// Operator-only public SYNTHETIC snapshot. Never reads cloud storage or staff credentials.
import{readFile,writeFile,mkdir,readdir}from'node:fs/promises';import{join,dirname}from'node:path';
import{validateApartment}from'../dist/tour-data.js';import{inspectJpeg,MAX_ROOMS}from'../dist/tour-package.js';
const root=new URL('../',import.meta.url);
export async function buildPublicDemo({tour,images,directory,syntheticApproved=false}){
 if(!syntheticApproved)throw Error('Explicit approval to publish synthetic images is required.');
 const clean={id:'photorealistic-house-demo',title:tour.title,subtitle:'Public synthetic demonstration · No real agency apartment',startRoom:tour.startRoom,rooms:tour.rooms.map(r=>({id:r.id,name:r.name,description:r.description??'',image:'images/'+r.id+'.jpg',initialView:{...r.initialView},links:r.links.filter(l=>!l.pending).map(l=>({target:l.target,yaw:l.yaw,pitch:l.pitch}))}))};
 validateApartment(clean);if(clean.rooms.length>MAX_ROOMS)throw Error('Too many viewpoints.');
 if(images.size!==clean.rooms.length)throw Error('A complete, exact image set is required.');
 for(const room of clean.rooms){const bytes=images.get(room.id);if(!bytes||bytes.length>4*1024*1024)throw Error('Missing or oversized JPEG.');const {width,height}=await inspectJpeg(new Blob([bytes]));if(width>8192||height>4096||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Invalid or truncated panorama.');}
 await mkdir(directory,{recursive:true});if((await readdir(directory)).length)throw Error('Use a fresh, empty output directory.');
 const put=async(p,bytes)=>{const f=join(directory,p);await mkdir(dirname(f),{recursive:true});await writeFile(f,bytes)};
 let html=await readFile(new URL('dist/index.html',root),'utf8');
 html=html.replace('<body>','<body data-guest="true">').replace(/<section class="editor-bar"[\s\S]*?<\/section>/,'').replace(/<section id="editor-panel"[\s\S]*?<\/section>/,'').replace(/<dialog\b[\s\S]*?<\/dialog>/g,'').replace(/<details class="local-preview"[\s\S]*?<\/details>/,'').replace(/<link rel="stylesheet" href="editor.css">/,'').replace(/<button id="(?:place-on-pano|cancel-on-pano)"[\s\S]*?<\/button>/g,'').replace(/<title>.*?<\/title>/,'<title>Photorealistic House Demo · LevelTwo360</title>').replace('Explore a six-room sample apartment in an interactive 360 degree walkthrough.','Explore eight generated photorealistic panoramas. Public synthetic demonstration.').replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');
 let app=await readFile(new URL('dist/app.js',root),'utf8');const original="const guestTour = guest ? '/api/guest/tours/' + location.pathname.split('/').at(-1) : null;";if(!app.includes(original))throw Error('Viewer bootstrap changed; review public snapshot integration.');
 app=app.replace(original,"const guestTour = '/demo';").replace("guest ? 'Shared tour'","guest ? 'Public synthetic demo'").replace(/    if \(guest\) \{\r?\n      const checkAccess[\s\S]*?\r?\n    \}/,'');
 if(app.includes('const checkAccess')||app.includes("fetch('/api/"))throw Error('Unexpected authenticated API in public viewer.');
 await put('index.html',html);await put('app.js',app);await put('demo/manifest.json',JSON.stringify(clean));
 for(const p of ['styles.css','tour-data.js','room-grid.js','builder-data.js','layout-state.js','graph-tour.js','vendor/marzipano.js','vendor/MARZIPANO-LICENSE'])await put(p,await readFile(new URL('dist/'+p,root)));
 let redirects='/ /index.html 200\n/demo/manifest /demo/manifest.json 200\n';for(const room of clean.rooms){await put(room.image,images.get(room.id));redirects+='/demo/images/'+room.id+' /'+room.image+' 200\n';}await put('_redirects',redirects);
 await put('_headers',"/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex, nofollow\n");await put('robots.txt','User-agent: *\nDisallow: /\n');
 return {tour:clean,files:clean.rooms.length+14,viewpoints:clean.rooms.length,positionedArrows:clean.rooms.reduce((n,r)=>n+r.links.length,0)};
}
