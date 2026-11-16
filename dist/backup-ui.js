import {beginOperation} from './operation-trace.js';
import {safeBackupLabel,backupFilename} from './backup-name.js';
import { encryptBackup, decryptBackup, isEncryptedBackup } from './encrypted-backup.js';
import { unpackTour } from './tour-package.js';

function passwordDialog(creating, operation, suggestedName='') {
  const dialog = document.createElement('dialog'); dialog.className = 'backup-password-dialog';
  dialog.style.cssText = 'max-width:32rem;width:calc(100% - 32px);box-sizing:border-box;max-height:90dvh;overflow:auto';
  dialog.innerHTML = `<form><h2>${creating ? 'Export encrypted backup' : 'Unlock encrypted backup'}</h2><p>${creating ? 'Creates an encrypted ZIP. Keep its password separately in approved secure storage. Lost passwords cannot be recovered.' : 'Your password stays on this device. The complete backup is checked before uploading anything.'}</p>${creating?'<label>Backup filename label<input name="backupName" maxlength="64" autocomplete="off"><small>The filename is visible outside encryption. Use a generic label if the apartment name is sensitive. A unique date/suffix is added.</small></label>':''}<label>Backup password<input name="backupPassword" type="password" required autocomplete="off" ${creating ? 'minlength="12"' : ''} style="display:block;width:100%;box-sizing:border-box;min-height:44px;font-size:16px"></label>${creating ? '<label>Confirm backup password<input name="backupConfirmation" type="password" required autocomplete="off" style="display:block;width:100%;box-sizing:border-box;min-height:44px;font-size:16px"></label>' : ''}<p role="status" aria-live="polite"></p><button type="submit">${creating ? 'Encrypt and Download' : 'Unlock backup'}</button> <button type="button" data-cancel>Cancel</button></form>`;
  document.body.append(dialog);if(creating)dialog.querySelector('[name=backupName]').value=safeBackupLabel(suggestedName);
  const form = dialog.querySelector('form'), message = dialog.querySelector('[role=status]'), submit = form.querySelector('[type=submit]'), abort = new AbortController();
  const previousFocus = document.activeElement;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value, error) => {
      if (done) return; done = true;
      form.reset(); dialog.close(); dialog.remove(); previousFocus?.focus();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => { abort.abort(); finish(null, new DOMException('Backup operation cancelled.', 'AbortError')); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); cancel(); });
    dialog.querySelector('[data-cancel]').onclick = cancel;
    form.onsubmit = async e => {
      e.preventDefault();
      const fileLabel=form.elements.backupName?.value;
      let password = form.elements.backupPassword.value;
      if (creating && password !== form.elements.backupConfirmation.value) { message.textContent = 'Backup passwords do not match.'; return; }
      submit.disabled = true;
      for (const input of form.querySelectorAll('input')) { input.value = ''; input.disabled = true; }
      try {
        const result = await operation(password, { signal: abort.signal, fileLabel, progress: text => { message.textContent = text; } });
        if (!abort.signal.aborted) finish(result);
      } catch (error) {
        if (done) return;
        message.textContent = error.message; submit.disabled = false;
        for (const input of form.querySelectorAll('input')) input.disabled = false;
        form.elements.backupPassword.focus();
      } finally { password = ''; }
    };
    dialog.showModal(); form.elements.backupPassword.focus();
  });
}
export async function exportBackup(loadDraft,suggestedName=loadDraft?.tour?.title??'Apartment') {
  const trace=beginOperation('backup',new URL(location.href).searchParams.get('apartment'));
  return passwordDialog(true, async (password, options) => {
    trace.mark('backup-export');try{
    options.progress('Collecting complete apartment backup…');
    const draft = typeof loadDraft === 'function' ? await loadDraft(options.signal,trace) : loadDraft;
    const blob = await encryptBackup(draft, password, options);
    if (options.signal.aborted) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = backupFilename(options.fileLabel||draft.tour.title); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    trace.mark('backup-export',{status:200,count:draft.images.size});
    return true;}catch(error){trace.mark('backup-export',{status:error.name==='AbortError'?499:500});trace.retry();throw error;}finally{trace.send();}
  },suggestedName);
}
export async function readBackup(file,trace=beginOperation('backup')) {
  if (!await isEncryptedBackup(file)) return unpackTour(file);
  return passwordDialog(false, async(password, options)=>{trace.mark('backup-import');try{const result=await decryptBackup(file,password,options);trace.mark('backup-import',{status:200,count:result.images.size});return result;}catch(e){trace.mark('backup-import',{status:400});trace.retry();throw e;}finally{trace.send();}});
}
