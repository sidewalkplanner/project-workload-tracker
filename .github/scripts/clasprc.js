/**
 * Writes ~/.clasprc.json for clasp 2.4.2 from the CLASPRC_JSON secret. Accepts the key
 * made by clasp 2.x ({ token, oauth2ClientSettings }) or by clasp 3.x
 * ({ tokens: { default: { client_id, client_secret, refresh_token, ... } } }), which is
 * what Cloud Shell's built-in `clasp login` makes. Prints only the key's shape, never values.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function fail(message) {
  console.log('::error::' + message + " See docs/DEPLOYMENT.md, 'Automatic updates from GitHub'.");
  process.exit(1);
}

const raw = String(process.env.CLASPRC_JSON || '').trim();
if (!raw) fail('The CLASPRC_JSON secret is missing.');
let key;
try {
  key = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
} catch (e) {
  fail('The CLASPRC_JSON secret is not valid JSON (' + raw.length + ' characters). Paste the whole output of `cat ~/.clasprc.json`, from the first { to the last }.');
}

let out = null;
if (key.token && key.token.refresh_token && key.oauth2ClientSettings) {
  console.log('Sign-in key: clasp 2 format.');
  out = key;
} else if (key.tokens && typeof key.tokens === 'object') {
  const t = key.tokens.default || key.tokens[Object.keys(key.tokens)[0]];
  if (!t || !t.refresh_token || !t.client_id || !t.client_secret) fail('The CLASPRC_JSON secret is a clasp 3 key without a refresh token or client ID.');
  console.log('Sign-in key: clasp 3 format (converted for clasp 2.4.2).');
  out = {
    token: { access_token: t.access_token || '', refresh_token: t.refresh_token, scope: t.scope || '', token_type: 'Bearer', expiry_date: 1 },
    oauth2ClientSettings: { clientId: t.client_id, clientSecret: t.client_secret, redirectUri: 'http://localhost' },
    isLocalCreds: false
  };
} else {
  fail('The CLASPRC_JSON secret is JSON but not a clasp sign-in key (top-level keys: ' + Object.keys(key).join(', ') + ').');
}
const file = path.join(os.homedir(), '.clasprc.json');
fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
