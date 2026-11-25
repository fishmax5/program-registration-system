// EMAIL GROUPS (99zzh) — who is proposed for which group, who is taken off and
// when, that a group's address never names a building, the apply plan's order,
// the apply job against a stand-in for Google, the Approve tick, the door's
// ask-once question, and the self-serve page's request → confirm round trip.
const assert = require('assert');
const vm = require('vm');
const crypto = require('crypto');
const src = require('./helpers/source').readSource();

// --- a small in-memory spreadsheet ------------------------------------------
function makeSheet(name) {
  const grid = [];
  const sheet = {
    name, grid,
    getName: () => name,
    getLastRow: () => { for (let r = grid.length; r > 0; r--) if ((grid[r - 1] || []).some(v => v !== '' && v !== null && v !== undefined)) return r; return 0; },
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, (r || []).length), 0),
    getMaxRows: () => Math.max(grid.length, 1000),
    insertRowsAfter: () => {},
    setFrozenRows: () => {},
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const range = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (grid[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues: v => { v.forEach((row, i) => { grid[r - 1 + i] = grid[r - 1 + i] || []; row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; }); }); return range; },
        setValue: v => range.setValues([[v]]),
        getValue: () => range.getValues()[0][0],
        setFontWeight: () => range, setDataValidation: () => range, clearDataValidations: () => range, setNote: () => range,
        getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc
      };
      return range;
    }
  };
  return sheet;
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = makeSheet(n)),
  setActiveSheet: () => {},
  getSpreadsheetTimeZone: () => 'America/New_York'
};

const scriptProps = {};
const docProps = {};
const propStore = store => ({
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = v; },
  deleteProperty: k => { delete store[k]; },
  getProperties: () => Object.assign({}, store),
  setProperties: o => { Object.assign(store, o); },
  getKeys: () => Object.keys(store)
});
const dv = () => { const b = { requireCheckbox: () => b, requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; };
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => fmt === 'MMM yyyy'
      ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear()
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map(b => (b > 127 ? b - 256 : b)),
    computeDigest: () => [1, 2, 3, 4, 5, 6, 7, 8], DigestAlgorithm: { MD5: 'md5' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => propStore(scriptProps), getDocumentProperties: () => propStore(docProps) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss, newDataValidation: dv, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'owner@nhsc.org' }), getActiveUser: () => ({ getEmail: () => 'staff@nhsc.org' }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => {} }) }) }) },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  CacheService: { getScriptCache: () => null, getUserCache: () => null }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.g = {
  scope: emailGroupScopeForSession, identity: proposeEmailGroupIdentity, plan: planEmailGroupChanges,
  items: buildEmailGroupApplyItems, mask: maskEmailForDisplay, slug: groupSlug_,
  edit: handleGroupRequestsEdit, answer: applyInterestAnswer, doorInfo: emailGroupsDoorInfo,
  ensure: ensureEmailGroupsTabs_, requests: readGroupRequests_, groups: readEmailGroups_,
  listsRequest: groupListsRequest, listsConfirm: groupListsConfirm, listsCtx: groupListsPageContext,
  listsHtml: buildGroupListsHtml, start: startApplyGroupChanges_, HEADERS: HEADERS, SHEET_NAMES: SHEET_NAMES,
  DOOR_ROUTES: DOOR_ROUTES, retry: applyQueuedOptimisticWrite
};
log = function () {};
spoolOfficeNote = function (section, line) { (this.__notes = this.__notes || []).push(line); return true; };
toastIfPossible = function () {};
renewWorkbookLease = function () {};
moveStoresToDocumentProperties = function () {};
flushLedger = function () {};
withScriptLock = function (w, fn) { return fn(); };
canonicalProgramTitle = function (t) { return String(t || '').replace(/^CANCELLED:\\s*/i, '').trim(); };
checkInPinAccepted = function (pin) { return pin === '1234'; };
workbookHeldElsewhere = function () { return !!this.__held; };
checkInPageUrl = function (o) { return 'https://x.test/exec?mode=' + o.mode + '&c=' + o.params.c + '&t=' + o.params.t; };
`, sandbox);
const g = sandbox.g;
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);

// --- the scope a session's people land in -----------------------------------
const enabled = { 'beginner mahjong': true, 'chair yoga': true, 'book club': true };
const course = g.scope({ title: 'Beginner Mahjong', location: 'Ashbridge', typeTag: 'Grouped', formId: 'F1' }, enabled);
eq([course.scopeKey, course.course], ['course:F1', true], 'a Grouped series is one group per run');
const standing = g.scope({ title: 'Chair Yoga', location: 'Narberth', typeTag: 'Regular', formId: 'F9' }, enabled);
assert.strictEqual(standing.scopeKey, 'program:chair yoga', 'a Regular program is one standing group');
assert.strictEqual(g.scope({ title: 'Chair Yoga', location: 'Ashbridge', typeTag: 'Regular', formId: 'F8' }, enabled).scopeKey,
  standing.scopeKey, 'the same title at another building is the SAME group — no building in it');
assert.strictEqual(g.scope({ title: 'Book Club', location: 'A', typeTag: 'Grouped', club: true, formId: 'F3' }, enabled).scopeKey,
  'program:book club', 'a club is standing even when tagged Grouped');
assert.strictEqual(g.scope({ title: 'CANCELLED: Chair Yoga', location: 'A', formId: 'F' }, enabled).scopeKey,
  'program:chair yoga', 'filed under its canonical title');
assert.strictEqual(g.scope({ title: 'Pottery', location: 'A' }, enabled), null, 'no tick, no group');
assert.strictEqual(g.scope({ title: 'Chair Yoga', location: 'A', assistance: true }, enabled), null, 'appointments never');

// --- a group's address and name ---------------------------------------------
const id1 = g.identity(course, '2026-11-04', 'nhsc.org', {});
assert.strictEqual(id1.email, 'beginner-mahjong-2026-11@nhsc.org');
assert.strictEqual(id1.name, 'Beginner Mahjong (Nov 2026)');
assert.ok(!/ashbridge|narberth/i.test(id1.email + id1.name), 'never a building');
assert.strictEqual(g.identity(standing, '', 'nhsc.org', { 'chair-yoga@nhsc.org': true }).email, 'chair-yoga-2@nhsc.org',
  'a taken address gets a suffix rather than sharing a group');
assert.strictEqual(g.slug('Café & Crafts!'), 'cafe-and-crafts');
assert.strictEqual(g.mask('jane.doe@gmail.com'), 'j•••e@g•••.com');

// --- proposals and removals ---------------------------------------------------
const sessions = {
  byEvent: {
    m1: { eventId: 'm1', title: 'Beginner Mahjong', location: 'A', typeTag: 'Grouped', formId: 'F1', dateKey: '2026-11-04' },
    m2: { eventId: 'm2', title: 'Beginner Mahjong', location: 'A', typeTag: 'Grouped', formId: 'F1', dateKey: '2026-11-11' },
    y1: { eventId: 'y1', title: 'Chair Yoga', location: 'N', typeTag: 'Regular', formId: 'F9', dateKey: '2026-11-01' },
    y2: { eventId: 'y2', title: 'Chair Yoga', location: 'N', typeTag: 'Regular', formId: 'F9', dateKey: '2026-12-01' },
    p1: { eventId: 'p1', title: 'Pottery', location: 'N', typeTag: 'Regular', formId: 'F7', dateKey: '2026-12-01' }
  },
  formStart: { F1: '2026-11-04' }
};
const base = { sessions, enabled, clubPlaces: [], todayKey: '2026-11-20', domain: 'nhsc.org' };
let plan = g.plan(Object.assign({}, base, {
  groups: [], requests: [],
  registrants: [
    { email: 'ann@x.com', name: 'Ann', eventId: 'm1', dateKey: '2026-11-04', status: 'Active' },
    { email: 'ann@x.com', name: 'Ann', eventId: 'm2', dateKey: '2026-11-11', status: 'Active' },
    { email: 'bob@x.com', name: 'Bob', eventId: 'y2', dateKey: '2026-12-01', status: 'Active' },
    { email: 'cy@x.com', name: 'Cy', eventId: 'y1', dateKey: '2026-11-01', status: 'Active' },
    { email: '', name: 'No Mail', eventId: 'y2', dateKey: '2026-12-01', status: 'Active' },
    { email: 'dee@x.com', name: 'Dee', eventId: 'p1', dateKey: '2026-12-01', status: 'Active' },
    { email: 'eve@x.com', name: 'Eve', eventId: 'y2', dateKey: '2026-12-01', status: 'Waitlisted' }
  ]
}));
eq(plan.newGroups.map(x => x.Group_Email).sort(),
  ['beginner-mahjong-2026-11@nhsc.org', 'chair-yoga@nhsc.org']);
eq(plan.proposals.map(p => `${p.email}>${p.group}`).sort(), [
  'ann@x.com>beginner-mahjong-2026-11@nhsc.org', 'bob@x.com>chair-yoga@nhsc.org'
], 'one per person per group; past standing dates, no email, waitlisted and unticked programs left out');

const groups = plan.newGroups.map(x => Object.assign({}, x, { active: true, Created_On: '2026-11-01' }));
const added = (email, group, extra) => Object.assign({ _row: 2, Request_ID: email + group, Email: email, Group: group,
  Status: 'Added', In_Group: true, Source: 'registration' }, extra || {});
// Course: one cancelled date is not leaving; every date cancelled is.
plan = g.plan(Object.assign({}, base, { groups, requests: [added('ann@x.com', 'beginner-mahjong-2026-11@nhsc.org')],
  registrants: [
    { email: 'ann@x.com', eventId: 'm1', dateKey: '2026-11-04', status: 'Cancelled' },
    { email: 'ann@x.com', eventId: 'm2', dateKey: '2026-11-11', status: 'Active' }] }));
assert.strictEqual(plan.removals.length, 0, 'one cancelled week of a course is not leaving');
plan = g.plan(Object.assign({}, base, { groups, requests: [added('ann@x.com', 'beginner-mahjong-2026-11@nhsc.org')],
  registrants: [{ email: 'ann@x.com', eventId: 'm1', dateKey: '2026-11-04', status: 'Cancelled' }] }));
assert.strictEqual(plan.removals.length, 1, 'every date cancelled or gone: removed');
// Standing: stopping coming is not leaving; a last cancellation with nothing ahead is.
const yoga = 'chair-yoga@nhsc.org';
plan = g.plan(Object.assign({}, base, { groups, requests: [added('cy@x.com', yoga)],
  registrants: [{ email: 'cy@x.com', eventId: 'y1', dateKey: '2026-11-01', status: 'Active' }] }));
assert.strictEqual(plan.removals.length, 0, 'lapsed (last date attended) stays');
plan = g.plan(Object.assign({}, base, { groups, requests: [added('cy@x.com', yoga)],
  registrants: [{ email: 'cy@x.com', eventId: 'y1', dateKey: '2026-11-01', status: 'Active' },
    { email: 'cy@x.com', eventId: 'y2', dateKey: '2026-12-01', status: 'Cancelled' }] }));
assert.strictEqual(plan.removals.length, 1, 'last change a cancellation, nothing live ahead: removed');
plan = g.plan(Object.assign({}, base, { groups, requests: [added('cy@x.com', yoga)],
  clubPlaces: [{ email: 'cy@x.com', programKey: 'chair yoga' }],
  registrants: [{ email: 'cy@x.com', eventId: 'y2', dateKey: '2026-12-01', status: 'Cancelled' }] }));
assert.strictEqual(plan.removals.length, 0, 'an active club place keeps them in');
plan = g.plan(Object.assign({}, base, { groups, requests: [added('cy@x.com', yoga, { Source: 'staff' })],
  registrants: [{ email: 'cy@x.com', eventId: 'y2', dateKey: '2026-12-01', status: 'Cancelled' }] }));
assert.strictEqual(plan.removals.length, 0, 'a person staff added is never removed by the roster');
plan = g.plan(Object.assign({}, base, {
  groups: groups.concat([{ Group_Email: 'interest-art@nhsc.org', Kind: 'Interest', Scope_Key: 'interest:art', active: true }]),
  requests: [added('cy@x.com', 'interest-art@nhsc.org', { Source: 'registration' })], registrants: [] }));
assert.strictEqual(plan.removals.length, 0, 'interest members are never removed by roster changes');
// Declined is never proposed again.
plan = g.plan(Object.assign({}, base, { groups, requests: [{ Email: 'bob@x.com', Group: yoga, Status: 'Declined' }],
  registrants: [{ email: 'bob@x.com', eventId: 'y2', dateKey: '2026-12-01', status: 'Active' }] }));
assert.strictEqual(plan.proposals.length, 0, 'a declined request is not proposed again');

// --- the apply plan's order -----------------------------------------------------
const items = g.items(
  [{ Group_Email: 'new@nhsc.org', Name: 'New', Kind: 'Class', active: true, Created_On: '' },
    { Group_Email: 'old@nhsc.org', Name: 'Old', Kind: 'Class', active: true, Created_On: '2026-01-01' }],
  [{ Request_ID: 'r1', Email: 'a@x.com', Group: 'new@nhsc.org', Status: 'Approved', In_Group: false },
    { Request_ID: 'r2', Email: 'b@x.com', Group: 'old@nhsc.org', Status: 'Removed', In_Group: true },
    { Request_ID: 'r3', Email: 'c@x.com', Group: 'old@nhsc.org', Status: 'Pending', In_Group: false },
    { Request_ID: 'r4', Email: 'd@x.com', Group: 'old@nhsc.org', Status: 'Removed', In_Group: false }],
  [], () => ['lead@x.com'], { 'old@nhsc.org': ['lead@x.com'] });
eq(items.map(i => `${i.type}:${i.group}${i.email ? ':' + i.email : ''}`), [
  'create:new@nhsc.org', 'manager:new@nhsc.org:newhorizons@newhorizonsseniorcenter.org',
  'manager:new@nhsc.org:lead@x.com', 'manager:old@nhsc.org:newhorizons@newhorizonsseniorcenter.org',
  'add:new@nhsc.org:a@x.com', 'remove:old@nhsc.org:b@x.com'
], 'create, managers (the office on every group, leaders on class groups), adds, removes');

// --- a Failed row retries by itself, and stops after the cap ----------------------
{
  const grp = [{ Group_Email: 'g@nhsc.org', Name: 'G', Kind: 'Class', active: true, Created_On: '2026-01-01' }];
  const fail = (id, notes, inGroup) => ({ Request_ID: id, Email: id + '@x.com', Group: 'g@nhsc.org', Status: 'Failed', In_Group: inGroup, Notes: notes });
  const its = g.items(grp, [
    fail('a', 'add failed, attempt 1 of 5 — retried automatically next run: Not Authorized', false),
    fail('b', 'remove failed, attempt 2 of 5: x', true),
    fail('c', 'add failed, attempt 5 of 5 — no more automatic retries: x', false),
    fail('d', 'add: old note with no count', false)
  ], [], () => [], { 'g@nhsc.org': ['newhorizons@newhorizonsseniorcenter.org'] });
  eq(its.map(i => `${i.type}:${i.requestId}:${i.attempt}`), ['add:a:2', 'add:d:1', 'remove:b:3'],
    'a failed add retries as an add, a failed removal as a removal, the count goes up, and the fifth failure is the last');
}

// --- a tab whose tick boxes ran to row 1000 (the first version's fault) ------------
{
  const stale = makeSheet('Email_Groups');
  stale.grid.push(g.HEADERS.Email_Groups.slice());
  const activeCol = g.HEADERS.Email_Groups.indexOf('Active');
  for (let i = 0; i < 999; i++) { const r = g.HEADERS.Email_Groups.map(() => ''); r[activeCol] = false; stale.grid.push(r); }
  const real = g.HEADERS.Email_Groups.map(() => ''); real[0] = 'stranded@nhsc.org'; real[activeCol] = true; stale.grid.push(real);
  sheets.Email_Groups = stale;
  g.ensure();
  assert.strictEqual(stale.grid[1][0], 'stranded@nhsc.org', 'a row stranded below the checkbox band is packed up under the header');
  assert.strictEqual(stale.grid[2][0], 'interest-art@nhsc.org', 'and new rows land right after it, not at row 1002');
  assert.strictEqual(stale.grid[1000][0], '', 'the old cell is blanked');
  delete sheets.Email_Groups;
  delete sheets.Group_Requests;
}

// --- the tabs, the Approve tick, the door, the lists page ---------------------------
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => Object.assign(ss, {});
// getOrCreateSheet goes through ss.insertSheet.
assert.strictEqual(g.ensure(), 3, 'Art, Exercise and Movies seeded');
assert.strictEqual(g.ensure(), 0, 'once');
const interestEmails = g.groups().map(x => x.Group_Email);
eq(interestEmails, ['interest-art@nhsc.org', 'interest-exercise@nhsc.org', 'interest-movies@nhsc.org']);

// Member_Roll for the door and the lists page.
const roll = sheets.Member_Roll = makeSheet('Member_Roll');
roll.grid.push(g.HEADERS.Member_Roll.slice());
const rollRow = (name, email) => { const r = g.HEADERS.Member_Roll.map(() => ''); r[0] = name; r[g.HEADERS.Member_Roll.indexOf('Email')] = email; roll.grid.push(r); };
rollRow('Jane Doe', 'jane.doe@gmail.com');
rollRow('Sam Smith', '');

let info = g.doorInfo([{ name: 'Jane Doe', key: 'jane doe' }, { name: 'Sam Smith', key: 'sam smith' }]);
assert.strictEqual(info.lists.length, 3);
eq(info.ask, { 'jane doe': 'j•••e@g•••.com', 'sam smith': '' },
  'masked, and blank where there is no address');
assert.ok(!JSON.stringify(info).includes('jane.doe'), 'the real address never reaches the tablet');

g.answer({ name: 'Jane Doe', groups: ['interest-art@nhsc.org', 'interest-movies@nhsc.org'] });
g.answer({ name: 'Sam Smith', skip: true });
let reqs = g.requests();
eq(reqs.map(r => `${r.Name}|${r.Email}|${r.Group}|${r.Status}`), [
  'Jane Doe|jane.doe@gmail.com|interest-art@nhsc.org|Approved',
  'Jane Doe|jane.doe@gmail.com|interest-movies@nhsc.org|Approved',
  'Sam Smith|||Declined'
], 'interest adds are born Approved, using the roll address; a no-thanks is a Declined row with no group');
g.answer({ name: 'Jane Doe', groups: ['interest-art@nhsc.org'] });
assert.strictEqual(g.requests().length, 3, 'idempotent per address per list');
info = g.doorInfo([{ name: 'Jane Doe', key: 'jane doe' }, { name: 'Sam Smith', key: 'sam smith' }]);
eq(info.ask, {}, 'asked once: neither is asked again');

// Behind a sync the door's answer is queued, and the retry writes it.
sandbox.__held = true;
const before = JSON.stringify(scriptProps);
const queued = vm.runInContext('doorInterestAnswer(JSON.stringify({ pin: "1234", name: "New Person", email: "new@p.com", groups: ["interest-exercise@nhsc.org"] }))', sandbox);
assert.strictEqual(queued.queued, true, 'queued while a sync holds the workbook');
assert.notStrictEqual(JSON.stringify(scriptProps), before);
sandbox.__held = false;
assert.strictEqual(vm.runInContext('doorInterestAnswer(JSON.stringify({ pin: "0000", name: "X" }))', sandbox).needsPin, true,
  'a wrong PIN is refused');
g.retry({ kind: 'groupInterest', args: { name: 'New Person', email: 'new@p.com', groups: ['interest-exercise@nhsc.org'] } });
assert.ok(g.requests().some(r => r.Email === 'new@p.com' && r.Status === 'Approved'), 'the queued answer lands');

// The Approve tick: a fill-down approves Pending rows and signs them.
const rq = sheets.Group_Requests;
const H = g.HEADERS.Group_Requests;
const col = h => H.indexOf(h) + 1;
const pendingRow = email => { const r = H.map(() => ''); r[col('Email') - 1] = email; r[col('Group') - 1] = 'chair-yoga@nhsc.org'; r[col('Status') - 1] = 'Pending'; r[col('Request_ID') - 1] = email; rq.grid.push(r); return rq.grid.length; };
const first = pendingRow('p1@x.com');
pendingRow('p2@x.com');
rq.grid[first - 1][col('Approve') - 1] = true;
rq.grid[first][col('Approve') - 1] = true;
g.edit({ range: rq.getRange(first, col('Approve'), 2, 1) }, rq);
eq([rq.grid[first - 1][col('Status') - 1], rq.grid[first][col('Status') - 1]], ['Approved', 'Approved']);
assert.strictEqual(rq.grid[first - 1][col('Approved_By') - 1], 'staff@nhsc.org', 'signed by whoever ticked');
rq.grid[first][col('Approve') - 1] = false;
g.edit({ range: rq.getRange(first + 1, col('Approve'), 1, 1) }, rq);
assert.strictEqual(rq.grid[first][col('Status') - 1], 'Pending', 'an untick before applying puts it back');

// --- the apply job, against a stand-in for Google ---------------------------------
const calls = [];
sandbox.AdminDirectory = {
  Groups: { insert: r => calls.push('createGroup ' + r.email) },
  Members: {
    insert: (r, grp) => { if (r.email === 'boom@x.com') throw new Error('Not Authorized'); calls.push(`add ${grp} ${r.email} ${r.role}`); },
    patch: () => {}, remove: (grp, e) => calls.push(`remove ${grp} ${e}`)
  }
};
sandbox.AdminGroupsSettings = { Groups: { patch: (r, e) => { calls.push('settings ' + e); assert.strictEqual(r.whoCanPostMessage, 'ALL_MANAGERS_CAN_POST'); assert.strictEqual(r.allowExternalMembers, 'true'); assert.strictEqual(r.whoCanViewMembership, 'ALL_MANAGERS_CAN_VIEW'); } } };
vm.runInContext('readEmailGroupRegistrants_ = function () { return []; }; readEmailGroupSessions_ = function () { return { byEvent: {}, formStart: {} }; }; readEmailGroupClubPlaces_ = function () { return []; }; emailGroupEnabledTitles_ = function () { return {}; }; buildProgramLeaderIndex = function () { return {}; };', sandbox);
const boom = H.map(() => ''); boom[col('Email') - 1] = 'boom@x.com'; boom[col('Group') - 1] = 'interest-art@nhsc.org'; boom[col('Status') - 1] = 'Approved'; boom[col('Request_ID') - 1] = 'boom'; rq.grid.push(boom);
g.start({ interactive: false });
assert.ok(calls.includes('createGroup interest-art@nhsc.org') && calls.includes('settings interest-art@nhsc.org'),
  'a group is created on its first approved member, announcement-only with external members');
assert.ok(calls.includes('add interest-art@nhsc.org jane.doe@gmail.com MEMBER'));
assert.ok(!calls.some(c => c.includes('chair-yoga')), 'a group that is not on Email_Groups is not touched');
reqs = g.requests();
const jane = reqs.find(r => r.Email === 'jane.doe@gmail.com' && r.Group === 'interest-art@nhsc.org');
assert.strictEqual(jane.Status, 'Added');
assert.strictEqual(jane.In_Group, true);
assert.strictEqual(reqs.find(r => r.Request_ID === 'boom').Status, 'Failed', 'a refusal is Failed, with the reason');
assert.ok(/Not Authorized/.test(reqs.find(r => r.Request_ID === 'boom').Notes));
assert.ok(g.groups().find(x => x.Group_Email === 'interest-art@nhsc.org').Created_On, 'Created_On stamped');
assert.strictEqual(scriptProps.EMAIL_GROUPS_APPLY_V1, undefined, 'the sliced job cleans up');
calls.length = 0;
g.start({ interactive: false });
eq(calls, [], 'a second run with nothing new changes nothing in Google');

// --- the lists page ----------------------------------------------------------------
const sent = [];
vm.runInContext('sendRationedEmail = function (req) { this.__sent.push(req); return { status: "sent" }; };', Object.assign(sandbox, { __sent: sent }));
const generic = g.listsRequest(JSON.stringify({ name: 'Somebody', email: 'Some@Body.com', groups: ['interest-art@nhsc.org'] }));
assert.ok(generic.ok);
const stranger = g.listsRequest(JSON.stringify({ name: 'Jane Doe', email: 'jane.doe@gmail.com', groups: ['interest-exercise@nhsc.org'] }));
assert.strictEqual(stranger.message, generic.message, 'the same answer whoever it is — the roll is never revealed');
assert.strictEqual(sent.length, 2);
assert.ok(!/Member_Roll|on the roll/i.test(sent[1].body));
assert.strictEqual(g.listsRequest(JSON.stringify({ name: 'Jane', email: 'jane.doe@gmail.com', groups: ['interest-art@nhsc.org'] })).ok, true);
assert.strictEqual(sent.length, 2, 'one confirmation per address per day');
const link = /c=([^&]+)&t=([0-9a-f]+)/.exec(sent[1].body);
const before2 = g.requests().length;
const ctx = g.listsCtx({ c: link[1], t: link[2] });
assert.strictEqual(ctx.valid, true);
assert.strictEqual(g.requests().length, before2, 'opening the link adds nobody');
assert.strictEqual(g.listsConfirm(link[1], 'f'.repeat(40)).ok, false, 'a forged token is refused');
assert.strictEqual(g.listsConfirm(link[1], link[2]).ok, true);
const added2 = g.requests().filter(r => r.Group === 'interest-exercise@nhsc.org' && r.Email === 'jane.doe@gmail.com');
assert.strictEqual(added2.length, 1);
assert.strictEqual(added2[0].Status, 'Approved', 'born Approved once confirmed');
assert.strictEqual(added2[0].Name, 'Jane Doe', 'matched to the roll on the server');
assert.strictEqual(g.listsConfirm(link[1], link[2]).ok, false, 'a link works once');

// The page is routed, and its script compiles with a hostile name inside.
const route = g.DOOR_ROUTES.find(r => r.id === 'lists');
assert.ok(route && route.match({ mode: 'lists' }) && !route.match({ mode: 'session' }));
const html = g.listsHtml({ mode: 'ask', lists: [{ group: 'a@b', label: '</script><b>x' }], centerName: "O'Brien" });
const script = html.split('<script>')[1].split('</script>')[0];
new vm.Script(script);
assert.ok(!html.includes('</script><b>'), 'a label cannot end the page');

console.log('email_groups: all passed');
