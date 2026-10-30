/**
 * BA61 projects that are planned or approved in the NEH BA61 Project Portal but have no PR
 * in EASi yet. The portal's Projects tab (its data sheet, Script property BA61_PORTAL_ID)
 * is only read.
 *
 * A portal project is in EASi when a PR's number is its EQ number, or a PR's title or
 * comments carry its portal number (RM0024-092426): the same rule the portal's own EASi
 * sync uses. Planning, Pending Approval, Approved and Emergency NTP projects without such
 * a PR are added to the dataset as records with source: 'portal' and one of the "planned"
 * stages; their money is the portal's budgeted amount (an estimate), kept apart from what
 * EASi has committed.
 *
 * Pure functions, so the tests run them in Node.
 */

/** Portal columns the tracker reads, by header name. */
var PORTAL_HEADERS = {
  number: 'Project Number', status: 'Status', requestType: 'Request Type', fiscalYear: 'Fiscal Year',
  office: 'Field Office', buildings: 'Building Number(s)', description: 'Project Description',
  priority: 'Priority', spendCategory: 'Spend Category', budget: 'Budgeted Amount', commitmentMonth: 'Commitment Month',
  cor: 'COR', eqNumber: 'EQ Number', requester: 'Requester Email', otherEmails: 'Additional POC Emails',
  submittedAt: 'Submitted For Approval At', decidedAt: 'Decided At', createdAt: 'Created At'
};

/** Portal status -> the tracker's stage. Denied and Cancelled projects are left out. */
var PORTAL_STAGES = {
  'Planning': 'planning',
  'Pending Approval': 'pending',
  'Approved': 'noPr',
  'Emergency NTP': 'noPr'
};

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
  jon: 'jonathan', josh: 'joshua', kim: 'kimberly', deb: 'deborah', debbie: 'deborah', sue: 'susan',
  terry: 'terrence', zach: 'zachary', fred: 'frederick', gene: 'eugene', jerry: 'gerald', phil: 'phillip',
  ray: 'raymond', russ: 'russell', stan: 'stanley', vince: 'vincent', walt: 'walter', cindy: 'cynthia',
  barb: 'barbara', peggy: 'margaret', maggie: 'margaret', meg: 'margaret', becky: 'rebecca', vicky: 'victoria'
};

/**
 * What the portal adds to a dataset being built.
 * @param {Array[]} portalValues  The portal's Projects tab, header row first ([] when not read).
 * @param {Object}  inEasi        { eq: { PR number: true }, mentioned: { portal number: [PR numbers] } } from every pipeline row.
 * @param {Object}  directory     From readDirectory_.
 * @param {string[]} knownEmails  Everyone the tracker already knows (to turn COR names into emails).
 * @param {string}  portalUrl     The portal's /exec URL, for links ('' for none).
 * @param {string}  corNames      Script property PORTAL_COR_EMAILS: "Name = email; Name = email" for names
 *                                the matching can't work out (someone whose name changed but email didn't).
 * @return {{ projects: Object[], names: Object, matchedByEq: Object, counts: Object }}
 */
function portalProjects_(portalValues, inEasi, directory, knownEmails, portalUrl, corNames) {
  var out = { projects: [], names: {}, matchedByEq: {}, counts: { rows: 0, inEasi: 0, notInEasi: 0, otherZones: 0, closed: 0 } };
  if (!portalValues || portalValues.length < 2) return out;
  var col = headerIndex_(portalValues[0], PORTAL_HEADERS);
  if (col.number === -1 || col.status === -1) throw new Error('The BA61 portal data sheet has no "Project Number" and "Status" columns on its Projects tab.');

  var emails = knownEmails.slice();
  for (var r = 1; r < portalValues.length; r++) {
    if (col.requester !== -1) emails = emails.concat(parseEmailList_(portalValues[r][col.requester]));
    if (col.otherEmails !== -1) emails = emails.concat(parseEmailList_(portalValues[r][col.otherEmails]));
  }
  var index = personIndex_(emails);
  var aliases = corAliases_(corNames);

  for (var i = 1; i < portalValues.length; i++) {
    var row = portalValues[i];
    var get = function (key) { return col[key] === -1 ? '' : row[col[key]]; };
    var number = str_(get('number')).toUpperCase();
    if (!number) continue;
    out.counts.rows++;
    var stage = PORTAL_STAGES[str_(get('status'))];
    if (!stage) { out.counts.closed++; continue; }
    var eq = str_(get('eqNumber')).toUpperCase();
    var eqIsPr = !!eq && !new RegExp('^' + PORTAL_NUMBER_RE.source + '$').test(eq);
    if ((eqIsPr && inEasi.eq[eq]) || inEasi.mentioned[number]) {
      if (eqIsPr && inEasi.eq[eq]) (out.matchedByEq[eq] = out.matchedByEq[eq] || []).push(number);
      out.counts.inEasi++;
      continue;
    }

    var place = placeOf_(get('buildings'), '', '', directory);
    if (!place.offices.length) {
      var office = directory.officeByName[str_(get('office'))];
      if (office) place = { buildings: place.buildings, offices: [office.name], serviceCenters: [office.serviceCenter], zones: [office.zone], fromTitle: false, viaOrg: false, known: true };
    }
    if (!place.offices.length) { out.counts.otherZones++; continue; }

    var requester = parseEmailList_(get('requester'));
    var corText = str_(get('cor'));
    var cor = [];
    if (corText && !/^(unknown|tbd|n\/?a|none)$/i.test(corText)) {
      var corEmail = parseEmailList_(corText)[0] || aliases[normName_(corText)] || index.find(corText);
      if (corEmail) cor = [corEmail];
      else {
        // A name the tracker can't tie to an email: kept as written.
        var key = 'name:' + normName_(corText);
        out.names[key] = corText.replace(/\s+/g, ' ');
        cor = [key];
      }
    }
    var budget = money_(get('budget')) || 0;
    var p = {
      source: 'portal',
      pr: number,
      title: str_(get('description')) || '(no description)',
      link: portalUrl ? portalUrl + '?view=project&id=' + encodeURIComponent(number) : '',
      fy: portalFiscalYear_(get('fiscalYear')),
      programs: ['PG61'],
      programFromTitle: false,
      portalStatus: str_(get('status')),
      requestType: str_(get('requestType')),
      priority: str_(get('priority')),
      spendCategory: str_(get('spendCategory')),
      commitmentMonth: str_(get('commitmentMonth')),
      eqNumber: eq,
      submittedAt: pipelineDate_(get('submittedAt')),
      decidedAt: pipelineDate_(get('decidedAt')),
      createdAt: pipelineDate_(get('createdAt')),
      estimate: budget,
      prStatus: '', acquisitionStatus: '', awardStatus: '', solicitationStatus: '', reviewers: [],
      awardNumber: '', awardType: '', vendor: '', category: '', procurementCategory: '',
      committed: 0, obligated: 0, expended: 0, reserved: 0, remaining: 0, executed: '',
      cor: cor,
      requestor: requester,
      co: [], cs: [], assigned: [], programManager: [],
      buildingManager: [],
      buildings: place.buildings.map(function (b) { return b.number; }),
      buildingNames: place.buildings.map(function (b) { return b.name + (b.city ? ' · ' + b.city + ', ' + b.state : ''); }),
      offices: place.offices,
      serviceCenters: place.serviceCenters,
      zones: place.zones,
      placeNote: place.buildings.length ? '' : 'portal-office',
      state: '', officeCode: '', projectCodes: [], rwas: [],
      portalNumbers: [number],
      comments: '',
      subprojects: [],
      units: 1,
      stage: stage
    };
    // Snow removal, custodial and the like are service contracts here too.
    p.service = serviceReason_(p);
    place.buildings.forEach(function (b) {
      b.manager.forEach(function (e) { if (p.buildingManager.indexOf(e) === -1) p.buildingManager.push(e); });
    });
    p.lead = p.cor.length ? p.cor.slice() : p.requestor.slice();
    out.projects.push(p);
    out.counts.notInEasi++;
  }
  return out;
}

/** "Jane Doe = jane.smith@gsa.gov; ..." -> { 'jane doe': 'jane.smith@gsa.gov' } (lines or semicolons). */
function corAliases_(text) {
  var out = {};
  str_(text).split(/[;\n]+/).forEach(function (pair) {
    var m = /^(.*?)[=:]\s*(\S+@\S+)\s*$/.exec(pair.trim());
    var email = m && parseEmailList_(m[2])[0];
    if (email && normName_(m[1])) out[normName_(m[1])] = email;
  });
  return out;
}

/** "FY27" -> 2027 */
function portalFiscalYear_(value) {
  var m = /(\d{2,4})\s*$/.exec(str_(value));
  if (!m) return null;
  var n = parseInt(m[1], 10);
  return n < 100 ? 2000 + n : fiscalYear_(n);
}

/** "Christopher O'Neill" / "christopher.oneill" -> "christopher oneill" (no middle initials, suffixes or accents). */
function normName_(text) {
  var s = str_(text).toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/['’.]/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ')
    .filter(function (w, i, all) { return w && !(i > 0 && i < all.length - 1 && w.length === 1) && !/^(jr|sr|ii|iii|iv)$/.test(w); })
    .join(' ');
}

/**
 * Finds a person's email from a name as people write it, when only one person fits: full name,
 * nickname, first initial and last name, or the first name with a one-letter slip in the last
 * name ("Shelly Baxer" -> shelly.baxter).
 */
function personIndex_(emails) {
  var full = {}, initial = {}, byFirst = {};
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
      add(initial, words[0].charAt(0) + ' ' + last, email);
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
      if (NICKNAMES[first] && full[NICKNAMES[first] + ' ' + last]) return only(full[NICKNAMES[first] + ' ' + last]);
      hit = only(initial[first.charAt(0) + ' ' + last]);
      if (hit || last.length < 4) return hit;
      var near = [];
      [first, NICKNAMES[first]].forEach(function (f) {
        (f && byFirst[f] || []).forEach(function (c) { if (oneEditApart_(c.last, last) && near.indexOf(c.email) === -1) near.push(c.email); });
      });
      return only(near);
    }
  };
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
