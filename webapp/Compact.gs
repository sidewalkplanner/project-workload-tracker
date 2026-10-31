/**
 * Making the snapshot small for the trip to the browser, which is most of a page load on a
 * slow connection. compactDataset_ leaves out what the browser can rebuild, and the page's
 * expandProject (JsCore) puts it back exactly as expandProject_ here does:
 *
 *   - fields at their default ('' / 0 / false / 1 project / an empty list);
 *   - the standard EASi link (built from the PR number);
 *   - building names and building managers (one index of buildings instead of a copy on
 *     every project);
 *   - the person assigned when it is the usual rule (the COR, else the submitter);
 *   - fields the page never shows (assigned, reserved).
 *
 * The open projects travel with the page; paid-in-full projects and service contracts, which
 * the page hides at first, follow a moment later (Data.gs, Api.gs).
 */

var COMPACT_DEFAULTS = {
  values: {
    programFromTitle: false, prStatus: '', acquisitionStatus: '', awardStatus: '', solicitationStatus: '', awardNumber: '', awardType: '',
    vendor: '', category: '', procurementCategory: '', committed: 0, obligated: 0, expended: 0, remaining: 0, executed: '',
    state: '', officeCode: '', comments: '', placeNote: '', service: '', units: 1, fy: null
  },
  lists: ['reviewers', 'requestor', 'cor', 'co', 'cs', 'programManager', 'buildingManager', 'projectCodes', 'rwas', 'portalNumbers',
    'subprojects', 'plans', 'details', 'buildings', 'buildingNames', 'offices', 'serviceCenters', 'zones', 'programs']
};
var EASI_LINK = 'https://easi.pbs.gsa.gov/suite/tempo/records/type/pr/search/';
var NEVER_SHOWN = ['assigned', 'reserved'];

/** { buildingIndex, prs } with each project compacted; the rest of the dataset as it is. */
function compactDataset_(dataset) {
  var index = {};
  dataset.prs.forEach(function (p) {
    (p.buildings || []).forEach(function (b, i) { if (!index[b]) index[b] = [(p.buildingNames || [])[i] || '', []]; });
  });
  // Each building's managers, in the order projects list them.
  dataset.prs.forEach(function (p) {
    if ((p.buildings || []).length === 1) index[p.buildings[0]][1] = (p.buildingManager || []).slice();
  });
  var out = {};
  Object.keys(dataset).forEach(function (k) { if (k !== 'prs') out[k] = dataset[k]; });
  out.buildingIndex = index;
  out.compact = { values: COMPACT_DEFAULTS.values, lists: COMPACT_DEFAULTS.lists, easiLink: EASI_LINK };
  out.prs = dataset.prs.map(function (p) { return compactProject_(p, index); });
  return out;
}

function compactProject_(p, index) {
  var c = {};
  Object.keys(p).forEach(function (k) {
    if (NEVER_SHOWN.indexOf(k) !== -1) return;
    var v = p[k];
    if (COMPACT_DEFAULTS.lists.indexOf(k) !== -1 && Array.isArray(v) && !v.length) return;
    if (k in COMPACT_DEFAULTS.values && v === COMPACT_DEFAULTS.values[k]) return;
    c[k] = v;
  });
  if (!p.source && p.link === EASI_LINK + encodeURIComponent(p.pr)) delete c.link;
  var built = buildingFacts_(p.buildings || [], index);
  if (JSON.stringify(built.names) === JSON.stringify(p.buildingNames || [])) delete c.buildingNames;
  if (JSON.stringify(built.managers) === JSON.stringify(p.buildingManager || [])) delete c.buildingManager;
  if (JSON.stringify(usualLead_(p)) === JSON.stringify(p.lead || [])) delete c.lead;
  return c;
}

/** The inverse of compactProject_ (the page runs the same steps in expandProject). */
function expandProject_(c, data) {
  var p = {};
  Object.keys(c).forEach(function (k) { p[k] = c[k]; });
  var d = data.compact;
  Object.keys(d.values).forEach(function (k) { if (p[k] === undefined) p[k] = d.values[k]; });
  d.lists.forEach(function (k) { if (!p[k]) p[k] = []; });
  if (!p.source && p.link === undefined) p.link = d.easiLink + encodeURIComponent(p.pr);
  var built = buildingFacts_(p.buildings, data.buildingIndex);
  if (c.buildingNames === undefined) p.buildingNames = built.names;
  if (c.buildingManager === undefined) p.buildingManager = built.managers;
  if (p.lead === undefined) p.lead = usualLead_(p);
  return p;
}

/** Names and building managers of a project's buildings, from the index. */
function buildingFacts_(buildings, index) {
  var names = [], managers = [];
  buildings.forEach(function (b) {
    var e = index[b] || ['', []];
    names.push(e[0]);
    e[1].forEach(function (m) { if (managers.indexOf(m) === -1) managers.push(m); });
  });
  return { names: names, managers: managers };
}

/** The person assigned by the usual rule: the COR, else the submitter. */
function usualLead_(p) {
  return (p.cor || []).length ? p.cor.slice() : (p.requestor || []).slice();
}

/** True for what the page shows first: open projects (not paid in full, not service contracts). */
function shownFirst_(p) {
  return !p.service && p.stage !== 'expended';
}
