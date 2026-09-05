// ============================================================================
// 9h. THE REGISTRANT NOTIFICATIONS TAB  (one row per program, one tick per channel)
// ============================================================================
//
// The tab section 9e reads its answers off, and the reason that section no
// longer reads Program_Options.
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
//   Add_To_Calendar     the guest list on the real event.
//   Week_Before         an email 7 days out.
//   Day_Before          an email 1 day out.
//   Morning_Of          an email on the day.
//   Other_Reminders     any other day counts, "14, 3". ADDS to the boxes.
//   Confirm_On_Booking  a confirmation the moment somebody registers, and the
//                       only place an appointment's own time can be stated.
//
// THE GRAIN IS THE PROGRAM, NOT THE DATE — one row per Clean_Title x Location,
// standing for every session that program ever runs, the same key
// Program_Options uses and the same key section 9e matches a session on.
// Nobody decides per-date whether a class reminds its people; a tab with one
// row per date would be a hundred rows asking the same question a hundred
// times, and ninety-nine chances for two of them to disagree.
//
// AN UNTICKED BOX MEANS OFF, WHICH IS ONLY HONEST IF NOTHING ARRIVES UNTICKED
// BY ACCIDENT. A blank row would otherwise be indistinguishable from a program
// somebody deliberately silenced, and the first sync after this shipped would
// have silenced every program in the workbook. So a row is never born blank:
// the refresh seeds a new one from the legacy Program_Options cells if that
// workbook had them, and from defaultNotificationPolicy() — how a program of
// that KIND is notified — if it did not. From then on the boxes are the truth
// and nothing but the boxes.
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
const NOTIFICATION_CHECKBOX_COLUMNS = ['Add_To_Calendar', 'Week_Before', 'Day_Before',
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
 * Has the one-time carry-over off Program_Options already run?
 *
 * Marked done the moment the new tab is written, not before: the alternative
 * is re-reading a tab that no longer has the columns, on every sync, forever.
 * The same reasoning as migrateProgramLeaderAddresses() (section 9c), and the
 * same hazard it guards — HEADERS.Program_Options no longer lists either
 * column, so the next refresh of THAT tab is the write that destroys them.
 */
const NOTIFY_MODE_MIGRATION_PROP_KEY = 'NOTIFY_MODE_MIGRATED_TO_TAB_V1';

/**
 * How the tab is written, in one place — refreshRegistrantNotifications() is
 * not the only thing that rewrites it (see renameRegistrantNotificationRows()),
 * and a second copy of these options is a second chance for the tab to come
 * back missing its banner or its tinted columns.
 */
function registrantNotificationsTabOptions() {
  return {
    banner: '🔔 Registrant Notifications',
    bannerNote: 'What each program sends the people signed up for it. Tick as many as apply — ' +
      'they add up, and an unticked box means that message is not sent.',
    staffColumns: REGISTRANT_NOTIFICATION_STAFF_COLUMNS,
    dateColumns: ['Next_Date'],
    numberColumns: ['Sessions_Tracked']
  };
}

/**
 * One row per unique program, with the staff's ticks carried forward and a
 * brand-new program's ticks seeded (see the banner). Called from
 * refreshMemoryTabs() alongside the two tabs it was carved out of.
 */
function refreshRegistrantNotifications(ss, sessionRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_NOTIFICATIONS);
  const headers = HEADERS.Registrant_Notifications;
  const map = getIndexMap(headers);

  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = notificationProgramKey(row[map['Event']], row[map['Location']]);
    if (key !== '|') existingByKey[key] = row;
  });

  // Read BEFORE anything is written, and only while the marker is unset: this
  // is the one moment the old cells are still readable.
  const legacy = readLegacyNotifyModeRows(ss);

  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regMap = getIndexMap(regHeaders);
  const rows = sessionRows ||
    getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), regHeaders, 'Event_ID');

  const todayKey = formatDateKey(new Date());
  const programs = {};
  rows.forEach(row => {
    const title = String(row[regMap['Clean_Title']] || '').trim();
    if (!title) return;
    const location = String(row[regMap['Location']] || '').trim();
    const key = notificationProgramKey(title, location);
    if (!programs[key]) {
      programs[key] = { title, location, sessions: 0, next: null, typeTag: '', isAssistance: false };
    }
    const p = programs[key];
    p.sessions++;
    p.typeTag = normalizeTypeTag(row[regMap['Type_Tag']]);
    // ANY assistance session makes the program an assistance program for this
    // purpose: the default that matters is the one that states somebody's
    // appointment time, and it must not depend on which session was read last.
    if (isAssistanceColumnValue(row[regMap['Personalized_Assistance']])) p.isAssistance = true;
    const d = coerceDate(row[regMap['Event_Date']]);
    if (d && formatDateKey(d) >= todayKey && (!p.next || d < p.next)) p.next = d;
  });

  const outRows = [];
  const seen = {};
  let seeded = 0;
  Object.keys(programs)
    .sort((a, b) => programs[a].title.localeCompare(programs[b].title))
    .forEach(key => {
      const p = programs[key];
      const row = new Array(headers.length).fill('');
      const prior = existingByKey[key];
      if (prior) {
        REGISTRANT_NOTIFICATION_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
      } else {
        writeNotificationTicks(row, map,
          legacy[key] ? policyFromLegacyCells(legacy[key], p.isAssistance)
                      : defaultNotificationPolicy(p.isAssistance));
        seeded++;
      }
      row[map['Event']] = p.title;
      row[map['Location']] = p.location;
      row[map['Type_Tag']] = p.typeTag;
      row[map['Sessions_Tracked']] = p.sessions;
      row[map['Next_Date']] = p.next || '';
      outRows.push(row);
      seen[key] = true;
    });
  // A program the calendar has stopped mentioning keeps its row and its ticks:
  // it is nearly always a series between terms, and coming back to find the
  // decision gone is worse than a stale row.
  Object.keys(existingByKey).forEach(key => {
    if (!seen[key]) outRows.push(existingByKey[key]);
  });

  writeMemoryTab(sheet, headers, outRows, registrantNotificationsTabOptions());

  // The tick boxes and the list run past the last row so the blank line under
  // it has them too (see MEMORY_TAB_SPARE_ROWS). Other_Reminders is an OPEN
  // list — the suggestions are the cadences people ask for, and "21, 10" is
  // still a legal answer.
  applyMemoryTabValidation(sheet, headers, outRows.length, {
    checkboxes: NOTIFICATION_CHECKBOX_COLUMNS,
    openLists: { Other_Reminders: OTHER_REMINDER_SUGGESTIONS }
  });
  // The tab these settings are read from has just been rewritten; anything
  // asking again in this execution must see the rows as they now stand.
  invalidateNotificationPolicyCache();

  markLegacyNotifyModeMigrationDone(legacy, seeded);
  log(`Registrant_Notifications refreshed: ${outRows.length} program(s).`);
}

/** Writes a resolved policy back onto a row as ticks and a day list. */
function writeNotificationTicks(row, map, policy) {
  row[map['Add_To_Calendar']] = !!policy.invite;
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
    invite: isTruthyCheckbox(row[map['Add_To_Calendar']]),
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
 * { programKey: { mode, reminderDays } } off Program_Options' retired columns,
 * or {} once the carry-over has run.
 *
 * BY HEADER NAME on the live sheet, deliberately: HEADERS.Program_Options no
 * longer lists either column, so the projection a normal read goes through
 * would hand back two blanks with no complaint.
 */
function readLegacyNotifyModeRows(ss) {
  const out = {};
  try {
    if (PropertiesService.getScriptProperties().getProperty(NOTIFY_MODE_MIGRATION_PROP_KEY)) {
      return out;
    }
    const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_OPTIONS);
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
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_OPTIONS} for its retired ` +
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
      log(`Registrant_Notifications: carried ${carried} program(s) over from ` +
        `${SHEET_NAMES.PROGRAM_OPTIONS}' retired ${LEGACY_NOTIFY_MODE_COLUMN} / ` +
        `${LEGACY_REMINDER_DAYS_COLUMN} columns (${seeded} row(s) seeded this pass).`);
      notifyAdmin('Notification settings moved to their own tab',
        `The ${LEGACY_NOTIFY_MODE_COLUMN} and ${LEGACY_REMINDER_DAYS_COLUMN} columns that lived ` +
        `on ${SHEET_NAMES.PROGRAM_OPTIONS} are now ${SHEET_NAMES.REGISTRANT_NOTIFICATIONS}, one ` +
        `row per program with a tick box per channel. ${carried} program(s) with a setting were ` +
        `carried across; everything else was ticked the way its kind is normally notified. ` +
        `Nothing about who is written to has changed — but the ticks are now the whole answer, ` +
        `so this is the tab to look at when it should.`);
    }
  } catch (err) {
    log(`⚠️ Could not record the ${LEGACY_NOTIFY_MODE_COLUMN} carry-over (${err}) — ` +
      `it will be attempted again on the next refresh.`);
  }
}

/**
 * A renamed program keeps its notification settings, the same way it keeps its
 * Program_Options notes — this tab is keyed by Event + Location too, and a row
 * stranded under the old name is a program that quietly reverts to its kind's
 * default on the next refresh.
 */
function renameRegistrantNotificationRows(ss, renames) {
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_NOTIFICATIONS);
  if (!sheet) return;
  const headers = HEADERS.Registrant_Notifications;
  const map = getIndexMap(headers);
  const rows = readSimpleTable(sheet, headers);
  if (rows.length === 0) return;

  const titleMap = {};
  renames.forEach(rename => { titleMap[normalizeNameKey(rename.oldTitle)] = rename.newTitle; });

  const renamed = [];
  const untouched = [];
  rows.forEach(row => {
    const replacement = titleMap[normalizeNameKey(row[map['Event']])];
    if (replacement) {
      row[map['Event']] = replacement;
      renamed.push(row);
    } else {
      untouched.push(row);
    }
  });
  if (renamed.length === 0) return;

  // Same tie-break as renameProgramOptionRows(): a row may already exist under
  // the new name, written blank by a sync that saw the rename first. The
  // carried-over row holds the actual decision, so it claims the identity.
  const kept = [];
  const claimed = {};
  renamed.concat(untouched).forEach(row => {
    const identity = notificationProgramKey(row[map['Event']], row[map['Location']]);
    if (claimed[identity]) return;
    claimed[identity] = true;
    kept.push(row);
  });

  writeMemoryTab(sheet, headers, kept, registrantNotificationsTabOptions());
  invalidateNotificationPolicyCache();
  log(`Renamed program(s): moved ${renamed.length} ${SHEET_NAMES.REGISTRANT_NOTIFICATIONS} ` +
    `row(s) onto the new name.`);
}
