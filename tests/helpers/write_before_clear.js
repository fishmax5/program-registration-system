// ============================================================================
// "WRITE BEFORE CLEARING", CHECKED AGAINST A REAL RENDER
// ============================================================================
//
// 99u_write_before_clear.gs replaced every tab's clear() with one early
// setValues() of the values the render is about to produce, padded over the
// old tab. Its whole safety rests on one rule: a non-blank cell may be written
// early only where the render will write that same cell again. Break it and a
// predicted row that is off by one leaves a stale header or a duplicated
// registrant sitting on the tab forever, which is worse than the empty tab it
// replaced.
//
// So this wraps a counting sheet (./counting_sheet.js), fills it with junk the
// way a previous, larger render would have, forbids clear(), snapshots the grid
// the instant the early write lands, and after the render checks:
//
//   1. the early write happened, from A1, before anything else was written;
//   2. every non-blank cell it wrote is written AGAIN by the render (so the
//      prediction put each cell where the render puts it — a header the render
//      relabels "✍️ Attended" still counts, since the render owns that cell);
//   3. no junk survived — neither in the snapshot nor at the end.
//
// `run` is called after arming; `expectRows` is data that must be in the
// snapshot (the rows a killed run would have kept).
// ============================================================================
const assert = require('assert');

const JUNK = 'OLD-JUNK';

function sameCell(a, b) {
  const norm = v => (v instanceof Date || (v && typeof v.getTime === 'function')
    ? v.getTime() : (v === null || v === undefined ? '' : v));
  return norm(a) === norm(b);
}

function checkWriteBeforeClear(label, sheet, grid, run, options) {
  options = options || {};
  const junkRows = options.junkRows || 60;
  const junkCols = options.junkCols || 45;
  grid.length = 0;
  for (let r = 0; r < junkRows; r++) grid.push(new Array(junkCols).fill(JUNK));

  sheet.clear = () => { throw new Error(`${label}: clear() was called — the tab would sit empty`); };

  let snapshot = null;
  let firstWriteRow = null;
  const rewritten = {}; // "r:c" of every cell a value write reached after the early one
  const VALUE_WRITES = ['setValues', 'setValue', 'setFormulas', 'setFormula',
    'setRichTextValues', 'setRichTextValue'];
  const origGetRange = sheet.getRange;
  sheet.getRange = (...args) => {
    const range = origGetRange(...args);
    const row = args[0];
    const col = args[1];
    const rows = args[2] || 1;
    const cols = args[3] || 1;
    return new Proxy(range, {
      get(target, prop) {
        if (VALUE_WRITES.indexOf(prop) !== -1) {
          return value => {
            const out = target[prop](value);
            if (!snapshot) {
              firstWriteRow = [row, col];
              snapshot = grid.map(line => line.slice());
            } else {
              for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rewritten[`${row + r}:${col + c}`] = true;
            }
            return out;
          };
        }
        return target[prop];
      }
    });
  };

  try {
    run();
  } finally {
    sheet.getRange = origGetRange;
  }

  assert.ok(snapshot, `${label}: nothing was written`);
  assert.deepStrictEqual(firstWriteRow, [1, 1], `${label}: the first write is the early one, from A1`);

  const flat = g => g.reduce((all, line) => all.concat(line), []);
  assert.ok(flat(snapshot).indexOf(JUNK) === -1, `${label}: the early write left old cells behind`);
  assert.ok(flat(grid).indexOf(JUNK) === -1, `${label}: the render left old cells behind`);

  // THE RULE: every non-blank cell written early is written again by the
  // render. One that is not would sit on the tab forever with a value the
  // render never meant — the early write was in the wrong place.
  // `singleWrite`: the early write IS the whole write (Quick Mark's index),
  // so there is no second pass to agree with.
  for (let r = 0; !options.singleWrite && r < snapshot.length; r++) {
    for (let c = 0; c < snapshot[r].length; c++) {
      const early = snapshot[r][c];
      if (early === '' || early === null || early === undefined) continue;
      assert.ok(rewritten[`${r + 1}:${c + 1}`],
        `${label}: R${r + 1}C${c + 1} was written early as ${JSON.stringify(early)} ` +
        `and never written by the render — the early write is in the wrong place`);
    }
  }

  (options.expectRows || []).forEach(expected => {
    const found = snapshot.some(line => expected.every((v, i) => sameCell(v, line[i])));
    assert.ok(found, `${label}: a row the render writes was not on the tab after the early write`);
  });
  return snapshot;
}

module.exports = { checkWriteBeforeClear, JUNK };
