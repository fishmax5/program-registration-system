// THE SCRIPT, AS ONE STRING.
//
// The Apps Script project is a set of `.gs` files sharing ONE global scope, and
// Apps Script evaluates them in filename order. The numeric prefixes are what
// make that order deterministic, and they matter: a good number of the
// top-level `const`s are computed from an earlier one (MANUAL_OVERRIDE_COLOR
// from PALETTE, LUNCH_ONLY_TYPE_TAG from EVENT_TYPES, TIMEZONE from the live
// spreadsheet), so a file evaluated out of order is a TDZ error at load, not a
// bug you find later.
//
// The tests run the script in a Node `vm` with the Apps Script services
// stubbed, so they need the same thing the runtime sees: every file, in that
// order, concatenated. Sorting by filename here is not a convenience — it is
// the same rule the runtime applies.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** Every script file, in the order Apps Script evaluates them. */
function sourceFiles() {
  return fs.readdirSync(ROOT)
    .filter(name => name.endsWith('.gs'))
    .sort()
    .map(name => path.join(ROOT, name));
}

/** The whole project as one string — what a test hands to `vm.runInContext`. */
function readSource() {
  return sourceFiles().map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

module.exports = { ROOT, sourceFiles, readSource };
