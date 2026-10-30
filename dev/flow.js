/**
 * Clicks through the main flows with the preview running:
 *   node dev/flow.js [http://localhost:8080]
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
  const base = process.argv[2] || 'http://localhost:8080';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.waitForSelector('.stat');
  const count = async () => Number((await page.textContent('.stat .value')).replace(/,/g, ''));
  const all = await count();

  // Service contracts are hidden by default; More filters › Include service contracts brings them back.
  await page.click('button:has-text("More filters")');
  await page.check('label:has-text("Include service contracts") input');
  const withService = await count();
  assert.ok(withService >= all, 'including service contracts: ' + withService + ' >= ' + all);
  await page.uncheck('label:has-text("Include service contracts") input');
  assert.strictEqual(await count(), all);

  // Program chip narrows, the stage bar opens Projects on that stage.
  await page.click('.seg[aria-label="Program"] button:has-text("BA61")');
  const ba61 = await count();
  assert.ok(ba61 > 0 && ba61 < all, 'BA61 only: ' + ba61 + ' of ' + all);
  await page.click('.hbar:has-text("With contracting")');
  await page.waitForSelector('table');
  assert.ok((await page.textContent('.active-filters')).includes('With a contract specialist'));
  const rows = await page.$$eval('tbody tr.clickable', (r) => r.length);
  assert.ok(rows > 0, 'contracting rows');

  // Sorting by committed, descending then ascending.
  await page.click('th:has-text("Committed")');
  const money = async () => page.$$eval('table', ([table]) => {
    const at = [...table.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim().startsWith('Committed'));
    return [...table.querySelectorAll('tbody tr.clickable')].map((tr) => Number((tr.children[at].getAttribute('title') || tr.children[at].textContent).replace(/[$,]/g, '')));
  });
  let m = await money();
  assert.deepStrictEqual(m, m.slice().sort((a, b) => b - a), 'descending');
  await page.click('th:has-text("Committed")');
  m = await money();
  assert.deepStrictEqual(m, m.slice().sort((a, b) => a - b), 'ascending');

  // Group by field office, collapse a group.
  await page.selectOption('.toolbar select', 'office');
  const groups = await page.$$eval('tr.group-row', (g) => g.length);
  assert.ok(groups > 1, 'groups');
  await page.click('tr.group-row >> nth=0');
  assert.ok(await page.$('tr.group-row.collapsed'));

  // Detail drawer.
  await page.click('tbody tr.clickable >> nth=0');
  await page.waitForSelector('.drawer');
  assert.ok((await page.textContent('.drawer')).includes('Acquisition status'));
  await page.keyboard.press('Escape');
  assert.ok(!(await page.$('.drawer')));

  // People: click the top person, land on their projects.
  await page.click('.link-btn:has-text("Reset filters")');
  await page.click('.tab:has-text("People")');
  await page.waitForSelector('tbody tr.clickable');
  const top = await page.$eval('table', (table) => {
    const at = [...table.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim().startsWith('Projects'));
    return table.querySelector('tbody tr.clickable').children[at].textContent.trim();
  });
  await page.click('tbody tr.clickable >> nth=0');
  await page.waitForSelector('.pill');
  const heading = Number((await page.textContent('.card-head h2')).replace(/,/g, '').match(/^\d+/)[0]);
  assert.strictEqual(heading, Number(top), 'person has ' + top + ' projects');

  // CSV export.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download for Excel")')]);
  assert.ok(/\.csv$/.test(download.suggestedFilename()));

  // Needs attention: the tab lists checks; opening one filters Projects to it, and the count matches.
  await page.goto(base + '/?view=attention');
  await page.waitForSelector('.card-head h2');
  const checks = await page.$$('.attention-check');
  if (checks.length) {
    const want = Number((await checks[0].$eval('.count-pill', (e) => e.textContent)).replace(/,/g, ''));
    await (await checks[0].$('button.btn')).click();
    await page.waitForSelector('.pill');
    const got = Number((await page.textContent('.card-head h2')).replace(/,/g, '').match(/^\d+/)[0]);
    assert.strictEqual(got, want, 'the check opens its ' + want + ' projects');
    // Keyboard: a focused row opens its panel with Enter, and Escape closes it.
    await page.focus('tbody tr.clickable');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.drawer');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$('.drawer'), null);
  }

  // Field office filter via URL, and the manager banner.
  await page.goto(base + '/?as=' + encodeURIComponent(process.argv[3] || 'sam.foothills@gsa.gov'));
  await page.waitForSelector('.stat');
  const banner = await page.$('.banner');
  if (banner) console.log('  banner: ' + (await banner.textContent()).trim());

  // Someone whose GSA profile says PMCFB opens on Iowa (demo directory in dev/server.js).
  await page.goto(base + '/?as=pat.viewer%40gsa.gov');
  await page.waitForSelector('.stat');
  const orgBanner = await page.$('.banner');
  if (orgBanner) console.log('  org banner: ' + (await orgBanner.textContent()).trim());
  assert.strictEqual(await page.$eval('select[aria-label="Field office"]', (s) => s.value), 'Iowa Field Office');

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('Flow OK: ' + all + ' open PRs, ' + ba61 + ' BA61, top person ' + top + ' projects.');
})().catch((e) => { console.error(e); process.exit(1); });
