/**
 * Made-up Zone 5 data for the preview and tests: real field office names, invented
 * buildings, people and PRs. Same shape as tools/export_sheets.py output.
 */
'use strict';

const OFFICES = [
  ['Heartland Service Center', 'Arkansas & Missouri Field Office', 'PMCFA', 'MO', 'casey.ozark@gsa.gov'],
  ['Heartland Service Center', 'Iowa Field Office', 'PMCFB', 'IA', 'dana.prairie@gsa.gov'],
  ['Heartland Service Center', 'Kansas City North Field Office', 'PMCFC', 'MO', 'morgan.river@gsa.gov'],
  ['Heartland Service Center', 'Kansas Field Office', 'PMCFD', 'KS', 'jordan.wheat@gsa.gov'],
  ['Heartland Service Center', 'Nebraska Field Office', 'PMCFE', 'NE', 'riley.platte@gsa.gov'],
  ['Heartland Service Center', 'St. Louis Field Office', 'PMCFF', 'MO', 'avery.arch@gsa.gov'],
  ['Rocky Mountain Service Center', 'Colorado Field Office', 'PMCGA', 'CO', 'quinn.peak@gsa.gov'],
  ['Rocky Mountain Service Center', 'Dakotas Field Office', 'PMCGB', 'ND', 'rowan.badlands@gsa.gov'],
  ['Rocky Mountain Service Center', 'Denver Federal Center Field Office', 'PMCGC', 'CO', 'sam.foothills@gsa.gov'],
  ['Rocky Mountain Service Center', 'Minnesota Field Office', 'PMCGD', 'MN', 'skyler.lakes@gsa.gov'],
  ['Rocky Mountain Service Center', 'Oklahoma Field Office', 'PMCGE', 'OK', 'harper.redland@gsa.gov'],
  ['Rocky Mountain Service Center', 'Utah High West Field Office', 'PMCGF', 'UT', 'emery.basin@gsa.gov'],
  // One office each from Zones 2 and 4, so the demo covers the whole NEH enterprise.
  ['New England Service Center', 'Boston Field Office', 'PMCAA', 'MA', 'morgan.harbor@gsa.gov', '2'],
  ['Great Lakes Service Center', 'Chicago North Field Office', 'PMCDA', 'IL', 'jamie.lakefront@gsa.gov', '4']
];
const DIRECTORS = { 'Heartland Service Center': 'pat.heartland@gsa.gov', 'Rocky Mountain Service Center': 'lee.rockies@gsa.gov', 'New England Service Center': 'sam.commons@gsa.gov', 'Great Lakes Service Center': 'alex.prairie@gsa.gov' };
const FIRST = ['Alex', 'Blair', 'Cameron', 'Drew', 'Elliot', 'Frankie', 'Gray', 'Hayden', 'Indy', 'Jesse', 'Kai', 'Logan', 'Marley', 'Noel', 'Oakley', 'Parker', 'Reese', 'Sage', 'Tatum', 'Wren'];
const LAST = ['Adams', 'Brooks', 'Chavez', 'Diaz', 'Ellis', 'Foster', 'Garcia', 'Hughes', 'Ito', 'Jensen', 'Kim', 'Lopez', 'Moore', 'Nguyen', 'Ortiz', 'Patel'];
const WORK = ['Replace boiler controls', 'Roof membrane repair', 'Fire alarm panel upgrade', 'LED lighting retrofit', 'Restroom accessibility upgrades', 'Snow removal services',
  'Generator load bank testing', 'Repaint stairwells', 'Cooling tower fill replacement', 'BAS controller replacement', 'Parking lot crack sealing', 'Elevator door operator modernization',
  'Backflow preventer replacement', 'Carpet replacement suite 400', 'Security camera upgrade', 'Tenant build-out RWA', 'Chiller descale', 'Window film installation'];
const STATUSES = [
  ['Approved', 'Active Award - in Awarded or Open-Exception Status', 'Awarded', 'Closed', 0.62],
  ['Approved', 'PR Approved, Assigned, Not Associated to Award/Solicitation', 'n/a', 'n/a', 0.12],
  ['Approved', 'Solicitation', 'n/a', 'Published', 0.08],
  ['Approved', 'PR Approved, Pending Assignment', 'n/a', 'n/a', 0.08],
  ['In Review', 'PR in Draft, In Review and Not Yet Assigned', 'n/a', 'n/a', 0.05],
  ['In Draft', 'PR in Draft, In Review and Not Yet Assigned', 'n/a', 'n/a', 0.03],
  ['Approved', 'Draft Award', 'In Draft', 'Closed', 0.02]
];
const HEADER = ['PR_Number', 'PR_Title', 'Award_Number', 'Contact_Assigned_CO_CS', 'Contact_Requestor', 'Contracting_Officer', 'Contracting_Specialist', 'Contracting_Officer_Representative',
  'PR_Reserved_Amount', 'PR_Committed_Amount', 'Award_Obligated_Amount', 'Variance_Pegasys_Expended_Amount', 'Award_Type', 'Vendor_Name', 'Acquisition_Status', 'Place_of_Performance_State',
  'Office_Code', 'PR_Fiscal_Year', 'PR_Status', 'Current_PR_Routing_Position_For_Review', 'Solicitation_Status', 'Award_Status', 'Contract_Number', 'FE_Activity_Code_List',
  'FE_Building_Code_List', 'FE_Org_Code_List', 'FE_Program_Code_List', 'FE_Project_Code_List', 'FE_RWA_List', 'Executed_Date', 'Program_Manager', 'Category_Code', 'UEI_SAM',
  'Procurement_Category', 'Comments', 'Link'];

function demoSources(count) {
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const person = () => (pick(FIRST) + '.' + pick(LAST)).toLowerCase() + '@gsa.gov';

  const buildingsHeader = ['Building Number', 'Building Name', 'City', 'State', 'Enterprise', 'Zone', 'Service Center', 'Field Office', 'Core Designation', 'Federal/Leased/Delegated',
    'Service Center Director Email ', 'Field Office POC Email', 'ServiceNow Primary POC(s)', 'ServiceNow Secondary POC(s)', 'Column 15', 'Original Redesign Service Center Name',
    'Original Redesign Field Office Name', 'REXUS Campus Code', 'Severable RWA Approver', 'OFM Dept ID'];
  const buildings = [['Sheet Last Updated: 10/20/2026'], buildingsHeader];
  const officeBuildings = {};
  const officeStaff = {};
  OFFICES.forEach((o, i) => {
    officeBuildings[o[1]] = [];
    officeStaff[o[1]] = [0, 1, 2, 3, 4, 5].map(person);
    for (let b = 0; b < 6; b++) {
      const num = o[3] + String(1000 + i * 10 + b).padStart(4, '0') + 'ZZ';
      officeBuildings[o[1]].push(num);
      buildings.push([num, 'FEDERAL BUILDING ' + (b + 1), 'DEMO CITY ' + (i + 1), o[3], 'Northeast Heartland', o[5] || '5', o[0], o[1], '', 'Federally Owned',
        // The first three of each office's staff are its building managers; the rest are project managers.
        DIRECTORS[o[0]], o[4], pick(officeStaff[o[1]].slice(0, 3)), '', null, '', '', '', o[4], o[2]]);
    }
  });
  buildings.push(['WA0001ZZ', 'OUT OF ZONE BUILDING', 'SEATTLE', 'WA', 'Pacific Gulf', '7', 'Pacific Northwest Service Center', 'Seattle Field Office', '', 'Leased', '', '', '', '', null, '', '', '', '', 'PMBEA']);
  const org = [['Enterprise', 'Zone', 'Service Center', 'Field Office', 'Service Center Director Email', 'Severable RWA Approver', 'FO Manager Import', 'Field Office POC Email']]
    .concat(OFFICES.map((o) => ['Northeast Heartland', o[5] || '5', o[0], o[1], DIRECTORS[o[0]], o[4], null, o[4]]));

  const pipeline = [HEADER];
  const cos = [0, 1, 2, 3, 4].map(person);
  for (let n = 0; n < (count || 420); n++) {
    const o = pick(OFFICES);
    const staff = officeStaff[o[1]];
    const b = pick(officeBuildings[o[1]]);
    let r = rand(), s = STATUSES[0];
    for (const st of STATUSES) { if (r < st[4]) { s = st; break; } r -= st[4]; }
    const prog = rand() < 0.55 ? 'PG61' : rand() < 0.5 ? 'PG80' : rand() < 0.8 ? 'PG54' : 'PG55';
    const fy = rand() < 0.6 ? 2026 : rand() < 0.5 ? 2027 : 2025 - Math.floor(rand() * 3);
    const committed = Math.round((2000 + rand() * rand() * 400000) * 100) / 100;
    const awarded = s[2] === 'Awarded';
    const expended = awarded ? (rand() < 0.35 ? committed : Math.round(committed * rand() * 100) / 100) : 'n/a';
    const num = 'EQ' + o[2] + '-' + String(fy).slice(2) + '-' + String(n + 1).padStart(4, '0');
    const executed = awarded ? new Date(Date.UTC(fy - 1, 9 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 27), 7)).toString() : 'n/a';
    pipeline.push([num, pick(WORK) + ' ' + b, awarded ? '47P' + Math.floor(rand() * 1e9) : 'n/a', pick(cos), pick(staff), awarded ? pick(cos) : 'n/a', rand() < 0.5 ? pick(cos) : 'n/a',
      rand() < 0.9 ? pick(staff) + (rand() < 0.08 ? ', ' + pick(staff) : '') : 'n/a', 0, committed, awarded ? committed : 'n/a', expended, awarded ? 'Task/Delivery Order' : 'n/a',
      awarded ? pick(['Acme Mechanical LLC', 'Prairie Roofing Inc', 'Summit Electric Co', 'Front Range Facilities']) : 'n/a', s[1], o[3], 'PMBA', fy, s[0],
      s[0] === 'In Review' ? pick(cos) : 'n/a', s[3], s[2], 'n/a', 'PGA42', b, 'P0825000', prog, 'n/a', prog === 'PG80' ? String(3000000 + n) : 'n/a', executed,
      'n/a', 'Construction', 'n/a', 'Other', null, 'https://easi.pbs.gsa.gov/suite/tempo/records/type/pr/search/' + num]);
  }
  // One national contract with no building, and one PR on a building outside the zone.
  pipeline.push(['EQNAT-26-0001', 'National broker lease', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 0, 0, 'n/a', 'n/a', 'n/a', 'n/a', 'Active Award - in Awarded or Open-Exception Status', 'DC', 'PRBA', 2026, 'Approved', 'n/a', 'n/a', 'Awarded', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'Other', 'n/a', 'Other', null, '']);
  pipeline.push(['EQ10P-26-0001', 'Seattle repair', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 0, 5000, 'n/a', 'n/a', 'n/a', 'n/a', 'PR Approved, Pending Assignment', 'WA', 'PMBE', 2026, 'Approved', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'WA0001ZZ', 'n/a', 'PG61', 'n/a', 'n/a', 'n/a', 'n/a', 'Other', 'n/a', 'Other', null, '']);

  // The BA61 portal's Projects tab: FY27 projects, most with no PR in EASi yet. A few are in
  // EASi already (their number in a PR title, or a PR number as the EQ number), so they don't repeat.
  const portalHeader = ['Project ID', 'Project Number', 'Status', 'Request Type', 'Fiscal Year', 'Service Center', 'Field Office Code', 'Field Office', 'Building Number(s)',
    'Building Name', 'Building Manager', 'Project Description', 'Priority', 'Spend Category', 'Budgeted Amount', 'Commitment Month', 'COR', 'EQ Number', 'Requester Email',
    'Additional POC Emails', 'Submitted For Approval At', 'Decided At', 'Created At'];
  const portal = [portalHeader];
  const portalStatuses = ['Planning', 'Planning', 'Approved', 'Approved', 'Approved', 'Pending Approval', 'Emergency NTP', 'Denied', 'Cancelled'];
  const nameOf = (email) => email.split('@')[0].split('.').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  for (let n = 0; n < 60; n++) {
    const o = pick(OFFICES);
    const staff = officeStaff[o[1]];
    const b = pick(officeBuildings[o[1]]);
    const number = o[3] + String(100 + n).padStart(4, '0') + '-100126';
    const status = portalStatuses[n % portalStatuses.length];
    const cor = n === 5 ? 'Pat Unlisted' : n % 7 === 3 ? '' : nameOf(pick(staff));
    let eq = '';
    if (n < 4 && pipeline[1 + n]) pipeline[1 + n][1] += ' ' + number;           // In EASi: the PR title has the portal number.
    else if (n === 4 && pipeline[10]) eq = pipeline[10][0];                  // In EASi: the EQ number is a PR number.
    else if (n === 6) eq = number;                           // An EQ number that is really the portal number: not a PR.
    portal.push(['id-' + n, number, status, status === 'Emergency NTP' ? 'Emergency' : 'Standard', 'FY27', o[0], o[2], o[1], b, 'Federal Building', '',
      pick(WORK) + ' (portal)', 'Critical Must Fund', 'Building Support', Math.round(5000 + rand() * 150000), 'January', cor, eq, pick(staff), '',
      '2026-10-02T15:00:00.000Z', status === 'Approved' ? '2026-10-06T15:00:00.000Z' : '', '2026-10-01T15:00:00.000Z']);
  }

  const reportInfo = [['Report Name', 'BA61 Pipeline'], ['Generated At', '2026-10-29T12:08:31.000Z']];
  return { pipeline, reportInfo, buildings, org, portal };
}

/**
 * A stand-in GSA directory for the demo: building managers carry their office's OFM code
 * (PMCGC…), project managers a made-up design-and-construction code (PCD…).
 */
function demoDirectory(sources) {
  const names = {};
  const b = sources.buildings;
  const h = b[1];
  const pocs = new Set(b.slice(2).map((r) => r[h.indexOf('ServiceNow Primary POC(s)')]));
  const p = sources.pipeline;
  const cor = p[0].indexOf('Contracting_Officer_Representative');
  const req = p[0].indexOf('Contact_Requestor');
  const office = p[0].indexOf('Office_Code');
  p.slice(1).forEach((r) => [r[cor], r[req]].join(',').split(/[\s,]+/).filter((e) => /@/.test(e)).forEach((e) => {
    const name = e.split('@')[0].split('.').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    names[e] = name + ' - ' + (pocs.has(e) ? 'PMCGC' : 'PCD' + String(r[office]).slice(-1));
  }));
  return names;
}

module.exports = { demoSources, demoDirectory, OFFICES };
