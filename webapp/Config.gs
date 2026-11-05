/**
 * National Project Overview Dashboard (formerly OFM Projects, NEH Projects and the NEH Project
 * Workload Tracker) — configuration.
 *
 * This app's own settings. Every value here can be overridden without touching code: Apps
 * Script › Project Settings › Script properties, using the key names in SETTINGS_DEFAULTS.
 * The rules shared with other apps (columns, stages, programs, service contracts) are in Rules.gs.
 */

/** The site's name (Script property APP_NAME). */
function appName_() { return setting_('APP_NAME'); }

var SETTINGS_DEFAULTS = {
  // The APS Workload Tracker "BA61 Pipeline" report (a Google Sheet EASi refreshes every morning).
  PIPELINE_ID: '1Z0CNVnAft_h4dwJeket99PDwobLMC7YS2zUN55zNlAU',
  PIPELINE_TAB: 'Pipeline',
  // The OFM Building Assignments sheet: building -> zone, service center, field office, building manager.
  DIRECTORY_ID: '1jH7ffxNrT2rFl2P0p-SFFH9z_yYcsH4W2qnBMB_xuAw',
  DIRECTORY_TAB: 'Buildings',
  ORG_TAB: 'Org Relationships',
  // The NEH BA61 Project Portal's data sheet: BA61 projects planned or approved there but not in EASi yet.
  // PORTAL_ID set to OFF leaves them out. PORTAL_URL is the portal's web app, for links to each project.
  PORTAL_ID: '1Vi0986jvcQ-45VQFY0JnGHSgimrQCc8DtpFIegUqG9Y',
  PORTAL_TAB: 'Projects',
  PORTAL_URL: 'https://script.google.com/a/macros/gsa.gov/s/AKfycby4r1bIis1ceoCNXZYVbJt8HEhJPVcHoUKel04omZKgytSaG5K7sPCRjUWBZ1a0bVCu/exec',
  // The BA54 National Tracker: BA54 projects in the current program but not in EASi yet. OFF leaves them out.
  BA54_ID: '1yymDTl2sHxfFvh6oYIiiO6-J1e0w1z9aO4nxsaprHj8',
  BA54_TAB: 'Current Program',
  // The All Open RWAs and WRs Dashboard: RWAs and work requests, before and after their PRs. OFF leaves them out.
  RWA_ID: '1x-_djqh6dugexhMHUHUEqnl5KnuwtH1r---AGgY4eu0',
  RWA_TAB: 'Detailed Data',
  // Names in the BA61 portal or BA54 tracker the tracker can't match to an email on its own: "Name = email; Name = email".
  NAME_EMAILS: '',
  // The site's name, in the header and the browser tab.
  APP_NAME: 'National Project Overview Dashboard',
  // The browser-tab icon (OFF for none).
  FAVICON_URL: 'https://insite.gsa.gov/sites/insite.gsa.gov/themes/custom/insite/Seal_final_082726.png',
  // Which part of the OFM Building Assignments sheet to cover: ALL (every enterprise: the whole
  // country), or one enterprise ("Northeast Heartland"), optionally one zone of it (ZONE).
  ENTERPRISE: 'ALL',
  // What the page calls the whole area it covers; blank = "National" (or the enterprise's short name).
  ENTERPRISE_SHORT: '',
  ZONE: '',
  // Comma-separated emails to correct the building manager / project manager split for individual people.
  BUILDING_MANAGER_EMAILS: '',
  PROJECT_MANAGER_EMAILS: '',
  // Comma-separated emails that see the Admin tools (refresh status). The deployer always does.
  ADMIN_EMAILS: '',
  // Leaders and what they are over, for Needs attention. Places, a supervisor's project managers
  // (by email), or an org code for a whole team:
  // "a@gsa.gov = Zone 5; b@gsa.gov = Northeast Heartland; c@gsa.gov = pm1@gsa.gov, pm2@gsa.gov;
  //  d@gsa.gov = PMCGCA; e@gsa.gov = All". Field Office Managers and Service Center Directors are
  // known from the OFM Building Assignments sheet; admins see every place.
  LEADERS: '',
  // How long a built snapshot is reused before the sources are read again (minutes, max 360).
  CACHE_MINUTES: '360'
};

/** Short names the page uses for enterprises (others go by their full name). */
var ENTERPRISE_SHORT_NAMES = { 'Northeast Heartland': 'NEH' };

/** Reads a setting: script property first, then the default above. */
function setting_(key) {
  var value = null;
  try { value = PropertiesService.getScriptProperties().getProperty(key); } catch (e) { value = null; }
  if (value === null || value === undefined || String(value).trim() === '') value = SETTINGS_DEFAULTS[key];
  return value === undefined || value === null ? '' : String(value).trim();
}
