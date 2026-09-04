// ============================================================================
// 9. THE SIGN-IN SHEET  (a LIVE Google Doc, lunch first, one row per person)
// ============================================================================
//
// Everything else in this workbook assumes a screen. The sign-in desk does not
// have one — or has one that is already showing something else, with a queue
// of people in front of it. What that desk needs is a table: the expected
// people already on it, and empty boxes to tick and to write meal counts into,
// which somebody types back in afterwards.
//
// This used to export a PDF and throw the document away. It now KEEPS THE
// DOCUMENT and hands back a link to it, and four things follow from that:
//
//   * THE LINK IS STABLE. One date x location has one Doc, forever. Rebuilding
//     a day reopens the same file and rewrites its body, so the link already
//     sitting on three dashboard tabs (69_generated_file_links.gs), already
//     mailed to somebody, already open on the tablet, keeps working and shows
//     the new roster. A PDF could only ever be superseded by a second PDF.
//   * IT CAN BE EDITED AT THE DESK. A name arrives that nobody expected; a
//     phone number is wrong. On paper that is a biro and a retype later; in a
//     live Doc it is a click, and two people can do it at once.
//   * IT STILL PRINTS. Landscape US Letter with real gridlines is what the
//     page is laid out as, and a table that outgrows one page paginates by
//     itself — File > Print is one step.
//   * THE FILES LIVE IN THEIR OWN FOLDER (SIGN_IN_DOC_FOLDER_NAME), beside the
//     forms folder rather than loose in My Drive, so a year of them is one
//     place you can sort by name and find any day.
//
// LUNCH COMES FIRST, because lunch is what the sheet is for. The document is
// two sections, in this order:
//
//   1. LUNCH — only the people with a meal ordered. This is the list the
//      kitchen hands food against, and the one somebody carries to the serving
//      table. Nothing on it is there for any other reason.
//   2. EVERYONE — the full roster for that place and day, lunch or not, so the
//      desk can still tick off an arrival who is only here for the program.
//
// (Google Docs TABS cannot be created programmatically — the Document service
// can read `getTabs()` and switch between them, but nothing in Apps Script or
// the Docs API adds one. So the two "tabs" are two page-broken sections with
// their own headings, which is what a person reading or printing this actually
// wants anyway: one file, lunch on page one.)
//
// THE COLUMNS are the ones the desk uses, left to right:
//
//   "In CoPilot"  CAME  Last  First  Phone #  Program  Handling  Notes
//   "MEALS ORDERED"  "DINED IN #"  "TAKE OUT #"  "# FRIDGE"
//
// The last four line up one-for-one with the per-registrant meal counts on the
// Registrants tab (see REGISTRANT_MEAL_COUNT_COLUMNS), so transcribing a
// finished sheet back into the workbook is column-for-column with no
// re-interpretation — which is the whole reason the meal counts were split per
// person in the first place.
//
// HANDLING IS A COLUMN AND A COLOUR. A standing need about the physical meal —
// "take-out", "put meals in the fridge" — is the one thing on this sheet that
// changes what somebody DOES, and it was previously buried mid-sentence in a
// notes column at 9pt. Two washes now carry it (see classifySignInHandling):
//
//   LIGHT YELLOW   the meal leaves the building — take-out, to-go, bagged,
//                  brings their own containers.
//   LIGHT PURPLE   the meal needs handling here — fridge, freezer, dispose
//                  after N days, serve at a set time, somebody else collects.
//
// Purple wins when a row is both, because it is the rarer instruction and the
// one that goes wrong silently. Diet needs ("no milk") print in the Handling
// column with no wash: they matter to whoever packs the meal, but they do not
// change where it goes, and colouring them would colour half the sheet and
// cost the two washes their meaning.
//
// IT IS A SHEET FOR A DAY AND A PLACE, NOT FOR A PROGRAM. The desk is one desk:
// whoever is on it that morning signs in everybody who walks up, whichever
// program they came for, and hands out lunch to the subset who ordered it. A
// per-program sheet would mean the same person holding three sheets and
// guessing which one a given arrival is on — so the picker asks for a LOCATION
// and a DATE, and the roster is every registrant at that place on that day
// across every program, with a Program column saying which is which.
//
// EVERYONE APPEARS ON SECTION 2, INCLUDING THE PEOPLE NOT EATING, and a
// registrant with no lunch is printed with a literal 0 in each of the four meal
// columns — already answered, nothing to collect, and it transcribes back as
// the zero it is. A blank box is indistinguishable from a box nobody has filled
// in yet; at the end of service that is the difference between "ordered
// nothing" and "we forgot to ask".
//
// ONE PERSON IS ONE ROW, AGGRESSIVELY. See dedupeSignInEntries() for the whole
// rule, but the short version is that the desk is looking up an ARRIVAL, not a
// registration: somebody signed up for three programs today is one human being
// walking through one door, and printing them three times means three lookups,
// three ticks, and — the reason this got rewritten — a lunch count of three for
// somebody who eats one lunch. Names are matched loosely (punctuation, middle
// initials, honorifics and "Last, First" order all collapse away) and a shared
// phone number merges two spellings that share a name token. Meal counts across
// a merged person are taken as the MAXIMUM, never the sum: `Meals_Ordered` on
// one row is how this workbook says "she wants four", and the same person
// answering the lunch question on two forms wants one.
//
// A GUEST PRINTS UNDER THEIR REGISTRANT, NEVER AS A ROW OF THEIR OWN. Their
// name goes in Notes and their ordered meal is ADDED to the registrant's own
// MEALS ORDERED count — a guest is a second mouth, so guest meals sum where a
// duplicate's do not. This is a document-only fold: nothing here writes back to
// Registrant_Dash, so the guest's own row keeps its own meal count everywhere
// else in the workbook.
// ============================================================================

/** The sheet's columns, left to right, exactly as they appear in the table. */
const SIGN_IN_SHEET_COLUMNS = [
  'In CoPilot', 'CAME', 'Last', 'First', 'Phone #', 'Program', 'Handling', 'Notes',
  'MEALS ORDERED', 'DINED IN #', 'TAKE OUT #', '# FRIDGE'
];

/**
 * Relative column widths. The hand-tick columns are narrow, the name, program
 * and notes columns wide — a Doc table divides the page by these, so they are
 * proportions rather than measurements.
 *
 * Retuned for the larger type (see SIGN_IN_SHEET_BODY_FONT_SIZE): at 11pt a
 * column narrower than about 34pt cannot hold a two-digit number and a tick
 * without wrapping, so the four tick/count columns took a point each from
 * Notes rather than the other way round.
 */
const SIGN_IN_SHEET_COLUMN_WEIGHTS = [5, 5, 10, 9, 10, 11, 11, 12, 7, 6, 7, 7];

/**
 * Longest program name printed before it is clipped. Roomier than it was,
 * because a deduped person carries EVERY program they are on today in this one
 * cell (see mergeSignInEntries) — the column wraps to a second line rather than
 * telling the desk that Joan is here for "Chair Yoga · Brid…".
 */
const SIGN_IN_SHEET_MAX_PROGRAM_CHARS = 28;

/** Longest Handling line printed before it is clipped — the colour says the rest. */
const SIGN_IN_SHEET_MAX_HANDLING_CHARS = 42;

/** Longest Notes line. Shorter than it was: Handling took the half of it that mattered most. */
const SIGN_IN_SHEET_MAX_NOTES_CHARS = 62;

/** Blank rows added under each roster, for walk-ins nobody knew about. */
const SIGN_IN_SHEET_BLANK_ROWS = 8;

/**
 * READABILITY. The old sheet was 8pt headers over 9pt body, which fit twelve
 * columns comfortably and was reported, accurately, as unreadable across a desk
 * in a room lit for eating rather than for reading. 11pt body is the size the
 * rest of this workbook's printed output uses; the header stays a step smaller
 * so that "MEALS ORDERED" still fits its column on one or two lines.
 */
const SIGN_IN_SHEET_BODY_FONT_SIZE = 11;
const SIGN_IN_SHEET_HEADER_FONT_SIZE = 10;

/** Row height, in points. Tall enough to write a tick or two digits into by hand at 11pt. */
const SIGN_IN_SHEET_ROW_HEIGHT = 26;

/** US Letter, landscape, in points — the page this is laid out against. */
const SIGN_IN_PAGE = { width: 792, height: 612, margin: 28 };

/** Where the live sign-in documents are filed. One folder, one file per day and building. */
const SIGN_IN_DOC_FOLDER_NAME = 'Sign-In Sheets';

/**
 * Where the PDFs this used to export were filed. Nothing writes here any more,
 * but backfillSignInSheetRegistry() still reads it: a workbook that printed
 * sheets for a year has that year in this folder, and those links are still the
 * only record of what a given day's roster looked like.
 */
const SIGN_IN_SHEET_FOLDER_NAME = 'Printed Sign-In Sheets';

/**
 * THE MEAL LEAVES THE BUILDING — light yellow.
 *
 * Matched against the standing needs that apply to a person on this session
 * (37_regular_needs.gs) and against whatever is in their Admin_Notes, because
 * the desk types notes there by hand as often as Quick Mark stamps them. Loose
 * on spelling and spacing for the same reason parseNeedWeekdays() is: this text
 * is written by people in a hurry.
 */
const SIGN_IN_TAKEOUT_RE =
  /take[\s-]*out|take[\s-]*away|carry[\s-]*out|\bto[\s-]*go\b|bagged?\s+(lunch|meal)|own\s+container/i;

/**
 * THE MEAL NEEDS HANDLING HERE — light purple.
 *
 * Deliberately NOT every unusual note. This is the set of instructions that
 * change what happens to the physical meal on the premises; a diet restriction
 * changes what is IN it, prints in the Handling column, and gets no wash. If
 * everything unusual were purple, nothing would be.
 */
const SIGN_IN_SPECIAL_RE =
  /fridge|freezer|refrigerat|\bdispose\b|\bfroze?n\b|collects?\s+for|somebody\s+else\s+collects|someone\s+else\s+collects|serve\s+at\s+\d|hold\s+(for|until)|\bset\s+aside\b/i;

/** MENU ENTRY: pick a location + date, get the live document for that day. */
function showSignInSheetDialog() {
  const options = listSignInSheetOptions();
  if (options.length === 0) {
    toastIfPossible('Nothing to build yet — no sessions or lunch dates in the next few weeks. Run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildSignInSheetHtml(options))
    .setWidth(520)
    .setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, 'Sign-In Sheet');
}

/**
 * Every location+date worth offering: every session on the dashboard and every
 * catered day on the menu, within a window either side of today.
 *
 * Both sources, because the two answer different questions — the dashboard
 * knows where people are expected, the menu knows where food is being served,
 * and a sign-in sheet is wanted for either. Yesterday and the day before are
 * included on purpose: the commonest reason to build one late is that the
 * original was never opened.
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
      getSectionedRows(dash, headers, 'Event_ID').forEach(row => {
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
<h3>Sign-in sheet for a day</h3>
<p class="hint">
  A live Google Doc for one place and one day: lunch on page one, everybody on page two.
  Take-out rows are washed yellow, fridge and other special handling purple.
  Building the same day again reuses the same document, so the link never goes stale.
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
<button id="go" onclick="submit()">Build the sheet</button>
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
    say('Building the document…', '');
    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('go').disabled = false;
        if (!res || !res.url) { say(res && res.message ? res.message : 'Nothing to build.', 'err'); return; }
        var el = document.getElementById('status');
        el.className = 'ok';
        el.innerHTML = res.message + '<br><a href="' + res.url + '" target="_blank">Open the sign-in sheet</a>';
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .createSignInSheetDoc(session, include);
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
 * Called from the dialog. Builds (or rebuilds) the live document and returns
 * { url, message }.
 *
 * `sessionValue` is "yyyy-MM-dd|Location"; `include` is 'active' or 'all'.
 */
function createSignInSheetDoc(sessionValue, include) {
  const parts = String(sessionValue || '').split('|');
  const dateKey = String(parts[0] || '').trim();
  const location = String(parts[1] || '').trim();
  if (!dateKey || !location) return { url: '', message: '⚠️ Pick a date and location first.' };

  const data = collectSignInSheetData(dateKey, location, include === 'all');
  if (data.rows.length === 0 && !data.meal) {
    return { url: '', message: `⚠️ Nothing registered for ${formatDateLabel(parseDateKey(dateKey))} at ${location}, ` +
      `and no lunch on the menu — there is nothing to put on a sheet.` };
  }

  const file = renderSignInSheetDoc(data);
  // REMEMBERED, not just returned. The dialog hands back a link that is gone
  // the moment it closes; the registry is what puts that same file on the
  // session's row on every tab that has one — see 69_generated_file_links.gs.
  // It is also how the NEXT build of this day finds the document to rewrite
  // rather than making a second one.
  recordSignInSheetFile(dateKey, location, file);
  flushPersistentRegistries();
  const message = `✅ ${data.lunchRows.length} on the lunch list (${data.lunchCount} meal(s)), ` +
    `${data.rows.length} on the full roster` +
    (data.mergedAway > 0 ? `, ${data.mergedAway} duplicate row(s) merged` : '') +
    (data.meal ? `. Lunch: ${data.meal.shorthand || data.meal.description || data.meal.type}` : '') + '.';
  log(`createSignInSheetDoc: wrote "${file.getName()}" — ${data.rows.length} person(s), ` +
    `${data.lunchRows.length} eating, ${data.lunchCount} meal(s), ${data.mergedAway} duplicate(s) merged.`);
  return { url: file.getUrl(), message };
}

/**
 * SCHEDULED ENTRY POINT: builds one sign-in sheet per location that has a
 * session or catered lunch TODAY, unattended — see writeTriggers() (16) for
 * the early-morning trigger that calls this. The desk should never have to
 * remember to press "Print Sign-In Sheet" before the first person walks in.
 *
 * The sheet is a live document now, not a PDF (see renderSignInSheetDoc()),
 * which makes this cheaper than it reads: a day this has already built is
 * REWRITTEN in place, so the link on the dashboard is the same link it was
 * yesterday and a desk that bookmarked it is not stranded.
 *
 * Behind the same kill switch as syncCalendars() / syncRegistrations() (see
 * MANAGED_AUTOMATION_HANDLERS in 04) — this runs on its own, at its own time,
 * while nobody is watching, which is exactly what that switch exists to stop.
 *
 * SAME LOCK AND SAME REASON AS syncRegistrations(): building a sheet reads
 * Registrant_Dash and then read-modify-writes the sign-in sheet registry (a
 * single Script Property everything else that prints one also touches), so
 * two overlapping runs racing that property is worse than one waiting a few
 * seconds for the other.
 *
 * "Active registrations only" — the dialog's own recommended default — since
 * an unattended run has nobody there to choose "include cancelled/waitlisted".
 * A location with nothing to print (no active roster and no catered lunch) is
 * skipped without complaint, exactly like createSignInSheetDoc()'s own guard.
 */
function autoCreateTodaysSignInSheets() {
  if (!automationGateAllows('Auto Sign-In Sheets')) return;
  recordHandlerRun('autoCreateTodaysSignInSheets');

  if (isBootstrapActive()) {
    log('autoCreateTodaysSignInSheets: a large-setup import or forms-rebuild sweep is in progress — skipping this run.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('autoCreateTodaysSignInSheets: another sync is already running — skipping this run.');
    return;
  }
  try {
    autoCreateTodaysSignInSheetsInternal();
  } finally {
    lock.releaseLock();
  }
}

function autoCreateTodaysSignInSheetsInternal() {
  const todayKey = formatDateKey(new Date());
  // listSignInSheetOptions() already covers today (its window runs 7 days
  // back to 45 forward) and already answers the two-source question this
  // needs — where is somebody expected, where is lunch being served — so this
  // reuses it rather than re-reading the dashboard and the menu itself.
  const todays = listSignInSheetOptions().filter(o => o.dateKey === todayKey);
  if (todays.length === 0) {
    log(`autoCreateTodaysSignInSheets: nothing scheduled for ${todayKey} — no sheets to print.`);
    return;
  }

  const built = [];
  const skipped = [];
  todays.forEach(option => {
    try {
      const data = collectSignInSheetData(option.dateKey, option.location, false);
      if (data.rows.length === 0 && !data.meal) {
        skipped.push(option.location);
        return;
      }
      const file = renderSignInSheetDoc(data);
      recordSignInSheetFile(option.dateKey, option.location, file);
      built.push(`${option.location} (${data.rows.length} name(s))`);
    } catch (err) {
      log(`⚠️ autoCreateTodaysSignInSheets: failed to build a sheet for ${option.location} on ${todayKey} (${err}).`);
    }
  });
  flushPersistentRegistries();

  const summary = built.length > 0
    ? `autoCreateTodaysSignInSheets: built ${built.length} sheet(s) for ${todayKey} — ${built.join('; ')}` +
      (skipped.length > 0 ? `. Skipped (nothing to print): ${skipped.join(', ')}.` : '.')
    : `autoCreateTodaysSignInSheets: nothing to print for ${todayKey} (${skipped.length} location(s) had no active registrations or lunch).`;
  log(summary);
}

/**
 * Gathers everything one sheet needs: the day's meal, the people, and the
 * counts the kitchen is working to.
 *
 * EVERY program at this location on this date, in one roster — see the section
 * note. Which program each person came for is kept per row and printed in its
 * own column, so a mixed sheet is still readable at the desk.
 *
 * Sorted by LAST NAME, because that is how a person hunts for their own name
 * on a list at a desk — not by registration order, which is meaningless to
 * them, and not by first name, which is what the workbook happens to store.
 *
 * NOT sorted lunch-first WITHIN a section, which is the obvious alternative and
 * the wrong one: the person holding this is looking up arrivals by name, one at
 * a time, all morning, and a roster split into two alphabetical halves means
 * every lookup is two lookups. The LUNCH SECTION is the lunch-first cut, and it
 * is a separate page for exactly that reason.
 *
 * GUESTS FOLD INTO THEIR REGISTRANT and DUPLICATES FOLD INTO ONE PERSON — see
 * the two passes below. Both are document-only folds: nothing here writes back
 * to Registrant_Dash.
 */
function collectSignInSheetData(dateKey, location, includeEveryone) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const date = parseDateKey(dateKey);
  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const registrantRows = sheet ? getSectionedRows(sheet, headers, 'Event_ID') : [];

  const programs = [];
  const hosts = [];
  const hostsByKey = {};
  const guests = [];
  registrantRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) !== dateKey) return;
    if (String(row[map['Location']] || '').trim() !== location) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (!includeEveryone && status !== 'Active') return;

    const program = String(row[map['Event']] || '').trim();
    if (program && programs.indexOf(program) === -1) programs.push(program);

    const name = String(row[map['Name']] || '').trim();
    const personType = String(row[map['Person_Type']] || '').trim();
    const entry = {
      name, program, status, row,
      isGuest: /^guest$/i.test(personType),
      // Carried on the entry rather than read back off the row when wanted:
      // dedupeSignInEntries() matches on it and mergeSignInEntries() has to be
      // able to prefer a duplicate's number over a blank on the first row, and
      // neither of them has the header map.
      phone: String(row[map['Phone']] || '').trim(),
      lunch: String(row[map['Lunch_Status']] || '').trim() === 'Needed',
      // What is actually printed in MEALS ORDERED. A standing order of four is
      // the one fact on this sheet the desk cannot work out for itself, and a
      // pre-printed 1 was the workbook asserting something untrue about Joan.
      meals: readRegistrantMealsOrdered(row, map)
    };
    if (entry.isGuest) {
      guests.push(entry);
    } else {
      // Keyed on the SAME program, so a host who came to two sessions today
      // keeps a guest attached to the one they actually brought them to.
      hostsByKey[`${normalizeNameKey(name)} ${program}`] = entry;
      hosts.push(entry);
    }
  });

  // FOLD GUESTS INTO WHOEVER BROUGHT THEM. A guest whose host is not on
  // today's roster for that same program — the host cancelled and the guest
  // did not, or the two names do not match — stays a row of its own, labelled
  // "guest of X" by describePartyForPrinting(), and is deduped like anybody.
  guests.forEach(guest => {
    const primary = String(guest.row[map['Primary_Registrant']] || '').trim();
    const key = primary && primary !== 'Self'
      ? `${normalizeNameKey(primary)} ${guest.program}` : '';
    const host = key && hostsByKey[key];
    if (!host) { hosts.push(guest); return; }
    host.guests = host.guests || [];
    host.guests.push(guest);
  });

  // ONE PERSON, ONE ROW. The second fold, and the aggressive one.
  const merged = dedupeSignInEntries(hosts);
  const mergedAway = hosts.length - merged.length;

  // The standing needs that decide the Handling column and its wash. Read once
  // for the whole sheet: this is a tab read, and a per-person one would be a
  // hundred of them.
  const needs = readRegularNeedsForSignInSheet();
  const rows = merged.map(entry => buildSignInSheetRow(entry, map, needs, date, location));

  rows.sort((a, b) =>
    a.last.localeCompare(b.last) || a.first.localeCompare(b.first));

  const meal = getMealInfoForDate(date, location);
  // MEALS, matching Master_Lunch_Dashboard's Registered_Count — the kitchen
  // figure printed at the head of this sheet has to be the same number the
  // kitchen was given, or the desk has two counts and no way to choose.
  const lunchRows = rows.filter(r => r.lunch && r.meals > 0);
  const lunchCount = lunchRows.reduce((n, r) => n + r.meals, 0);
  return {
    date,
    dateKey,
    location,
    programs,
    rows,
    lunchRows,
    mergedAway,
    meal: meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1 ? meal : null,
    lunchCount,
    // PEOPLE, not meals — this is the count the "rows pre-filled with 0" note
    // explains, and it counts rows on the page. Derived from the rows rather
    // than by subtracting lunchCount, which stopped being a headcount the
    // moment one person could order four (see Meals_Ordered).
    noLunchCount: rows.length - lunchRows.length,
    ordering: lookupOrderingNumbersForPrinting(dateKey, location)
  };
}

// ----------------------------------------------------------------------------
// One person, one row
// ----------------------------------------------------------------------------

/**
 * THE AGGRESSIVE NAME KEY. normalizeNameKey() lowercases and collapses spaces,
 * which is the right amount of forgiveness for joining a form response to a
 * roster row and nowhere near enough for deciding whether two rows in front of
 * a sign-in desk are the same human being. This one additionally:
 *
 *   * CLOSES UP apostrophes and drops the rest of the punctuation, so
 *     "O'Brien" and "OBrien" are one person and "Smith, Jane" stops being a
 *     third spelling of Jane Smith. Apostrophes close rather than split
 *     because splitting them would leave "o" — which the initial rule below
 *     then throws away, turning O'Brien into Brien and matching neither
 *     spelling. (A name typed "O Brien", with a real space, is out of reach of
 *     this and stays its own person: there is nothing in the string to say
 *     whether that space is a missing apostrophe or a middle name.);
 *   * drops honorifics and suffixes (Mr, Dr, Jr, III), which people type on one
 *     form and not the next;
 *   * drops single-letter tokens, so a middle initial supplied once does not
 *     make a second person;
 *   * SORTS the remaining tokens, which is what makes "Smith Jane" and "Jane
 *     Smith" the same key without having to know which field was which.
 *
 * Sorting tokens is the deliberately aggressive part: it will also collapse
 * "Ann Marie" and "Marie Ann", who could in principle be two people. On a
 * roster of a few dozen names at one building on one day that trade is the
 * right way round — a wrongly merged pair is one row somebody queries at the
 * desk, and a wrongly split pair is a second lunch ordered for somebody who
 * eats one.
 */
function signInPersonKey(name) {
  const raw = String(name || '')
    .toLowerCase()
    .replace(/['’`]/g, '')          // O'Brien -> obrien, never "o brien"
    .replace(/[.,_"()\[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const drop = {
    mr: true, mrs: true, ms: true, miss: true, mx: true, dr: true, rev: true, fr: true,
    prof: true, sir: true, jr: true, sr: true, ii: true, iii: true, iv: true, v: true
  };
  const tokens = raw.split(' ').filter(t => t.length > 1 && !drop[t]);
  if (tokens.length === 0) return raw; // a one-letter name is still a name
  return tokens.sort().join(' ');
}

/** The last ten digits of a phone number, or '' — the form a person types two different ways. */
function signInPhoneKey(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Collapses a day's entries down to one per person.
 *
 * TWO PASSES. The first groups on signInPersonKey(), which catches every
 * ordinary duplicate: the same person on two programs, the same registration
 * imported twice, a name retyped with a middle initial.
 *
 * The second is for the case the name key cannot see — two genuinely different
 * spellings of one person, "Bob Smith" and "Robert Smith". Those merge only
 * when they share a PHONE NUMBER *and* share at least one name token, which is
 * tight enough that a household sharing a landline does not collapse into one
 * row. GUESTS ARE EXEMPT FROM THE PHONE PASS for exactly that reason: a guest
 * is normally reachable on the phone of whoever brought them, and merging the
 * two would silently drop a meal — a guest is a second mouth (see the meal
 * arithmetic in mergeSignInEntries()).
 *
 * ORDER IS PRESERVED: the first entry seen for a person is the one that keeps
 * its position, so the caller's sort is still the only thing deciding order.
 */
function dedupeSignInEntries(entries) {
  const byKey = {};
  const order = [];
  const groupOfPhone = {};

  (entries || []).forEach(entry => {
    let key = signInPersonKey(entry.name);
    if (!key) key = `#${order.length}`; // a nameless row is its own row, not everyone's

    const phoneKey = entry.isGuest ? '' : signInPhoneKey(entry.phone);
    if (!byKey[key] && phoneKey && groupOfPhone[phoneKey]) {
      const candidate = groupOfPhone[phoneKey];
      if (shareANameToken(key, candidate)) key = candidate;
    }

    if (!byKey[key]) {
      byKey[key] = { key, entries: [] };
      order.push(key);
    }
    byKey[key].entries.push(entry);
    if (phoneKey && !groupOfPhone[phoneKey]) groupOfPhone[phoneKey] = key;
  });

  return order.map(key => mergeSignInEntries(byKey[key].entries));
}

/** Do two aggressive name keys have a word in common? The guard on the phone merge. */
function shareANameToken(a, b) {
  const left = String(a || '').split(' ').filter(Boolean);
  const right = String(b || '').split(' ').filter(Boolean);
  return left.some(token => right.indexOf(token) !== -1);
}

/**
 * Folds N entries for one person into one.
 *
 * THE MEAL COUNT IS THE MAXIMUM, NOT THE SUM, and this is the whole point of
 * the exercise. `Meals_Ordered` on a single row is how this workbook says "she
 * wants four" (readRegistrantMealsOrdered()); the same person ticking the lunch
 * question on the Art form and the Bridge form has said "I want lunch" twice
 * about one lunch. Summing them is how a kitchen ends up cooking for a hundred
 * and ten people at a building that seats seventy.
 *
 * Guests are the exception and they are not merged here — they arrive already
 * attached to their host (see collectSignInSheetData) and their meals ADD in
 * buildSignInSheetRow(), because a guest really is a second mouth. Guest LISTS
 * from several merged rows are concatenated and then deduped by the same person
 * key, so a guest attached to a host on two programs is named once.
 *
 * Everything else takes the most informative value: the longest spelling of the
 * name, the first phone number anybody supplied, every distinct program joined,
 * and Active in preference to a cancellation (a person who cancelled one of two
 * programs is still here for the other).
 */
function mergeSignInEntries(entries) {
  const list = entries || [];
  const base = list[0];
  if (list.length === 1) return base;

  const programs = [];
  const guests = [];
  const guestKeys = {};
  let name = base.name;
  let phone = '';
  let status = '';
  let meals = 0;
  let lunch = false;

  list.forEach(entry => {
    if (String(entry.name || '').length > String(name || '').length) name = entry.name;
    if (!phone && entry.phone) phone = entry.phone;
    if (entry.program && programs.indexOf(entry.program) === -1) programs.push(entry.program);
    if (entry.lunch) lunch = true;
    if (entry.meals > meals) meals = entry.meals;
    if (entry.status === 'Active' || !status) status = entry.status;
    (entry.guests || []).forEach(guest => {
      const key = signInPersonKey(guest.name) || `#${guests.length}`;
      if (guestKeys[key]) return;
      guestKeys[key] = true;
      guests.push(guest);
    });
  });

  return {
    name,
    phone,
    program: programs.join(' · '),
    programs,
    status,
    // The row the merged person is DESCRIBED from — phone, notes, party size,
    // person type. The first one seen, which is the earliest registration and
    // so the one most likely to have been filled in by hand rather than
    // auto-filled from it.
    row: base.row,
    isGuest: base.isGuest,
    lunch,
    meals,
    guests,
    mergedFrom: list.length
  };
}

// ----------------------------------------------------------------------------
// Handling: the column and the two washes
// ----------------------------------------------------------------------------

/** The standing needs, or an empty list if the tab is missing or unreadable. */
function readRegularNeedsForSignInSheet() {
  try {
    return readRegularNeedRows();
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read the standing needs (${err}) — building without them.`);
    return [];
  }
}

/**
 * Everything the desk has to DO differently for this person, as short lines.
 *
 * Two sources, because the same fact reaches a row two ways: the Regular_Needs
 * tab (which Quick Mark also stamps onto Admin_Notes) and whatever somebody
 * typed into Admin_Notes by hand. Deduped on the text, so a need that has been
 * both matched and stamped prints once.
 */
function collectSignInHandlingNotes(entry, map, needs, date, location) {
  const out = [];
  const seen = {};
  const add = text => {
    const clean = String(text || '').replace(/^🔔\s*/, '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push(clean);
  };

  const titles = entry.programs && entry.programs.length ? entry.programs : [entry.program];
  titles.forEach(title => {
    regularNeedsFor(needs, { name: entry.name, location, title: String(title || '').trim(), date })
      .forEach(need => add(describeRegularNeed(need)));
  });

  // The hand-typed half. Admin_Notes is one field with several facts in it,
  // joined by the same ' · ' stampRegularNeedsOnRow() uses, so it splits back
  // into the pieces that were put in.
  String((entry.row && map['Admin_Notes'] !== undefined ? entry.row[map['Admin_Notes']] : '') || '')
    .split(/\s·\s|\n/)
    .forEach(part => {
      const clean = part.trim();
      if (clean && (SIGN_IN_TAKEOUT_RE.test(clean) || SIGN_IN_SPECIAL_RE.test(clean))) add(clean);
    });

  return out;
}

/**
 * '' | 'takeout' | 'special' — which wash this row gets.
 *
 * SPECIAL WINS a row that is both. "Take-out, and put it in the fridge if she
 * has not come by noon" is two instructions, and the second is the one that
 * gets forgotten; the Handling column still spells out both.
 */
function classifySignInHandling(handlingNotes) {
  const text = (handlingNotes || []).join(' · ');
  if (!text) return '';
  if (SIGN_IN_SPECIAL_RE.test(text)) return 'special';
  if (SIGN_IN_TAKEOUT_RE.test(text)) return 'takeout';
  return '';
}

/** The wash a handling class prints as, or '' for no wash at all. */
function signInHandlingColor(handlingClass) {
  if (handlingClass === 'takeout') return PALETTE.HANDLING_TAKEOUT;
  if (handlingClass === 'special') return PALETTE.HANDLING_SPECIAL;
  return '';
}

// ----------------------------------------------------------------------------
// One row
// ----------------------------------------------------------------------------

/** Clips a value to fit its column, with an ellipsis so the clipping is visible. */
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

/**
 * The Notes cell: who this person is with, anything not-normal about the
 * registration, and whatever else is on the row.
 *
 * The HANDLING facts are deliberately NOT repeated here — they have their own
 * column and their own colour now, and printing them twice at 11pt is how a
 * notes column stops being read.
 */
function buildSignInNotes(entry, map, handlingNotes) {
  const row = entry.row;
  const parts = [];
  if (entry.status && entry.status !== 'Active') parts.push(entry.status.toUpperCase());

  const party = describePartyForPrinting(row, map);
  if (party) parts.push(party);

  if (entry.lunch) {
    const type = String(row[map['Lunch_Type']] || '').trim();
    if (type && type !== 'No Lunch') parts.push(type.toLowerCase());
  }

  // WHO ELSE IS ON THIS ROW. Guests print folded into their registrant rather
  // than as rows of their own (see collectSignInSheetData()'s guest-folding),
  // so their names go here — the one place left on a single-row-per-party
  // sheet for the desk to see who it is actually ticking off.
  const guestNames = (entry.guests || []).map(g => g.name).filter(Boolean);
  if (guestNames.length) {
    parts.push(`with ${guestNames.length === 1 ? 'guest' : 'guests'}: ${guestNames.join(', ')}`);
  }

  // Whatever is left in Admin_Notes once the handling lines have been lifted
  // out of it — the free text that is genuinely just a note.
  const handled = {};
  (handlingNotes || []).forEach(text => { handled[text.toLowerCase()] = true; });
  String(row[map['Admin_Notes']] || '')
    .split(/\s·\s|\n/)
    .forEach(part => {
      const clean = part.replace(/^🔔\s*/, '').trim();
      if (clean && !handled[clean.toLowerCase()]) parts.push(clean);
    });

  return truncateForPrinting(parts.join(' · '), SIGN_IN_SHEET_MAX_NOTES_CHARS);
}

/**
 * One printed row for a person AND their folded-in guests.
 *
 * THE MEAL COUNT IS THE PARTY'S, NOT JUST THE REGISTRANT'S: the desk hands
 * lunch to a party at once, so a guest who ordered a meal has it added to the
 * name the desk is actually ticking off, and `lunch` flips on for the row so
 * the meal columns print the total rather than a zero. Duplicates of the SAME
 * person were already collapsed with a maximum rather than a sum — see
 * mergeSignInEntries() for why the two arithmetics differ.
 */
function buildSignInSheetRow(entry, map, needs, date, location) {
  const row = entry.row;
  const guests = entry.guests || [];
  const guestMeals = guests.reduce((n, g) => n + (g.lunch ? g.meals : 0), 0);
  const split = splitNameForPrinting(entry.name);
  const handlingNotes = collectSignInHandlingNotes(entry, map, needs, date, location);
  return {
    last: split.last,
    first: split.first,
    phone: entry.phone || String(row[map['Phone']] || '').trim(),
    program: truncateForPrinting(entry.program, SIGN_IN_SHEET_MAX_PROGRAM_CHARS),
    handling: truncateForPrinting(handlingNotes.join(' · '), SIGN_IN_SHEET_MAX_HANDLING_CHARS),
    handlingClass: classifySignInHandling(handlingNotes),
    notes: buildSignInNotes(entry, map, handlingNotes),
    lunch: entry.lunch || guestMeals > 0,
    // What is actually printed in MEALS ORDERED — the person's own count, plus
    // whatever their folded-in guests ordered.
    meals: (entry.lunch ? entry.meals : 0) + guestMeals
  };
}

/** The kitchen's own numbers for this day, read off the lunch dashboard if it has them. */
function lookupOrderingNumbersForPrinting(dateKey, location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_DASHBOARD);
  if (!sheet) return null;
  try {
    const headers = HEADERS.Master_Lunch_Dashboard;
    const map = getIndexMap(headers);
    const match = getSectionedRows(sheet, headers, 'Standard_Buffer').filter(row => {
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

// ----------------------------------------------------------------------------
// The document
// ----------------------------------------------------------------------------

/**
 * Writes the sheet into its live Google Doc and returns the Drive file.
 *
 * THE SAME DOCUMENT EVERY TIME for a given date x location. The registry
 * (69_generated_file_links.gs) already remembers a file per day and building,
 * so a rebuild opens that one and rewrites its body rather than making a second
 * file with the same name — which is what keeps every link already handed out
 * pointing at a roster that is current.
 *
 * A document that has been deleted, trashed, or is no longer openable is
 * silently replaced by a fresh one. That is the honest reading of "the file is
 * gone": there is nothing to preserve, and refusing to build would leave the
 * desk with no sheet at all over a file somebody tidied away.
 */
function renderSignInSheetDoc(data) {
  const title = buildSignInSheetTitle(data);
  const doc = openOrCreateSignInSheetDoc(data, title);

  const body = doc.getBody();
  // A REBUILD, not an append. Everything below is written from scratch, so
  // whatever the last build (or a person with a biro) left behind goes first.
  body.clear();
  body.setPageWidth(SIGN_IN_PAGE.width);
  body.setPageHeight(SIGN_IN_PAGE.height);
  body.setMarginTop(SIGN_IN_PAGE.margin);
  body.setMarginBottom(SIGN_IN_PAGE.margin);
  body.setMarginLeft(SIGN_IN_PAGE.margin);
  body.setMarginRight(SIGN_IN_PAGE.margin);

  // SECTION ONE: LUNCH. First because it is what the sheet is for.
  writeSignInSheetHeading(body, data, {
    section: 'Lunch',
    note: data.lunchRows.length === 0
      ? 'Nobody has ordered a meal for this day yet.'
      : 'Everyone with a meal ordered. Hand food against this page.'
  });
  writeSignInSheetTable(body, data.lunchRows, { showZeros: false });

  body.appendPageBreak();

  // SECTION TWO: EVERYONE.
  writeSignInSheetHeading(body, data, {
    section: 'Everyone',
    note: 'The full roster for this day — lunch or not. Rows showing 0 in the meal ' +
      'columns ordered no lunch: nothing to serve them, nothing to write in those boxes.'
  });
  writeSignInSheetTable(body, data.rows, { showZeros: true });

  // DocumentApp leaves an empty paragraph at the top of a cleared body; it
  // costs a line of a page that is meant to hold as many rows as possible.
  const first = body.getChild(0);
  if (body.getNumChildren() > 1 && first.getType() === DocumentApp.ElementType.PARAGRAPH &&
    first.asParagraph().getText() === '') {
    first.removeFromParent();
  }

  doc.saveAndClose();
  return DriveApp.getFileById(doc.getId());
}

/**
 * The live document for this day and building: the one the registry remembers,
 * or a new one filed in SIGN_IN_DOC_FOLDER_NAME.
 *
 * The title is re-applied on every build, so a day whose location was renamed
 * — or a file created under the old "Sign-In …" PDF naming — ends up named for
 * what it now contains without losing its URL.
 */
function openOrCreateSignInSheetDoc(data, title) {
  const entry = getSignInSheetRegistry()[signInSheetKey(data.dateKey, data.location)];
  if (entry && entry.fileId) {
    try {
      const file = DriveApp.getFileById(entry.fileId);
      if (!file.isTrashed() && file.getMimeType() === MimeType.GOOGLE_DOCS) {
        const doc = DocumentApp.openById(entry.fileId);
        // Renamed through the Document rather than the Drive file: the document
        // is about to be written and saved, and two APIs holding the same file
        // open is a race worth not having.
        if (doc.getName() !== title) doc.setName(title);
        return doc;
      }
    } catch (err) {
      // Deleted, or owned by somebody who has since revoked access. Either way
      // there is nothing to rewrite — fall through and make a new one.
      log(`ℹ️ Sign-in sheet: the document for ${data.dateKey} at ${data.location} could not be ` +
        `reopened (${err}) — building a fresh one.`);
    }
  }

  const doc = DocumentApp.create(title);
  // Same reason every form, registrant sheet and printed PDF opens itself up the
  // moment it exists (see openUpFileToAnyoneWithLink()): whoever builds this
  // is not necessarily whoever later clicks the Sign_In_Sheet_Link on the
  // dashboard (69_generated_file_links.gs), and Drive hands a new file to its
  // creator alone. Never thrown — a sheet that could not be opened up is
  // still a sheet. Only on creation: a re-opened document is already shared.
  openUpFileToAnyoneWithLink(doc.getId(), `sign-in sheet "${title}"`);
  try {
    // DocumentApp.create() lands in My Drive root; move it into the folder the
    // rest of them live in. A failure here costs filing, not the document.
    DriveApp.getFileById(doc.getId()).moveTo(getOrCreateSignInSheetDocFolder());
  } catch (err) {
    log(`ℹ️ Could not file the new sign-in document into "${SIGN_IN_DOC_FOLDER_NAME}" (${err}) — ` +
      'it is in your Drive root.');
  }
  return doc;
}

function buildSignInSheetTitle(data) {
  const stamp = Utilities.formatDate(data.date, TIMEZONE, 'yyyy-MM-dd');
  return `Sign-In ${stamp} ${data.location}`;
}

/**
 * The block above a table: WHO, WHERE, and TOTAL ORDERED, in that order and at
 * a size somebody reads from standing up.
 *
 * TOTAL ORDERED gets a line of its own. It was previously the sixth clause of a
 * 10pt run-on line beginning with the program names, which is to say it was
 * invisible — and it is the single number anybody picking this sheet up is
 * looking for. It reports the kitchen's total when the lunch dashboard has one
 * (registered plus the buffers, which is what was actually ordered from the
 * caterer) and the registrants' own total when it does not, and it says which.
 */
function writeSignInSheetHeading(body, data, options) {
  options = options || {};
  const heading = body.appendParagraph(
    `${data.location} — ${Utilities.formatDate(data.date, TIMEZONE, 'EEEE, MMMM d, yyyy')}`);
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  heading.editAsText().setFontSize(18).setBold(true).setForegroundColor(PALETTE.INK_STRONG);

  const section = body.appendParagraph(
    `${String(options.section || '').toUpperCase()}  ·  ${options.note || ''}`);
  section.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  section.editAsText().setFontSize(11).setBold(true).setForegroundColor('#444444');

  const total = data.ordering
    ? `TOTAL ORDERED: ${data.ordering.total} meals` +
      `   (${data.ordering.registered} registered + ${data.ordering.standard} standard + ` +
      `${data.ordering.tester} tester)`
    : `TOTAL ORDERED: ${data.lunchCount} meals   (requested by ${data.lunchRows.length} people)`;
  const totalPara = body.appendParagraph(total);
  totalPara.editAsText().setFontSize(14).setBold(true).setForegroundColor(PALETTE.INK_STRONG);

  const bits = [];
  if (data.meal) {
    const dish = data.meal.shorthand || data.meal.description || '';
    bits.push(`Lunch: ${data.meal.type}${dish ? ` — ${dish}` : ''}`);
  } else {
    bits.push('Lunch: none scheduled');
  }
  if (data.programs.length > 0) bits.push(data.programs.join(' · '));
  if (data.noLunchCount > 0) bits.push(`${data.noLunchCount} here without lunch`);
  bits.push(`Questions at the desk: ${CENTER_PHONE}`);
  const sub = body.appendParagraph(bits.join('   |   '));
  sub.editAsText().setFontSize(10).setBold(false).setForegroundColor('#555555');

  // THE KEY TO THE TWO WASHES. A colour nobody can name is a colour nobody
  // trusts, so it is spelled out on both pages rather than once at the front.
  const legend = body.appendParagraph('');
  const legendText = legend.editAsText();
  legendText.appendText('  TAKE-OUT  ');
  legendText.appendText('   the meal leaves the building        ');
  legendText.appendText('  SPECIAL HANDLING  ');
  legendText.appendText('   fridge, freezer, collected by somebody else');
  legendText.setFontSize(9).setBold(false).setForegroundColor('#444444');
  legendText.setBackgroundColor(0, 11, PALETTE.HANDLING_TAKEOUT);
  legendText.setBold(0, 11, true);
  const specialStart = legendText.getText().indexOf('  SPECIAL HANDLING  ');
  if (specialStart !== -1) {
    legendText.setBackgroundColor(specialStart, specialStart + 19, PALETTE.HANDLING_SPECIAL);
    legendText.setBold(specialStart, specialStart + 19, true);
  }
}

/**
 * One table: header row, one row per person, then blank rows for walk-ins.
 *
 * `showZeros` is what separates the two sections. On the LUNCH page every row
 * is eating by construction, so a printed 0 would be noise; on the EVERYONE
 * page a person with no lunch gets a literal 0 in all four meal columns, which
 * is the difference between "ordered nothing" and "nobody has asked yet".
 */
function writeSignInSheetTable(body, rows, options) {
  options = options || {};
  const cells = [SIGN_IN_SHEET_COLUMNS.slice()];
  (rows || []).forEach(row => {
    // A row that is eating gets its ordered count and three empty boxes,
    // because what they actually ate is the thing the desk is there to record.
    // A row that is not gets four printed zeros — but only on the EVERYONE
    // page, since on the lunch page every row is eating by construction.
    const zero = row.lunch ? '' : '0';
    cells.push([
      '', '', row.last, row.first, row.phone, row.program, row.handling, row.notes,
      row.lunch ? String(row.meals) : (options.showZeros ? '0' : ''),
      zero, zero, zero
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
    cell.editAsText().setBold(true).setFontSize(SIGN_IN_SHEET_HEADER_FONT_SIZE);
  }

  // Body rows: big enough to read across a desk, tall enough to write a tick or
  // a digit into by hand. The wash goes on the WHOLE row rather than the
  // Handling cell alone — the point of a colour here is to be seen while
  // scanning a column of surnames, not while already reading the note.
  for (let r = 1; r < table.getNumRows(); r++) {
    const tableRow = table.getRow(r);
    tableRow.setMinimumHeight(SIGN_IN_SHEET_ROW_HEIGHT);
    const source = (rows || [])[r - 1];
    const wash = source ? signInHandlingColor(source.handlingClass) : '';
    for (let c = 0; c < SIGN_IN_SHEET_COLUMNS.length; c++) {
      const cell = tableRow.getCell(c);
      if (wash) cell.setBackgroundColor(wash);
      cell.editAsText().setFontSize(SIGN_IN_SHEET_BODY_FONT_SIZE).setBold(false);
    }
  }
}

/** Find-or-create the Drive folder the live sign-in documents are filed in. */
function getOrCreateSignInSheetDocFolder() {
  const folders = DriveApp.getFoldersByName(SIGN_IN_DOC_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(SIGN_IN_DOC_FOLDER_NAME);
  log(`Created Drive folder "${SIGN_IN_DOC_FOLDER_NAME}" for the live sign-in sheets.`);
  return folder;
}

/**
 * Find-or-create the folder the PDFs this used to export were filed in.
 *
 * Nothing writes here any more. backfillSignInSheetRegistry() still reads it,
 * because a workbook that printed sheets before this was rewritten has a year
 * of them in there and those links are worth keeping. It is find-OR-CREATE
 * rather than find-or-give-up so the backfill has one less way to throw on a
 * workbook that never printed a single PDF.
 */
function getOrCreateSignInSheetFolder() {
  const folders = DriveApp.getFoldersByName(SIGN_IN_SHEET_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(SIGN_IN_SHEET_FOLDER_NAME);
}
