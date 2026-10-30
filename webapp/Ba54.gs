/**
 * BA54 projects in the BA54 National Tracker's current program (its Current Program tab,
 * Script property BA54_ID) on in-scope buildings that have no PR in EASi yet. The tracker
 * is only read; the records it makes are described in Planned.gs.
 *
 * A BA54 project is in EASi when a PR lists its PCN or ASID among its project codes
 * (FE_Project_Code_List) and the PR is from the project's planned fiscal year or the year
 * before: project codes are reused for later phases, so a FY2022 PR on the same code doesn't
 * mean this year's work has a PR. Change orders are left out (they are money on an award
 * that already exists). Pending projects are waiting for approval; active ones are planned,
 * or approved once the division has authorized them to go forward. Their money is the
 * tracker's total cost, and the person assigned is its project manager.
 */

/** Tracker columns the tracker reads, by the first line of the header name. */
var BA54_HEADERS = {
  division: 'Division', assetManager: 'Asset Manager', projectManager: 'Project Manager', co: 'Contracting Officer',
  responsible: 'Responsible Division', buildings: 'Building #', office: 'Field Office', title: 'Project Title',
  description: 'Project Description', category: 'Category', ranking: 'Divisional Priority Ranking', status: 'Project Status',
  type: 'Project Type', fiscalYear: 'Planned FY', pcn: 'PCN', asid: 'ASID', totalCost: 'Total Cost',
  authorized: 'Divisional PT Authorized', prDate: 'Estimated / Actual PR Routing Date', awardDate: 'Estimated / Actual Award Date',
  ofmPriority: 'OFM Priority'
};

/** PCN / ASID codes look like RIL12174 (R + state + 5 digits); this finds them in a title. */
var BA54_CODE_IN_TITLE_RE = /\b[A-Z]{3}\d{5}\b/g;

/** Where the header row is ("Building #" is in it) and each column, or null when the tab isn't the tracker. */
function ba54Columns_(values) {
  for (var r = 0; r < Math.min((values || []).length, 10); r++) {
    var header = values[r].map(function (c) { return str_(String(c === null || c === undefined ? '' : c).split('\n')[0]); });
    if (header.indexOf(BA54_HEADERS.buildings) !== -1) return { row: r, col: headerIndex_(header, BA54_HEADERS) };
  }
  return null;
}

/** The emails on the tracker's rows, so its project manager names can be matched to them. */
function ba54Emails_(values) {
  var found = ba54Columns_(values);
  if (!found) return [];
  return emailsIn_(values.slice(found.row), [found.col.assetManager, found.col.projectManager, found.col.co]);
}

/**
 * What the BA54 tracker adds to a dataset being built.
 * @param {Array[]} values     The Current Program tab ([] when not read).
 * @param {Object}  inEasi     { codes: { project code: [{ pr, fy }] } } from every pipeline row.
 * @param {Object}  directory  From readDirectory_.
 * @param {Object}  people     From plannedPeople_.
 * @param {string}  rowLink    The tab's address; a row's link adds "&range=A<row>" ('' for none).
 * @return {{ projects: Object[], plans: Object[], counts: Object }}
 *   plans: { prs: [PR numbers], plan } for projects that are in EASi, so those PRs can show the plan.
 */
function ba54Projects_(values, inEasi, directory, people, rowLink) {
  var out = { projects: [], plans: [], counts: { rows: 0, inEasi: 0, notInEasi: 0, otherZones: 0, closed: 0 } };
  if (!values || values.length < 2) return out;
  var found = ba54Columns_(values);
  if (!found || found.col.title === -1) throw new Error('The BA54 tracker tab has no "Building #" and "Project Title" columns.');
  var col = found.col;
  var used = {};

  for (var i = found.row + 1; i < values.length; i++) {
    var row = values[i];
    var get = function (key) { return col[key] === -1 ? '' : row[col[key]]; };
    // Rows without a building are section headings.
    if (!str_(get('buildings')) || !str_(get('title'))) continue;
    out.counts.rows++;
    var status = str_(get('status'));
    var fy = planFiscalYear_(get('fiscalYear'));
    var codes = uniqueList_([str_(get('pcn')).toUpperCase(), str_(get('asid')).toUpperCase()].filter(Boolean));
    // No PCN or ASID: one written in the title ("2nd Floor Plumbing Repairs - 31310 / RIL12174 / WI 1397").
    if (!codes.length) codes = uniqueList_(str_(get('title')).toUpperCase().match(BA54_CODE_IN_TITLE_RE) || []);
    var prs = [];
    codes.forEach(function (c) {
      (inEasi.codes[c] || []).forEach(function (x) { if ((!fy || !x.fy || x.fy >= fy - 1) && prs.indexOf(x.pr) === -1) prs.push(x.pr); });
    });
    if (prs.length) {
      // In EASi (a change order too): its PRs show the plan.
      out.plans.push({ prs: prs, plan: {
        source: 'ba54', sourceLabel: 'BA54 tracker', id: codes[0], title: str_(get('title')), status: str_(get('category')) === 'Change Order' ? 'Change order' : status || 'Active',
        estimate: money_(get('totalCost')) || 0, person: str_(get('projectManager')), fy: fy,
        link: rowLink ? rowLink + '&range=A' + (i + 1) : '', how: 'PCN / ASID in the PR’s project codes'
      } });
      out.counts.inEasi++;
      continue;
    }
    if (/change order/i.test(str_(get('category'))) || (status && !/^(active|pending)$/i.test(status))) { out.counts.closed++; continue; }
    var place = plannedPlace_(get('buildings'), get('office'), directory);
    if (!place) { out.counts.otherZones++; continue; }

    var authorized = money_(get('authorized')) || 0;
    var stage = /^pending$/i.test(status) ? 'pending' : authorized > 0 ? 'noPr' : 'planning';
    // Several phases can share a code: each is still its own row.
    var number = codes[0] || 'Row ' + (i + 1) + ' (no PCN)';
    used[number] = (used[number] || 0) + 1;
    if (used[number] > 1) number += ' (' + used[number] + ')';
    out.projects.push(plannedRecord_({
      source: 'ba54',
      sourceLabel: 'BA54 tracker',
      pr: number,
      title: get('title'),
      link: rowLink ? rowLink + '&range=A' + (i + 1) : '',
      fy: fy,
      program: 'PG54',
      stage: stage,
      planStatus: status || 'Active',
      estimate: money_(get('totalCost')) || 0,
      cor: people.find(get('projectManager')),
      co: people.find(get('co')),
      place: place,
      projectCodes: codes,
      dueBy: planDueDate_(get('prDate'), fy), dueWhat: 'PR routing (estimated)',
      details: [
        ['Description', str_(get('description'))],
        ['Project type', str_(get('type'))],
        ['Category', str_(get('category'))],
        ['Division', str_(get('division'))],
        ['Responsible division', str_(get('responsible'))],
        ['Divisional priority', str_(get('ranking'))],
        ['OFM priority', str_(get('ofmPriority'))],
        ['Authorized to go forward', authorized ? '$' + Math.round(authorized).toLocaleString('en-US') : ''],
        ['PR routing (estimated or actual)', monthOrDate_(get('prDate'))],
        ['Award (estimated or actual)', monthOrDate_(get('awardDate'))],
        ['Asset manager', people.find(get('assetManager')).map(function (k) { return k.indexOf('@') === -1 ? people.names[k] : k; }).join(', ')],
        ['PCN / ASID', codes.join(', ')]
      ]
    }));
    out.counts.notInEasi++;
  }
  return out;
}

/** The tracker writes a month ("October") or a date. */
function monthOrDate_(value) {
  return isDateValue_(value) || /^\d{4}-\d{2}-\d{2}/.test(str_(value)) ? pipelineDate_(value) : str_(value);
}
