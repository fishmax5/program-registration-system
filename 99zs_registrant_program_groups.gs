// ============================================================================
// 99zs. THE REGISTRANTS TAB, GROUPED BY PROGRAM  (sort, headings, collapse)
// ============================================================================
//
// `All_Registrants` was sorted by DATE and nothing else, inside each of the
// two sections `34` draws. That is the right order for a kitchen — everybody
// eating on Tuesday is together — and the wrong one for every other question
// anybody asks of this tab, all of which are about a program: who is in Chair
// Yoga, how full is it, is Marion on it next month. Those answers were spread
// across every date the program runs, interleaved with four other programs on
// the same day, and the only way to read one was to filter the tab.
//
// So inside each section the rows are now sorted BY PROGRAM, then by date, and
// each program's block opens with a heading row.
//
// WHAT A PROGRAM IS HERE: `Location` + `Event`, the boundary the rest of the
// workbook draws (`spreadFlagToSiblingRows`, `99m`'s dialog, the leader
// sheets). Two buildings running the same class are two programs with two
// capacities and two rosters, and one heading over both would be a heading
// over two different things. The title is worn down through
// `quickMarkTitleKey()` so a lunch-only row groups with the rest of lunch.
//
// THE BLOCKS ARE ALPHABETICAL, not soonest-first. "Sort by program" is a
// reading order, and a tab whose blocks move every morning as one program's
// next date passes another's is one nobody can learn the shape of. Inside a
// block the section's own direction is kept: ascending in Upcoming, most
// recent first in Past, so the collapse below still has something to work on.
//
// THE HEADINGS ARE REAL ROWS, on `40`'s precedent (`Program_Settings`' kind
// headings, `Member_Roll`'s retired line) and for the same reason: a heading
// that is not a row is a frozen pane or a filter view, and neither survives
// the rewrite this tab gets every hour. Being real rows, they have to be
// invisible to every reader — and they are, twice over. They carry no
// `Event_Date`, which is already the whole of what the sectioned readers in
// `34` treat as a data row ("banner/spacer rows are skipped automatically"),
// and the label carries `REGISTRANT_GROUP_DIVIDER_PREFIX`, which
// `isSectionedDividerValue()` recognizes in those same readers for the one
// case a blank date does not cover: a program whose own title happens to
// parse as a date.
//
// WHAT A HEADING ROW IS NOT PROTECTED FROM is somebody typing over it. It
// sits inside a section's data zone, so `findZoneForRow()` (`34`) hands an
// edit on it to the ordinary handlers in `18` — which find a row with no
// `Event_ID` and no date and do nothing with it. The heading comes back on the
// next render. It is left that way rather than protected because a protection
// per heading is a protection per program per section, which is `39`'s bill
// again, for a row nobody has a reason to edit.
//
// A HEADING IS PAINTED FROM A RANGE LIST, never with `writeSectionBanner()`.
// A banner is five round trips; ninety programs across two sections is a
// hundred and eighty banners and the better part of a thousand calls, on a
// tab that is already the most expensive render in the project. The wash goes
// out through `97`'s background plane (free — it is part of the band being
// written anyway) and the rest is `39`/`46`'s rule: one `getRangeList()` call
// per attribute for every heading on the tab, not one per heading.
// ============================================================================

/**
 * What marks a row on a sectioned tab as a heading rather than data.
 *
 * It is part of the LABEL rather than a column of its own, because a column
 * would have to be added to `HEADERS.All_Registrants` and read back by
 * fifteen callers to answer a question a blank date already answers.
 */
const REGISTRANT_GROUP_DIVIDER_PREFIX = '▸ ';

/**
 * The heading band's wash, and the font that clears 4.5:1 on it. Lazy, not
 * `const`: both read `PALETTE`, which lives in another file — see
 * `01a_lazy_globals.gs`.
 */
defineLazyGlobal_('REGISTRANT_GROUP_DIVIDER_BG', () => PALETTE.HEADER_BG);
defineLazyGlobal_('REGISTRANT_GROUP_DIVIDER_FG', () => PALETTE.PAPER);

/**
 * True for a cell that is a section heading written by this file.
 *
 * Checked in `34`'s two sectioned readers BESIDE the date filter, not instead
 * of it. The date filter is what makes every existing banner and spacer row
 * invisible and it already covers a heading; this covers the one heading it
 * would not, which is a program titled something `new Date()` will parse.
 */
function isSectionedDividerValue(value) {
  return String(value === null || value === undefined ? '' : value)
    .trim().indexOf(REGISTRANT_GROUP_DIVIDER_PREFIX.trim()) === 0;
}

/**
 * The program one registrant row belongs to: building and worn-down title.
 * Blank in both is its own group rather than a throw — a hand-typed row with
 * no program still has to be drawn somewhere a person can find it.
 */
function registrantProgramGroupKey(row, map) {
  const location = String(row[map['Location']] || '').trim().toLowerCase();
  const title = quickMarkTitleKey(row[map['Event']]).toLowerCase();
  return `${title}|${location}`;
}

/** What the heading row says. */
function registrantProgramGroupLabel(row, map) {
  const title = String(row[map['Event']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  const name = title || '(no program named)';
  return REGISTRANT_GROUP_DIVIDER_PREFIX + (location ? `${name} — ${location}` : name);
}

/**
 * One heading row, full width so the matrix `setValues()` writes stays
 * rectangular. The label goes in column 1 — which is `Event_Date`, and
 * therefore the column the readers test — because a heading a person has to
 * scroll right to read is not a heading.
 */
function registrantGroupDividerRow(label, numCols) {
  const out = new Array(numCols).fill('');
  out[0] = label;
  return out;
}

/**
 * `rows` sorted by program, then by date, with a heading row before each
 * program. Pure, and the one place the order is decided.
 *
 * `descending` is the section's own direction for the dates INSIDE a block;
 * the blocks themselves are alphabetical either way.
 */
function groupRegistrantRowsByProgram(rows, headers, descending) {
  const all = rows || [];
  if (all.length === 0) return [];
  const map = getIndexMap(headers);
  if (map['Event'] === undefined || map['Location'] === undefined) return all;
  const dateIdx = headers.indexOf('Event_Date');
  const numCols = headers.length;

  const blocks = {};
  const order = [];
  all.forEach(row => {
    const key = registrantProgramGroupKey(row, map);
    if (!blocks[key]) {
      blocks[key] = { label: registrantProgramGroupLabel(row, map), rows: [] };
      order.push(key);
    }
    blocks[key].rows.push(row);
  });

  // Alphabetical on what the heading SAYS, so the tab reads in the order
  // somebody scanning the headings would expect, and stable on the key so two
  // blocks that spell the same label never swap places between renders.
  order.sort((a, b) => {
    const la = blocks[a].label.toLowerCase(), lb = blocks[b].label.toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });

  const byDate = (a, b) => {
    const da = dateIdx >= 0 ? coerceDate(a[dateIdx]) : null;
    const db = dateIdx >= 0 ? coerceDate(b[dateIdx]) : null;
    if (!da || !db) return 0;
    return descending ? db - da : da - db;
  };

  const out = [];
  order.forEach(key => {
    const block = blocks[key];
    out.push(registrantGroupDividerRow(block.label, numCols));
    block.rows.sort(byDate).forEach(row => out.push(row));
  });
  return out;
}

/**
 * The 1-based sheet rows holding a heading, given the row where a band's data
 * starts and the band's rows (headings included).
 */
function registrantGroupDividerRowNumbers(dataStart, rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    if (isSectionedDividerValue(row[0])) out.push(dataStart + i);
  });
  return out;
}

/**
 * Paints every heading on the tab: ONE call per attribute for all of them.
 *
 * Run AFTER `withRenderBatch()` has flushed, because what it undoes is what
 * the batch and the tab's `afterWrite` hook just did to those rows — the
 * zebra stripe, the month tint in column A, and above all the validations,
 * which `97`'s validation plane shares as one row array across the whole band
 * and so cannot exempt a row from. Five check-boxes and three dropdowns on a
 * heading row is not a heading.
 *
 * Never throws: a heading that is the wrong colour is worth strictly less
 * than a render that failed.
 */
function formatRegistrantGroupDividers_(sheet, numCols, rowNumbers) {
  if (!sheet || !rowNumbers || rowNumbers.length === 0) return 0;
  const a1 = rowNumbers.map(row => `R${row}C1:R${row}C${numCols}`);
  try {
    const list = sheet.getRangeList(a1);
    list.clearDataValidations();
    list.setBackground(REGISTRANT_GROUP_DIVIDER_BG);
    list.setFontColor(REGISTRANT_GROUP_DIVIDER_FG);
    list.setFontWeight('bold');
    list.setHorizontalAlignment('left');
    list.setNumberFormat('@');
  } catch (err) {
    log(`ℹ️ Could not format ${rowNumbers.length} program heading(s) on "${sheet.getName()}" (${err}).`);
    return 0;
  }
  return rowNumbers.length;
}

/**
 * How many separate `hideRows()` calls the old-month collapse may make before
 * it gives up and hides nothing. A year-old tab merges into a handful of runs
 * because most blocks are entirely old; a tab where it does not is one where
 * hiding costs more round trips than the hiding is worth.
 */
const REGISTRANT_COLLAPSE_MAX_RUNS = 20;

/**
 * The grouped tab's answer to `collapseOldPastMonths()`.
 *
 * WHY IT IS A DIFFERENT FUNCTION. That one is a suffix scan, and says so: the
 * Past section is sorted most-recent-first, so "older than the cutoff" is a
 * suffix by construction and one `hideRows()` covers it however many years
 * accumulate. Sorting by program breaks exactly that property — each block is
 * date-ordered but the blocks are alphabetical, so the old months are now
 * scattered down the tab in runs.
 *
 * So the runs are found and hidden, merged wherever they touch. A heading is
 * hidden with its block only when the whole block is old: a heading left
 * behind over nothing reads as a program with no registrations, which is a
 * different and worse statement than a program whose history is put away.
 */
function collapseOldGroupedPastRows_(sheet, dataStart, rows, dateColIdx) {
  if (!rows || rows.length === 0 || dateColIdx < 0) return 0;
  const cutoff = getVisibleMonthCutoffKey();

  // Pass one: is each row old? A heading's answer waits for its block.
  const old = rows.map(row => {
    if (isSectionedDividerValue(row[0])) return null;
    const d = coerceDate(row[dateColIdx]);
    // An undated row counts as visible, exactly as the suffix scan has it:
    // hiding a row nobody can find again by date is the outcome to avoid.
    if (!d) return false;
    return formatMonthKey(d) < cutoff;
  });

  // Pass two: a heading is old only if every dated row under it is.
  for (let i = 0; i < old.length; i++) {
    if (old[i] !== null) continue;
    let allOld = true, seen = 0;
    for (let j = i + 1; j < old.length && old[j] !== null; j++) {
      seen++;
      if (!old[j]) { allOld = false; break; }
    }
    old[i] = seen > 0 && allOld;
  }

  const runs = [];
  for (let i = 0; i < old.length; i++) {
    if (!old[i]) continue;
    let end = i;
    while (end + 1 < old.length && old[end + 1]) end++;
    runs.push({ start: dataStart + i, count: end - i + 1 });
    i = end;
  }
  if (runs.length === 0) return 0;
  if (runs.length > REGISTRANT_COLLAPSE_MAX_RUNS) {
    log(`ℹ️ "${sheet.getName()}": ${runs.length} separate runs of old rows — left visible ` +
      `rather than spending that many calls hiding them.`);
    return 0;
  }

  let hidden = 0;
  runs.forEach(run => {
    try {
      sheet.hideRows(run.start, run.count);
      hidden += run.count;
    } catch (err) {
      log(`ℹ️ Could not hide ${run.count} old row(s) on "${sheet.getName()}" (${err}) — they stay visible.`);
    }
  });
  return hidden;
}
