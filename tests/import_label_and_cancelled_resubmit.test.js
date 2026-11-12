// TWO WAYS A LIVE RESPONSE WAS DROPPED WITHOUT A WORD (Low Cost Wills form,
// 1FRC6rl879UX3HO_-CiRXiBRi9fwN-swKo_TaDjYKlrQ).
//
// (1) A program moved to another building (99zy) leaves a form whose rows span
//     two buildings, so buildRegistryIndex() expects "· Building" on every
//     label, while the calendar side had written labels without it — every
//     response matched no session. Pinned: either spelling resolves when only
//     one session can be meant, an ambiguous one does not, the aliases never
//     show up as extra sessions, and the calendar side now asks the form's rows.
// (2) A cancelled row is protected (Manual_Override), and that protection also
//     turned away the person's NEXT submission. Pinned: a live submission with
//     a new Party_ID replaces a cancelled row; the cancelled response re-read,
//     a catch-up, and a protected Active row are all still refused.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    },
    getUuid: () => `uuid-${++uuidN}`,
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => ({ getSheetByName: () => ({}) }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.buildRegistryIndex = buildRegistryIndex;
this.resolveSessionLabelForForm = resolveSessionLabelForForm;
this.formatSessionLabel = formatSessionLabel;
this.formShowsLocationForGroup = formShowsLocationForGroup;
this.buildRegistrantRow = buildRegistrantRow;
this.takeImportLedgerEntries = takeImportLedgerEntries;
this.setSessionRows = function (rows) { getSectionedRows = function () { return rows; }; };
this.setShared = function (ids) { getSharedFormIdSet = function () { return new Set(ids); }; };
readLedgerEntries = function () { return []; };
getRegistrantTombstone = function () { return null; };
computeOrderAheadFlag = function () { return ''; };
`, sandbox, { filename: 'program.gs' });

const { HEADERS, getIndexMap, buildRegistryIndex, resolveSessionLabelForForm, formatSessionLabel,
  formShowsLocationForGroup, buildRegistrantRow, takeImportLedgerEntries, setSessionRows, setShared } = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

// ---- (1) labels ----------------------------------------------------------
const FORM = '1FRC6rl879UX3HO_-CiRXiBRi9fwN-swKo_TaDjYKlrQ';
const smap = getIndexMap(HEADERS.All_Program_Sessions);
function sessionRow(formId, date, location, eventId) {
  const r = new Array(HEADERS.All_Program_Sessions.length).fill('');
  r[smap['Form_ID']] = formId;
  r[smap['Event_Date']] = date;
  r[smap['Location']] = location;
  r[smap['Clean_Title']] = 'Low Cost Wills';
  r[smap['Event_ID']] = eventId;
  return r;
}
const oct = new Date(2026, 9, 6), nov = new Date(2026, 10, 17), dec = new Date(2026, 11, 1);
setShared([]);
setSessionRows([
  sessionRow(FORM, oct, 'Narberth', 'n|Low Cost Wills|2026-10-06'),
  sessionRow(FORM, nov, 'Ashbridge', 'a|Low Cost Wills|2026-11-17'),
  sessionRow(FORM, dec, 'Ashbridge', 'a|Low Cost Wills|2026-12-01'),
  // Two buildings on one day: the bare date is genuinely ambiguous.
  sessionRow('F2', nov, 'Narberth', 'n|X|2026-11-17'),
  sessionRow('F2', nov, 'Ashbridge', 'a|X|2026-11-17')
]);
const index = buildRegistryIndex({});
const withLoc = formatSessionLabel(nov, 'Ashbridge', true, '', false);
const bare = formatSessionLabel(nov, 'Ashbridge', false, '', false);
check('the index keys a moved program with its building', !!index[`${FORM}|${withLoc}`], true);
check('the labelled spelling resolves as before', resolveSessionLabelForForm(index, FORM, withLoc), withLoc);
check('the bare spelling resolves to the one session it can mean',
  resolveSessionLabelForForm(index, FORM, bare), withLoc);
check('...with a meal/capacity hint on it too',
  resolveSessionLabelForForm(index, FORM, `${bare} — Turkey wrap`), withLoc);
check('a bare date naming two buildings stays unresolved',
  resolveSessionLabelForForm(index, 'F2', bare), '');
check('aliases are not enumerable sessions',
  Object.keys(index).filter(k => k.startsWith(`${FORM}|`)).length, 3);
check('an unknown label still resolves to nothing',
  resolveSessionLabelForForm(index, FORM, formatSessionLabel(new Date(2026, 11, 25), 'Ashbridge', false, '', false)), '');

// The reverse: a one-building form whose labels somehow carry the building.
setSessionRows([sessionRow('F3', dec, 'Narberth', 'n|Y|2026-12-01')]);
const index3 = buildRegistryIndex({});
const bare3 = formatSessionLabel(dec, 'Narberth', false, '', false);
check('a label with an unexpected building resolves to the bare session',
  resolveSessionLabelForForm(index3, 'F3', formatSessionLabel(dec, 'Narberth', true, '', false)), bare3);

// The calendar side asks the same question the index does.
setSessionRows([
  sessionRow(FORM, oct, 'Narberth', 'n|Low Cost Wills|2026-10-06'),
  sessionRow(FORM, nov, 'Ashbridge', 'a|Low Cost Wills|2026-11-17')
]);
check('calendar side: a moved program names its building',
  formShowsLocationForGroup(FORM, { isShared: false, locations: ['Ashbridge'] }), true);
check('calendar side: a one-building form does not',
  formShowsLocationForGroup('F9', { isShared: false, locations: ['Ashbridge'] }), false);
check('calendar side: [Shared] always does', formShowsLocationForGroup('', { isShared: true }), true);
check('calendar side: a brand-new form follows its group', formShowsLocationForGroup('', { isShared: false }), false);
setShared(['F9']);
check('calendar side: a registry-shared form does', formShowsLocationForGroup('F9', { isShared: false }), true);
setShared([]);

// ---- (2) cancelled, then registered again ---------------------------------
const rmap = getIndexMap(HEADERS.All_Registrants);
const entry = {
  eventId: 'a|Low Cost Wills|2026-11-17', eventDate: nov, location: 'Ashbridge',
  cleanTitle: 'Low Cost Wills', eventTime: '10:00 AM', maxCapacity: 0
};
const key = `${entry.eventId}|jane smith|Registrant`;
function existing(status, partyId, override) {
  const r = new Array(HEADERS.All_Registrants.length).fill('');
  r[rmap['Event_ID']] = entry.eventId;
  r[rmap['Name']] = 'Jane Smith';
  r[rmap['Person_Type']] = 'Registrant';
  r[rmap['Program_Status']] = status;
  r[rmap['Party_ID']] = partyId;
  r[rmap['Manual_Override']] = override || 'Manually Edited';
  return r;
}
function build(row, extra) {
  return buildRegistrantRow(Object.assign({
    registryEntry: entry, name: 'Jane Smith', personType: 'Registrant', lunchType: 'No Lunch',
    primaryRegistrant: 'Self', adminNotes: '', formEditUrl: '',
    protectedKeys: new Set([key]), existingRowIndex: new Map([[key, row]]),
    submittedAt: new Date(2026, 10, 10), orderAheadDays: 3, partyId: 'resp-2', partySize: 1,
    fromLiveSubmission: true
  }, extra || {}));
}

let old = existing('Cancelled', 'resp-1');
let made = build(old);
check('a new submission after a cancellation makes a row', !!made, true);
check('...which is Active', made && made[rmap['Program_Status']], 'Active');
check('...and the cancelled row is superseded by it', old[rmap['Program_Status']], 'Superseded');
check('...and the ledger hears both', takeImportLedgerEntries().map(e => e.kind).sort(), ['registered', 'superseded']);

old = existing('Cancelled', 'resp-1');
check('the cancelled response itself re-read is still refused', build(old, { partyId: 'resp-1' }), null);
check('...and the row stays cancelled', old[rmap['Program_Status']], 'Cancelled');

old = existing('Cancelled', 'resp-1');
check('a catch-up (not a live submission) is still refused', build(old, { fromLiveSubmission: false }), null);

old = existing('Active', 'resp-1');
check('a protected Active row still refuses a new submission', build(old), null);
check('...and is untouched', old[rmap['Program_Status']], 'Active');

old = existing('Cancelled', '');
check('a desk-cancelled row with no Party_ID gives way too', !!build(old), true);
takeImportLedgerEntries();

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall import label / cancelled-resubmit checks passed');
