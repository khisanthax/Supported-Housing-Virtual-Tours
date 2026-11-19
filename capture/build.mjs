// Isolated loopback prototype. No deploy command, credentials or network calls.
import '../local/build.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=new URL('../local/generated/',import.meta.url),out=new URL('./generated/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('assets.json',source)));
const files=new Map();
for(const path of manifest.files)if(path!=='/sw.js')files.set(path,await readFile(new URL('.'+path,source)));
for(const name of ['math.js','calibration.js','alignment.js','feature-align.js','indoor-fixture.js','guidance.js','store.js','ui.js','style.css','stitch-worker.js','synthetic.js'])files.set('/capture/'+name,await readFile(new URL(name,import.meta.url)));
const cvSource=await readFile(new URL('../node_modules/@techstark/opencv-js/dist/opencv.js',import.meta.url),'utf8');
files.set('/capture/vendor/opencv.js',Buffer.from('// UMD global receiver adapted for ES module workers; upstream algorithm unchanged.\n'+cvSource.replace('}(this, function','}(globalThis, function')));
files.set('/capture/vendor/OpenCV-LICENSE.txt',await readFile(new URL('../node_modules/@techstark/opencv-js/LICENSE',import.meta.url)));
for(const [p,b] of files)if(p.endsWith('.html'))files.set(p,Buffer.from(b.toString().replace("script-src 'self';","script-src 'self' 'wasm-unsafe-eval';")));
const runtime=files.get('/dist/editor-runtime.js').toString();
files.set('/dist/backup-ui-secure.js',files.get('/dist/backup-ui.js'));
files.set('/dist/backup-ui.js',await readFile(new URL('./test-backup-ui.js',import.meta.url)));
files.set('/dist/guided-editor.js',Buffer.from(files.get('/dist/guided-editor.js').toString().replace('Encrypted backup download started.','Backup download started.')));
files.set('/dist/editor-runtime.js',Buffer.from("import {captureRoom} from '/capture/ui.js';\n"+runtime.replace('export default { edition, storage, getAccess, can, applyAccess };',"export default { edition, storage, getAccess, can, applyAccess, captureRoom: options=>captureRoom({...options,syntheticBench:true}) };")));
files.set('/editor/index.html',Buffer.from(files.get('/editor/index.html').toString().replace('<head>','<head><link rel="stylesheet" href="/capture/style.css">').replace('LOCAL ONLY','LOCAL CAPTURE PROTOTYPE — NOT PRODUCTION')));
const hashes=Object.fromEntries([...files].map(([p,b])=>[p,createHash('sha256').update(b).digest('base64')]));
const template=(await readFile(new URL('../local/sw-template.js',import.meta.url),'utf8')).replaceAll('virtual-tours-local-shell-','leveltwo360-capture-prototype-shell-');
const version=createHash('sha256').update(JSON.stringify(hashes)+template).digest('hex').slice(0,24);
files.set('/sw.js',Buffer.from(template.replace('__ASSETS__',JSON.stringify(hashes)).replace('__VERSION__',version)));
for(const [p,b]of files){const target=new URL('.'+p,out);await mkdir(new URL('./',target),{recursive:true});await writeFile(target,b)}
await writeFile(new URL('assets.json',out),JSON.stringify({version,files:[...files.keys()]}));
console.log('Capture prototype built; isolated static assets only.');
