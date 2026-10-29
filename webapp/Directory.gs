/**
 * Who the signed-in person is in the GSA directory, so the page can open on their own
 * field office, the same way the NEH BA61 Project Portal does. GSA display names end in
 * the person's org code ("Robert Sells - PMCGC"); PMCGC is the OFM Dept ID of the
 * Denver Federal Center Field Office in the OFM Building Assignments sheet, and PMCG
 * its service center. Uses the People API advanced service; without it everyone simply
 * opens on the whole zone (Field Office Managers and Directors still get their own).
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

/** The zone's field office or service center for an org code: PMCGC -> office, PMCG -> service center. */
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
      ', opens on ' + (place.office || place.sc || 'all of Zone ' + dataset.zone));
  });
  var msg = lines.join('\n');
  console.log(msg);
  return msg;
}
