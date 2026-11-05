/**
 * The only functions the page calls (google.script.run.api*). Everyone who can open
 * the web app sees the same data; the sheets themselves are never changed.
 */

/**
 * The page's data, as a JSON string (faster to send).
 * opts.packed: compacted and gzipped (base64) for the page to unpack: who is signed in, the
 * shared part (gz) and their enterprise's open projects (parts; Data.gs firstLoad_).
 * opts.part = 'rest' with opts.have (the parts the page has), opts.want (enterprise names, or
 * 'all') and opts.later: those enterprises' open projects, and the paid-in-full projects and
 * service contracts.
 * Otherwise the whole snapshot as data.
 */
function apiLoad(opts) {
  var packed = loadPacked_();
  if (opts && opts.part === 'rest') return JSON.stringify(restLoad_(packed, opts.have, opts.want || 'all', opts.later !== false));
  var user = currentUser_(packed.meta);
  if (opts && opts.packed) return JSON.stringify(firstLoad_(packed, user));
  return JSON.stringify({ user: user, data: unpackDataset_(packed) });
}

/**
 * Reads the sources again. Anyone may ask, but only once every 10 minutes unless they are an
 * admin. The answer says what happened (refresh: 'done' | 'recent' | 'busy'), so the page can tell them.
 */
function apiRefresh(opts) {
  var user = currentUser_(null);
  var props = PropertiesService.getScriptProperties();
  var last = {};
  try { last = JSON.parse(props.getProperty('LAST_REFRESH') || '{}'); } catch (e) { last = {}; }
  var age = last.at ? Date.now() - new Date(last.at).getTime() : Infinity;
  if (!user.isAdmin && age < 10 * 60 * 1000) return withNote_(apiLoad(opts), 'recent');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return withNote_(apiLoad(opts), 'busy');
  try {
    refreshDataset_();
  } finally {
    lock.releaseLock();
  }
  return withNote_(apiLoad(opts), 'done');
}

function withNote_(json, note) {
  return json.replace(/^\{/, '{"refresh":' + JSON.stringify(note) + ',');
}
