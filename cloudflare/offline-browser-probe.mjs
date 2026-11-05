import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin = process.env.PILOT_PROBE_ORIGIN ?? 'http://localhost:4193';
const password = process.env.PILOT_PROBE_STAFF ??
  (origin === 'http://localhost:4193' ? 'Synthetic KV prototype staff only' : null);
assert.ok(password, 'Provide the synthetic staff password through the environment');
const vaultPassword = 'Separate synthetic offline vault fixture';
const profile = await mkdtemp(join(tmpdir(), 'housing-offline-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: process.env.PILOT_CHROMIUM,
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
let context, id, revision, tour, photos, control;
async function api(path, method = 'GET', data, expected = 200) {
  const response = await control.request.fetch(origin + '/api/staff/' + path, {
    method, headers: { Origin: origin }, data
  });
  assert.equal(response.status(), expected, path);
  return response.json();
}
const action = name => api('apartments/' + id, 'PATCH', { action: name, expectedVersion: revision });
try {
  context = await launch();
  control = await context.newPage();
  await control.goto(origin + '/staff');
  if (process.env.PILOT_PROBE_USERNAME) {
    await control.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);
  }
  await control.locator('input[name=passphrase]').fill(password);
  await control.getByRole('button', { name: 'Sign in', exact: true }).click();
  await control.getByRole('link', { name: 'Available Offline' }).waitFor();
  const dashboard = await api('dashboard');
  const source = dashboard.apartments.find(item => process.env.PILOT_OFFLINE_SOURCE ? item.id===process.env.PILOT_OFFLINE_SOURCE : /^Synthetic /.test(item.title) && !item.archived);
  assert.ok(source, 'An existing synthetic tour is required');
  ({ tour, photos } = await api('drafts/' + source.id));
  tour = { ...tour, title: 'Synthetic offline acceptance ' + Date.now() };
  const created = await api('apartments', 'POST', { tour, photos }, 201);
  id = created.id;
  revision = created.version;
  let page = await context.newPage();
  await page.goto(origin + '/offline/');
  const unlock = async () => {
    await page.locator('#offline-pass').fill(vaultPassword);
    await page.locator('#offline-unlock-button').click();
    await page.locator('#offline-library').waitFor();
  };
  await unlock();
  const download = async () => {
    await page.locator('input[value="' + id + '"]').check();
    await page.getByRole('button', { name: 'Download selected', exact: true }).click();
    await page.locator('#offline-message').getByText('Download verified. Ready Offline.', { exact: true }).waitFor();
    await page.locator('#offline-saved li').filter({ hasText: tour.title }).getByText(/Ready Offline/).waitFor();
  };
  await download();
  assert.equal(await page.evaluate(async () => (await caches.keys()).length > 0), true);
  await context.close();
  context = await launch();
  await context.setOffline(true);
  page = await context.newPage();
  await page.goto(origin + '/offline/');
  await page.locator('#offline-connection').getByText('Offline', { exact: true }).waitFor();
  await page.locator('#offline-pass').fill('Incorrect synthetic device passphrase');
  await page.locator('#offline-unlock-button').click();
  await page.locator('#offline-message').getByText('Incorrect device passphrase or damaged storage.', { exact: true }).waitFor();
  assert.equal(await page.locator('#offline-library').isVisible(), false);
  await unlock();
  await page.getByRole('button', { name: 'Open ' + tour.title, exact: true }).click();
  // Visit each sphere and invoke every doorway, including arrows outside the initial view.
  for (const room of tour.rooms) {
    await page.locator('#room-tabs').getByRole('button', { name: room.name, exact: true }).click();
    await page.locator('#room-title').getByText(room.name, { exact: true }).waitFor();
    for (const link of room.links) {
      await page.locator('#room-tabs').getByRole('button', { name: room.name, exact: true }).click();
      const target = tour.rooms.find(item => item.id === link.target);
      await page.getByRole('button', { name: 'Go to ' + target.name, exact: true }).evaluate(button => button.click());
      await page.locator('#room-title').getByText(target.name, { exact: true }).waitFor();
    }
    assert.equal(await page.locator('#error').isVisible(), false);
  }
  console.log('PASS hosted encrypted download, browser-process restart without network, every sphere and doorway');
  await context.setOffline(false);
  control = await context.newPage();
  const changed = await api('apartments', 'POST', {
    tour: { ...tour, title: tour.title + ' updated' }, photos, replacement: id, expectedVersion: revision
  }, 201);
  revision = changed.version;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('#offline-saved').getByText(/Update available/).waitFor();
  const retainedRevision = String(created.version);
  const storedRevision = () => page.evaluate(async id => {
    const { storage } = await import('/offline/offline-store.js');
    return (await storage('get', id)).revision;
  }, id);
  await page.locator('input[value="' + id + '"]').check();
  await page.route('**/api/staff/offline/' + id + '/images/*', route => route.fulfill({ status: 503, body: 'Synthetic download interruption' }), { times: 1 });
  await page.getByRole('button', { name: 'Download selected', exact: true }).click();
  await page.locator('#offline-message').getByText('A room download failed. The previous copy was kept.', { exact: true }).waitFor();
  assert.equal(await storedRevision(), retainedRevision);
  await page.evaluate(() => {
    window.acceptanceEstimate = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ({ quota: 1, usage: 1 });
  });
  await page.getByRole('button', { name: 'Download selected', exact: true }).click();
  await page.locator('#offline-message').getByText('Not enough browser storage. Remove downloads or free space and retry.', { exact: true }).waitFor();
  assert.equal(await storedRevision(), retainedRevision);
  await page.evaluate(() => { navigator.storage.estimate = window.acceptanceEstimate; delete window.acceptanceEstimate; });
  console.log('PASS wrong vault passphrase, interrupted download and low-storage rejection preserve the complete saved revision');
  tour = { ...tour, title: tour.title + ' updated' };
  await download();
  await action('archive');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // Withdrawing the active apartment locks the vault before rendering its unavailable state.
  await page.locator('#offline-unlock').waitFor();
  await unlock();
  await page.locator('#offline-saved').getByText(/Unavailable online/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open ' + tour.title, exact: true }).count(), 0);
  await action('restore');
  const restored = (await api('dashboard')).apartments.find(item => item.id === id);
  assert.equal(restored.published, 0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Open ' + tour.title, exact: true }).waitFor();
  await page.evaluate(() => {
    const later = Date.now() + 169 * 3600000;
    Date.now = () => later;
    window.dispatchEvent(new Event('online'));
  });
  await page.locator('#offline-saved').getByText(/Expired/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open ' + tour.title, exact: true }).count(), 0);
  await page.locator('#offline-saved li').filter({ hasText: tour.title })
    .getByRole('button', { name: 'Remove download', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#offline-saved').children.length);
  console.log('PASS reconnect revision detection, verified replacement, archive withdrawal, restore unpublished, expired access denial and local removal');
} finally {
  if (id && context) {
    await context.setOffline(false);
    control = await context.newPage();
    const row = (await api('dashboard')).apartments.find(item => item.id === id);
    if (row?.archived) await action('restore');
    await action('remove');
    console.log('PASS disposable synthetic apartment removed');
  }
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
