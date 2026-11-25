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
  await heading(page, 'Solutions');
  await page.getByText('Cinder Hospitality', { exact: true }).first().waitFor();
  await capture(page, 'solutions-desktop');
  await checkWidth(page);
  await page.getByLabel('Jump to stage').selectOption('agreement_sent');
  await page.reload();
  await page.getByLabel('Jump to stage').waitFor();
  assert.equal(await page.getByLabel('Jump to stage').inputValue(), 'agreement_sent');
  assert(await page.locator('[data-ws-stage="agreement_sent"]').evaluate((column) => {
    const rect = column.getBoundingClientRect(), board = column.parentElement.getBoundingClientRect();
    return rect.left >= board.left - 1 && rect.right <= board.right + 1;
  }));
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
    ['first_meeting_scheduled', 'First meeting scheduled'],
  ]) {
    await button(page, 'Move stage').click();
    await dialog.getByLabel('Stage', {exact:true}).selectOption(stage);
    if (stage === 'first_meeting_scheduled') await dialog.getByLabel('First meeting date').fill('2027-01-12');
    await button(dialog, 'Save stage').click();
    await page.getByText('Advisory engagements · '+label, {exact:true}).waitFor();
  }
  await page.getByText('2027-01-12', {exact:true}).waitFor();
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
  await page.getByText('Advisory engagements · Signed', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Advisory intake', exact: true }).click();
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
  await heading(client, 'Solutions Partner Onboarding');
  await checkWidth(client);
  await client.getByLabel('Primary contact name').fill('Alex Person');
  await client.getByLabel('Primary contact email').fill('alex@example.test');
  const intakeUpload = client.locator('form[data-form="ws-intake-file"]');
  await intakeUpload
    .locator('input[type=file]')
    .setInputFiles({
      name: 'operators.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('company,segment\nBlue House,QSR'),
    });
  await button(intakeUpload, 'Upload file').click();
  await client
    .locator('#intake-files')
    .getByText(/operators.csv/)
    .waitFor();
  await button(client, 'Save and continue').click();
  await client.getByLabel('Who is your ideal customer?').fill('Multi-location restaurant operators.');
  for (let step = 0; step < 4; step++) {
    const label = await client.locator('.step-label').innerText();
    await button(client, 'Save and continue').click();
    await client.waitForFunction((old) => document.querySelector('.step-label')?.textContent !== old, label);
  }
  await client.getByLabel('Engagement priorities').fill('Book operator introductions.');
  await client.getByLabel('Invoice recipient email').fill('billing@example.test');
  await button(client, 'Submit answers').click();
  await heading(client, 'Response submitted');
  activePage = page;
  await page.reload();
  await page.getByText('Multi-location restaurant operators.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'operators.csv' }).waitFor();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
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
  await page
    .getByRole('link', { name: 'Introductions', exact: true })
    .filter({ hasNot: page.locator('svg') })
    .first()
    .click();
  await button(page, 'Add research').click();
  const inputs = {
    Company: 'Pilot Prospect',
    Person: 'Casey',
    Source: 'CRM',
    'Relationship with Branded': 'Known to the team',
    'Why this contact fits': 'Operator footprint',
    Evidence: 'Relationship owner verified a prior meeting',
    'Suggested next action': 'Request introduction',
  };
  for (const [name, value] of Object.entries(inputs))
    await dialog.getByLabel(name, { exact: true }).fill(value);
  await button(dialog, 'Save finding').click();
  await page.getByRole('link', { name: 'Review finding', exact: true }).click();
  await page.getByRole('heading', { name: 'Casey', exact: true }).waitFor();
  await page.goto(new URL('/work/media?view=conversations', config.origin).href);
  await page.getByRole('link', { name: 'Meridian Creative', exact: true }).waitFor();
  await page.getByText('Sponsor requested the deck', { exact: true }).waitFor();
  await page.getByRole('link', {name:'Marrow Market', exact:true}).click();
  await page.getByRole('link', {name:'Activity', exact:true}).click();
  await log.getByLabel('Activity', {exact:true}).selectOption('sent');
  await log.getByLabel('Status', {exact:true}).selectOption('done');
  await log.getByLabel('Action, introduction or outcome').fill('Sent event sponsorship details');
  await log.getByLabel('Activity date').fill('2024-03-08');
  await button(log, 'Record activity').click();
  await page.getByRole('heading', {name:'Sent event sponsorship details'}).waitFor();
  await page.goto(new URL('/today', config.origin).href);
  await page.getByRole('link').filter({hasText:'Follow up on unanswered outreach'}).filter({hasText:'Marrow Market'}).waitFor();
  await page.goto(new URL('/work/media?view=conversations', config.origin).href);
  await page.getByRole('row').filter({hasText:'Marrow Market'}).getByText('Follow up on unanswered outreach · 2024-03-11').waitFor();
  await capture(page, 'media-desktop');
  await page.getByRole('link', {name:'Delivery',exact:true}).click();
  await page.getByRole('heading', {name:'Project billing'}).waitFor();
  const billing = page.getByRole('row').filter({hasText:'Four-episode sponsorship'});
  await billing.getByRole('cell', {name:'Pending',exact:true}).waitFor();
  await billing.getByRole('cell', {name:'Four podcast episodes and two newsletter placements'}).waitFor();
  await page.getByRole('link', { name: 'Guest pitches' }).click();
  await page.getByText('Guest idea for Hospitality Hangout', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Capital', exact: true }).click();
  await heading(page, 'Capital');
  await page.getByText('Capital raised', { exact: true }).waitFor();
  await page.goto(new URL('/operations', config.origin).href);
  await heading(page, 'Workspace operations');
  const copyLink = page.getByRole('button', { name: 'Copy inquiry link' }).first();
  const sourceKey = await copyLink.getAttribute('data-id');
  await copyLink.click();
  await client.goto(new URL('/inquire/' + sourceKey, config.origin).href);
  await client.locator('input[name=company]').fill('Inbound sponsor');
  await client.getByLabel('Your name').fill('Morgan');
  await client.locator('input[name=email]').fill('morgan@example.test');
  await client.getByLabel('What would you like to discuss?').fill('Sponsorship opportunities.');
  await button(client, 'Send inquiry').click();
  await client.getByRole('heading', { name: 'Inquiry received' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('/work/media', config.origin).href);
  await heading(page, 'Media');
  await checkWidth(page);
  await page.getByText('Inbound sponsor', { exact: true }).waitFor();
  await capture(page, 'media-mobile');
  const visible = page.locator('.deal-column:visible');
  assert.equal(await visible.count(), 1);
  await page.getByLabel('Jump to stage').selectOption('first_meeting_scheduled');
  await visible.getByRole('heading', {name:'First meeting scheduled'}).waitFor();
  await page.getByLabel('Jump to stage').selectOption('pitch');
  await visible.getByRole('link').filter({ hasText: 'Meridian Creative' }).click();
  await heading(page, 'Meridian Creative');
  await checkWidth(page);
  const pilot = await staff.request.get(
    new URL('/api/engagements/' + path.split('/').at(-1), config.origin).href
  );
  assert.equal(pilot.status(), 200);
  assert.equal((await pilot.json()).deal.stage, 'signed');
  assert.deepEqual(failures, []);
  console.log(
    'Desktop and mobile workflows passed, including sales stages, signing, intake and uploads, weekly PDF and workbook downloads, introductions, project billing and inbound routing.'
  );
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
