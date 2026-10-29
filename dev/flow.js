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
  await page.waitForSelector('.kpi');
  const count = async () => Number((await page.textContent('.kpi .value')).replace(/,/g, ''));
  const all = await count();

  // Program chip narrows, the stage bar opens Projects on that stage.
  await page.click('.chip-toggle:has-text("BA80")');
  await page.click('.chip-toggle:has-text("BA54")');
  await page.click('.chip-toggle:has-text("Other")');
  const ba61 = await count();
  assert.ok(ba61 > 0 && ba61 < all, 'BA61 only: ' + ba61 + ' of ' + all);
  await page.click('.hbar:has-text("With contracting")');
  await page.waitForSelector('table');
  assert.ok((await page.textContent('.active-filters')).includes('With contracting'));
  const rows = await page.$$eval('tbody tr.clickable', (r) => r.length);
  assert.ok(rows > 0, 'contracting rows');

  // Sorting by committed, descending then ascending.
  await page.click('th:has-text("Committed")');
  const money = async () => page.$$eval('tbody tr.clickable', (trs) => trs.map((tr) => Number(tr.children[8].textContent.replace(/[$,]/g, ''))));
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

  // Workload: click the top person, land on their projects.
  await page.click('.link-btn:has-text("Reset filters")');
  await page.click('.tab:has-text("Workload")');
  await page.waitForSelector('tbody tr.clickable');
  const top = await page.textContent('tbody tr.clickable >> nth=0 >> td >> nth=3');
  await page.click('tbody tr.clickable >> nth=0');
  await page.waitForSelector('.pill');
  const listed = await page.$$eval('tbody tr.clickable', (r) => r.length);
  assert.strictEqual(listed, Number(top), 'person has ' + top + ' projects');

  // CSV export.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export CSV")')]);
  assert.ok(/\.csv$/.test(download.suggestedFilename()));

  // Field office filter via URL, and the manager banner.
  await page.goto(base + '/?as=' + encodeURIComponent(process.argv[3] || 'sam.foothills@gsa.gov'));
  await page.waitForSelector('.kpi');
  const banner = await page.$('.banner');
  if (banner) console.log('  banner: ' + (await banner.textContent()).trim());

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('Flow OK: ' + all + ' open PRs, ' + ba61 + ' BA61, top person ' + top + ' projects.');
})().catch((e) => { console.error(e); process.exit(1); });
