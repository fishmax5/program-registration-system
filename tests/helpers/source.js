// THE SCRIPT, AS ONE STRING.
//
// The Apps Script project is a set of `.gs` files sharing ONE global scope. The
// numeric prefixes ask the project to evaluate them in filename order, and this
// file reproduces that order — it is what a correctly-ordered deployment sees.
//
// It is NOT a guarantee the runtime makes. Apps Script evaluates files in
// whatever order the project has them stored, which a sync tool can reorder;
// the project is written to survive that (see 01a_lazy_globals.gs), and
// tests/load_order.test.js is what proves it, by calling sourceFiles() and then
// deliberately reversing and shuffling the result.
//
// The tests run the script in a Node `vm` with the Apps Script services
// stubbed, so they need the same thing the runtime sees: every file, in order,
// concatenated.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** Every script file, in the order the numeric prefixes ask for. */
function sourceFiles() {
  return fs.readdirSync(ROOT)
    // Code.bundle.gs is tools/bundle.js's output, not source — it is the whole
    // project concatenated, so leaving it in would declare every constant twice.
    .filter(name => name.endsWith('.gs') && name !== 'Code.bundle.gs')
    .sort()
    .map(name => path.join(ROOT, name));
}

/** The whole project as one string — what a test hands to `vm.runInContext`. */
function readSource() {
  return sourceFiles().map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

module.exports = { ROOT, sourceFiles, readSource };
