// THE BUG: every memory tab applied its dropdowns and checkboxes to exactly
// the rows that already had data on them. writeMemoryTab() clears every data
// validation on the sheet first, so the blank row under the last one — the row
// a person actually types their next question into — had no dropdown, no
// checkbox, and no complaint about a Type spelled wrong. On an EMPTY tab the
// whole block was skipped by `if (rows.length > 0)`, so a first-time visitor
// met a tab with nothing to pick from anywhere on it.
//
// What is pinned here: the band reaches past the data, an empty tab still gets
// it, the sheet is grown to hold it, and a column this workbook's layout
// hasn't got is skipped rather than throwing.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    newDataValidation: () => {
      const rule = { kind: '', options: null, allowInvalid: null };
      const builder = {
        requireCheckbox: () => { rule.kind = 'checkbox'; return builder; },
        requireValueInList: (opts, showDropdown) => {
          rule.kind = 'list'; rule.options = opts; rule.showDropdown = showDropdown; return builder;
        },
        setAllowInvalid: v => { rule.allowInvalid = v; return builder; },
        build: () => rule
      };
      return builder;
    }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.applyMemoryTabValidation = applyMemoryTabValidation;
this.memoryTabValidationRows = memoryTabValidationRows;
this.MEMORY_TAB_SPARE_ROWS = MEMORY_TAB_SPARE_ROWS;
this.MEMORY_TAB_DATA_ROW = MEMORY_TAB_DATA_ROW;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// A sheet that records what was asked of it and nothing else.
function fakeSheet(maxRows) {
  const calls = { validations: [], inserted: 0, aligned: 0 };
  const sheet = {
    getMaxRows: () => maxRows,
    insertRowsAfter: (after, howMany) => { calls.inserted += howMany; maxRows += howMany; },
    getRange: (row, col, numRows) => ({
      setDataValidation: rule => {
        calls.validations.push({ row, col, numRows, kind: rule.kind, options: rule.options });
        return { setHorizontalAlignment: () => { calls.aligned++; } };
      },
      setHorizontalAlignment: () => {}
    })
  };
  return { sheet, calls };
}

const HEADERS_UNDER_TEST = ['Program', 'Question', 'Type', 'Required', 'Active'];

// --- the band reaches past the data -----------------------------------------
{
  const { sheet, calls } = fakeSheet(1000);
  const span = sandbox.applyMemoryTabValidation(sheet, HEADERS_UNDER_TEST, 4, {
    checkboxes: ['Required', 'Active'],
    lists: { Type: ['Dropdown', 'Paragraph'] }
  });
  check('four rows of data get four rows plus the spare band',
    span, 4 + sandbox.MEMORY_TAB_SPARE_ROWS);
  check('every validation covers the whole band',
    calls.validations.map(v => v.numRows), [span, span, span]);
  check('and starts on the first data row',
    calls.validations.map(v => v.row), [sandbox.MEMORY_TAB_DATA_ROW, sandbox.MEMORY_TAB_DATA_ROW,
      sandbox.MEMORY_TAB_DATA_ROW]);
  check('the checkboxes are checkboxes and the list is a list',
    calls.validations.map(v => v.kind), ['checkbox', 'checkbox', 'list']);
}

// --- AN EMPTY TAB STILL GETS ITS DROPDOWNS. This is the whole point ---------
{
  const { sheet, calls } = fakeSheet(1000);
  const span = sandbox.applyMemoryTabValidation(sheet, HEADERS_UNDER_TEST, 0, {
    checkboxes: ['Active'],
    lists: { Type: ['Dropdown'] }
  });
  check('an empty tab gets the spare band', span, sandbox.MEMORY_TAB_SPARE_ROWS);
  check('and both validations are written', calls.validations.length, 2);
}

// --- the sheet is grown to hold the band ------------------------------------
{
  const { sheet, calls } = fakeSheet(10); // a short sheet: 3 + 20 + 50 rows will not fit
  sandbox.applyMemoryTabValidation(sheet, HEADERS_UNDER_TEST, 20, { checkboxes: ['Active'] });
  check('the sheet grows exactly far enough',
    calls.inserted, (sandbox.MEMORY_TAB_DATA_ROW + 20 + sandbox.MEMORY_TAB_SPARE_ROWS - 1) - 10);
}
{
  const { sheet, calls } = fakeSheet(5000);
  sandbox.applyMemoryTabValidation(sheet, HEADERS_UNDER_TEST, 20, { checkboxes: ['Active'] });
  check('a sheet already long enough is not grown', calls.inserted, 0);
}

// --- a column this layout hasn't got is skipped, not thrown -----------------
{
  const { sheet, calls } = fakeSheet(1000);
  sandbox.applyMemoryTabValidation(sheet, HEADERS_UNDER_TEST, 3, {
    checkboxes: ['Active', 'Auto_Note'],          // Auto_Note is on another tab
    lists: { Type: ['Dropdown'], Frequency: ['Weekly'] } // Frequency likewise
  });
  check('only the columns that exist are written', calls.validations.length, 2);
}

// --- open lists suggest rather than restrict --------------------------------
{
  const { sheet, calls } = fakeSheet(1000);
  sandbox.applyMemoryTabValidation(sheet, HEADERS_UNDER_TEST, 1, {
    openLists: { Program: ['Book Club', 'Yoga'] }
  });
  check('an open list is still a list', calls.validations[0].kind, 'list');
  check('and it carries the options given', calls.validations[0].options, ['Book Club', 'Yoga']);
}

console.log(failures === 0 ? '\nAll memory tab validation checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
