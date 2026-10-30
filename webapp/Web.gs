/**
 * Web app entry point. The page loads its data with apiLoad() after it opens, so the
 * first paint is quick even when the snapshot has to be rebuilt.
 *
 * URL parameters set the starting view and filters, for links people share:
 *   ?view=overview | projects | workload
 *   &office=<field office>  &sc=<service center>  &program=BA61,BA80  &status=open | preaward | awarded | expended | all
 *   &fy=2026  &type=projects | all | service  &role=cor  &person=<email>  &q=<search>
 */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var template = HtmlService.createTemplateFromFile('Index');
  // The data comes inside the page when the snapshot is ready (cache or saved copy), saving
  // the page a second trip to the server; otherwise the page asks for it (and it gets built).
  var preload = null;
  try {
    var packed = cachedOrSavedPacked_();
    if (packed) preload = { user: currentUser_(packed.meta), gz: packed.gz };
  } catch (err) {
    console.warn('Page opened without its data: ' + err);
  }
  template.bootJson = safeJsonForHtml_({ app: APP, route: routeFromParams_(params), preload: preload });
  return template.evaluate()
    .setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function routeFromParams_(params) {
  var route = {};
  ['view', 'office', 'sc', 'zone', 'program', 'status', 'fy', 'type', 'team', 'role', 'person', 'q', 'sort', 'group', 'planned'].forEach(function (key) {
    var value = str_(params[key]).slice(0, 160);
    if (value && !/[\u0000-\u001f\u007f<>]/.test(value)) route[key] = value;
  });
  return route;
}

/** Used by Index.html: <?!= include('Styles') ?> */
function include(name) {
  if (!/^(Styles|Js[A-Za-z]+)$/.test(String(name))) throw new Error('Unknown include: ' + name);
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** JSON that can sit inside a <script> tag without ending it early. */
function safeJsonForHtml_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
