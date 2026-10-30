/**
 * Who the signed-in person is in the GSA directory, so the page can open on their own
 * field office, the same way the NEH BA61 Project Portal does. GSA display names end in
 * the person's org code ("Robert Sells - PMCGC"); PMCGC is the OFM Dept ID of the
 * Denver Federal Center Field Office in the OFM Building Assignments sheet, and PMCG
 * its service center. Uses the People API advanced service; without it everyone simply
 * opens on the whole enterprise (Field Office Managers and Directors still get their own).
 */

// Facilities codes ("PMCGC") are recognised after any separator, other codes only after
// an explicit one ("Jane Doe - BCB"), so a capitalised surname is never taken for a code.
var PM_CODE_RE = /(?:^|[\s\-–—(|,\/])(PM[A-Z][A-Z0-9]{0,6})\)?\s*$/;
var OTHER_CODE_RE = /\s[\-–—|(]\s*([A-Z][A-Z0-9]{1,7})\)?\s*$/;

/** "Robert Sells - PMCGC" -> "PMCGC"; "Jane Doe - BCB" -> "BCB" */
function parseOrgCode_(displayName) {
  var name = str_(displayName);
  var m = name.match(PM_CODE_RE) || name.match(OTHER_CODE_RE);
  return m ? m[1] : '';
}

/** "Robert Sells - PMCGC" -> "Robert Sells" */
function cleanDisplayName_(displayName) {
  var name = str_(displayName);
  var m = name.match(PM_CODE_RE) || name.match(OTHER_CODE_RE);
  return (m ? name.slice(0, m.index) : name).replace(/[\s\-–—|(,\/]+$/, '').trim();
}

/** { displayName, name, orgCode } from the Workspace directory, cached for 6 hours. */
function directoryProfile_(email, skipCache) {
  var key = 'profile:v1:' + email;
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = skipCache ? null : cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var displayName = '';
  try {
    if (typeof People !== 'undefined' && People.People && People.People.searchDirectoryPeople) {
      var res = People.People.searchDirectoryPeople({
        query: email, readMask: 'names,emailAddresses', sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'], pageSize: 5
      });
      (res && res.people || []).some(function (person) {
        var emails = (person.emailAddresses || []).map(function (e) { return str_(e.value).toLowerCase(); });
        if (emails.indexOf(email) === -1) return false;
        displayName = person.names && person.names[0] ? person.names[0].displayName : '';
        return true;
      });
    }
  } catch (e) {
    console.warn('People directory lookup failed for ' + email + ': ' + e);
  }
  var profile = { displayName: displayName, name: cleanDisplayName_(displayName), orgCode: parseOrgCode_(displayName) };
  try { if (cache) cache.put(key, JSON.stringify(profile), 21600); } catch (e) { /* ignore */ }
  return profile;
}

/** The field office or service center in scope for an org code: PMCGC -> office, PMCG -> service center. */
function placeForOrgCode_(code, dataset) {
  var c = str_(code).toUpperCase();
  var out = { office: '', sc: '' };
  if (!c || c.indexOf('PM') !== 0 || !dataset) return out;
  dataset.offices.some(function (o) {
    if (o.code && c.length >= o.code.length && c.slice(0, o.code.length) === o.code) { out.office = o.name; out.sc = o.serviceCenter; return true; }
    return false;
  });
  if (!out.office) {
    dataset.serviceCenters.some(function (s) {
      if (s.code && c.slice(0, s.code.length) === s.code) { out.sc = s.name; return true; }
      return false;
    });
  }
  return out;
}

/**
 * Editor check: logs the display name, org code and starting office the tracker finds for
 * you (and any emails passed in). Run it from the Apps Script editor.
 */
function checkDirectoryLookup(emails) {
  var dataset = JSON.parse(loadDataset_());
  var list = [String(Session.getEffectiveUser().getEmail() || '').toLowerCase()].concat(parseEmailList_(emails || ''));
  var lines = ['People API service: ' + (typeof People !== 'undefined' ? 'available' : 'NOT ADDED (Services + > People API)')];
  list.forEach(function (email) {
    var p = directoryProfile_(email, true);
    var place = placeForOrgCode_(p.orgCode, dataset);
    lines.push(email + ' -> display name "' + (p.displayName || '(not found)') + '", org code ' + (p.orgCode || '(none)') +
      ', opens on ' + (place.office || place.sc || 'all of ' + dataset.scopeLabel));
  });
  var msg = lines.join('\n');
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------------------
// Org codes for everyone on the PRs
// ---------------------------------------------------------------------------

var ORG_PROP = 'ORG_CODES';
var ORG_PROP_CHUNK = 8000;           // Script property values are capped at 9 KB.
var ORG_SWEEP_DAYS = 7;              // Read the whole directory again after a week…
var ORG_RETRY_HOURS = 12;            // …or sooner when new people have appeared.
var ORG_SWEEP_SECONDS = 240;

/**
 * { codes: { email: org code }, names: { email: name } } for the given emails, from the
 * Workspace directory: the org code sorts people by division, and the name is how the person
 * is shown ("Robert J. Green", not "Robertj Green" from robertj.green@). The directory is
 * read in one sweep (listDirectoryPeople, 1,000 people a page) rather than one search per
 * person, which would run into the People API's per-minute limit, and the result is kept
 * in Script properties so a normal refresh makes no directory calls at all.
 */
function orgCodesFor_(emails) {
  var stored = readChunkedJson_(ORG_PROP) || { at: 0, codes: {} };
  // Sweeps saved before names were kept have none: sweep again once to get them.
  if (!stored.names) { stored.names = {}; stored.at = 0; }
  var missing = emails.filter(function (e) { return !(e in stored.codes); });
  var ageHours = (Date.now() - (stored.at || 0)) / 3600000;
  var due = ageHours > ORG_SWEEP_DAYS * 24 || (missing.length && ageHours > ORG_RETRY_HOURS);
  if (!due || typeof People === 'undefined' || !People.People || !People.People.listDirectoryPeople) return { codes: stored.codes, names: stored.names };

  var wanted = {};
  emails.forEach(function (e) { wanted[e] = true; });
  var found = {};
  var foundNames = {};
  var started = Date.now();
  var token = null;
  var complete = false;
  do {
    var res = People.People.listDirectoryPeople({
      readMask: 'names,emailAddresses', sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'], pageSize: 1000, pageToken: token || undefined
    });
    (res && res.people || []).forEach(function (person) {
      var display = person.names && person.names[0] ? person.names[0].displayName : '';
      (person.emailAddresses || []).forEach(function (a) {
        var email = str_(a.value).toLowerCase();
        if (wanted[email]) { found[email] = parseOrgCode_(display); if (cleanDisplayName_(display)) foundNames[email] = cleanDisplayName_(display); }
      });
    });
    token = res && res.nextPageToken;
    complete = !token;
  } while (token && (Date.now() - started) / 1000 < ORG_SWEEP_SECONDS);

  // Keep only people still on the PRs; '' records "looked, no code" so they aren't looked for again.
  var codes = {};
  var names = {};
  emails.forEach(function (e) {
    codes[e] = e in found ? found[e] : (complete ? '' : stored.codes[e]);
    var name = foundNames[e] || (complete ? '' : stored.names[e]);
    if (name) names[e] = name;
  });
  Object.keys(codes).forEach(function (e) { if (codes[e] === undefined) delete codes[e]; });
  writeChunkedJson_(ORG_PROP, { at: complete ? Date.now() : stored.at, codes: codes, names: names });
  console.log('Directory sweep: org codes for ' + Object.keys(found).filter(function (e) { return found[e]; }).length + ' of ' + emails.length + ' people' + (complete ? '.' : ' (stopped early; continues next refresh).'));
  return { codes: codes, names: names };
}

function readChunkedJson_(key) {
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty(key + '_N') || '0', 10);
  if (!n) return null;
  var text = '';
  for (var i = 0; i < n; i++) text += props.getProperty(key + '_' + i) || '';
  try { return JSON.parse(text); } catch (e) { return null; }
}

function writeChunkedJson_(key, value) {
  var props = PropertiesService.getScriptProperties();
  var text = JSON.stringify(value);
  var values = {};
  var n = 0;
  for (var i = 0; i < text.length; i += ORG_PROP_CHUNK) values[key + '_' + (n++)] = text.slice(i, i + ORG_PROP_CHUNK);
  values[key + '_N'] = String(n);
  props.setProperties(values);
}
