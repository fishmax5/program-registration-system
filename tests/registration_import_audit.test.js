// A RESPONSE THAT NEVER BECAME A ROW LEAVES NO TRACE, which is why the audit
// in 97_registration_import_audit.gs exists and why this file pins it.
//
// Two faults in the grid path are what it looks for, and the important thing
// about both is that they are SILENT: processFormResponse() returns an empty
// array for a response whose questions have been deleted out from under it,
// and zips a response's answers against the LIVE grid's rows by index when the
// grid has changed shape since. Neither writes a warning anywhere, and a
// missing name looks exactly like a person who never registered.
//
// So what is pinned here is the detection, the caveat the report has to carry
// about what it CANNOT see, and — separately and at least as importantly —
// that running the audit writes nothing.
const vm = require('vm');
const { fakeForm, baseSandbox } = require('./helpers/fake_form');
const src = require('./helpers/source').readSource();

const sandbox = baseSandbox();
sandbox.SpreadsheetApp.getUi = () => { throw new Error('no UI in a test'); };
vm.createContext(sandbox);
vm.runInContext(src + `
;this.auditResponseGridShape_ = auditResponseGridShape_;
this.auditFormGridRows_ = auditFormGridRows_;
this.withReadOnlyRegistries_ = withReadOnlyRegistries_;
this.describeRegistrationAudit_ = describeRegistrationAudit_;
this.classifyEmptyResponse_ = classifyEmptyResponse_;
this.auditFormGridHealth_ = auditFormGridHealth_;
this.buildNamesOnFormIndex_ = buildNamesOnFormIndex_;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.TEMPLATE_GRID_PLACEHOLDER_ROW = TEMPLATE_GRID_PLACEHOLDER_ROW;
this.callGetTombstone = function (k) { return getRegistrantTombstone(k); };
this.TEMPLATE_ITEM_TITLES = TEMPLATE_ITEM_TITLES;
this.LEGACY_LUNCH_ONLY_GRID_TITLE = LEGACY_LUNCH_ONLY_GRID_TITLE;
this.readTombstoneDirty = function () { return __tombstoneDirty; };
this.readAllDatesDirty = function () { return __allDatesRegistryDirty; };
this.setAllDatesDirty = function (v) { __allDatesRegistryDirty = v; };
this.callClear = function (k) { return clearRegistrantTombstones(k); };
this.log = function () {};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const Q = sandbox.TEMPLATE_ITEM_TITLES;

/** A form index of the shape getFormItemIndex() returns, over one grid item. */
function indexOverGrid(formId, title, rows, type) {
  const form = fakeForm(formId);
  const item = type === 'GRID' ? form.addGridItem() : form.addCheckboxGridItem();
  item.setTitle(title).setRows(rows);
  return { form, formId, items: form.getItems(), byTitle: { [title]: [item] }, item };
}

/** A FormResponse that answered `values` against `item`, and nothing else. */
function responseAnswering(item, values) {
  return {
    getResponseForItem: it => (it === item ? { getResponse: () => values } : null),
    getTimestamp: () => new Date('2026-09-01T12:00:00Z')
  };
}

// --- fault 2: a grid that changed size since the response was submitted -----
{
  // The form now lists four dates. This person answered when it listed two —
  // which is exactly what happens when a menu row is typed for a date partway
  // through the month and inserts above the ones already there.
  const idx = indexOverGrid('form1', Q.MEAL_COUNT_GRID,
    ['Tue 1 Sep', 'Thu 3 Sep', 'Tue 8 Sep', 'Thu 10 Sep'], 'GRID');
  const found = sandbox.auditResponseGridShape_(idx, responseAnswering(idx.item, ['2', '0']));
  check('a response answered against a smaller grid is caught', found.length, 1);
  check('...and says both sizes, because the gap is the finding',
    [found[0].submittedRows, found[0].liveRows], [2, 4]);
}

{
  // The same grid, answered in full. Nothing to report: this response is
  // aligned, and claiming otherwise would bury the real findings.
  const idx = indexOverGrid('form1', Q.MEAL_COUNT_GRID, ['Tue 1 Sep', 'Thu 3 Sep'], 'GRID');
  check('a response of the right size is not a finding',
    sandbox.auditResponseGridShape_(idx, responseAnswering(idx.item, ['2', '0'])), []);
}

{
  // THE LIMIT, stated as a test so nobody later reads the count as a total: a
  // grid whose rows were REORDERED but not resized misreads every answer and
  // is indistinguishable from a correct one through the Forms API.
  const idx = indexOverGrid('form1', Q.MEAL_COUNT_GRID, ['Thu 3 Sep', 'Tue 1 Sep'], 'GRID');
  check('a reorder that kept the row count cannot be detected',
    sandbox.auditResponseGridShape_(idx, responseAnswering(idx.item, ['2', '0'])), []);
  const report = sandbox.describeRegistrationAudit_({
    formsExamined: 1, formsUnread: [], formsNotReached: [], responsesRead: 1,
    emptyResponses: [], unmatchedRows: [], missingPeople: [], tombstonedSkips: 0,
    tombstonesWouldRevive: 0, stoppedEarly: false, elapsedMs: 1000,
    shapeMismatches: [{ formId: 'form1', name: 'Ada', submittedAt: new Date(),
      title: Q.MEAL_COUNT_GRID, submittedRows: 2, liveRows: 4 }]
  });
  check('...so the report says the count is a floor, not a total',
    report.indexOf('a floor, not a total') !== -1, true);
}

// --- a live grid row that resolves to no session ----------------------------
{
  const idx = indexOverGrid('form2', Q.ATTENDANCE_GRID,
    ['Tue 1 Sep', 'Thu 3 Sep'], 'CHECKBOX_GRID');
  // Only the first date is on the dashboard. Anybody ticking the second is
  // refused by processFormResponse() with nothing said to them about it.
  const registryIndex = { 'form2|Tue 1 Sep': { eventId: 'e1' } };
  sandbox.resolveSessionLabelForForm = (ri, formId, label) => label;
  const found = sandbox.auditFormGridRows_(idx, registryIndex);
  check('a date row matching no session is reported', found.map(f => f.label), ['Thu 3 Sep']);
}

{
  // A grid that has been added but not yet had its labels written carries the
  // template's placeholder. That is a form waiting for the next sync, not a
  // fault, and reporting it would cry wolf on every freshly built form.
  const idx = indexOverGrid('form3', Q.ATTENDANCE_GRID,
    ['(dates will be filled in automatically)'], 'CHECKBOX_GRID');
  sandbox.resolveSessionLabelForForm = (ri, formId, label) => label;
  check('the unwritten placeholder row is not a fault',
    sandbox.auditFormGridRows_(idx, {}), []);
}

// --- the read-only guarantee ------------------------------------------------
{
  // clearRegistrantTombstones() writes to Script Properties the moment it is
  // called, so not-flushing is not enough to make the audit read-only: it has
  // to be neutralized outright for the duration.
  sandbox.setAllDatesDirty(false);
  const out = sandbox.withReadOnlyRegistries_(() => {
    sandbox.setAllDatesDirty(true);          // as saveAllDatesRegistryEntry() would
    sandbox.callClear('evt|ada|Attendee');   // as buildRegistrantRow() would
    return 'derived';
  });
  check('the audit body still runs', out.result, 'derived');
  check('a tombstone the import would have cleared is recorded, not cleared',
    out.tombstonesWouldClear, ['evt|ada|Attendee']);
  check('...and nothing was marked dirty for a later flush to write',
    sandbox.readAllDatesDirty(), false);
  check('...and the tombstone store itself was never dirtied',
    sandbox.readTombstoneDirty(), false);

  // Restored afterwards, or the next real sync in this execution would quietly
  // stop lifting tombstones on genuine re-registrations.
  sandbox.setAllDatesDirty(false);
  check('the real clear is put back', sandbox.callClear('nothing-here'), 0);
}

{
  // A form that throws mid-audit must not leave the swapped function in place.
  let threw = false;
  try {
    sandbox.withReadOnlyRegistries_(() => { throw new Error('form refused'); });
  } catch (err) { threw = true; }
  check('a throw inside the audit propagates', threw, true);
  check('...and the real clear is still restored', sandbox.callClear('nothing-here'), 0);
}

// --- the report -------------------------------------------------------------
{
  const report = sandbox.describeRegistrationAudit_({
    formsExamined: 2, formsUnread: [], formsNotReached: [], responsesRead: 9,
    emptyResponses: [], shapeMismatches: [], unmatchedRows: [], tombstonedSkips: 3,
    tombstonesWouldRevive: 0, stoppedEarly: false, elapsedMs: 2000,
    missingPeople: [{ formId: 'f', name: 'Ada Lovelace', personType: 'Attendee',
      eventDate: new Date('2026-09-08T12:00:00Z'), location: 'Narberth',
      event: 'Lunch', submittedAt: new Date('2026-09-01T12:00:00Z') }]
  });
  check('the report names the person who is missing',
    report.indexOf('Ada Lovelace') !== -1, true);
  check('...says plainly that it changed nothing',
    report.indexOf('NOTHING WAS CHANGED') !== -1, true);
  check('...and does not count a deliberate deletion as a loss',
    report.indexOf('deleted them on purpose') !== -1, true);
}

// --- WHY a response derived nothing, asked rather than assumed ------------
//
// The first version of this file put every empty response under one heading
// and told the reader it was the v8→v9 meal swap. It had checked no such
// thing, and on the first real workbook the commonest cause was a form no
// session row names — which has nothing to do with a grid and a different fix.
{
  const itemNamed = (t, v) => ({ getItem: () => ({ getTitle: () => t }), getResponse: () => v });
  const answered = { getItemResponses: () => ['Name', 'Phone', 'How Will You Attend?'].map(t => itemNamed(t)) };
  const blank = { getItemResponses: () => [] };

  check('a form no session row names is its own answer, whatever the response said',
    sandbox.classifyEmptyResponse_(answered, 0).kind, 'noSessions');
  check('a response answering nothing the form still carries is named as that',
    sandbox.classifyEmptyResponse_(blank, 4).kind, 'unreadable');
  check('...and a response that DID answer and still made no row is the parser',
    [sandbox.classifyEmptyResponse_(answered, 4).kind,
     sandbox.classifyEmptyResponse_(answered, 4).answers], ['answeredNoRows', 3]);
  // The titles are the diagnosis: what a person answered names the question
  // they never reached, which a count alone cannot.
  check('...and it carries WHAT they answered, not just how many',
    sandbox.classifyEmptyResponse_(answered, 4).titles,
    ['Name', 'Phone', 'How Will You Attend?']);

  // The mode question is the fork the rest of the form hangs off, so its
  // VALUE is read rather than just ticked off as answered: one branch leads to
  // a single meal total, the other to the date grid, and "it was answered"
  // leaves both open.
  const branched = { getItemResponses: () => [
    itemNamed('Name'),
    itemNamed(Q.ATTENDANCE_MODE, 'Pick Your Dates')
  ] };
  check('the branch a respondent took is read as a value',
    sandbox.classifyEmptyResponse_(branched, 4).mode, 'Pick Your Dates');
  check('...and a response that never met the mode question says so with a blank',
    sandbox.classifyEmptyResponse_(answered, 4).mode, '');
  check('a response that cannot be read at all does not throw the audit over',
    sandbox.classifyEmptyResponse_({ getItemResponses: () => { throw new Error('gone'); } }, 4),
    { kind: 'unreadable', answers: 0, titles: [], mode: '' });
}

// --- a live form whose date question offers no date ------------------------
//
// 31_form_shape_and_migration's own banner calls this "a form nobody can
// register on", and it has happened on this project before. The first version
// of this audit SKIPPED the placeholder row as "a form waiting for the next
// sync", which hid the most urgent thing it could have found.
{
  const form = fakeForm('fEmpty');
  const grid = form.addGridItem();
  grid.setTitle(Q.LUNCH_ONLY_GRID).setRows([sandbox.TEMPLATE_GRID_PLACEHOLDER_ROW]);
  const idx = { form, formId: 'fEmpty', items: form.getItems(),
    byTitle: { [Q.LUNCH_ONLY_GRID]: [grid] } };
  const found = sandbox.auditFormGridHealth_(idx);
  check('a grid carrying only the placeholder is a finding', found.length, 1);
  check('...and it says so rather than counting it as a date',
    [found[0].placeholder, found[0].rowCount], [true, 1]);

  grid.setRows(['Tue 1 Sep', 'Thu 3 Sep']);
  check('a grid with real dates is not a finding',
    sandbox.auditFormGridHealth_(idx), []);
}

{
  const report = sandbox.describeRegistrationAudit_({
    formsExamined: 1, formsUnread: [], formsNotReached: [], responsesRead: 8,
    emptyResponses: [], shapeMismatches: [], unmatchedRows: [], missingPeople: [],
    tombstonedSkips: 0, tombstonesWouldRevive: 0, stoppedEarly: false, elapsedMs: 1000,
    emptyGrids: [{ formId: 'fEmpty', title: Q.LUNCH_ONLY_GRID, placeholder: true,
      rowCount: 1, responses: 8, sessionsOnForm: 4 }]
  });
  check('an empty date question is reported above the people',
    report.indexOf('OFFER NO DATE') < report.indexOf('NOTHING WAS CHANGED') + 400, true);
  check('...and says it will not fix itself, because the write is fingerprinted',
    report.indexOf('fingerprinted') !== -1, true);
}

{
  // The three causes are reported apart, and the noSessions one says what to
  // do about it rather than blaming a grid it never looked at.
  const report = sandbox.describeRegistrationAudit_({
    formsExamined: 3, formsUnread: [], formsNotReached: [], responsesRead: 3,
    shapeMismatches: [], unmatchedRows: [], missingPeople: [], tombstonedSkips: 0,
    tombstonesWouldRevive: 0, stoppedEarly: false, elapsedMs: 1000,
    emptyResponses: [
      { formId: 'fA', name: 'Ada', kind: 'noSessions', answers: null, sessionsOnForm: 0 },
      { formId: 'fB', name: 'Bea', kind: 'unreadable', answers: 0, sessionsOnForm: 4 },
      { formId: 'fC', name: 'Cal', kind: 'answeredNoRows', answers: 7, sessionsOnForm: 4,
        titles: ['Name', 'How would you like to sign up?'], mode: 'Pick Your Dates' }
    ]
  });
  check('the three causes are reported apart',
    [report.indexOf('NO SESSION ROW NAMES THIS FORM') !== -1,
     report.indexOf('ANSWERED NOTHING THE FORM STILL CARRIES') !== -1,
     report.indexOf('ANSWERED THE FORM AND STILL PRODUCED NOTHING') !== -1],
    [true, true, true]);
  check('...the unreadable one is a place to look, not a verdict',
    report.indexOf('a place to LOOK rather than a verdict') !== -1, true);
  check('...and the parser set names the person and what they answered',
    report.indexOf('Cal — answered 7 question(s)') !== -1, true);
  // The report no longer names a cause for the un-derivable ones. The first
  // two it named were wrong, and what a response answered is checkable where
  // what happened to the form is not.
  check('...and it no longer blames the meal swap it never checked',
    report.indexOf('meal swap deleted') === -1, true);
}

{
  // The tombstone lookup is neutralized too, so a response whose rows were all
  // DELIBERATELY DELETED derives its rows and is counted as a deletion — not
  // reported as a response the parser could not read.
  const out = sandbox.withReadOnlyRegistries_(() =>
    sandbox.callGetTombstone('evt|ada|Attendee'));
  check('a tombstone reads as absent while the audit derives', out.result, null);
  check('...and the real lookup is restored afterwards',
    typeof sandbox.callGetTombstone('evt|ada|Attendee'), 'object');
}

// --- a response that cannot be re-read is not the same as a lost seat ------
//
// The v8→v9 meal swap deletes the questions a pre-v9 response answered, so
// re-deriving one today produces nothing. That is harmless if it was read when
// it ARRIVED — the migration runs after the import loop for exactly that
// reason. What decides it is whether the person is on the tab anyway, and the
// audit was not asking.
{
  const rmap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
  const rowFor = (eventId, name) => {
    const row = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
    row[rmap['Event_ID']] = eventId;
    row[rmap['Name']] = name;
    return row;
  };
  const registryIndex = {
    'fLunch|Tue 1 Sep': { formId: 'fLunch', eventId: 'LUNCHONLY:2026-09-01' },
    'fLunch|Thu 3 Sep': { formId: 'fLunch', eventId: 'LUNCHONLY:2026-09-03' }
  };
  const onForm = sandbox.buildNamesOnFormIndex_(
    [rowFor('LUNCHONLY:2026-09-01', 'Flo Rice')], rmap, registryIndex);

  check('somebody imported when their response arrived is found on the form',
    onForm.has('fLunch|' + sandbox.normalizeNameKey('Flo Rice')), true);
  check('...and somebody who was never imported is not',
    onForm.has('fLunch|' + sandbox.normalizeNameKey('Judy Watman')), false);
}

{
  // The report leads with that split, because it is the difference between
  // "32 people lost their place" and "32 old responses cannot be re-read".
  const base = {
    formsExamined: 1, formsUnread: [], formsNotReached: [], responsesRead: 2,
    shapeMismatches: [], unmatchedRows: [], missingPeople: [], emptyGrids: [],
    tombstonedSkips: 0, tombstonesWouldRevive: 0, stoppedEarly: false, elapsedMs: 1000
  };
  const report = sandbox.describeRegistrationAudit_(Object.assign({}, base, {
    emptyResponses: [
      { formId: 'fL', name: 'Flo Rice', onTab: true, kind: 'unreadable', answers: 0, titles: [] },
      { formId: 'fL', name: 'Judy Watman', onTab: false, kind: 'unreadable', answers: 0, titles: [] }
    ]
  }));
  check('the harmless ones are called harmless',
    report.indexOf('Nobody lost a seat') !== -1, true);
  check('...the genuinely lost one is named',
    report.indexOf('Judy Watman') !== -1, true);
  check('...and the one already on the tab is NOT listed as lost',
    report.indexOf('• Flo Rice') === -1, true);
  check('...and the report does not assert a cause it has not checked',
    report.indexOf('meal swap deleted') === -1, true);
}

console.log(failures === 0 ? '\nAll registration-audit checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
