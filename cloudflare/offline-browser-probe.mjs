import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin = 'http://localhost:4193';
const passphrase = 'Synthetic KV prototype staff only';
const vaultPassword = 'Separate synthetic offline vault fixture';
const profile = await mkdtemp(join(tmpdir(), 'housing-offline-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: process.env.PILOT_CHROMIUM, args: ['--enable-unsafe-swiftshader']
});
let context;
try {
  context = await launch();
  let page = await context.newPage();
  await page.goto(origin + '/staff');
  await page.locator('input[name=passphrase]').fill(passphrase);
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
  await page.getByRole('link', {name:'Available Offline'}).click();
  await page.locator('#offline-pass').fill(vaultPassword);
  await page.locator('#offline-unlock-button').click();
  const choice = page.getByRole('checkbox', {name:/^Synthetic /}).first();
  const title = (await choice.locator('..').textContent()).split(' · ')[0];
  await choice.check();
  await page.getByRole('button', {name:'Download selected'}).click();
  await page.getByRole('button', {name:'Open ' + title, exact:true}).waitFor();
  await context.close();
  context = await launch();
  await context.setOffline(true);
  page = await context.newPage();
  await page.goto(origin + '/offline/');
  await page.locator('#offline-pass').fill(vaultPassword);
  await page.locator('#offline-unlock-button').click();
  await page.getByRole('button', {name:'Open ' + title, exact:true}).click();
  await page.locator('#room-title').getByText('Living room', {exact:true}).waitFor();
  await page.getByRole('button', {name:'Next room', exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#room-title').textContent !== 'Living room');
  assert.equal(await page.locator('#error').isVisible(), false);
  console.log('PASS offline browser restart, vault unlock and room navigation');
} finally {
  await context?.close();
  await rm(profile, {recursive:true,force:true});
}
