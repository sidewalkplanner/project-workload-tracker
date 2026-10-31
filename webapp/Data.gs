/**
 * Reading the source sheets and keeping a built snapshot in the script cache, so
 * page loads don't re-read 10,000 pipeline rows. The sheets are only ever read.
 *
 *   loadPacked_()        { meta, gz, gzLater }: the snapshot compacted and gzipped (base64) in two parts, plus the few fields the
 *                        server needs itself; what the page downloads (built on a cache miss)
 *   loadDataset_()       the snapshot as JSON text, for setup and editor checks
 *   refreshDataset_()    rebuild now (daily trigger, and the Refresh button)
 *
 * The whole-NEH snapshot is about 5 MB of JSON; gzipped it is about a tenth of that, so it
 * fits the cache comfortably and the page loads quickly.
 */

// Bump DATASET_VERSION whenever the snapshot's shape changes: the new code then rebuilds instead
// of reading a snapshot the old code saved (the cache keeps one for up to 6 hours).
var DATASET_VERSION = 11;
var CACHE_PREFIX = 'wltds:v' + DATASET_VERSION + ':';
// Cache values are capped at 100 KB (bytes); 45,000 characters stays under it even with accented names.
var CACHE_CHUNK = 45000;

function loadPacked_() {
  var packed = cachedOrSavedPacked_();
  if (packed) return packed;
  var json = refreshDataset_();
  return packDataset_(JSON.parse(json));
}

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
  var ss = SpreadsheetApp.create('NEH Projects - saved snapshot (do not edit)');
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
  // Compacted (Compact.gs), and in two parts: the open projects the page shows first (gz), and
  // the paid-in-full projects and service contracts it fetches right after (gzLater).
  var small = compactDataset_(dataset);
  var first = [], later = [];
  dataset.prs.forEach(function (p, i) { (shownFirst_(p) ? first : later).push(small.prs[i]); });
  small.prs = first;
  small.laterCount = later.length;
  return {
    meta: { offices: dataset.offices, serviceCenters: dataset.serviceCenters, zones: dataset.zones, scopeLabel: dataset.scopeLabel, prs: dataset.prs.length },
    gz: gzipText_(JSON.stringify(small)),
    gzLater: later.length ? gzipText_(JSON.stringify(later)) : ''
  };
}

/** The whole snapshot as one dataset again (both parts, every field), for the editor and older browsers. */
function unpackDataset_(packed) {
  var data = JSON.parse(gunzipText_(packed.gz));
  var later = packed.gzLater ? JSON.parse(gunzipText_(packed.gzLater)) : [];
  data.prs = data.prs.concat(later).map(function (c) { return expandProject_(c, data); });
  data.prs.sort(function (a, b) { return a.pr < b.pr ? -1 : a.pr > b.pr ? 1 : 0; });
  delete data.laterCount;
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
  var dataset = buildDataset_(
    pipelineValues,
    buildingsTab.getDataRange().getValues(),
    orgTab ? orgTab.getDataRange().getValues() : [],
    { enterprise: setting_('ENTERPRISE'), short: setting_('ENTERPRISE_SHORT'), zone: setting_('ZONE'), generatedAt: generatedAt,
      buildingManagers: setting_('BUILDING_MANAGER_EMAILS'), projectManagers: setting_('PROJECT_MANAGER_EMAILS'),
      portalValues: portal.values, portalUrl: setting_('PORTAL_URL'), ba54Values: ba54.values, ba54Link: ba54.link, ba54Updated: ba54.asOf,
      rwaValues: rwa.values, rwaLink: rwa.link,
      portalOff: !!portal.off, ba54Off: !!ba54.off, rwaOff: !!rwa.off,
      readErrors: { portal: portal.error || '', ba54: ba54.error || '', rwa: rwa.error || '' },
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
  var packedJson = JSON.stringify(packDataset_(dataset));
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

function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
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
  return user;
}
