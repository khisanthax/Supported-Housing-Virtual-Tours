import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin = process.env.PILOT_PROBE_ORIGIN ?? 'http://localhost:4193';
const passphrase = process.env.PILOT_PROBE_STAFF ??
  (origin === 'http://localhost:4193' ? 'Synthetic KV prototype staff only' : null);
assert.ok(passphrase);
const desktop = await chromium.launch({ executablePath:process.env.PILOT_CHROMIUM, args:['--enable-unsafe-swiftshader'] });
const second = await chromium.launch({ channel:'msedge', args:['--enable-unsafe-swiftshader'] });
let page, disposableId, disposableShare;
try {
  const title = 'Synthetic cloud editor check ' + Date.now();
  async function signIn(browser, mobile) {
    const page = await browser.newPage(mobile ? {viewport:{width:360,height:800},isMobile:true,hasTouch:true,deviceScaleFactor:2} : {});
    await page.goto(origin + '/staff/editor/');
    await page.waitForURL('**/staff');
    if (process.env.PILOT_PROBE_USERNAME) {
      await page.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);
    }
    await page.locator('input[name=passphrase]').fill(passphrase);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('link',{name:'Start an apartment'}).waitFor();
    return page;
  }
  page = await signIn(desktop,false);
  await page.getByRole('link',{name:'Start an apartment'}).click();
  async function openEditor(page, mobile=false) {
    await page.waitForFunction(()=>document.querySelector('#announcement')?.textContent.includes('opened') ||
      document.querySelector('#error')?.hidden === false);
    assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());
    if (mobile) await page.locator('#edit-tour').tap();
    else await page.locator('#edit-tour').click();
  }
  await openEditor(page);
  await page.locator('#draft-title').waitFor();
  const archive = process.env.PILOT_LOCAL_ZIP;
  assert.ok(!archive || origin === 'http://localhost:4193','External ZIP tests must stay local');
  const sample = name => fileURLToPath(new URL('./sample-images/'+name+'.jpg',import.meta.url));
  await page.locator('#new-tour').setInputFiles(archive ?? [sample('living'),sample('kitchen'),sample('bedroom')]);
  const review=page.getByRole('dialog',{name:'Review stitched panoramas'});
  await review.waitFor();
  assert.equal(await review.locator('img').count(),archive ? 6 : 3);
  const suggested=await review.locator('input').first().inputValue();
  if (archive) assert.equal(suggested,'Living Room');
  await review.locator('input').first().fill('Living room');
  await page.route('**/api/staff/photos',route=>route.fulfill({status:503,json:{error:'Test interruption. Retry upload.'}}),{times:1});
  await review.getByRole('button',{name:'Upload and save draft'}).click();
  await review.getByText('Test interruption. Retry upload.').waitFor();
  await review.getByRole('button',{name:'Retry save'}).click();
  await review.waitFor({state:'hidden'});
  await page.locator('#draft-title').fill(title);
  await page.getByRole('button',{name:'Save title'}).click();
  await page.locator('#editor-feedback').getByText('Apartment title saved.').waitFor();
  await page.locator('#add-door').click();
  await page.locator('#place-on-pano').press('Enter');
  await page.locator('#new-door-target').selectOption({index:1});
  await page.getByRole('button',{name:'Save connection'}).click();
  await page.locator('#editor-feedback').getByText(/Doorway saved/).waitFor();
  await page.locator('#place-return').click();
  await page.locator('#place-return').click();
  await page.locator('#place-on-pano').press('Enter');
  await page.locator('#editor-feedback').getByText('Doorway arrow positioned.').waitFor();
  const url = page.url();
  const id = new URL(url).searchParams.get('apartment');
  disposableId = id;
  const endpoint = origin + '/api/staff/drafts/' + id;
  const draft = async browserPage => (await browserPage.request.get(endpoint)).json();
  const saved = await draft(page);
  assert.equal(saved.tour.rooms.length,archive ? 6 : 3);
  assert.equal(saved.tour.rooms.flatMap(room=>room.links).length,2);
  assert.ok(saved.tour.rooms.every(room=>room.links.every(link=>!link.pending)));
  await page.reload();
  await openEditor(page);
  await page.locator('#draft-title').waitFor();
  assert.equal(await page.locator('#draft-title').inputValue(),title);
  const mobile = await signIn(second,true);
  const item=mobile.locator('#catalog li').filter({hasText:title});
  await item.getByRole('link',{name:'Edit draft'}).tap();
  await openEditor(mobile,true);
  await mobile.locator('#draft-title').waitFor();
  assert.equal(await mobile.locator('#draft-title').inputValue(),title);
  assert.equal(await mobile.locator('#room-tabs button').count(),saved.tour.rooms.length);
  await mobile.locator('#add-rooms').setInputFiles(sample('bedroom'));
  const batch=mobile.getByRole('dialog',{name:'Review stitched panoramas'});
  await batch.waitFor();
  assert.equal(await batch.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  await batch.locator('select').selectOption(saved.tour.startRoom);
  await batch.getByRole('button',{name:'Upload and save draft'}).tap();
  await batch.waitFor({state:'hidden'});
  const replaced=await draft(mobile);
  assert.deepEqual(replaced.tour,saved.tour);
  assert.notEqual(replaced.photos[saved.tour.startRoom],saved.photos[saved.tour.startRoom]);
  const stale=await page.request.post(origin+'/api/staff/apartments',{headers:{Origin:origin},data:{
    tour:saved.tour,photos:saved.photos,replacement:id,expectedVersion:saved.revision,draft:true
  }});
  assert.equal(stale.status(),409);
  await mobile.goto(origin+'/staff');
  await mobile.getByRole('button',{name:'Sign out'}).tap();
  await mobile.getByRole('heading',{name:'Staff sign-in'}).waitFor();
  assert.equal((await mobile.request.get(endpoint)).status(),401);
  console.log('PASS browser sign-in, batch preview, upload retry, reciprocal arrows, reload, mobile viewport in second browser, replacement, conflict protection and logout');
  if (process.env.PILOT_TEST_PUBLISH === '1') {
    const staffApi = (path,method='GET',data) => page.request.fetch(origin+'/api/staff/'+path,{
      method,headers:{Origin:origin},data
    });
    const dashboard=await (await staffApi('dashboard')).json();
    const other=dashboard.apartments.find(item=>item.id!==id && item.published);
    assert.ok(other);
    const shareData={apartments:[id,other.id],expires:Date.now()+3600000,wordCount:3};
    assert.equal((await staffApi('shares','POST',shareData)).status(),400);
    assert.equal((await staffApi('apartments/'+id,'PATCH',{action:'publish',expectedVersion:replaced.revision})).status(),200);
    const shareResponse=await staffApi('shares','POST',shareData);
    assert.equal(shareResponse.status(),201);
    const share=await shareResponse.json();
    disposableShare=share.id;
    await mobile.goto(share.url);
    await mobile.getByLabel('Guest access phrase').fill(share.code.toUpperCase().replaceAll('-',' '));
    await mobile.getByRole('button',{name:'Open shared apartments'}).tap();
    await mobile.getByRole('link',{name:new RegExp(other.title)}).waitFor();
    await mobile.getByRole('link',{name:new RegExp(title)}).waitFor({timeout:90000});
    assert.equal(await mobile.locator('#catalog a').count(),2);
    await mobile.getByRole('link',{name:new RegExp(title)}).tap();
    await mobile.waitForFunction(()=>document.querySelector('#announcement')?.textContent.includes('opened'));
    const photo=origin+'/api/guest/tours/'+id+'/images/'+replaced.tour.startRoom;
    assert.equal((await mobile.request.get(photo)).status(),200);
    assert.equal((await page.request.get(photo)).status(),401);
    assert.equal((await mobile.request.get(endpoint)).status(),401);
    const excluded=dashboard.apartments.find(item=>![id,other.id].includes(item.id));
    if(excluded) assert.equal((await mobile.request.get(origin+'/api/guest/tours/'+excluded.id+'/manifest')).status(),404);
    await mobile.goto(origin+'/staff/editor/');
    await mobile.getByRole('heading',{name:'Staff sign-in'}).waitFor();
    assert.equal((await staffApi('apartments/'+id,'PATCH',{action:'unpublish',expectedVersion:replaced.revision})).status(),200);
    assert.equal((await mobile.request.get(photo)).status(),404);
    assert.equal((await staffApi('shares/'+share.id,'DELETE')).status(),200);
    disposableShare=null;
    assert.equal((await mobile.request.get(photo)).status(),401);
    assert.equal((await staffApi('apartments/'+id,'PATCH',{action:'remove',expectedVersion:replaced.revision})).status(),200);
    disposableId=null;
    assert.equal((await staffApi('cleanup','POST')).status(),200);
    console.log('PASS publish, two-apartment phrase sign-in at mobile viewport, guest isolation, unpublish, revoke, remove and cleanup');
  }
} finally {
  if (page && disposableShare) {
    assert.equal((await page.request.delete(origin+'/api/staff/shares/'+disposableShare,{headers:{Origin:origin}})).status(),200);
  }
  if (page && disposableId) {
    const response=await page.request.get(origin+'/api/staff/drafts/'+disposableId);
    if(response.ok()) {
      const draft=await response.json();
      assert.match(draft.tour.title,/^Synthetic cloud editor check /);
      assert.equal((await page.request.patch(origin+'/api/staff/apartments/'+disposableId,{
        headers:{Origin:origin},data:{action:'remove',expectedVersion:draft.revision}
      })).status(),200);
    }
  }
  await desktop.close();
  await second.close();
}
