/**
 * Reading the source sheets and keeping a built snapshot in the script cache, so
 * page loads don't re-read 10,000 pipeline rows. The sheets are only ever read.
 *
 *   loadPacked_()        { meta, gzBase, gzParts, gzLater }: the snapshot compacted and gzipped (base64) in parts, plus the few fields the
 *                        server needs itself; what the page downloads (built on a cache miss)
 *   loadDataset_()       the snapshot as JSON text, for setup and editor checks
 *   refreshDataset_()    rebuild now (daily trigger, and the Refresh button)
 *
 * The national snapshot is about 20 MB of JSON; compacted and gzipped it is under 3 MB, so it
 * fits the cache, and the page carries only the viewer's own enterprise to begin with.
 */

// Bump DATASET_VERSION whenever the snapshot's shape changes: the new code then rebuilds instead
// of reading a snapshot the old code saved (the cache keeps one for up to 6 hours).
var DATASET_VERSION = 13;
var CACHE_PREFIX = 'wltds:v' + DATASET_VERSION + ':';
// Cache values are capped at 100 KB (bytes); 45,000 characters stays under it even with accented names.
var CACHE_CHUNK = 45000;

function loadPacked_() {
  var packed = cachedOrSavedPacked_();
  if (packed) return packed;
  refreshDataset_();
  return lastPacked_;
}

/** The packed snapshot the last refresh in this run built (so a cache miss doesn't pack it twice). */
var lastPacked_ = null;

/**
 * The snapshot without rebuilding it: from the cache, or from the saved copy (a small sheet
 * the tracker owns) when the cache has been emptied, putting it back in the cache. null when
 * neither has one from this version of the code.
 */
function cachedOrSavedPacked_() {
  var cached = readCachedJson_();
  if (cached) return JSON.parse(cached);
  var saved = readSavedSnapshot_();
  if (saved) writeCachedJson_(saved);
  return saved ? JSON.parse(saved) : null;
}

// ---------------------------------------------------------------------------
// The saved copy: so a cache that Google empties early costs a second or two, not a rebuild.
// ---------------------------------------------------------------------------

var SNAPSHOT_SHEET_PROP = 'SNAPSHOT_SHEET_ID';
var SNAPSHOT_CELL = 45000;   // A cell holds up to 50,000 characters.

/** The spreadsheet the tracker keeps its own copies in (created on first use when create is true). */
function snapshotSpreadsheet_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SNAPSHOT_SHEET_PROP);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { if (!create) return null; }
  }
  if (!create) return null;
  var ss = SpreadsheetApp.create(appName_() + ' - saved snapshot (do not edit)');
  props.setProperty(SNAPSHOT_SHEET_PROP, ss.getId());
  return ss;
}

function savedSnapshotSheet_(create) {
  var ss = snapshotSpreadsheet_(create);
  return ss ? ss.getSheets()[0] : null;
}

/** Saves the packed snapshot (JSON text) into column A: a header row, then the text in pieces. */
function writeSavedSnapshot_(packedJson) {
  var sheet = savedSnapshotSheet_(true);
  var rows = [[JSON.stringify({ version: DATASET_VERSION, savedAt: new Date().toISOString() })]];
  for (var i = 0; i < packedJson.length; i += SNAPSHOT_CELL) rows.push([packedJson.slice(i, i + SNAPSHOT_CELL)]);
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 1).setValues(rows);
}

/**
 * The stage history (History.gs), kept as JSON in a "History" tab of the saved-snapshot sheet.
 * null when there is none yet; false when it couldn't be read (then it isn't overwritten).
 */
var HISTORY_TAB = 'History';

function readHistory_() {
  var ss = snapshotSpreadsheet_(false);
  var tab = ss && ss.getSheetByName(HISTORY_TAB);
  if (!tab || tab.getLastRow() < 1) return null;
  var text = tab.getRange(1, 1, tab.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); }).join('');
  try { return JSON.parse(text); } catch (e) { console.warn('Stage history unreadable: ' + e); return false; }
}

function writeHistory_(history) {
  var ss = snapshotSpreadsheet_(true);
  var tab = ss.getSheetByName(HISTORY_TAB) || ss.insertSheet(HISTORY_TAB);
  var text = JSON.stringify(history);
  var rows = [];
  for (var i = 0; i < text.length; i += SNAPSHOT_CELL) rows.push([text.slice(i, i + SNAPSHOT_CELL)]);
  tab.clear();
  tab.getRange(1, 1, rows.length, 1).setValues(rows);
}

function readSavedSnapshot_() {
  try {
    var sheet = savedSnapshotSheet_(false);
    if (!sheet || sheet.getLastRow() < 2) return null;
    var values = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    var head = JSON.parse(String(values[0][0]) || '{}');
    if (head.version !== DATASET_VERSION) return null;
    return values.slice(1).map(function (r) { return String(r[0]); }).join('');
  } catch (e) {
    console.warn('Could not read the saved snapshot: ' + e);
    return null;
  }
}

function loadDataset_() {
  return JSON.stringify(unpackDataset_(loadPacked_()));
}

/** What the cache holds: the gzipped snapshot and the parts the server reads (who is signed in). */
function packDataset_(dataset) {
  // Compacted (Compact.gs) and in parts, so the page can carry little and fetch the rest after:
  // the shared part (gzBase: people, offices, stages...), each enterprise's open projects
  // (gzParts; a project in two enterprises is in both parts), and the paid-in-full projects and
  // service contracts the page hides at first (gzLater).
  var small = compactDataset_(dataset);
  var zoneEnt = {};
  (dataset.enterprises || []).forEach(function (e) { e.zones.forEach(function (z) { zoneEnt[z] = e.name; }); });
  var parts = {}, later = [], named = {}, leads = {};
  dataset.prs.forEach(function (p, i) {
    var c = small.prs[i];
    if (!shownFirst_(p)) { later.push(c); return; }
    var ents = uniqueList_((p.zones || []).map(function (z) { return zoneEnt[z] || ''; }));
    if (!ents.length) ents = [''];
    ents.forEach(function (e) { (parts[e] = parts[e] || []).push(c); });
    // Where each person's open projects are, so their first load carries what Needs attention needs.
    var note = function (map, email) {
      var list = map[email] = map[email] || [];
      ents.forEach(function (e) { if (list.indexOf(e) === -1) list.push(e); });
    };
    ROLES.forEach(function (r) { (p[r.key] || []).forEach(function (email) { note(named, email); }); });
    (p.lead || []).forEach(function (email) { note(leads, email); });
  });
  delete small.prs;
  // Who reports to whom stays on the server (it picks each supervisor's team).
  delete small.reportsTo;
  small.parts = Object.keys(parts);
  small.laterCount = later.length;
  var gzParts = {};
  Object.keys(parts).forEach(function (e) { gzParts[e] = gzipText_(JSON.stringify(parts[e])); });
  return {
    meta: { offices: dataset.offices, serviceCenters: dataset.serviceCenters, zones: dataset.zones, enterprises: dataset.enterprises || [], scopeLabel: dataset.scopeLabel, prs: dataset.prs.length,
      named: named, leads: leads, orgs: dataset.orgs || {}, reportsTo: dataset.reportsTo || {},
      // Everyone named on any project (paid in full and service contracts too), for supervisors' teams.
      people: Object.keys(dataset.people || {}).reduce(function (o, e) { o[e] = 1; return o; }, {}) },
    gzBase: gzipText_(JSON.stringify(small)),
    gzParts: gzParts,
    gzLater: later.length ? gzipText_(JSON.stringify(later)) : ''
  };
}

/** A project's key across parts: the same project can be in two enterprises' parts. */
function projectKey_(p) {
  return (p.source || '') + ':' + p.pr;
}

/**
 * What a page opens with: the shared part and the open projects of the viewer's enterprise
 * (the one of the office or service center they manage, lead or belong to), or every
 * enterprise's when the tracker can't tell. The page fetches the rest right after.
 */
function firstLoad_(packed, user) {
  var all = Object.keys(packed.gzParts || {});
  var home = homeEnterprise_(user, packed.meta);
  // Also every enterprise Needs attention reaches for them: their own projects, and a leader's
  // places and team, wherever those are.
  var extra = attentionEnterprises_(user, packed.meta);
  var want = home && all.indexOf(home) !== -1 ? all.filter(function (e) { return e === home || e === '' || extra.indexOf(e) !== -1; }) : all;
  var parts = {};
  want.forEach(function (e) { parts[e] = packed.gzParts[e]; });
  return { user: user, gz: packed.gzBase, parts: parts };
}

/**
 * More of the snapshot after the first load: the enterprises' parts asked for (want: names, or
 * 'all' for every one the page doesn't have yet) and, with later, the paid-in-full projects and
 * service contracts.
 */
function restLoad_(packed, have, want, later) {
  var parts = {};
  Object.keys(packed.gzParts || {}).forEach(function (e) {
    if ((have || []).indexOf(e) === -1 && (want === 'all' || (want || []).indexOf(e) !== -1)) parts[e] = packed.gzParts[e];
  });
  return { parts: parts, later: later ? packed.gzLater || '' : '' };
}

/**
 * The enterprises holding the open projects a viewer's Needs attention covers (see JsAttention):
 * the ones they are named on, and a leader's places and team. An admin's follows the page instead.
 */
function attentionEnterprises_(user, meta) {
  if (!user || !user.email || !meta || !meta.named) return [];
  var pf = user.portfolio;
  if (pf && pf.all) return [];
  var out = (meta.named[user.email] || []).slice();
  var add = function (e) { if (e && out.indexOf(e) === -1) out.push(e); };
  if (pf) {
    pf.enterprises.forEach(add);
    pf.zones.forEach(function (z) { (meta.enterprises || []).forEach(function (e) { if (e.zones.indexOf(z) !== -1) add(e.name); }); });
    (meta.offices || []).forEach(function (o) { if (pf.offices.indexOf(o.name) !== -1) add(o.enterprise); });
    (meta.serviceCenters || []).forEach(function (s) { if (pf.serviceCenters.indexOf(s.name) !== -1) add(s.enterprise); });
    var team = pf.people.slice();
    if (pf.orgCodes.length) Object.keys(meta.orgs || {}).forEach(function (email) {
      var org = String(meta.orgs[email] || '').toUpperCase();
      if (pf.orgCodes.some(function (c) { return org.indexOf(c) === 0; })) team.push(email);
    });
    // A team member's projects count where they are the person assigned (see inPortfolio).
    team.forEach(function (email) { ((meta.leads || meta.named)[email] || []).forEach(add); });
  }
  return out;
}

/** The enterprise a viewer belongs to ('' when the tracker can't tell). */
function homeEnterprise_(user, meta) {
  if (!user || !meta) return '';
  var office = (user.manages && user.manages[0]) || user.orgOffice;
  var sc = (user.directs && user.directs[0]) || user.orgSc;
  var o = office && (meta.offices || []).filter(function (x) { return x.name === office; })[0];
  if (o && o.enterprise) return o.enterprise;
  // A zone or enterprise leader: the enterprise they are over, when it is just one.
  var pf = user.portfolio;
  if (pf && !pf.all && !sc) {
    var ents = pf.enterprises.slice();
    pf.zones.forEach(function (z) { (meta.enterprises || []).forEach(function (e) { if (e.zones.indexOf(z) !== -1 && ents.indexOf(e.name) === -1) ents.push(e.name); }); });
    if (ents.length === 1) return ents[0];
  }
  var s = sc && (meta.serviceCenters || []).filter(function (x) { return x.name === sc; })[0];
  return s && s.enterprise ? s.enterprise : '';
}

/** The whole snapshot as one dataset again (every part, every field), for the editor and older browsers. */
function unpackDataset_(packed) {
  var data = JSON.parse(gunzipText_(packed.gzBase));
  var seen = {}, prs = [];
  var add = function (list) { list.forEach(function (c) { var k = projectKey_(c); if (!seen[k]) { seen[k] = true; prs.push(c); } }); };
  Object.keys(packed.gzParts || {}).forEach(function (e) { add(JSON.parse(gunzipText_(packed.gzParts[e]))); });
  if (packed.gzLater) add(JSON.parse(gunzipText_(packed.gzLater)));
  data.prs = prs.map(function (c) { return expandProject_(c, data); });
  data.prs.sort(function (a, b) { return a.pr < b.pr ? -1 : a.pr > b.pr ? 1 : 0; });
  delete data.laterCount;
  delete data.parts;
  return data;
}

function gzipText_(text) {
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text, 'application/json')).getBytes());
}

function gunzipText_(base64) {
  return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(base64), 'application/x-gzip')).getDataAsString();
}

/** Reads the source sheets, builds the dataset and caches it. Returns the dataset JSON (a string). */
function refreshDataset_() {
  var started = Date.now();
  var pipeline = SpreadsheetApp.openById(setting_('PIPELINE_ID'));
  var tabName = setting_('PIPELINE_TAB');
  var sheet = pipeline.getSheetByName(tabName);
  if (!sheet) throw new Error('The pipeline report has no "' + tabName + '" tab (Script property PIPELINE_TAB).');
  var pipelineValues = sheet.getDataRange().getValues();
  var generatedAt = '';
  var info = pipeline.getSheetByName('Report Info');
  if (info) {
    info.getDataRange().getValues().forEach(function (r) {
      if (str_(r[0]) === 'Generated At') generatedAt = isDateValue_(r[1]) ? r[1].toISOString() : str_(r[1]);
    });
  }

  var directory = SpreadsheetApp.openById(setting_('DIRECTORY_ID'));
  var buildingsTab = directory.getSheetByName(setting_('DIRECTORY_TAB'));
  if (!buildingsTab) throw new Error('The building directory has no "' + setting_('DIRECTORY_TAB') + '" tab.');
  var orgTab = directory.getSheetByName(setting_('ORG_TAB'));
  var portal = readPlanTab_('PORTAL_ID', 'PORTAL_TAB', 'BA61 portal projects');
  var ba54 = readPlanTab_('BA54_ID', 'BA54_TAB', 'BA54 tracker projects', 'Dashboard');
  var rwa = readPlanTab_('RWA_ID', 'RWA_TAB', 'RWA dashboard projects');
  var roster = readRoster_();
  var dataset = buildDataset_(
    pipelineValues,
    buildingsTab.getDataRange().getValues(),
    orgTab ? orgTab.getDataRange().getValues() : [],
    { enterprise: setting_('ENTERPRISE'), short: setting_('ENTERPRISE_SHORT'), zone: setting_('ZONE'), generatedAt: generatedAt,
      buildingManagers: setting_('BUILDING_MANAGER_EMAILS'), projectManagers: setting_('PROJECT_MANAGER_EMAILS'),
      portalValues: portal.values, portalUrl: setting_('PORTAL_URL'), ba54Values: ba54.values, ba54Link: ba54.link, ba54Updated: ba54.asOf,
      rwaValues: rwa.values, rwaLink: rwa.link,
      rosterValues: roster.values, rosterLink: roster.link, rosterUpdated: roster.asOf,
      portalOff: !!portal.off, ba54Off: !!ba54.off, rwaOff: !!rwa.off, rosterOff: !!roster.off,
      readErrors: { portal: portal.error || '', ba54: ba54.error || '', rwa: rwa.error || '', roster: roster.error || '' },
      pipelineLink: 'https://docs.google.com/spreadsheets/d/' + setting_('PIPELINE_ID') + '/edit', directoryLink: 'https://docs.google.com/spreadsheets/d/' + setting_('DIRECTORY_ID') + '/edit',
      nameEmails: setting_('NAME_EMAILS') }
  );
  try {
    applyOrgCodes_(dataset, orgCodesFor_(Object.keys(dataset.people).filter(function (k) { return k.indexOf('@') !== -1; })));
  } catch (e) {
    // Teams still come from the building contacts; only org codes are missing.
    console.warn('Org codes not read from the directory: ' + e);
  }
  try {
    var history = readHistory_();
    if (history !== false) writeHistory_(updateHistory_(dataset, history, todayIso_()));
  } catch (e) {
    // Days in stage are missing this time; the history itself is kept for the next refresh.
    console.warn('Stage history not updated: ' + e);
  }
  dataset.buildSeconds = Math.round((Date.now() - started) / 100) / 10;
  var json = JSON.stringify(dataset);
  lastPacked_ = packDataset_(dataset);
  var packedJson = JSON.stringify(lastPacked_);
  writeCachedJson_(packedJson);
  try { writeSavedSnapshot_(packedJson); } catch (e) { console.warn('Could not save the snapshot copy: ' + e); }
  try {
    PropertiesService.getScriptProperties().setProperty('LAST_REFRESH', JSON.stringify({
      at: dataset.builtAt, generatedAt: generatedAt, prs: dataset.prs.length, seconds: dataset.buildSeconds
    }));
  } catch (e) { console.warn('Could not record the refresh: ' + e); }
  console.log('Built the ' + dataset.scopeLabel + ' snapshot: ' + dataset.prs.length + ' PRs in ' + dataset.buildSeconds + ' s.');
  return json;
}

/**
 * A tab of one of the planning sheets (the BA61 portal, the BA54 tracker, the RWA dashboard): { values, link, asOf }, or
 * no values when its ID setting is OFF. A sheet that can't be read leaves its projects out for
 * this build instead of failing it.
 */
/**
 * The GSA-Wide Roster's who-reports-to-whom, and nothing else: only its employee email and
 * supervisor email columns are read (it also holds pay and other personal details), plus the
 * snapshot date of its first row.
 * @return {{ values: Array[], link: string, asOf: string, off?: boolean, error?: string }}
 *   values: [['email', 'supervisor'], ...].
 */
function readRoster_() {
  var id = setting_('ROSTER_ID');
  if (!id || /^(off|none|no)$/i.test(id)) return { values: [], link: '', asOf: '', off: true };
  try {
    var ss = SpreadsheetApp.openById(id);
    var tab = ss.getSheetByName(setting_('ROSTER_TAB'));
    if (!tab) throw new Error('no "' + setting_('ROSTER_TAB') + '" tab');
    var header = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0].map(str_);
    var col = function (name) { var i = header.indexOf(name); if (i === -1) throw new Error('no "' + name + '" column'); return i + 1; };
    [ROSTER_HEADERS.email, ROSTER_HEADERS.supervisor].forEach(col);
    var n = tab.getLastRow() - 1;
    if (n < 1) return { values: [['email', 'supervisor']], link: '', asOf: '' };
    var read = function (name) { return tab.getRange(2, col(name), n, 1).getValues().map(function (r) { return r[0]; }); };
    var emails = read(ROSTER_HEADERS.email), sups = read(ROSTER_HEADERS.supervisor);
    var asOf = '';
    if (header.indexOf(ROSTER_HEADERS.snapshot) !== -1) {
      var d = tab.getRange(2, col(ROSTER_HEADERS.snapshot), 1, 1).getValues()[0][0];
      if (isDateValue_(d)) { var noon = new Date(d.getTime() + 12 * 3600 * 1000); asOf = noon.getFullYear() + '-' + pad2_(noon.getMonth() + 1) + '-' + pad2_(noon.getDate()); }
      else asOf = str_(d).slice(0, 10);
    }
    var values = [['email', 'supervisor']];
    for (var i = 0; i < n; i++) values.push([emails[i], sups[i]]);
    return { values: values, link: 'https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=' + (tab.getSheetId ? tab.getSheetId() : ''), asOf: asOf };
  } catch (e) {
    console.warn('GSA-Wide Roster not read: ' + e);
    return { values: [], link: '', asOf: '', error: String(e && e.message || e) };
  }
}

function readPlanTab_(idKey, tabKey, what, asOfTab) {
  var id = setting_(idKey);
  if (!id || /^(off|none|no)$/i.test(id)) return { values: [], link: '', asOf: '', off: true };
  try {
    var ss = SpreadsheetApp.openById(id);
    var tab = ss.getSheetByName(setting_(tabKey));
    if (!tab) throw new Error('no "' + setting_(tabKey) + '" tab');
    var gid = tab.getSheetId ? tab.getSheetId() : '';
    var asOf = '';
    var dash = asOfTab && ss.getSheetByName(asOfTab);
    if (dash) asOf = asOfDate_(dash.getRange(1, 1, 12, 16).getValues());
    return { values: tab.getDataRange().getValues(), link: 'https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=' + gid, asOf: asOf };
  } catch (e) {
    console.warn(what + ' not read: ' + e);
    return { values: [], link: '', asOf: '', error: String(e && e.message || e) };
  }
}

/** The date after an "… as of" label in a sheet's top rows ("Obligation Data As of | 10/30/2026"), as yyyy-mm-dd. */
function asOfDate_(values) {
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length - 1; c++) {
      if (!/\bas of\b/i.test(str_(values[r][c]))) continue;
      for (var k = c + 1; k < values[r].length; k++) {
        if (!isDateValue_(values[r][k])) continue;
        // A date-only cell is midnight in the sheet's time zone; noon of it is the same day anywhere in the US.
        var d = new Date(values[r][k].getTime() + 12 * 3600 * 1000);
        return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
      }
    }
  }
  return '';
}

function cacheSeconds_() {
  var minutes = parseInt(setting_('CACHE_MINUTES'), 10);
  if (!isFinite(minutes) || minutes < 1) minutes = 360;
  return Math.min(21600, minutes * 60);
}

function readCachedJson_() {
  var cache = CacheService.getScriptCache();
  var head = cache.get(CACHE_PREFIX + 'n');
  if (!head) return null;
  var n = parseInt(head, 10);
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(CACHE_PREFIX + i);
  var parts = cache.getAll(keys);
  var out = '';
  for (var j = 0; j < n; j++) {
    if (typeof parts[CACHE_PREFIX + j] !== 'string') return null;
    out += parts[CACHE_PREFIX + j];
  }
  return out;
}

function writeCachedJson_(json) {
  var cache = CacheService.getScriptCache();
  var values = {};
  var n = 0;
  for (var i = 0; i < json.length; i += CACHE_CHUNK) values[CACHE_PREFIX + (n++)] = json.slice(i, i + CACHE_CHUNK);
  values[CACHE_PREFIX + 'n'] = String(n);
  try {
    cache.putAll(values, cacheSeconds_());
  } catch (e) {
    // Too large for the cache: every load rebuilds, which is slower but still correct.
    console.warn('Could not cache the snapshot (' + json.length + ' characters): ' + e);
    cache.remove(CACHE_PREFIX + 'n');
  }
}

/** Who is looking: their email, and the field offices / service centers they lead. */
function currentUser_(dataset) {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { email = ''; }
  var owner = '';
  try { owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { owner = ''; }
  var admins = parseEmailList_(setting_('ADMIN_EMAILS'));
  var user = { email: email, name: email ? nameFromEmail_(email) : '', isAdmin: !!email && (email === owner || admins.indexOf(email) !== -1), manages: [], directs: [],
    orgCode: '', orgOffice: '', orgSc: '' };
  if (dataset && email) {
    dataset.offices.forEach(function (o) { if (o.manager === email) user.manages.push(o.name); });
    dataset.serviceCenters.forEach(function (s) { if (s.director === email) user.directs.push(s.name); });
    var profile = directoryProfile_(email);
    var place = placeForOrgCode_(profile.orgCode, dataset);
    if (profile.name) user.name = profile.name;
    user.orgCode = profile.orgCode;
    user.orgOffice = place.office;
    user.orgSc = place.sc;
  }
  user.portfolio = portfolio_(user, dataset, setting_('LEADERS'));
  user.leader = !!user.portfolio;
  return user;
}

/**
 * What a leader is over, for Needs attention: the offices they manage, the service centers they
 * direct, and the places, people and org codes listed for them in LEADERS (a supervisor's project
 * managers). Admins are over every place.
 * @return {Object|null} { all, offices, serviceCenters, zones, enterprises, people, orgCodes, label, team },
 *   null for anyone else. label names the places; team is true when people or org codes are listed.
 */
function portfolio_(user, dataset, leaders) {
  var out = { all: !!user.isAdmin, offices: (user.manages || []).slice(), serviceCenters: (user.directs || []).slice(), zones: [], enterprises: [], people: [], orgCodes: [], reports: 0 };
  // Everyone under them in the GSA-Wide Roster (at any depth) who is named on a project.
  if (user.email) teamUnder_(user.email, dataset).forEach(function (e) { out.people.push(e); out.reports++; });
  if (user.email) leaderPlaces_(leaders, dataset).forEach(function (e) {
    if (e.email !== user.email) return;
    e.places.forEach(function (pl) {
      if (pl.all) out.all = true;
      else if (out[pl.kind].indexOf(pl.name) === -1) out[pl.kind].push(pl.name);
    });
  });
  var names = [].concat(out.enterprises.map(function (n) {
    var e = ((dataset && dataset.enterprises) || []).filter(function (x) { return x.name === n; })[0];
    return e && e.short ? e.short : n;
  }), out.zones.map(function (z) { return 'Zone ' + z; }), out.serviceCenters.map(function (n) { return n.replace(/ Service Center$/, ''); }),
    out.offices.map(function (n) {
      var o = ((dataset && dataset.offices) || []).filter(function (x) { return x.name === n; })[0];
      return o && o.short ? o.short : n.replace(/ Field Office$/, '');
    }));
  out.team = out.people.length > 0 || out.orgCodes.length > 0;
  if (!out.all && !names.length && !out.team) return null;
  out.label = out.all ? '' : names.length > 2 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join(' and ');
  return out;
}

/** The people named on projects who report to this person in the GSA-Wide Roster, directly or through others. */
function teamUnder_(email, dataset) {
  var up = (dataset && dataset.reportsTo) || {};
  var named = (dataset && dataset.people) || {};
  return Object.keys(named).filter(function (e) {
    if (e === email) return false;
    for (var s = up[e], n = 0; s && n < 25; s = up[s], n++) if (s === email) return true;
    return false;
  });
}

/**
 * LEADERS ("email = Zone 5, NEH; email = pm@gsa.gov, PMCGCA; email = All") as
 * [{ email, places: [{ kind, name } | { all }] }]: kind is enterprises, zones, serviceCenters,
 * offices, people (an email) or orgCodes (a team's org code, and every code under it). Unknown
 * places are skipped.
 */
function leaderPlaces_(text, dataset) {
  var out = [];
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ (service center|field office)$/, ''); };
  var zones = (dataset && dataset.zones) || null;
  var lists = {
    enterprises: ((dataset && dataset.enterprises) || []).map(function (e) { return { name: e.name, keys: [norm(e.name), norm(e.short)] }; }),
    serviceCenters: ((dataset && dataset.serviceCenters) || []).map(function (s) { return { name: s.name, keys: [norm(s.name), norm(s.short)] }; }),
    offices: ((dataset && dataset.offices) || []).map(function (o) { return { name: o.name, keys: [norm(o.name), norm(o.short)] }; })
  };
  String(text || '').split(/[;\r\n]+/).forEach(function (entry) {
    var m = entry.match(/^\s*([^=\s]+@[^=\s]+)\s*=\s*(.+)$/);
    if (!m) { if (entry.trim()) console.warn('LEADERS: could not read "' + entry.trim() + '"'); return; }
    var places = [];
    m[2].split(',').forEach(function (raw) {
      var key = norm(raw);
      if (!key) return;
      if (raw.indexOf('@') !== -1) { places.push({ kind: 'people', name: raw.trim().toLowerCase() }); return; }
      if (/^(all|national|nationwide|the whole country)$/.test(key)) { places.push({ all: true }); return; }
      var zone = key.match(/^zone ?(\d+)$/);
      if (zone) {
        var z = String(parseInt(zone[1], 10));
        if (zones && zones.indexOf(z) === -1) console.warn('LEADERS: there is no Zone ' + z + ' here');
        else places.push({ kind: 'zones', name: z });
        return;
      }
      var found = null;
      ['enterprises', 'serviceCenters', 'offices'].some(function (kind) {
        var hit = lists[kind].filter(function (x) { return x.keys.indexOf(key) !== -1; })[0];
        if (hit) found = { kind: kind, name: hit.name };
        return !!hit;
      });
      // Not a place: one word starting with P (PBS: PMCGCA) is a team's org code.
      if (!found && /^p[a-z0-9]{1,11}$/.test(key)) {
        found = { kind: 'orgCodes', name: key.toUpperCase() };
        console.log('LEADERS: ' + m[1] + ' leads org code ' + found.name + ' (and every code under it)');
      }
      if (found) places.push(found); else console.warn('LEADERS: no place called "' + raw.trim() + '"');
    });
    out.push({ email: m[1].toLowerCase(), places: places });
  });
  return out;
}
