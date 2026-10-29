/**
 * One-time setup and the daily refresh. Run setup() once from the Apps Script editor
 * (pick it in the function list, then Run) after the first deployment.
 */

/** Checks that both sheets can be read, builds the first snapshot and schedules the daily refresh. */
function setup() {
  var json = refreshDataset_();
  var dataset = JSON.parse(json);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyRefresh') ScriptApp.deleteTrigger(t);
  });
  // The EASi report is regenerated a little after 7:00 Eastern; refresh after it lands.
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyDays(1).atHour(7).nearMinute(30).inTimezone('America/Chicago').create();
  // A second pass keeps the cache warm through the work day (the cache holds a snapshot for at most 6 hours).
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyHours(4).create();
  var msg = 'Set up: ' + dataset.prs.length + ' Zone ' + dataset.zone + ' PRs across ' + dataset.offices.length +
    ' field offices (report generated ' + (dataset.generatedAt || 'unknown') + '). Refresh scheduled daily at 7:30 Central and every 4 hours.';
  console.log(msg);
  return msg;
}

/** Trigger handler: rebuild the snapshot. */
function dailyRefresh() {
  refreshDataset_();
}
