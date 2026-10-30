/**
 * Backend tests: node dev/test.js
 * With real data: SOURCES_JSON=/tmp/sources.json node dev/test.js  (from tools/export_sheets.py)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { createRuntime, sheetsFrom } = require('./gas-mock');
const { demoSources, demoDirectory } = require('./demo-data');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function runtimeWith(sources, user) {
  return createRuntime({ quiet: true, user: user || 'someone@gsa.gov', owner: 'owner@gsa.gov', sheets: sheetsFrom(sources) });
}
function load(rt) { return JSON.parse(rt.ctx.apiLoad()); }

test('demo: only PRs on NEH buildings are kept, across its zones', () => {
  const res = load(runtimeWith(demoSources()));
  const d = res.data;
  assert.strictEqual(d.scopeLabel, 'NEH');
  assert.deepStrictEqual(d.zones.slice(), ['2', '4', '5']);
  assert.strictEqual(d.offices.length, 14);
  assert.strictEqual(d.serviceCenters.length, 4);
  assert.ok(d.offices.every((o) => ['2', '4', '5'].indexOf(o.zone) !== -1));
  assert.ok(d.prs.every((p) => p.zones.length === 1));
  assert.strictEqual(d.counts.pipelineRows, 422);
  assert.strictEqual(d.prs.filter((p) => !p.source).length, 420);
  assert.strictEqual(d.counts.zonePrs, 420);
  assert.strictEqual(d.counts.otherZones, 1);
  assert.strictEqual(d.counts.noBuilding, 1);
  assert.ok(d.prs.every((p) => p.offices.length === 1 && p.serviceCenters.length === 1));
});

test('the ZONE setting narrows the tracker to one zone', () => {
  const rt = createRuntime({ quiet: true, sheets: sheetsFrom(demoSources()), properties: { ZONE: '5' } });
  const d = JSON.parse(rt.ctx.apiLoad()).data;
  assert.strictEqual(d.scopeLabel, 'Zone 5');
  assert.strictEqual(d.offices.length, 12);
  assert.ok(d.prs.every((p) => p.zones[0] === '5'));
});

test('demo: stages, programs and amounts', () => {
  const d = load(runtimeWith(demoSources())).data;
  const stages = new Set(d.prs.map((p) => p.stage));
  ['awarded', 'expended', 'assigned', 'solicitation', 'approved', 'review', 'draft', 'drafting'].forEach((s) => assert.ok(stages.has(s), 'has stage ' + s));
  d.prs.forEach((p) => {
    if (p.stage === 'expended') assert.ok(p.expended >= p.obligated, p.pr);
    if (p.stage === 'awarded') assert.ok(p.remaining > 0, p.pr);
    assert.ok(p.remaining >= 0);
  });
  assert.ok(d.prs.some((p) => p.programs.indexOf('PG80') !== -1 && p.rwas.length));
});

test('the signed-in Field Office Manager and Service Center Director are recognised', () => {
  const src = demoSources();
  let u = load(runtimeWith(src, 'sam.foothills@gsa.gov')).user;
  assert.deepStrictEqual(u.manages, ['Denver Federal Center Field Office']);
  assert.strictEqual(u.isAdmin, false);
  u = load(runtimeWith(src, 'lee.rockies@gsa.gov')).user;
  assert.deepStrictEqual(u.directs, ['Rocky Mountain Service Center']);
  u = load(runtimeWith(src, 'owner@gsa.gov')).user;
  assert.strictEqual(u.isAdmin, true);
});

test('the org code in the GSA display name picks the starting office', () => {
  const src = demoSources();
  const names = { 'pat.viewer@gsa.gov': 'Pat Viewer - PMCFB', 'robin.center@gsa.gov': 'Robin Center (PMCG)', 'jo.budget@gsa.gov': 'Jo Budget - BCB', 'al.out@gsa.gov': 'Al Out - PMBEA' };
  const as = (email) => JSON.parse(createRuntime({ quiet: true, user: email, sheets: sheetsFrom(src), directoryNames: names }).ctx.apiLoad()).user;
  let u = as('pat.viewer@gsa.gov');
  assert.strictEqual(u.orgCode, 'PMCFB');
  assert.strictEqual(u.orgOffice, 'Iowa Field Office');
  assert.strictEqual(u.orgSc, 'Heartland Service Center');
  assert.strictEqual(u.name, 'Pat Viewer');
  u = as('robin.center@gsa.gov');
  assert.strictEqual(u.orgOffice, '');
  assert.strictEqual(u.orgSc, 'Rocky Mountain Service Center');
  u = as('jo.budget@gsa.gov');
  assert.strictEqual(u.orgCode, 'BCB');
  assert.strictEqual(u.orgOffice + u.orgSc, '');
  u = as('al.out@gsa.gov');
  assert.strictEqual(u.orgOffice + u.orgSc, '', 'an office outside the zone opens on the whole zone');
  u = as('nobody@gsa.gov');
  assert.strictEqual(u.orgCode, '');
  const c = createRuntime({ quiet: true, sheets: sheetsFrom(src) }).ctx;
  assert.strictEqual(c.parseOrgCode_('Robert Sells - PMCGC'), 'PMCGC');
  assert.strictEqual(c.parseOrgCode_('Mary Smith'), '');
  assert.strictEqual(c.parseOrgCode_('Mary SMITH'), '');
  assert.strictEqual(c.cleanDisplayName_('Robert Sells - PMCGC'), 'Robert Sells');
});

test('the snapshot is cached in chunks and reused', () => {
  const rt = runtimeWith(demoSources(2500));
  load(rt);
  const reads = rt.state.reads;
  assert.ok(Number(rt.cache[rt.ctx.CACHE_PREFIX + 'n']) > 1, 'more than one chunk');
  load(rt);
  assert.strictEqual(rt.state.reads, reads, 'second load reads no sheets');
  rt.ctx.apiRefresh();
  assert.strictEqual(rt.state.reads, reads, 'a refresh within 10 minutes by a non-admin reuses the cache');
  rt.setUser('owner@gsa.gov');
  rt.ctx.apiRefresh();
  assert.ok(rt.state.reads > reads, 'an admin refresh reads again');
});

test('a snapshot saved by older code is not reused', () => {
  const rt = runtimeWith(demoSources(5));
  rt.cache['zone5ds:v1:n'] = '1';
  rt.cache['zone5ds:v1:0'] = JSON.stringify({ prs: [], people: {} });
  const d = load(rt).data;
  assert.ok(d.prs.length > 0 && d.teams, 'rebuilt with the current shape');
});

test('an emptied cache is refilled from the saved copy, not rebuilt; the page carries its data', () => {
  const rt = runtimeWith(demoSources(30));
  load(rt);
  assert.strictEqual(rt.state.created, 1, 'the saved-copy sheet was created');
  const reads = rt.state.reads;
  Object.keys(rt.cache).forEach((k) => delete rt.cache[k]);
  const d = load(rt).data;
  assert.strictEqual(d.prs.filter((p) => !p.source).length, 30);
  assert.strictEqual(rt.state.reads, reads, 'no source sheet was read again');
  assert.ok(Number(rt.cache[rt.ctx.CACHE_PREFIX + 'n']) >= 1, 'the cache was refilled');
  const page = rt.ctx.doGet({ parameter: {} }).content;
  assert.ok(/"preload":\{"user":/.test(page), 'the page carries the data');
  // A saved copy from older code is ignored.
  Object.keys(rt.cache).forEach((k) => delete rt.cache[k]);
  const sheetId = rt.props.SNAPSHOT_SHEET_ID;
  rt.spreadsheets[sheetId].Sheet1[0] = [JSON.stringify({ version: -1 })];
  assert.ok(/"preload":null/.test(rt.ctx.doGet({ parameter: {} }).content));
});

test('placement: building in the title, OFM org code, several offices', () => {
  const src = demoSources(5);
  const row = (over) => {
    const r = src.pipeline[1].slice();
    Object.keys(over).forEach((k) => { r[src.pipeline[0].indexOf(k)] = over[k]; });
    return r;
  };
  const b = (i) => src.buildings[2 + i][0];
  src.pipeline.push(row({ PR_Number: 'EQT-1', PR_Title: 'Fix roof ' + b(0) + ' RM0199-100726', FE_Building_Code_List: 'n/a' }));
  src.pipeline.push(row({ PR_Number: 'EQT-2', PR_Title: 'Zone wide', FE_Building_Code_List: 'n/a', FE_Org_Code_List: 'P00MCG00' }));
  src.pipeline.push(row({ PR_Number: 'EQT-3', PR_Title: 'Two offices', FE_Building_Code_List: b(0) + ', ' + b(40) + ', WA0001ZZ' }));
  const d = load(runtimeWith(src)).data;
  const get = (n) => d.prs.find((p) => p.pr === n);
  assert.strictEqual(get('EQT-1').placeNote, 'title');
  assert.deepStrictEqual(get('EQT-1').portalNumbers, ['RM0199-100726']);
  assert.deepStrictEqual(get('EQT-2').offices, []);
  assert.deepStrictEqual(get('EQT-2').serviceCenters, ['Rocky Mountain Service Center']);
  assert.strictEqual(get('EQT-3').offices.length, 2);
  assert.ok(get('EQT-3').buildingManager.length >= 1);
});

test('program codes come from the title when EASi has none yet', () => {
  const src = demoSources(3);
  const H = src.pipeline[0];
  const row = (title) => { const r = src.pipeline[1].slice(); r[H.indexOf('PR_Number')] = 'EQD-' + title.length; r[H.indexOf('PR_Title')] = title; r[H.indexOf('FE_Program_Code_List')] = 'n/a'; return r; };
  src.pipeline.push(row('MN0092ZZ - BA54 - Arc flash study'), row('RM0028-092426 Toilet flange repair'), row('Loading dock repair'));
  const d = load(runtimeWith(src)).data;
  const get = (t) => d.prs.find((p) => p.title === t);
  assert.strictEqual(get('MN0092ZZ - BA54 - Arc flash study').programs.join(), 'PG54');
  assert.strictEqual(get('RM0028-092426 Toilet flange repair').programs.join(), 'PG61');
  assert.strictEqual(get('Loading dock repair').programs.join(), '');
  assert.ok(get('MN0092ZZ - BA54 - Arc flash study').programFromTitle);
  assert.ok(d.prs.every((p) => JSON.stringify(p.lead) === JSON.stringify(p.cor.length ? p.cor : p.requestor)));
});

test('service contracts are flagged; repairs and multi-project R&A stay projects', () => {
  const src = demoSources(3);
  const H = src.pipeline[0];
  const row = (n, title, category, proc) => {
    const r = src.pipeline[1].slice();
    r[H.indexOf('PR_Number')] = n; r[H.indexOf('PR_Title')] = title;
    r[H.indexOf('Category_Code')] = category; r[H.indexOf('Procurement_Category')] = proc;
    return r;
  };
  const bpa = 'Services,Task Order.BPA Call (Single Award IDV) ,$0 to $ SAT';
  src.pipeline.push(
    row('S1', 'Building-56 Custodial Services', 'Services', 'IDV or BPA for 5yr Service Contracts'),
    row('S2', 'MN0087ZZ Snow Removal St Paul', 'Services', bpa),
    row('S3', 'MO0050ZZ_Custodial & Related Services Follow On Contract_Kansas City, MO', 'n/a', 'Other'),
    row('S4', 'Option 6 Full Facilities Aspinall', 'Services', bpa),
    row('S5', 'Chilled Water Service- Burger Federal Building', 'Services', 'Utilities-Stand Alone Contract'),
    row('P1', 'Building 56 - CO0533AA, Building 67 - CO627AA Multi-Project O&M R&A', 'Services', bpa),
    row('P2', 'Hatch court house Janitor closet Galvanize Nipples Leaking and corrosion replacement', 'Services', bpa),
    row('P3', 'MO0039ZZ For Bid PR, Bannister FB ATS replacement project After hours O&M services', 'Construction', 'Construction or DB, Task Order, >$ SAT to <$ Prospectus'),
    row('P4', 'PG55, Oklahoma City POB RA, CMa-CxA Services Option 3&4', 'Services', 'Services, Task Order/BPA Call, >$ SAT'),
    row('P5', 'UT0032ZZ Landscape Pipe Leak', 'Services', bpa));
  const d = load(runtimeWith(src)).data;
  const get = (n) => d.prs.find((p) => p.pr === n);
  ['S1', 'S2', 'S3', 'S4', 'S5'].forEach((n) => assert.ok(get(n).service, n + ' is a service contract'));
  ['P1', 'P2', 'P3', 'P4', 'P5'].forEach((n) => assert.strictEqual(get(n).service, '', n + ' is a project: ' + get(n).service));
  assert.ok(/5yr Service Contracts/.test(get('S1').service));
  assert.ok(/Snow Removal/.test(get('S2').service));
});

test('a multi-project PR carries its sub-projects', () => {
  const src = demoSources(3);
  const H = src.pipeline[0];
  const r = src.pipeline[1].slice();
  r[H.indexOf('PR_Number')] = 'EQPMBA-26-0272';
  r[H.indexOf('PR_Title')] = 'Building 56 - CO0533AA, Building 67 - CO627AA Multi-Project O&M R&A';
  r[H.indexOf('Category_Code')] = 'Services';
  src.pipeline.push(r);
  const d = load(runtimeWith(src)).data;
  const p = d.prs.find((x) => x.pr === 'EQPMBA-26-0272');
  assert.strictEqual(p.units, 8);
  assert.strictEqual(p.subprojects[0].id, 'DWP26104');
  assert.strictEqual(p.subprojects[7].id, 'DWP26104-7');
  assert.strictEqual(p.service, '');
  assert.ok(d.prs.filter((x) => x.pr !== 'EQPMBA-26-0272').every((x) => x.units === 1));
});

test('roles: building contacts are building managers; org codes are only shown', () => {
  const src = demoSources();
  // No directory: building contacts are building managers, everyone else project managers.
  let d = load(runtimeWith(src)).data;
  const contacts = new Set(src.buildings.slice(2).map((r) => r[src.buildings[1].indexOf('ServiceNow Primary POC(s)')]));
  Object.keys(d.people).forEach((e) => assert.strictEqual(d.teams[e], contacts.has(e) ? 'bm' : 'pm', e));
  assert.ok(Object.values(d.teams).includes('bm') && Object.values(d.teams).includes('pm'));
  assert.strictEqual(Object.keys(d.orgs).length, 0);

  // With the directory: one sweep fills in org codes, which don't change anyone's role.
  const names = demoDirectory(src);
  const someone = Object.keys(d.people).find((e) => contacts.has(e));
  names[someone] = 'Some One - PMCGP';
  const rt = createRuntime({ quiet: true, sheets: sheetsFrom(src), directoryNames: names, directoryPageSize: 50 });
  d = JSON.parse(rt.ctx.apiLoad()).data;
  assert.ok(rt.state.directoryCalls > 1, 'paged through the directory');
  assert.strictEqual(d.orgs[someone], 'PMCGP');
  assert.strictEqual(d.teams[someone], 'bm', 'a building contact stays a building manager');
  const pmWithPmCode = Object.keys(d.people).find((e) => !contacts.has(e) && /^PM/.test(d.orgs[e] || 'PM'));
  if (pmWithPmCode) assert.strictEqual(d.teams[pmWithPmCode], 'pm', 'a PM… org code alone does not make a building manager');
  // Script properties correct individual people.
  const fix = createRuntime({ quiet: true, sheets: sheetsFrom(src), properties: { PROJECT_MANAGER_EMAILS: someone } });
  assert.strictEqual(JSON.parse(fix.ctx.apiLoad()).data.teams[someone], 'pm');
  assert.ok(Number(rt.props.ORG_CODES_N) >= 1);
  const calls = rt.state.directoryCalls;
  rt.setUser('owner@gsa.gov');
  rt.ctx.apiRefresh();
  assert.strictEqual(rt.state.directoryCalls, calls, 'a refresh within the week reuses the stored codes');
});

test('BA61 portal: projects with no PR in EASi are added; ones in EASi are not repeated', () => {
  const src = demoSources();
  const d = load(runtimeWith(src)).data;
  const portal = d.prs.filter((p) => p.source === 'portal');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.portal.counts)), { rows: 60, inEasi: 5, notInEasi: 43, otherZones: 0, closed: 12 });
  assert.strictEqual(portal.length, 43);
  // Matched by the portal number in a PR title (4) or by the EQ number (1): never listed twice.
  const numbers = portal.map((p) => p.pr);
  src.portal.slice(1, 6).forEach((r) => assert.ok(numbers.indexOf(r[1]) === -1, r[1] + ' is in EASi'));
  const byEq = d.prs.filter((p) => p.pr === src.pipeline[10][0])[0];
  assert.ok(byEq.portalNumbers.indexOf(src.portal[5][1]) !== -1, 'the EQ-matched PR shows its portal number');
  // An EQ number that is really the portal number doesn't count as a PR.
  assert.ok(numbers.indexOf(src.portal[7][1]) !== -1);
  // Denied and Cancelled are left out; the rest get the planned stages.
  assert.ok(portal.every((p) => ['planning', 'pending', 'noPr'].indexOf(p.stage) !== -1));
  assert.ok(d.stages.filter((s) => s.group === 'planned').length === 3 && d.stages[0].group === 'planned');
  // Money is the portal budget, apart from EASi's committed amounts.
  assert.ok(portal.every((p) => p.estimate > 0 && p.committed === 0 && p.programs[0] === 'PG61'));
  assert.ok(portal.every((p) => p.offices.length === 1 && p.buildings.length === 1 && p.buildingManager.length));
  assert.ok(/\?view=project&id=/.test(portal[0].link));
  // CORs written as names become the person's email; an unknown name is kept as written.
  const named = portal.filter((p) => p.cor.length && p.cor[0].indexOf('@') !== -1);
  assert.ok(named.length > 30);
  named.forEach((p) => assert.strictEqual(p.lead[0], p.cor[0]));
  const unknown = portal.filter((p) => p.cor[0] === 'name:pat unlisted');
  assert.strictEqual(unknown.length, 1);
  assert.strictEqual(d.people['name:pat unlisted'], 'Pat Unlisted');
  // No COR yet: the submitter (the portal's requester) is the person assigned.
  portal.filter((p) => !p.cor.length).forEach((p) => assert.deepStrictEqual(p.lead.slice(), p.requestor.slice()));
});

test('BA61 portal: names, nicknames and a blank or unreadable portal', () => {
  const rt = runtimeWith(demoSources(5));
  const idx = rt.ctx.personIndex_(['robert.sells@gsa.gov', 'india.stewart@gsa.gov', 'india.stewart@gsa.com', 'luis.ramirez-figueroa@gsa.gov',
    'christopher.oneill@gsa.gov', 'temesgen.wolday@gsa.gov', 'robert.smith@gsa.gov', 'robert.l.smith@gsa.gov', 'shelly.baxter@gsa.gov',
    'juan.juarez@gsa.gov', 'dana.cole@gsa.gov', 'dana.cale@gsa.gov']);
  assert.strictEqual(idx.find('Bobby Sells'), 'robert.sells@gsa.gov');
  assert.strictEqual(idx.find('India Stewart'), 'india.stewart@gsa.gov');
  assert.strictEqual(idx.find('Luis Ramirez'), 'luis.ramirez-figueroa@gsa.gov');
  assert.strictEqual(idx.find("Christopher O'Neill"), 'christopher.oneill@gsa.gov');
  assert.strictEqual(idx.find('Taz Wolday'), 'temesgen.wolday@gsa.gov');
  assert.strictEqual(idx.find('Robert Smith'), '', 'two people fit: no guess');
  assert.strictEqual(idx.find('Shelly Baxer'), 'shelly.baxter@gsa.gov', 'a dropped letter');
  assert.strictEqual(idx.find('Juan Jurez'), 'juan.juarez@gsa.gov');
  assert.strictEqual(idx.find('Shelly Bxtaer'), '', 'more than one slip: no guess');
  assert.strictEqual(idx.find('Dana Cole'), 'dana.cole@gsa.gov');
  assert.strictEqual(idx.find('Dana Cble'), '', 'one slip from two people: no guess');
  assert.strictEqual(idx.find('Pat Baxter'), '', 'the first name must match');
  ['baxter|baxer', 'baxter|baxtre', 'baxter|baxters', 'baxter|bexter'].forEach((pair) => assert.ok(rt.ctx.oneEditApart_(...pair.split('|')), pair));
  ['baxter|baxter', 'baxter|bxtaer', 'baxter|baxt'].forEach((pair) => assert.ok(!rt.ctx.oneEditApart_(...pair.split('|')), pair));
  assert.strictEqual(rt.ctx.portalFiscalYear_('FY27'), 2027);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rt.ctx.corAliases_('Pat Unlisted = Pat.Former@gsa.gov;\n Lee  Q. Smith: lee.jones@gsa.gov; junk; = x@gsa.gov'))),
    { 'pat unlisted': 'pat.former@gsa.gov', 'lee smith': 'lee.jones@gsa.gov' });
  // PORTAL_COR_EMAILS ties a name the matching can't work out to its email.
  const aliased = JSON.parse(createRuntime({ quiet: true, sheets: sheetsFrom(demoSources()), properties: { PORTAL_COR_EMAILS: 'Pat Unlisted = pat.former@gsa.gov' } }).ctx.apiLoad()).data;
  const pat = aliased.prs.filter((p) => p.source && p.cor[0] === 'pat.former@gsa.gov');
  assert.strictEqual(pat.length, 1);
  assert.strictEqual(pat[0].lead[0], 'pat.former@gsa.gov');
  assert.ok(!aliased.people['name:pat unlisted']);
  // PORTAL_ID OFF: no portal projects, and the page hides the portal parts.
  const off = createRuntime({ quiet: true, sheets: sheetsFrom(demoSources()), properties: { PORTAL_ID: 'OFF' } });
  const d = JSON.parse(off.ctx.apiLoad()).data;
  assert.strictEqual(d.portal.read, false);
  assert.ok(d.prs.every((p) => !p.source));
  // A portal the deployer can't open leaves its projects out instead of failing the build.
  const src = demoSources();
  delete src.portal;
  assert.ok(load(runtimeWith(src)).data.prs.length === 420);
});

test('helpers: dates, money, names, emails', () => {
  const c = runtimeWith(demoSources(1)).ctx;
  assert.strictEqual(c.pipelineDate_('Tue Oct 20 2026 03:00:00 GMT-0400 (Eastern Daylight Time)'), '2026-10-20');
  assert.strictEqual(c.pipelineDate_('Thu Dec 04 2025 03:00:00 GMT-0500 (Eastern Standard Time)'), '2025-12-04');
  assert.strictEqual(c.pipelineDate_('n/a'), '');
  assert.strictEqual(c.money_('n/a'), null);
  assert.strictEqual(c.money_('$1,234.567'), 1234.57);
  assert.strictEqual(c.nameFromEmail_('christine.allen1@gsa.gov'), 'Christine Allen');
  assert.strictEqual(JSON.stringify(c.parseEmailList_('A.B@gsa.gov, c.d@gsa.gov,a.b@gsa.gov')), '["a.b@gsa.gov","c.d@gsa.gov"]');
  assert.strictEqual(c.stageOf_({ acquisitionStatus: 'Active Award - in Awarded or Open-Exception Status', awardStatus: 'Awarded', prStatus: 'Approved', obligated: 100, expended: 100, committed: 100 }), 'expended');
  assert.strictEqual(c.stageOf_({ acquisitionStatus: 'PR in Draft, In Review and Not Yet Assigned', awardStatus: '', prStatus: 'In Review', obligated: 0, expended: 0, committed: 5 }), 'review');
});

test('doGet renders the page with every include', () => {
  const rt = runtimeWith(demoSources(1));
  const out = rt.ctx.doGet({ parameter: { view: 'workload', office: 'Iowa Field Office', q: '<script>' } });
  assert.ok(out.content.indexOf('function filtered(') !== -1);
  assert.ok(out.content.indexOf('function workloadView(') !== -1);
  assert.ok(out.content.indexOf('"view":"workload"') !== -1);
  assert.ok(out.content.indexOf('<script>"') === -1, 'unsafe route values are dropped');
  assert.ok(!/<\?/.test(out.content), 'no template tags left');
});

test('setup schedules the refresh once', () => {
  const rt = runtimeWith(demoSources(3));
  rt.ctx.setup();
  rt.ctx.setup();
  assert.strictEqual(rt.triggers.filter((t) => t.getHandlerFunction() === 'dailyRefresh').length, 2);
});

if (process.env.SOURCES_JSON) {
  test('real data: the EASi report and building directory', () => {
    const src = JSON.parse(fs.readFileSync(process.env.SOURCES_JSON, 'utf8'));
    const t0 = Date.now();
    const rt = runtimeWith(src);
    const json = rt.ctx.apiLoad();
    const d = JSON.parse(json).data;
    const offices = {};
    d.prs.forEach((p) => p.offices.forEach((o) => { offices[o] = (offices[o] || 0) + 1; }));
    const stages = {};
    d.prs.forEach((p) => { stages[p.stage] = (stages[p.stage] || 0) + 1; });
    console.log('    ' + d.prs.length + ' NEH PRs of ' + d.counts.pipelineRows + ' · ' + Math.round(json.length / 1024) + ' KB · ' + (Date.now() - t0) + ' ms');
    console.log('    offices', JSON.stringify(offices));
    console.log('    stages', JSON.stringify(stages));
    console.log('    by title', d.prs.filter((p) => p.placeNote === 'title').length, '· by org', d.prs.filter((p) => p.placeNote === 'org').length);
    assert.strictEqual(d.offices.length, 36);
    assert.deepStrictEqual(d.zones.slice(), ['2', '4', '5']);
    assert.ok(d.prs.length > 2000);
    assert.ok(d.offices.every((o) => o.manager), 'every office has a manager');
  });
}

let failed = 0;
tests.forEach((t) => {
  try { t.fn(); console.log('✓ ' + t.name); } catch (e) { failed++; console.log('✗ ' + t.name + '\n  ' + (e.stack || e)); }
});
console.log('\n' + (tests.length - failed) + ' of ' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
