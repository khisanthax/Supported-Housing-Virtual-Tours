import{plan,basis,deviceBasis,dot,deg,coverage}from'./math.js';

import{saveSession,findSession,listSessions,deleteSession}from'./store.js';

const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};

const blobOf=(canvas,q)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Camera frame could not be encoded.')),'image/jpeg',q));

export async function captureRoom({apartmentKey,localOnly=true,syntheticBench=false}){

 if(!apartmentKey)throw Error('Select an apartment first.');

 if(!isSecureContext)throw Error('Camera capture requires HTTPS or localhost.');

 const d=node('dialog');d.id='capture-room';d.className='capture-room';d.setAttribute('aria-label','Capture Room prototype');

 let session=await findSession(apartmentKey),stream,worker,live,lastMotion=0,viewer,previewURL,closed=false,working=false,capturing=false;

 session??={id:crypto.randomUUID(),apartment:apartmentKey,revision:0,frames:[],hfov:65,aspect:4/3,targets:plan(),state:'capturing',updated:Date.now()};

 document.body.append(d);
 let index=0;

 d.innerHTML=`<h2>Capture Room <small>Isolated prototype</small></h2><p>This prototype uses camera orientation and feather blending, not feature alignment. Lens calibration, drift and parallax can cause visible seams. Not approved for agency capture.</p><p>Everything stays on this device until you explicitly approve a finished JPEG. Source captures are not encrypted by the app and are not part of tour backups. Browser data clearing can delete them.</p><label>Saved capture session<select id="capture-sessions"></select></label><label>Viewpoint name<input id="capture-name" maxlength="80" value="Captured room"></label><label>Room group (optional)<input id="capture-group" maxlength="80"></label><label>Horizontal camera field of view (degrees; verify your lens)<input id="capture-fov" type="number" min="35" max="100" value="65"></label><p>Keep the lens in one position while rotating, keep the same screen orientation, avoid moving objects, and use consistent exposure. Include floor and ceiling; missing areas are never filled artificially.</p><div class="capture-actions"><button id="capture-start">Start rear camera</button><button id="capture-sensors">Enable motion guidance</button><button id="capture-forward">Set forward direction</button><label><input id="capture-manual" type="checkbox">Use manual aiming (positions are estimates)</label></div><video id="capture-video" muted autoplay playsinline></video><p id="capture-guide" role="status" aria-live="polite"></p><button id="capture-photo" disabled>Capture photo</button><p id="capture-count"></p><div id="capture-targets" role="group" aria-label="Capture directions"></div><label>Output resolution<select id="capture-resolution"><option value="2048">2048 × 1024</option><option value="4096">4096 × 2048 (more memory and time)</option><option value="1024">1024 × 512 (diagnostic)</option></select></label><label>JPEG quality (never reduced automatically)<select id="capture-quality"><option value="0.92">92%</option><option value="0.98">98%</option><option value="0.85">85%</option><option value="0.7">70%</option></select></label><div class="capture-actions"><button id="capture-stitch">Create 360° Panorama / Retry Stitching</button><button id="capture-stop">Cancel stitching</button></div><progress id="capture-progress" max="1" value="0"></progress><p id="capture-message" role="status" aria-live="polite"></p><div id="capture-preview" role="region" aria-label="Captured panorama preview"></div><label><input id="capture-approved" type="checkbox">I inspected the complete panorama, coverage and seams.</label><div class="capture-actions"><button id="capture-use" disabled>${localOnly?'Accept & add to local draft':'Approve finished JPEG & upload to cloud draft'}</button><button id="capture-new">Start another capture</button><button id="capture-delete">Delete these source captures</button><button id="capture-close">Close (keep captures)</button></div>`;

 const $=id=>d.querySelector('#capture-'+id),say=t=>$('message').textContent=t,field=$('fov');field.value=session.hfov;

 if(session.name)$('name').value=session.name;if(session.group)$('group').value=session.group;

 async function sessions(){const rows=await listSessions(apartmentKey);$('sessions').replaceChildren(...[session,...rows.filter(r=>r.id!==session.id)].map(r=>new Option((r.name||'Unnamed capture')+'  /  '+r.frames.length+' photos  /  '+r.state,r.id)));$('sessions').value=session.id}

 $('sessions').onchange=async()=>{try{stopCamera();stopWorker();disposePreview();const rows=await listSessions(apartmentKey),found=rows.find(r=>r.id===$('sessions').value);if(!found)throw Error('Capture no longer exists.');session=found;index=0;field.value=session.hfov;$('name').value=session.name||'Captured room';$('group').value=session.group||'';$('approved').checked=false;if(session.output)preview();render()}catch(e){say(e.message)}};

 function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$('photo').disabled=true;$('video').srcObject=null}

 function stopWorker(){worker?.terminate();worker=null;working=false;$('stitch').disabled=false;$('stop').disabled=true}

 function disposePreview(){viewer?.destroy();viewer=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('preview').replaceChildren()}

 function preview(){disposePreview();if(!session.output)return;previewURL=URL.createObjectURL(session.output);viewer=new Marzipano.Viewer($('preview'),{controls:{mouseViewMode:'drag'}});const view=new Marzipano.RectilinearView({yaw:0,pitch:0,fov:1.4},Marzipano.RectilinearView.limit.traditional(4096,2.1));viewer.createScene({source:Marzipano.ImageUrlSource.fromString(previewURL),geometry:new Marzipano.EquirectGeometry([{width:session.report.width}]),view,pinFirstLevel:true}).switchTo();viewer.updateSize();say('Preview: '+session.report.width+' × '+session.report.height+' · '+(session.output.size/1048576).toFixed(2)+' MiB · '+session.report.ms+' ms. Inspect every direction. No feature alignment or exposure compensation was performed.')}

 function guidance(){if(closed)return;const target=session.targets[index],current=live?deviceBasis(live,session.heading??0):null,angle=current?deg(Math.acos(Math.min(1,Math.max(-1,dot(current.f,basis(target.yaw,target.pitch).f))))):null,fresh=performance.now()-lastMotion<1500;

  $('guide').textContent='Direction '+(index+1)+'/'+session.targets.length+': turn '+deg(target.yaw).toFixed(0)+'°, tilt '+deg(target.pitch).toFixed(0)+'°. '+(fresh&&angle!==null?'Sensor difference '+angle.toFixed(1)+'°.':'No fresh sensor reading; enable guidance or explicitly choose manual aiming.');

  $('photo').disabled=!stream||working||capturing||(!($('manual').checked)&&(angle===null||!fresh||angle>8));

 }

 function render(){for(const key of ['sessions','new','delete','start','sensors','forward','synthetic'])if($(key))$(key).disabled=working||capturing;const got=new Set(session.frames.map(f=>f.id));$('count').textContent=got.size+' / '+session.targets.length+' photographs saved on this device. Tap a completed direction to retake it.';$('targets').replaceChildren();session.targets.forEach((t,i)=>{const b=node('button',(got.has(t.id)?'✓ ':'')+(i+1));b.type='button';b.setAttribute('aria-label',(got.has(t.id)?'Retake':'Aim at')+' direction '+(i+1));b.setAttribute('aria-pressed',String(i===index));b.onclick=()=>{index=i;render()};$('targets').append(b)});field.disabled=!!session.frames.length;$('stitch').disabled=working||capturing||session.frames.length<2;$('use').disabled=!session.output||!$('approved').checked||working||capturing;guidance()}

 function motion(e){try{deviceBasis(e);live={alpha:e.alpha,beta:e.beta,gamma:e.gamma};lastMotion=performance.now();guidance()}catch{}}

 const onPageHide=()=>{stopCamera();stopWorker()};

 const onBackground=()=>{if(document.hidden){stopCamera();stopWorker();say('Capture paused. Saved photographs were kept. Restart the camera to continue.')}};

 const initialAngle=screen.orientation?.angle??0,onRotate=()=>{if((screen.orientation?.angle??0)!==initialAngle){stopCamera();say('Screen orientation changed. Return to the original orientation before restarting; saved photos were kept.')}};

 addEventListener('deviceorientation',motion);document.addEventListener('visibilitychange',onBackground);addEventListener('pagehide',onPageHide);screen.orientation?.addEventListener('change',onRotate);

 $('start').onclick=async()=>{try{if(working)throw Error('Wait for stitching.');if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser has no camera API.');if((screen.orientation?.angle??0)!==initialAngle)throw Error('Return to the original screen orientation.');stopCamera();stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}}});if(closed){stopCamera();return}$('video').srcObject=stream;await $('video').play();if(closed){stopCamera();return}const aspect=$('video').videoWidth/$('video').videoHeight;if(session.frames.length&&Math.abs(aspect-session.aspect)>.02)throw Error('Camera aspect changed. Restore the original orientation/lens or start another capture.');if(!session.frames.length){session.hfov=Number(field.value);session.aspect=aspect;session.targets=plan(session.hfov,aspect);index=0;await saveSession(session)}say('Camera active. Raw frames are saved locally only. Field of view must be calibrated; the browser does not supply it.');render()}catch(e){stopCamera();say(e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in browser settings to capture; existing photos are kept.':e.message)}};

 $('sensors').onclick=async()=>{try{if(!globalThis.DeviceOrientationEvent)throw Error('Motion sensors unavailable. Manual aiming is an explicitly estimated fallback.');if(typeof DeviceOrientationEvent.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission()!=='granted')throw Error('Motion permission denied. Manual aiming remains available.');say('Motion permission enabled. Hold the phone upright, point forward, then choose Set forward direction. Actual sensor events are still required.')}catch(e){say(e.message)}};

 $('forward').onclick=async()=>{try{if(!live||performance.now()-lastMotion>1500)throw Error('No fresh motion reading.');if(session.frames.length)throw Error('Forward calibration is locked after the first photo; start another session to recalibrate.');const f=deviceBasis(live).f;session.heading=Math.atan2(f[0],f[2]);await saveSession(session);guidance()}catch(e){say(e.message)}};

 $('manual').onchange=guidance;field.onchange=()=>{stopCamera();say('Restart the camera to apply the field of view before capturing.')};

 $('photo').onclick=async()=>{if(capturing)return;capturing=true;render();say('Saving camera photo…');try{if(!stream||working)throw Error('Start the rear camera first.');const target=session.targets[index],fresh=live&&performance.now()-lastMotion<1500;if(!$('manual').checked&&!fresh)throw Error('Wait for motion guidance or select manual aiming.');const pose=fresh&&!$('manual').checked?deviceBasis(live,session.heading??0):basis(target.yaw,target.pitch),video=$('video'),scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const blob=await blobOf(canvas,.95),frame={id:target.id,blob,pose,hfov:session.hfov,aspect:canvas.width/canvas.height,confidence:fresh&&!$('manual').checked?'sensor':'manual-estimate',captured:Date.now()},next={...session,frames:[...session.frames.filter(f=>f.id!==target.id),frame],state:'capturing',output:null,report:null};await saveSession(next);session=next;canvas.width=canvas.height=1;disposePreview();$('approved').checked=false;index=session.targets.findIndex(t=>!session.frames.some(f=>f.id===t.id));if(index<0)index=0;render();say('Photo saved on this device. '+coverage(session.frames,72,36).percent.toFixed(1)+'% estimated angular coverage; this is not an image-quality guarantee.')}catch(e){say(e.message)}finally{capturing=false;if(!closed)render()}};

 $('stitch').onclick=async()=>{try{if(working)return;if(!globalThis.Worker||!globalThis.OffscreenCanvas||!globalThis.createImageBitmap)throw Error('This browser lacks the required local worker/canvas support. Source photographs were kept.');if(!session.frames.length)throw Error('Capture photographs first.');const cov=coverage(session.frames);if(cov.missing)throw Error('Missing estimated coverage ('+cov.percent.toFixed(1)+'%). Capture/retake the missing directions before stitching.');stopCamera();working=true;render();$('stop').disabled=false;$('progress').max=session.frames.length;$('progress').value=0;say('Stitching locally in a worker. No photos are uploaded.');worker=new Worker(new URL('./stitch-worker.js',import.meta.url),{type:'module'});worker.onerror=e=>{stopWorker();say('Stitch worker failed; source photos were kept. Retry after checking browser support.');render()};worker.onmessage=async({data})=>{if(data.type==='progress')$('progress').value=data.done;else if(data.type==='error'){stopWorker();say(data.message);render()}else if(data.type==='result'){stopWorker();const next={...session,output:data.blob,report:data.report,state:'preview',name:$('name').value.trim(),group:$('group').value.trim()};try{await saveSession(next);session=next;if(closed)return;$('approved').checked=false;preview();render()}catch(e){say(e.message);render()}}};worker.postMessage({frames:session.frames,width:Number($('resolution').value),quality:Number($('quality').value)})}catch(e){stopWorker();say(e.message);render()}};

 $('stop').onclick=()=>{stopWorker();render();say('Stitching canceled. Source photos and any previous complete preview were kept.')};$('approved').onchange=render;

 if(syntheticBench){const b=node('button','Load synthetic test captures (no camera)');b.id='capture-synthetic';b.onclick=async()=>{try{if(session.frames.length&&!confirm('Replace only this capture session with synthetic test frames? Saved apartments stay unchanged.'))return;stopCamera();stopWorker();say('Generating synthetic test photographs locally…');b.disabled=true;const {syntheticFrames}=await import('./synthetic.js'),data=await syntheticFrames();const next={...session,...data,state:'capturing',output:null,report:null};await saveSession(next);session=next;field.value=session.hfov;index=0;disposePreview();render();say('Synthetic frames saved locally. Create the panorama to test the pipeline.')}catch(e){say(e.message)}finally{b.disabled=false}};d.insertBefore(b,$('video'))}

 let finish;const result=new Promise(resolve=>finish=resolve);

 function close(value){if(closed)return;closed=true;stopCamera();stopWorker();disposePreview();removeEventListener('deviceorientation',motion);document.removeEventListener('visibilitychange',onBackground);removeEventListener('pagehide',onPageHide);screen.orientation?.removeEventListener('change',onRotate);clearInterval(timer);d.close();d.remove();finish(value)}

 $('close').onclick=()=>close(null);d.addEventListener('cancel',e=>{e.preventDefault();close(null)});

 $('delete').onclick=async()=>{if(confirm('Delete only these temporary source captures and preview? Saved apartment JPEGs stay unchanged.')){try{await deleteSession(session.id);close(null)}catch(e){say(e.message)}}};

 $('new').onclick=async()=>{if(!confirm('Keep this session on device and start a separate capture? Use the same apartment to resume unfinished work later.'))return;stopCamera();stopWorker();disposePreview();session={id:crypto.randomUUID(),apartment:apartmentKey,revision:0,frames:[],hfov:65,aspect:4/3,targets:plan(),state:'capturing',updated:Date.now()};await saveSession(session);index=0;field.value=65;$('name').value='Captured room';$('group').value='';$('approved').checked=false;await sessions();render()};

 $('use').onclick=async()=>{if(!session.output||working||!$('approved').checked)return;const name=$('name').value.trim(),group=$('group').value.trim();if(!name||name.length>80||group.length>80){say('Enter a viewpoint name up to 80 characters.');return}const snapshot=session;close({file:new File([snapshot.output],name.replace(/[\\/:*?"<>|]/g,'-')+'.jpg',{type:'image/jpeg'}),name,roomName:group,sessionId:snapshot.id,async committed(){const next={...snapshot,state:'committed',name,group};await saveSession(next)}})};

 const timer=setInterval(guidance,500);$('stop').disabled=true;d.showModal();await sessions();if(session.output)preview();render();return result;

}

