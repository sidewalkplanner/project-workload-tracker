/**
 * Stage history: when each project reached the stage it is in, and the stages before. None of
 * the sources keep this, so the tracker records it itself on every refresh (in its saved-
 * snapshot sheet, Data.gs). It gives "days in this stage" and a timeline in each project's panel.
 *
 * A project seen for the first time takes a real date when its source has one (the award date,
 * the portal's decision date, the RWA's acceptance date); otherwise its stage is only known to
 * have started by the day the tracker first saw it ("known" is false). A stage change seen
 * between two refreshes is dated the day it was seen. Pure functions, tested in Node.
 *
 * It also follows the money after award: for awarded PRs, the amount Pegasys shows spent and
 * the day it last changed. A payment stream that stops is the best sign there is (without
 * Kahua, whose dates are too often stale) that work has stalled, or finished without closeout.
 *
 *   history: { v, started: 'yyyy-mm-dd', items: { key: { s: last seen, h: [[stage, date, known]],
 *              x: [spent, date it last changed, known] } } }
 */

var HISTORY_VERSION = 1;
var HISTORY_KEEP = 12;            // stage changes kept per project
var HISTORY_FORGET_DAYS = 400;    // a project gone this long is dropped

/** A project's key in the history: the PR number, or the plan's source and number. */
function historyKey_(p) {
  return p.source ? p.source + ':' + p.pr : p.pr;
}

/** The date the project's current stage began, when a source says ('' when none does). */
function stageSeedDate_(p) {
  if (p.seedDate) return p.seedDate;
  if ((p.stage === 'awarded' || p.stage === 'expended') && p.executed) return p.executed;
  return '';
}

/**
 * Records every project's stage and returns the updated history. Sets on each project:
 * since (when its current stage began), sinceKnown (true when that date is real, not just
 * the day tracking began) and history (earlier stages, oldest first); plans get their own
 * history, so a PR's panel can show the time before it had a PR.
 */
function updateHistory_(dataset, history, today) {
  var hist = history && history.v === HISTORY_VERSION && history.items ? history : { v: HISTORY_VERSION, started: today, items: {} };
  var fresh = hist.started === today;
  dataset.prs.forEach(function (p) {
    var key = historyKey_(p);
    var item = hist.items[key];
    if (!item) {
      var seed = stageSeedDate_(p);
      // New since tracking began: it reached this stage today. On the first day, only "by today".
      item = hist.items[key] = { h: [[p.stage, seed || today, seed || !fresh ? 1 : 0]] };
    } else {
      var last = item.h[item.h.length - 1];
      if (last[0] !== p.stage) {
        item.h.push([p.stage, today, 1]);
        if (item.h.length > HISTORY_KEEP) item.h.splice(0, item.h.length - HISTORY_KEEP);
      }
    }
    item.s = today;
    if (!p.source && (p.stage === 'awarded' || p.stage === 'expended')) {
      // Nothing spent yet: the clock runs from the award. Otherwise from the last change seen.
      var spent = round2_(p.expended || 0);
      if (!item.x) item.x = spent > 0 ? [spent, today, fresh ? 0 : 1] : [0, p.executed || today, p.executed || !fresh ? 1 : 0];
      else if (Math.abs(item.x[0] - spent) >= 0.01) item.x = [spent, today, 1];
      p.spentSince = item.x[1];
      if (item.x[2]) p.spentKnown = true;
    }
    var current = item.h[item.h.length - 1];
    p.since = current[1];
    if (current[2]) p.sinceKnown = true;
    if (item.h.length > 1) p.history = item.h.slice(0, -1);
    delete p.seedDate;
  });
  dataset.prs.forEach(function (p) {
    (p.plans || []).forEach(function (plan) {
      var item = hist.items[plan.source + ':' + plan.id];
      if (item) plan.history = item.h;
    });
  });
  var cutoff = addDays_(today, -HISTORY_FORGET_DAYS);
  Object.keys(hist.items).forEach(function (k) { if (hist.items[k].s < cutoff) delete hist.items[k]; });
  dataset.historyStarted = hist.started;
  return hist;
}

/** 'yyyy-mm-dd' plus n days. */
function addDays_(iso, n) {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date where the script runs (the project's time zone), as 'yyyy-mm-dd'. */
function todayIso_() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}
