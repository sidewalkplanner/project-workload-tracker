/**
 * BA61 projects that are planned or approved in the NEH BA61 Project Portal but have no PR
 * in EASi yet. The portal's Projects tab (its data sheet, Script property PORTAL_ID) is only
 * read; the records it makes are described in Planned.gs.
 *
 * A portal project is in EASi when a PR's number is its EQ number, or a PR's title or
 * comments carry its portal number (RM0024-092426): the same rule the portal's own EASi
 * sync uses. Planning, Pending Approval, Approved and Emergency NTP projects without such
 * a PR are added; their money is the portal's budgeted amount.
 */

/** Portal columns the tracker reads, by header name. */
var PORTAL_HEADERS = {
  number: 'Project Number', status: 'Status', requestType: 'Request Type', fiscalYear: 'Fiscal Year',
  office: 'Field Office', buildings: 'Building Number(s)', description: 'Project Description',
  priority: 'Priority', spendCategory: 'Spend Category', budget: 'Budgeted Amount', commitmentMonth: 'Commitment Month',
  cor: 'COR', eqNumber: 'EQ Number', requester: 'Requester Email', otherEmails: 'Additional POC Emails',
  submittedAt: 'Submitted For Approval At', decidedAt: 'Decided At', createdAt: 'Created At', updatedAt: 'Updated At'
};

/** Portal status -> the tracker's stage. Denied and Cancelled projects are left out. */
var PORTAL_STAGES = {
  'Planning': 'planning',
  'Pending Approval': 'pending',
  'Approved': 'noPr',
  'Emergency NTP': 'noPr'
};

/** The emails on the portal's rows, so its COR names can be matched to them. */
function portalEmails_(portalValues) {
  if (!portalValues || portalValues.length < 2) return [];
  var col = headerIndex_(portalValues[0], PORTAL_HEADERS);
  return emailsIn_(portalValues, [col.requester, col.otherEmails]);
}

/**
 * What the portal adds to a dataset being built.
 * @param {Array[]} portalValues  The portal's Projects tab, header row first ([] when not read).
 * @param {Object}  inEasi        { eq: { PR number: true }, mentioned: { portal number: [PR numbers] } } from every pipeline row.
 * @param {Object}  directory     From readDirectory_.
 * @param {Object}  people        From plannedPeople_.
 * @param {string}  portalUrl     The portal's /exec URL, for links ('' for none).
 * @return {{ projects: Object[], plans: Object[], updated: string, counts: Object }}
 *   plans: { prs: [PR numbers], plan } for projects that are in EASi, so those PRs can show the plan.
 */
function portalProjects_(portalValues, inEasi, directory, people, portalUrl) {
  var out = { projects: [], plans: [], updated: '', counts: { rows: 0, inEasi: 0, notInEasi: 0, otherZones: 0, closed: 0 } };
  if (!portalValues || portalValues.length < 2) return out;
  var col = headerIndex_(portalValues[0], PORTAL_HEADERS);
  if (col.number === -1 || col.status === -1) throw new Error('The BA61 portal data sheet has no "Project Number" and "Status" columns on its Projects tab.');
  var portalNumber = new RegExp('^' + PORTAL_NUMBER_RE.source + '$');

  for (var i = 1; i < portalValues.length; i++) {
    var row = portalValues[i];
    var get = function (key) { return col[key] === -1 ? '' : row[col[key]]; };
    var number = str_(get('number')).toUpperCase();
    if (!number) continue;
    out.counts.rows++;
    var updated = pipelineDate_(get('updatedAt'));
    if (updated > out.updated) out.updated = updated;
    var eq = str_(get('eqNumber')).toUpperCase();
    var prs = uniqueList_((!!eq && !portalNumber.test(eq) && inEasi.eq[eq] ? [eq] : []).concat(inEasi.mentioned[number] || []));
    if (prs.length) {
      // In EASi (whatever its portal status): its PRs show the plan.
      out.plans.push({ prs: prs, plan: {
        source: 'portal', sourceLabel: 'BA61 portal', id: number, title: str_(get('description')), status: str_(get('status')),
        estimate: money_(get('budget')) || 0, person: str_(get('cor')), fy: planFiscalYear_(get('fiscalYear')),
        link: portalUrl ? portalUrl + '?view=project&id=' + encodeURIComponent(number) : '',
        how: eq && prs.indexOf(eq) !== -1 ? 'EQ number' : 'portal number in the PR'
      } });
      out.counts.inEasi++;
      continue;
    }
    var stage = PORTAL_STAGES[str_(get('status'))];
    if (!stage) { out.counts.closed++; continue; }
    var place = plannedPlace_(get('buildings'), get('office'), directory);
    if (!place) { out.counts.otherZones++; continue; }
    out.projects.push(plannedRecord_({
      source: 'portal',
      sourceLabel: 'BA61 portal',
      pr: number,
      title: get('description'),
      link: portalUrl ? portalUrl + '?view=project&id=' + encodeURIComponent(number) : '',
      fy: planFiscalYear_(get('fiscalYear')),
      program: 'PG61',
      stage: stage,
      planStatus: get('status'),
      estimate: money_(get('budget')) || 0,
      cor: people.find(get('cor')),
      requestor: parseEmailList_(get('requester')),
      place: place,
      portalNumbers: [number],
      details: [
        ['Request type', str_(get('requestType'))],
        ['Priority', str_(get('priority'))],
        ['Spend category', str_(get('spendCategory'))],
        ['Planned commitment', str_(get('commitmentMonth'))],
        ['Submitted for approval', pipelineDate_(get('submittedAt'))],
        ['Decided', pipelineDate_(get('decidedAt'))],
        ['EQ number', eq ? eq + ' (not in the EASi report)' : '']
      ]
    }));
    out.counts.notInEasi++;
  }
  return out;
}
