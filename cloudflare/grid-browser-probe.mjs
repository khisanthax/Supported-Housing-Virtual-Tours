import { readTestBackup as unpackTour, startBackupDownload, fillBackupDialog } from './backup-probe-tools.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin = process.env.PILOT_PROBE_ORIGIN ?? 'http://localhost:4193';
const password = process.env.PILOT_PROBE_STAFF ?? (origin === 'http://localhost:4193' ? 'Synthetic KV prototype staff only' : null);
assert.ok(password);
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args }), edge = await chromium.launch({ channel: 'msedge', args });
let page, id, revision;
async function login(browser, mobile = false) {
  const p = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 }, hasTouch: mobile, isMobile: mobile });
  await p.goto(origin + '/staff');
  if (process.env.PILOT_PROBE_USERNAME) await p.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);
  await p.locator('input[name=passphrase]').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.locator('#catalog').waitFor();
  return p;
}
async function draft(p = page) {
  const r = await p.request.get(origin + '/api/staff/drafts/' + id); assert.equal(r.status(), 200);
  const d = await r.json(); revision = d.revision; return d;
}
async function save(p, operation) {
  const [r] = await Promise.all([p.waitForResponse(r => r.url() === origin + '/api/staff/apartments' && r.request().method() === 'POST'), operation()]);
  assert.equal(r.status(), 201, await r.text());
  const result = await r.json(); id = result.id; revision = result.version;
  await p.waitForFunction(() => !document.querySelector('#editor-fields').disabled);
}
async function editor(p) {
  await p.locator('#loading').waitFor({ state: 'hidden' });
  assert.equal(await p.locator('#error').isVisible(), false);
  await p.locator('#edit-tour').click();
  await p.locator('.room-grid-tile').first().waitFor();
}
try {
  page = await login(browser);
  await page.getByRole('heading', { name: 'Apartment Gallery', exact: true }).waitFor();
  await page.goto(origin+'/staff/editor/?legacy=1'); await editor(page);
  const sample = JSON.parse(await readFile(new URL('../dist/data/apartment.json', import.meta.url)));
  await page.locator('#new-tour').setInputFiles(sample.rooms.map(r => fileURLToPath(new URL('../dist/' + r.image, import.meta.url))));
  const review = page.getByRole('dialog', { name: 'Review stitched panoramas' });
  await review.waitFor(); assert.equal(await review.locator('img').count(), 6);
  for (let i = 0; i < 6; i++) await review.locator('input').nth(i).fill(sample.rooms[i].name);
  await save(page, () => review.getByRole('button', { name: 'Upload and save draft' }).click());
  const title = 'Synthetic grid acceptance ' + Date.now();
  await page.locator('#draft-title').fill(title);
  await save(page, () => page.getByRole('button', { name: 'Save title', exact: true }).click());
  assert.equal(await page.locator('.room-grid-tile').count(), 6);
  await mkdir('test-results', { recursive: true });
  await page.locator('#room-grid').screenshot({ path: 'test-results/room-grid-desktop.png' });
  const initial = await draft(), [a, b, c] = initial.tour.rooms;
  // Actual mouse drag snaps the second tile from column 3 to column 2.
  const handle = page.getByRole('button', { name: 'Move ' + b.name, exact: true }); await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  await save(page, async () => {
    await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 30 - 164, box.y + 20, { steps: 8 }); await page.mouse.up();
  });
  let d = await draft(); assert.deepEqual(d.tour.grid.positions[b.id], { x: 1, y: 0 });
  assert.ok(d.tour.rooms[0].links[0].pending); assert.equal(d.tour.rooms[0].links[0].yaw, undefined);
  const connectionName = a.name + ' to ' + b.name;
  await save(page, () => page.getByRole('button', { name: 'Remove connection ' + connectionName, exact: true }).click());
  assert.equal((await draft()).tour.rooms[0].links.length, 0);
  await save(page, () => page.getByRole('button', { name: 'Restore connection ' + connectionName, exact: true }).click());
  await page.getByLabel('Connect room', { exact: true }).selectOption(a.id); await page.getByLabel('To room', { exact: true }).selectOption(c.id);
  await save(page, () => page.getByRole('button', { name: 'Connect rooms', exact: true }).click());
  let publication = await page.request.patch(origin + '/api/staff/apartments/' + id, { headers: { Origin: origin }, data: { action: 'publish', expectedVersion: revision } });
  assert.equal(publication.status(), 400, 'both unpositioned arrows must prevent publication');
  // Staff opens each panorama directly from its placement status, then places the arrow.
  for (const [source, target] of [[a, b], [b, a], [a, c], [c, a]]) {
    await page.getByRole('button', { name: source.name + ' → ' + target.name + ' · Needs position', exact: true }).click();
    await page.locator('#place-on-pano').waitFor({ state: 'visible' });
    await save(page, () => page.locator('#place-on-pano').press('Enter'));
  }
  const positioned = (await draft()).tour.rooms[0].links.find(l => l.target === b.id);
  publication = await page.request.patch(origin + '/api/staff/apartments/' + id, { headers: { Origin: origin }, data: { action: 'publish', expectedVersion: revision } });
  assert.equal(publication.status(), 200, 'fully positioned navigation can be explicitly published');
  assert.equal((await page.request.patch(origin + '/api/staff/apartments/' + id, { headers: { Origin: origin }, data: { action: 'unpublish', expectedVersion: revision } })).status(), 200);
  const url = page.url(); await page.reload(); await editor(page);
  assert.deepEqual((await draft()).tour.rooms[0].links.find(l => l.target === b.id), positioned);
  const mobile = await login(edge, true); await mobile.goto(url); await editor(mobile);
  assert.deepEqual((await draft(mobile)).tour, (await draft()).tour);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  // A real touch pointer stream on the drag handle, independently of panorama panning.
  const mh = mobile.getByRole('button', { name: 'Move ' + b.name, exact: true }); await mh.scrollIntoViewIfNeeded();
  const mb = await mh.boundingBox(), cdp = await mobile.context().newCDPSession(mobile);
  await save(mobile, async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mb.x + 30, y: mb.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mb.x + 30, y: mb.y + 20 + 164 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
  d = await draft(mobile); assert.deepEqual(d.tour.grid.positions[b.id], { x: 1, y: 1 });
  assert.equal(d.tour.rooms[0].links.some(l => l.target === b.id), false);
  assert.ok(d.tour.rooms[0].links.find(l => l.target === c.id).yaw !== undefined);
  await mobile.setViewportSize({ width: 900, height: 700 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const [download] = await Promise.all([mobile.waitForEvent('download'), startBackupDownload(mobile,mobile.locator('#export-tour'))]);
  const bytes = await readFile(await download.path()), backup = await unpackTour(new Blob([bytes]));
  assert.deepEqual(backup.tour, d.tour);
  await mobile.locator('#import-tour').setInputFiles({ name: 'synthetic-grid.shtour', mimeType: 'application/octet-stream', buffer: bytes });
  await fillBackupDialog(mobile);
  await save(mobile, () => mobile.getByRole('button', { name: 'Replace draft with backup', exact: true }).click());
  assert.deepEqual((await draft(mobile)).tour, backup.tour);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(origin + '/staff');
  const card = mobile.locator('.gallery-card').filter({ hasText: title }); await card.waitFor();
  await card.locator('img').scrollIntoViewIfNeeded();
  await card.locator('img').evaluate(img => img.decode());
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await mobile.screenshot({ path: 'test-results/apartment-gallery.png' });
  assert.equal((await mobile.request.get(origin + '/api/staff/tours/' + id + '/thumbnail')).status(), 200);
  assert.equal((await (await browser.newContext()).request.get(origin + '/api/staff/tours/' + id + '/thumbnail')).status(), 401);
  console.log('PASS six-image upload, mouse/touch grid drag, adjacency toggle, manual links, publish guard, both arrow positions, reload/Edge, backup import and responsive private gallery');
} finally {
  if (page && id) {
    const current = await draft();
    assert.equal((await page.request.patch(origin + '/api/staff/apartments/' + id, { headers: { Origin: origin }, data: { action: 'remove', expectedVersion: current.revision } })).status(), 200);
  }
  await browser.close(); await edge.close();
}
