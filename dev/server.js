/**
 * Local preview: serves the web app through the mocked Apps Script runtime and
 * answers google.script.run calls over HTTP.
 *
 *   node dev/server.js [--port 8080] [--sources sources.json]
 *
 * Without --sources it uses made-up demo data. Open http://localhost:8080/?as=<email>
 * to look as someone else (sam.foothills@gsa.gov manages the demo Denver FC office;
 * pat.viewer@gsa.gov has org code PMCFB, Iowa, in the stand-in directory below).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const url = require('url');
const { createRuntime, sheetsFrom } = require('./gas-mock');
const { demoSources, demoDirectory } = require('./demo-data');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const PORT = Number(arg('port', 8080));
const file = arg('sources', null);
const sources = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : demoSources();
// A stand-in for the GSA directory: display names end in the person's org code.
const directoryNames = Object.assign(file ? {} : demoDirectory(sources), {
  'pat.viewer@gsa.gov': 'Pat Viewer - PMCFB',
  'robin.center@gsa.gov': 'Robin Center - PMCG',
  'casey.denver@gsa.gov': 'Casey Denver - PMCGC'
});
const rt = createRuntime({ quiet: true, owner: 'owner@gsa.gov', sheets: sheetsFrom(sources), directoryNames });

const SHIM = `
<script>
(function () {
  var params = new URLSearchParams(location.search);
  var who = params.get('as') || sessionStorage.getItem('as') || '';
  if (who) sessionStorage.setItem('as', who);
  function call(fn, args, ok, fail) {
    fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: fn, args: args, as: who }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res.__error) fail && fail(new Error(res.__error)); else ok && ok(res.value); })
      .catch(function (e) { fail && fail(e); });
  }
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner(fn, fail); };
        if (prop === 'withFailureHandler') return function (fn) { return runner(ok, fn); };
        return function () { var args = Array.prototype.slice.call(arguments); setTimeout(function () { call(prop, args, ok, fail); }, 150); };
      }
    });
  }
  window.google = { script: { run: runner(null, null), history: { replace: function (s, p) {
    var q = new URLSearchParams(p || {}); if (who) q.set('as', who);
    window.history.replaceState(null, '', '?' + q.toString());
  } } } };
})();
</script>`;

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (req.method === 'POST' && u.pathname === '/rpc') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { fn, args, as } = JSON.parse(body);
      rt.setUser(as || 'viewer@gsa.gov');
      let out;
      try {
        if (!/^api[A-Z]\w*$/.test(fn) || typeof rt.ctx[fn] !== 'function') throw new Error('Unknown function ' + fn);
        out = { value: rt.ctx[fn].apply(null, args || []) };
      } catch (e) {
        out = { __error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
  rt.setUser(u.query.as || 'viewer@gsa.gov');
  const page = rt.ctx.doGet({ parameter: u.query }).content.replace('<head>', '<head>' + SHIM);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}).listen(PORT, () => console.log('Preview on http://localhost:' + PORT + '/ (' + (file ? 'real data from ' + file : 'demo data') + ')'));
