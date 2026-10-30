/**
 * Turns the EASi BA61 Pipeline report and the OFM Building Assignments sheet into the
 * dataset the page shows, for one enterprise (Northeast Heartland: Zones 2, 4 and 5) or
 * one zone of it. Pure functions: they take sheet values (2-D arrays) and return plain
 * objects, so the tests run them in Node.
 *
 * A PR is in scope when one of its buildings is in scope in the OFM Building Assignments
 * sheet. Buildings come from FE_Building_Code_List; when that is blank, from building
 * numbers written in the PR title. A PR with no building but an in-scope OFM org code
 * (P00MCF00 = Heartland, P00MCA00 = New England, ...) is kept under its service center.
 * A PR on buildings in several field offices is listed under each of them.
 *
 * Projects planned in the BA61 portal or the BA54 tracker with no PR in EASi yet are added
 * from those sheets (Planned.gs, Portal.gs, Ba54.gs), when the options carry them.
 */

/**
 * @param {Array[]} pipelineValues  The Pipeline tab, header row first.
 * @param {Array[]} buildingValues  The Buildings tab (the header row is found by "Building Number").
 * @param {Array[]} orgValues       The Org Relationships tab (optional).
 * @param {Object}  options         { enterprise: 'Northeast Heartland', short: 'NEH', zone: '' (all), generatedAt, orgCodes,
 *                                    portalValues (the BA61 portal's Projects tab), portalUrl,
 *                                    ba54Values (the BA54 tracker's Current Program tab), ba54Link,
 *                                    nameEmails (Script property NAME_EMAILS) }
 */
function buildDataset_(pipelineValues, buildingValues, orgValues, options) {
  options = options || {};
  var scope = { enterprise: str_(options.enterprise), zone: zoneOf_(options.zone) };
  var directory = readDirectory_(buildingValues, orgValues, scope);
  var prs = [];
  var skipped = { otherZones: 0, noBuilding: 0 };
  var header = (pipelineValues && pipelineValues[0]) || [];
  var col = headerIndex_(header, PIPELINE_HEADERS);
  if (col.prNumber === -1) throw new Error('The pipeline report has no "PR_Number" column. Check that the tab is the EASi Pipeline table.');
  // What is in EASi, from every PR in any zone: PR numbers, the portal numbers PRs carry, and
  // project codes with the PRs' fiscal years. And everyone named on a PR anywhere, to match the
  // names the BA61 portal and BA54 tracker give to emails.
  var inEasi = { eq: {}, mentioned: {}, codes: {} };
  var known = [];

  for (var i = 1; i < pipelineValues.length; i++) {
    var row = pipelineValues[i];
    var get = function (key) { return col[key] === -1 ? '' : row[col[key]]; };
    var number = str_(get('prNumber')).toUpperCase();
    if (!number) continue;
    var title = str_(get('title'));
    inEasi.eq[number] = true;
    portalNumbersIn_(title + ' ' + str_(get('comments'))).forEach(function (n) { inEasi.mentioned[n] = true; });
    var prFy = fiscalYear_(get('fiscalYear'));
    codeList_(get('projectCodes')).forEach(function (c) { (inEasi.codes[c] = inEasi.codes[c] || []).push(prFy); });
    known = known.concat(parseEmailList_(get('cor')), parseEmailList_(get('requestor')));
    var place = placeOf_(get('buildingCodes'), title, get('orgCodes'), directory);
    if (!place.offices.length && !place.serviceCenters.length) {
      if (place.known) skipped.otherZones++; else skipped.noBuilding++;
      continue;
    }
    prs.push(prFromRow_(get, number, title, place, directory));
  }

  known = known.concat(Object.keys(directory.contacts));
  directory.offices.forEach(function (o) { if (o.manager) known.push(o.manager); });
  known = known.concat(portalEmails_(options.portalValues), ba54Emails_(options.ba54Values));
  var named = plannedPeople_(known, options.nameEmails);
  var portal = portalProjects_(options.portalValues, inEasi, directory, named, str_(options.portalUrl));
  var ba54 = ba54Projects_(options.ba54Values, inEasi, directory, named, str_(options.ba54Link));
  // A PR found through a portal project's EQ number shows that project's number too.
  prs.forEach(function (p) {
    (portal.matchedByEq[p.pr] || []).forEach(function (n) { if (p.portalNumbers.indexOf(n) === -1) p.portalNumbers.push(n); });
  });
  var planned = portal.projects.concat(ba54.projects);
  prs = prs.concat(planned);
  prs.sort(function (a, b) { return a.pr < b.pr ? -1 : a.pr > b.pr ? 1 : 0; });

  // Everyone on a project: email -> name ('name:…' keys are people the plans name without a known email).
  var people = {};
  prs.forEach(function (p) {
    ROLES.forEach(function (role) {
      (p[role.key] || []).forEach(function (email) { if (!people[email]) people[email] = named.names[email] || nameFromEmail_(email); });
    });
  });

  var orgs = options.orgCodes || {};
  var teams = {};
  var overrides = { bm: parseEmailList_(options.buildingManagers), pm: parseEmailList_(options.projectManagers) };
  Object.keys(people).forEach(function (email) { teams[email] = teamFor_(email, !!directory.contacts[email], overrides); });

  return {
    enterprise: scope.enterprise,
    zone: scope.zone,
    zones: directory.zones,
    // What the page calls the whole area: "NEH", or "Zone 5" when one zone is set.
    scopeLabel: scope.zone ? 'Zone ' + scope.zone : (str_(options.short) || scope.enterprise || 'All zones'),
    generatedAt: str_(options.generatedAt),
    directoryUpdated: directory.updated,
    builtAt: new Date().toISOString(),
    serviceCenters: directory.serviceCenters,
    offices: directory.offices,
    programs: PROGRAMS,
    stages: STAGES,
    roles: ROLES,
    people: people,
    orgs: Object.keys(people).reduce(function (o, e) { if (orgs[e]) o[e] = orgs[e]; return o; }, {}),
    teams: teams,
    teamNames: TEAMS,
    prs: prs,
    portal: { read: !!(options.portalValues && options.portalValues.length > 1), url: str_(options.portalUrl), counts: portal.counts },
    ba54: { read: !!(options.ba54Values && options.ba54Values.length > 1), url: str_(options.ba54Link), counts: ba54.counts },
    counts: { pipelineRows: Math.max(0, pipelineValues.length - 1), zonePrs: prs.length - planned.length, otherZones: skipped.otherZones, noBuilding: skipped.noBuilding }
  };
}

/**
 * 'bm' (building manager) or 'pm' (project manager) for one person. Building managers are
 * the people ServiceNow lists for a building (primary or secondary contact, from the OFM
 * Building Assignments sheet); everyone else is a project manager. Org codes are not used:
 * project management groups under property management carry PM… codes too. Script
 * properties BUILDING_MANAGER_EMAILS / PROJECT_MANAGER_EMAILS correct individual people.
 */
function teamFor_(email, isBuildingContact, overrides) {
  overrides = overrides || {};
  if ((overrides.pm || []).indexOf(email) !== -1) return 'pm';
  if ((overrides.bm || []).indexOf(email) !== -1) return 'bm';
  return isBuildingContact ? 'bm' : 'pm';
}

/** Adds org codes found in the directory ({ email: code }) to a built dataset (shown, and sortable by division). */
function applyOrgCodes_(dataset, codes) {
  Object.keys(dataset.people).forEach(function (email) {
    var code = str_(codes[email]).toUpperCase();
    if (code) dataset.orgs[email] = code;
  });
  return dataset;
}

/** In-scope buildings, field offices and service centers from the OFM Building Assignments sheet. */
function readDirectory_(buildingValues, orgValues, scope) {
  if (typeof scope !== 'object' || scope === null) scope = { zone: zoneOf_(scope) };
  var inScope = function (enterprise, zone) {
    if (scope.enterprise && sameName_(enterprise, scope.enterprise) === false) return false;
    if (scope.zone && zoneOf_(zone) !== scope.zone) return false;
    return !!str_(zone) || !!str_(enterprise);
  };
  var out = { buildings: {}, offices: [], serviceCenters: [], updated: '', officeByName: {}, scByCode: {}, contacts: {}, zones: [] };
  buildingValues = buildingValues || [];
  var headerRow = -1;
  for (var r = 0; r < Math.min(buildingValues.length, 15); r++) {
    if (buildingValues[r].some(function (c) { return str_(c) === 'Building Number'; })) { headerRow = r; break; }
  }
  if (headerRow === -1) throw new Error('Could not find the "Building Number" header in the building directory.');
  for (var t = 0; t < headerRow; t++) {
    var m = /Last Updated:\s*([\d\/]+)/.exec(str_(buildingValues[t][0]));
    if (m) out.updated = m[1];
  }
  var h = buildingValues[headerRow].map(function (c) { return str_(c); });
  var c = function (name) { return h.indexOf(name); };
  var idx = {
    number: c('Building Number'), name: c('Building Name'), city: c('City'), state: c('State'), zone: c('Zone'),
    enterprise: c('Enterprise'), sc: c('Service Center'), fo: c('Field Office'), dept: c('OFM Dept ID'), primary: c('ServiceNow Primary POC(s)'),
    secondary: c('ServiceNow Secondary POC(s)')
  };
  if (idx.number === -1 || idx.fo === -1 || idx.zone === -1) throw new Error('The building directory is missing the Building Number, Zone or Field Office column.');

  var offices = {};
  var serviceCenters = {};
  for (var i = headerRow + 1; i < buildingValues.length; i++) {
    var row = buildingValues[i];
    var number = str_(row[idx.number]).toUpperCase();
    if (!number || !inScope(idx.enterprise === -1 ? '' : row[idx.enterprise], row[idx.zone])) continue;
    var zone = zoneOf_(row[idx.zone]);
    var foName = str_(row[idx.fo]);
    var scName = str_(row[idx.sc]);
    var dept = idx.dept === -1 ? '' : str_(row[idx.dept]).toUpperCase();
    out.buildings[number] = {
      number: number,
      name: titleCase_(str_(row[idx.name])),
      city: titleCase_(str_(row[idx.city])),
      state: str_(row[idx.state]).toUpperCase(),
      office: foName,
      serviceCenter: scName,
      zone: zone,
      manager: idx.primary === -1 ? [] : parseEmailList_(row[idx.primary])
    };
    // Everyone ServiceNow lists for a zone building, primary or secondary: the building managers.
    out.buildings[number].manager.concat(idx.secondary === -1 ? [] : parseEmailList_(row[idx.secondary]))
      .forEach(function (e) { out.contacts[e] = true; });
    if (foName && !offices[foName]) offices[foName] = { name: foName, short: shortOfficeName_(foName), serviceCenter: scName, zone: zone, code: dept, manager: '', director: '', buildings: 0 };
    if (foName) {
      offices[foName].buildings++;
      if (!offices[foName].code && dept) offices[foName].code = dept;
    }
    if (scName && !serviceCenters[scName]) serviceCenters[scName] = { name: scName, short: scName.replace(/ Service Center$/, ''), zone: zone, code: dept.slice(0, 4), director: '' };
    if (zone && out.zones.indexOf(zone) === -1) out.zones.push(zone);
  }

  (orgValues || []).forEach(function (row, n) {
    if (n === 0) return;
    if (!inScope(row[0], row[1])) return;
    var fo = offices[str_(row[3])];
    var sc = serviceCenters[str_(row[2])];
    var director = parseEmailList_(row[4])[0] || '';
    var manager = parseEmailList_(row[7])[0] || '';
    if (fo) { fo.manager = manager; fo.director = director; }
    if (sc && director) sc.director = director;
  });

  out.offices = Object.keys(offices).map(function (k) { return offices[k]; })
    .sort(function (a, b) { return a.zone.localeCompare(b.zone) || a.serviceCenter.localeCompare(b.serviceCenter) || a.name.localeCompare(b.name); });
  out.serviceCenters = Object.keys(serviceCenters).map(function (k) { return serviceCenters[k]; })
    .sort(function (a, b) { return a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name); });
  out.zones.sort();
  out.offices.forEach(function (o) { out.officeByName[o.name] = o; });
  out.serviceCenters.forEach(function (s) { if (s.code) out.scByCode[s.code] = s; });
  return out;
}

/**
 * Which in-scope buildings, field offices and service centers a PR is on.
 * known = it named a building the directory knows (in any zone).
 */
function placeOf_(buildingCodes, title, orgCodes, directory) {
  var listed = codeList_(buildingCodes);
  var fromTitle = false;
  if (!listed.length) {
    listed = uniqueList_((title.toUpperCase().match(BUILDING_NUMBER_RE) || []));
    fromTitle = listed.length > 0;
  }
  var buildings = [];
  var offices = [];
  var serviceCenters = [];
  listed.forEach(function (n) {
    var b = directory.buildings[n];
    if (!b) return;
    buildings.push(b);
    if (b.office && offices.indexOf(b.office) === -1) offices.push(b.office);
    if (b.serviceCenter && serviceCenters.indexOf(b.serviceCenter) === -1) serviceCenters.push(b.serviceCenter);
  });
  var viaOrg = false;
  if (!buildings.length) {
    codeList_(orgCodes).forEach(function (code) {
      var m = OFM_ORG_RE.exec(code);
      var sc = m && directory.scByCode['PM' + m[1]];
      if (sc && serviceCenters.indexOf(sc.name) === -1) { serviceCenters.push(sc.name); viaOrg = true; }
    });
  }
  var zones = [];
  buildings.forEach(function (b) { if (b.zone && zones.indexOf(b.zone) === -1) zones.push(b.zone); });
  serviceCenters.forEach(function (name) {
    var sc = directory.serviceCenters.filter(function (x) { return x.name === name; })[0];
    if (sc && sc.zone && zones.indexOf(sc.zone) === -1) zones.push(sc.zone);
  });
  return {
    buildings: buildings, offices: offices, serviceCenters: serviceCenters, zones: zones,
    fromTitle: fromTitle, viaOrg: viaOrg, known: listed.length > 0
  };
}

function prFromRow_(get, number, title, place, directory) {
  var programs = codeList_(get('programCodes'));
  var programFromTitle = false;
  if (!programs.length) {
    var m, found = [];
    PROGRAM_IN_TITLE_RE.lastIndex = 0;
    while ((m = PROGRAM_IN_TITLE_RE.exec(title))) if (found.indexOf('PG' + m[1]) === -1) found.push('PG' + m[1]);
    // A NEH BA61 Project Portal number in the title (RM0028-092426) means a BA61 project.
    PORTAL_NUMBER_RE.lastIndex = 0;
    if (!found.length && PORTAL_NUMBER_RE.test(title.toUpperCase())) found.push('PG61');
    programs = found;
    programFromTitle = found.length > 0;
  }
  var committed = money_(get('committed'));
  var obligated = money_(get('obligated'));
  var expended = money_(get('expended'));
  var pr = {
    pr: number,
    title: title,
    link: /^https:\/\//i.test(str_(get('link'))) ? str_(get('link')) : ('https://easi.pbs.gsa.gov/suite/tempo/records/type/pr/search/' + encodeURIComponent(number)),
    fy: fiscalYear_(get('fiscalYear')),
    programs: programs,
    programFromTitle: programFromTitle,
    prStatus: na_(get('prStatus')),
    acquisitionStatus: na_(get('acquisitionStatus')),
    awardStatus: na_(get('awardStatus')),
    solicitationStatus: na_(get('solicitationStatus')),
    reviewers: parseEmailList_(get('reviewers')),
    awardNumber: na_(get('awardNumber')),
    awardType: na_(get('awardType')),
    vendor: na_(get('vendor')),
    category: na_(get('category')),
    procurementCategory: na_(get('procurementCategory')),
    committed: committed === null ? 0 : committed,
    obligated: obligated === null ? 0 : obligated,
    expended: expended === null ? 0 : expended,
    reserved: money_(get('reserved')) || 0,
    executed: pipelineDate_(get('executedDate')),
    cor: parseEmailList_(get('cor')),
    requestor: parseEmailList_(get('requestor')).filter(function (e) { return !/^grex_|_broker_|noreply/i.test(e); }),
    co: parseEmailList_(get('co')),
    cs: parseEmailList_(get('cs')),
    assigned: parseEmailList_(get('assigned')),
    programManager: parseEmailList_(get('programManager')),
    buildingManager: [],
    buildings: place.buildings.map(function (b) { return b.number; }),
    buildingNames: place.buildings.map(function (b) { return b.name + (b.city ? ' · ' + b.city + ', ' + b.state : ''); }),
    offices: place.offices,
    serviceCenters: place.serviceCenters,
    zones: place.zones,
    placeNote: place.viaOrg ? 'org' : place.fromTitle ? 'title' : '',
    state: na_(get('state')),
    officeCode: na_(get('officeCode')),
    projectCodes: codeList_(get('projectCodes')),
    rwas: codeList_(get('rwas')).map(function (v) { return v.replace(/\.0$/, ''); }),
    portalNumbers: portalNumbersIn_(title + ' ' + str_(get('comments'))),
    comments: str_(get('comments'))
  };
  place.buildings.forEach(function (b) {
    b.manager.forEach(function (e) { if (pr.buildingManager.indexOf(e) === -1) pr.buildingManager.push(e); });
  });
  pr.subprojects = (SUB_PROJECTS[number] || []).map(function (s) { return { id: str_(s[0]), title: str_(s[1]) }; });
  // How many projects the PR is: its sub-projects when it funds several, otherwise one.
  pr.units = pr.subprojects.length || 1;
  pr.lead = pr.cor.length ? pr.cor.slice() : pr.requestor.slice();
  pr.service = serviceReason_(pr);
  pr.stage = stageOf_(pr);
  pr.remaining = Math.max(0, round2_(pr.obligated - pr.expended));
  return pr;
}

/** Why a PR is a service contract rather than a project ('' when it is a project). */
function serviceReason_(pr) {
  if (SERVICE_CATEGORY_RE.test(pr.procurementCategory)) return 'Procurement category: ' + pr.procurementCategory;
  var title = pr.title.replace(/_/g, ' ');
  if (!SERVICE_TITLE_CATEGORY_RE.test(pr.category) || PROJECT_WORK_RE.test(title)) return '';
  for (var i = 0; i < SERVICE_TITLE_RES.length; i++) {
    var m = SERVICE_TITLE_RES[i].exec(title);
    if (m) return 'Title mentions "' + m[0] + '"';
  }
  return '';
}

/** The STAGES key for a PR, from EASi's acquisition, award and PR statuses and the Pegasys amounts. */
function stageOf_(pr) {
  var acq = pr.acquisitionStatus.toLowerCase();
  var award = pr.awardStatus.toLowerCase();
  if (/^active award/.test(acq) || award === 'awarded' || award === 'open-exception') {
    if (pr.obligated <= 0) return pr.committed > 0 ? 'awarded' : 'expended';
    return pr.expended >= pr.obligated - 0.005 ? 'expended' : 'awarded';
  }
  if (/draft award/.test(acq) || award === 'in draft') return 'drafting';
  if (/^solicitation/.test(acq)) return 'solicitation';
  if (/assigned, not associated/.test(acq)) return 'assigned';
  if (/pending assignment/.test(acq)) return 'approved';
  if (pr.prStatus.toLowerCase() === 'in review') return 'review';
  if (pr.prStatus.toLowerCase() === 'approved') return 'approved';
  return 'draft';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function str_(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** EASi writes "n/a" for empty cells. */
function na_(value) {
  var text = str_(value);
  return /^n\/?a$/i.test(text) ? '' : text;
}

function headerIndex_(header, names) {
  var h = header.map(function (c) { return str_(c); });
  var out = {};
  Object.keys(names).forEach(function (key) { out[key] = h.indexOf(names[key]); });
  return out;
}

/** Case- and spacing-insensitive name match ("Northeast Heartland" = "northeast  heartland"). */
function sameName_(a, b) {
  return str_(a).toLowerCase().replace(/\s+/g, ' ') === str_(b).toLowerCase().replace(/\s+/g, ' ');
}

function zoneOf_(value) {
  return str_(value).replace(/\.0+$/, '');
}

/** "CO0026ZZ, CO0045ZZ" -> ['CO0026ZZ', 'CO0045ZZ'] (upper case, no n/a, no repeats). */
function codeList_(value) {
  return uniqueList_(na_(value).split(/[,;\s]+/).map(function (v) { return v.trim().toUpperCase(); })
    .filter(function (v) { return v && v !== 'N/A'; }));
}

/** Portal numbers (RM0024-092426) written in a PR's title or comments. */
function portalNumbersIn_(text) {
  return uniqueList_(str_(text).toUpperCase().match(PORTAL_NUMBER_RE) || []);
}

function uniqueList_(list) {
  var seen = {};
  return list.filter(function (v) { if (seen[v]) return false; seen[v] = true; return true; });
}

function parseEmailList_(value) {
  return uniqueList_(na_(value).split(/[\s,;]+/).map(function (v) { return v.trim().toLowerCase(); })
    .filter(function (v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }));
}

function money_(value) {
  if (typeof value === 'number') return isFinite(value) ? round2_(value) : null;
  var text = na_(value).replace(/[$,\s]/g, '');
  if (!text) return null;
  var n = Number(text);
  return isFinite(n) ? round2_(n) : null;
}

function round2_(n) {
  return Math.round(Number(n) * 100) / 100;
}

function fiscalYear_(value) {
  var n = parseInt(str_(value), 10);
  return isFinite(n) && n > 1990 ? n : null;
}

/** The pipeline's dates: a Date, or text like "Tue Oct 20 2026 03:00:00 GMT-0400 (Eastern Daylight Time)". -> 'yyyy-mm-dd' */
function pipelineDate_(value) {
  var d = null;
  if (Object.prototype.toString.call(value) === '[object Date]') d = value;
  else {
    var text = na_(value).replace(/\s*\([^)]*\)\s*$/, '');
    if (!text) return '';
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    d = new Date(text);
  }
  if (!d || isNaN(d.getTime())) return '';
  // EASi stamps dates at 03:00 Eastern; noon UTC of the same calendar day keeps it stable.
  var shifted = new Date(d.getTime() - 5 * 3600 * 1000);
  return shifted.getUTCFullYear() + '-' + pad2_(shifted.getUTCMonth() + 1) + '-' + pad2_(shifted.getUTCDate());
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** jane.q.doe2@gsa.gov -> "Jane Q Doe" */
function nameFromEmail_(email) {
  var local = str_(email).split('@')[0].replace(/\d+$/, '');
  return local.split(/[._-]+/).filter(String).map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ') || email;
}

function titleCase_(text) {
  if (!text || text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); })
    .replace(/\b(Us|Gsa|Fbi|Irs|Ssa|Va|Usps|Lpoe|Fob|Ctcrths|Cths|Ctc|Fc|Fed)\b/g, function (m) { return m.toUpperCase(); })
    .replace(/\bO'([a-z])/g, function (m, c) { return "O'" + c.toUpperCase(); });
}

function shortOfficeName_(name) {
  return str_(name).replace(/ Field Office$/, '');
}
