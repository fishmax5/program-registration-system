// REGISTRATION ON SOMEBODY ELSE'S SITE (99zh_external_registration_links.gs).
//
// Pins: what counts as an outside address (an Amilia link with no scheme, yes;
// a Google Form, no; free text, no), the store's round trip and its undo, that
// the group handed to the form builder loses exactly the outside dates, that
// the calendar line is one stripAllRegistrationLines() takes back off (or it
// would stack a copy per rewrite), and that the row write clears Form_ID and
// the edit link, sets the view link, and leaves the other rows byte-identical.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const store = {};

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    computeDigest: (a, raw) => Array.from(require('crypto').createHash('md5').update(String(raw)).digest()),
    DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {}, Charset: { UTF_8: 'UTF-8' }
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
    deleteProperty: k => { delete store[k]; }
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, Calendar: {}, CacheService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }), getActiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.normalizeExternalRegistrationUrl = normalizeExternalRegistrationUrl;
this.externalRegistrationUrlForEventId = externalRegistrationUrlForEventId;
this.forgetExternalRegistrationLinks = forgetExternalRegistrationLinks;
this.groupWithoutExternalSessions = groupWithoutExternalSessions;
this.buildExternalRegistrationLinkLine = buildExternalRegistrationLinkLine;
this.stripAllRegistrationLines = stripAllRegistrationLines;
this.writeExternalLinkOntoSessions = writeExternalLinkOntoSessions;
this.computeEventId = computeEventId;
this.EXTERNAL_REGISTRATION_LINK_LABEL = EXTERNAL_REGISTRATION_LINK_LABEL;
// A one-zone session table, in memory.
findProgramSessionHeaderRows = () => [1];
getHeaderMapAt = () => this.__sheetMap;
getZoneDataRange = () => ({ start: 2, count: this.__grid.length });
invalidateSectionedRowsCache = () => {};
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

// ---- what counts as an outside address ----
const AMILIA = 'app.amilia.com/store/en/phillyjcc/api/Activity/Detail?activityId=k1jBVRQ';
ok('an Amilia link with no scheme is taken, https added',
  sandbox.normalizeExternalRegistrationUrl(AMILIA) === `https://${AMILIA}`);
ok('a full https link is taken as is',
  sandbox.normalizeExternalRegistrationUrl(`https://${AMILIA}`) === `https://${AMILIA}`);
ok('a Google Form is never an outside link',
  sandbox.normalizeExternalRegistrationUrl('https://docs.google.com/forms/d/e/1FAIpQ/viewform') === '' &&
  sandbox.normalizeExternalRegistrationUrl('https://forms.gle/abc123') === '');
ok('free text is not a link',
  sandbox.normalizeExternalRegistrationUrl('Chair Yoga') === '' &&
  sandbox.normalizeExternalRegistrationUrl('see amilia') === '');
ok('a quote cannot reach a HYPERLINK formula',
  sandbox.normalizeExternalRegistrationUrl('https://x.com/a"b') === '');

// ---- the calendar line comes back off ----
const url = `https://${AMILIA}`;
const line = sandbox.buildExternalRegistrationLinkLine('Chair Yoga', url);
const stripped = sandbox.stripAllRegistrationLines(`${line}\nBring a mat.`);
ok('the outside line is recognized as ours and stripped',
  stripped.removed === 1 && stripped.text.indexOf('amilia') === -1 && stripped.text.indexOf('Bring a mat.') !== -1,
  JSON.stringify(stripped));

// ---- the row write ----
const headers = ['Event_Date', 'Event_ID', 'Form_ID', 'Form_Response_Link', 'Edit_Form_Link'];
sandbox.__sheetMap = {};
headers.forEach((h, i) => { sandbox.__sheetMap[h] = i + 1; });
const future = new Date(); future.setDate(future.getDate() + 7);
const formLink = '=HYPERLINK("https://docs.google.com/forms/d/e/x/viewform","View Live Form")';
const editLink = '=HYPERLINK("https://docs.google.com/forms/d/FORMID/edit","Edit Form Settings")';
sandbox.__grid = [
  [future, 'evMOVE', 'FORMID', formLink, editLink],
  [future, 'evSTAY', 'FORMID', formLink, editLink]
];
const grid = sandbox.__grid;
const range = (row, col) => ({
  getValues: () => grid.map(r => [String(r[col - 1]).indexOf('=') === 0 ? 'label' : r[col - 1]]),
  getFormulas: () => grid.map(r => [String(r[col - 1]).indexOf('=') === 0 ? r[col - 1] : '']),
  setValues: vals => vals.forEach((v, i) => { grid[i][col - 1] = v[0]; })
});
const sheet = { getRange: (row, col) => range(row, col) };

const moved = sandbox.writeExternalLinkOntoSessions(sheet, new Set(['evMOVE']), url);
ok('one row moved', moved === 1, String(moved));
ok('the moved row has no Form_ID and no edit link',
  grid[0][2] === '' && grid[0][4] === '');
ok('the moved row links to the outside site',
  grid[0][3] === `=HYPERLINK("${url}","${sandbox.EXTERNAL_REGISTRATION_LINK_LABEL}")`, grid[0][3]);
ok('the row not moving keeps its formulas byte-identical',
  grid[1][2] === 'FORMID' && grid[1][3] === formLink && grid[1][4] === editLink);
ok('the store remembers it', sandbox.externalRegistrationUrlForEventId('evMOVE') === url);
ok('a second press moves nothing',
  sandbox.writeExternalLinkOntoSessions(sheet, new Set(['evMOVE']), url) === 0);

// ---- the form builder never sees an outside date ----
const ev = d => ({ getStartTime: () => d });
const d1 = new Date(future); const d2 = new Date(future); d2.setDate(d2.getDate() + 7);
const outsideId = sandbox.computeEventId('cal1', 'Chair Yoga', `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-${pad(d1.getDate())}`);
grid.push([d1, outsideId, 'FORMID', formLink, editLink]);
sandbox.writeExternalLinkOntoSessions(sheet, new Set([outsideId]), url);
const e1 = ev(d1), e2 = ev(d2);
const group = { cleanTitle: 'Chair Yoga', sessions: [{ event: e1, calendarId: 'cal1' }, { event: e2, calendarId: 'cal1' }], events: [e1, e2] };
const formGroup = sandbox.groupWithoutExternalSessions(group);
ok('the form group drops the outside date and keeps the other',
  formGroup.sessions.length === 1 && formGroup.sessions[0].event === e2 && formGroup.events[0] === e2);
ok('the group itself is not mutated', group.sessions.length === 2);

// ---- undo ----
ok('forgetting drops it', sandbox.forgetExternalRegistrationLinks([outsideId, 'evMOVE']) === 2 &&
  sandbox.externalRegistrationUrlForEventId('evMOVE') === '');
ok('with nothing outside, the group comes back as itself', sandbox.groupWithoutExternalSessions(group) === group);

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall external registration link tests passed');
