// ============================================================================
// 9. PRINTED SIGN-IN SHEET  (a landscape PDF to mark up by hand)
// ============================================================================
//
// Everything else in this workbook assumes a screen. The sign-in desk does not
// have one — or has one that is already showing something else, with a queue
// of people in front of it. What that desk needs is paper: one page per
// session, the expected people already on it, and empty boxes to tick and to
// write meal counts into, which somebody types back in afterwards.
//
// So this builds exactly that. It takes the registrants for one date and
// location, plus what the kitchen is serving that day, and produces a
// LANDSCAPE PDF whose columns are the ones the desk actually uses:
//
//   "In CoPilot"  CAME  Last  First  Phone #  Program  Family / Alt Name
//   Extra Notes  "MEALS ORDERED"  "DINED IN #"  "TAKE OUT #"  "# PUT IN FRIDGE"
//
// The last four line up one-for-one with the per-registrant meal counts on the
// Registrants tab (see REGISTRANT_MEAL_COUNT_COLUMNS), so transcribing a
// finished sheet back into the workbook is column-for-column with no
// re-interpretation — which is the whole reason the meal counts were split per
// person in the first place.
//
// IT IS A SHEET FOR A DAY AND A PLACE, NOT FOR A PROGRAM. The desk is one desk:
// whoever is on it that morning signs in everybody who walks up, whichever
// program they came for, and hands out lunch to the subset who ordered it. A
// per-program sheet would mean the same person holding three sheets and
// guessing which one a given arrival is on — so the picker asks for a LOCATION
// and a DATE, and the roster is every registrant at that place on that day
// across every program, with a Program column saying which is which.
//
// EVERYONE APPEARS, INCLUDING THE PEOPLE NOT EATING, and this is the part that
// is easy to get wrong in the other direction. Printing only the lunch list
// would give the kitchen a clean count and leave the sign-in desk unable to
// tick off half the people in front of it. Printing everyone with the meal
// columns left blank is worse still: a blank box is indistinguishable from a
// box nobody has filled in yet, so at the end of service there is no way to
// tell "ordered nothing" from "we forgot to ask". So a registrant with no
// lunch is printed with a literal 0 in each of the four meal columns — already
// answered, nothing to collect, and it transcribes back as the zero it is.
//
// ONE PAGE unless the roster does not fit, in which case it runs onto as many
// as it needs, with the header row repeated. Landscape is not a preference:
// twelve columns, several of them handwritten-into, do not fit across a
// portrait page at a legible size.
// ============================================================================

/** The printed sheet's columns, left to right, exactly as they appear on paper. */
const SIGN_IN_SHEET_COLUMNS = [
  'In CoPilot', 'CAME', 'Last', 'First', 'Phone #', 'Program', 'Family / Alt Name', 'Extra Notes',
  'MEALS ORDERED', 'DINED IN #', 'TAKE OUT #', '# PUT IN FRIDGE'
];

/**
 * Relative column widths. The three hand-tick columns are narrow, the name,
 * program and notes columns wide — a Doc table divides the page by these, so
 * they are proportions rather than measurements.
 */
const SIGN_IN_SHEET_COLUMN_WEIGHTS = [6, 6, 11, 11, 11, 12, 12, 14, 8, 7, 7, 8];

/** Longest program name printed before it is clipped — the column is ~78pt wide. */
const SIGN_IN_SHEET_MAX_PROGRAM_CHARS = 22;

/** Blank rows added under the roster, for walk-ins nobody knew about. */
const SIGN_IN_SHEET_BLANK_ROWS = 8;

/** US Letter, landscape, in points — the page this is designed against. */
const SIGN_IN_PAGE = { width: 792, height: 612, margin: 28 };

/** Where finished PDFs are filed. Sits beside the forms folder rather than loose in My Drive. */
const SIGN_IN_SHEET_FOLDER_NAME = 'Printed Sign-In Sheets';

/** MENU ENTRY: pick a location + date, get a PDF. */
function showSignInSheetDialog() {
  const options = listSignInSheetOptions();
  if (options.length === 0) {
    toastIfPossible('Nothing to print yet — no sessions or lunch dates in the next few weeks. Run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildSignInSheetHtml(options))
    .setWidth(520)
    .setHeight(440); // three dropdowns now, not two
  SpreadsheetApp.getUi().showModalDialog(html, 'Print a Sign-In Sheet');
}

/**
 * Every location+date worth offering: every session on the dashboard and every
 * catered day on the menu, within a window either side of today.
 *
 * Both sources, because the two answer different questions — the dashboard
 * knows where people are expected, the menu knows where food is being served,
 * and a sign-in sheet is wanted for either. Yesterday and the day before are
 * included on purpose: the commonest reason to print one late is that the
 * original went missing mid-service.
 *
 * Returned as one flat list of entries rather than a location -> dates map:
 * the dialog needs the locations for one dropdown and the dates for the other,
 * and deriving both from a flat list in the browser keeps the shape this
 * function has to promise down to a single thing.
 */
const SIGN_IN_SHEET_WINDOW_BACK_DAYS = 7;
const SIGN_IN_SHEET_WINDOW_FORWARD_DAYS = 45;

/** Bound on how many location+date pairs the dialog carries. The window already limits this; the cap is a backstop. */
const SIGN_IN_SHEET_MAX_OPTIONS = 400;

function listSignInSheetOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - SIGN_IN_SHEET_WINDOW_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + SIGN_IN_SHEET_WINDOW_FORWARD_DAYS * 86400000));

  const byKey = {};
  const note = (date, location, programTitle, catered) => {
    const d = coerceDate(date);
    const loc = String(location || '').trim();
    if (!d || !loc) return;
    const dateKey = formatDateKey(d);
    if (dateKey < from || dateKey > to) return;
    const key = `${dateKey}|${loc}`;
    if (!byKey[key]) {
      byKey[key] = { dateKey, location: loc, programs: [], catered: false, distance: Math.abs(d - today) };
    }
    if (catered) byKey[key].catered = true;
    const title = String(programTitle || '').trim();
    if (title && byKey[key].programs.indexOf(title) === -1) byKey[key].programs.push(title);
  };

  try {
    const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (dash) {
      const headers = HEADERS.Master_Program_Dashboard;
      const map = getIndexMap(headers);
      readAllSectionedRows(dash, headers, 'Event_ID').forEach(row => {
        note(row[map['Event_Date']], row[map['Location']], row[map['Clean_Title']], false);
      });
    }
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read the program dashboard (${err}).`);
  }

  try {
    const menu = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
    if (menu) {
      const map = getIndexMap(HEADERS.Lunch_Schedule);
      readLunchScheduleRows(menu).forEach(row => {
        const type = String(row[map['Type']] || '').trim();
        if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return;
        note(row[map['Event_Date']], row[map['Location']], '', true);
      });
    }
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read ${SHEET_NAMES.LUNCH_SCHEDULE} (${err}).`);
  }

  return Object.keys(byKey)
    .map(k => byKey[k])
    // Nearest-first for the CAP only, so that trimming an overlong list drops
    // the far-future dates rather than an arbitrary slice. The dialog re-sorts
    // each location's dates chronologically, which is the order a person
    // scanning a date dropdown expects.
    .sort((a, b) => (a.distance - b.distance) || a.location.localeCompare(b.location))
    .slice(0, SIGN_IN_SHEET_MAX_OPTIONS)
    .map(entry => ({
      value: `${entry.dateKey}|${entry.location}`,
      dateKey: entry.dateKey,
      location: entry.location,
      distance: entry.distance,
      label: formatDateLabel(parseDateKey(entry.dateKey)) +
        (entry.catered ? '  •  lunch served' : '') +
        (entry.programs.length > 0
          ? `  •  ${entry.programs.slice(0, 3).join(', ')}${entry.programs.length > 3 ? `, +${entry.programs.length - 3} more` : ''}`
          : '  •  no program scheduled')
    }));
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * TWO dropdowns — location, then date — rather than the single combined
 * "date — location (programs)" list this used to show. That one list read as a
 * program picker, because the program names were the most distinctive thing in
 * each row, and it made the commonest task (I am on the desk at one site, show
 * me today) a hunt through every site's dates interleaved. Picking the place
 * first and then the day matches how somebody actually arrives at wanting this.
 *
 * The date list is filtered in the BROWSER from a JSON copy of the options,
 * so changing location is instant — a google.script.run round trip per change
 * would put a visible stall on a dropdown people flick between.
 */
function buildSignInSheetHtml(options) {
  const locations = [];
  options.forEach(o => { if (locations.indexOf(o.location) === -1) locations.push(o.location); });
  locations.sort();

  // Whichever location owns the nearest date opens selected — on the day
  // itself that is almost always the one wanted.
  const nearest = options.slice().sort((a, b) => a.distance - b.distance)[0];
  const defaultLocation = nearest ? nearest.location : (locations[0] || '');

  const locationTags = locations
    .map(loc => `<option value="${escapeHtmlForDialog(loc)}"${loc === defaultLocation ? ' selected' : ''}>` +
      `${escapeHtmlForDialog(loc)}</option>`)
    .join('\n');

  // `<` is escaped so a location or program name containing one can never
  // close the script element early.
  const payload = JSON.stringify(options).replace(/</g, '\\u003c');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
  select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; }
  label { display: block; margin: 12px 0 4px 0; font-weight: bold; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  a { color: #1155CC; }
</style>
<h3>Print a sign-in sheet</h3>
<p class="hint">
  One landscape page for a place and a day — everyone registered for any program there that day,
  with empty boxes for CAME and the meal counts. Anyone who did not order lunch is printed with 0s
  in the meal columns. Extra blank rows are added for walk-ins.
</p>
<label for="location">Location</label>
<select id="location" onchange="fillDates()">${locationTags}</select>
<label for="session">Date</label>
<select id="session"></select>
<label for="include">Who to list</label>
<select id="include">
  <option value="active">Active registrations only (recommended)</option>
  <option value="all">Everyone, including cancelled and waitlisted</option>
</select>
<button id="go" onclick="submit()">Create PDF</button>
<div id="status"></div>
<script>
  var OPTIONS = ${payload};

  function fillDates() {
    var loc = document.getElementById('location').value;
    var sel = document.getElementById('session');
    sel.innerHTML = '';
    var mine = OPTIONS.filter(function (o) { return o.location === loc; });
    mine.sort(function (a, b) { return a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0); });
    var best = null;
    mine.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
      if (best === null || o.distance < best.distance) best = o;
    });
    if (best) sel.value = best.value; // land on the nearest day, not the earliest
    document.getElementById('go').disabled = mine.length === 0;
    if (mine.length === 0) say('Nothing scheduled at this location in the next few weeks.', 'err');
    else say('', '');
  }

  function submit() {
    var session = document.getElementById('session').value;
    var include = document.getElementById('include').value;
    if (!session) { say('Pick a date first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Building the PDF…', '');
    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('go').disabled = false;
        if (!res || !res.url) { say(res && res.message ? res.message : 'Nothing to print.', 'err'); return; }
        var el = document.getElementById('status');
        el.className = 'ok';
        el.innerHTML = res.message + '<br><a href="' + res.url + '" target="_blank">Open the PDF</a>';
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .createSignInSheetPdf(session, include);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  fillDates();
</script>`;
}

/** Minimal escaping for values interpolated into the dialog's markup. */
function escapeHtmlForDialog(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Called from the dialog. Builds the PDF and returns { url, message }.
 *
 * `sessionValue` is "yyyy-MM-dd|Location"; `include` is 'active' or 'all'.
 */
function createSignInSheetPdf(sessionValue, include) {
  const parts = String(sessionValue || '').split('|');
  const dateKey = String(parts[0] || '').trim();
  const location = String(parts[1] || '').trim();
  if (!dateKey || !location) return { url: '', message: '⚠️ Pick a date and location first.' };

  const data = collectSignInSheetData(dateKey, location, include === 'all');
  if (data.rows.length === 0 && !data.meal) {
    return { url: '', message: `⚠️ Nothing registered for ${formatDateLabel(parseDateKey(dateKey))} at ${location}, ` +
      `and no lunch on the menu — there is nothing to put on a sheet.` };
  }

  const file = renderSignInSheetPdf(data);
  // REMEMBERED, not just returned. The dialog hands back a link that is gone
  // the moment it closes; the registry is what puts that same file on the
  // session's row on every tab that has one — see 67_generated_file_links.gs.
  recordSignInSheetPdf(dateKey, location, file);
  flushPersistentRegistries();
  const message = `✅ ${data.rows.length} name(s) on the sheet ` +
    `(${data.lunchCount} meal(s) ordered, ${data.noLunchCount} here without lunch)` +
    (data.meal ? `, lunch: ${data.meal.shorthand || data.meal.description || data.meal.type}` : '') + '.';
  log(`createSignInSheetPdf: built "${file.getName()}" with ${data.rows.length} row(s) — ` +
    `${data.lunchCount} meal(s) ordered, ${data.noLunchCount} without.`);
  return { url: file.getUrl(), message };
}

/**
 * Gathers everything one printed sheet needs: the day's meal, the people, and
 * the counts the kitchen is working to.
 *
 * EVERY program at this location on this date, in one roster — see the section
 * note. Which program each person came for is kept per row and printed in its
 * own column, so a mixed sheet is still readable at the desk.
 *
 * Sorted by LAST NAME, because that is how a person hunts for their own name
 * on a paper list at a desk — not by registration order, which is meaningless
 * to them, and not by first name, which is what the workbook happens to store.
 *
 * NOT sorted lunch-first, which is the obvious alternative and the wrong one.
 * Grouping the eaters together would suit the kitchen, but the person holding
 * this sheet is looking up arrivals by name, one at a time, all morning; a
 * roster split into two alphabetical halves means every lookup is two lookups.
 * The meal columns carry the lunch/no-lunch distinction instead, which is
 * where somebody counting meals is looking anyway.
 */
function collectSignInSheetData(dateKey, location, includeEveryone) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const date = parseDateKey(dateKey);
  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const registrantRows = sheet ? readAllSectionedRows(sheet, headers, 'Event_ID') : [];

  const programs = [];
  const rows = [];
  registrantRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) !== dateKey) return;
    if (String(row[map['Location']] || '').trim() !== location) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (!includeEveryone && status !== 'Active') return;

    const program = String(row[map['Event']] || '').trim();
    if (program && programs.indexOf(program) === -1) programs.push(program);

    const name = String(row[map['Name']] || '').trim();
    const split = splitNameForPrinting(name);
    rows.push({
      last: split.last,
      first: split.first,
      phone: String(row[map['Phone']] || '').trim(),
      program: truncateForPrinting(program, SIGN_IN_SHEET_MAX_PROGRAM_CHARS),
      // "Family / Alt Name" is the desk's column for who this person is WITH.
      // A guest is named against whoever brought them; a registrant who
      // brought people carries the size of their party. Either way the person
      // holding the pen can see that two rows belong together.
      family: describePartyForPrinting(row, map),
      notes: buildSignInNotes(row, map, status),
      lunch: String(row[map['Lunch_Status']] || '').trim() === 'Needed',
      // What is actually printed in MEALS ORDERED. A standing order of four is
      // the one fact on this sheet the desk cannot work out for itself, and a
      // pre-printed 1 was the workbook asserting something untrue about Joan.
      meals: readRegistrantMealsOrdered(row, map)
    });
  });

  rows.sort((a, b) =>
    a.last.localeCompare(b.last) || a.first.localeCompare(b.first));

  const meal = getMealInfoForDate(date, location);
  // MEALS, matching Master_Lunch_Dashboard's Registered_Count — the kitchen
  // figure printed at the head of this sheet has to be the same number the
  // kitchen was given, or the desk has two counts and no way to choose.
  const lunchCount = rows.reduce((n, r) => n + (r.lunch ? r.meals : 0), 0);
  return {
    date,
    dateKey,
    location,
    programs,
    rows,
    meal: meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1 ? meal : null,
    lunchCount,
    // PEOPLE, not meals — this is the count the "rows pre-filled with 0" note
    // explains, and it counts rows on the page. Derived from the rows rather
    // than by subtracting lunchCount, which stopped being a headcount the
    // moment one person could order four (see Meals_Ordered).
    noLunchCount: rows.filter(r => !r.lunch).length,
    ordering: lookupOrderingNumbersForPrinting(dateKey, location)
  };
}

/** Clips a value to fit its printed column, with an ellipsis so the clipping is visible. */
function truncateForPrinting(value, maxChars) {
  const text = String(value || '').trim();
  return text.length > maxChars ? `${text.substring(0, maxChars - 1)}…` : text;
}

/**
 * "Smith, Jane" from whatever the form was given. Splits on the LAST space, so
 * "Mary Anne Delacroix" prints as Delacroix / Mary Anne rather than losing the
 * middle of somebody's name; a single word goes in Last, since a one-word
 * entry on a sign-in list is a surname far more often than not.
 */
function splitNameForPrinting(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return { first: '', last: '' };
  if (raw.indexOf(',') !== -1) {
    // Already "Last, First" — respect what was typed.
    const [last, ...rest] = raw.split(',');
    return { last: last.trim(), first: rest.join(',').trim() };
  }
  const idx = raw.lastIndexOf(' ');
  if (idx === -1) return { first: '', last: raw };
  return { first: raw.substring(0, idx).trim(), last: raw.substring(idx + 1).trim() };
}

/** Who this row is with: the person who brought them, or the size of the party they brought. */
function describePartyForPrinting(row, map) {
  const personType = String(row[map['Person_Type']] || '').trim();
  const primary = String(row[map['Primary_Registrant']] || '').trim();
  if (personType === 'Guest' && primary && primary !== 'Self') return `guest of ${primary}`;
  const partySize = Number(row[map['Party_Size']]) || 0;
  if (partySize > 1) return `+${partySize - 1} guest(s)`;
  return '';
}

/** The Extra Notes cell: dietary needs and anything not-normal about the registration. */
function buildSignInNotes(row, map, status) {
  const parts = [];
  if (status && status !== 'Active') parts.push(status.toUpperCase());
  const lunchStatus = String(row[map['Lunch_Status']] || '').trim();
  if (lunchStatus === 'Needed') {
    const type = String(row[map['Lunch_Type']] || '').trim();
    parts.push(type ? `lunch (${type})` : 'lunch');
  }
  const notes = String(row[map['Admin_Notes']] || '').trim();
  if (notes) parts.push(notes);
  const joined = parts.join(' · ');
  // Paper has a width. A note longer than this is a note nobody reads at a
  // desk anyway, and the full text is a click away on the Registrants tab.
  // Shorter than it was, because the Program column now takes a slice of the
  // width this column used to have.
  return joined.length > 75 ? `${joined.substring(0, 72)}…` : joined;
}

/** The kitchen's own numbers for this day, read off the lunch dashboard if it has them. */
function lookupOrderingNumbersForPrinting(dateKey, location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_DASHBOARD);
  if (!sheet) return null;
  try {
    const headers = HEADERS.Master_Lunch_Dashboard;
    const map = getIndexMap(headers);
    const match = readAllSectionedRows(sheet, headers, 'Standard_Buffer').filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) === dateKey && String(row[map['Location']] || '').trim() === location;
    })[0];
    if (!match) return null;
    const registered = Number(match[map['Registered_Count']]) || 0;
    const standard = Number(match[map['Standard_Buffer']]) || 0;
    const tester = Number(match[map['Tester_Buffer']]) || 0;
    // Total_to_Order is a live formula on the sheet, so it reads back as its
    // own text — recompute the same sum rather than printing "=E12+Q12+R12".
    return { registered, standard, tester, total: registered + standard + tester };
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read the lunch dashboard for ordering numbers (${err}).`);
    return null;
  }
}

/**
 * Renders the sheet as a landscape PDF and returns the Drive file.
 *
 * Built as a Google Doc and then exported, rather than assembled as HTML: a
 * Doc paginates by itself, repeats nothing it shouldn't, and gives a table
 * that prints with real gridlines at a predictable size. The temporary Doc is
 * removed once the PDF exists — only the PDF is worth keeping.
 */
function renderSignInSheetPdf(data) {
  const title = buildSignInSheetTitle(data);
  const doc = DocumentApp.create(title);
  try {
    const body = doc.getBody();
    body.setPageWidth(SIGN_IN_PAGE.width);
    body.setPageHeight(SIGN_IN_PAGE.height);
    body.setMarginTop(SIGN_IN_PAGE.margin);
    body.setMarginBottom(SIGN_IN_PAGE.margin);
    body.setMarginLeft(SIGN_IN_PAGE.margin);
    body.setMarginRight(SIGN_IN_PAGE.margin);

    writeSignInSheetHeading(body, data);
    writeSignInSheetTable(body, data);

    // DocumentApp gives every new document one empty paragraph at the top; it
    // costs a line of a page that is meant to hold as many rows as possible.
    const first = body.getChild(0);
    if (body.getNumChildren() > 1 && first.getType() === DocumentApp.ElementType.PARAGRAPH &&
      first.asParagraph().getText() === '') {
      first.removeFromParent();
    }

    doc.saveAndClose();

    const folder = getOrCreateSignInSheetFolder();
    const pdf = folder.createFile(DriveApp.getFileById(doc.getId()).getAs('application/pdf')).setName(`${title}.pdf`);
    return pdf;
  } finally {
    // The Doc was only ever scaffolding for the PDF. Trashed rather than
    // deleted outright, so a failed export is still recoverable by hand.
    try {
      DriveApp.getFileById(doc.getId()).setTrashed(true);
    } catch (err) {
      log(`ℹ️ Could not tidy up the temporary sign-in document (${err}) — it is in your Drive root.`);
    }
  }
}

function buildSignInSheetTitle(data) {
  const stamp = Utilities.formatDate(data.date, TIMEZONE, 'yyyy-MM-dd');
  return `Sign-In ${stamp} ${data.location}`;
}

/** The block above the table: who, where, what is being served, and what was ordered. */
function writeSignInSheetHeading(body, data) {
  const heading = body.appendParagraph(
    `${data.location} — ${Utilities.formatDate(data.date, TIMEZONE, 'EEEE, MMMM d, yyyy')}`);
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  heading.editAsText().setFontSize(16).setBold(true);

  const bits = [];
  if (data.programs.length > 0) bits.push(data.programs.join(' · '));
  if (data.meal) {
    const dish = data.meal.shorthand || data.meal.description || '';
    bits.push(`Lunch: ${data.meal.type}${dish ? ` — ${dish}` : ''}`);
  } else {
    bits.push('Lunch: none scheduled');
  }
  bits.push(`${data.lunchCount} meal(s) requested`);
  if (data.noLunchCount > 0) bits.push(`${data.noLunchCount} here without lunch`);
  if (data.ordering) {
    bits.push(`ordered ${data.ordering.total} (${data.ordering.registered} registered ` +
      `+ ${data.ordering.standard} standard + ${data.ordering.tester} tester)`);
  }

  const sub = body.appendParagraph(bits.join('   |   '));
  sub.editAsText().setFontSize(10).setBold(false).setForegroundColor('#444444');

  // Says what the 0s mean. Without this the printed zeros look like a count
  // somebody already took, which is the one reading that would make the sheet
  // worse than blank columns.
  if (data.noLunchCount > 0) {
    const key = body.appendParagraph(
      'Rows pre-filled with 0 ordered no lunch — nothing to serve them, nothing to write in those boxes.');
    key.editAsText().setFontSize(9).setBold(false).setForegroundColor('#444444');
  }

  const help = body.appendParagraph(`Questions at the desk: ${CENTER_PHONE}`);
  help.editAsText().setFontSize(9).setForegroundColor('#777777');
}

/** The table itself: header row, one row per person, then blank rows for walk-ins. */
function writeSignInSheetTable(body, data) {
  const cells = [SIGN_IN_SHEET_COLUMNS.slice()];
  data.rows.forEach(row => {
    // A registrant with no lunch gets a printed 0 in all four meal columns
    // rather than four blanks — see the section note. Somebody WITH lunch gets
    // the ordered count and three empty boxes, because what they actually ate
    // is the thing the desk is there to record.
    const zero = row.lunch ? '' : '0';
    cells.push([
      '', '', row.last, row.first, row.phone, row.program, row.family, row.notes,
      row.lunch ? String(row.meals) : '0', zero, zero, zero
    ]);
  });
  for (let i = 0; i < SIGN_IN_SHEET_BLANK_ROWS; i++) {
    cells.push(SIGN_IN_SHEET_COLUMNS.map(() => ''));
  }

  const table = body.appendTable(cells);
  table.setBorderWidth(1);

  // Column widths, scaled to the printable width of the page. The LAST column
  // takes whatever is left rather than its own rounded share: twelve
  // independently-rounded widths can add up to a point or two more than the
  // page actually has, and a table half a rounding error wider than its
  // margins is a table Docs pushes off the edge of the paper.
  const usable = SIGN_IN_PAGE.width - (SIGN_IN_PAGE.margin * 2);
  const totalWeight = SIGN_IN_SHEET_COLUMN_WEIGHTS.reduce((a, b) => a + b, 0);
  let allocated = 0;
  SIGN_IN_SHEET_COLUMN_WEIGHTS.forEach((weight, i) => {
    const last = i === SIGN_IN_SHEET_COLUMN_WEIGHTS.length - 1;
    const width = last ? usable - allocated : Math.round(usable * (weight / totalWeight));
    allocated += width;
    try {
      table.setColumnWidth(i, width);
    } catch (err) { /* a column beyond the table — nothing to size */ }
  });

  const headerRow = table.getRow(0);
  for (let c = 0; c < SIGN_IN_SHEET_COLUMNS.length; c++) {
    const cell = headerRow.getCell(c);
    cell.setBackgroundColor('#D9D9D9');
    cell.editAsText().setBold(true).setFontSize(8);
  }

  // Body rows: small enough to fit eleven columns across, tall enough to write
  // a tick or a digit into by hand.
  for (let r = 1; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    row.setMinimumHeight(22);
    for (let c = 0; c < SIGN_IN_SHEET_COLUMNS.length; c++) {
      row.getCell(c).editAsText().setFontSize(9).setBold(false);
    }
  }
}

/** Find-or-create the Drive folder finished sign-in sheets are filed in. */
function getOrCreateSignInSheetFolder() {
  const folders = DriveApp.getFoldersByName(SIGN_IN_SHEET_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(SIGN_IN_SHEET_FOLDER_NAME);
  log(`Created Drive folder "${SIGN_IN_SHEET_FOLDER_NAME}" for printed sign-in sheets.`);
  return folder;
}


