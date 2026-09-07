// ============================================================================
// 9h. WHAT A PROGRAM SENDS ITS PEOPLE  (one tick per channel, on Program_Settings)
// ============================================================================
//
// The half of Program_Settings that section 9e reads its answers off, and the
// vocabulary the merge that made that tab had to carry across.
//
// THIS FILE NO LONGER OWNS A TAB. The six columns below used to be a tab of
// their own — Registrant_Notifications, one row per Clean_Title x Location.
// Program_Options was one row per Clean_Title x Location too, refreshed in the
// same pass, from the same session rows, through the same writeMemoryTab().
// They are one tab now (SHEET_NAMES.PROGRAM_SETTINGS, written by
// refreshProgramSettings() in section 6c), and what stayed here is what is
// particular to notifying somebody: which box means which day count, how a row
// resolves into a policy, and the two one-time carry-overs below.
//
// WHY THE DROPDOWN HAD TO GO. Notify_Mode was one cell answering "how does
// this program talk to its people?" with one of five phrases, and every phrase
// bundled decisions that are not actually bundled. "Calendar invite +
// reminders" could not say WHICH reminders without a second cell, and neither
// cell could say "put them on the calendar, write to them a week out, write
// again the morning of, and nothing in between" — which is the ordinary shape
// of a class that fills up. The channels are independent, so they are asked
// independently: FOUR TICK BOXES AND A LIST, none of them exclusive.
//
//   Add_Guest_To_Calendar  the registrant joins the real event's GUEST LIST.
//                       Not whether the event is on the calendar — it always is.
//   Week_Before         an email 7 days out.
//   Day_Before          an email 1 day out.
//   Morning_Of          an email on the day.
//   Other_Reminders     any other day counts, "14, 3". ADDS to the boxes.
//   Confirm_On_Booking  a confirmation the moment somebody registers, and the
//                       only place an appointment's own time can be stated.
//
// THE GRAIN IS THE PROGRAM, NOT THE DATE — one row per Clean_Title x Location,
// standing for every session that program ever runs, and the same key section
// 9e matches a session on. It is also why the merge above was possible at all:
// two tabs at one grain answering one question about one program.
// Nobody decides per-date whether a class reminds its people; a tab with one
// row per date would be a hundred rows asking the same question a hundred
// times, and ninety-nine chances for two of them to disagree.
//
// AN UNTICKED BOX MEANS OFF, WHICH IS ONLY HONEST IF NOTHING ARRIVES UNTICKED
// BY ACCIDENT. A blank row would otherwise be indistinguishable from a program
// somebody deliberately silenced, and the first sync after this shipped would
// have silenced every program in the workbook. So a row is never born blank:
// seedNotificationHalf() (section 6c) fills a new one from the first source
// that has anything to say — the retired notifications tab's own ticks, then
// the retired Notify_Mode cells, then defaultNotificationPolicy(), how a
// program of that KIND is notified. From then on the boxes are the truth and
// nothing but the boxes.
//
// THE MERGE IS THE SAME RULE WEARING A DIFFERENT HAT. On the first sync after
// the two tabs became one, every row on the merged tab is an old
// Program_Options row — real, and with no tick columns on it. Carrying those
// blanks forward as decisions would silence the workbook exactly as a blank
// new row would, so the merge is a source in that list rather than a reason to
// skip it. See the reads at the top of refreshProgramSettings().
//
// THE CONFIG SWITCH STILL WINS, as it did before: "📧 Calendar Invitations"
// set to "Do not invite" means nobody joins a guest list whatever a row says.
// This tab decides which programs opt IN to a channel, never that a channel
// switched off for the whole workbook is on after all.
// ============================================================================

/** Which tick box means which day count. The order is the order they send in. */
const NOTIFICATION_REMINDER_BOXES = [
  { column: 'Week_Before', days: 7 },
  { column: 'Day_Before', days: 1 },
  { column: 'Morning_Of', days: 0 }
];

/** Every tick box on the tab, the calendar one included. */
const NOTIFICATION_CHECKBOX_COLUMNS = ['Add_Guest_To_Calendar', 'Week_Before', 'Day_Before',
  'Morning_Of', 'Confirm_On_Booking'];

/** Suggestions for Other_Reminders. An open list: any day count is legal. */
const OTHER_REMINDER_SUGGESTIONS = ['14', '3', '2', '14, 3', '21, 14, 7'];

/**
 * The five phrases Program_Options' retired Notify_Mode column could hold, and
 * the two column names the values are carried off. Kept here rather than in
 * 9e because they are now migration vocabulary and nothing else: no live code
 * path writes or reads a mode.
 */
const LEGACY_NOTIFY_MODES = {
  DEFAULT: 'Default for type',
  INVITE_ONLY: 'Calendar invite only',
  INVITE_AND_REMIND: 'Calendar invite + reminders',
  REMIND_ONLY: 'Reminder emails only',
  NONE: 'Do not notify'
};
const LEGACY_NOTIFY_MODE_COLUMN = 'Notify_Mode';
const LEGACY_REMINDER_DAYS_COLUMN = 'Reminder_Days';

/**
 * The columns the retired Registrant_Notifications tab let people fill in —
 * the ones the merge has to lift off it.
 *
 * Spelled out here rather than reused from PROGRAM_SETTINGS_STAFF_COLUMNS,
 * which is a longer list now: taking Room_Or_Setup or Typical_Attendance off
 * a tab that never had them would be reading a column that isn't there, and
 * taking them off a tab that somehow does would overwrite the merged row's own
 * copy with an older one.
 */
const LEGACY_REGISTRANT_NOTIFICATION_COLUMNS = ['Add_To_Calendar', 'Week_Before', 'Day_Before',
  'Morning_Of', 'Other_Reminders', 'Confirm_On_Booking', 'Staff_Notes'];

/**
 * Where a retired tab's column name lands on the merged tab.
 *
 * One entry, and it is the guest-list tick: Add_To_Calendar said something it
 * did not mean (see LEGACY_HEADER_ALIASES) and is Add_Guest_To_Calendar now.
 * The retired tab still holds the old spelling — nothing rewrites a tab that
 * has been left in place on purpose — so the read translates it.
 */
const LEGACY_NOTIFICATION_COLUMN_RENAMES = { Add_To_Calendar: 'Add_Guest_To_Calendar' };

/**
 * Has the one-time carry-over off the retired Notify_Mode / Reminder_Days
 * cells already run?
 *
 * Marked done the moment the tab is written, not before: the alternative is
 * re-reading a tab that no longer has the columns, on every sync, forever.
 * The same reasoning as migrateProgramLeaderAddresses() (section 9c), and the
 * same hazard it guards — HEADERS.Program_Settings does not list either
 * column, so the next refresh of that tab is the write that destroys them.
 */
const NOTIFY_MODE_MIGRATION_PROP_KEY = 'NOTIFY_MODE_MIGRATED_TO_TAB_V1';

/**
 * Has the Registrant_Notifications tab been folded into Program_Settings?
 *
 * A SEPARATE MARKER FROM THE ONE ABOVE, and not a version bump of it, because
 * the two carry-overs are independent and a workbook can need either, both or
 * neither: one deployed before the tick boxes existed has only Notify_Mode
 * cells, one deployed between the two changes has only a notifications tab,
 * and a fresh one has nothing. Reusing the key would tell a workbook of the
 * second kind that its ticks had already been carried across.
 */
const PROGRAM_SETTINGS_MERGE_PROP_KEY = 'REGISTRANT_NOTIFICATIONS_MERGED_V1';

/** Writes a resolved policy back onto a row as ticks and a day list. */
function writeNotificationTicks(row, map, policy) {
  row[map['Add_Guest_To_Calendar']] = !!policy.invite;
  row[map['Confirm_On_Booking']] = !!policy.confirmTime;
  const days = policy.remind ? (policy.days || []).slice() : [];
  const leftover = [];
  const boxed = {};
  NOTIFICATION_REMINDER_BOXES.forEach(box => { boxed[box.days] = box.column; });
  days.forEach(day => {
    if (boxed[day] !== undefined) row[map[boxed[day]]] = true;
    else if (leftover.indexOf(day) === -1) leftover.push(day);
  });
  NOTIFICATION_REMINDER_BOXES.forEach(box => {
    if (row[map[box.column]] !== true) row[map[box.column]] = false;
  });
  row[map['Other_Reminders']] = leftover.length > 0 ? leftover.join(', ') : '';
}

/**
 * One row's ticks resolved into the policy section 9e acts on.
 *
 * `personalizeTime` is NOT a tick and never will be: it says whether the email
 * has a per-person time to state, which is a fact about the kind of program,
 * not a preference anybody expresses.
 */
function policyFromNotificationRow(row, map, isAssistance) {
  const fallback = defaultNotificationPolicy(isAssistance);
  const days = [];
  NOTIFICATION_REMINDER_BOXES.forEach(box => {
    if (isTruthyCheckbox(row[map[box.column]])) days.push(box.days);
  });
  parseReminderDays(row[map['Other_Reminders']]).forEach(day => {
    if (days.indexOf(day) === -1) days.push(day);
  });
  days.sort((a, b) => b - a); // soonest LAST, so a session reads 7 then 1 then 0
  return {
    invite: isTruthyCheckbox(row[map['Add_Guest_To_Calendar']]),
    remind: days.length > 0,
    days: days,
    confirmTime: isTruthyCheckbox(row[map['Confirm_On_Booking']]),
    personalizeTime: fallback.personalizeTime
  };
}

/** The retired Notify_Mode / Reminder_Days pair resolved into the same policy shape. */
function policyFromLegacyCells(cells, isAssistance) {
  const fallback = defaultNotificationPolicy(isAssistance);
  const wanted = String(cells.mode || '').trim().toLowerCase();
  const modes = LEGACY_NOTIFY_MODES;
  const chosen = Object.keys(modes).map(k => modes[k])
    .filter(m => m.toLowerCase() === wanted)[0];
  let policy;
  switch (chosen) {
    case modes.NONE:
      policy = { invite: false, remind: false, confirmTime: false };
      break;
    case modes.INVITE_ONLY:
      policy = { invite: true, remind: false, confirmTime: false };
      break;
    case modes.INVITE_AND_REMIND:
      policy = { invite: true, remind: true, confirmTime: fallback.confirmTime };
      break;
    case modes.REMIND_ONLY:
      policy = { invite: false, remind: true, confirmTime: fallback.confirmTime };
      break;
    default:
      // "Default for type", blank, or a phrase nobody recognizes. A typo must
      // not be the way a program is carried across as silent.
      policy = { invite: fallback.invite, remind: fallback.remind,
        confirmTime: fallback.confirmTime };
      break;
  }
  policy.personalizeTime = fallback.personalizeTime;
  if (!policy.remind) {
    // No reminders means no confirmation either: the confirmation IS an email,
    // and the old dropdown had no way to ask for one without the other.
    policy.days = [];
    policy.confirmTime = false;
    return policy;
  }
  const typed = parseReminderDays(cells.reminderDays);
  policy.days = typed.length > 0 ? typed
    : (fallback.days.length > 0 ? fallback.days.slice() : DEFAULT_REMINDER_DAYS.slice());
  return policy;
}

/**
 * The sheet a one-time carry-over off the OLD Program_Options layout has to
 * look at — under whichever name that tab is currently sitting.
 *
 * A workbook mid-upgrade may meet it either way round. getOrCreateSheet()
 * renames Program_Options to Program_Settings the first time the merged
 * refresh asks for it (LEGACY_SHEET_RENAMES), and the retired columns ride
 * along on the renamed tab until that same refresh's write drops them — so
 * the new name is checked first and the old one is the fallback, never the
 * other way round.
 */
function programSettingsSheetForLegacyRead(ss) {
  if (!ss) return null;
  return ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS) ||
    ss.getSheetByName(LEGACY_PROGRAM_OPTIONS_SHEET_NAME);
}

/**
 * { programKey: { mode, reminderDays } } off the retired Notify_Mode /
 * Reminder_Days columns, or {} once the carry-over has run.
 *
 * BY HEADER NAME on the live sheet, deliberately: HEADERS.Program_Settings
 * does not list either column, so the projection a normal read goes through
 * would hand back two blanks with no complaint.
 */
function readLegacyNotifyModeRows(ss) {
  const out = {};
  try {
    if (PropertiesService.getScriptProperties().getProperty(NOTIFY_MODE_MIGRATION_PROP_KEY)) {
      return out;
    }
    const sheet = programSettingsSheetForLegacyRead(ss);
    if (!sheet) return out;
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < MEMORY_TAB_DATA_ROW || lastCol < 1) return out;
    const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = grid[MEMORY_TAB_HEADER_ROW - 1].map(v => String(v || '').trim());
    const eventCol = header.indexOf('Event');
    const locationCol = header.indexOf('Location');
    const modeCol = header.indexOf(LEGACY_NOTIFY_MODE_COLUMN);
    const daysCol = header.indexOf(LEGACY_REMINDER_DAYS_COLUMN);
    if (eventCol === -1 || (modeCol === -1 && daysCol === -1)) return out;
    grid.slice(MEMORY_TAB_DATA_ROW - 1).forEach(row => {
      const key = notificationProgramKey(row[eventCol],
        locationCol === -1 ? '' : row[locationCol]);
      if (key === '|') return;
      const mode = modeCol === -1 ? '' : String(row[modeCol] || '').trim();
      const reminderDays = daysCol === -1 ? '' : row[daysCol];
      if (!mode && String(reminderDays || '').trim() === '') return;
      out[key] = { mode: mode, reminderDays: reminderDays };
    });
  } catch (err) {
    // A workbook that cannot be read here is a workbook whose programs are
    // seeded from their kind's default instead, which is the pre-migration
    // behavior — worth a line in the log, not worth stopping a sync.
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_SETTINGS} for its retired ` +
      `${LEGACY_NOTIFY_MODE_COLUMN} column (${err}).`);
  }
  return out;
}

/**
 * Marks the carry-over done — ALWAYS, once the new tab has been written.
 *
 * Unconditionally, including on a workbook that had nothing to carry: leaving
 * the marker unset there would mean re-reading Program_Options on every sync
 * forever, looking for a column this layout no longer writes.
 */
function markLegacyNotifyModeMigrationDone(legacy, seeded) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(NOTIFY_MODE_MIGRATION_PROP_KEY)) return;
    props.setProperty(NOTIFY_MODE_MIGRATION_PROP_KEY, new Date().toISOString());
    const carried = Object.keys(legacy || {}).length;
    if (carried > 0) {
      log(`${SHEET_NAMES.PROGRAM_SETTINGS}: carried ${carried} program(s) over from the retired ` +
        `${LEGACY_NOTIFY_MODE_COLUMN} / ${LEGACY_REMINDER_DAYS_COLUMN} columns ` +
        `(${seeded} row(s) seeded this pass).`);
      notifyAdmin('Notification settings are now tick boxes',
        `The ${LEGACY_NOTIFY_MODE_COLUMN} and ${LEGACY_REMINDER_DAYS_COLUMN} columns that used to ` +
        `answer "how does this program talk to its people?" are now six tick boxes on ` +
        `${SHEET_NAMES.PROGRAM_SETTINGS}, one per channel. ${carried} program(s) with a setting ` +
        `were carried across; everything else was ticked the way its kind is normally notified. ` +
        `Nothing about who is written to has changed — but the ticks are now the whole answer, ` +
        `so this is the tab to look at when it should.`);
    }
  } catch (err) {
    log(`⚠️ Could not record the ${LEGACY_NOTIFY_MODE_COLUMN} carry-over (${err}) — ` +
      `it will be attempted again on the next refresh.`);
  }
}

/**
 * { programKey: { title, location, values } } off the retired
 * Registrant_Notifications tab, or {} once the merge has run.
 *
 * BY HEADER NAME on the live sheet, for the same reason the Notify_Mode read
 * above is: HEADERS has no entry for that tab any more, so there is no layout
 * to project it through. Only the staff's own columns are taken — the left
 * half was recomputed from the session rows and is recomputed again by the
 * refresh that is about to write the merged row.
 */
function readLegacyRegistrantNotificationRows(ss) {
  const out = {};
  try {
    if (programSettingsMergeDone()) return out;
    const sheet = ss ? ss.getSheetByName(LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME) : null;
    if (!sheet) return out;
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < MEMORY_TAB_DATA_ROW || lastCol < 1) return out;
    const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const header = grid[MEMORY_TAB_HEADER_ROW - 1].map(v => String(v || '').trim());
    const eventCol = header.indexOf('Event');
    const locationCol = header.indexOf('Location');
    // No Event column and this is not the tab we are looking for — a workbook
    // where somebody has made their own sheet of that name must not have it
    // read as though it were settings.
    if (eventCol === -1) return out;
    const wanted = LEGACY_REGISTRANT_NOTIFICATION_COLUMNS.filter(h => header.indexOf(h) !== -1);
    if (wanted.length === 0) return out;
    grid.slice(MEMORY_TAB_DATA_ROW - 1).forEach(row => {
      const title = String(row[eventCol] || '').trim();
      const location = locationCol === -1 ? '' : String(row[locationCol] || '').trim();
      const key = notificationProgramKey(title, location);
      if (key === '|') return;
      const values = {};
      wanted.forEach(h => {
        // KEYED BY THE COLUMN THE VALUE IS GOING TO, not the one it came off:
        // seedNotificationHalf() reads this by the merged tab's names, and the
        // retired tab spells the guest-list tick Add_To_Calendar.
        const target = LEGACY_NOTIFICATION_COLUMN_RENAMES[h] || h;
        values[target] = NOTIFICATION_CHECKBOX_COLUMNS.indexOf(target) === -1
          ? row[header.indexOf(h)]
          : isTruthyCheckbox(row[header.indexOf(h)]);
      });
      out[key] = { title, location, values };
    });
  } catch (err) {
    // A tab that cannot be read here is a workbook whose programs are seeded
    // from the Notify_Mode cells or their kind's default instead. Worth a line
    // in the log; not worth stopping a sync, and NOT worth setting the marker —
    // markProgramSettingsMergeDone() is only reached by a write that landed.
    log(`⚠️ Could not read ${LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME} for its tick boxes ` +
      `(${err}) — it is left exactly as it is and the merge will be tried again next sync.`);
  }
  return out;
}

/** Has the retired notifications tab already been folded in? */
function programSettingsMergeDone() {
  try {
    return !!PropertiesService.getScriptProperties().getProperty(PROGRAM_SETTINGS_MERGE_PROP_KEY);
  } catch (err) {
    // Unreadable properties mean the merge is attempted again, which is
    // idempotent (the ticks land in the same cells), rather than skipped,
    // which would lose them.
    return false;
  }
}

/**
 * Marks the merge done — and marks the retired tab retired, so nobody types a
 * tick into a sheet nothing reads any more.
 *
 * THE OLD TAB IS RENAMED, NEVER DELETED. Its rows are the only copy of what
 * somebody ticked before this ran, and a migration nobody watched run is
 * exactly the wrong place to be certain. A person who has read the note can
 * delete it in one click; nothing here can put it back.
 *
 * The marker is set unconditionally once the merged write has landed,
 * including on a workbook that had nothing to carry: leaving it unset there
 * would mean looking for that tab on every sync forever.
 */
function markProgramSettingsMergeDone(ss, legacyTicks, mergedTicks) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROGRAM_SETTINGS_MERGE_PROP_KEY)) return;
    props.setProperty(PROGRAM_SETTINGS_MERGE_PROP_KEY, new Date().toISOString());
    const carried = Object.keys(legacyTicks || {}).length;
    if (carried === 0) return;

    let retiredName = LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME;
    try {
      const sheet = ss ? ss.getSheetByName(LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME) : null;
      if (sheet) {
        retiredName = LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME + RETIRED_SHEET_NAME_SUFFIX;
        sheet.setName(retiredName);
      }
    } catch (err) {
      // A name already taken, or a protected sheet. The ticks are across
      // either way; the tab just keeps its old name and its own banner is what
      // tells somebody it is stale.
      log(`ℹ️ Could not mark ${LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME} retired (${err}).`);
    }

    log(`${SHEET_NAMES.PROGRAM_SETTINGS}: folded ${carried} row(s) of notification settings in ` +
      `from ${LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME} (${mergedTicks} applied this pass).`);
    notifyAdmin('Program settings are now one tab',
      `Program_Options and ${LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME} asked the same question ` +
      `about the same thing — one row per program, at one location — so they are now one tab: ` +
      `${SHEET_NAMES.PROGRAM_SETTINGS}. How a program RUNS is on the left of the yellow band and ` +
      `what it SENDS is on the right, and every note and tick box you had is on it.\n\n` +
      `${carried} program(s) of notification settings were carried across. Your old ` +
      `${LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME} tab has been left in the workbook as ` +
      `"${retiredName}" so you can check it against the new one. Nothing reads it any more — ` +
      `delete it whenever you are happy.`);
  } catch (err) {
    log(`⚠️ Could not record the ${LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME} merge (${err}) — ` +
      `it will be attempted again on the next refresh.`);
  }
}
