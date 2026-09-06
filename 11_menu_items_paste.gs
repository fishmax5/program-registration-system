// ============================================================================
// 1e. ADDING MENU ITEMS  (Lunch_Schedule: paste CSV, in the sheet or a dialog)
// ============================================================================
//
// WHAT THIS REPLACED, and why. Adding a menu item used to mean typing into
// the Upcoming table, at which point every single committed cell:
//   1. re-rendered and RE-SORTED the whole tab — so the half-finished row you
//      were typing jumped somewhere else mid-entry; and
//   2. threw up a modal asking whether to rewrite every live registration
//      form covering that date.
// Neither is survivable while entering a month of menus, and there was no
// blank row to type into in the first place: the Upcoming table ends exactly
// where its last dated row does, so adding one meant inserting a row by hand
// first. That whole arrangement is gone.
//
// WHAT IT IS NOW. The tab ends with an ADD block — a banner, a header, and
// open space to the bottom of the sheet. Put CSV there, however much of it:
//
//     2026-09-14, Narberth, Hot, Chicken Parmesan, Chx Parm
//     2026-09-15, Ashbridge, Cold, Turkey Wrap, Turkey
//     2026-09-16, Narberth, Not Serving
//
// as a normal multi-column paste (from Excel/Sheets), as raw comma-separated
// text (one cell per line, or one cell holding every line), or typed a row at
// a time. All of it lands in the same parser, so ONE row and TWO HUNDRED rows
// behave identically — the only difference is how long the toast takes.
// Complete rows are folded into the schedule and the block is emptied ready
// for the next batch; anything unparseable stays put with a reason, so a bad
// date in row 40 never silently swallows a good row 41.
//
// Pushing the menu out to live forms is now an EXPLICIT act — the
// "🍱 Push Menu Changes to Forms" menu item — rather than a modal that
// interrupts typing. The daily Sync Cal picks it up regardless.
// ============================================================================

/** Column A marker that locates the ADD block. Must not collide with a real header. */
const LUNCH_ADD_MARKER = '➕ ADD MENU ITEMS';
/**
 * The ADD block's own header labels. Deliberately NOT the canonical
 * HEADERS.Lunch_Schedule names: getSectionZones()/readAllSectionedRows() find
 * this tab's real tables by scanning for the literal header 'Event_Date', and
 * a third row carrying that word would be read as a third data table.
 */
const LUNCH_ADD_HEADERS = ['Date', 'Location', 'Type', 'Meal Description', 'Shorthand'];
/** Blank rows left under the ADD header. A bigger paste simply extends past it. */
const LUNCH_ADD_BLANK_ROWS = 15;

/**
 * The last row of Lunch_Schedule that is genuinely SCHEDULE — everything
 * above the ADD block's banner.
 *
 * This is the one thing the bottom-mounted ADD block costs, and it has to be
 * respected by every reader of the tab: rows waiting (or rejected) in the add
 * area carry real dates, so an unbounded read would quietly absorb them into
 * the Past table and a rejected row would "disappear into" the schedule
 * instead of staying put to be corrected.
 */
function getLunchScheduleEndRow(sheet) {
  const add = findLunchAddBlock(sheet);
  return add ? add.bannerRow - 1 : sheet.getLastRow();
}

/** Every real schedule row on the tab, ADD block excluded. */
function readLunchScheduleRows(sheet) {
  return getSectionedRows(sheet, HEADERS.Lunch_Schedule, 'Event_Date', getLunchScheduleEndRow(sheet));
}

/** The tab's Upcoming/Past data zones, ADD block excluded. */
function getLunchScheduleZones(sheet) {
  return getSectionZones(sheet, 'Event_Date', getLunchScheduleEndRow(sheet));
}

/**
 * Locates the ADD block by its banner marker. Returns null when the tab
 * hasn't been rendered with one yet (an older workbook), which every caller
 * treats as "no add area" rather than an error.
 */
function findLunchAddBlock(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0] || '').indexOf(LUNCH_ADD_MARKER) === 0) {
      const bannerRow = i + 1;
      return { bannerRow, headerRow: bannerRow + 1, firstRow: bannerRow + 2 };
    }
  }
  return null;
}

/**
 * Fired via onEdit() when Lunch_Schedule is hand-edited.
 *
 * Two zones, two behaviours:
 *   ADD block  -> harvest whatever is complete into the schedule (see above).
 *   The tables -> tidy the edited cells in place. NO re-render: correcting a
 *                 typo must not move the row you are looking at.
 */
function handleLunchScheduleEdit(e, sheet) {
  const add = findLunchAddBlock(sheet);
  const editedRow = e.range.getRow();
  const editedLastRow = editedRow + e.range.getNumRows() - 1;

  if (add && editedLastRow >= add.firstRow) {
    harvestPastedMenuRows(sheet, add);
    return;
  }
  normalizeLunchScheduleCells(e, sheet);
}

/**
 * Tidies the rows just edited INSIDE one of the real tables: text dates become
 * real dates, and Location/Type are snapped to their canonical spelling. The
 * row stays exactly where it is.
 */
function normalizeLunchScheduleCells(e, sheet) {
  const zones = getLunchScheduleZones(sheet);
  const editedRow = e.range.getRow();
  if (!isRowInAnyDataZone(zones, editedRow)) return;

  const headers = HEADERS.Lunch_Schedule;
  const map = getIndexMap(headers);
  const numRows = e.range.getNumRows();
  const range = sheet.getRange(editedRow, 1, numRows, headers.length);
  const values = range.getValues();

  let changed = false;
  let touchedUpcoming = false;
  const todayKey = formatDateKey(new Date());
  const nowNotServing = [];

  values.forEach(row => {
    const date = coerceDate(row[map['Event_Date']]);
    if (date) {
      if (!(row[map['Event_Date']] instanceof Date)) { row[map['Event_Date']] = date; changed = true; }
      if (formatDateKey(date) >= todayKey) touchedUpcoming = true;
    }
    const loc = canonicalizeLocation(row[map['Location']]);
    if (loc && loc !== row[map['Location']]) { row[map['Location']] = loc; changed = true; }
    const type = canonicalizeLunchType(row[map['Type']]);
    if (type && type !== row[map['Type']]) { row[map['Type']] = type; changed = true; }
    const finalType = String(row[map['Type']] || '').trim();
    if (date && finalType === 'Not Serving') {
      nowNotServing.push({ date, location: String(row[map['Location']] || '').trim() });
    }
  });

  if (changed) {
    range.setValues(values);
    invalidateSectionedRowsCache(sheet);
  }
  // Before the sign-up check below: it asks getMealInfoForDate() what the
  // schedule says, and the answer has to be what was just typed.
  invalidateMealInfoIndex();

  // Say it now, while the person who closed the kitchen is still looking at
  // the screen. The durable version goes out by email on the next sync — see
  // buildDashboardRollup().
  const warned = warnAboutNotServingSignups(nowNotServing);

  if (touchedUpcoming && warned === 0) {
    toastIfPossible('Menu updated. Live forms still show the old text — use ' +
      '"🍱 Push Menu Changes to Forms", or wait for the next Sync Cal.');
  }
}

/**
 * Reads everything sitting in the ADD block, folds the complete rows into the
 * schedule, and leaves the rest behind with a reason.
 *
 * A row is COMPLETE when it has a parseable date, a known location and a
 * known type. That threshold is what makes typing one row by hand work at
 * all: onEdit fires on every committed cell, so a row still being typed
 * (date entered, location not yet) must be left alone rather than harvested
 * half-built and rejected. A pasted row arrives complete in a single event
 * and is taken immediately.
 */
function harvestPastedMenuRows(sheet, add) {
  const lastRow = sheet.getLastRow();
  if (lastRow < add.firstRow) return;

  const width = Math.max(sheet.getLastColumn(), LUNCH_ADD_HEADERS.length);
  const raw = sheet.getRange(add.firstRow, 1, lastRow - add.firstRow + 1, width).getValues();
  const parsed = parseLunchMenuGrid(raw);
  if (parsed.rows.length === 0 && parsed.rejects.length === 0) return; // block is empty

  if (parsed.rows.length === 0) {
    // Nothing usable yet. Silent while a row is merely unfinished; explicit
    // once something is actually wrong with it.
    const hard = parsed.rejects.filter(r => !r.incomplete);
    if (hard.length > 0) {
      toastIfPossible(`⚠️ Not added — ${hard[0].reason}. Fix it in the add area and it will go in.`);
    }
    return;
  }

  // Re-renders the tab, which clears and rebuilds the ADD block along with
  // everything else — so the accepted rows are now in the table above and the
  // block is empty.
  const merged = upsertLunchScheduleRows(parsed.rows);

  // Put the rejects back into the fresh block so they can be corrected in
  // place rather than silently lost. Its row numbers moved with the render,
  // so it has to be located again.
  const after = findLunchAddBlock(sheet);
  if (after && parsed.rejects.length > 0) {
    const back = parsed.rejects.map(r => {
      const padded = r.raw.slice(0, LUNCH_ADD_HEADERS.length)
        .map(v => (v instanceof Date ? v : String(v === null || v === undefined ? '' : v)));
      while (padded.length < LUNCH_ADD_HEADERS.length) padded.push('');
      return padded;
    });
    const needed = after.firstRow + back.length - 1;
    if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    sheet.getRange(after.firstRow, 1, back.length, LUNCH_ADD_HEADERS.length).setValues(back);
    invalidateSectionedRowsCache(sheet);
  }

  // A pasted month routinely contains "Not Serving" rows, and one of them can
  // land on a date people have already signed up to eat on. Same warning as
  // typing it by hand — see warnAboutNotServingSignups().
  const warned = warnAboutNotServingSignups(collectNotServingPairs(parsed.rows));

  const parts = [`✅ ${merged.added} added`];
  if (merged.updated > 0) parts.push(`${merged.updated} updated`);
  if (parsed.rejects.length > 0) parts.push(`⚠️ ${parsed.rejects.length} left in the add area (${parsed.rejects[0].reason})`);
  if (warned === 0) {
    toastIfPossible(`${parts.join(', ')}. Use "🍱 Push Menu Changes to Forms" when you want the forms to show it.`);
  }
  log(`Lunch menu add: ${merged.added} new, ${merged.updated} updated, ${parsed.rejects.length} rejected.`);
}

/** The {date, location} pairs among canonical menu rows whose Type is "Not Serving". */
function collectNotServingPairs(menuRows) {
  const map = getIndexMap(HEADERS.Lunch_Schedule);
  const pairs = [];
  (menuRows || []).forEach(row => {
    if (String(row[map['Type']] || '').trim() !== 'Not Serving') return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    pairs.push({ date, location: String(row[map['Location']] || '').trim() });
  });
  return pairs;
}

/**
 * Turns a raw grid of pasted/typed cells into canonical Lunch_Schedule rows.
 *
 * Accepts, in one pass and without being told which it is getting:
 *   • a proper multi-column paste           -> ['2026-09-14','Narberth','Hot',…]
 *   • one CSV line per cell                 -> ['2026-09-14, Narberth, Hot, …']
 *   • the entire CSV in a single cell       -> a blob with newlines in it
 *   • a header line ("Date,Location,Type…") -> recognized and skipped
 * That is the whole point: "batch and single work similarly" means there is
 * exactly one code path, and the shape of what you pasted is not your problem.
 *
 * Returns { rows: [canonical row arrays], rejects: [{raw, reason, incomplete}] }.
 * `incomplete` marks a row that is merely unfinished (still being typed)
 * rather than wrong — the caller stays quiet about those.
 */
function parseLunchMenuGrid(grid) {
  const rows = [];
  const rejects = [];
  const map = getIndexMap(HEADERS.Lunch_Schedule);

  // Flatten to a list of field-arrays first, expanding any cell that is
  // itself CSV/multi-line text.
  const records = [];
  (grid || []).forEach(cells => {
    const nonEmpty = cells.filter(c => String(c === null || c === undefined ? '' : c).trim() !== '');
    if (nonEmpty.length === 0) return;

    const first = cells[0];
    const firstText = first instanceof Date ? '' : String(first === null || first === undefined ? '' : first);
    const onlyFirstColumn = nonEmpty.length === 1 && firstText.trim() !== '';
    if (onlyFirstColumn && (firstText.indexOf('\n') !== -1 || firstText.indexOf(',') !== -1 || firstText.indexOf('\t') !== -1)) {
      parseCsvText(firstText).forEach(fields => records.push({ fields, raw: [firstText] }));
      return;
    }
    records.push({ fields: cells, raw: cells });
  });

  records.forEach(rec => {
    const f = rec.fields;
    const get = i => {
      const v = f[i];
      if (v instanceof Date) return v;
      return String(v === null || v === undefined ? '' : v).trim();
    };

    // A header line pasted along with the data — skip it silently.
    const firstText = String(get(0) || '').toLowerCase();
    if (firstText === 'date' || firstText === 'event_date') return;

    const date = coerceMenuDate(get(0));
    const location = canonicalizeLocation(get(1));
    const type = canonicalizeLunchType(get(2));
    const description = String(get(3) || '');
    const shorthand = String(get(4) || '');

    const missing = [];
    if (!date) missing.push('a date');
    if (!location) missing.push('a location');
    if (!type) missing.push('a type');
    if (missing.length > 0) {
      // "Wrong" vs "not finished yet": a row where something was TYPED into a
      // field but did not resolve is an error worth reporting; a row where the
      // field is simply still blank is someone mid-entry.
      const typedButUnresolved =
        (!date && String(get(0) || '') !== '') ||
        (!location && String(get(1) || '') !== '') ||
        (!type && String(get(2) || '') !== '');
      rejects.push({
        raw: rec.raw.map(v => (v instanceof Date ? formatDateKey(v) : v)),
        reason: typedButUnresolved
          ? `couldn't read ${missing.join(', ')} in "${[get(0), get(1), get(2)].filter(Boolean).join(', ')}"`
          : `needs ${missing.join(' and ')}`,
        incomplete: !typedButUnresolved
      });
      return;
    }

    const row = new Array(HEADERS.Lunch_Schedule.length).fill('');
    row[map['Event_Date']] = date;
    row[map['Location']] = location;
    row[map['Type']] = type;
    // "Not Serving" is a statement about the DAY, not a meal — a description
    // or shorthand on it would show up as a menu hint on the form's date
    // label for a day nobody is being fed.
    row[map['Meal_Description']] = type === 'Not Serving' ? '' : description;
    row[map['Meal_Shorthand']] = type === 'Not Serving' ? '' : shorthand;
    rows.push(row);
  });

  return { rows, rejects };
}

/**
 * Merges canonical rows into Lunch_Schedule, keyed on date + location — the
 * same identity mergeLegacyTabs() uses. A second row for a date that already
 * has one REPLACES it (re-pasting a corrected month is the common case, and
 * ending up with two contradictory menus for one day is never wanted).
 *
 * Does not render; callers do that once at the end.
 */
function upsertLunchScheduleRows(newRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_SCHEDULE);
  const headers = HEADERS.Lunch_Schedule;
  const map = getIndexMap(headers);
  const existing = readLunchScheduleRows(sheet);

  const keyOf = row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return '';
    return `${formatDateKey(d)}|${String(row[map['Location']] || '').trim()}`;
  };

  const byKey = {};
  const order = [];
  existing.forEach(row => {
    const key = keyOf(row);
    if (!key) return;
    if (byKey[key] === undefined) order.push(key);
    byKey[key] = row;
  });

  let added = 0, updated = 0;
  newRows.forEach(row => {
    const key = keyOf(row);
    if (!key) return;
    if (byKey[key] === undefined) { order.push(key); added++; } else { updated++; }
    byKey[key] = row;
  });

  const out = order.map(k => byKey[k]);
  renderLunchScheduleSheet(false, out);
  return { added, updated, total: out.length };
}

/**
 * A minimal RFC4180 CSV reader: quoted fields, "" escapes, embedded commas
 * and newlines, and tab-separated input (what a spreadsheet actually puts on
 * the clipboard) all included. Returns an array of field-arrays.
 *
 * Written out rather than split(',') because a meal description with a comma
 * in it — "Chicken, rice and beans" — is the normal case here, not an edge one.
 */
function parseCsvText(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  if (src.trim() === '') return [];

  // Tab wins if present: a paste out of Excel/Sheets is tab-separated, and its
  // fields routinely contain unquoted commas.
  const delimiter = src.indexOf('\t') !== -1 ? '\t' : ',';

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') { inQuotes = true; field = ''; continue; }
    if (ch === delimiter) { record.push(field.trim()); field = ''; continue; }
    if (ch === '\n') {
      record.push(field.trim());
      if (record.some(v => v !== '')) records.push(record);
      record = []; field = '';
      continue;
    }
    field += ch;
  }
  record.push(field.trim());
  if (record.some(v => v !== '')) records.push(record);
  return records;
}

/**
 * Parses whatever a person put in a date cell. Real Dates pass through;
 * yyyy-MM-dd and the US m/d/yyyy are read explicitly (rather than left to
 * `new Date(string)`, which reads "9/14/2026" and "2026-09-14" in two
 * different timezones and lands the second one a day early); anything else
 * falls back to coerceDate().
 */
function coerceMenuDate(value) {
  if (value instanceof Date) return coerceDate(value);
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return plausibleMenuDate(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const us = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    return plausibleMenuDate(new Date(year, Number(us[1]) - 1, Number(us[2])));
  }

  return plausibleMenuDate(coerceDate(text));
}

/** How far either side of today a pasted menu date is believable. */
const MENU_DATE_MAX_YEARS_BACK = 2;
const MENU_DATE_MAX_YEARS_AHEAD = 3;

/**
 * A menu date, or null when the year says the input wasn't a date at all.
 *
 * The fallback `new Date(text)` accepts a great deal that is not a menu:
 * "9/16" (no year) becomes September 2001, and a spreadsheet SERIAL NUMBER —
 * what a date column looks like the moment its formatting is lost, which is a
 * normal thing to have happen to a pasted month — becomes the year 45000.
 * Both landed on Lunch_Schedule as real rows, silently, dated somewhere nobody
 * will ever scroll to.
 *
 * Rejecting them instead puts the row in parseLunchMenuGrid()'s rejects list,
 * which is shown to whoever pasted it, while the paste was still on screen.
 * The window is generous on both sides: a menu is typed a month or two ahead
 * and corrected weeks late, never years either way.
 */
function plausibleMenuDate(date) {
  if (!date || isNaN(date)) return null;
  const thisYear = new Date().getFullYear();
  const year = date.getFullYear();
  if (year < thisYear - MENU_DATE_MAX_YEARS_BACK) return null;
  if (year > thisYear + MENU_DATE_MAX_YEARS_AHEAD) return null;
  return date;
}

/** Snaps free text onto a CALENDAR_MAP location name, or '' if it matches none. */
function canonicalizeLocation(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!text) return '';
  const names = Object.values(CALENDAR_MAP);
  const exact = names.filter(n => n.toLowerCase() === text)[0];
  if (exact) return exact;
  // A prefix match covers "narb" and "Narberth Center" alike, but only when
  // exactly one location can be meant — an ambiguous abbreviation is a reject,
  // not a coin toss.
  const partial = names.filter(n => n.toLowerCase().indexOf(text) === 0 || text.indexOf(n.toLowerCase()) === 0);
  return partial.length === 1 ? partial[0] : '';
}

/** Snaps free text onto a LUNCH_TYPE_OPTIONS value, or '' if it matches none. */
function canonicalizeLunchType(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!text) return '';
  if (text === 'hot') return 'Hot';
  if (text === 'cold') return 'Cold';
  if (['not serving', 'not-serving', 'none', 'no lunch', 'no', 'n/a', 'closed', 'off'].indexOf(text) !== -1) {
    return 'Not Serving';
  }
  return '';
}

/**
 * The paste-or-upload dialog: the same parser as the in-sheet ADD block, for
 * when the CSV is in a file or is too big to want to see land on the tab.
 * Open to everyone — adding a menu changes no structure and deletes nothing.
 */
function showLunchMenuImportDialog() {
  const html = HtmlService.createHtmlOutput(buildLunchMenuImportHtml())
    .setWidth(560)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Menu Items');
}

/** The dialog's markup. Inline so this project stays a single .gs file. */
function buildLunchMenuImportHtml() {
  const locations = Object.values(CALENDAR_MAP).join(' · ');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
  textarea { width: 100%; height: 210px; font-family: Consolas, Menlo, monospace; font-size: 12px;
             box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
  .row { margin: 10px 0; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 10px; min-height: 18px; font-weight: bold; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Paste CSV, or choose a .csv file</h3>
<p class="hint">
  One line per date and location:<br>
  <code>Date, Location, Type, Meal Description, Shorthand</code><br>
  Locations: ${locations}. Type: <code>Hot</code>, <code>Cold</code> or <code>Not Serving</code>.
  A header line is fine — it's ignored. A date that already has a menu is replaced.
</p>
<div class="row"><input type="file" id="file" accept=".csv,.txt,text/csv"></div>
<textarea id="csv" placeholder="2026-09-14, Narberth, Hot, Chicken Parmesan, Chx Parm
2026-09-15, Ashbridge, Cold, Turkey Wrap, Turkey
2026-09-16, Narberth, Not Serving"></textarea>
<div class="row"><button id="go" onclick="submit()">Add to Lunch_Schedule</button></div>
<div id="status"></div>
<script>
  document.getElementById('file').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { document.getElementById('csv').value = reader.result; };
    reader.readAsText(f);
  });
  function submit() {
    var text = document.getElementById('csv').value;
    if (!text.trim()) { say('Nothing to add — paste some rows first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working…', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .importLunchMenuCsv(text);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Same parser, same upsert, same rules as the in-sheet
 * ADD block — this is a second doorway onto one implementation, not a second
 * implementation. Returns a human-readable summary for the dialog to show.
 */
function importLunchMenuCsv(text) {
  const records = parseCsvText(text);
  if (records.length === 0) return '⚠️ Nothing to add — no rows found in that text.';

  const parsed = parseLunchMenuGrid(records);
  if (parsed.rows.length === 0) {
    const why = parsed.rejects.length > 0 ? ` (${parsed.rejects[0].reason})` : '';
    return `⚠️ No usable rows${why}. Expected: Date, Location, Type, Description, Shorthand.`;
  }

  const merged = upsertLunchScheduleRows(parsed.rows);
  log(`importLunchMenuCsv: ${merged.added} added, ${merged.updated} updated, ${parsed.rejects.length} skipped.`);

  const parts = [`${merged.added} added`];
  if (merged.updated > 0) parts.push(`${merged.updated} updated`);
  if (parsed.rejects.length > 0) parts.push(`${parsed.rejects.length} skipped — ${parsed.rejects[0].reason}`);

  // Reported in the dialog rather than as a toast — a modal is in the way of
  // the toast, and this is the one line in the result somebody must not miss.
  const clash = checkNotServingSignups(collectNotServingPairs(parsed.rows));
  const warning = clash.total > 0
    ? ` ⚠️ ${clash.total} person(s) had signed up for lunch on a date you marked "Not Serving" ` +
      `(${formatDateLabel(clash.affected[0].date)} at ${clash.affected[0].location}: ` +
      `${describePeopleList(clash.affected[0].people)}) — they need telling.`
    : '';

  return `✅ ${parts.join(', ')}. Use "Push Menu Changes to Forms" when you want the forms to show it.${warning}`;
}

/**
 * Rewrites the date labels (and the lunch question) on every live form whose
 * sessions fall on an UPCOMING Lunch_Schedule date — the deliberate,
 * once-you-mean-it counterpart to the modal that used to fire mid-typing.
 *
 * Past dates are skipped: their forms are closed business, and rewriting them
 * is pure quota spend.
 */
function pushLunchMenuToForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  if (!sheet) { toastIfPossible('No Lunch_Schedule tab yet — nothing to push.'); return 0; }

  const scope = buildLunchPushScope(sheet);
  if (scope.pairs.length === 0) {
    toastIfPossible('No upcoming menu dates — nothing to push.');
    return 0;
  }

  if (!confirmConsequentialAction('Push the menu to the registration forms?',
    `${scope.pairs.length} upcoming date(s) across ${scope.monthCount} location/month(s) will be pushed.\n\n` +
    'The lunch sign-up form for each of those months is built or brought up to date FIRST, so a date you ' +
    'have just added gains a row to hang off — and then every registration form covering those months has ' +
    'its date labels, its lunch question and its description rewritten to match what the schedule now says.\n\n' +
    'Registrants and their existing answers are never changed.', false)) {
    return 0;
  }

  // UNDER THE SYNC LOCK. This builds forms and rewrites the session table
  // (syncLunchOnlySessions()), which is exactly the read-change-write shape
  // that loses rows when the hourly sync is half way through the same tabs.
  // Pressing a menu item happens to be the most likely moment for that: it is
  // pressed the minute a menu has been typed in, on the hour, by somebody who
  // has no way of knowing a sync is running.
  const stats = withScriptLock(SYNC_LOCK_WAIT_MS, () => pushLunchMenuNow(scope), null);
  if (!stats) {
    toastIfPossible('A sync is already running — nothing was pushed. Try again in a moment; ' +
      'the menu on the tab is safe either way.');
    return 0;
  }
  toastIfPossible(describeLunchPushOutcome(scope, stats));
  return stats.formsRefreshed;
}

/**
 * WHAT A MENU PUSH IS ACTUALLY ABOUT, which is not the set of dates somebody
 * just typed.
 *
 * The old scope was exactly those dates: pairs of {date, location} read off
 * Lunch_Schedule, and a form was touched only if one of its session rows fell
 * on one of them. Three things fall through a scope that narrow, and all three
 * were reported as a successful push:
 *
 *   A DATE THAT IS NEW has no session row yet, so it matches no form and
 *     reaches nothing — which is precisely the case somebody presses this for.
 *     The lunch-only months are built by syncLunchOnlySessions(), and the push
 *     never called it, so a date added to next month's menu did not appear on
 *     next month's form until the hourly sync happened to get to it.
 *   A DATE THAT WAS DELETED is not on the tab at all any more, so it is in no
 *     pair, so the form still offering it is never reopened. The stale row
 *     outlives every push made after it.
 *   A DATE FLIPPED TO "Not Serving" keeps its row here, but the forms whose
 *     labels have to lose the meal hint are the OTHER dates' forms too — a
 *     form's labels are rewritten as a set, not per row.
 *
 * So the scope is the LOCATION-MONTH, not the date: every month that has any
 * upcoming menu row at a location, plus every location-month a form's sessions
 * fall in. Every form covering an affected month is reopened once, and its
 * whole label set, its lunch question and its description are re-derived from
 * the sheet. Unchanged forms cost a fingerprint comparison and no Forms write
 * (applyFormDateLabels()), so widening the net is close to free on the runs
 * where nothing moved.
 */
function buildLunchPushScope(sheet) {
  const map = getIndexMap(HEADERS.Lunch_Schedule);
  const todayKey = formatDateKey(new Date());

  const pairs = [];
  const seenPair = {};
  const months = {};
  readLunchScheduleRows(sheet).forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    const dateKey = formatDateKey(d);
    if (dateKey < todayKey) return;
    const location = String(row[map['Location']] || '').trim();
    const key = `${dateKey}|${location}`;
    if (!seenPair[key]) {
      seenPair[key] = true;
      pairs.push({ date: d, location });
    }
    // "Not Serving" rows are in scope too, and deliberately: taking a meal OFF
    // a date is a menu change like any other, and the form saying so is the
    // whole point of the row.
    months[lunchMonthScopeKey(location, dateKey)] = true;
  });

  return { pairs, months, monthCount: Object.keys(months).length };
}

/** "Narberth|2026-09" — the unit a lunch push actually works in. A blank location means "wherever". */
function lunchMonthScopeKey(location, dateKey) {
  return `${String(location || '').trim()}|${String(dateKey).slice(0, 7)}`;
}

/**
 * The push itself, in the order the stages depend on one another.
 *
 * Every stage is guarded on its own. A push that cannot reach the Forms API
 * must still leave the sheet correct, and a menu row that cannot be stamped
 * must not stop the forms being rewritten — the failure modes are independent
 * and reporting them as one "it worked" was how this came to be trusted while
 * doing half its job.
 */
function pushLunchMenuNow(scope) {
  const stats = {
    scheduleRestamped: false,
    signUpFormsBuilt: 0,
    signUpFormsRefreshed: 0,
    signUpFormsFailed: 0,
    newLunchDates: 0,
    formsSeen: 0,
    formsRefreshed: 0,
    formsFailed: 0,
    dashboardUpdated: false,
    problems: []
  };
  const trouble = (what, err) => {
    log(`⚠️ Menu push: ${what} (${err}).`);
    stats.problems.push(what);
    noteForAdmin('Menu push', `${what} — ${err}`);
  };

  // 1. THE TAB FIRST. Meal_IDs are stamped by the render, and a date typed in
  //    without one is a date the meal index cannot join a registration back to
  //    — so pushing before stamping would push half-identified meals. The
  //    render also drops the meal-info cache the labels below are built from,
  //    which is what makes an edited dish reach the forms at all.
  try {
    renderLunchScheduleSheet(true);
    stats.scheduleRestamped = true;
  } catch (err) {
    trouble('the Lunch_Schedule tab could not be re-stamped, so the labels below were built from ' +
      'whatever the tab said before', err);
    invalidateMealInfoIndex(); // at minimum, do not push a cached copy of the old menu
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    trouble('there is no session table yet, so no form could be found to push to',
      'run "Sync Cal" once first');
    return stats;
  }

  // 2. THE SIGN-UP MONTHS. This is the stage the old push did not have, and
  //    the one the reported bug lived in: a date that is new to the menu has
  //    no session row anywhere, and a form's dates come from its session rows.
  //    syncLunchOnlySessions() is what mints the row, so a new date becomes a
  //    row here and a label in stage 3 — in the same press of the button.
  try {
    syncLunchOnlySessions(registrySheet);
    const run = getLastLunchSignUpRunStats();
    stats.signUpFormsBuilt = run.formsBuilt;
    stats.signUpFormsRefreshed = run.formsRefreshed;
    stats.signUpFormsFailed = run.formsFailed;
    if (run.formsFailed > 0) {
      stats.problems.push(`${run.formsFailed} lunch sign-up form(s) could not be built or reopened`);
    }
  } catch (err) {
    trouble('the lunch sign-up forms could not be brought up to date, so a date added to the menu may ' +
      'not be on its month\'s form yet', err);
  }
  flushPersistentRegistries();
  // The rows syncLunchOnlySessions() just wrote are read back off the tab in
  // the next stage, so they have to actually BE on the tab first.
  SpreadsheetApp.flush();

  // 3. EVERY FORM COVERING AN AFFECTED MONTH — see buildLunchPushScope().
  try {
    const refreshed = refreshFormsForLunchDates(scope.pairs, { months: scope.months });
    stats.formsSeen = refreshed.formsSeen;
    stats.formsRefreshed = refreshed.formsRefreshed;
    stats.formsFailed = refreshed.formsFailed;
    stats.newLunchDates = refreshed.lunchDatesOffered;
    if (refreshed.formsFailed > 0) {
      stats.problems.push(`${refreshed.formsFailed} registration form(s) could not be rewritten`);
    }
  } catch (err) {
    trouble('the registration forms could not be rewritten', err);
  }

  // 4. THE DASHBOARD LAST, on the settled picture. A menu push changes what is
  //    catered on which date, which is exactly what the rollup counts — and
  //    leaving it stale is how somebody orders yesterday's numbers.
  try {
    updateMasterLunchDashboard(null);
    stats.dashboardUpdated = true;
  } catch (err) {
    trouble('the lunch dashboard could not be re-rendered', err);
  }

  flushAdminDigest('Menu push');
  return stats;
}

/**
 * The sentence the toast says — which is the whole of what anybody learns
 * about a push, so it says what FAILED as readily as what worked.
 *
 * The old one said "Menu pushed to N form(s) across M date(s) ✅" and counted
 * every form it had TRIED, whether the write landed or threw. A push that
 * reached nothing looked identical to one that reached everything.
 */
function describeLunchPushOutcome(scope, stats) {
  const parts = [];
  if (stats.signUpFormsBuilt > 0) parts.push(`${stats.signUpFormsBuilt} lunch sign-up form(s) built`);
  if (stats.signUpFormsRefreshed > 0) parts.push(`${stats.signUpFormsRefreshed} refreshed`);
  parts.push(`${stats.formsRefreshed} of ${stats.formsSeen} registration form(s) rewritten`);
  const head = stats.problems.length === 0
    ? `Menu pushed ✅ — ${parts.join(', ')} across ${scope.monthCount} location/month(s).`
    : `Menu pushed with problems ⚠️ — ${parts.join(', ')}. ${stats.problems.join('; ')}. See the log.`;
  return head;
}

/**
 * Menu action: build or bring up to date the lunch-only sign-up form for every
 * location serving food in the window, and pin the links to the top of
 * Master_Lunch_Dashboard.
 *
 * The hourly Sync Cal does this anyway. This exists for the moment right after
 * a month of menu rows has been pasted in, when somebody wants the link NOW to
 * put in a newsletter rather than in an hour.
 */
function refreshLunchSignUpForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('⚠️ No session table yet — run "Sync Cal" once first.');
    return 0;
  }

  toastIfPossible('Building the lunch sign-up forms…');
  let links;
  try {
    links = syncLunchOnlySessions(registrySheet);
  } catch (err) {
    log(`⚠️ refreshLunchSignUpForms failed (${err}).`);
    toastIfPossible(`⚠️ Could not build the lunch sign-up forms (${err}).`);
    return 0;
  }
  flushPersistentRegistries();

  const months = buildLunchSignUpRows(links);

  // THE DASHBOARD IS REWRITTEN WHATEVER THE ANSWER TURNED OUT TO BE, which is
  // the whole reason somebody ran this by hand — and it used to be skipped on
  // exactly the runs that most needed it. The early return sat above this
  // call, so a workbook whose block was stale, or blank, or still carrying a
  // pin for a month that has since ended, was left showing precisely that
  // while the toast said there was nothing to build. A render is what turns
  // "nothing to build" into a block that SAYS so.
  updateMasterLunchDashboard(null);
  flushAdminDigest('Lunch sign-up forms');

  if (months.length === 0) {
    toastIfPossible(`No lunch sign-up links to pin — ${describeWhyNoLunchSignUpForms()}`);
    return 0;
  }

  toastIfPossible(`Lunch sign-up forms ready ✅ — ${months.length} location/month form(s). ` +
    `The links are pinned at the top of ${SHEET_NAMES.LUNCH_DASHBOARD}.` +
    (getLastLunchSignUpRunStats().formsFailed > 0
      ? ` ⚠️ ${getLastLunchSignUpRunStats().formsFailed} other form(s) could not be built — see the log.`
      : ''));
  return months.length;
}

/**
 * Why the pinned block has nothing in it, in the words of whichever of the
 * four quite different situations actually happened.
 *
 * "No catered dates on Lunch_Schedule" was the old answer to all four, and it
 * is a flat contradiction of what somebody is looking at in three of them —
 * the rows ARE there; they are past, or further out than the forms are built,
 * or their forms failed to open. Being told to "add a Hot or Cold row" in
 * front of a tab full of Hot and Cold rows is how a working feature reads as
 * broken.
 */
function describeWhyNoLunchSignUpForms() {
  const s = getLastLunchSignUpRunStats();
  if (s.formsFailed > 0) {
    return `${s.formsFailed} form(s) could not be built or reopened this run. The reason is in the log and ` +
      'in the admin email; the dates and any responses already collected are untouched.';
  }
  if (s.upcomingDates === 0 && s.beyondHorizon > 0) {
    return `every catered date on ${SHEET_NAMES.LUNCH_SCHEDULE} is more than ${LUNCH_SIGNUP_LOOKAHEAD_MONTHS} ` +
      'months out. The menu is fine as typed — those months build their own form automatically as they ' +
      'come closer.';
  }
  if (s.upcomingDates === 0 && s.pastDates > 0) {
    return `every catered date on ${SHEET_NAMES.LUNCH_SCHEDULE} has already passed. Add next month's ` +
      'Hot/Cold rows and run this again.';
  }
  if (s.cateredRows === 0) {
    return `there are no Hot or Cold rows on ${SHEET_NAMES.LUNCH_SCHEDULE} at a location that caters. ` +
      'Add one and run this again.';
  }
  return `nothing on ${SHEET_NAMES.LUNCH_SCHEDULE} produced a form this run — see the log.`;
}

function refreshFormsForLunchDates(pairs, options) {
  options = options || {};
  const blank = { formsSeen: 0, formsRefreshed: 0, formsFailed: 0, lunchDatesOffered: 0 };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return blank;

  const headers = HEADERS.All_Program_Sessions;
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return blank;
  const map = getIndexMap(headers);

  const wanted = {};
  (pairs || []).forEach(p => {
    if (!p.date) return;
    wanted[`${formatDateKey(p.date)}|${p.location || ''}`] = true;
  });
  // The location-months this push covers, when the caller has worked them out
  // (buildLunchPushScope()). Without them this behaves exactly as it always
  // did — which is what refreshFormsForChangedLunchDate()'s single date wants.
  const months = options.months || null;

  const affectedFormIds = {};
  rows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    const key = formatDateKey(d);
    const location = String(row[map['Location']] || '').trim();
    // A pair with no location means "this date, wherever it is".
    const byDate = wanted[`${key}|${location}`] || wanted[`${key}|`];
    // A SESSION IN AN AFFECTED MONTH counts even when its own date carries no
    // menu row: that is the form still offering a date somebody deleted, and
    // the form whose OTHER labels have to lose a meal hint. See
    // buildLunchPushScope() for why the month is the honest unit here.
    const byMonth = months && (months[lunchMonthScopeKey(location, key)] ||
      months[lunchMonthScopeKey('', key)]);
    if (!byDate && !byMonth) return;
    const formId = row[map['Form_ID']];
    if (formId) affectedFormIds[formId] = true;
  });

  const formIds = Object.keys(affectedFormIds);
  const stats = { formsSeen: formIds.length, formsRefreshed: 0, formsFailed: 0, lunchDatesOffered: 0 };
  formIds.forEach(formId => {
    // COUNTED BY WHAT CAME BACK, not by what was attempted. This used to
    // return formIds.length whatever happened inside, so a push where every
    // single form was unopenable reported the same number as one where every
    // form was rewritten — and the toast said ✅ either way.
    const outcome = refreshOneFormDateLabels(formId, rows, map, 'menu push');
    if (outcome && outcome.failed) stats.formsFailed++;
    else if (outcome && outcome.written) stats.formsRefreshed++;
    if (outcome && outcome.lunchDates) stats.lunchDatesOffered += outcome.lunchDates;
  });
  flushPersistentRegistries();
  log(`refreshFormsForLunchDates: ${stats.formsRefreshed} of ${stats.formsSeen} form(s) rewritten, ` +
    `${stats.formsFailed} failed, for ${(pairs || []).length} date(s).`);
  return stats;
}

/**
 * Rebuilds one form's date-dependent items from the session rows already in
 * memory — every date that form covers, not just the changed one, so a single
 * menu edit self-heals any stale label on it.
 *
 * Returns { failed, written, lunchDates } rather than a bare boolean: the
 * caller counts what actually landed, and "could not open the form" and
 * "opened it and found nothing to change" are the two answers it most needs
 * told apart. See refreshFormsForLunchDates().
 */
function refreshOneFormDateLabels(formId, sessionRows, map, context) {
  const nothing = { failed: false, written: false, lunchDates: 0 };
  const formRows = sessionRows.filter(row => row[map['Form_ID']] === formId);
  if (formRows.length === 0) return nothing;

  const formContext = buildFormSessionContext(formId, formRows, map, getSharedFormIdSet());
  if (formContext.sessions.length === 0) return nothing;

  const { allDateLabels, lunchDateLabels, allDateLines } =
    buildDateLabelSets(formContext.sessions, formContext);

  // A menu edit is exactly how a form gains or loses its last lunch date, so
  // the question set is re-checked here, not just the row labels.
  let form = null;
  let questionsChanged = 0;
  try {
    form = openFormCached(formId);
    questionsChanged = syncLunchQuestionsOnForm(form, formContext.locations, lunchDateLabels.length > 0, formContext);
  } catch (err) {
    log(`⚠️ Could not open form ${formId} to re-check its lunch questions after a ${context} (${err}).`);
    noteForAdmin('Forms that could not be updated',
      `${describeFormLink(formId)} (${describeLocations(formContext.locations)}) could not be opened after a ` +
      `${context}: ${err}. Its dates and its lunch question still read as they did before.`);
    return { failed: true, written: false, lunchDates: 0 };
  }

  // THE DESCRIPTION LISTS THE DATES, and it was the one date-dependent thing
  // on the form that a refresh did not rewrite. applyFormDateLabels() below
  // writes the grid rows and the mode page's note; the description sat above
  // both of them still reading out last month's dates — on a lunch-only form,
  // where the description IS the menu ("Lunch is served on: …"), that is the
  // part of the page somebody actually reads. Guarded on its own: a
  // description that will not write must not cost the form its date labels,
  // which are what a registration is matched back by.
  let descriptionWritten = false;
  try {
    descriptionWritten = applyFormDescription(form, formContext, allDateLabels, lunchDateLabels, allDateLines);
  } catch (err) {
    log(`⚠️ Could not rewrite the description on form ${formId} after a ${context} (${err}) — ` +
      `its dates and questions were still updated.`);
  }

  const labelsWritten = applyFormDateLabels(formId, allDateLabels, lunchDateLabels,
    { form, force: questionsChanged > 0, context,
      shape: formLunchShapeKey(formContext, lunchDateLabels.length > 0) });

  return {
    failed: false,
    written: labelsWritten || descriptionWritten || questionsChanged > 0,
    lunchDates: lunchDateLabels.length
  };
}

/**
 * Writes the form's description from the session picture, and only when it
 * actually differs from what is on the form.
 *
 * ONE PLACE, because there are five callers of buildFormDescription() and each
 * of them assembles the same options object out of a slightly different
 * carrier (a calendar group, a session context, a rebuild spec). A refresh
 * path that has a context in hand should not have to re-derive that mapping to
 * keep a form's dates honest.
 *
 * Returns true when the form was written to.
 */
function applyFormDescription(form, context, allDateLabels, lunchDateLabels, dateLines) {
  const description = buildFormDescription(context.locations, allDateLabels, context.isFixed,
    (lunchDateLabels || []).length > 0, {
      isClub: context.isClub,
      programTitle: context.programTitle,
      isLunchOnly: context.isLunchOnly,
      isAssistance: context.isAssistance,
      dateLines
    });
  const wanted = applyDescriptionInjectionsToText(description, context);
  // RECORDED EVEN WHEN NOTHING IS WRITTEN. This is the same block
  // syncDescriptionInjectionsOnForm() strips before appending its own, and a
  // rebuild that wrote one without recording it would leave that function
  // stripping nothing and stacking a second copy underneath.
  rememberDescriptionInjection(form.getId(), wanted.slice(description.length));
  if (wanted === (form.getDescription() || '')) return false;
  form.setDescription(wanted);
  return true;
}

/** Records the description block this script last appended to one form. See syncDescriptionInjectionsOnForm(). */
function rememberDescriptionInjection(formId, injection) {
  const store = getAppliedCustomQuestions();
  const entry = store[formId] || {};
  if (String(entry.description || '') === String(injection || '')) return;
  store[formId] = Object.assign({}, entry, { description: String(injection || '') });
  saveAppliedCustomQuestions(store);
}

/**
 * Single-date convenience wrapper over refreshFormsForLunchDates(), kept for
 * running by hand from the Apps Script editor ("this one date's labels look
 * wrong"). Pass no location to mean "this date, wherever it is".
 */
function refreshFormsForChangedLunchDate(changedDate, location) {
  const date = coerceDate(changedDate);
  if (!date) return { formsSeen: 0, formsRefreshed: 0, formsFailed: 0, lunchDatesOffered: 0 };
  // The whole location-month, not the bare date — the same widening the menu
  // push does, and for the same reason: somebody running this by hand is
  // running it because a label looks wrong, and the label that is wrong is as
  // likely to be the one for a date that has since been DELETED as the one
  // they typed. See buildLunchPushScope().
  const months = {};
  months[lunchMonthScopeKey(location || '', formatDateKey(date))] = true;
  return refreshFormsForLunchDates([{ date, location: location || '' }], { months });
}


