// MEMBERSHIP APPLICATION ALERT (99zt) and parseDriveFolderId_ (82c).
const vm = require('vm');
const assert = require('assert');
const src = require('./helpers/source').readSource();
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {}, getUuid: () => 'u' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.build = buildMembershipApplicationEmail_; this.parseId = parseDriveFolderId_;`, sandbox);

const item = (t, r) => ({ getItem: () => ({ getTitle: () => t }), getResponse: () => r });
const out = sandbox.build({ getItemResponses: () => [
  item('Full Name', 'Ann <b>Lee</b>'), item('Interests', ['Yoga', 'Bridge']), item('Phone', '')
] }, 'https://docs.google.com/spreadsheets/d/x/edit');
assert.strictEqual(out.subject, 'New membership application — Ann <b>Lee</b>');
assert(out.html.includes('Ann &lt;b&gt;Lee&lt;/b&gt;'), 'answers are escaped');
assert(out.text.includes('Yoga, Bridge') && out.text.includes('All applications: https://docs.google.com'));
assert(out.html.includes('href="https://docs.google.com/spreadsheets/d/x/edit"'));
console.log('ok   email carries every answer, escaped, with the sheet link');

assert.strictEqual(sandbox.parseId('https://drive.google.com/drive/folders/1Tk838L2VDVIRB7_pr40oIDm0ArleqQh_'), '1Tk838L2VDVIRB7_pr40oIDm0ArleqQh_');
assert.strictEqual(sandbox.parseId('not a folder'), '');
console.log('ok   folder links parse');
console.log('all passed');
