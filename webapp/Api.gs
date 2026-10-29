/**
 * The only functions the page calls (google.script.run.api*). Everyone who can open
 * the web app sees the same Zone 5 data; the sheets themselves are never changed.
 */

/** The page's data: the snapshot plus who is signed in. Returned as a JSON string (faster to send). */
function apiLoad() {
  var json = loadDataset_();
  var dataset = JSON.parse(json);
  return JSON.stringify({ user: currentUser_(dataset), data: dataset });
}

/** Reads the sources again. Anyone may ask, but only once every 10 minutes unless they are an admin. */
function apiRefresh() {
  var user = currentUser_(null);
  var props = PropertiesService.getScriptProperties();
  var last = {};
  try { last = JSON.parse(props.getProperty('LAST_REFRESH') || '{}'); } catch (e) { last = {}; }
  var age = last.at ? Date.now() - new Date(last.at).getTime() : Infinity;
  if (!user.isAdmin && age < 10 * 60 * 1000) return apiLoad();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return apiLoad();
  try {
    refreshDataset_();
  } finally {
    lock.releaseLock();
  }
  return apiLoad();
}
