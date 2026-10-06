// ============================================================================
// AN HOUR IN WHICH NOTHING CHANGED COSTS ALMOST NOTHING
//
// Pins the four ways the hourly registration sync now leaves alone what it
// would only have redrawn as it was:
//
//   1. 99ze — a form whose program ended a week ago is closed, read ONE more
//      window, then left off the list; re-opened (only if we closed it) when
//      it gains a session again.
//   2. 99zf — a program registrant sheet Drive says nobody touched since it
//      was last read is not opened; once a day every one is.
//   3. 99zg — the Registrants tab is not rewritten when the rows it would
//      write hash the same with today's date; a different day or row redraws.
//   4. 99zg — a tail dashboard is skipped on an unchanged fingerprint, and
//      redrawn when the change generation moves, when it is too old, or on a
//      new day; the sync's own writes do not move the generation.
// ============================================================================
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const RealDate = Date;
let NOW = new RealDate(2026, 9, 6, 11, 0, 0).getTime(); // Tue 6 Oct 2026

const store = {};
const props = {
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); },
  deleteProperty: k => { delete store[k]; },
  setProperties: o => Object.assign(store, o),
  getProperties: () => Object.assign({}, store)
};

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const x = new RealDate(d);
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      return x.toISOString();
    },
    computeDigest: (algo, raw) => {
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
      return [(h >> 24) & 255, (h >> 16) & 255, (h >> 8) & 255, h & 255];
    },
    base64Encode: bytes => bytes.join('.'),
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF_8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => props },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/New_York' }), getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York' },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.ENDED_FORMS_PROP_KEY = ENDED_FORMS_PROP_KEY;
this.ENDED_FORMS_MAX_CLOSES_PER_RUN = ENDED_FORMS_MAX_CLOSES_PER_RUN;
this.TAIL_RENDER_MAX_AGE_MS = TAIL_RENDER_MAX_AGE_MS;
this.__untouched = () => __leaderSheetsUntouched;
this.__resetBump = () => { __workbookChangeBumped = false; };
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.describeFormLink = id => `form ${id}`;

const sMap = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
function session(formId, y, m, d) {
  const row = new Array(sandbox.HEADERS.All_Program_Sessions.length).fill('');
  row[sMap['Form_ID']] = formId;
  row[sMap['Event_Date']] = new RealDate(y, m, d, 10, 0);
  row[sMap['Event_ID']] = `e|${formId}|${d}`;
  return row;
}
function fakeForm(accepting) {
  const f = { accepting, message: '', isAcceptingResponses: () => f.accepting,
    setAcceptingResponses: v => { f.accepting = v; }, setCustomClosedFormMessage: m => { f.message = m; } };
  return f;
}
const clear = () => Object.keys(store).forEach(k => delete store[k]);

// ---------------------------------------------------------------------------
// 1. ENDED FORMS
// ---------------------------------------------------------------------------
{
  clear();
  const forms = { OLD: fakeForm(true), HAND: fakeForm(false), NEW: fakeForm(true), RECENT: fakeForm(true) };
  sandbox.openFormCached = id => { if (!forms[id]) throw new Error('gone'); return forms[id]; };
  const rows = [
    session('OLD', 2026, 7, 4), session('OLD', 2026, 7, 25),   // ended in August
    session('HAND', 2026, 8, 1),                                // ended, closed by somebody else
    session('NEW', 2026, 7, 1), session('NEW', 2026, 9, 20),    // still running
    session('RECENT', 2026, 9, 1)                               // ended five days ago: not yet
  ];

  const first = sandbox.closeEndedForms(rows);
  assert.strictEqual(first.closed, 2, 'the two forms ended more than a week ago are recorded');
  assert.strictEqual(forms.OLD.accepting, false, 'an open one is closed');
  assert.ok(/ended/.test(forms.OLD.message), 'with a message saying why');
  assert.strictEqual(forms.NEW.accepting, true, 'a form with an upcoming session is untouched');
  assert.strictEqual(forms.RECENT.accepting, true, 'and so is one that ended less than a week ago');
  const ended = JSON.parse(store[sandbox.ENDED_FORMS_PROP_KEY]);
  assert.strictEqual(ended.OLD.closedByUs, true);
  assert.strictEqual(ended.HAND.closedByUs, false, 'a form somebody else closed is not ours to re-open');

  // The window that was open when it closed still reads it; the next does not.
  const closedAt = new RealDate(ended.OLD.closedAt);
  const ids = ['OLD', 'HAND', 'NEW', 'RECENT'];
  assert.deepStrictEqual(Array.from(sandbox.withoutEndedForms(ids, new RealDate(closedAt.getTime() - 60000))), ids,
    'a window that opened before the close still reads the closed forms');
  assert.deepStrictEqual(Array.from(sandbox.withoutEndedForms(ids, new RealDate(closedAt.getTime() + 60000))),
    ['NEW', 'RECENT'], 'a window that opened after it does not');

  // Running again changes nothing.
  assert.strictEqual(sandbox.closeEndedForms(rows).closed, 0, 'idempotent');

  // OLD gains a session (a series extended); HAND too.
  const revived = rows.concat([session('OLD', 2026, 10, 3), session('HAND', 2026, 10, 3)]);
  const again = sandbox.closeEndedForms(revived);
  assert.strictEqual(again.reopened, 1, 'the form this closed is re-opened');
  assert.strictEqual(forms.OLD.accepting, true);
  assert.strictEqual(forms.HAND.accepting, false, 'the one it did not close is left closed');
  const after = JSON.parse(store[sandbox.ENDED_FORMS_PROP_KEY]);
  assert.ok(!after.OLD && !after.HAND, 'and both are back on the hourly list');

  // A form that cannot be opened is not recorded — it stays on the list.
  clear();
  const gone = sandbox.closeEndedForms([session('GONE', 2026, 5, 1)]);
  assert.strictEqual(gone.closed, 0);
  assert.ok(!store[sandbox.ENDED_FORMS_PROP_KEY] || !JSON.parse(store[sandbox.ENDED_FORMS_PROP_KEY]).GONE);

  // The per-run cap.
  clear();
  const many = [];
  for (let i = 0; i < sandbox.ENDED_FORMS_MAX_CLOSES_PER_RUN + 5; i++) {
    forms[`M${i}`] = fakeForm(true);
    many.push(session(`M${i}`, 2026, 5, 1));
  }
  const capped = sandbox.closeEndedForms(many);
  assert.strictEqual(capped.closed, sandbox.ENDED_FORMS_MAX_CLOSES_PER_RUN);
  assert.strictEqual(capped.pending, 5, 'the rest wait for the next run');

  // A form with an unreadable date is never judged ended.
  assert.strictEqual(sandbox.lastSessionDateByForm_([session('X', 2026, 1, 1),
    Object.assign(session('X', 2026, 1, 1), { [sMap['Event_Date']]: 'soon' })]).X, undefined);
}

// ---------------------------------------------------------------------------
// 2. LEADER SHEETS DRIVE SAYS NOBODY TOUCHED
// ---------------------------------------------------------------------------
{
  clear();
  let modified = { A: '2026-10-06T10:00:00Z', B: '2026-10-06T10:00:00Z' };
  let listings = 0;
  sandbox.getOrCreateProgramLeaderSheetFolder = () => ({ getId: () => 'FOLDER' });
  sandbox.Drive = { Files: { list: params => {
    listings++;
    assert.ok(params.q.indexOf("'FOLDER' in parents") === 0);
    return { items: Object.keys(modified).map(id => ({ id, modifiedDate: modified[id] })) };
  } } };

  // First run of the day: everything is read, and the baselines recorded.
  let plan = sandbox.planLeaderSheetPull_();
  assert.strictEqual(plan.untouched('A'), false, 'the daily full check opens every sheet');
  plan.read('A'); plan.read('B'); plan.save();
  assert.strictEqual(listings, 1, 'one Drive call for every sheet');

  // Next hour: nothing moved.
  plan = sandbox.planLeaderSheetPull_();
  assert.strictEqual(plan.untouched('A'), true, 'a sheet whose date has not moved is not opened');
  assert.strictEqual(sandbox.leaderSheetUntouchedThisRun_('A'), true, 'and the push is told');
  assert.strictEqual(plan.untouched('C'), false, 'a sheet outside the folder is always read');
  plan.save();

  // A leader edits B.
  modified.B = '2026-10-06T10:40:00Z';
  plan = sandbox.planLeaderSheetPull_();
  assert.strictEqual(plan.untouched('A'), true);
  assert.strictEqual(plan.untouched('B'), false, 'an edited sheet is read');
  assert.strictEqual(sandbox.leaderSheetUntouchedThisRun_('B'), false);
  plan.read('B'); plan.save();
  plan = sandbox.planLeaderSheetPull_();
  assert.strictEqual(plan.untouched('B'), true, 'and is quiet again once read');

  // Tomorrow: the full check again.
  NOW += 24 * 3600 * 1000;
  plan = sandbox.planLeaderSheetPull_();
  assert.strictEqual(plan.untouched('A'), false, 'once a day nothing is skipped');
  plan.save();

  // No Drive service: the old behavior.
  delete sandbox.Drive;
  plan = sandbox.planLeaderSheetPull_();
  assert.strictEqual(plan.untouched('A'), false, 'nothing is skipped when Drive cannot be asked');
  NOW -= 24 * 3600 * 1000;
}

// ---------------------------------------------------------------------------
// 3. THE REGISTRANTS TAB
// ---------------------------------------------------------------------------
{
  clear();
  let renders = 0;
  sandbox.getOrCreateSheet = () => ({});
  sandbox.backfillRegistrantEventTimes = () => {};
  sandbox.stampGeneratedFileLinks = () => {};
  sandbox.recordRenderedRegistrantCount_ = () => {};
  sandbox.renderFlatDateSheet = () => { renders++; return {}; };
  const rMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
  const row = name => {
    const r = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
    r[rMap['Name']] = name; r[rMap['Event_ID']] = 'e1'; r[rMap['Program_Status']] = 'Active';
    return r;
  };

  sandbox.renderRegistrantsSheet(false, [row('Ann')], { skipIfUnchanged: true });
  assert.strictEqual(renders, 1, 'the first render draws');
  const second = sandbox.renderRegistrantsSheet(false, [row('Ann')], { skipIfUnchanged: true });
  assert.strictEqual(renders, 1, 'the same rows on the same day are left as they are');
  assert.ok(second && second.skipped);
  sandbox.renderRegistrantsSheet(false, [row('Ann'), row('Bob')], { skipIfUnchanged: true });
  assert.strictEqual(renders, 2, 'a new row draws');
  sandbox.renderRegistrantsSheet(false, [row('Ann'), row('Bob')]);
  assert.strictEqual(renders, 3, 'a caller that does not ask is never skipped');
  sandbox.renderRegistrantsSheet(true, [row('Ann'), row('Bob')], { skipIfUnchanged: true });
  assert.strictEqual(renders, 4, 'nor is a forced render');
  NOW += 24 * 3600 * 1000;
  sandbox.renderRegistrantsSheet(false, [row('Ann'), row('Bob')], { skipIfUnchanged: true });
  assert.strictEqual(renders, 5, 'a new day draws, so the Upcoming/Past split moves');
  NOW -= 24 * 3600 * 1000;
}

// ---------------------------------------------------------------------------
// 4. THE TAIL'S DASHBOARDS, AND THE CHANGE GENERATION
// ---------------------------------------------------------------------------
{
  clear();
  let draws = 0;
  const draw = () => { draws++; return 'drawn'; };
  const parts = [[['a', 1]]];

  assert.strictEqual(sandbox.runTailRenderUnlessUnchanged_('lunch', parts, draw, 'skipped'), 'drawn');
  assert.strictEqual(sandbox.runTailRenderUnlessUnchanged_('lunch', parts, draw, 'skipped'), 'skipped',
    'an unchanged fingerprint skips');
  assert.strictEqual(draws, 1);

  sandbox.runTailRenderUnlessUnchanged_('lunch', [[['a', 2]]], draw);
  assert.strictEqual(draws, 2, 'changed inputs draw');

  // Something outside the sync wrote: the generation moves.
  NOW += 1000;
  sandbox.__resetBump();
  sandbox.bumpWorkbookChangeGeneration_();
  sandbox.runTailRenderUnlessUnchanged_('lunch', [[['a', 2]]], draw);
  assert.strictEqual(draws, 3, 'a write elsewhere draws');

  // The sync's own writes do not move it.
  NOW += 1000;
  sandbox.__resetBump();
  sandbox.suppressWorkbookChangeGeneration_(true);
  sandbox.bumpWorkbookChangeGeneration_();
  sandbox.suppressWorkbookChangeGeneration_(false);
  sandbox.runTailRenderUnlessUnchanged_('lunch', [[['a', 2]]], draw);
  assert.strictEqual(draws, 3, "the sync's own writes are not news");

  // Too old to trust.
  NOW += sandbox.TAIL_RENDER_MAX_AGE_MS + 1;
  sandbox.runTailRenderUnlessUnchanged_('lunch', [[['a', 2]]], draw);
  assert.strictEqual(draws, 4, 'nothing goes longer than the max age without a redraw');

  // A new day.
  NOW += 24 * 3600 * 1000;
  sandbox.runTailRenderUnlessUnchanged_('lunch', [[['a', 2]]], draw);
  assert.strictEqual(draws, 5, 'a new day draws');

  // Once a day.
  assert.strictEqual(sandbox.dailyStepDue_('ledger_verify'), true);
  sandbox.recordDailyStepRun_('ledger_verify');
  assert.strictEqual(sandbox.dailyStepDue_('ledger_verify'), false, 'done for today');
  NOW += 24 * 3600 * 1000;
  assert.strictEqual(sandbox.dailyStepDue_('ledger_verify'), true, 'due again tomorrow');
}

console.log('✅ sync_skip_unchanged.test.js passed');
