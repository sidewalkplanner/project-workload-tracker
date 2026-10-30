/**
 * A small stand-in for the Apps Script services the tracker uses, so the server
 * code (webapp/*.gs) runs in Node for tests and the local preview.
 *
 *   const rt = createRuntime({ user: 'someone@gsa.gov', sheets: { <id>: { <tab>: rows } } });
 *   rt.ctx.apiLoad()
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'webapp');

function createRuntime(opts) {
  opts = opts || {};
  const spreadsheets = {};
  const props = Object.assign({}, opts.properties || {});
  const cache = {};
  const triggers = [];
  const state = { user: opts.user || '', owner: opts.owner || 'owner@gsa.gov', reads: 0 };

  function sheetFor(rows, writable) {
    const sheet = {
      getDataRange() { return { getValues() { state.reads++; return rows.map((r) => r.slice()); } }; },
      getName() { return ''; },
      getSheetId() { return 1234; },
      getLastRow() { return rows.length; },
      clear() { rows.length = 0; },
      getRange(r, c, nr) {
        return {
          getValues() { state.snapshotReads = (state.snapshotReads || 0) + 1; return rows.slice(r - 1, r - 1 + nr).map((x) => x.slice()); },
          setValues(v) {
            if (!writable) throw new Error('read-only sheet');
            v.forEach((row, i) => { if (String(row[0]).length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.'); rows[r - 1 + i] = row.slice(); });
          }
        };
      }
    };
    return sheet;
  }
  function addSpreadsheet(id, tabs) {
    spreadsheets[id] = tabs;
  }
  Object.keys(opts.sheets || {}).forEach((id) => addSpreadsheet(id, opts.sheets[id]));

  const ctx = {
    console: opts.quiet ? { log() {}, warn() {}, error() {} } : console,
    SpreadsheetApp: {
      openById(id) {
        const tabs = spreadsheets[id];
        if (!tabs) throw new Error('Exception: You do not have permission to access the requested document (' + id + ').');
        const names = Object.keys(tabs);
        return {
          getId() { return id; },
          getSheetByName(name) { return tabs[name] ? sheetFor(tabs[name], tabs.__writable) : null; },
          getSheets() { return names.filter((n) => n !== '__writable').map((n) => sheetFor(tabs[n], tabs.__writable)); }
        };
      },
      create(name) {
        const id = 'created-' + Object.keys(spreadsheets).length;
        spreadsheets[id] = { Sheet1: [], __writable: true };
        state.created = (state.created || 0) + 1;
        return ctx.SpreadsheetApp.openById(id);
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
          setProperty(k, v) { props[k] = String(v); },
          setProperties(o) { Object.keys(o).forEach((k) => { if (String(o[k]).length > 9216) throw new Error('Argument too large: value'); props[k] = String(o[k]); }); }
        };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get(k) { return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null; },
          getAll(keys) { const o = {}; keys.forEach((k) => { if (k in cache) o[k] = cache[k]; }); return o; },
          putAll(values) {
            Object.keys(values).forEach((k) => {
              if (Buffer.byteLength(values[k], 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
            });
            Object.assign(cache, values);
          },
          remove(k) { delete cache[k]; }
        };
      }
    },
    People: {
      People: {
        listDirectoryPeople(q) {
          state.directoryCalls = (state.directoryCalls || 0) + 1;
          const all = Object.keys(opts.directoryNames || {});
          const start = Number(q.pageToken || 0);
          const size = Math.min(q.pageSize || 100, opts.directoryPageSize || 1000);
          const page = all.slice(start, start + size).map((e) => ({ names: [{ displayName: opts.directoryNames[e] }], emailAddresses: [{ value: e }] }));
          return { people: page, nextPageToken: start + size < all.length ? String(start + size) : undefined };
        },
        searchDirectoryPeople(q) {
          const names = opts.directoryNames || {};
          const email = String(q.query).toLowerCase();
          return names[email] ? { people: [{ names: [{ displayName: names[email] }], emailAddresses: [{ value: email }] }] } : { people: [] };
        }
      }
    },
    Utilities: {
      newBlob(data, type) {
        const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
        return { getBytes() { return bytes; }, getDataAsString() { return bytes.toString('utf8'); }, type };
      },
      gzip(blob) { return ctx.Utilities.newBlob(require('zlib').gzipSync(blob.getBytes())); },
      ungzip(blob) { return ctx.Utilities.newBlob(require('zlib').gunzipSync(blob.getBytes())); },
      base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); },
      base64Decode(text) { return Buffer.from(text, 'base64'); }
    },
    LockService: { getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; } },
    Session: {
      getActiveUser() { return { getEmail() { return state.user; } }; },
      getEffectiveUser() { return { getEmail() { return state.owner; } }; }
    },
    ScriptApp: {
      getProjectTriggers() { return triggers.slice(); },
      deleteTrigger(t) { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger(fn) {
        const b = { timeBased() { return b; }, everyDays() { return b; }, everyHours() { return b; }, atHour() { return b; }, nearMinute() { return b; }, inTimezone() { return b; },
          create() { const t = { getHandlerFunction() { return fn; } }; triggers.push(t); return t; } };
        return b;
      }
    },
    HtmlService: {
      createTemplateFromFile(name) {
        const tpl = { evaluate() { return renderTemplate(name, tpl); } };
        return tpl;
      },
      createHtmlOutputFromFile(name) {
        const html = fs.readFileSync(path.join(WEBAPP, name + '.html'), 'utf8');
        return { getContent() { return html; } };
      }
    }
  };
  vm.createContext(ctx);
  fs.readdirSync(WEBAPP).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(WEBAPP, f), 'utf8'), ctx, { filename: f });
  });

  function renderTemplate(name, vars) {
    let html = fs.readFileSync(path.join(WEBAPP, name + '.html'), 'utf8');
    html = html.replace(/<\?!=\s*include\('([A-Za-z]+)'\);?\s*\?>/g, (_, n) => ctx.include(n));
    html = html.replace(/<\?!=\s*([A-Za-z]+)\s*\?>/g, (_, v) => vars[v]);
    const out = { content: html, setTitle() { return out; }, addMetaTag() { return out; }, getContent() { return html; } };
    return out;
  }

  return {
    ctx, props, cache, triggers, state, addSpreadsheet, spreadsheets,
    setUser(email) { state.user = email; }
  };
}

/** Sheets for createRuntime() from tools/export_sheets.py output (or demo data). */
function sheetsFrom(sources) {
  const pipelineId = '1Z0CNVnAft_h4dwJeket99PDwobLMC7YS2zUN55zNlAU';
  const directoryId = '1jH7ffxNrT2rFl2P0p-SFFH9z_yYcsH4W2qnBMB_xuAw';
  const portalId = '1Vi0986jvcQ-45VQFY0JnGHSgimrQCc8DtpFIegUqG9Y';
  const ba54Id = '1yymDTl2sHxfFvh6oYIiiO6-J1e0w1z9aO4nxsaprHj8';
  const tabs = { Pipeline: sources.pipeline };
  if (sources.reportInfo && sources.reportInfo.length) {
    tabs['Report Info'] = sources.reportInfo.map((r) => r.map((v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v)));
  }
  return {
    [pipelineId]: tabs,
    [directoryId]: { Buildings: sources.buildings, 'Org Relationships': sources.org || [] },
    // The BA61 portal's data sheet, when the sources include it.
    ...(sources.portal ? { [portalId]: { Projects: sources.portal } } : {}),
    ...(sources.ba54 ? { [ba54Id]: { 'Current Program': sources.ba54 } } : {})
  };
}

module.exports = { createRuntime, sheetsFrom };
