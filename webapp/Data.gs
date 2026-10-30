/**
 * Reading the source sheets and keeping a built snapshot in the script cache, so
 * page loads don't re-read 10,000 pipeline rows. The sheets are only ever read.
 *
 *   loadPacked_()        { meta, gz }: the snapshot gzipped (base64) plus the few fields the
 *                        server needs itself; what the page downloads (built on a cache miss)
 *   loadDataset_()       the snapshot as JSON text, for setup and editor checks
 *   refreshDataset_()    rebuild now (daily trigger, and the Refresh button)
 *
 * The whole-NEH snapshot is about 5 MB of JSON; gzipped it is about a tenth of that, so it
 * fits the cache comfortably and the page loads quickly.
 */

// Bump DATASET_VERSION whenever the snapshot's shape changes: the new code then rebuilds instead
// of reading a snapshot the old code saved (the cache keeps one for up to 6 hours).
var DATASET_VERSION = 4;
var CACHE_PREFIX = 'wltds:v' + DATASET_VERSION + ':';
// Cache values are capped at 100 KB (bytes); 45,000 characters stays under it even with accented names.
var CACHE_CHUNK = 45000;

function loadPacked_() {
  var cached = readCachedJson_();
  if (cached) return JSON.parse(cached);
  var json = refreshDataset_();
  return packDataset_(JSON.parse(json), json);
}

function loadDataset_() {
  return gunzipText_(loadPacked_().gz);
}

/** What the cache holds: the gzipped snapshot and the parts the server reads (who is signed in). */
function packDataset_(dataset, json) {
  return {
    meta: { offices: dataset.offices, serviceCenters: dataset.serviceCenters, zones: dataset.zones, scopeLabel: dataset.scopeLabel, prs: dataset.prs.length },
    gz: gzipText_(json || JSON.stringify(dataset))
  };
}

function gzipText_(text) {
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text, 'application/json')).getBytes());
}

function gunzipText_(base64) {
  return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(base64), 'application/x-gzip')).getDataAsString();
}

/** Reads both sheets, builds the dataset and caches it. Returns the dataset JSON (a string). */
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
  var dataset = buildDataset_(
    pipelineValues,
    buildingsTab.getDataRange().getValues(),
    orgTab ? orgTab.getDataRange().getValues() : [],
    { enterprise: setting_('ENTERPRISE'), short: setting_('ENTERPRISE_SHORT'), zone: setting_('ZONE'), generatedAt: generatedAt,
      buildingManagers: setting_('BUILDING_MANAGER_EMAILS'), projectManagers: setting_('PROJECT_MANAGER_EMAILS') }
  );
  try {
    applyOrgCodes_(dataset, orgCodesFor_(Object.keys(dataset.people)));
  } catch (e) {
    // Teams still come from the building contacts; only org codes are missing.
    console.warn('Org codes not read from the directory: ' + e);
  }
  dataset.buildSeconds = Math.round((Date.now() - started) / 100) / 10;
  var json = JSON.stringify(dataset);
  writeCachedJson_(JSON.stringify(packDataset_(dataset, json)));
  try {
    PropertiesService.getScriptProperties().setProperty('LAST_REFRESH', JSON.stringify({
      at: dataset.builtAt, generatedAt: generatedAt, prs: dataset.prs.length, seconds: dataset.buildSeconds
    }));
  } catch (e) { console.warn('Could not record the refresh: ' + e); }
  console.log('Built the ' + dataset.scopeLabel + ' snapshot: ' + dataset.prs.length + ' PRs in ' + dataset.buildSeconds + ' s.');
  return json;
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
