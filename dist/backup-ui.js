import { encryptBackup, decryptBackup, isEncryptedBackup } from './encrypted-backup.js';
import { unpackTour } from './tour-package.js';

function passwordDialog(creating, operation) {
  const dialog = document.createElement('dialog'); dialog.className = 'backup-password-dialog';
  dialog.style.cssText = 'max-width:32rem;width:calc(100% - 32px);box-sizing:border-box;max-height:90dvh;overflow:auto';
  dialog.innerHTML = `<form><h2>${creating ? 'Export encrypted backup' : 'Unlock encrypted backup'}</h2><p>${creating ? 'Creates an encrypted ZIP. Keep its password separately in approved secure storage. Lost passwords cannot be recovered.' : 'Your password stays on this device. The complete backup is checked before uploading anything.'}</p><label>Backup password<input name="backupPassword" type="password" required autocomplete="off" ${creating ? 'minlength="12"' : ''} style="display:block;width:100%;box-sizing:border-box;min-height:44px;font-size:16px"></label>${creating ? '<label>Confirm backup password<input name="backupConfirmation" type="password" required autocomplete="off" style="display:block;width:100%;box-sizing:border-box;min-height:44px;font-size:16px"></label>' : ''}<p role="status" aria-live="polite"></p><button type="submit">${creating ? 'Encrypt and Download' : 'Unlock backup'}</button> <button type="button" data-cancel>Cancel</button></form>`;
  document.body.append(dialog);
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
      let password = form.elements.backupPassword.value;
      if (creating && password !== form.elements.backupConfirmation.value) { message.textContent = 'Backup passwords do not match.'; return; }
      submit.disabled = true;
      for (const input of form.querySelectorAll('input')) { input.value = ''; input.disabled = true; }
      try {
        const result = await operation(password, { signal: abort.signal, progress: text => { message.textContent = text; } });
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
export async function exportBackup(loadDraft) {
  return passwordDialog(true, async (password, options) => {
    options.progress('Collecting complete apartment backup…');
    const draft = typeof loadDraft === 'function' ? await loadDraft(options.signal) : loadDraft;
    const blob = await encryptBackup(draft, password, options);
    if (options.signal.aborted) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'apartment-backup.shtour.zip'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  });
}
export async function readBackup(file) {
  if (!await isEncryptedBackup(file)) return unpackTour(file);
  return passwordDialog(false, (password, options) => decryptBackup(file, password, options));
}
