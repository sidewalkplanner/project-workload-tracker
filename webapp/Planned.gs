/**
 * What the BA61 portal (Portal.gs), the BA54 tracker (Ba54.gs) and the RWA dashboard (Rwa.gs)
 * have in common: projects planned or approved there with no PR in EASi yet, added to the
 * dataset as records with a source ('portal', 'ba54' or 'rwa') and one of the "planned" stages. Their money is the plan's
 * budget or cost (an estimate), kept apart from what EASi has committed. Those sheets give
 * people as names; plannedPeople_ turns a name into the person's email when only one person
 * fits.
 *
 * Pure functions, so the tests run them in Node.
 */

/** Short first names people write for a COR, to find their email ("Bobby Sells" -> robert.sells). */
var NICKNAMES = {
  bob: 'robert', bobby: 'robert', rob: 'robert', robbie: 'robert', bill: 'william', billy: 'william', will: 'william',
  jim: 'james', jimmy: 'james', jamie: 'james', mike: 'michael', mick: 'michael', tom: 'thomas', tommy: 'thomas',
  dave: 'david', dan: 'daniel', danny: 'daniel', chris: 'christopher', joe: 'joseph', joey: 'joseph',
  steve: 'steven', tony: 'anthony', rick: 'richard', rich: 'richard', dick: 'richard', matt: 'matthew',
  nick: 'nicholas', kate: 'katherine', katie: 'katherine', kathy: 'kathleen', liz: 'elizabeth', beth: 'elizabeth',
  jen: 'jennifer', jenny: 'jennifer', sam: 'samuel', ben: 'benjamin', ed: 'edward', eddie: 'edward',
  greg: 'gregory', jeff: 'jeffrey', ken: 'kenneth', larry: 'lawrence', pat: 'patrick', ron: 'ronald',
  tim: 'timothy', andy: 'andrew', drew: 'andrew', alex: 'alexander', don: 'donald', doug: 'douglas',
  jon: 'jonathan', jack: 'john', nate: 'nathan', josh: 'joshua', kim: 'kimberly', deb: 'deborah', debbie: 'deborah', sue: 'susan',
  terry: 'terrence', zach: 'zachary', fred: 'frederick', gene: 'eugene', jerry: 'gerald', phil: 'phillip',
  ray: 'raymond', randy: 'randall', russ: 'russell', stan: 'stanley', vince: 'vincent', walt: 'walter', cindy: 'cynthia',
  barb: 'barbara', peggy: 'margaret', maggie: 'margaret', meg: 'margaret', becky: 'rebecca', vicky: 'victoria'
};

/**
 * Turns names written in the plans into people: an email, or 'name:…' kept as written.
 * @param {string[]} emails  Everyone the tracker knows.
 * @param {string}   aliases Script property NAME_EMAILS: "Name = email; Name = email" for names
 *                           the matching can't work out (someone whose name changed but email didn't).
 */
function plannedPeople_(emails, aliases) {
  var index = personIndex_(emails);
  var fixed = nameAliases_(aliases);
  var names = {};
  var one = function (text) {
    text = str_(text);
    if (!text || /^(unknown|tbd|n\/?a|none|-+)$/i.test(text)) return '';
    var email = parseEmailList_(text)[0] || fixed[normName_(text)] || index.find(text);
    if (email) return email;
    var key = 'name:' + normName_(text);
    if (key === 'name:') return '';
    names[key] = text.replace(/\s+/g, ' ');
    return key;
  };
  return {
    names: names,
    /**
     * The people a cell names: [] for a blank, unknown or "TBD". "A / B", "A & B" and "A and B"
     * are two people; notes in parentheses and after " - " are dropped ("Todd Wright (design)",
     * "Thomas Woods - GSA"). When one of them is marked COR, only they count: the COR is the
     * project's manager.
     */
    find: function (text) {
      var parts = str_(text).split(/\s*(?:\/|&|\+|;|,|\band\b|\bor\b)\s*/i).filter(function (t) { return t.trim(); });
      var cor = parts.filter(function (t) { return /\(\s*cor\s*\)/i.test(t); });
      return uniqueList_((cor.length ? cor : parts).map(function (t) {
        return one(t.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, ''));
      }).filter(Boolean));
    }
  };
}

/** A planned project's place: its buildings in the directory, else its field office by name. null when not in scope. */
function plannedPlace_(buildings, officeName, directory) {
  var place = placeOf_(buildings, '', '', directory);
  if (!place.offices.length) {
    var office = directory.officeByName[str_(officeName)];
    if (office) place = { buildings: place.buildings, offices: [office.name], serviceCenters: [office.serviceCenter], zones: [office.zone] };
  }
  return place.offices.length ? place : null;
}

/**
 * A full project record for a planned project, with every field the page reads.
 * @param {Object} f  { source, sourceLabel, pr, title, link, fy, program, stage, planStatus, estimate, cor, requestor, co, place, details: [[label, value]], portalNumbers, projectCodes }
 */
/** The EASi fields a planned project doesn't have: left out of the snapshot to keep it small, filled in by the page. */
var PLANNED_DEFAULTS = {
  values: {
    programFromTitle: false, prStatus: '', acquisitionStatus: '', awardStatus: '', solicitationStatus: '', awardNumber: '', awardType: '',
    vendor: '', category: '', procurementCategory: '', committed: 0, obligated: 0, expended: 0, reserved: 0, remaining: 0, executed: '',
    state: '', officeCode: '', comments: '', placeNote: '', service: '', units: 1
  },
  lists: ['reviewers', 'requestor', 'co', 'cs', 'assigned', 'programManager', 'buildingManager', 'projectCodes', 'rwas', 'portalNumbers', 'subprojects', 'plans', 'details']
};

function plannedRecord_(f) {
  var place = f.place;
  var p = {
    source: f.source,
    sourceLabel: f.sourceLabel,
    pr: f.pr,
    title: str_(f.title) || '(no title)',
    link: f.link || '',
    fy: f.fy || null,
    programs: [f.program],
    planStatus: str_(f.planStatus),
    details: (f.details || []).filter(function (d) { return str_(d[1]) !== ''; }),
    estimate: f.estimate || 0,
    cor: f.cor || [],
    buildings: place.buildings.map(function (b) { return b.number; }),
    buildingNames: place.buildings.map(function (b) { return b.name + (b.city ? ' · ' + b.city + ', ' + b.state : ''); }),
    offices: place.offices,
    serviceCenters: place.serviceCenters,
    zones: place.zones,
    stage: f.stage
  };
  if (f.requestor && f.requestor.length) p.requestor = f.requestor;
  if (f.co && f.co.length) p.co = f.co;
  if (f.projectCodes && f.projectCodes.length) p.projectCodes = f.projectCodes;
  if (f.portalNumbers && f.portalNumbers.length) p.portalNumbers = f.portalNumbers;
  if (!place.buildings.length) p.placeNote = 'plan-office';
  // When the current stage began, if the plan says (History.gs uses it the first time it sees the project).
  if (f.seedDate) p.seedDate = f.seedDate;
  // The plan's own target (a commitment month, a PR routing month, a planned award), for Needs attention.
  if (f.dueBy) { p.dueBy = f.dueBy; p.dueWhat = f.dueWhat; }
  if (f.fundsClose) p.fundsClose = f.fundsClose;
  // Snow removal, custodial and the like are service contracts here too.
  var service = serviceReason_({ title: p.title, procurementCategory: '', category: '' });
  if (service) p.service = service;
  var managers = [];
  place.buildings.forEach(function (b) {
    b.manager.forEach(function (e) { if (managers.indexOf(e) === -1) managers.push(e); });
  });
  if (managers.length) p.buildingManager = managers;
  p.lead = p.cor.length ? p.cor.slice() : (p.requestor || []).slice();
  return p;
}

var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * A plan's target written as a month ("October") in a fiscal year, or as a date, as the
 * last day it can happen ('yyyy-mm-dd'; '' when there is none). FY27 runs Oct 2026 to Sep 2027.
 */
function planDueDate_(value, fy) {
  if (isDateValue_(value) || /^\d{4}-\d{2}-\d{2}/.test(str_(value))) return pipelineDate_(value);
  var m = MONTHS.map(function (x) { return x.slice(0, 3); }).indexOf(str_(value).toLowerCase().slice(0, 3));
  if (m === -1 || !fy) return '';
  var year = m >= 9 ? fy - 1 : fy;
  var last = new Date(Date.UTC(year, m + 1, 0));
  return last.toISOString().slice(0, 10);
}

/** "FY27", 2027, "2027.0" -> 2027 */
function planFiscalYear_(value) {
  var m = /(\d{2,4})(?:\.0+)?\s*$/.exec(str_(value));
  if (!m) return null;
  var n = parseInt(m[1], 10);
  return n < 100 ? 2000 + n : fiscalYear_(n);
}

/** Every email in some columns of a sheet's rows (for name matching). */
function emailsIn_(values, cols) {
  var out = [];
  (values || []).forEach(function (row, i) {
    if (i === 0) return;
    cols.forEach(function (c) { if (c !== -1 && c !== undefined) out = out.concat(parseEmailList_(row[c])); });
  });
  return out;
}

/** "Jane Doe = jane.smith@gsa.gov; ..." -> { 'jane doe': 'jane.smith@gsa.gov' } (lines or semicolons). */
function nameAliases_(text) {
  var out = {};
  str_(text).split(/[;\n]+/).forEach(function (pair) {
    var m = /^(.*?)[=:]\s*(\S+@\S+)\s*$/.exec(pair.trim());
    var email = m && parseEmailList_(m[2])[0];
    if (email && normName_(m[1])) out[normName_(m[1])] = email;
  });
  return out;
}

/** "Christopher O'Neill" / "christopher.oneill" -> "christopher oneill" (no middle initials, suffixes or accents). */
function normName_(text) {
  var s = str_(text).toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.replace(/['’.]/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ')
    .filter(function (w, i, all) { return w && !(i > 0 && i < all.length - 1 && w.length === 1) && !/^(jr|sr|ii|iii|iv)$/.test(w); })
    .join(' ');
}

/**
 * Finds a person's email from a name as people write it, when only one person fits: full name,
 * nickname, a shortened first name ("Jena Richter" -> jennifer.richter), or the first name with a
 * one-letter slip in the last name ("Shelly Baxer" -> shelly.baxter).
 */
function personIndex_(emails) {
  var full = {}, initial = {}, byFirst = {};  // initial: last name -> [{ first, email }]
  var add = function (map, key, email) { map[key] = map[key] || []; if (map[key].indexOf(email) === -1) map[key].push(email); };
  // One address per person: a mistyped domain (india.stewart@gsa.com) doesn't make the name ambiguous.
  var seen = {};
  uniqueList_(emails).sort(function (a, b) { return (/@gsa\.gov$/.test(b) ? 1 : 0) - (/@gsa\.gov$/.test(a) ? 1 : 0); }).forEach(function (email) {
    var local = email.split('@')[0];
    if (seen[local]) return;
    seen[local] = true;
    var words = normName_(nameFromEmail_(email)).split(' ');
    if (words.length < 2) return;
    // Each later word can be the last name people write: luis.ramirez-figueroa is also "Luis Ramirez".
    words.slice(1).forEach(function (last) {
      add(full, words[0] + ' ' + last, email);
      (initial[last] = initial[last] || []).push({ first: words[0], email: email });
      (byFirst[words[0]] = byFirst[words[0]] || []).push({ last: last, email: email });
    });
  });
  var only = function (list) { return list && list.length === 1 ? list[0] : ''; };
  return {
    find: function (name) {
      var words = normName_(name).split(' ');
      if (words.length < 2) return '';
      var first = words[0], last = words[words.length - 1];
      var hit = full[first + ' ' + last];
      if (hit) return only(hit);
      // "Danielle Sackie-Mensah Fair": any of the later words can be the last name in the email.
      for (var w = words.length - 2; w > 0; w--) if (only(full[first + ' ' + words[w]])) return only(full[first + ' ' + words[w]]);
      if (NICKNAMES[first] && full[NICKNAMES[first] + ' ' + last]) return only(full[NICKNAMES[first] + ' ' + last]);
      // A shortened first name: "Jena" for Jennifer, "Cat" for Catherine, "Taz" for Temesgen; but a
      // nickname of someone else's name doesn't count ("Bob" is Robert, so not brian.green).
      var shortened = [];
      (initial[last] || []).forEach(function (c) {
        var fits = sameStart_(first, c.first) || (!NICKNAMES[first] && first.charAt(0) === c.first.charAt(0));
        if (fits && shortened.indexOf(c.email) === -1) shortened.push(c.email);
      });
      hit = only(shortened);
      if (hit || last.length < 4) return hit;
      // A slip in the last name that keeps its first letter: "Baxer" for Baxter (not "Muller" for Fuller).
      var near = [];
      [first, NICKNAMES[first]].forEach(function (f) {
        (f && byFirst[f] || []).forEach(function (c) {
          if (c.last.charAt(0) === last.charAt(0) && oneEditApart_(c.last, last) && near.indexOf(c.email) === -1) near.push(c.email);
        });
      });
      return only(near);
    }
  };
}

/** "jena" / "jennifer", "cat" / "catherine", "chanel" / "chanelsophia": one is the other's start, or they share the first two letters. */
function sameStart_(a, b) {
  return a.length > 1 && b.length > 1 && (a.slice(0, 2) === b.slice(0, 2) || a.indexOf(b) === 0 || b.indexOf(a) === 0);
}

/** True when two words differ by one letter added, dropped, changed or swapped with its neighbor. */
function oneEditApart_(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  var i = 0;
  while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) || (a.charAt(i) === b.charAt(i + 1) && a.charAt(i + 1) === b.charAt(i) && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
