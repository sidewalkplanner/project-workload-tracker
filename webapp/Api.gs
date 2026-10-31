/**
 * The only functions the page calls (google.script.run.api*). Everyone who can open
 * the web app sees the same data; the sheets themselves are never changed.
 */

/**
 * The page's data: the snapshot plus who is signed in, as a JSON string (faster to send).
 * opts.packed: send the snapshot compacted and gzipped (gz, base64) for the page to unpack: the
 * open projects; opts.part = 'later' sends the rest (paid in full, service contracts) on its own.
 * Otherwise the whole snapshot as data.
 */
function apiLoad(opts) {
  var packed = loadPacked_();
  if (opts && opts.part === 'later') return JSON.stringify({ gz: packed.gzLater || '' });
  var user = currentUser_(packed.meta);
  if (opts && opts.packed) return JSON.stringify({ user: user, gz: packed.gz });
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
