/**
 * RWAs and RETA work requests from the All Open RWAs and WRs Dashboard (its Detailed Data
 * tab, Script property RWA_ID). The dashboard is only read; the records it makes are
 * described in Planned.gs.
 *
 * RWAs are BA80 (reimbursable work). An RWA is in EASi when a PR lists its number in
 * FE_RWA_List, or writes it in its title or comments ("RWA #N3858013"); that PR then shows the RWA
 * (customer, authorized amount, GSA PM) as its plan. One that no PR lists is added as "Not
 * in EASi yet" when nothing has been committed or obligated on it: work requests being
 * estimated (Planning/Estimate, Unassigned) are planning, ones waiting for the customer's
 * signature are waiting for approval, and accepted RWAs are approved with no PR yet. An RWA
 * with money committed or obligated but no PR in the report is funded some other way (a
 * lease, a purchase card, an older PR) and is only counted. Substantially completed and
 * failed ones are left out. Severable RWAs are recurring services, so they count as service
 * contracts (hidden unless the page includes them). The person assigned is the GSA PM in
 * RETA. Kahua isn't used: its people and dates are too often out of date, and the dashboard's
 * planned award, construction start and completion dates come from Kahua (they are only ever
 * filled in for RWAs with a Kahua project), so they are left out too. The money is the
 * authorized amount (else the pending one).
 */

/** Dashboard columns the tracker reads, by header name (line breaks read as spaces). */
var RWA_HEADERS = {
  buildingType: 'Building Type', building: 'Building Number', office: 'OFM Field Office', type: 'RWA Type', number: 'RWA No',
  sev: 'Sev/Nonsev', status: 'RWA Status', pending: 'PENDING Authorized Amount', authorized: 'ACTUAL Authorized Amount',
  commitments: 'Open Commitments', obligated: 'Obligated', expensed: 'Expensed', billed: 'Billed', agency: 'Agency', bureau: 'Bureau',
  agencyPoc: 'Agency POC', pm: 'RETA GSA PM/POC',
  wrSent: 'WR Sent Date', accepted: 'RWA Accepted Date', acceptedFy: 'RWA Accepted FY', fundsClose: 'Next Fund Closing Date', description: 'Description'
};

/** RWA status -> the tracker's stage, for RWAs with no PR and no money yet. */
var RWA_STAGES = {
  'Planning/Estimate': 'planning', 'Unassigned': 'planning',
  'Pending-New': 'pending', 'Signature Requested': 'pending', 'Pending-Mod': 'pending', 'Mod-Requested': 'pending',
  'Accepted': 'noPr', 'Mod-Initiated': 'noPr'
};

/** RETA's RWA types, in words. */
var RWA_TYPES = { W: 'Work request (not yet an RWA)', N: 'Nonrecurring', R: 'Recurring', F: 'Fixed price', A: 'Above-standard services', B: 'Building services', C: 'Credit', D: 'Delegation' };

/** Where the header row is ("RWA No" is in it) and each column, or null when the tab isn't the dashboard. */
function rwaColumns_(values) {
  for (var r = 0; r < Math.min((values || []).length, 10); r++) {
    var header = values[r].map(function (c) { return str_(String(c === null || c === undefined ? '' : c).replace(/\s+/g, ' ')); });
    if (header.indexOf(RWA_HEADERS.number) !== -1) return { row: r, col: headerIndex_(header, RWA_HEADERS) };
  }
  return null;
}

/** The dashboard's "Data as of: 10/30/2026 01:09 PM ET" -> '2026-10-30' ('' when it has none). */
function rwaAsOf_(values) {
  for (var r = 0; r < Math.min((values || []).length, 3); r++) {
    var m = /as of:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(str_(values[r][0]));
    if (m) return m[3] + '-' + pad2_(Number(m[1])) + '-' + pad2_(Number(m[2]));
  }
  return '';
}

/** An RWA number as people write it in a PR title: its type letter and seven digits ("N3858013"). */
var RWA_IN_TITLE_RE = /\b[NRFABCDW](\d{7})\b/g;

/** RWA numbers written in a PR's title or comments: "RWA #N3858013" -> ['3858013']. */
function rwaNumbersIn_(text) {
  var out = [], m;
  RWA_IN_TITLE_RE.lastIndex = 0;
  while ((m = RWA_IN_TITLE_RE.exec(str_(text).toUpperCase()))) if (out.indexOf(m[1]) === -1) out.push(m[1]);
  return out;
}

/** A date cell, or text like "09/30/2029", as 'yyyy-mm-dd' ('' when it isn't one). */
function usDate_(value) {
  if (isDateValue_(value) || /^\d{4}-\d{2}-\d{2}/.test(str_(value))) return pipelineDate_(value);
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str_(value));
  return m ? m[3] + '-' + pad2_(Number(m[1])) + '-' + pad2_(Number(m[2])) : '';
}

/** RETA writes RWA numbers as numbers or text ("3779613", 3779613, "3779613.0"). */
function rwaNumber_(value) {
  return str_(value).replace(/\.0+$/, '').toUpperCase();
}

/**
 * What the RWA dashboard adds to a dataset being built.
 * @param {Array[]} values     The Detailed Data tab ([] when not read).
 * @param {Object}  inEasi     { rwas: { RWA number: [PR numbers] } } from every pipeline row.
 * @param {Object}  directory  From readDirectory_.
 * @param {Object}  people     From plannedPeople_.
 * @param {string}  rowLink    The tab's address; a row's link adds "&range=A<row>" ('' for none).
 * @return {{ projects: Object[], plans: Object[], updated: string, counts: Object }}
 */
function rwaProjects_(values, inEasi, directory, people, rowLink) {
  var out = { projects: [], plans: [], updated: rwaAsOf_(values), counts: { rows: 0, inEasi: 0, notInEasi: 0, otherZones: 0, closed: 0, fundedElsewhere: 0 } };
  if (!values || values.length < 2) return out;
  var found = rwaColumns_(values);
  if (!found) throw new Error('The RWA dashboard tab has no "RWA No" column.');
  var col = found.col;

  for (var i = found.row + 1; i < values.length; i++) {
    var row = values[i];
    var get = function (key) { return col[key] === -1 ? '' : row[col[key]]; };
    var number = rwaNumber_(get('number'));
    if (!number) continue;
    // Only NEH buildings (or offices) count, matched or not.
    var place = plannedPlace_(get('building'), get('office'), directory);
    if (!place) { out.counts.otherZones++; continue; }
    out.counts.rows++;
    var status = str_(get('status'));
    var authorized = money_(get('authorized')) || money_(get('pending')) || 0;
    var pm = people.find(get('pm'));
    // "UNITED STATES GEOLOGICAL SURVEY (USGS)" -> "United States Geological Survey (USGS)"
    var customer = uniqueList_([str_(get('agency')), str_(get('bureau'))].filter(Boolean)).map(function (t) {
      return titleCase_(t).replace(/\(([A-Za-z&]+)\)/g, function (m, a) { return '(' + a.toUpperCase() + ')'; });
    }).join(' · ');
    var severable = /^severable$/i.test(str_(get('sev')));
    var link = rowLink ? rowLink + '&range=A' + (i + 1) : '';
    var description = str_(get('description')).replace(/\s+/g, ' ');
    // When the customer's money expires ('' for no-year funds).
    var fundsClose = /^no/i.test(str_(get('fundsClose'))) ? '' : usDate_(get('fundsClose'));

    var prs = inEasi.rwas[number] || [];
    if (prs.length) {
      out.plans.push({ prs: prs, plan: {
        source: 'rwa', sourceLabel: 'RWA', id: number, title: description.slice(0, 200), status: status,
        estimate: authorized, person: pm.map(function (k) { return k.indexOf('@') === -1 ? people.names[k] : k; }).join(', '),
        fy: planFiscalYear_(get('acceptedFy')), link: link,
        note: [customer ? 'Customer: ' + customer : '', fundsClose ? 'Funds close ' + fundsClose.slice(5, 7).replace(/^0/, '') + '/' + fundsClose.slice(8).replace(/^0/, '') + '/' + fundsClose.slice(0, 4) : ''].filter(Boolean).join(' · '),
        how: prs.every(function (n) { return inEasi.rwaInTitle[number + '|' + n]; }) ? 'RWA number in the PR title' : 'RWA number on the PR',
        fundsClose: fundsClose
      } });
      out.counts.inEasi++;
      continue;
    }
    var stage = RWA_STAGES[status];
    if (!stage) { out.counts.closed++; continue; }
    if ((money_(get('obligated')) || 0) > 0 || (money_(get('commitments')) || 0) > 0) { out.counts.fundedElsewhere++; continue; }

    var type = str_(get('type')).toUpperCase();
    var p = plannedRecord_({
      source: 'rwa',
      sourceLabel: type === 'W' ? 'Work request' : 'RWA',
      pr: number,
      title: description.slice(0, 400) || '(no description)',
      link: link,
      fy: planFiscalYear_(get('acceptedFy')),
      program: 'PG80',
      stage: stage,
      planStatus: status,
      estimate: authorized,
      cor: pm,
      place: place,
      seedDate: stage === 'noPr' ? monthOrDate_(get('accepted')) : monthOrDate_(get('wrSent')),
      fundsClose: fundsClose,
      details: [
        ['Customer', customer],
        ['Customer contact', str_(get('agencyPoc'))],
        ['RWA type', RWA_TYPES[type] || type],
        ['Severable', severable ? 'Yes: recurring services' : 'No'],
        ['Building type', str_(get('buildingType'))],
        ['Work request sent', monthOrDate_(get('wrSent'))],
        ['Accepted', monthOrDate_(get('accepted'))],
        ['Funds close', fundsClose || (/^no/i.test(str_(get('fundsClose'))) ? 'No-year funds' : '')]
      ]
    });
    if (severable) p.service = 'Severable RWA (recurring services)';
    out.projects.push(p);
    out.counts.notInEasi++;
  }
  return out;
}
