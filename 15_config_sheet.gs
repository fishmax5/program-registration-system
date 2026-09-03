// ============================================================================
// 2b. CONFIG SHEET (Meal Buffers, Order Ahead, Catering Policy, Automation — see CONFIG_LAYOUT above)
// ============================================================================

function buildConfigSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const isCurrentLayout = sheet && sheet.getRange(1, 1).getValue() === CONFIG_LAYOUT.MEAL_BUFFERS.title;

  if (sheet && !isCurrentLayout && sheet.getLastRow() > 0) {
    const backupName = `Config_OLD_${Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss')}`;
    sheet.setName(backupName);
    log(`⚠️ Existing Config tab used an older layout — renamed to "${backupName}". ` +
      `Lunch Menu rows now belong on the "${SHEET_NAMES.LUNCH_SCHEDULE}" tab (by date AND location), ` +
      `and Form Footer Notes are hardcoded in FORM_FOOTER_BY_LOCATION — please migrate anything you still need.`);
    sheet = null;
  }
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.CONFIG);

  writeConfigStructure(sheet);
  styleConfigSheet(sheet);
  return sheet;
}

function writeConfigStructure(sheet) {
  Object.values(CONFIG_LAYOUT).forEach(section => {
    const span = section.headers.length;
    // Config's banners DO stay merged: unlike every other tab's, these sit
    // side by side across the row (one per settings block, each spanning only
    // its own columns), so the merge is what visually bounds each block — and
    // Config never freezes columns, so there is nothing for it to conflict
    // with. Left-aligned and on the shared scale, to match the other tabs.
    const bannerRange = sheet.getRange(1, section.startCol, 1, span);
    try { bannerRange.breakApart(); } catch (err) { /* not previously merged */ }
    bannerRange.merge()
      .setValue(section.title)
      .setFontSize(TYPO.BANNER.size)
      .setFontWeight(TYPO.BANNER.weight)
      .setFontColor(TYPO.BANNER.color)
      .setBackground(TYPO.BANNER.background)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    sheet.getRange(CONFIG_HEADER_ROW, section.startCol, 1, span)
      .setValues([section.headers])
      .setFontSize(TYPO.COLUMN_HEADER.size)
      .setFontWeight(TYPO.COLUMN_HEADER.weight)
      .setBackground(TYPO.COLUMN_HEADER.background)
      .setFontColor(TYPO.COLUMN_HEADER.color);
  });
  freezeRowsSafely(sheet, CONFIG_HEADER_ROW);
}

function styleConfigSheet(sheet) {
  applyZebraStripingBanding(sheet, CONFIG_DATA_START_ROW);
  const lastSectionEndCol = Math.max(...Object.values(CONFIG_LAYOUT).map(s => s.startCol + s.headers.length - 1));
  autosizeColumns(sheet, { force: true, minCols: lastSectionEndCol });

  const bufferSection = CONFIG_LAYOUT.MEAL_BUFFERS;
  const validationRows = MEAL_BUFFER_LOCATIONS.length * CATERED_LUNCH_TYPES.length; // exactly the fixed Location x Hot/Cold combos

  applyValueListValidationBounded(sheet, bufferSection.startCol, MEAL_BUFFER_LOCATIONS, CONFIG_DATA_START_ROW, validationRows);
  applyValueListValidationBounded(sheet, bufferSection.startCol + 1, CATERED_LUNCH_TYPES, CONFIG_DATA_START_ROW, validationRows);

  // One policy row per location, so the dropdowns are bounded the same way.
  const policySection = CONFIG_LAYOUT.CATERING_POLICY;
  const policyRows = Math.max(Object.keys(CALENDAR_MAP).length, 1);
  applyValueListValidationBounded(sheet, policySection.startCol, Object.values(CALENDAR_MAP), CONFIG_DATA_START_ROW, policyRows);
  applyValueListValidationBounded(sheet, policySection.startCol + 1, CATERING_POLICY_OPTIONS, CONFIG_DATA_START_ROW, policyRows);

  applyValueListValidationBounded(sheet, CONFIG_LAYOUT.LINK_DISPLAY.startCol,
    LINK_DISPLAY_OPTION_LIST, CONFIG_DATA_START_ROW, 1);
  applyValueListValidationBounded(sheet, CONFIG_LAYOUT.CALENDAR_INVITES.startCol,
    CALENDAR_INVITE_OPTION_LIST, CONFIG_DATA_START_ROW, 1);

  // Automation_Enabled is a two-value dropdown so the kill switch can never
  // be half-set by a typo — "no", "NO", "nope" and "off" are not the same
  // thing to isAutomationEnabled(), and only one of them stops anything.
  const automationSection = CONFIG_LAYOUT.AUTOMATION;
  applyValueListValidationBounded(sheet, automationSection.startCol, AUTOMATION_ENABLED_OPTIONS, CONFIG_DATA_START_ROW, 1);

  seedMealBufferRows(sheet);
  seedOrderAheadRow(sheet);
  seedAdminNotificationRow(sheet);
  seedArchiveCopyRow(sheet);
  seedCateringPolicyRows(sheet);
  seedLinkDisplayRow(sheet);
  seedAutomationRow(sheet);
  seedCalendarInviteRow(sheet);
  seedRegistrationHorizonRow(sheet);
  seedMembershipFormRow(sheet);
  invalidateConfigCaches(); // the seeds above may have just written cells the caches were built from
}

/** Pre-fills the fixed Location x Hot/Cold combinations if they aren't already present. Never overwrites an existing combo's row. */
function seedMealBufferRows(sheet) {
  const section = CONFIG_LAYOUT.MEAL_BUFFERS;
  // Scanned across the sheet's full current height so an existing combo
  // sitting past this section's own data (because some OTHER section is
  // currently taller) is still found — see the startRow comment below for
  // why that same wide scan must NOT be used to decide where to append.
  const sheetLastRow = sheet.getLastRow();
  const existingCombos = new Set();
  if (sheetLastRow >= CONFIG_DATA_START_ROW) {
    const existing = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, sheetLastRow - CONFIG_DATA_START_ROW + 1, 2).getValues();
    existing.forEach(([loc, type]) => { if (loc && type) existingCombos.add(`${loc}|${type}`); });
  }

  const rowsToAdd = [];
  MEAL_BUFFER_LOCATIONS.forEach(loc => {
    CATERED_LUNCH_TYPES.forEach(type => {
      if (!existingCombos.has(`${loc}|${type}`)) {
        rowsToAdd.push([loc, type, DEFAULT_MEAL_BUFFERS.standardBufferAmount, DEFAULT_MEAL_BUFFERS.testerBufferAmount]);
      }
    });
  });
  if (rowsToAdd.length === 0) return;

  // Deliberately NOT sheet.getLastRow(): that's the tallest column on the
  // WHOLE sheet, not this section's own. Once any other Config section is
  // taller than this one, appending at sheetLastRow + 1 pushes these rows
  // down into that other section's column range instead of stacking under
  // this section's own existing rows. existingCombos.size IS this section's
  // own row count (it counts real Location+Type rows already present), so
  // it's what "the next empty row in THIS column" actually means.
  const startRow = CONFIG_DATA_START_ROW + existingCombos.size;
  sheet.getRange(startRow, section.startCol, rowsToAdd.length, section.headers.length).setValues(rowsToAdd);
  log(`Seeded ${rowsToAdd.length} Meal Buffer Amounts row(s) on "${SHEET_NAMES.CONFIG}".`);
}

function seedOrderAheadRow(sheet) {
  const section = CONFIG_LAYOUT.ORDER_AHEAD;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (cell.getValue() === '') {
    cell.setValue(DEFAULT_ORDER_AHEAD_DAYS);
    log(`Seeded default Order Ahead Time (${DEFAULT_ORDER_AHEAD_DAYS} days) on "${SHEET_NAMES.CONFIG}".`);
  }
}

/**
 * Writes one policy row per CALENDAR_MAP location, seeded from
 * DEFAULT_CATERING_POLICY_BY_LOCATION. Never overwrites a location that
 * already has a row — this is a setting staff own once it exists.
 */
function seedCateringPolicyRows(sheet) {
  const section = CONFIG_LAYOUT.CATERING_POLICY;
  const sheetLastRow = sheet.getLastRow(); // see seedMealBufferRows() for why this is scan-only, never append-math
  const existing = new Set();
  if (sheetLastRow >= CONFIG_DATA_START_ROW) {
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, sheetLastRow - CONFIG_DATA_START_ROW + 1, 1)
      .getValues()
      .forEach(([loc]) => { const v = String(loc || '').trim(); if (v) existing.add(v); });
  }

  const rowsToAdd = Object.values(CALENDAR_MAP)
    .filter(loc => !existing.has(loc))
    .map(loc => [loc, DEFAULT_CATERING_POLICY_BY_LOCATION[loc] || FALLBACK_CATERING_POLICY]);
  if (rowsToAdd.length === 0) return;

  // existing.size IS this section's own row count so far — NOT
  // sheet.getLastRow(), which by the time this runs (fourth of four Config
  // seeds) reflects whichever section is tallest and would append these
  // rows into that section's row range instead of this one's. This is what
  // put "Lunch Service by Location" at rows 7-9 instead of 3-5 the first
  // time this ran, once Meal Buffer Amounts had already filled rows 3-6.
  const startRow = CONFIG_DATA_START_ROW + existing.size;
  sheet.getRange(startRow, section.startCol, rowsToAdd.length, section.headers.length).setValues(rowsToAdd);
  sheet.getRange(startRow, section.startCol + 1, rowsToAdd.length, 1).setNote(
    'Always = lunch unless a date is marked Not Serving.\n'
    + 'By exception = only dates with a Hot/Cold row on Lunch_Schedule.\n'
    + 'Never = no lunch at all; hidden from the lunch dashboard and not asked about on forms.');
  log(`Seeded ${rowsToAdd.length} Lunch Service by Location row(s) on "${SHEET_NAMES.CONFIG}".`);
}

/**
 * Leaves the admin email BLANK on purpose — an empty cell means "don't
 * send anything," and guessing an address (the current user's, say) would
 * start mailing someone who never asked for it. Just annotates the cell so
 * it's obvious what goes there.
 */
function seedAdminNotificationRow(sheet) {
  const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setNote('Optional. One address to receive a per-sync digest of items needing attention '
      + '(waitlisted registrants, forms that failed to open, triaged deleted events). Leave blank to disable.');
  }
}

/**
 * Seeds the archive copy address — the one seeded default in this section,
 * because "copy the office on what we send out" is the answer the office
 * asked for and an empty cell would quietly copy nobody. Only ever written
 * into an EMPTY cell: a workbook whose staff cleared it, or pointed it
 * somewhere else, is left exactly as they left it.
 */
function seedArchiveCopyRow(sheet) {
  const section = CONFIG_LAYOUT.ARCHIVE_COPY;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(DEFAULT_ARCHIVE_COPY_EMAIL);
    log(`Seeded default Archive Copy Address ("${DEFAULT_ARCHIVE_COPY_EMAIL}") on "${SHEET_NAMES.CONFIG}".`);
  }
  cell.setNote('One address copied on everything this system sends outside the organization:\n'
    + '  • BCC on every program leader roster-change email.\n'
    + '  • Added as a guest on any calendar event registrants are invited to.\n'
    + '  • Added as an editor of every program leader sheet and form this system shares.\n\n'
    + 'Leave blank to copy nobody. This is not the same as the Admin Notification address, '
    + 'which receives the internal per-sync digest and nothing else.');
}

/**
 * Seeds the membership application's form id, and says in the cell note what
 * the cell is for and what an empty one means. Only ever written into an EMPTY
 * cell — a workbook pointed at a different application, or deliberately
 * cleared so the door stops offering one, is left as staff left it.
 */
function seedMembershipFormRow(sheet) {
  const section = CONFIG_LAYOUT.MEMBERSHIP_FORM;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(DEFAULT_MEMBERSHIP_FORM_ID);
    log(`Seeded the default Membership Application form id on "${SHEET_NAMES.CONFIG}".`);
  }
  cell.setNote('The Google Form the door app shows to somebody who says they are not a member yet.\n\n'
    + 'Paste either the form id or its whole edit URL. The door reads the form\'s questions LIVE, '
    + 'so editing the form is how the door\'s membership screen changes — no code change is needed.\n\n'
    + 'Leave blank to stop offering the application at the door; a walk-in who is not a member is then '
    + 'recorded for the office to follow up, and nothing else happens.\n\n'
    + 'The account this script runs as must have EDIT access to the form, which is what the Forms API '
    + 'requires to open it. Without that the door shows a plain message and a link to the form itself.');
}

/** Seeds "Show link" and explains the trade-off in the cell note. */
function seedLinkDisplayRow(sheet) {
  const section = CONFIG_LAYOUT.LINK_DISPLAY;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(DEFAULT_LINK_DISPLAY);
    log(`Seeded default Registration Link display ("${DEFAULT_LINK_DISPLAY}") on "${SHEET_NAMES.CONFIG}".`);
  }
  cell.setNote(
    'Show link = every upcoming event description carries a "📝 Register for ..." link at the top.\n'
    + 'Hide link = no registration link in event descriptions at all.\n\n'
    + 'Changing this does not rewrite existing events on its own — run '
    + '"🔗 Rewrite Event Links" from the Admin menu to apply it to what is already out there.');
}

/**
 * Seeds "Invite registrants" and explains, in the cell note, exactly what
 * turning it on causes Google to send.
 */
function seedCalendarInviteRow(sheet) {
  const section = CONFIG_LAYOUT.CALENDAR_INVITES;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(DEFAULT_CALENDAR_INVITE);
    log(`Seeded default Calendar Invitations setting ("${DEFAULT_CALENDAR_INVITE}") on "${SHEET_NAMES.CONFIG}".`);
  }
  cell.setNote(
    'Invite registrants = anyone who gives an email address on a registration form is added as a GUEST '
    + 'to that session\'s Google Calendar event, so it appears in their own calendar with Google\'s reminders.\n\n'
    + 'Google emails an invitation when someone is added and a cancellation when they are removed — this '
    + 'setting sends real mail to real people. Only UPCOMING sessions are ever touched, and someone whose '
    + 'registration is cancelled is taken back off the guest list.\n\n'
    + 'Do not invite = the calendar events are left exactly as they are.');
}

/**
 * Leaves the horizon BLANK on purpose — blank means "no horizon", which is
 * how every workbook behaved before this setting existed. Seeding a date here
 * would silently take sessions out of registration on a workbook whose owner
 * never asked for a horizon at all.
 *
 * Only the number format and the note are written, and both every time: the
 * note is the whole explanation of what the cell does, and a Config rebuild
 * is exactly when somebody is most likely to be reading it.
 */
function seedRegistrationHorizonRow(sheet) {
  const section = CONFIG_LAYOUT.REGISTRATION_HORIZON;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  cell.setNumberFormat(DATE_DISPLAY_FORMAT);
  cell.setNote(
    'Registration is open through this date. Leave BLANK to open everything (the default).\n\n'
    + 'Sessions on or before this date behave normally. Sessions AFTER it are not open yet:\n'
    + '  \u2022 their calendar events say "' + REGISTRATION_NOT_OPEN_LINE + '" instead of carrying a register link;\n'
    + '  \u2022 a form whose remaining sessions are all past this date stops accepting responses, and '
    + 'anyone opening its link is told registration is not yet open.\n\n'
    + 'Nothing is deleted and nothing is permanent — the rows, forms and events are all still built ahead '
    + 'of time. Move this date forward (or clear it) and the next sync puts the links back and re-opens '
    + 'the forms. Use "\ud83d\udd17 Rewrite Event Links" from the Admin menu to apply a change to existing '
    + 'events straight away.');
}

/**
 * The current Calendar Invitations setting. Unlike the link switch this fails
 * CLOSED on anything unrecognized: the cost of wrongly not inviting is that
 * someone has to check the workbook, and the cost of wrongly inviting is mail
 * sent to members on the strength of a typo.
 */
function getCalendarInviteMode() {
  if (__calendarInviteModeCache !== null) return __calendarInviteModeCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let mode = DEFAULT_CALENDAR_INVITE;
  if (sheet) {
    const raw = String(sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.CALENDAR_INVITES.startCol).getValue() || '').trim();
    if (raw) {
      const match = CALENDAR_INVITE_OPTION_LIST.filter(o => o.toLowerCase() === raw.toLowerCase())[0];
      mode = match || CALENDAR_INVITE_OPTIONS.NONE;
      if (!match) {
        log(`⚠️ Config's Invite_Registrants reads "${raw}", which isn't one of ` +
          `${CALENDAR_INVITE_OPTION_LIST.join(' / ')} — not inviting anyone until that is fixed.`);
      }
    }
  }
  __calendarInviteModeCache = mode;
  return mode;
}

/** True when registrants should be added to their session's calendar event as guests. */
function shouldInviteRegistrants() {
  return getCalendarInviteMode() === CALENDAR_INVITE_OPTIONS.INVITE;
}

/**
 * The current Registration Link setting. Anything unrecognized reads as
 * "Show link": a typo in this cell must not silently strip the registration
 * link off every event in the calendar.
 */
function getLinkDisplayMode() {
  if (__linkDisplayCache !== null) return __linkDisplayCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let mode = DEFAULT_LINK_DISPLAY;
  if (sheet) {
    const raw = String(sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.LINK_DISPLAY.startCol).getValue() || '').trim();
    const match = LINK_DISPLAY_OPTION_LIST.filter(o => o.toLowerCase() === raw.toLowerCase())[0];
    if (match) mode = match;
    else if (raw) log(`⚠️ Config's Link_Display reads "${raw}", which isn't one of ${LINK_DISPLAY_OPTION_LIST.join(' / ')} — using "${DEFAULT_LINK_DISPLAY}".`);
  }
  __linkDisplayCache = mode;
  return mode;
}

/** True when registration links belong in calendar event descriptions. */
function shouldShowLinkInDescription() {
  return getLinkDisplayMode() !== LINK_DISPLAY_OPTIONS.HIDE;
}

/**
 * The Registration Open Through date as a 'yyyy-MM-dd' key, or '' when there
 * is no horizon at all. See REGISTRATION_NOT_OPEN_TEXT for what it means.
 *
 * FAILS OPEN, loudly: a cell that isn't a date reads as "no horizon" and logs
 * why. One typo must never be able to close every form in the workbook.
 */
function getRegistrationHorizonKey() {
  if (__registrationHorizonCache !== null) return __registrationHorizonCache.key;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let key = '';
  if (sheet) {
    const raw = sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.REGISTRATION_HORIZON.startCol).getValue();
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = coerceRegistrationHorizonDate(raw);
      if (parsed) key = formatDateKey(parsed);
      else {
        log(`⚠️ Config's Registration_Open_Through reads "${raw}", which isn't a usable date — ` +
          'treating it as no horizon, so every session stays open for registration.');
      }
    }
  }
  __registrationHorizonCache = { key };
  return key;
}

/**
 * A cell value read as a horizon date, or null.
 *
 * Stricter than coerceDate() on purpose, because of one specific way of
 * getting this wrong: typing a bare year. A cell formatted as a date that
 * receives `2026` holds the number 2026, which Sheets reads back as day 2026
 * of the epoch — 18 July 1905. That is a perfectly valid Date, it is silently
 * in the past, and a horizon in the past closes EVERY form in the workbook.
 * So a horizon has to land in a plausible century to count as one at all;
 * anything else reads as no horizon, which is the harmless direction.
 */
const REGISTRATION_HORIZON_MIN_YEAR = 2000;
const REGISTRATION_HORIZON_MAX_YEAR = 2100;

function coerceRegistrationHorizonDate(raw) {
  const parsed = coerceDate(raw);
  if (!parsed) return null;
  const year = parsed.getFullYear();
  if (year < REGISTRATION_HORIZON_MIN_YEAR || year > REGISTRATION_HORIZON_MAX_YEAR) return null;
  return parsed;
}

/** True when a horizon is set at all. */
function hasRegistrationHorizon() {
  return getRegistrationHorizonKey() !== '';
}

/** The horizon as a Date (midnight local), or null when there is none. */
function getRegistrationHorizonDate() {
  const key = getRegistrationHorizonKey();
  return key ? parseDateKey(key) : null;
}

/** How the horizon reads in a dialog, a toast or a log line. */
function describeRegistrationHorizon() {
  const date = getRegistrationHorizonDate();
  return date ? formatDateLabel(date) : 'no horizon (every session open)';
}

/**
 * True when this session date sits past the horizon — i.e. registration for
 * it is not open yet. Compared as date KEYS so a session at 6pm on the
 * horizon date is still open: the horizon means the end of that day.
 */
function isBeyondRegistrationHorizon(date) {
  const horizonKey = getRegistrationHorizonKey();
  if (!horizonKey) return false;
  const d = coerceDate(date);
  return !!d && formatDateKey(d) > horizonKey;
}

/**
 * True when this event should carry the "not yet open" notice instead of a
 * registration link.
 *
 * Past sessions are deliberately excluded even when a horizon has been set
 * BEHIND today (a legitimate way to say "nothing is open right now"): a
 * session that has already happened is a record, and rewriting its
 * description to advertise that sign-ups have not opened would be false.
 */
function shouldMarkNotYetOpen(date) {
  const d = coerceDate(date);
  if (!d) return false;
  if (formatDateKey(d) < formatDateKey(new Date())) return false;
  return isBeyondRegistrationHorizon(d);
}

/**
 * Seeds Automation_Enabled to "Yes" and annotates all three cells.
 *
 * NEVER overwrites an existing value — a rebuild of the Config tab must not
 * silently switch automation back on underneath someone who paused it on
 * purpose, which is exactly the moment they are most likely to be running
 * setup functions. Trigger_Owner is likewise left alone; only a successful
 * writeTriggers() writes that (see claimTriggerOwnership()).
 */
function seedAutomationRow(sheet) {
  const section = CONFIG_LAYOUT.AUTOMATION;
  const enabledCell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(enabledCell.getValue() || '').trim() === '') {
    enabledCell.setValue(AUTOMATION_ENABLED_OPTIONS[0]); // 'Yes'
  }
  enabledCell.setNote('Master switch for the calendar sync, registration sync, and calendar-edit handlers. '
    + 'Set to "No" to stop all of them — including triggers created by a DIFFERENT Google account, '
    + 'which is the only way to stop those without opening the Apps Script editor. '
    + 'Anything other than "No" (including blank) means enabled.');

  sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 1).setNote(
    'The one account that holds this project\'s triggers. Written automatically when that account runs '
    + 'Admin → Check Triggers. Other admins are blocked from rebuilding triggers so a second, invisible '
    + 'set can never be created — use Admin → Take Over Trigger Ownership to move it deliberately.');

  sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 2).setNote(
    'When the owner above last rebuilt the triggers.');

  invalidateConfigCaches();
}

/**
 * Looks up the static Standard_Buffer/Tester_Buffer amounts configured for
 * one location + lunch type (Hot/Cold) in Config's "Meal Buffer Amounts"
 * section. Falls back to DEFAULT_MEAL_BUFFERS if no matching row exists
 * (which is always the case for "Not Serving," by design).
 */
function getMealBufferConfigForLocation(locationName, lunchType) {
  const index = getMealBufferIndex();
  const hit = index[`${locationName}|${String(lunchType).trim()}`];
  if (hit) return Object.assign({}, hit);

  log(`No Meal Buffer Amounts row found for "${locationName}" / "${lunchType}" yet — using defaults (Standard: ${DEFAULT_MEAL_BUFFERS.standardBufferAmount}, Tester: ${DEFAULT_MEAL_BUFFERS.testerBufferAmount}).`);
  return Object.assign({}, DEFAULT_MEAL_BUFFERS);
}

/**
 * Reads Config's "Meal Buffer Amounts" section ONCE per execution into
 * { 'Location|Type': {standardBufferAmount, testerBufferAmount} }. Was a
 * full Config read per call, and updateMasterLunchDashboard() calls it once
 * per rollup row.
 */
function getMealBufferIndex() {
  if (__mealBufferIndexCache) return __mealBufferIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (sheet && lastRow >= CONFIG_DATA_START_ROW) {
    const section = CONFIG_LAYOUT.MEAL_BUFFERS;
    const numRows = lastRow - CONFIG_DATA_START_ROW + 1;
    const data = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, numRows, section.headers.length).getValues();
    data.forEach(([loc, type, standardAmt, testerAmt]) => {
      const key = `${String(loc).trim()}|${String(type).trim()}`;
      if (index[key] !== undefined) return; // first matching row wins, as the old top-down scan did
      index[key] = {
        standardBufferAmount: (standardAmt !== '' && !isNaN(standardAmt)) ? Number(standardAmt) : DEFAULT_MEAL_BUFFERS.standardBufferAmount,
        testerBufferAmount: (testerAmt !== '' && !isNaN(testerAmt)) ? Number(testerAmt) : DEFAULT_MEAL_BUFFERS.testerBufferAmount
      };
    });
  }
  __mealBufferIndexCache = index;
  return index;
}

/**
 * Reads Config's "Lunch Service by Location" section ONCE per execution
 * into { Location: policy }. Anything not listed — or listed with an
 * unrecognized value — falls back to FALLBACK_CATERING_POLICY.
 */
function getCateringPolicyIndex() {
  if (__cateringPolicyIndexCache) return __cateringPolicyIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (sheet && lastRow >= CONFIG_DATA_START_ROW) {
    const section = CONFIG_LAYOUT.CATERING_POLICY;
    const numRows = lastRow - CONFIG_DATA_START_ROW + 1;
    const data = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, numRows, section.headers.length).getValues();
    data.forEach(([loc, policy]) => {
      const location = String(loc || '').trim();
      const value = String(policy || '').trim();
      if (!location || index[location] !== undefined) return;
      if (CATERING_POLICY_OPTIONS.indexOf(value) === -1) return;
      index[location] = value;
    });
  }
  __cateringPolicyIndexCache = index;
  return index;
}

/** A location's standing lunch posture — see CATERING_POLICIES. */
function getCateringPolicyForLocation(locationName) {
  const key = String(locationName || '').trim();
  const configured = getCateringPolicyIndex()[key];
  if (configured) return configured;
  return DEFAULT_CATERING_POLICY_BY_LOCATION[key] || FALLBACK_CATERING_POLICY;
}

/**
 * Should this date+location be OFFERED lunch — on the form, and seeded onto
 * the lunch dashboard? Policy sets the default; an explicit Lunch_Schedule
 * row can always override in either direction.
 */
function isLunchOfferedOn(date, locationName) {
  const policy = getCateringPolicyForLocation(locationName);
  if (policy === CATERING_POLICIES.NEVER) return false;

  const meal = getMealInfoForDate(date, locationName);
  if (meal && meal.type === 'Not Serving') return false;
  if (policy === CATERING_POLICIES.BY_EXCEPTION) {
    // Nothing assumed: a real catered menu row has to exist for this date.
    return !!meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1;
  }
  return true; // ALWAYS
}

/**
 * Is lunch RULED OUT for this date+location — as opposed to merely not
 * scheduled yet?
 *
 * The two answers isLunchOfferedOn() collapses into one, separated. It says
 * false both for "the kitchen is closed that day" and for "nobody has typed
 * the menu yet", which is the right question when deciding whether to OFFER
 * lunch on a form — you cannot promise a meal that has not been planned — and
 * the wrong one when deciding whether to RECORD a person's request. A request
 * on a date nobody has got to yet is the demand that makes somebody go and
 * plan it (see buildDashboardRollup()'s "lunch needed with no menu set").
 *
 * Only two things rule it out: a location that serves no food at all, and a
 * day whose menu row reads "Not Serving". Both have an author.
 */
function lunchIsRuledOutOn(date, locationName) {
  if (getCateringPolicyForLocation(locationName) === CATERING_POLICIES.NEVER) return true;
  return isExplicitlyNotServing(date, locationName);
}

/**
 * Is there a Lunch_Schedule row for this date+location that explicitly says
 * "Not Serving"?
 *
 * THE DISTINCTION THIS EXISTS TO DRAW, and it is the whole point of the
 * Not-Serving handling: a date with NO menu row is a GAP — somebody hasn't
 * got to it yet — and a gap must never suppress a lunch a real person is
 * signed up for. A date whose row READS "Not Serving" is a DECISION. It has
 * an author, and the answer to "but three people signed up" is not to quietly
 * cater it anyway; it is to tell somebody those three people need telling.
 *
 * Everywhere the catering pipeline says "demand always wins", it means over a
 * gap. This is what it does not win over.
 *
 * Location-specific on purpose: getMealInfoForDate() with a location matches
 * only that location's row, so Narberth closing its kitchen says nothing
 * about Ashbridge on the same day.
 */
function isExplicitlyNotServing(date, locationName) {
  if (!date || !locationName) return false;
  const meal = getMealInfoForDate(date, locationName);
  return !!meal && String(meal.type || '').trim() === 'Not Serving';
}

/**
 * Everyone still expecting to eat at `location` on `dateKey` — Active
 * registrations with Lunch_Status "Needed". Returns [{name, event}].
 *
 * Reads the registrant rows' own Event_Date/Location rather than joining
 * through Event_ID and the session table, so it works from a plain
 * spreadsheet read and is safe to call from an onEdit (see onEdit()).
 */
function findRegistrantsExpectingLunch(dateKey, location, registrantRows) {
  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);

  let rows = registrantRows;
  if (!rows) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
    if (!sheet) return [];
    try {
      rows = readAllSectionedRows(sheet, headers, 'Event_ID');
    } catch (err) {
      log(`ℹ️ Could not read the registrants tab to check for lunch sign-ups (${err}).`);
      return [];
    }
  }

  const wantedLocation = String(location || '').trim();
  const found = [];
  rows.forEach(row => {
    if (String(row[map['Program_Status']] || '').trim() !== 'Active') return;
    if (String(row[map['Lunch_Status']] || '').trim() !== 'Needed') return;
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) !== dateKey) return;
    if (wantedLocation && String(row[map['Location']] || '').trim() !== wantedLocation) return;
    found.push({
      name: String(row[map['Name']] || '').trim() || '(unnamed)',
      event: String(row[map['Event']] || '').trim()
    });
  });
  return found;
}

/** "Marion Webb, Ada Cole and 3 more" — a name list short enough for a toast. */
function describePeopleList(people, max) {
  const limit = max || 4;
  const names = people.map(p => p.name);
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/**
 * Called the moment a date+location is marked "Not Serving" by hand or by
 * paste. Says, right there, whether anyone was counting on that meal.
 *
 * TOAST ONLY — no email. This runs on the onEdit path, where MailApp is
 * unavailable (see onEdit()); the same finding is raised as a real admin
 * notification by buildDashboardRollup() on the next sync, which is where the
 * durable record belongs. The toast is for the person who just typed it, who
 * is the one who can still ring those people.
 *
 * Past dates are skipped: there is nothing left to act on.
 */
function warnAboutNotServingSignups(pairs, registrantRows) {
  const result = checkNotServingSignups(pairs, registrantRows);
  if (result.total === 0) return 0;

  const first = result.affected[0];
  const more = result.affected.length > 1 ? ` (+${result.affected.length - 1} other date(s))` : '';
  toastIfPossible(
    `⚠️ ${result.total} person(s) had signed up for lunch on a date now marked "Not Serving" — ` +
    `${formatDateLabel(first.date)} at ${first.location}: ${describePeopleList(first.people)}${more}. ` +
    `They will drop off the lunch dashboard; they still need telling.`);
  return result.total;
}

/**
 * The query behind the warning, with no side effects beyond a log line, so
 * callers that report through something other than a toast (the CSV dialog)
 * can use the same answer.
 *
 * Returns { total, affected: [{date, location, people}] }. Past dates are
 * excluded — there is nothing left to act on.
 */
function checkNotServingSignups(pairs, registrantRows) {
  const todayKey = formatDateKey(new Date());
  const affected = [];
  let total = 0;

  (pairs || []).forEach(p => {
    if (!p.date || !p.location) return;
    const dateKey = formatDateKey(p.date);
    if (dateKey < todayKey) return;
    if (!isExplicitlyNotServing(p.date, p.location)) return;
    const people = findRegistrantsExpectingLunch(dateKey, p.location, registrantRows);
    if (people.length === 0) return;
    affected.push({ date: p.date, location: p.location, people });
    total += people.length;
  });

  if (total > 0) {
    log(`Not Serving: ${total} lunch sign-up(s) affected across ${affected.length} date(s).`);
  }
  return { total, affected };
}

function getOrderAheadDays() {
  if (__orderAheadDaysCache !== null) return __orderAheadDaysCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let days = DEFAULT_ORDER_AHEAD_DAYS;
  if (sheet) {
    const section = CONFIG_LAYOUT.ORDER_AHEAD;
    const val = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue();
    const num = Number(val);
    if (val !== '' && !isNaN(num) && num > 0) days = num;
  }
  __orderAheadDaysCache = days;
  return days;
}

/**
 * The address in Config's "📧 Admin Notifications" section, or '' when
 * blank — in which case notifyAdmin() silently does nothing, so leaving it
 * empty is a perfectly valid way to turn notifications off.
 */
function getAdminNotificationEmail() {
  if (__adminNotificationEmailCache !== null) return __adminNotificationEmailCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let email = '';
  if (sheet) {
    const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
    email = String(sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue() || '').trim();
  }
  __adminNotificationEmailCache = email;
  return email;
}

/**
 * The address in Config's "🗄️ Archive Copy Address" section, or '' when
 * blank. Every caller treats '' as "copy nobody", so an empty cell is a
 * perfectly valid way to turn the copies off — and a Config tab that cannot
 * be read at all (no spreadsheet in this context, tab mid-rebuild) reads the
 * same way, which is the safe direction: a failure here must never mail an
 * address nobody could confirm.
 */
function getArchiveCopyEmail() {
  if (__archiveCopyEmailCache !== null) return __archiveCopyEmailCache;
  let email = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (sheet) {
      const section = CONFIG_LAYOUT.ARCHIVE_COPY;
      email = String(sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue() || '').trim();
    }
  } catch (err) {
    log(`\u26a0\ufe0f Could not read the Archive Copy Address from Config (${err}) — nothing was copied.`);
    email = '';
  }
  if (email.indexOf('@') <= 0) email = '';
  __archiveCopyEmailCache = email;
  return email;
}

/**
 * The membership application's form id, or '' when the cell is blank, holds
 * something that is not an id, or cannot be read at all.
 *
 * '' is a complete answer everywhere it is used: the door simply does not
 * offer the application. Reading fails the same way for the same reason
 * getArchiveCopyEmail() does — a Config tab mid-rebuild must not be able to
 * point the door at a form nobody chose.
 */
function getMembershipFormId() {
  if (__membershipFormIdCache !== null) return __membershipFormIdCache;
  let id = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (sheet) {
      const section = CONFIG_LAYOUT.MEMBERSHIP_FORM;
      id = parseFormIdFromConfigValue(
        sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue());
    }
  } catch (err) {
    log(`\u26a0\ufe0f Could not read the Membership Application form id from Config (${err}) — the door will not offer it.`);
    id = '';
  }
  __membershipFormIdCache = id;
  return id;
}

/**
 * Reads one cell of Config's Automation section, or '' if anything at all
 * gets in the way (no spreadsheet in this context, tab missing, tab
 * mid-rebuild). Never throws — every caller here treats '' as "not set",
 * and the whole point of the kill switch is that it cannot be tripped by
 * an unrelated failure.
 */
function readAutomationConfigCell(offset) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (!sheet) return '';
    const section = CONFIG_LAYOUT.AUTOMATION;
    return String(sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + offset).getValue() || '').trim();
  } catch (err) {
    log(`⚠️ Could not read the Automation section of Config (${err}).`);
    return '';
  }
}

/**
 * Is automation allowed to do work right now?
 *
 * Read by every managed handler as its first act, INCLUDING handlers fired
 * by triggers belonging to an account that cannot see this one. That is the
 * entire value: Script-level state is shared even though triggers are not,
 * so this is the only lever that reaches a trigger you have no ability to
 * delete.
 *
 * Cached twice over — once per execution, and once across executions via
 * CacheService (see AUTOMATION_FLAG_CACHE_SECONDS) — so a burst of
 * onCalendarChange firings costs one spreadsheet read between them all
 * rather than one apiece.
 *
 * Only the literal "No" disables. See DEFAULT_AUTOMATION_ENABLED for why
 * this fails open.
 */
function isAutomationEnabled() {
  if (__automationEnabledCache !== null) return __automationEnabledCache;

  const cache = tryGetScriptCache();
  if (cache) {
    try {
      const cached = cache.get(AUTOMATION_FLAG_CACHE_KEY);
      if (cached === 'yes' || cached === 'no') {
        __automationEnabledCache = cached === 'yes';
        return __automationEnabledCache;
      }
    } catch (err) { /* cache is an optimization; never let it decide anything */ }
  }

  const raw = readAutomationConfigCell(0);
  // Anything that isn't a deliberate "No" leaves automation on.
  const enabled = raw === '' ? DEFAULT_AUTOMATION_ENABLED : raw.toLowerCase() !== 'no';
  if (cache) {
    try { cache.put(AUTOMATION_FLAG_CACHE_KEY, enabled ? 'yes' : 'no', AUTOMATION_FLAG_CACHE_SECONDS); } catch (err) { /* non-fatal */ }
  }
  __automationEnabledCache = enabled;
  return enabled;
}

/**
 * CacheService is unavailable in some execution contexts (notably a simple
 * trigger running without authorization), and asking for it there throws.
 * Returns null instead so callers can just skip the cache.
 */
function tryGetScriptCache() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    return null;
  }
}

function clearAutomationFlagCache() {
  const cache = tryGetScriptCache();
  if (!cache) return;
  try { cache.remove(AUTOMATION_FLAG_CACHE_KEY); } catch (err) { /* non-fatal */ }
}

/**
 * The gate itself. Call as the first line of a managed handler and return
 * immediately if it comes back false.
 *
 * `quiet` suppresses the toast for the hot path (onCalendarChange, which can
 * fire hundreds of times while a paused calendar is being edited); the log
 * line is always written, because "why did nothing happen?" has to be
 * answerable afterwards.
 */
function automationGateAllows(actionLabel, quiet) {
  if (isAutomationEnabled()) return true;
  const message = `⏸️ Automation is paused — "${actionLabel}" did nothing. ` +
    `Set Automation_Enabled back to "Yes" on the Config tab (${CONFIG_LAYOUT.AUTOMATION.title}) to resume.`;
  log(message);
  if (!quiet) toastIfPossible(message);
  return false;
}

/**
 * The account recorded in Config as holding this project's triggers, or ''
 * when nobody has claimed them yet (in which case writeTriggers() lets the
 * first admin through and records them).
 */
function getTriggerOwner() {
  if (__triggerOwnerCache !== null) return __triggerOwnerCache;
  __triggerOwnerCache = readAutomationConfigCell(1).toLowerCase();
  return __triggerOwnerCache;
}

/**
 * Is the account running right now the recorded trigger owner?
 *
 * An UNCLAIMED project answers false — deliberately. "Nobody has claimed
 * these" is not permission to create them from whichever account happened to
 * click a menu item; it just means "Check Triggers" hasn't been run yet, and
 * that is the one path allowed to make the first claim.
 */
function isTriggerOwnerAccount() {
  const owner = getTriggerOwner();
  if (!owner) return false;
  const me = getCurrentUserEmail();
  return !!me && me === owner;
}

/** When the recorded owner last rebuilt the triggers — display only, '' if never. */
function getTriggersVerifiedAt() {
  return readAutomationConfigCell(2);
}

/**
 * Records `email` as the trigger owner and stamps the verification time.
 * Called by writeTriggers() after a successful rebuild, so the claim always
 * reflects an account that genuinely holds a live set rather than an
 * intention someone typed in.
 */
function claimTriggerOwnership(email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (!sheet) return;
    const section = CONFIG_LAYOUT.AUTOMATION;
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 1).setValue(email);
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 2)
      .setValue(Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm'));
    __triggerOwnerCache = null;
  } catch (err) {
    // Not fatal: the triggers themselves were built successfully, and a
    // missing claim only costs the next admin a confirmation prompt.
    log(`⚠️ Triggers were rebuilt but the ownership claim could not be written to Config (${err}).`);
  }
}

/**
 * Sends one admin email, if an address is configured. Never throws — a
 * failed notification must not take down the sync that triggered it.
 */
function notifyAdmin(subject, body) {
  const email = getAdminNotificationEmail();
  if (!email) return false;
  try {
    MailApp.sendEmail(email, subject, body);
    log(`Sent admin notification to ${email}: ${subject}`);
    return true;
  } catch (err) {
    log(`⚠️ Could not send admin notification to "${email}" (${err}).`);
    return false;
  }
}

/**
 * Per-run collector for things an admin should hear about. Sections are
 * only included in the digest if something was actually added to them, and
 * NO email is sent at all when the whole thing is empty — a quiet sync
 * stays quiet, which is the only way a notification like this stays worth
 * reading.
 */
let __adminDigest = null;

function noteForAdmin(category, message) {
  if (!__adminDigest) __adminDigest = {};
  if (!__adminDigest[category]) __adminDigest[category] = [];
  __adminDigest[category].push(message);
}

/** Sends the accumulated digest (if any) and resets the collector. */
function flushAdminDigest(context) {
  const digest = __adminDigest;
  __adminDigest = null;
  if (!digest) return false;

  const categories = Object.keys(digest).filter(c => digest[c].length > 0);
  if (categories.length === 0) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [];
  categories.forEach(category => {
    lines.push(`${category} (${digest[category].length}):`);
    digest[category].forEach(m => lines.push(`  • ${m}`));
    lines.push('');
  });
  if (ss) lines.push(`Workbook: ${ss.getUrl()}`);

  const total = categories.reduce((sum, c) => sum + digest[c].length, 0);
  return notifyAdmin(`[Calendar & Form Manager] ${context}: ${total} item(s) need attention`, lines.join('\n'));
}

function computeOrderAheadFlag(eventDate, submittedAt, orderAheadDays) {
  if (!eventDate || !submittedAt || !orderAheadDays) return '';
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysNotice = Math.floor((eventDate - submittedAt) / msPerDay);
  if (daysNotice < 0) return '⚠️ Registered after the event date';
  if (daysNotice < orderAheadDays) return `⚠️ Only ${daysNotice}d notice (need ${orderAheadDays}d)`;
  return '';
}


