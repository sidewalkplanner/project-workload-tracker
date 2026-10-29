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
