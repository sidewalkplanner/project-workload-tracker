/**
 * Screenshots of each view, light and dark, desktop and phone, with the preview running:
 *   node dev/screenshots.js out/ [http://localhost:8080] [as-email]
 * Fails if the page logs an error.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const out = process.argv[2] || 'out';
  const base = process.argv[3] || 'http://localhost:8080';
  const as = process.argv[4] || '';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const shots = [
    ['overview', '', 1440, 'light'], ['projects', 'view=projects', 1440, 'light'], ['workload', 'view=workload', 1440, 'light'],
    ['overview-dark', '', 1440, 'dark'], ['workload-phone', 'view=workload', 390, 'light'], ['overview-phone', '', 390, 'dark']
  ];
  for (const [name, query, width, scheme] of shots) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: scheme });
    page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    const q = [query, as ? 'as=' + encodeURIComponent(as) : ''].filter(Boolean).join('&');
    await page.goto(base + '/' + (q ? '?' + q : ''));
    await page.waitForSelector('.topbar', { timeout: 30000 });
    await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errors.push(name + ': page scrolls sideways by ' + overflow + 'px');
    await page.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('Saved ' + shots.length + ' screenshots to ' + out);
})();
