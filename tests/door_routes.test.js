// THE DOOR'S ROUTE TABLE (section 16) — which URL gets which page.
//
// doGet() serves three pages off ONE deployment address, told apart by
// ?mode= alone, and the ways that goes wrong are all silent: a tablet on
// the wrong page looks like a working tablet, and a member sent to a page
// that asks for a staff PIN phones the office instead of cancelling.
//
// So this file pins the routing itself, spelling by spelling:
//
//   1. EVERY ACCEPTED SPELLING STILL LANDS WHERE IT DID. These strings are
//      typed by hand onto tablets and printed onto cards; dropping one is
//      dropping somebody's bookmark.
//   2. THE CANCEL PAGE IS ANSWERED FIRST, and without a PIN — it is the only
//      one of these opened by a member rather than by staff.
//   3. AN UNRECOGNIZED ?mode= IS THE DOOR APP, not an error page. A URL that
//      has been through a QR generator and back collects parameters — and so
//      is the retired walk-in page's own ?mode=walkin/walk-in/legacy (see
//      62_walk_in_page.gs): a bookmark carrying one still opens a working
//      page.
//   4. checkInPageUrl() SPELLS ITS ?mode= THE WAY THE TABLE DOES, because a
//      link built by hand that disagrees with the router is the whole reason
//      the table exists.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: () => '2025-09-02', getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key === 'CHECK_IN_WEB_APP_URL'
        ? 'https://script.google.com/macros/s/ABC/exec' : null),
      setProperty: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, LockService: {},
  HtmlService: {
    // Enough of an HtmlOutput to record what doGet() decided.
    createHtmlOutput: html => ({
      html,
      title: '',
      metaTags: [],
      setTitle(t) { this.title = t; return this; },
      addMetaTag(name, content) { this.metaTags.push(`${name}=${content}`); return this; }
    })
  },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + ';this.HEADERS = HEADERS;', sandbox, { filename: 'program.gs' });

// The pages themselves are tested elsewhere; here each one says only its own
// name, so what a request routed to is readable in one string.
sandbox.buildCancelPageHtml = opts => `PAGE:cancel form=${opts.formId}`;
sandbox.cancelPageProgramLabel = () => 'Chair Yoga';
sandbox.readyCheckInSessionIndex = () => ({ sessions: [] });
sandbox.buildCheckInHtml = (index, opts) => `PAGE:roster page=${opts.page}`;
sandbox.buildDoorAppHtml = opts => `PAGE:door location=${opts.location}`;

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

function served(params) {
  return sandbox.doGet({ parameter: params });
}

// ---------------------------------------------------------------------------
// 1. Every spelling routes where it did.
// ---------------------------------------------------------------------------
const ROUTED = [
  [{}, 'door', 'a bare URL is the door app'],
  [{ location: 'Narberth' }, 'door', '?location= alone is still the door app'],
  [{ mode: 'session' }, 'roster', '?mode=session'],
  [{ mode: 'sessions' }, 'roster', '?mode=sessions'],
  [{ mode: 'checkin' }, 'roster', '?mode=checkin'],
  [{ mode: 'check-in' }, 'roster', '?mode=check-in'],
  [{ mode: 'roster' }, 'roster', '?mode=roster'],
  [{ mode: 'SESSION' }, 'roster', '?mode=SESSION — case is not a spelling'],
  [{ view: 'session' }, 'roster', '?view=session'],
  [{ page: 'checkin' }, 'roster', '?page=checkin'],
  // The retired door page's spellings are not errors — they fall through to
  // whatever an unrecognized ?mode= gets, same as any other stale bookmark.
  [{ mode: 'walkin' }, 'door', '?mode=walkin (retired page, falls through)'],
  [{ mode: 'walk-in' }, 'door', '?mode=walk-in (retired page, falls through)'],
  [{ mode: 'legacy' }, 'door', '?mode=legacy (retired page, falls through)'],
  [{ mode: 'WALK-IN' }, 'door', '?mode=WALK-IN (retired page, falls through)'],
  [{ view: 'walkin' }, 'door', '?view=walkin (retired page, falls through)'],
  [{ mode: 'cancel', form: 'FORM123' }, 'cancel', '?mode=cancel&form='],
  [{ mode: 'Cancel', form: 'FORM123' }, 'cancel', '?mode=Cancel&form='],
  // A cancel link that lost its ?form= cancels nothing, so it is not the
  // cancel page: it falls through to what any unrecognized URL gets.
  [{ mode: 'cancel' }, 'door', '?mode=cancel with no form'],
  [{ mode: 'zzz' }, 'door', 'an unrecognized ?mode='],
  [{ mode: '' }, 'door', 'an empty ?mode=']
];
ROUTED.forEach(([params, page, name]) => {
  ok(`${name} → ${page}`, served(params).html.indexOf(`PAGE:${page}`) === 0);
});

ok('?mode=session&page=register opens the roster on its register screen',
  served({ mode: 'session', page: 'register' }).html === 'PAGE:roster page=register');
ok('?mode=session alone opens it on check-in',
  served({ mode: 'session' }).html === 'PAGE:roster page=checkin');

// ---------------------------------------------------------------------------
// 2. What each route is handed, and the wrapper around it.
// ---------------------------------------------------------------------------
ok('the cancel page is handed the form id from the URL',
  served({ mode: 'cancel', form: 'FORM123' }).html === 'PAGE:cancel form=FORM123');
ok('the door app is handed the matched ?location= pin',
  served({ location: 'Narberth' }).html === 'PAGE:door location=Narberth');
ok('an unknown building is not pinned',
  served({ location: 'Atlantis' }).html === 'PAGE:door location=');

ok('every page says which one it is in the tab',
  served({ mode: 'cancel', form: 'F' }).title === 'Cancel Your Place' &&
  served({ mode: 'session' }).title === 'Check In' &&
  served({ mode: 'walkin' }).title === 'Sign In' &&
  served({}).title === 'Sign In');
// The tablet case is the entire point of the page, on every route.
ok('every page carries the viewport meta tag',
  ROUTED.every(([params]) => served(params).metaTags
    .indexOf('viewport=width=device-width, initial-scale=1') !== -1));

// ---------------------------------------------------------------------------
// 3. The links and the router read the same table.
// ---------------------------------------------------------------------------
const BASE = 'https://script.google.com/macros/s/ABC/exec';
ok('no mode asked for, no mode in the URL', sandbox.checkInPageUrl({}) === BASE);
ok('mode: session', sandbox.checkInPageUrl({ mode: 'session' }) === `${BASE}?mode=session`);
ok('mode: cancel', sandbox.checkInPageUrl({ mode: 'cancel' }) === `${BASE}?mode=cancel`);
// An alternative spelling of a route comes back as the route's own spelling,
// which is the point of building the URL from the table rather than by hand.
ok('mode: check-in is written out as the route it reaches',
  sandbox.checkInPageUrl({ mode: 'check-in' }) === `${BASE}?mode=session`);
// walkin/walk-in are not a route any more (the page they named is retired),
// so a caller asking for one by name gets back exactly what it asked for —
// doorRouteUrlMode_() only rewrites a name a route actually claims.
ok('mode: walk-in is handed back unchanged — no route claims it',
  sandbox.checkInPageUrl({ mode: 'walk-in' }) === `${BASE}?mode=walk-in`);
ok('a location and a mode travel together',
  sandbox.checkInPageUrl({ location: 'Narberth', mode: 'session' }) ===
    `${BASE}?location=Narberth&mode=session`);
// Every ?mode= the table can produce has to route back to the route that
// produced it — that is the drift this table exists to prevent.
sandbox.DOOR_ROUTES.forEach(route => {
  if (!route.mode) return;
  const url = sandbox.checkInPageUrl({ mode: route.id });
  const mode = url.split('mode=')[1];
  const params = route.id === 'cancel' ? { mode, form: 'F' } : { mode };
  let matched = '';
  sandbox.DOOR_ROUTES.forEach(r => { if (!matched && r.match(params)) matched = r.id; });
  ok(`the URL for "${route.id}" routes back to "${route.id}"`, matched === route.id);
});

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
