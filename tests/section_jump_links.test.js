// THE TWO LINKS BETWEEN A TAB'S SECTIONS (34).
//
// Every date-bearing tab in this workbook is two stacked tables, and the Past
// one begins however many Upcoming rows down the tab there happen to be. So
// each banner now carries one in-sheet =HYPERLINK() to the other section, and
// this pins the four things such a pair can get wrong:
//
//   1. WHERE THEY POINT. A "Jump to Past" that names the wrong row is a link
//      that lands in the middle of the Upcoming rows, which reads as the tab
//      being broken. Both anchors are checked against the row numbers the
//      writer itself reports back.
//   2. A LINK TO NOTHING. A tab whose Past section has no rows still gets its
//      banner — that is what says there is no history yet — and must not offer
//      a link down to it.
//   3. A LINK LEFT BEHIND. The Past section emptying between two renders is
//      exactly when a stale link is worst: it is the one state where the cell
//      is not rewritten with a new value, so it has to be written blank.
//   4. THE BANNER'S OWN TEXT. The label — and the hidden-row count appended to
//      it — is the one thing on that row anybody reads, and the link goes in a
//      cell along the row rather than over it or merged with it.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const NOW = new Date(2026, 8, 9, 9, 0, 0); // Wed 9 Sep 2026
const RealDate = Date;
const pad = n => String(n).padStart(2, '0');

function builder(kind, spec) {
  spec = spec || { kind };
  const b = new Proxy({}, {
    get(t, prop) {
      if (prop === 'build') return () => Object.assign({ __rule: true }, spec);
      if (typeof prop !== 'string') return undefined;
      return (...args) => { spec[prop] = args.length === 1 ? args[0] : args; return b; };
    }
  });
  return b;
}

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return d.toISOString();
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: (() => {
    const store = {};
    const props = {
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); return props; },
      deleteProperty: k => { delete store[k]; return props; },
      getProperties: () => Object.assign({}, store)
    };
    return { getScriptProperties: () => props, getUserProperties: () => props };
  })(),
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {},
    newDataValidation: () => builder('validation'),
    newConditionalFormatRule: () => builder('conditional'),
    WrapStrategy: { CLIP: 'CLIP', OVERFLOW: 'OVERFLOW', WRAP: 'WRAP' },
    ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
    DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', CHECKBOX: 'CHECKBOX' },
    BorderStyle: { SOLID: 'SOLID' }
  },
  FormApp: { ItemType: {}, openById: () => { throw new Error('no form'); } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.TYPO = TYPO;
this.SECTION_JUMP_LINK_COLUMN = SECTION_JUMP_LINK_COLUMN;
this.SECTION_JUMP_TO_PAST_LABEL = SECTION_JUMP_TO_PAST_LABEL;
this.SECTION_BACK_TO_TOP_LABEL = SECTION_BACK_TO_TOP_LABEL;
this.sectionJumpLinkColumn_ = sectionJumpLinkColumn_;
this.sectionAnchorFormula_ = sectionAnchorFormula_;
this.writeSectionJumpLink_ = writeSectionJumpLink_;
this.writeUpcomingPastSections = writeUpcomingPastSections;
this.renderFlatDateSheet = renderFlatDateSheet;
this.applyRegistrantsFormatting = applyRegistrantsFormatting;
this.sectionedTableValueBlock_ = sectionedTableValueBlock_;
this.composeTabValueGrid_ = composeTabValueGrid_;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.invalidateAutosizeMemo = invalidateAutosizeMemo;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

let logged = [];
sandbox.log = msg => logged.push(String(msg));
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const RH = sandbox.HEADERS.All_Registrants;
const rcol = name => RH.indexOf(name);
const GID = 4242;

function freshSheet(name, headers) {
  const grid = [];
  const sheet = makeCountingSheet(grid, name, { sheetId: GID });
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: n => (n === name ? sheet : null), getSheets: () => [sheet],
    toast: () => {}, getId: () => 'ss', getActiveSheet: () => sheet
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  return { grid, sheet, headers };
}

function registrantRow(dayOffset, name) {
  const row = new Array(RH.length).fill('');
  row[rcol('Event_Date')] = new RealDate(2026, 8, 9 + dayOffset, 10, 0);
  row[rcol('Location')] = 'Ashbridge';
  row[rcol('Event')] = 'Chair Yoga';
  row[rcol('Name')] = name;
  row[rcol('Person_Type')] = 'Registrant';
  row[rcol('Program_Status')] = 'Active';
  row[rcol('Event_ID')] = `evt|Chair Yoga|${dayOffset}`;
  row[rcol('Manual_Override')] = 'Auto-Synced';
  return row;
}

/** The raw cell (formula included — getValues() would flatten it to its label). */
const cellAt = (grid, row, col) => {
  const line = grid[row - 1];
  const v = line ? line[col - 1] : '';
  return v === undefined || v === null ? '' : v;
};

// ---------------------------------------------------------------------------
// 1. THE COLUMN: never the banner's own, never past the table's width
// ---------------------------------------------------------------------------
{
  assert.strictEqual(sandbox.sectionJumpLinkColumn_(RH.length), sandbox.SECTION_JUMP_LINK_COLUMN,
    'a wide tab gets the standard column');
  // Lunch_Schedule is the narrowest sectioned tab in the workbook (6 columns).
  assert.strictEqual(sandbox.sectionJumpLinkColumn_(sandbox.HEADERS.Lunch_Schedule.length),
    sandbox.SECTION_JUMP_LINK_COLUMN, 'the narrowest real tab still carries it where it always is');
  assert.strictEqual(sandbox.sectionJumpLinkColumn_(3), 3, 'a narrow table clamps to its last column');
  // THE ONE OUTCOME TO AVOID: landing on column A and erasing the label.
  assert.strictEqual(sandbox.sectionJumpLinkColumn_(1), 0, 'a one-column table gets no link at all');
  assert.strictEqual(sandbox.sectionJumpLinkColumn_(0), 0);
  assert.ok(sandbox.SECTION_JUMP_LINK_COLUMN > 1, 'the link is never in the banner text cell');
}

// ---------------------------------------------------------------------------
// 2. THE ANCHOR: this tab's gid, asked of the sheet, and an A-column row
// ---------------------------------------------------------------------------
{
  const { sheet } = freshSheet('All_Registrants', RH);
  assert.strictEqual(sandbox.sectionAnchorFormula_(sheet, 49, '⬇ Jump to Past'),
    `=HYPERLINK("#gid=${GID}&range=A49", "⬇ Jump to Past")`);
  // A sheet that will not say which tab it is gets no link, rather than one
  // pointing at #gid=null.
  const mute = { getSheetId: () => { throw new Error('no id'); }, getName: () => 'x' };
  assert.strictEqual(sandbox.sectionAnchorFormula_(mute, 49, 'x'), '');
  assert.strictEqual(sandbox.sectionAnchorFormula_(sheet, 0, 'x'), '', 'row 0 is not a target');
  // A quote in a caller's own wording must not end the formula's string.
  assert.strictEqual(sandbox.sectionAnchorFormula_(sheet, 9, 'the "Past" bit'),
    `=HYPERLINK("#gid=${GID}&range=A9", "the ""Past"" bit")`);
}

// ---------------------------------------------------------------------------
// 3. BOTH LINKS, POINTING AT EACH OTHER'S BANNER ROW
// ---------------------------------------------------------------------------
{
  const { grid, sheet } = freshSheet('All_Registrants', RH);
  const upcoming = [registrantRow(1, 'Ann'), registrantRow(4, 'Bob')];
  const past = [registrantRow(-2, 'Cass'), registrantRow(-5, 'Dev')];
  const result = sandbox.writeUpcomingPastSections(sheet, 1, RH, upcoming, past, {
    upcomingLabel: '⏳ Upcoming Registrants', pastLabel: '🕓 Past Registrants'
  });
  const jumpCol = result.jumpLinkColumn;
  assert.strictEqual(jumpCol, sandbox.SECTION_JUMP_LINK_COLUMN);

  assert.strictEqual(cellAt(grid, result.upcomingBannerRow, jumpCol),
    `=HYPERLINK("#gid=${GID}&range=A${result.pastBannerRow}", "${sandbox.SECTION_JUMP_TO_PAST_LABEL}")`,
    'the Upcoming banner points at the Past banner row');
  assert.strictEqual(cellAt(grid, result.pastBannerRow, jumpCol),
    `=HYPERLINK("#gid=${GID}&range=A${result.upcomingBannerRow}", "${sandbox.SECTION_BACK_TO_TOP_LABEL}")`,
    'the Past banner points back at the Upcoming banner row');

  // The target rows are the banners, not the headers or the data.
  assert.strictEqual(result.upcomingBannerRow, 1);
  assert.strictEqual(result.pastBannerRow, result.upcomingDataStart + upcoming.length + 1);

  // THE BANNER TEXT SURVIVES, and nothing landed between it and the link.
  assert.strictEqual(cellAt(grid, result.upcomingBannerRow, 1), '⏳ Upcoming Registrants');
  assert.strictEqual(cellAt(grid, result.pastBannerRow, 1), '🕓 Past Registrants');
  for (let c = 2; c < jumpCol; c++) {
    assert.strictEqual(cellAt(grid, result.upcomingBannerRow, c), '',
      `column ${c} of the banner row is left for the label to spill across`);
    assert.strictEqual(cellAt(grid, result.pastBannerRow, c), '');
  }
  // Nothing was merged — a merged banner blocks setFrozenColumns() on the tab.
  assert.strictEqual(sheet.calls.filter(c => c.name === 'merge' || c.name === 'mergeAcross').length, 0,
    'the banner row is never merged');

  // QUIET, and not mistakable for the column headers in the row below.
  const linkCalls = sheet.calls.filter(c => c.row === result.upcomingBannerRow && c.col === jumpCol);
  const named = n => linkCalls.filter(c => c.name === n)[0];
  assert.deepStrictEqual(named('setFontSize').args, [sandbox.TYPO.MUTED.size]);
  assert.deepStrictEqual(named('setFontWeight').args, ['normal']);
  assert.deepStrictEqual(named('setFontLine').args, ['underline']);
  assert.ok(sandbox.TYPO.MUTED.size < sandbox.TYPO.COLUMN_HEADER.size,
    'the link is smaller than a column header');
}

// ---------------------------------------------------------------------------
// 4. NO PAST ROWS, NO LINK — IN EITHER BANNER
// ---------------------------------------------------------------------------
{
  const { grid, sheet } = freshSheet('All_Registrants', RH);
  const result = sandbox.writeUpcomingPastSections(sheet, 1, RH,
    [registrantRow(1, 'Ann')], [], { upcomingLabel: '⏳ Upcoming', pastLabel: '🕓 Past' });
  const jumpCol = result.jumpLinkColumn;
  assert.strictEqual(result.pastCount, 0);
  assert.strictEqual(cellAt(grid, result.upcomingBannerRow, jumpCol), '',
    'no link down to a Past section with nothing in it');
  assert.strictEqual(cellAt(grid, result.pastBannerRow, jumpCol), '',
    'and no stranded "back" link under it');
  // The Past banner is still drawn — that is what says there is no history yet.
  assert.strictEqual(cellAt(grid, result.pastBannerRow, 1), '🕓 Past');
}

// ---------------------------------------------------------------------------
// 5. A STALE LINK IS CLEARED, NOT INHERITED
// ---------------------------------------------------------------------------
{
  // Written straight onto the sheet rather than through renderFlatDateSheet(),
  // because the early write (99u) blanks the whole tab first: this has to hold
  // for the shared writer on its own, since 43, 44 and 78 call it directly.
  const { grid, sheet } = freshSheet('All_Registrants', RH);
  const withPast = sandbox.writeUpcomingPastSections(sheet, 1, RH,
    [registrantRow(1, 'Ann')], [registrantRow(-2, 'Cass')], {});
  const jumpCol = withPast.jumpLinkColumn;
  assert.ok(String(cellAt(grid, withPast.upcomingBannerRow, jumpCol)).indexOf('HYPERLINK') === 0 ||
    String(cellAt(grid, withPast.upcomingBannerRow, jumpCol)).indexOf('=HYPERLINK') === 0,
    'the first render left a link to jump');

  // Cass's registration is deleted; the Past section is empty now.
  sandbox.invalidateSectionedRowsCache(sheet);
  const emptied = sandbox.writeUpcomingPastSections(sheet, 1, RH,
    [registrantRow(1, 'Ann')], [], {});
  assert.strictEqual(cellAt(grid, emptied.upcomingBannerRow, jumpCol), '',
    'the link from the earlier render was cleared, not left pointing at nothing');
  assert.strictEqual(cellAt(grid, emptied.pastBannerRow, jumpCol), '');
}

// ---------------------------------------------------------------------------
// 6. THE HIDDEN-ROW COUNT AND THE LINK SHARE THE BANNER ROW
// ---------------------------------------------------------------------------
{
  // collapseOldPastMonths() rewrites column A of the Past banner with
  // "🕓 Past · N hidden" AFTER the link is a cell on the same row. Columns
  // apart, but worth pinning: these two were the only writers of that row.
  const { grid, sheet } = freshSheet('All_Registrants', RH);
  const past = [registrantRow(-2, 'Cass'), registrantRow(-200, 'Old One')];
  const result = sandbox.writeUpcomingPastSections(sheet, 1, RH,
    [registrantRow(1, 'Ann')], past, { pastLabel: '🕓 Past' });
  assert.ok(result.hiddenPastRows > 0, 'a row from last winter is collapsed');
  assert.ok(String(cellAt(grid, result.pastBannerRow, 1)).indexOf('hidden') !== -1,
    'the count is still in the banner text');
  assert.ok(String(cellAt(grid, result.pastBannerRow, result.jumpLinkColumn)).indexOf('HYPERLINK') !== -1,
    'and the link is still beside it');
}

// ---------------------------------------------------------------------------
// 7. A TAB WHOSE SECTIONS ARE NOT CALLED UPCOMING AND PAST SAYS SO
// ---------------------------------------------------------------------------
{
  const { grid, sheet } = freshSheet('Master_Program_Dashboard', RH);
  const result = sandbox.writeUpcomingPastSections(sheet, 1, RH,
    [registrantRow(1, 'Ann')], [registrantRow(-2, 'Cass')], {
      upcomingLabel: '▶️ Running', pastLabel: '⏸️ Not Currently Running',
      jumpToPastLabel: '⬇ Jump to Not Currently Running', collapseOldMonths: false
    });
  assert.ok(String(cellAt(grid, result.upcomingBannerRow, result.jumpLinkColumn))
    .indexOf('⬇ Jump to Not Currently Running') !== -1, 'the caller\'s own wording is used');
  assert.ok(String(cellAt(grid, result.pastBannerRow, result.jumpLinkColumn))
    .indexOf(sandbox.SECTION_BACK_TO_TOP_LABEL) !== -1, '"back to top" means the same thing on every tab');
}

// ---------------------------------------------------------------------------
// 8. THE EARLY WRITE (99u) LEAVES THE LINK CELLS BLANK
// ---------------------------------------------------------------------------
{
  // 99u's rule: a non-blank cell may be written early only where the render
  // writes that same cell. The block cannot know the gid or the Past banner's
  // row, so it writes nothing there — and a blank is what clear() would have
  // left, which is also what takes a stale link off the tab.
  const upcoming = [registrantRow(1, 'Ann')];
  const past = [registrantRow(-2, 'Cass')];
  const block = sandbox.sectionedTableValueBlock_(1, RH, upcoming, past, {});
  const early = sandbox.composeTabValueGrid_([block]);
  const jumpCol = sandbox.sectionJumpLinkColumn_(RH.length);
  const blank = v => v === '' || v === undefined || v === null;
  assert.ok(blank((early[0] || [])[jumpCol - 1]), 'the Upcoming banner link cell is blank early');
  const pastBanner0 = 1 + 1 + upcoming.length + 1; // banner, header, rows, spacer
  assert.ok(blank((early[pastBanner0] || [])[jumpCol - 1]), 'the Past banner link cell is blank early');
  assert.strictEqual((early[pastBanner0] || [])[0], '🕓 Past', 'and the row is the Past banner');
}

// ---------------------------------------------------------------------------
// 9. THE WHOLE RENDER PATH: a flat tab ends up with a working pair
// ---------------------------------------------------------------------------
{
  const { grid, sheet } = freshSheet('All_Registrants', RH);
  sandbox.invalidateAutosizeMemo();
  const result = sandbox.renderFlatDateSheet(sheet, RH,
    [registrantRow(2, 'Ann'), registrantRow(-3, 'Cass'), registrantRow(-9, 'Dev')], {
      upcomingLabel: '⏳ Upcoming Registrants', pastLabel: '🕓 Past Registrants',
      textColumns: ['Event_Time'], afterWrite: sandbox.applyRegistrantsFormatting
    });
  const jumpCol = result.jumpLinkColumn;
  assert.strictEqual(cellAt(grid, result.upcomingBannerRow, jumpCol),
    `=HYPERLINK("#gid=${GID}&range=A${result.pastBannerRow}", "${sandbox.SECTION_JUMP_TO_PAST_LABEL}")`);
  assert.strictEqual(cellAt(grid, result.pastBannerRow, jumpCol),
    `=HYPERLINK("#gid=${GID}&range=A${result.upcomingBannerRow}", "${sandbox.SECTION_BACK_TO_TOP_LABEL}")`);
  assert.strictEqual(cellAt(grid, result.upcomingBannerRow, 1), '⏳ Upcoming Registrants',
    'the banner text came through a full render untouched');
  // The link lands on the banner row, never on a header or a data row.
  assert.notStrictEqual(result.upcomingBannerRow, result.upcomingHeaderRow);
  assert.strictEqual(cellAt(grid, result.upcomingHeaderRow, jumpCol), RH[jumpCol - 1],
    'the header row still holds its own column name');
}

// A render that cannot write the link says so and carries on — a link between
// two sections is not worth a failed render.
{
  const { sheet } = freshSheet('All_Registrants', RH);
  logged = [];
  const orig = sheet.getRange;
  sheet.getRange = (...args) => {
    if (args[0] === 1 && args[1] === sandbox.SECTION_JUMP_LINK_COLUMN && (args[2] || 1) === 1) {
      return { setValue: () => { throw new Error('refused'); } };
    }
    return orig(...args);
  };
  assert.strictEqual(sandbox.writeSectionJumpLink_(sheet, 1, sandbox.SECTION_JUMP_LINK_COLUMN, '=HYPERLINK("#gid=1&range=A9", "x")'),
    false);
  assert.ok(logged.some(l => l.indexOf('Could not write the section link') !== -1),
    'the refusal is logged rather than thrown');
  sheet.getRange = orig;
}

console.log('✅ section_jump_links.test.js passed');
