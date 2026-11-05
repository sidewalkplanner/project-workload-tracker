/**
 * One-time setup and the daily refresh. Run setup() once from the Apps Script editor
 * (pick it in the function list, then Run) after the first deployment.
 */

/** Checks that the source sheets can be read, builds the first snapshot and schedules the daily refresh. */
function setup() {
  requireAdmin_('setup()');
  var json = refreshDataset_();
  var dataset = JSON.parse(json);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyRefresh') ScriptApp.deleteTrigger(t);
  });
  // The EASi report is regenerated a little after 7:00 Eastern; refresh after it lands.
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyDays(1).atHour(7).nearMinute(30).inTimezone('America/Chicago').create();
  // A second pass keeps the cache warm through the work day (the cache holds a snapshot for at most 6 hours).
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyHours(4).create();
  var msg = 'Set up: ' + dataset.prs.length + ' ' + dataset.scopeLabel + ' PRs across ' + dataset.offices.length +
    ' field offices (report generated ' + (dataset.generatedAt || 'unknown') + '). Refresh scheduled daily at 7:30 Central and every 4 hours.';
  console.log(msg);
  return msg;
}

/** Trigger handler: rebuild the snapshot. Only this project's own triggers, or an admin, may run it. */
function dailyRefresh(e) {
  if (!isProjectTrigger_(e)) requireAdmin_('dailyRefresh()');
  refreshDataset_();
}

/**
 * Every top-level function without a trailing underscore can be called from the browser with
 * google.script.run, by anyone who can open the web app. The editor-only functions start with
 * this check, so a viewer can't rebuild the snapshot, reschedule the triggers or look people up.
 * In the editor the active user is the owner, who is always an admin.
 */
function requireAdmin_(what) {
  if (!currentUser_(null).isAdmin) throw new Error(what + ' is for admins: run it from the Apps Script editor.');
}

/**
 * True when e is the event of one of this project's triggers. A browser can pass any object as
 * e, so the triggerUid has to match a trigger that really exists.
 */
function isProjectTrigger_(e) {
  if (!e || !e.triggerUid) return false;
  var uid = String(e.triggerUid);
  return ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; });
}
