/**
 * Zone 5 Project Workload Tracker — configuration.
 *
 * Every value here can be overridden without touching code: Apps Script ›
 * Project Settings › Script properties, using the key names in SETTINGS_DEFAULTS.
 */

var APP = {
  name: 'Zone 5 Project Workload Tracker',
  shortName: 'Zone 5 Workload'
};

var SETTINGS_DEFAULTS = {
  // The APS Workload Tracker "BA61 Pipeline" report (a Google Sheet EASi refreshes every morning).
  PIPELINE_ID: '1Z0CNVnAft_h4dwJeket99PDwobLMC7YS2zUN55zNlAU',
  PIPELINE_TAB: 'Pipeline',
  // The OFM Building Assignments sheet: building -> zone, service center, field office, building manager.
  DIRECTORY_ID: '1jH7ffxNrT2rFl2P0p-SFFH9z_yYcsH4W2qnBMB_xuAw',
  DIRECTORY_TAB: 'Buildings',
  ORG_TAB: 'Org Relationships',
  ZONE: '5',
  // Comma-separated emails that see the Admin tools (refresh status). The deployer always does.
  ADMIN_EMAILS: '',
  // How long a built snapshot is reused before the sources are read again (minutes, max 360).
  CACHE_MINUTES: '360'
};

/** Pipeline columns the tracker reads, by header name (the report's column order can change). */
var PIPELINE_HEADERS = {
  prNumber: 'PR_Number', title: 'PR_Title', awardNumber: 'Award_Number',
  assigned: 'Contact_Assigned_CO_CS', requestor: 'Contact_Requestor',
  co: 'Contracting_Officer', cs: 'Contracting_Specialist', cor: 'Contracting_Officer_Representative',
  reserved: 'PR_Reserved_Amount', committed: 'PR_Committed_Amount', obligated: 'Award_Obligated_Amount',
  expended: 'Variance_Pegasys_Expended_Amount', awardType: 'Award_Type', vendor: 'Vendor_Name',
  acquisitionStatus: 'Acquisition_Status', state: 'Place_of_Performance_State', officeCode: 'Office_Code',
  fiscalYear: 'PR_Fiscal_Year', prStatus: 'PR_Status', reviewers: 'Current_PR_Routing_Position_For_Review',
  solicitationStatus: 'Solicitation_Status', awardStatus: 'Award_Status',
  activityCodes: 'FE_Activity_Code_List', buildingCodes: 'FE_Building_Code_List', orgCodes: 'FE_Org_Code_List',
  programCodes: 'FE_Program_Code_List', projectCodes: 'FE_Project_Code_List', rwas: 'FE_RWA_List',
  executedDate: 'Executed_Date', programManager: 'Program_Manager', category: 'Category_Code',
  procurementCategory: 'Procurement_Category', comments: 'Comments', link: 'Link'
};

/** The budget activities the tracker calls out. Anything else is grouped as "Other". */
var PROGRAMS = [
  { code: 'PG61', label: 'BA61', name: 'BA61 · Repairs & alterations (R&A)' },
  { code: 'PG80', label: 'BA80', name: 'BA80 · Reimbursable work (RWA)' },
  { code: 'PG54', label: 'BA54', name: 'BA54 · Building operations' }
];

/**
 * Where a PR is, in order. "group" drives the Open / Pre-award / Awarded filters.
 * Fully expended = awarded and Pegasys shows the whole obligation spent (or nothing was obligated).
 */
var STAGES = [
  { key: 'draft', label: 'PR in draft', short: 'Draft', group: 'preaward' },
  { key: 'review', label: 'PR in review', short: 'In review', group: 'preaward' },
  { key: 'approved', label: 'PR approved · awaiting assignment', short: 'Awaiting assignment', group: 'preaward' },
  { key: 'assigned', label: 'With contracting', short: 'With contracting', group: 'preaward' },
  { key: 'solicitation', label: 'Out for solicitation', short: 'Solicitation', group: 'preaward' },
  { key: 'drafting', label: 'Award being drafted', short: 'Award drafting', group: 'preaward' },
  { key: 'awarded', label: 'Awarded · funds open', short: 'Awarded', group: 'awarded' },
  { key: 'expended', label: 'Fully expended', short: 'Fully expended', group: 'closed' }
];

/** People roles the Workload tab can rank. "field" is the PR field holding the emails. */
var ROLES = [
  { key: 'lead', label: 'Project lead (COR, or the requestor until a COR is named)', short: 'Project lead' },
  { key: 'cor', label: 'COR (Contracting Officer Representative)', short: 'COR' },
  { key: 'requestor', label: 'Requestor', short: 'Requestor' },
  { key: 'buildingManager', label: 'Building manager (ServiceNow primary POC)', short: 'Building manager' },
  { key: 'programManager', label: 'Program manager', short: 'Program manager' },
  { key: 'co', label: 'Contracting officer', short: 'CO' },
  { key: 'cs', label: 'Contract specialist', short: 'CS' }
];

/**
 * Service contracts (custodial, O&M, snow removal, utilities, option years…) aren't projects;
 * they are hidden unless the page's Type filter asks for them. A PR is a service contract
 * when its procurement category is a long-term service vehicle, or its title reads like a
 * recurring service. Repairs that only mention a service ("janitor closet leak", "landscape
 * pipe leak", "O&M R&A") don't match.
 */
var SERVICE_CATEGORY_RE = /service contracts|^utilities|^espc\b|lease orders/i;
var SERVICE_TITLE_RES = [
  /\b(custodial|janitorial|cleaning)( and related| & related)? services?\b/i,
  /\bcustodial (and|&) related\b/i,
  /\bsnow( and ice| & ice)? removal\b/i,
  /\blandscap\w* (services?|contract|maintenance)\b/i,
  /\bgroundskeeping\b/i,
  /\bfull (maintenance|facilities|services)\b/i,
  /\bo&m (and related |& related )?services?\b/i,
  /\bo&m (service )?bpa\b/i,
  /\bo&m reprocurement\b/i,
  /\bfe (services?|o&m)\b/i,
  /\bfacilities eng\w* (services?|for|at)\b/i,
  /\bfacilities engineering\b/i,
  /\bfacilities management services\b/i,
  /\boperations (and|&) maintenance\b(?! r&a)/i,
  /\belevator maintenance\b/i,
  /\b(option year|follow[- ]on (year|contract)|exercise option|oy ?\d)\b/i,
  /\boption ([ivx]+|\d+)\b/i,
  /\b(bird abatement|parking management|cafeteria|pest control|guard|security guard|fire & emergency) services?\b/i,
  /\b(steam|chilled water|hot water) services?\b/i,
  /\bcfm\b/i
];
/** A title that names building work is a project even if it also mentions a service. */
var PROJECT_WORK_RE = /\b(replac\w*|repairs?|install\w*|renovat\w*|retrofit|upgrade|construction|abatement of|cma|cxa|cm)\b/i;
/** Title rules only apply to these EASi categories (construction and A-E work stays a project). */
var SERVICE_TITLE_CATEGORY_RE = /^(services|other|)$/i;

/**
 * PRs that fund several projects at once (one award, many line items). Each counts as its
 * number of projects everywhere, and the project's detail panel lists them. Until EASi's
 * line items can be read, add them here by PR number: [project number, title].
 */
var SUB_PROJECTS = {
  // Building 56 and 67 Multi-Project O&M R&A, Denver Federal Center (award 47PD5126F0318).
  'EQPMBA-26-0272': [
    ['DWP26104', 'B56 Fire Sprinkler Work'],
    ['DWP26104-1', 'VCT Floor Polishing'],
    ['DWP26104-2', 'B56 Replace Pump, Vibration Lab'],
    ['DWP26104-3', 'B56 Vibration Lab ACM Abatement'],
    ['DWP26104-4', 'B56 Garage Door E26'],
    ['DWP26104-5', 'B67 RF1 Motor Replacement'],
    ['DWP26104-6', 'B67 AHU8 Chilled Water-Steam Valve Replacement'],
    ['DWP26104-7', 'B67 3rd Floor Drain Line Repairs']
  ]
};

/** The two kinds of project lead, for the "Lead team" switch. */
var TEAMS = {
  bm: 'Building managers',
  pm: 'Project managers'
};

/** Building numbers look like CO0026ZZ (state + 4 digits + 2 letters or digits). */
var BUILDING_NUMBER_RE = /\b[A-Z]{2}\d{4}[A-Z0-9]{2}\b/g;
/** NEH BA61 Project Portal numbers (RM0199-100726) that requesters put in PR titles. */
var PORTAL_NUMBER_RE = /\b[A-Z]{2}\d{3,5}-\d{6}\b/g;
/** "BA61", "BA 80", "PG54" written in a PR title (draft PRs often have no program code yet). */
var PROGRAM_IN_TITLE_RE = /\b(?:BA|PG)[\s-]?(61|80|54)\b/gi;
/** OFM org codes for a service center without a building (P00MCF00 = Heartland, P00MCG00 = Rocky Mountain). */
var OFM_ORG_RE = /^P00M(C[A-Z])/;

/** Reads a setting: script property first, then the default above. */
function setting_(key) {
  var value = null;
  try { value = PropertiesService.getScriptProperties().getProperty(key); } catch (e) { value = null; }
  if (value === null || value === undefined || String(value).trim() === '') value = SETTINGS_DEFAULTS[key];
  return value === undefined || value === null ? '' : String(value).trim();
}
