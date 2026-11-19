import {basis,deviceBasis,coverage} from './math.js';
import {planningOptions,transposeFOV,sideMeasurement,finishCalibration,withCalibration} from './calibration.js';
import {capturePlan,targetLabel,projectTarget,StableTarget,cameraBasis,orientationError} from './guidance.js';
import {previewReviewable} from './stitch-quality.js';
import {saveSession,findSession,listSessions,deleteSession} from './store.js';
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
const blobOf=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Camera photo could not be encoded.')),'image/jpeg',.95));
const fresh=at=>performance.now()-at<350;
const newSession=apartment=>({id:crypto.randomUUID(),apartment,revision:0,frames:[],hfov:65,aspect:4/3,plannerVersion:2,targets:capturePlan(65,4/3,planningOptions()),state:'capturing',updated:Date.now()});

export async function captureRoom({apartmentKey,localOnly=true,syntheticBench=false}){
 if(!apartmentKey)throw Error('Select an apartment first.');
 if(!isSecureContext)throw Error('Camera capture requires HTTPS or localhost.');
 let session=await findSession(apartmentKey)??newSession(apartmentKey);
 let lastStitchFailed=false,fovSetup=null,stream,worker,raw,current,lastMotion=0,viewer,previewURL,anchorURL,index=0,sensorMoved=false,previousRaw=null;
 let closed=false,working=false,capturing=false,calibrated=false,needsAlign=!!session.frames.length,retaking=false,sensorsAllowed=false,sensorProblem='';
 const gate=new StableTarget();let displayAngle=screen.orientation?.angle??0,liveAspect=session.aspect,liveFov=session.hfov,startGeneration=0,starting=false;
 const fit=()=>{const box=$('stage').getBoundingClientRect(),width=Math.min(box.width,box.height*liveAspect),height=width/liveAspect;Object.assign(d.querySelector('.capture-overlay').style,{width:width+'px',height:height+'px'});return{width,height}};
 const d=node('dialog');d.id='capture-room';d.className='capture-room';d.setAttribute('aria-label','Capture Room prototype');
 d.innerHTML=`<h2>Capture Room <small>Isolated prototype</small></h2>
 <p>Line up the empty circle with the centre crosshair. Hold still briefly and a photo is taken automatically. Rotate around the camera lens, not your body. Use the standard rear lens.</p>
 <div class="capture-actions"><button id="capture-start">Start rear camera</button><button id="capture-sensors">Enable motion guidance</button><label><input id="capture-manual" type="checkbox">Manual visual guide (no automatic capture)</label></div>
 <div id="capture-stage" class="capture-stage"><video id="capture-video" muted autoplay playsinline></video><div class="capture-overlay" aria-hidden="true"><span class="capture-crosshair"></span><span id="capture-aim" class="capture-aim"></span><span id="capture-turn" class="capture-turn"></span></div></div>
 <p id="capture-guide" role="status" aria-live="polite"></p><progress id="capture-hold" max="1" value="0" aria-label="Hold steady to capture"></progress>
 <button id="capture-photo" disabled>Capture photo</button><p id="capture-count" role="status" aria-live="polite"></p>
 <details id="capture-map" open><summary>Coverage guide · select a dot to retake</summary><p id="capture-map-help">Top: ceiling. Middle: around the room. Bottom: floor. The highlighted dot is next; checked dots are saved. Front is where you started.</p><div class="capture-map-scroll"><div id="capture-targets" role="group" aria-label="Room coverage and retakes"></div></div></details>
 <div id="capture-recovery" hidden><img id="capture-anchor" alt="Starting photograph: line up the same scene to resume guidance"><p>Line up the camera with this saved photograph, then realign. If guidance has drifted, this restores its horizontal reference. Do not change lenses.</p><button id="capture-realign">Aligned with starting photo — resume</button></div>
 <p id="capture-message" role="status" aria-live="polite"></p><p id="capture-camera-model"></p>
 <label>Viewpoint name<input id="capture-name" maxlength="80" value="Captured room"></label><label>Room group (optional)<input id="capture-group" maxlength="80"></label>
 <details id="capture-settings"><summary>Saved captures and panorama settings</summary><label>Saved capture session<select id="capture-sessions"></select></label>
 <label>Stitching engine<select id="capture-engine"><option value="features">Experimental OpenCV — alignment checks required</option><option value="baseline">Sensor-only diagnostic preview — cannot accept</option></select></label><label>Output resolution<select id="capture-resolution"><option value="2048">2048 × 1024</option><option value="4096">4096 × 2048 (more memory and time)</option><option value="1024">1024 × 512 (diagnostic)</option></select></label>
 <label>JPEG quality (never reduced automatically)<select id="capture-quality"><option value="0.92">92%</option><option value="0.98">98%</option><option value="0.85">85%</option><option value="0.7">70%</option></select></label></details>
 <div class="capture-actions"><button id="capture-stitch">Create 360° Panorama / Retry Stitching</button><button id="capture-stop">Cancel stitching</button></div><progress id="capture-progress" max="1" value="0" aria-label="Stitching progress"></progress><p id="capture-stitch-status" role="status" aria-live="polite"></p><details id="capture-stitch-details" hidden><summary>Stitching diagnostics</summary><pre id="capture-stitch-diagnostic"></pre></details>
 <p id="capture-preview-label" role="status" hidden></p><div id="capture-preview" role="region" aria-label="Captured panorama preview"></div><label><input id="capture-approved" type="checkbox">I inspected the complete panorama, coverage and seams.</label>
 <div class="capture-actions"><button id="capture-use" disabled>${localOnly?'Accept & add to local draft':'Approve finished JPEG & upload to cloud draft'}</button><button id="capture-new">Start another capture</button><button id="capture-delete">Delete these source captures</button><button id="capture-close">Close (keep captures)</button></div>
 <details><summary>Prototype limits and privacy</summary><p>Camera orientation and feather blending are experimental. OpenCV performs limited feature alignment and exposure adjustment, not certified optical calibration or optimized seams. Sensor-only previews cannot be accepted. Automatic checks cannot certify photographic quality. Seams, drift and parallax may remain. Not approved for agency capture. Manual aiming is estimated and cannot verify coverage. Sensor guidance cannot detect slow drift automatically; realign with the starting photo if needed.</p><p>Source photographs stay on this device and are not encrypted by the app or included in tour backups. Clearing browser data can delete them. Only explicitly accepted finished JPEGs enter your apartment draft.</p></details>`;
 document.body.append(d);
 const $=id=>d.querySelector('#capture-'+id),say=text=>{if(!closed){$('message').textContent=text;$('stitch-status').textContent=text}};
 const level=node('div');level.id='capture-level';level.className='capture-level';level.setAttribute('role','status');level.innerHTML='<span class=level-reference></span><span class=level-live></span><span id=capture-level-label></span>';d.querySelector('.capture-overlay').append(level);
 const hud=node('div');hud.className='capture-hud';hud.append($('count'),$('guide'),$('hold'),$('message'));$('stage').append(hud);
 const toolbar=node('nav');toolbar.className='capture-toolbar';toolbar.setAttribute('aria-label','Capture controls');
 const control=(id,text,fn)=>{const b=node('button',text);b.id='capture-'+id;b.onclick=fn;toolbar.append(b);return b};
 control('pause','Pause',()=>{stopCamera();say('Paused. Your photos are kept.');guidance()});
 control('resume','Resume Capture',()=>$('start').click());
 control('coverage','Coverage / Retake',()=>$('map').scrollIntoView({block:'start'}));
 control('options','Settings',()=>d.querySelector('.capture-actions').scrollIntoView({block:'start'}));
 control('reference','Realign',()=>$('recovery').scrollIntoView({block:'start'}));
 control('fullscreen','Fullscreen',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else say('Fullscreen is unavailable; the full-window camera remains available.')}catch{say('Fullscreen was declined; the full-window camera remains available.')}fit()});
 control('exit','Exit',()=>$('close').click());d.prepend(toolbar);
 const setupPanel=node('div');setupPanel.className='capture-calibration';setupPanel.id='capture-calibration';setupPanel.hidden=true;
 const setupHelp=node('p');setupHelp.id='capture-calibration-help';setupHelp.setAttribute('role','status');
 const setupStep=node('button');setupStep.id='capture-calibration-step';
 const setupCancel=node('button','Cancel camera setup');setupCancel.id='capture-calibration-cancel';
 setupPanel.append(setupHelp,setupStep,setupCancel);$('stage').append(setupPanel);
 const setupMarker=node('span');setupMarker.className='capture-calibration-marker';setupMarker.hidden=true;setupMarker.setAttribute('aria-hidden','true');d.querySelector('.capture-overlay').append(setupMarker);
 async function cameraBinding(){const settings=stream?.getVideoTracks()[0]?.getSettings()??{};const value=JSON.stringify([stream?.getVideoTracks()[0]?.label||settings.facingMode||'unknown-camera',Math.round(Math.min(liveAspect,1/liveAspect)*100),settings.zoom??1,settings.resizeMode??'']);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
 control('calibrate','Camera setup',async()=>{if(session.frames.length){say('Saved captures keep their original camera settings. Start another capture to calibrate without changing them.');return}if(working||capturing)return;fovSetup={stage:'centre'};clearAim();if(!stream)await $('start').onclick();guidance();$('stage').scrollIntoView({block:'start'})});
 setupCancel.onclick=()=>{fovSetup=null;clearAim();say('Camera setup canceled. Field of view remains an unverified estimate.');guidance()};
 setupStep.onclick=async()=>{try{
  if(!fovSetup||!stream||!raw||!fresh(lastMotion)||!sensorMoved||$('manual').checked)throw Error('Camera setup needs fresh motion readings. Move gently or cancel to use the visual manual guide.');
  const pose=cameraBasis(raw,0,displayAngle);
  if(fovSetup.stage==='centre'){if(Math.abs(pose.f[1])>.4)throw Error('Choose a distant detail near eye level.');fovSetup={stage:'left',reference:pose};}
  else if(fovSetup.stage==='left'){fovSetup.left=sideMeasurement(fovSetup.reference,pose,-1);fovSetup.stage='right';}
  else{const right=sideMeasurement(fovSetup.reference,pose,1),measurement=finishCalibration(fovSetup.left,right,liveAspect),next=withCalibration(session,measurement);next.cameraBinding=await cameraBinding();await saveSession(next);session=next;liveFov=measurement.hfov;fovSetup=null;index=0;calibrated=false;current=null;clearAim();say('Camera estimate saved for this capture. It depends on careful visual alignment and stable sensors; it is not certified lens calibration.');render();}
  guidance();
 }catch(e){say(e.message);setupHelp.textContent=e.message;}};
 const resize=()=>fit();addEventListener('resize',resize);
 const target=()=>session.targets[index],reference=()=>session.frames.find(f=>f.id===session.targets[0].id)??session.frames[0];
 const pending=()=>session.targets.findIndex(t=>!session.frames.some(f=>f.id===t.id));
 const eligible=()=>retaking||!session.frames.some(f=>f.id===target().id);
 function clearAim(){gate.reset();$('hold').value=0}
 function stopCamera(){fovSetup=null;setupPanel.hidden=true;setupMarker.hidden=true;startGeneration++;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;current=null;calibrated=false;needsAlign=!!session.frames.length;clearAim();$('photo').disabled=true}
 function stopWorker(){worker?.terminate();worker=null;working=false;$('stop').disabled=true}
 function disposePreview(){$('preview-label').hidden=true;viewer?.destroy();viewer=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('preview').replaceChildren()}
 function updatePreviewLabel(){const label=$('preview-label');label.hidden=!session.output;if(!session.output)return;label.textContent=working?'Previous preview; another stitching attempt is running.':lastStitchFailed?'Previous saved preview — the latest attempt failed. No new panorama was created.':previewReviewable(session.report)?'OpenCV candidate — inspect every direction before accepting. All '+session.report.usedFrames+' original photos included.':'Older or diagnostic preview — cannot be accepted. Retry stitching using OpenCV.';}
 function preview(){disposePreview();if(!session.output)return;previewURL=URL.createObjectURL(session.output);viewer=new Marzipano.Viewer($('preview'),{controls:{mouseViewMode:'drag'}});const view=new Marzipano.RectilinearView({yaw:0,pitch:0,fov:1.4},Marzipano.RectilinearView.limit.traditional(4096,2.1));viewer.createScene({source:Marzipano.ImageUrlSource.fromString(previewURL),geometry:new Marzipano.EquirectGeometry([{width:session.report.width}]),view,pinFirstLevel:true}).switchTo();viewer.updateSize();say('Preview: '+(previewReviewable(session.report)?'candidate for visual review. ':'diagnostic only — cannot accept. Retry using OpenCV with current checks. ')+session.report.width+' × '+session.report.height+' · '+(session.output.size/1048576).toFixed(2)+' MiB · '+session.report.ms+' ms. Inspect every direction. '+(session.report.alignment?'Experimental alignment residual '+session.report.alignment.afterDegrees.toFixed(2)+' degrees (training matches); excluded frames: '+session.report.alignment.excludedUnmatchedFrames.join(',')+'. Inspect seams carefully.':'No feature alignment or exposure compensation was performed.')+'')}
 function updateReference(){if(anchorURL)URL.revokeObjectURL(anchorURL);anchorURL=null;const r=reference();if(r){anchorURL=URL.createObjectURL(r.blob);$('anchor').src=anchorURL}else $('anchor').removeAttribute('src')}
 function fields(){ $('name').value=session.name||'Captured room';$('group').value=session.group||'';index=Math.max(0,pending());retaking=false;updateReference() }
 async function sessions(){const rows=await listSessions(apartmentKey);$('sessions').replaceChildren(...[session,...rows.filter(r=>r.id!==session.id)].map(r=>new Option((r.name||'Unnamed capture')+' / '+r.frames.length+' photos / '+r.state,r.id)));$('sessions').value=session.id}
 function guidance(){
  if(closed)return;
  const manual=$('manual').checked,complete=pending()<0&&!retaking,active=!!stream&&!working&&!capturing&&!document.hidden;
  const tracking=!fovSetup&&active&&!manual&&calibrated&&fresh(lastMotion)&&current&&!needsAlign;
  fit();const pos=tracking?projectTarget(target(),current,liveFov,liveAspect):{x:.5,y:.5,visible:true};
  $('aim').style.left=pos.x*100+'%';$('aim').style.top=pos.y*100+'%';$('aim').hidden=!!fovSetup||complete||!stream||(!manual&&!tracking);
  $('aim').classList.toggle('aligned',!!tracking&&gate.state.aligned);$('aim').classList.toggle('offscreen',!pos.visible);
  const orientation=tracking?orientationError(current,target()):null;
  level.hidden=!stream||complete||!!fovSetup;level.classList.toggle('level-ok',!!orientation?.rollAligned);level.classList.toggle('level-unknown',!orientation?.reliable);
  level.style.setProperty('--camera-roll',(orientation?.reliable?orientation.roll*180/Math.PI:0)+'deg');
  const levelText=orientation?(orientation.pole?'Ceiling/floor reference bars: ':'Camera level: ')+orientation.correction:'Motion unavailable: level the camera visually; automatic capture is paused.';
  if($('level-label').textContent!==levelText)$('level-label').textContent=levelText;
  $('turn').textContent=tracking&&!pos.visible?pos.hint:'';
  $('hold').value=tracking?gate.state.progress:0;
  $('photo').hidden=!manual;$('photo').disabled=!!fovSetup||!active||!manual||!eligible();
  $('recovery').hidden=!session.frames.length||!needsAlign;
  $('realign').disabled=!active||manual||!raw||!fresh(lastMotion)||!sensorMoved;
  $('resume').hidden=!!stream;$('pause').hidden=!stream;
  setupPanel.hidden=!fovSetup;setupMarker.hidden=!fovSetup||!stream;
  if(fovSetup){const step=fovSetup.stage;setupMarker.style.left=(step==='left'?15:step==='right'?85:50)+'%';setupHelp.textContent=step==='centre'?'Choose a small distant stationary detail near eye level. Keep the camera in one spot and put the detail at the centre crosshair.':step==='left'?'Turn around the lens until the SAME detail is inside the LEFT circle. Keep it at the same height.':'Turn back past the centre until the SAME detail is inside the RIGHT circle. Keep it at the same height.';setupStep.textContent=step==='centre'?'Detail centred':step==='left'?'Detail at left circle':'Detail at right circle — save estimate';setupStep.disabled=!active||!raw||!fresh(lastMotion)||!sensorMoved||manual;if(manual||!sensorsAllowed)setupHelp.textContent='Camera setup needs live motion guidance. Enable motion or cancel setup to use manual capture.';else if(!raw||!fresh(lastMotion)||!sensorMoved)setupHelp.textContent='Waiting for fresh motion readings. Move the phone gently; automatic photography stays paused.';}
  $('calibrate').disabled=working||capturing||!!fovSetup;
  let hint=targetLabel(target())+'. ';
  if(fovSetup)hint='Camera setup: automatic photography is paused. '+setupHelp.textContent;
  else if(complete)hint='All photos captured. Create the panorama, or select a saved dot to retake.';
  else if(!stream)hint='Capture paused. Tap Resume Capture to reconnect the camera and motion guidance. Saved photos are kept.';
  else if(manual)hint+='Manual guide: aim at the highlighted overview dot, then press Capture photo. The centre circle does not track without sensors; positions are estimates.';
  else if(needsAlign)hint=!fresh(lastMotion)||!sensorMoved?'Waiting for live motion. Move the phone gently, then choose Realign to match the starting photo. Manual visual guide is available in Settings.':'Align with the starting photo below, then choose Resume. Automatic capture is paused.';
  else if(!sensorsAllowed||!fresh(lastMotion))hint=(sensorProblem||'Waiting for motion guidance. Enable sensors or choose the manual visual guide.')+' Automatic capture is paused.';
  else if(!calibrated)hint='Hold the phone upright, looking straight ahead, to set your starting direction.';
  else if(capturing)hint='Saving photo on this device…';
  else if(orientation?.reliable&&!orientation.rollAligned)hint+=orientation.correction+' Automatic capture is paused.';
  else if(gate.state.aligned)hint+=gate.state.steady?'Hold still…':'Slow down and hold still.';
  else hint+=pos.visible?'Move the empty circle onto the centre crosshair.':pos.hint;
  if($('guide').textContent!==hint)$('guide').textContent=hint;
 }
 function render(){
  for(const key of ['sessions','new','delete','start','sensors','synthetic','manual'])if($(key))$(key).disabled=working||capturing;
  $('camera-model').textContent=(session.cameraCalibration?'Camera coverage uses a visual/sensor estimate for this capture. ':'Camera coverage is an unverified estimate. ')+(session.plannerVersion===2?'New plan uses extra overlap and a margin for uncertainty.':'Existing capture keeps its saved plan. Start another capture to use the new overlap plan.');
  const got=new Set(session.frames.map(f=>f.id));$('count').textContent=got.size+' of '+session.targets.length+' photos captured. Select a checked dot to retake it.';
  $('targets').replaceChildren();session.targets.forEach((t,i)=>{const done=got.has(t.id),b=node('button',done?'✓':'');b.type='button';b.className='capture-dot'+(done?' completed':'');b.style.left=(8+84*(t.yaw/(2*Math.PI)))+'%';b.style.top=(50-t.pitch/Math.PI*80)+'%';b.setAttribute('aria-label',(done?'Retake':'Aim at')+' photo '+(i+1)+': '+targetLabel(t));b.setAttribute('aria-pressed',String(i===index));b.disabled=working||capturing;b.onclick=()=>{index=i;retaking=done;clearAim();say(done?'Retake selected. Aim at its circle; the existing photo stays until its replacement is saved.':'Follow the highlighted target.');render()};$('targets').append(b)});
  updatePreviewLabel();$('approved').disabled=working||capturing||!previewReviewable(session.report);
  $('stitch').disabled=working||capturing||session.frames.length<2;$('use').disabled=!previewReviewable(session.report)||!session.output||!$('approved').checked||working||capturing;guidance();
 }
 function align(referencePose){
  const rawPose=deviceBasis(raw),ref=referencePose??basis(0,0);
  if(Math.abs(rawPose.f[1]-ref.f[1])>.25)throw Error('Match the up/down aim of the reference first. Keep the phone upright.');
  session.heading=Math.atan2(rawPose.f[0],rawPose.f[2])-Math.atan2(ref.f[0],ref.f[2]);
  calibrated=true;needsAlign=false;current=cameraBasis(raw,session.heading,displayAngle);clearAim();gate.observe(current,target(),performance.now(),false);
 }
 function motion(e){
  if(!sensorsAllowed||!stream||$('manual').checked||working||document.hidden)return;
  try{
   deviceBasis(e);raw={alpha:e.alpha,beta:e.beta,gamma:e.gamma};lastMotion=performance.now();if(previousRaw&&Math.max(Math.abs(raw.alpha-previousRaw.alpha),Math.abs(raw.beta-previousRaw.beta),Math.abs(raw.gamma-previousRaw.gamma))>.1)sensorMoved=true;previousRaw={...raw};
   if(sensorMoved&&!calibrated&&!needsAlign&&Math.abs(deviceBasis(raw).f[1])<.25)align();
   if(calibrated&&!needsAlign){
    current=cameraBasis(raw,session.heading??0,displayAngle);
    const projected=projectTarget(target(),current,liveFov,liveAspect),box=fit();
    const inside=projected.visible&&Math.hypot((projected.x-.5)*box.width,(projected.y-.5)*box.height)<=23;
    const state=gate.observe(current,target(),lastMotion,eligible()&&!capturing,inside);
    if(state.jump){needsAlign=true;calibrated=false;clearAim();say('Motion reference changed suddenly. Realign with the starting photo before continuing.');if(!session.frames.length)needsAlign=false;}
    else if(!fovSetup&&state.ready&&eligible()&&!capturing&&!closed)takePhoto(true).catch(error=>say(error.message));
   }
   guidance();
  }catch{clearAim()}
 }
 async function enableSensors(){
  try{if(!globalThis.DeviceOrientationEvent)throw Error('Motion sensors unavailable. Choose Manual visual guide to continue.');
   if(typeof DeviceOrientationEvent.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission()!=='granted')throw Error('Motion permission denied. Choose Manual visual guide to continue.');
   sensorsAllowed=true;sensorProblem='';lastMotion=0;clearAim();say('Motion guidance enabled. Follow the empty circles and hold still.');
  }catch(e){sensorsAllowed=false;sensorProblem=e.message;current=null;clearAim();say(e.message)}
 }
 async function takePhoto(automatic=false){
  if(fovSetup||capturing||working||closed||!stream||document.hidden||!eligible())return;
  if(automatic){if(needsAlign||!calibrated||!fresh(lastMotion)||$('manual').checked||!gate.consume())return}
  else if(!$('manual').checked)return;
  capturing=true;render();say('Saving camera photo…');
  try{
   const aim=target(),pose=automatic?current:basis(aim.yaw,aim.pitch),video=$('video');
   if(Math.abs(video.videoWidth/video.videoHeight-liveAspect)>.02)throw Error('Camera orientation or lens changed. Restore the original orientation and restart the camera.');
   const scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0);
   const orientation={gateVersion:1,screenAngle:displayAngle,videoWidth:video.videoWidth,videoHeight:video.videoHeight,...(automatic?{...orientationError(pose,aim),sensorReading:{...raw},heading:session.heading??0,readingAgeMs:performance.now()-lastMotion}:{unverified:true})},capturedAt=Date.now();
   const blob=await blobOf(canvas),frame={id:aim.id,blob,pose,hfov:liveFov,aspect:canvas.width/canvas.height,confidence:automatic?'sensor':'manual-estimate',orientation,captured:capturedAt};canvas.width=canvas.height=1;
   const next={...session,frames:[...session.frames.filter(f=>f.id!==aim.id),frame],state:'capturing',name:$('name').value.trim(),group:$('group').value.trim(),output:null,report:null};
   await saveSession(next);session=next;if(closed)return;disposePreview();$('approved').checked=false;retaking=false;index=Math.max(0,pending());clearAim();updateReference();
   say('Photo saved on this device. '+coverage(session.frames,72,36).percent.toFixed(1)+'% estimated angular coverage; not an image-quality guarantee.');
   if(pending()<0){stopCamera();say('All photos captured. Create the panorama to inspect coverage and seams.')}
  }catch(e){stopCamera();say(e.message+' Automatic capture paused; saved photos were kept.')}
  finally{capturing=false;if(!closed)render()}
 }
 const exportSources=node('button','Export original captures (local ZIP)');exportSources.id='capture-export-sources';exportSources.onclick=async()=>{try{if(capturing||working)throw Error('Pause processing before exporting sources.');if(!session.frames.length)throw Error('No source photographs yet.');if(!confirm('Save an unencrypted source ZIP on this device? It includes original photographs and pose metadata. Keep it private.'))return;const {zipSync}=await import('/dist/vendor/backup-crypto.js'),files={},metadata={version:1,plannerVersion:session.plannerVersion,cameraCalibration:session.cameraCalibration,hfov:session.hfov,aspect:session.aspect,targets:session.targets,frames:[]};for(let i=0;i<session.frames.length;i++){const f=session.frames[i],name='frame-'+String(i+1).padStart(2,'0')+'.jpg';files[name]=new Uint8Array(await f.blob.arrayBuffer());const {blob,...fields}=f;metadata.frames.push({...fields,file:name})}files['capture.json']=new TextEncoder().encode(JSON.stringify(metadata));const url=URL.createObjectURL(new Blob([zipSync(files,{level:0})],{type:'application/zip'})),a=node('a');a.href=url;a.download='LevelTwo360-capture-sources.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Sources exported locally. No photographs were uploaded.')}catch(e){say(e.message)}};$('settings').append(exportSources);
 $('photo').onclick=()=>takePhoto(false);
 $('sensors').onclick=enableSensors;
 $('manual').onchange=()=>{clearAim();current=null;calibrated=false;needsAlign=!!session.frames.length;guidance()};
 $('realign').onclick=async()=>{try{if(!stream||!raw||!fresh(lastMotion)||!sensorMoved)throw Error('Move the phone gently to confirm live tracking, then match the starting photo.');align(reference()?.pose);await saveSession(session);say('Starting reference restored. Follow the circle and hold still.');guidance();$('stage').scrollIntoView({block:'start'})}catch(e){say(e.message)}};
 $('start').onclick=async()=>{
  if(starting)return;starting=true;try{
   if(working||capturing)return;if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser has no camera API.');displayAngle=screen.orientation?.angle??0;
   if(!$('manual').checked)await enableSensors();if(closed)return;const resumeSetup=fovSetup;stopCamera();fovSetup=resumeSetup;lastMotion=0;raw=null;previousRaw=null;sensorMoved=false;removeEventListener('deviceorientation',motion);addEventListener('deviceorientation',motion);
   const attempt=++startGeneration,acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}}});if(closed||attempt!==startGeneration){acquired.getTracks().forEach(t=>t.stop());return}stream=acquired;
   $('video').srcObject=stream;await $('video').play();if(closed){stopCamera();return}
   const aspect=$('video').videoWidth/$('video').videoHeight;
   liveAspect=aspect;liveFov=session.hfov;if(session.frames.length&&Math.abs(aspect-session.aspect)>.02){if(Math.abs(aspect-1/session.aspect)>.03)throw Error('Camera framing changed. Restore the same lens/framing, then Resume Capture; all photos are kept.');liveFov=transposeFOV(session.hfov,session.aspect);}
   if(session.cameraBinding&&session.cameraBinding!==await cameraBinding())throw Error('Camera lens, zoom or framing changed. Start another capture for camera setup; existing photos are kept.');
   if(!session.frames.length&&!session.cameraCalibration){session.aspect=aspect;session.targets=capturePlan(session.hfov,aspect,session.plannerVersion===2?planningOptions():undefined);index=0;delete session.heading;await saveSession(session)}
   if(!session.frames.length&&session.cameraCalibration&&Math.abs(aspect-session.aspect)>.02){if(Math.abs(aspect-1/session.aspect)>.03)throw Error('Camera framing changed. Start another capture to estimate it again.');liveFov=transposeFOV(session.hfov,session.aspect);}
   if(liveFov<35||liveFov>100)throw Error('This camera framing is outside the prototype range. Use the standard rear lens and start another capture; saved photos are kept.');
   fit();stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(stream?.getTracks().includes(track)){stopCamera();say('Camera interrupted. Tap Resume Capture; saved photos are kept.');guidance()}}));
   say((session.cameraCalibration?'Camera uses a visual/sensor field-of-view estimate. ':'Camera field of view is unverified; Camera setup can estimate it before the first photo. ')+ 'Camera active. Rotate around the lens and follow the empty circle. Photos stay on this device.');render();$('stage').scrollIntoView({block:'start'});
  }catch(e){stopCamera();say(e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in browser settings; existing photos are kept.':e.message)}finally{starting=false;if(!closed)guidance()}
 };
 $('sessions').onchange=async()=>{try{stopCamera();stopWorker();disposePreview();const found=(await listSessions(apartmentKey)).find(r=>r.id===$('sessions').value);if(!found)throw Error('Capture no longer exists.');session=found;needsAlign=!!session.frames.length;fields();$('approved').checked=false;if(session.output)preview();render()}catch(e){say(e.message)}};
 const onPageHide=()=>{stopCamera();stopWorker()},onBackground=()=>{if(document.hidden){onPageHide();say('Capture paused. Saved photos were kept. Restart and realign to continue.')}};
 const onRotate=()=>{stopCamera();displayAngle=screen.orientation?.angle??0;say('Screen rotated. Tap Resume Capture, then match the starting photo. Saved photos are kept.');guidance()};
 addEventListener('deviceorientation',motion);document.addEventListener('visibilitychange',onBackground);addEventListener('pagehide',onPageHide);screen.orientation?.addEventListener('change',onRotate);
 $('stitch').onclick=async()=>{try{
  if(working||capturing)return;if(!globalThis.Worker||!globalThis.OffscreenCanvas||!globalThis.createImageBitmap)throw Error('This browser lacks the required local worker/canvas support. Source photos were kept.');
  if(!session.frames.length)throw Error('Capture photos first.');const cov=coverage(session.frames);if(cov.missing)throw Error('Missing estimated coverage ('+cov.percent.toFixed(1)+'%). Retake missing directions before stitching.');
  stopCamera();lastStitchFailed=false;$('approved').checked=false;$('stitch-details').hidden=true;working=true;render();$('stop').disabled=false;$('progress').max=session.frames.length;$('progress').value=0;say('Stitching locally in a worker. No photos are uploaded.');
  worker=new Worker(new URL('./stitch-worker.js',import.meta.url),{type:'module'});worker.onerror=()=>{lastStitchFailed=true;stopWorker();say('Stitch worker failed; source photos were kept. Retry after checking browser support.');render()};
  worker.onmessage=async({data})=>{if(data.type==='alignment-progress')say(data.stage==='features'?'Finding image details: '+data.done+' of '+data.total+' photos.':data.stage==='matching'?'Checking overlapping photographs: '+data.done+' of '+data.total+'.':'Refining camera alignment locally…');else if(data.type==='progress')$('progress').value=data.done;else if(data.type==='error'){lastStitchFailed=true;$('stitch-details').hidden=!data.diagnostics;$('stitch-diagnostic').textContent=data.diagnostics?JSON.stringify(data.diagnostics,null,2):'';stopWorker();$('approved').checked=false;say(data.message+(session.output?' Previous saved preview remains; no new panorama was created.':''));render()}else if(data.type==='result'){
   stopWorker();const next={...session,output:data.blob,report:data.report,state:'preview',name:$('name').value.trim(),group:$('group').value.trim()};try{await saveSession(next);session=next;if(closed)return;$('approved').checked=false;preview();render()}catch(e){lastStitchFailed=true;say(e.message);render()}
  }};worker.postMessage({plannerVersion:session.plannerVersion,engine:$('engine').value,frames:session.frames,width:Number($('resolution').value),quality:Number($('quality').value)});
 }catch(e){stopWorker();say(e.message);render()}};
 $('stop').onclick=()=>{stopWorker();render();say('Stitching canceled. Source photos and any previous complete preview were kept.')};$('approved').onchange=render;
 if(syntheticBench){const b=node('button','Load synthetic test captures (no camera)');b.id='capture-synthetic';b.onclick=async()=>{try{if(session.frames.length&&!confirm('Replace only this capture session with synthetic test frames? Saved apartments stay unchanged.'))return;stopCamera();stopWorker();b.disabled=true;say('Generating synthetic test photographs locally…');const {syntheticFrames}=await import('./synthetic.js'),data=await syntheticFrames({scene:(await import('./indoor-fixture.js')).indoorColor});const next={...session,...data,state:'capturing',output:null,report:null};await saveSession(next);session=next;index=0;updateReference();disposePreview();render();say('Synthetic frames saved locally. Create the panorama to test the pipeline.')}catch(e){say(e.message)}finally{b.disabled=false}};d.insertBefore(b,$('stage'))}
 let finish;const result=new Promise(resolve=>finish=resolve);
 const timer=setInterval(()=>{if(!fresh(lastMotion)){$('hold').value=0;gate.reset()}guidance()},100);
 function close(value){if(closed)return;closed=true;stopCamera();stopWorker();disposePreview();if(anchorURL)URL.revokeObjectURL(anchorURL);removeEventListener('deviceorientation',motion);document.removeEventListener('visibilitychange',onBackground);removeEventListener('pagehide',onPageHide);screen.orientation?.removeEventListener('change',onRotate);clearInterval(timer);removeEventListener('resize',resize);if(document.fullscreenElement===document.documentElement)document.exitFullscreen().catch(()=>{});d.close();d.remove();finish(value)}
 $('close').onclick=()=>close(null);d.addEventListener('cancel',e=>{e.preventDefault();close(null)});
 $('delete').onclick=async()=>{if(confirm('Delete only these temporary source captures and preview? Saved apartment JPEGs stay unchanged.')){try{await deleteSession(session.id);close(null)}catch(e){say(e.message)}}};
 $('new').onclick=async()=>{if(!confirm('Keep this session on device and start a separate capture?'))return;try{stopCamera();stopWorker();disposePreview();session=newSession(apartmentKey);await saveSession(session);fields();$('approved').checked=false;await sessions();render()}catch(e){say(e.message)}};
 $('use').onclick=()=>{if(!previewReviewable(session.report)||!session.output||working||capturing||!$('approved').checked)return;const name=$('name').value.trim(),group=$('group').value.trim();if(!name||name.length>80||group.length>80){say('Enter a viewpoint name up to 80 characters.');return}const snapshot=session;close({file:new File([snapshot.output],name.replace(/[\\/:*?"<>|]/g,'-')+'.jpg',{type:'image/jpeg'}),name,roomName:group,sessionId:snapshot.id,async committed(){await saveSession({...snapshot,state:'committed',name,group})}})};
 fields();$('stop').disabled=true;d.showModal();await sessions();if(session.output)preview();render();return result;
}
