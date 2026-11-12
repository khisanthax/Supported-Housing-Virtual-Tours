import { readTestBackup as unpackTour, startBackupDownload, fillBackupDialog } from './backup-probe-tools.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { packTour } from '../dist/tour-package.js';

const { chromium } = await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin = process.env.PILOT_PROBE_ORIGIN ?? 'http://localhost:4193';
const password = process.env.PILOT_PROBE_STAFF ??
  (origin === 'http://localhost:4193' ? 'Synthetic KV prototype staff only' : null);
assert.ok(password, 'Provide the synthetic staff credential through the environment');
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.PILOT_CHROMIUM, args });
const second = await chromium.launch({ channel: 'msedge', args });
const disposable = new Map();
let page, share;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function signIn(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.on('dialog', dialog=>dialog.accept());
  await page.goto(origin + '/staff');
  if (process.env.PILOT_PROBE_USERNAME) await page.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);
  await page.locator('input[name=passphrase]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('#catalog').waitFor();
  return page;
}
async function api(path, method = 'GET', data, expected = 200, client = page) {
  const r = await client.request.fetch(origin + '/api/staff/' + path, { method, headers: { Origin: origin }, data });
  assert.equal(r.status(), expected, path);
  return r.json();
}
async function importBackup(bytes, replacement = '') {
  await page.goto(origin + '/staff');
  await page.locator('details').filter({has:page.locator('#import')}).evaluate(d=>{d.open=true;});
  await page.locator('#replace-apartment option').first().waitFor({ state: 'attached' });
  await page.locator('#replace-apartment').selectOption(replacement);
  await page.locator('#import input[type=file]').setInputFiles({ name: 'synthetic-restore.shtour', mimeType: 'application/octet-stream', buffer: bytes });
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url() === origin + '/api/staff/apartments' && r.request().method() === 'POST'),
    (async () => {
      await page.locator('#import').getByRole('button', { name: 'Import apartment', exact: true }).click();
      if(bytes[0]===80&&bytes[1]===75)await fillBackupDialog(page);
    })()
  ]);
  assert.equal(response.status(), 201);
  const result = await response.json();
  disposable.set(result.id, result.version);
  await page.locator('#message').getByText(/imported as a private draft/i).waitFor();
  return result;
}
try {
  page = await signIn(browser);
  const source = (await api('dashboard')).apartments.find(a => /^Synthetic /.test(a.title) && !a.archived);
  assert.ok(source, 'An existing synthetic tour is required');
  const original = await api('drafts/' + source.id);
  const tour = { ...original.tour, title: 'Synthetic backup rehearsal ' + Date.now() };
  const created = await api('apartments', 'POST', { tour, photos: original.photos }, 201);
  disposable.set(created.id, created.version);
  await page.reload();
  const row = page.locator('#catalog li').filter({ hasText: tour.title });
  await row.locator('details').evaluate(d=>{d.open=true;});
  const pending = page.waitForEvent('download');
  await startBackupDownload(page,row.getByRole('button', { name: 'Export .shtour', exact: true }));
  const download = await pending;
  const bytes = await readFile(await download.path());
  const backup = await unpackTour(new Blob([bytes]));
  assert.deepEqual(backup.tour, tour);
  const hashes = new Map();
  for (const room of tour.rooms) {
    const r = await page.request.get(origin + '/api/staff/tours/' + created.id + '/images/' + room.id);
    assert.equal(r.status(), 200);
    const hash = digest(await r.body());
    assert.equal(digest(Buffer.from(await backup.images.get(room.id).arrayBuffer())), hash);
    hashes.set(room.id, hash);
  }
  await api('apartments/' + created.id, 'PATCH', { action: 'remove', expectedVersion: created.version });
  disposable.delete(created.id);
  const restored = await importBackup(bytes);
  assert.notEqual(restored.id, created.id);
  const saved = await api('drafts/' + restored.id);
  assert.deepEqual(saved.tour, tour);
  const dashboard = await api('dashboard');
  assert.equal(dashboard.apartments.find(a => a.id === restored.id).published, 0);
  assert.deepEqual(await api('drafts/' + source.id), original, 'Existing source tour must stay unchanged');
  const other = await signIn(second);
  assert.deepEqual((await api('drafts/' + restored.id, 'GET', undefined, 200, other)).tour, tour);
  for (const room of tour.rooms) {
    const r = await other.request.get(origin + '/api/staff/tours/' + restored.id + '/images/' + room.id);
    assert.equal(r.status(), 200);
    assert.equal(digest(await r.body()), hashes.get(room.id));
  }
  await other.goto(origin + '/staff/editor/?apartment=' + restored.id);
  await other.locator('#guide-title').waitFor();
  await other.getByRole('button',{name:'4. Preview & Publish',exact:true}).click();
  await other.locator('#loading').waitFor({ state: 'hidden' });
  assert.equal(await other.locator('#error').isVisible(), false);
  for (const room of tour.rooms) {
    await other.locator('#room-tabs').getByRole('button', { name: room.name, exact: true }).click();
    await other.locator('#scene-name').getByText(room.name, { exact: true }).waitFor();
  }
  console.log('PASS browser export, original removal, new private restore, complete manifest/JPEG byte equality and independent Edge retrieval');
  if (process.env.PILOT_TEST_PUBLISH === '1') {
    await api('apartments/' + restored.id, 'PATCH', { action: 'publish', expectedVersion: restored.version });
    share = await api('shares', 'POST', { apartments: [restored.id], expires: Date.now() + 600000, wordCount: 3 }, 201);
    const guest = await browser.newPage();
    assert.equal((await guest.request.post(origin + '/api/guest/unlock', {
      headers: { Origin: origin }, data: { token: new URL(share.url).hash.slice(1), code: share.code }
    })).status(), 200);
    const url = origin + '/api/guest/tours/' + restored.id + '/manifest';
    let response;
    const deadline = Date.now() + 90000;
    do {
      response = await guest.request.get(url);
      if (response.status() === 200) break;
      assert.equal(response.status(), 404);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.json(), tour);
    const edited = await api('apartments', 'POST', {
      tour: { ...tour, title: tour.title + ' unpublished edit' }, photos: saved.photos,
      replacement: restored.id, expectedVersion: restored.version
    }, 201);
    disposable.set(edited.id, edited.version);
    const replacementTitle = tour.title + ' replacement draft';
    const replacementBytes = Buffer.from(await packTour({ tour: { ...tour, title: replacementTitle }, images: backup.images }).arrayBuffer());
    const replaced = await importBackup(replacementBytes, restored.id);
    assert.equal(replaced.id, restored.id);
    assert.equal((await api('drafts/' + restored.id)).tour.title, replacementTitle);
    assert.deepEqual(await (await guest.request.get(url)).json(), tour, 'Import must not change the published tour');
    assert.equal((await guest.request.get(origin + '/api/staff/drafts/' + restored.id)).status(), 401);
    console.log('PASS explicit synthetic publication, backup replacement saves only a draft and guest editing is denied');
  }
} finally {
  if (page && share) await api('shares/' + share.id, 'DELETE');
  for (const [id, version] of disposable) await api('apartments/' + id, 'PATCH', { action: 'remove', expectedVersion: version });
  if (page) await api('sign-out', 'POST', {});
  await browser.close();
  await second.close();
}
