import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { configuration } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { loadDemo } from '../server/demo.mjs';

const localRequire = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = localRequire('playwright-core'));
} catch {
  ({ chromium } = createRequire(process.execPath)('playwright'));
}
const store = openStore(':memory:'),
  config = configuration({ PDF_PYTHON: process.env.PDF_PYTHON }, { demo: true });
await loadDemo(store, config);
const server = createApp(store, config);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
config.origin = new URL('http://127.0.0.1:' + server.address().port);
let browser;
let activePage;
const failures = [];
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BNT_SMOKE_CHROMIUM || undefined,
  });
  const staff = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await staff.newPage();
  activePage = page;
  page.setDefaultTimeout(10000);
  const watch = (p) => p.on('pageerror', (e) => failures.push(e.message));
  watch(page);
  const heading = (p, name) => p.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
  const button = (p, name) => p.getByRole('button', { name, exact: true });
  const capture = async (p, name) => {
    if (process.env.BNT_SMOKE_SHOTS) {
      mkdirSync(process.env.BNT_SMOKE_SHOTS, { recursive: true });
      await p.screenshot({ path: join(process.env.BNT_SMOKE_SHOTS, name + '.png'), fullPage: true });
    }
  };
  const checkWidth = async (p) =>
    assert(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Page overflows at ' + p.url()
    );
  await page.goto(config.origin.href);
  await button(page, 'Sign in').click();
  await heading(page, 'Pipelines');
  assert.deepEqual(await page.locator('.sales-board h2').allTextContents(),['Outreach','Discovery','First engagement','Second engagement','Agreement sent','Signed']);
  await page.getByRole('switch',{name:'Compact cards'}).click(); await page.locator('.compact-cards').waitFor();
  await page.getByText('Cinder Hospitality', { exact: true }).first().waitFor();
  await capture(page, 'solutions-desktop');
  await checkWidth(page);
await page.reload();
  await page.locator('.compact-cards').waitFor();
  assert.equal(await page.getByLabel('Jump to stage').count(),0);
  assert.equal(await page.getByRole('switch',{name:'Compact cards'}).getAttribute('aria-checked'),'true');
  assert.deepEqual(await page.locator('.sales-metrics dt').allTextContents(),['Won','Lost','ARR','MRR']);
  await button(page,'Edit stages').click();
  await page.getByLabel('New stage name').fill('Contract review');
  await button(page.getByRole('dialog'),'Add stage').click();
  const review=page.locator('.deal-column').filter({has:page.getByRole('heading',{name:'Contract review'})});
  await review.waitFor();
  await page.locator('.deal-card').filter({hasText:'Cinder Hospitality'}).dragTo(review);
  await review.getByText('Cinder Hospitality',{exact:true}).waitFor();
  await button(page,'Edit stages').click();
  await page.locator('.stage-list > div').filter({hasText:'Contract review'}).getByRole('button',{name:'Delete'}).click();
  await page.getByLabel('Move engagements to').selectOption('first_engagement');
  await button(page.getByRole('dialog'),'Delete stage').click();
  await page.locator('[data-ws-stage="first_engagement"]').getByText('Cinder Hospitality',{exact:true}).waitFor();
  await button(page, 'New engagement').click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('input[name=company]').fill('Browser Pilot');
  await dialog.locator('summary').filter({ hasText: 'Commercial terms' }).click();
  await dialog.getByLabel('Monthly retainer (USD)').fill('1500.50');
  await button(dialog, 'Create engagement').click();
  await heading(page, 'Browser Pilot');
  const path = new URL(page.url()).pathname;
  for (const [stage, label] of [
    ['discovery', 'Discovery'], ['first_engagement', 'First engagement'], ['second_engagement', 'Second engagement'],
    ['agreement_sent', 'Agreement sent'],
  ]) {
    await button(page, 'Move stage').click();
    await dialog.getByLabel('Stage', {exact:true}).selectOption(stage);
    await button(dialog, 'Save stage').click();
    await page.getByText('Advisory engagements · '+label, {exact:true}).waitFor();
  }
  const upload = page.locator('form[data-form="ws-file"]');
  await upload
    .locator('input[type=file]')
    .setInputFiles({
      name: 'pilot-sca.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nPilot SCA'),
    });
  await button(upload, 'Upload file').click();
  await page.getByRole('link', { name: 'pilot-sca.pdf' }).waitFor();
  await button(page, 'Move stage').click();
  await dialog.getByLabel('Stage', { exact: true }).selectOption('signed');
  await button(dialog, 'Save stage').click();
  await page.getByRole('heading',{name:'Client intake',exact:true}).waitFor();
  await page.locator('summary').filter({hasText:'Intake options'}).click();
  const clientId=new URL(page.url()).pathname.split('/').at(-1);
  const [generated] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/form-link') && r.request().method() === 'POST'),
    button(page, 'Copy intake link').click(),
  ]);
  const onboarding = new URL((await generated.json()).path, config.origin).href;
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const client = await guest.newPage();
  watch(client);
  client.setDefaultTimeout(10000);
  activePage = client;
  await client.goto(onboarding);
  await heading(client, 'Welcome to Branded Hospitality Solutions!');
  await checkWidth(client);
  await client.getByLabel('Primary contact name').fill('Alex Person');
  await client.getByLabel('Primary contact email').fill('alex@example.test');
  await client.getByLabel('Who is your ideal customer?').fill('Multi-location restaurant operators.');
  const intakeUpload = client.locator('form[data-form="ws-intake-file"]');
  await intakeUpload
    .locator('input[type=file]')
    .setInputFiles({
      name: 'existing-presentation.pptx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('company,segment\nBlue House,QSR'),
    });
  await button(intakeUpload, 'Upload file').click();
  await client
    .locator('#intake-files')
    .getByText(/existing-presentation.pptx/)
    .waitFor();
await intakeUpload.locator('select').selectOption('logo');
  await intakeUpload.locator('input[type=file]').setInputFiles({name:'company.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAAZpKq8AAAAASUVORK5CYII=','base64')});
  await button(intakeUpload,'Upload file').click(); await client.locator('#intake-files').getByText(/company.png/).waitFor();
  const advance=async(n)=>{await button(client,'Save and continue').click();await client.getByText('Step '+n+' of 9',{exact:true}).waitFor();};
  await advance(2); await advance(3); await button(client,'Add target').click();
  await client.getByLabel('Company',{exact:true}).fill('Harbor Kitchens'); await client.getByLabel('Person',{exact:true}).fill('Morgan Lee');
  await advance(4); await advance(5); await client.locator('button[data-key="partnerships"]').click();
  await client.getByLabel('Partner',{exact:true}).fill('Channel Collective');
  await advance(6); await advance(7); await advance(8); await client.getByLabel('Engagement priorities').fill('Secure introductions in the Northeast.');
  await advance(9); await button(client,'Add team member').click();
  await client.getByLabel('First name').fill('Devon'); await client.getByLabel('Last name').fill('Ray');
  await client.getByLabel('Function').selectOption('Partnerships'); await client.getByLabel('Phone number').fill('212-555-0100');
  await client.getByLabel('Email',{exact:true}).fill('devon@example.test'); await client.getByLabel('Job title').fill('VP');
  await client.getByLabel('Contact notes').fill('Runs partner outreach.'); await client.getByLabel('Invoice recipient email').fill('billing@example.test');
  await button(client, 'Submit answers').click();
  await heading(client, 'Response submitted');
  activePage = page;
  await page.reload();
  await page.getByRole('link',{name:'Introduction map',exact:true}).click();
  const node=(name)=>page.locator('.map-node').filter({hasText:name});
  await node('Harbor Kitchens').waitFor();
  await page.locator('.map-branch').filter({hasText:'Strategic and channel partners'}).getByText('Channel Collective').waitFor();
  await page.getByRole('img',{name:'Browser Pilot logo'}).waitFor();
  await node('Harbor Kitchens').click(); await dialog.getByLabel('Relationship health').selectOption('green');
  await dialog.getByLabel('Next action').fill('Ask Morgan for an introduction.');
  await dialog.getByRole('link',{name:'Intake 1'}).waitFor(); await button(dialog,'Save connection').click(); await node('Harbor Kitchens').getByText(/Strong/).waitFor();
  await button(page,'Add note').click(); await dialog.getByLabel('Working note').fill('Harbor Kitchens wants an introduction to North Bay.');
  await dialog.locator('summary').click(); await dialog.getByLabel('Target company').fill('North Bay'); await button(dialog,'Save note').click(); await node('North Bay').waitFor();
  await node('Harbor Kitchens').click(); await dialog.getByText('Harbor Kitchens wants an introduction to North Bay.',{exact:true}).waitFor(); await page.keyboard.press('Escape');
await page.locator('.map-filter summary').click();
  await page.getByLabel('Relationship health').selectOption('green');
  await button(page,'Apply filters').click();
  await node('Harbor Kitchens').waitFor();
  assert.equal(await node('North Bay').count(),0);
  await page.locator('.map-filter summary').click(); await page.getByRole('link',{name:'Reset'}).click();
  await node('North Bay').waitFor();
  await capture(page,'client-map'); await page.getByRole('link',{name:'Client group',exact:true}).click();
  const person=page.locator('.person-row').filter({hasText:'Devon Ray'}); await person.getByText('212-555-0100').waitFor(); await button(person,'Edit').click();
  await dialog.getByLabel('Title',{exact:true}).fill('VP, Partnerships'); await button(dialog,'Save contact').click(); await person.getByText('VP, Partnerships').waitFor();
  await page.getByRole('link',{name:'Notes & activity',exact:true}).click(); await page.getByRole('link',{name:'View submission',exact:true}).click();
  await page.getByRole('link',{name:'Back to notes and activity'}).click(); await page.locator('.feed-entry').filter({hasText:'Harbor Kitchens wants an introduction'}).waitFor();
  await page.getByRole('link',{name:'Client intake',exact:true}).click(); await page.getByText('Multi-location restaurant operators.',{exact:true}).waitFor();
  await page.getByRole('link',{name:'existing-presentation.pptx'}).first().waitFor();
  await page.getByRole('link', { name: 'Notes & activity', exact: true }).click();
  await page.locator('summary').filter({hasText:'Record activity'}).click();
  const log = page.locator('form[data-form="ws-work"]');
  await log.getByLabel('Activity', { exact: true }).selectOption('newsletter');
  await log.getByLabel('Status', { exact: true }).selectOption('done');
  await log.getByLabel('Action, introduction or outcome').fill('Published the pilot newsletter');
  await button(log, 'Record activity').click();
  await page.getByRole('heading', { name: 'Published the pilot newsletter' }).waitFor();
  await page.getByRole('link', { name: 'Weekly updates' }).click();
  await button(page, 'Generate draft').click();
  const report = page.getByLabel('Client update');
  await report.waitFor();
  assert.match(await report.inputValue(), /Published the pilot newsletter/);
  for (const [label, extension] of [['Download saved PDF', '.pdf'], ['Download saved workbook', '.xlsx']]) {
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('link', {name:label}).click(),
    ]);
    assert(download.suggestedFilename().endsWith('-v1'+extension));
    assert.equal(await download.failure(), null);
  }
  await page.getByRole('link',{name:'Introduction map',exact:true}).click();
await button(page,'Add connection').click(); await dialog.getByLabel('Company',{exact:true}).fill('Pilot Prospect');
  await button(dialog,'Save connection').click(); await node('Pilot Prospect').waitFor();
  await page.getByRole('link',{name:'Project management',exact:true}).click(); await heading(page,'Project management');
  await capture(page,'project-library');
  await page.locator('.project-tile').filter({hasText:'Onboarding'}).click(); await heading(page,'Onboarding');
  await page.locator('.project-grid').getByRole('link',{name:'Browser Pilot'}).click();
  const grid=page.locator('.project-grid');
  await button(grid,'Browser Pilot, Intake received, Done').waitFor();
  await page.locator('.project-sheet').getByText('Secure introductions in the Northeast.').waitFor();
  await button(grid,'Browser Pilot, Kickoff email sent, Not started').click();
  await dialog.getByLabel('Status',{exact:true}).selectOption('done'); await dialog.getByLabel('Milestone notes').fill('Welcome email recorded.');
  await button(dialog,'Save milestone').click(); await grid.getByText('Welcome email recorded.',{exact:true}).waitFor();
  assert.equal(await grid.getByRole('row').filter({hasText:'Browser Pilot'}).locator('.progress-value b').textContent(),'29%');
  await capture(page,'project-management'); await checkWidth(page);
  await button(page,'Edit project brief').click(); await dialog.getByLabel('Agreed deliverables').fill('Three introductions.');
  await button(dialog,'Save project brief').click(); await page.getByText('Three introductions.',{exact:true}).waitFor();
const [exported]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Export CSV'}).click()]);
  assert.match(exported.suggestedFilename(),/Onboarding.*\.csv$/); assert.equal(await exported.failure(),null);
  await page.locator('main').getByRole('link',{name:'Project management',exact:true}).click();
  await button(page,'New project').click(); await dialog.getByLabel('Project name').fill('Partner launch'); await dialog.getByLabel('Stages, one per line').fill('Brief\nReview');
  await dialog.getByLabel('Browser Pilot',{exact:true}).check(); await button(dialog,'Create project').click(); await heading(page,'Partner launch');
  await button(page,'Add stage').click(); await dialog.getByLabel('Stage name').fill('Handoff'); await button(dialog,'Add stage').click();
  await page.locator('.project-grid').getByRole('columnheader',{name:/Handoff/}).waitFor();
  const switchTo=async(label)=>{
    const sw=page.locator('.workspace-switch:visible'); await sw.locator('summary').click();
    await sw.getByRole('link',{name:label,exact:true}).click();
  };
  for(const label of ['Media','Capital']){
    await switchTo(label); await heading(page,label); await page.getByText('Under construction',{exact:true}).waitFor();
    assert.equal(await page.locator('.deal-column').count(),0);
  }
  await switchTo('Solutions'); await heading(page,'Pipelines');
  await page.getByRole('link',{name:'Settings',exact:true}).click(); await heading(page,'Settings');
  await page.getByRole('link',{name:'Workspace settings',exact:true}).click(); await page.getByRole('heading',{name:'Team access'}).waitFor();
  await page.getByRole('link',{name:'Team',exact:true}).click(); await button(page,'Invite people').click();
  await dialog.getByLabel('Name',{exact:true}).fill('Invited staff'); await dialog.getByLabel('Email',{exact:true}).fill('invited@example.test');
  const [invite]=await Promise.all([page.waitForResponse((r)=>r.url().endsWith('/admin/accounts') && r.request().method()==='POST'),button(dialog,'Invite person').click()]);
  const memberView=await browser.newContext(), member=await memberView.newPage(); watch(member); activePage=member;
  await member.goto(new URL((await invite.json()).setup.path,config.origin).href); await heading(member,'Set your password');
  await member.getByLabel('Password',{exact:true}).fill('Private-Demo-Password-24'); await member.getByLabel('Confirm password').fill('Private-Demo-Password-24');
  await button(member,'Activate account').click(); await heading(member,'Pipelines');
  await member.getByRole('button',{name:/Account menu/}).click(); await member.getByRole('link',{name:'My profile',exact:true}).click();
  await member.getByLabel('Job title').fill('Account director'); await button(member,'Save profile').click(); await member.getByText('Profile saved.').waitFor();
  await member.reload(); assert.equal(await member.getByLabel('Job title').inputValue(),'Account director');
  assert.equal((await memberView.request.get(new URL('/api/clients/'+clientId+'/workspace',config.origin).href)).status(),404);
  activePage=page; await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844}); await page.goto(new URL('/today',config.origin).href); await heading(page,'Pipelines'); await checkWidth(page);
assert.equal(await page.locator('.deal-column:visible').count(),6);
  await page.locator('[data-ws-stage=signed]').getByRole('link').filter({hasText:'Browser Pilot'}).click();
  await page.getByRole('heading',{name:'Client intake',exact:true}).waitFor(); await checkWidth(page);
  await page.getByRole('link',{name:'Introduction map',exact:true}).click();
  await node('Harbor Kitchens').waitFor(); await checkWidth(page); await capture(page,'client-map-mobile');
  await page.getByRole('link',{name:'Project management',exact:true}).click(); await heading(page,'Project management'); await checkWidth(page);
  await page.locator('.project-tile').filter({hasText:'Weekly report'}).click(); await heading(page,'Weekly report'); await checkWidth(page);
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:await staff.storageState()});
  const touchPage=await phone.newPage();watch(touchPage);activePage=touchPage;
  await touchPage.goto(new URL('/work/solutions',config.origin).href);await heading(touchPage,'Pipelines');
  const source=touchPage.locator('[data-ws-stage="outreach"] .deal-card').first(), target=touchPage.locator('[data-ws-stage="discovery"]');
  await source.scrollIntoViewIfNeeded();
  const cardBox=await source.boundingBox(),stageBox=await target.boundingBox(),touchName=await source.locator('strong').textContent();
  const touchSession=await phone.newCDPSession(touchPage);
  const x=Math.floor(cardBox.x+cardBox.width/2),y=Math.floor(cardBox.y+cardBox.height/2);
  await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await touchPage.locator('.deal-card.is-lifted').waitFor();
  assert.equal(await source.evaluate(el=>getComputedStyle(el).animationName),'stage-flow');
  await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.floor(Math.min(374,stageBox.x+20)),y}]});
  await target.locator('xpath=self::*[contains(@class,"drop-ready")]').waitFor();
  await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await target.getByText(touchName,{exact:true}).waitFor();
  await touchPage.setViewportSize({width:320,height:720});await checkWidth(touchPage);
  await touchPage.emulateMedia({reducedMotion:'reduce'});
  await target.locator('.deal-card').first().evaluate(el=>el.classList.add('is-lifted'));
  assert.equal(await target.locator('.is-lifted').evaluate(el=>getComputedStyle(el).animationName),'none');
  await phone.close();activePage=page;
  const pilot=await staff.request.get(new URL('/api/engagements/'+path.split('/').at(-1),config.origin).href);
  assert.equal((await pilot.json()).deal.stage,'signed'); assert.deepEqual(failures,[]);
  console.log('Desktop and mobile workflows passed, including mouse and touch stage moves, custom projects, CSV export, intake, notes, file and report downloads, invitations and reduced motion.');
} catch (error) {
  if (activePage) console.error((await activePage.locator('body').innerText()).slice(-2700), failures);
  throw error;
} finally {
  await browser?.close();
  const stopped = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await stopped;
  store.db.close();
}
