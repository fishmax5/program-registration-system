// THE LEADER'S WEB ROSTER PAGE (99zn) — who may see it, who may write it,
// and the move from the spreadsheet that must not lose a tick.
//
//   1. Roster_Delivery: blank/anything is Sheet; only Web writes; Both is a
//      read-only preview; Web with an un-moved sheet is read-only too — ONE
//      source of truth per program at a time.
//   2. Tokens: shape-checked, rotated and revoked links stop working, and no
//      token is ever written to the log.
//   3. A write: only the leader columns, only rows on THIS program's roster,
//      only the cells that moved; Dropped and Waitlisted go through `71`'s
//      writers; the ledger says `leader-page`; behind a sync it is queued
//      with the program key, never the token.
//   4. Cutover: frozen BEFORE the final read, the read's edits applied with
//      the `leader-sheet` source, settled only once they landed; a frozen
//      sheet is never pulled again; a program set back to Sheet is unfrozen
//      and redrawn.
//   5. Leader emails link to whichever delivery is active.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const store = {};
const cache = {};
const logs = [];
let uuid = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: () => '9:00 AM', sleep: () => {},
    getUuid: () => { uuid++; return `${String(uuid).padStart(8, '0')}-aaaa-bbbb-cccc-0123456789ab`; },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key === 'CHECK_IN_WEB_APP_URL'
        ? 'https://script.google.com/macros/s/ABC/exec' : (store[key] === undefined ? null : store[key])),
      setProperty: (key, value) => { store[key] = String(value); },
      deleteProperty: key => { delete store[key]; }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: key => (cache[key] === undefined ? null : cache[key]),
      put: (key, value) => { cache[key] = value; },
      remove: key => { delete cache[key]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: name => ({ getName: () => name }),
      getSpreadsheetTimeZone: () => 'America/New_York' }),
    ProtectionType: { SHEET: 'SHEET' }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, LockService: {}, HtmlService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }),
    getActiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });
const g = name => vm.runInContext(name, sandbox);
const HEADERS = g('HEADERS');
const LEADER_SHEET_HEADERS = g('LEADER_SHEET_HEADERS');
const ROSTER_DELIVERY = g('ROSTER_DELIVERY');

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// --- the shared stubs --------------------------------------------------------

sandbox.log = message => { logs.push(String(message)); };
sandbox.noteForAdmin = (cat, message) => { logs.push(`NOTE ${cat}: ${message}`); };
// The lock is the sync's business; here it simply runs.
sandbox.withScriptLock = (ms, fn) => fn();
sandbox.workbookHeldElsewhere = () => false;

let delivery = {};
sandbox.readRosterDeliveryByProgram_ = () => delivery;
let registry = {};
sandbox.getProgramLeaderSheetRegistry = () => registry;
sandbox.saveProgramLeaderSheetRegistryEntry = (key, entry) => { registry[key] = entry; };
sandbox.flushProgramLeaderSheetRegistry_ = () => {};

const PK = sandbox.leaderProgramKey('Chair Yoga', 'Narberth');
const OTHER = sandbox.leaderProgramKey('Bingo', 'Narberth');
const map = sandbox.getIndexMap(HEADERS.All_Registrants);
const sheetMap = sandbox.getIndexMap(LEADER_SHEET_HEADERS);
const futureDate = new Date(Date.now() + 5 * 86400000);

function regRow(name, status, extra) {
  const row = new Array(HEADERS.All_Registrants.length).fill('');
  row[map['Event_ID']] = 'EV1';
  row[map['Event']] = 'Chair Yoga';
  row[map['Event_Date']] = futureDate;
  row[map['Location']] = 'Narberth';
  row[map['Name']] = name;
  row[map['Program_Status']] = status || 'Active';
  row[map['Lunch_Status']] = 'No Lunch';
  Object.keys(extra || {}).forEach(k => { row[map[k]] = extra[k]; });
  return row;
}
const keyOf = row => sandbox.leaderRowKey(row[map['Event_ID']], row[map['Party_ID']], row[map['Name']]);
function rosterLine(row) {
  const out = new Array(LEADER_SHEET_HEADERS.length).fill('');
  out[sheetMap['Name']] = row[map['Name']];
  out[sheetMap['Row_Key']] = keyOf(row);
  return out;
}

// The Registrants tab, as the writer finds it, and what the writer puts back.
let grid = [];
let patches = [];
let ledger = [];
function useTab(rows) {
  grid = rows.map(r => r.slice());
  patches = [];
  ledger = [];
  sandbox.getSectionZones = () => [{ headerRow: 1, dataStart: 2, dataEnd: 1 + grid.length }];
  sandbox.readSheetGrid = () => ({ values: [HEADERS.All_Registrants.slice()].concat(grid) });
  sandbox.getSectionedRows = (sheet, headers) =>
    (headers === HEADERS.All_Registrants ? grid.map(r => r.slice()) : [sessionRow()]);
  sandbox.leaderRosterRowsByProgram_ = () => ({
    sessionRows: [sessionRow()],
    byProgram: { [PK]: grid.map(rosterLine), [OTHER]: [] }
  });
}
sandbox.writeRegistrantRowPatch_ = (sheet, m, sheetRow, patch) => {
  patches.push({ sheetRow, patch });
  Object.keys(patch).forEach(h => { grid[sheetRow - 2][m[h]] = patch[h]; });
  return 1;
};
sandbox.invalidateSectionedRowsCache = () => {};
sandbox.recomputeEventRegistryCounts = () => {};
sandbox.updateMasterLunchDashboard = () => {};
sandbox.appendLedgerEntry = entry => { ledger.push(entry); };
sandbox.ledgerEntryForCorrection_ = (row, m, payload, opts) =>
  ({ kind: 'corrected', source: opts.source, payload });
sandbox.ledgerEntryForStatusChange_ = (row, m, kind, stampOpts, ledgerOpts) =>
  ({ kind, source: ledgerOpts.source });
function sessionRow() {
  const s = new Array(HEADERS.All_Program_Sessions.length).fill('');
  const sm = sandbox.getIndexMap(HEADERS.All_Program_Sessions);
  s[sm['Event_ID']] = 'EV1';
  s[sm['Max_Capacity']] = 10;
  return s;
}

// --- 1. delivery --------------------------------------------------------------

ok('blank and junk read as Sheet', sandbox.normalizeRosterDelivery('') === 'Sheet' &&
  sandbox.normalizeRosterDelivery('spreadsheet') === 'Sheet');
ok('Web and Both are read case-blind', sandbox.normalizeRosterDelivery(' WEB ') === 'Web' &&
  sandbox.normalizeRosterDelivery('both') === 'Both');
ok('a program with no setting is on Sheet', sandbox.rosterDeliveryFor(PK) === 'Sheet');

delivery = {};
ok('Sheet: the page is read-only', sandbox.leaderRosterWriteState_(PK).writable === false);
delivery = { [PK]: { delivery: ROSTER_DELIVERY.BOTH, title: 'Chair Yoga', location: 'Narberth' } };
ok('Both: the page is read-only', sandbox.leaderRosterWriteState_(PK).writable === false);
delivery = { [PK]: { delivery: ROSTER_DELIVERY.WEB, title: 'Chair Yoga', location: 'Narberth' } };
registry = { [PK]: { fileId: 'FILE1', title: 'Chair Yoga', location: 'Narberth', pushedFingerprint: 'fp' } };
ok('Web with a sheet not yet moved: still read-only', sandbox.leaderRosterWriteState_(PK).writable === false);
sandbox.writeLeaderRosterCutover_({ [PK]: { frozenAt: 'x', settledAt: 'y' } });
ok('Web with the sheet moved: writable', sandbox.leaderRosterWriteState_(PK).writable === true);
sandbox.writeLeaderRosterCutover_({});
registry = {};
ok('Web with no sheet ever: writable at once', sandbox.leaderRosterWriteState_(PK).writable === true);

// --- 2. tokens ------------------------------------------------------------------

const token = sandbox.ensureLeaderRosterToken_(PK, 'Chair Yoga', 'Narberth');
ok('a token is long hex', /^[0-9a-f]{64}$/.test(token));
ok('the same program keeps its token', sandbox.ensureLeaderRosterToken_(PK, 'Chair Yoga', 'Narberth') === token);
ok('a token resolves to its program', sandbox.resolveLeaderRosterToken_(token).programKey === PK);
ok('a junk token resolves to nothing', sandbox.resolveLeaderRosterToken_('../etc') === null &&
  sandbox.resolveLeaderRosterToken_('') === null && sandbox.resolveLeaderRosterToken_('f'.repeat(64)) === null);
ok('the page link carries mode=roster and the token',
  sandbox.leaderRosterPageUrl(PK) === `https://script.google.com/macros/s/ABC/exec?mode=roster&t=${token}`);

// The staff actions refuse a call that did not come from an opened dialog.
ok('a staff action without the dialog key is refused',
  sandbox.leaderRosterPagesAction('', PK, 'revoke').ok === false &&
  sandbox.leaderRosterPagesAction('c'.repeat(64), PK, 'revoke').ok === false);
sandbox.listLeaderRosterPrograms_ = () => [{ key: PK, title: 'Chair Yoga', location: 'Narberth',
  delivery: 'Web', hasSheet: false, move: '', url: '' }];
const staffKey = sandbox.issueLeaderRosterStaffKey_();
ok('rotate answers ok', sandbox.leaderRosterPagesAction(staffKey, PK, 'rotate').ok === true);
const rotated = JSON.parse(store.LEADER_ROSTER_TOKENS_V1)[PK].token;
ok('after rotation the old link is dead and the new one works',
  rotated !== token && sandbox.resolveLeaderRosterToken_(token) === null &&
  sandbox.resolveLeaderRosterToken_(rotated).programKey === PK);
sandbox.leaderRosterPagesAction(staffKey, PK, 'revoke');
ok('after revoking, nothing opens', sandbox.resolveLeaderRosterToken_(rotated) === null);
ok('an invalid link is told so in plain words', sandbox.leaderRosterData(rotated).ok === false);
const live = sandbox.ensureLeaderRosterToken_(PK, 'Chair Yoga', 'Narberth');

// --- 3. writes ------------------------------------------------------------------

delivery = { [PK]: { delivery: ROSTER_DELIVERY.WEB, title: 'Chair Yoga', location: 'Narberth' } };
registry = {};
const joan = regRow('Joan Smith');
const ruth = regRow('Ruth Kaplan');
useTab([joan, ruth]);
sandbox.leaderRosterView = () => ({ ok: true });

let res = sandbox.leaderRosterMark(live, keyOf(joan), 'Contacted', true);
ok('a Contacted tick saves', res.ok === true && grid[0][map['Contacted']] === true);
ok('only the Contacted cell is patched', patches.length === 1 &&
  JSON.stringify(Object.keys(patches[0].patch)) === '["Contacted"]');
ok('the ledger is told, as the leader page', ledger.length === 1 && ledger[0].source === 'leader-page');

res = sandbox.leaderRosterMark(live, keyOf(joan), 'Contacted', true);
ok('the same tick again writes nothing', res.ok === true && res.changed === 0 && patches.length === 1);

ok('a column that is not the leader\'s is refused',
  sandbox.leaderRosterMark(live, keyOf(joan), 'Program_Status', 'Active').ok === false);
ok('a row not on this program\'s roster is refused (a forged key)',
  sandbox.leaderRosterMark(live, 'EV9||someone else', 'Contacted', true).ok === false);

useTab([joan, ruth]);
res = sandbox.leaderRosterMark(live, keyOf(ruth), 'Dropped', true);
ok('a Dropped tick is a cancellation, through 71', res.ok === true &&
  grid[1][map['Program_Status']] === 'Cancelled' && grid[1][map['Manual_Override']] === 'Manually Edited');
ok('...recorded as the leader page', ledger.some(e => e.kind === 'cancelled' && e.source === 'leader-page'));

useTab([regRow('Joan Smith'), regRow('Ruth Kaplan')]);
res = sandbox.leaderRosterMark(live, keyOf(ruth), 'Waitlisted', true);
ok('a Waitlisted tick waitlists them', grid[1][map['Program_Status']] === 'Waitlisted');
ok('...and only them', grid[0][map['Program_Status']] === 'Active');
res = sandbox.leaderRosterMark(live, keyOf(ruth), 'Waitlisted', false);
ok('unticking a leader\'s own waitlisting gives the seat back', grid[1][map['Program_Status']] === 'Active');

useTab([regRow('Joan Smith'), regRow('Ann Lee', 'Waitlisted', { Waitlisted: true })]);
res = sandbox.leaderRosterMark(live, keyOf(grid[1]), 'Waitlisted', false);
ok('unticking a capacity waitlisting does not jump the queue', res.ok === true &&
  grid[1][map['Program_Status']] === 'Waitlisted' && /waiting list/.test(res.message));

const notes = 'x'.repeat(900);
useTab([regRow('Joan Smith')]);
sandbox.leaderRosterMark(live, keyOf(grid[0]), 'Leader_Notes', notes);
ok('a note is capped', grid[0][map['Leader_Notes']].length === 500);

// Behind a sync: queued, carrying the program key and never the token.
let queued = null;
sandbox.workbookHeldElsewhere = () => true;
sandbox.queueOptimisticRetry = (kind, args) => { queued = { kind, args }; return true; };
useTab([regRow('Joan Smith')]);
res = sandbox.leaderRosterMark(live, keyOf(grid[0]), 'Confirmed', true);
ok('behind a sync the tick is queued', res.ok === true && res.queued === true && queued.kind === 'leaderRosterMark');
ok('...with the program key and not the token',
  queued.args.programKey === PK && JSON.stringify(queued.args).indexOf(live) === -1);
ok('...and nothing written yet', patches.length === 0);
sandbox.workbookHeldElsewhere = () => false;
ok('the queued tick applies through 99b', sandbox.applyQueuedOptimisticWrite({ kind: 'leaderRosterMark',
  args: queued.args }).ok === true && grid[0][map['Confirmed']] === true);

// Read-only programs refuse writes.
delivery = { [PK]: { delivery: ROSTER_DELIVERY.BOTH, title: 'Chair Yoga', location: 'Narberth' } };
useTab([regRow('Joan Smith')]);
ok('on Both the page refuses to write', sandbox.leaderRosterMark(live, keyOf(grid[0]), 'Contacted', true).ok === false &&
  patches.length === 0);

// --- 4. cutover -------------------------------------------------------------------

const events = [];
function fakeFile(sheetRows) {
  const protections = [];
  const tab = name => ({
    getName: () => name,
    getProtections: () => protections.slice(),
    protect: () => {
      events.push('protect');
      const p = {
        desc: '', warn: true, removed: false,
        setDescription(d) { this.desc = d; return this; },
        getDescription() { return this.desc; },
        setWarningOnly(w) { this.warn = w; return this; },
        getEditors: () => ['leader@x.org'],
        removeEditors() { events.push('removeEditors'); return this; },
        canDomainEdit: () => false,
        remove() { this.removed = true; protections.splice(protections.indexOf(this), 1); events.push('unprotect'); }
      };
      protections.push(p);
      return p;
    },
    getRange: () => ({ setValue(v) { events.push(`banner:${name}`); this.v = v; return this; }, setNote() { return this; } })
  });
  const tabs = { Sign_Up_Sheet: tab('Sign_Up_Sheet'), Waitlist: tab('Waitlist') };
  return { protections, file: { getSheetByName: n => tabs[n] || null }, rows: sheetRows };
}

delivery = { [PK]: { delivery: ROSTER_DELIVERY.WEB, title: 'Chair Yoga', location: 'Narberth' } };
registry = { [PK]: { fileId: 'FILE1', title: 'Chair Yoga', location: 'Narberth', pushedFingerprint: 'fp' } };
const ann = regRow('Ann Lee');
useTab([ann]);
// The sheet: Ann's Confirmed was ticked by the leader since the last push.
const sheetLine = rosterLine(ann);
const snap = [false, false, false, false, ''];
sheetLine[sheetMap['Pushed_Snapshot']] = JSON.stringify(snap);
sheetLine[sheetMap['Confirmed']] = true;
const fake = fakeFile([sheetLine]);
sandbox.openSpreadsheetCached = () => fake.file;
sandbox.readSimpleTable = () => { events.push('read'); return fake.rows; };

ok('the push leaves a Web program\'s sheet alone', sandbox.leaderRosterHandlesSheet_(PK, registry[PK]) === true);
ok('frozen BEFORE the final read', events.indexOf('protect') !== -1 &&
  events.indexOf('protect') < events.indexOf('read'));
ok('a real protection, editors removed', fake.protections[0].warn === false && events.indexOf('removeEditors') !== -1);
ok('the last tick on the sheet reached the Registrants tab', grid[0][map['Confirmed']] === true);
ok('...recorded as made on the sheet', ledger.some(e => e.source === 'leader-sheet'));
ok('both tabs got the banner', events.indexOf('banner:Sign_Up_Sheet') !== -1 && events.indexOf('banner:Waitlist') !== -1);
ok('settled only after the read', !!JSON.parse(store.LEADER_ROSTER_CUTOVER_V1)[PK].settledAt);
ok('a moved sheet is retired from the pull', sandbox.leaderRosterSheetRetired(PK) === true);
ok('the page is now writable', sandbox.leaderRosterWriteState_(PK).writable === true);

// The hourly pull never opens a retired sheet.
let opened = 0;
sandbox.openSpreadsheetCached = () => { opened++; return fake.file; };
sandbox.planLeaderSheetPull_ = () => ({ untouched: () => false, read: () => {}, save: () => {} });
sandbox.pullProgramLeaderSheetEdits([regRow('Ann Lee')]);
ok('the pull skips a frozen, settled sheet', opened === 0);

// A cutover whose final write fails is NOT settled, and stays frozen.
sandbox.writeLeaderRosterCutover_({});
const fake2 = fakeFile([sheetLine]);
sandbox.openSpreadsheetCached = () => fake2.file;
useTab([regRow('Ann Lee')]);
const realWriter = sandbox.applyLeaderRosterEditLocked_;
sandbox.applyLeaderRosterEditLocked_ = () => ({ ok: false, message: 'boom' });
sandbox.leaderRosterHandlesSheet_(PK, registry[PK]);
const st2 = JSON.parse(store.LEADER_ROSTER_CUTOVER_V1)[PK];
ok('a failed final read leaves it frozen and unsettled', !!st2.frozenAt && !st2.settledAt);
ok('...the page stays read-only', sandbox.leaderRosterWriteState_(PK).writable === false);
ok('...and the office is told', logs.some(l => /could not move to the web page/.test(l)));
sandbox.applyLeaderRosterEditLocked_ = realWriter;
sandbox.leaderRosterHandlesSheet_(PK, registry[PK]);
ok('the next run finishes the move', !!JSON.parse(store.LEADER_ROSTER_CUTOVER_V1)[PK].settledAt);

// Back to Sheet: unfrozen, state gone, fingerprint dropped so the push redraws.
delivery = {};
const entry = registry[PK];
ok('a program back on Sheet is pushed again', sandbox.leaderRosterHandlesSheet_(PK, entry) === false);
ok('...our protection is removed', fake2.protections.length === 0);
ok('...the cutover state is gone', !JSON.parse(store.LEADER_ROSTER_CUTOVER_V1)[PK]);
ok('...and the fingerprint dropped', registry[PK].pushedFingerprint === undefined && entry.pushedFingerprint === undefined);
ok('a Sheet program with no state is untouched', sandbox.leaderRosterHandlesSheet_(PK, registry[PK]) === false);

// --- 5. leader emails ---------------------------------------------------------------

const sheetUrl = 'https://docs.google.com/spreadsheets/d/FILE1/edit';
delivery = {};
let link = sandbox.leaderRosterEmailLink(PK, { fileId: 'FILE1' });
ok('Sheet: the email links the sheet', link.url === sheetUrl && !link.alsoUrl);
delivery = { [PK]: { delivery: ROSTER_DELIVERY.BOTH, title: 'Chair Yoga', location: 'Narberth' } };
link = sandbox.leaderRosterEmailLink(PK, { fileId: 'FILE1' });
ok('Both: the sheet, and the page beside it', link.url === sheetUrl && /mode=roster&t=/.test(link.alsoUrl));
delivery = { [PK]: { delivery: ROSTER_DELIVERY.WEB, title: 'Chair Yoga', location: 'Narberth' } };
link = sandbox.leaderRosterEmailLink(PK, { fileId: 'FILE1' });
ok('Web: the page', /mode=roster&t=/.test(link.url) && link.label === 'Your roster page');

// --- never logged ---------------------------------------------------------------------

const tokens = JSON.parse(store.LEADER_ROSTER_TOKENS_V1 || '{}');
const all = [token, rotated, live].concat(Object.keys(tokens).map(k => tokens[k].token));
ok('no token ever reached the log', all.every(t => logs.every(l => l.indexOf(t) === -1)));

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
