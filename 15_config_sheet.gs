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

/** The rightmost column any Config section occupies. */
function configLastColumn() {
  return Math.max(...Object.values(CONFIG_LAYOUT).map(s => s.startCol + s.headers.length - 1));
}

function writeConfigStructure(sheet) {
  // BEFORE anything is written: a section past the grid's edge is not a
  // cosmetic problem, it is a throw. Every Config tab built before the Admin
  // Notification Emails table ends at column 25, a new sheet has 26, and the
  // table wants 27-32 — so the room is asked for first, on every rebuild,
  // rather than the whole tab failing to draw on the one that needs it.
  ensureSheetColumns(sheet, configLastColumn());

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
  autosizeColumns(sheet, { force: true, minCols: configLastColumn() });

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

  // Same two-value dropdown, same reason: "paused", "off" and "hold" are not
  // the same thing to isOutboundMailPaused(), and none of them stops anything.
  applyValueListValidationBounded(sheet, CONFIG_LAYOUT.OUTBOUND_MAIL.startCol,
    OUTBOUND_MAIL_PAUSE_OPTIONS, CONFIG_DATA_START_ROW, 1);

  // Who is copied on what: a tick box per category, bounded to the rows the
  // table actually has, so the columns below it stay clean.
  const adminSection = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
  ADMIN_NOTIFICATION_CATEGORIES.forEach(category =>
    applyCheckboxValidationBounded(sheet, adminSection.startCol + category.offset,
      CONFIG_DATA_START_ROW, ADMIN_NOTIFICATION_MAX_ROWS));

  seedMealBufferRows(sheet);
  seedOrderAheadRow(sheet);
  seedAdminNotificationEmailsTable(sheet);
  // After the seed, so the notes above are on the cells the carried-across
  // addresses land in, and before anything reads them back.
  migrateLegacyAdminNotificationColumns(sheet);
  seedCateringPolicyRows(sheet);
  seedLinkDisplayRow(sheet);
  seedAutomationRow(sheet);
  seedCalendarInviteRow(sheet);
  seedRegistrationHorizonRow(sheet);
  seedMembershipFormRow(sheet);
  seedOutboundMailRow(sheet);
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
 * Annotates the Admin Notification Emails table and leaves every row BLANK on
 * purpose — an address nobody typed is an address nobody asked to hear from,
 * and guessing one (the current user's, say) would start mailing someone who
 * never asked for it. The notes are rewritten on every rebuild: they are the
 * whole explanation of what the four ticks do, and a rebuild is exactly when
 * somebody is most likely to be reading them.
 */
function seedAdminNotificationEmailsTable(sheet) {
  const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
  sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, ADMIN_NOTIFICATION_MAX_ROWS, 1).setNote(
    `Up to ${ADMIN_NOTIFICATION_MAX_ROWS} people in the office, one per row, each ticked for what they are `
    + 'copied on. Leave a row blank to skip it; an empty table means this system copies nobody.\n\n'
    + 'Every address here is also made an editor of the program registrant sheets and forms this system '
    + 'shares out of the workbook, ticked or not — that is file access, not mail.\n\n'
    + 'The alerts and reminders below arrive as ONE RECORD A DAY (Program Leaders ▸ Send the Office\u2019s '
    + 'Daily Record Now sends it early), listing everything that went out. Nothing is sent on a day '
    + 'nothing did.');

  const noteByHeader = {
    Sync_Digest: 'The per-sync digest of things needing attention: waitlisted registrants, forms that '
      + 'failed to open, triaged deleted events, a door sign-in that did not complete. Internal — '
      + 'nobody outside the office is on it.',
    Leader_Roster_Alerts: 'Listed in the daily record: every roster-change email a program leader was '
      + 'sent because somebody joined, dropped or changed on their program. One message a day at 5pm, '
      + 'and none at all on a day nothing went out \u2014 this is no longer a BCC on each one as it goes.',
    Registrant_Reminders: 'Listed in the daily record: every reminder emailed to a registrant before a '
      + 'session they signed up for. A busy day is hundreds of those, which is why it is one message a '
      + 'day rather than a BCC on each one.',
    Calendar_Invite_Guest: 'Emailed a digest after each sync that adds or removes calendar guests: '
      + 'every session whose guest list changed, who was invited to it, who came off, and that Google '
      + 'sent each of them the invitation. One message per sync, and nothing at all when a sync changes '
      + 'nothing. This person is NOT put on the events themselves — that is what this used to do, and '
      + 'Admin \u25b8 Repair \u25b8 "Remove Office Guests from Calendar Events" takes them back off the '
      + 'ones they are still on.',
    Appointment_Requests: 'Emailed when a sync files somebody onto the "'
      + SHEET_NAMES.ASSISTANCE_REQUESTS + '" tab: they asked for a personalized-assistance appointment '
      + 'and none of the times offered worked. One email per sync, listing only the new requests, with '
      + 'their phone number and email on it. Nothing is sent when a sync files none.'
  };
  ADMIN_NOTIFICATION_CATEGORIES.forEach(category => {
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + category.offset, ADMIN_NOTIFICATION_MAX_ROWS, 1)
      .setNote(noteByHeader[category.header]);
  });
}

/**
 * What the two retired cells stand for in the table that replaced them, as
 * table rows: [Email, Sync_Digest, Leader_Roster_Alerts, Registrant_Reminders,
 * Calendar_Invite_Guest, Appointment_Requests].
 *
 * The categories each old cell is ticked for are exactly what it used to do,
 * so nothing that was going out stops going out and nothing new starts:
 *   Admin_Notification_Email -> Sync_Digest
 *   Archive_Copy_Email       -> Leader alerts + Registrant reminders +
 *                               Calendar invite guest
 * Appointment_Requests is ticked for NOBODY: it is a category neither old cell
 * ever stood for, and an upgrade must not start mailing somebody something
 * they were never getting. Whoever wants it ticks it.
 *
 * ONE ADDRESS IN BOTH CELLS IS ONE ROW with every old tick on it, never two rows —
 * a duplicate would send the same person the same daily record twice.
 *
 * Shared by the migration that WRITES these rows and by the reader that falls
 * back to them on a workbook nobody has rebuilt yet, so the two cannot come to
 * different conclusions about who used to be copied on what.
 */
function legacyAdminNotificationRowValues(adminEmail, archiveEmail) {
  const admin = String(adminEmail || '').trim();
  const archive = String(archiveEmail || '').trim();
  const sameAddress = !!admin && !!archive && admin.toLowerCase() === archive.toLowerCase();

  const rows = [];
  if (admin) rows.push([admin, true, sameAddress, sameAddress, sameAddress, false]);
  if (archive && !sameAddress) rows.push([archive, false, true, true, true, false]);
  return rows;
}

/** The two retired cells as they stand right now, or ['', ''] if the columns have been cleared. */
function readLegacyAdminNotificationCells(sheet) {
  const stillThere = [RETIRED_ADMIN_NOTIFICATION_COL, RETIRED_ARCHIVE_COPY_COL].filter(old =>
    String(sheet.getRange(1, old.col).getValue() || '').trim() === old.title);
  if (stillThere.length === 0) return { stillThere, adminEmail: '', archiveEmail: '' };
  return {
    stillThere,
    adminEmail: String(sheet.getRange(CONFIG_DATA_START_ROW, RETIRED_ADMIN_NOTIFICATION_COL.col).getValue() || '').trim(),
    archiveEmail: String(sheet.getRange(CONFIG_DATA_START_ROW, RETIRED_ARCHIVE_COPY_COL.col).getValue() || '').trim()
  };
}

/**
 * Carries the two retired single-address cells — Admin_Notification_Email and
 * Archive_Copy_Email — into the table that replaced them, then clears them.
 *
 * WHY IT IS SAFE TO RUN EVERY TIME. It does nothing at all unless the banner
 * above one of those columns still reads what it read when this system wrote
 * it, so a workbook already migrated (or one where somebody has since put
 * something of their own in column 8 or 23) is left alone. And it never writes
 * over a table somebody has already filled in: the carried-across rows land
 * only while every Email cell is still empty.
 *
 * IT IS NOT THE ONLY THING THAT CARRIES THEM, and deliberately so. This runs
 * from buildConfigSheet(), which is an admin menu item somebody has to choose;
 * a workbook can run for months of hourly syncs without one. So the READER
 * falls back to the same two cells until this has run (see
 * getAdminNotificationRows()), and the day somebody does rebuild the tab, the
 * fallback stops being reached because the values are now in the table.
 */
function migrateLegacyAdminNotificationColumns(sheet) {
  const { stillThere, adminEmail, archiveEmail } = readLegacyAdminNotificationCells(sheet);
  if (stillThere.length === 0) return;

  const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
  const tableIsEmpty = sheet
    .getRange(CONFIG_DATA_START_ROW, section.startCol, ADMIN_NOTIFICATION_MAX_ROWS, 1)
    .getValues().every(([cell]) => String(cell || '').trim() === '');

  if (tableIsEmpty) {
    const rows = legacyAdminNotificationRowValues(adminEmail, archiveEmail);
    if (rows.length > 0) {
      sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, rows.length, section.headers.length)
        .setValues(rows);
      log(`Carried ${rows.length} retired Config address(es) into "${section.title}" on "${SHEET_NAMES.CONFIG}".`);
    }
  } else if (adminEmail || archiveEmail) {
    log(`ℹ️ "${section.title}" is already filled in — the retired Admin Notification / Archive Copy `
      + 'cells were cleared without being carried across.');
  }

  // Cleared rather than left sitting there: a stale address under a stale
  // banner reads as a live setting, and once the values are in the table
  // nothing reads these cells again. The format goes with the content —
  // otherwise the banner's colour is left behind as a block of paint over an
  // empty column.
  stillThere.forEach(old => {
    const height = Math.max(sheet.getLastRow(), CONFIG_DATA_START_ROW);
    const range = sheet.getRange(1, old.col, height, 1);
    try { range.breakApart(); } catch (err) { /* the banner may not be merged */ }
    range.clearContent().clearNote().clearDataValidations().clearFormat();
  });
  log(`Retired the "${stillThere.map(o => o.title).join('" and "')}" Config column(s).`);
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

/**
 * Seeds "No" and says, in the note, exactly what pausing does and does not
 * reach — because the one thing a kill switch must never be is ambiguous
 * about its own scope.
 */
function seedOutboundMailRow(sheet) {
  const section = CONFIG_LAYOUT.OUTBOUND_MAIL;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(OUTBOUND_MAIL_PAUSE_OPTIONS[0]); // 'No'
  }
  cell.setNote('Set to "Yes" while you are repairing things, and nothing this workbook sends leaves the '
    + 'office: no roster alerts or day-before digests to program leaders, no reminders to registrants.\n\n'
    + 'Set it back to "No" when you are done. Anything other than "Yes" (including blank) means mail is on.\n\n'
    + 'HELD MESSAGES ARE DROPPED, NOT SAVED UP. That is the point: a rebuild or a re-import that puts rows '
    + 'back can otherwise email a leader about a dozen registrations that never changed. Nothing arrives '
    + 'late when you switch it back on.\n\n'
    + 'It does NOT stop calendar invitations — Google sends those itself when a guest is added to an event. '
    + `Use ${CONFIG_LAYOUT.CALENDAR_INVITES.title} for those.\n\n`
    + 'It does NOT stop the office being told what happened here: the sync digest and error mail still '
    + 'arrive, and they say how many messages were held.');
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
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);

  let rows = registrantRows;
  if (!rows) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
    if (!sheet) return [];
    try {
      rows = getSectionedRows(sheet, headers, 'Event_ID');
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
 * One row of the table — [Email, then a cell per category] — onto `rows`, if
 * it names an address. The one place a table row becomes a row object, so the
 * live table and the retired cells behind it are read to the same shape.
 */
function pushAdminNotificationRow(rows, cells) {
  const email = String(cells[0] || '').trim();
  if (email.indexOf('@') <= 0) return;
  const row = { email };
  ADMIN_NOTIFICATION_CATEGORIES.forEach(category => {
    // A checkbox reads back as a boolean; anything else left in the cell
    // (a stray "yes", a string from a paste) is not a tick.
    row[category.key] = cells[category.offset] === true;
  });
  rows.push(row);
}

/**
 * Config's "📧 Admin Notification Emails" table, read ONCE per execution as
 * [{ email, syncDigest, leaderRosterAlerts, registrantReminders,
 * calendarInviteGuest }] — one entry per row that names an address.
 *
 * A row whose Email cell is blank, or holds something with no "@" in it, is
 * skipped rather than repaired: a half-typed address is not somebody to mail,
 * and a category ticked against nobody is not a category to send.
 *
 * A TABLE THAT IS NOT THERE YET FALLS BACK TO THE TWO RETIRED CELLS. Those
 * columns are only carried across and cleared by buildConfigSheet(), which is
 * an admin menu item somebody has to choose — and between deploying this and
 * choosing it, a workbook runs its hourly syncs as usual. Reading the old
 * cells for as long as they are still there is what keeps the office copied on
 * what it was already copied on, rather than notifications stopping silently
 * on an upgrade nobody thought was a change. Read-only: the cells are carried
 * across for good by the rebuild, never from under a trigger.
 *
 * FAILS TO EMPTY, quietly. No spreadsheet in this context, a Config tab
 * mid-rebuild, a table nobody has filled in — all read as "copy nobody",
 * which is the safe direction and exactly what a blank cell always meant
 * here. A failure must never mail an address nobody could confirm.
 */
function getAdminNotificationRows() {
  if (__adminNotificationRowsCache !== null) return __adminNotificationRowsCache;
  const rows = [];
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (sheet) {
      const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
      // The table's columns only exist once buildConfigSheet() has widened the
      // tab for them (see ensureSheetColumns) — reading past the grid's edge
      // throws, and a workbook that has not been rebuilt yet is precisely the
      // one the fallback below is for.
      if (sheet.getMaxColumns() >= section.startCol + section.headers.length - 1) {
        sheet
          .getRange(CONFIG_DATA_START_ROW, section.startCol, ADMIN_NOTIFICATION_MAX_ROWS, section.headers.length)
          .getValues()
          .forEach(cells => pushAdminNotificationRow(rows, cells));
      }

      if (rows.length === 0) {
        const legacy = readLegacyAdminNotificationCells(sheet);
        legacyAdminNotificationRowValues(legacy.adminEmail, legacy.archiveEmail)
          .forEach(cells => pushAdminNotificationRow(rows, cells));
        if (rows.length > 0) {
          log(`ℹ️ Reading the retired Admin Notification / Archive Copy cells — "${section.title}" `
            + 'is empty. Run Admin ▸ Rebuild Layout to carry them onto the table for good.');
        }
      }
    }
  } catch (err) {
    log(`⚠️ Could not read the Admin Notification Emails table from Config (${err}) — nobody was copied.`);
  }
  __adminNotificationRowsCache = rows;
  return rows;
}

/**
 * The addresses ticked for one category — 'syncDigest', 'leaderRosterAlerts',
 * 'registrantReminders' or 'calendarInviteGuest' (see
 * ADMIN_NOTIFICATION_CATEGORIES). Lowercased and deduped: every caller either
 * mails them or compares them against a guest list, and both want one entry
 * per person. An empty array means copy nobody, which is what an untouched
 * table, an unreadable one, and a category nobody ticked all come back as.
 */
function adminEmailsForCategory(categoryKey) {
  return dedupePreservingOrder(getAdminNotificationRows()
    .filter(row => row[categoryKey])
    .map(row => row.email.toLowerCase()));
}

/**
 * Every address in the table, ticked or not. For the one thing that is not
 * mail: editor access on the registrant sheets and forms this system shares out of
 * the workbook — see ADMIN_NOTIFICATION_CATEGORIES for why that is not a
 * category of its own.
 */
function getAllAdminNotificationEmails() {
  return dedupePreservingOrder(getAdminNotificationRows().map(row => row.email.toLowerCase()));
}

/**
 * The membership application's form id, or '' when the cell is blank, holds
 * something that is not an id, or cannot be read at all.
 *
 * '' is a complete answer everywhere it is used: the door simply does not
 * offer the application. Reading fails the same way for the same reason
 * getAdminNotificationRows() does — a Config tab mid-rebuild must not be able
 * to point the door at a form nobody chose.
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
 * Is mail to people OUTSIDE the office held right now?
 *
 * Read by sendRationedEmail() and nowhere else, so there is exactly one place
 * this can be got wrong — see the banner over OUTBOUND_MAIL_PAUSE_OPTIONS for
 * what it does and does not cover. Cached the same two ways the automation
 * flag is: a sync asks once per message, and a spreadsheet read apiece would
 * cost more than the mail does.
 *
 * Only the literal "Yes" pauses. See DEFAULT_OUTBOUND_MAIL_PAUSED for why this
 * fails open.
 */
function isOutboundMailPaused() {
  if (__outboundMailPausedCache !== null) return __outboundMailPausedCache;

  const cache = tryGetScriptCache();
  if (cache) {
    try {
      const cached = cache.get(OUTBOUND_MAIL_PAUSE_CACHE_KEY);
      if (cached === 'yes' || cached === 'no') {
        __outboundMailPausedCache = cached === 'yes';
        return __outboundMailPausedCache;
      }
    } catch (err) { /* cache is an optimization; never let it decide anything */ }
  }

  let raw = '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (sheet) {
      raw = String(sheet.getRange(CONFIG_DATA_START_ROW,
        CONFIG_LAYOUT.OUTBOUND_MAIL.startCol).getValue() || '').trim();
    }
  } catch (err) {
    log(`\u26a0\ufe0f Could not read the ${CONFIG_LAYOUT.OUTBOUND_MAIL.title} section of Config (${err}) \u2014 mail is not paused.`);
  }

  const paused = raw === '' ? DEFAULT_OUTBOUND_MAIL_PAUSED : raw.toLowerCase() === 'yes';
  if (cache) {
    try { cache.put(OUTBOUND_MAIL_PAUSE_CACHE_KEY, paused ? 'yes' : 'no', OUTBOUND_MAIL_PAUSE_CACHE_SECONDS); } catch (err) { /* non-fatal */ }
  }
  __outboundMailPausedCache = paused;
  return paused;
}

function clearOutboundMailPauseCache() {
  const cache = tryGetScriptCache();
  if (!cache) return;
  try { cache.remove(OUTBOUND_MAIL_PAUSE_CACHE_KEY); } catch (err) { /* non-fatal */ }
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
 * Sends one admin email to everyone ticked for Sync_Digest on Config's Admin
 * Notification Emails table, if anybody is. Never throws — a failed
 * notification must not take down the sync that triggered it.
 *
 * ONE MESSAGE, however many people are on it: the recipients go out as a
 * single comma-separated list, so a table with four names spends one message
 * rather than four. They see each other, which is right for an internal
 * digest — this is office mail about the workbook, not a member's own
 * registration (contrast the BCC in sendRationedEmail()).
 *
 * DELIBERATELY NOT RATIONED. Every other send in this workbook goes through
 * sendRationedEmail() (section 9f) and stops short of a floor; this one is the
 * floor's reason for existing. It is one message saying something went wrong —
 * quite possibly that mail is over quota — and holding back the message that
 * reports the shortage is exactly backwards. It is small and it is rare; the
 * rationed callers leave room for it.
 */
function notifyAdmin(subject, body) {
  const emails = adminEmailsForCategory('syncDigest');
  if (emails.length === 0) return false;
  const to = emails.join(',');
  try {
    MailApp.sendEmail(to, subject, body);
    log(`Sent admin notification to ${emails.join(', ')}: ${subject}`);
    return true;
  } catch (err) {
    log(`⚠️ Could not send admin notification to "${emails.join(', ')}" (${err}).`);
    return false;
  }
}

/**
 * An email to the addresses ticked for ONE category, rather than to the sync
 * digest's readers.
 *
 * notifyAdmin() above is 'syncDigest' and always will be — it is the digest's
 * own sender. This is the same plumbing for a category that is not a fault
 * report and should not wait for one: a category nobody has ticked sends
 * nothing at all, which is what an empty table has always meant here.
 *
 * Deliberately NOT through sendRationedEmail() (76), for the reason its banner
 * gives about notifyAdmin(): these are a handful of internal addresses, and a
 * quota floor that silently drops one of them is worse than the send failing
 * loudly.
 */
function notifyAdminCategory(categoryKey, subject, body) {
  const emails = adminEmailsForCategory(categoryKey);
  if (emails.length === 0) return false;
  const to = emails.join(',');
  try {
    MailApp.sendEmail(to, subject, body);
    log(`Sent ${categoryKey} notification to ${emails.join(', ')}: ${subject}`);
    return true;
  } catch (err) {
    log(`⚠️ Could not send ${categoryKey} notification to "${emails.join(', ')}" (${err}).`);
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


