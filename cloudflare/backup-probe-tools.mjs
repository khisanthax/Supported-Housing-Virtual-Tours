import { decryptBackup, isEncryptedBackup } from '../dist/encrypted-backup.js';
import { unpackTour } from '../dist/tour-package.js';
// Public synthetic test fixture, never a staff credential or production backup password.
export const backupTestPassword = 'Synthetic backup test password only';
export const readTestBackup = async blob => await isEncryptedBackup(blob) ? decryptBackup(blob,backupTestPassword) : unpackTour(blob);
export async function fillBackupDialog(page, exporting = false, password = backupTestPassword) {
  const dialog=page.locator('.backup-password-dialog');await dialog.waitFor();
  await dialog.locator('[name=backupPassword]').fill(password);
  if(exporting)await dialog.locator('[name=backupConfirmation]').fill(password);
  await dialog.getByRole('button',{name:exporting?'Encrypt and Download':'Unlock backup',exact:true}).click();
}
export async function startBackupDownload(page, button) { await button.click();await fillBackupDialog(page,true); }
