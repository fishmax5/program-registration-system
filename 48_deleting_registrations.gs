// ============================================================================
// 10b. DELETING REGISTRATIONS  (showDeleteRegistrationsDialog)
// ============================================================================
//
// Everything else in this system CANCELS. A registrant who drops out is marked
// Cancelled and stays on the tab; a session whose calendar event disappears
// sends its people to Deleted_Event_Triage. That is deliberate and it is
// right: a registration is a record of something that happened, and the
// history of who signed up for what is worth more than a tidy sheet.
//
// This is the exception, for the cases where the rows are not history at all:
//
//   - a test run. Somebody submitted the form four times while checking that
//     it worked, and those four people do not exist.
//   - a duplicate import, or rows created against a session that was set up
//     wrong and rebuilt.
//   - a program that was cancelled outright before it ever ran, where nobody
//     wants a permanent list of people who were going to come.
//
// IT IS NOT THE ONLY WAY TO DELETE ANY MORE. This one works by SESSION, which
// is the wrong shape for "this person was entered twice" — for that, mark the
// row's Manual_Override "Remove This Row" and run the sweep on the menu
// (section 83). Same tombstones, same guarantee that a removed row stays
// removed; one row instead of a whole session, and no form responses touched.
//
// So it deletes, by session, and says so in the plainest words available. What
// keeps it safe is not a soft delete but three gates: an admin check, an
// explicit typed confirmation, and a summary of exactly how many rows on which
// sessions before anything is touched.
//
// WHAT IT ALSO OFFERS, and why: deleting the ROWS does not delete the form
// RESPONSES they came from. Left alone, those responses sit in the form
// forever and reappear on any full re-import — which is exactly what somebody
// clearing out a test run does not want. So "also delete the matching form
// responses" is offered as a separate tick, defaulting to OFF, because
// deleting a response is the one part of this that cannot be undone from
// inside this workbook.
//
// WHAT IT WILL NOT DO: stop a club from re-booking somebody. Membership lives
// on Club_Members and applyClubRosterCatchup() re-books active members into
// upcoming sessions on every sync, so deleting a club member's row for a
// FUTURE session removes it until the next sync puts it straight back. To
// actually take somebody out of a club, untick them on Club_Members — the
// dialog says so where a deletion is about to hit a club session.
// ============================================================================

/** The word that has to be typed before anything is deleted. */
const DELETE_REGISTRATIONS_CONFIRM_WORD = 'DELETE';

/** How far back the picker looks. Older sessions are archive; nobody clears a test run from last spring. */
const DELETE_REGISTRATIONS_WINDOW_BACK_DAYS = 120;
/** And how far forward. Wide enough to cover anything with a form open. */
const DELETE_REGISTRATIONS_WINDOW_FORWARD_DAYS = 180;

/** MENU ENTRY: pick the sessions whose registrations should be deleted. */
function showDeleteRegistrationsDialog() {
  // Admin-gated along with its move into the Admin submenu: a submenu that
  // only APPEARS for admins is not a check — every menu function is callable
  // by name — and this is the one day-to-day-looking action that permanently
  // destroys records. Checked here AND in deleteRegistrationsForSessions()
  // below, because the dialog calls that second function directly.
  if (!requireAuthorizedAdmin('Delete Registrations')) return;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const sessions = listSessionsWithRegistrations();
  if (sessions.length === 0) {
    toastIfPossible('No registrations to delete in the last few months.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildDeleteRegistrationsHtml(sessions))
    .setWidth(640)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Delete Registrations');
}

/**
 * Every session inside the window that actually HAS registrant rows, with the
 * count, whether it is upcoming, and whether it is a club session (which
 * changes what deleting means — see the section comment).
 */
function listSessionsWithRegistrations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!registrantsSheet) return [];

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const backKey = formatDateKey(new Date(Date.now() - DELETE_REGISTRATIONS_WINDOW_BACK_DAYS * 86400000));
  const forwardKey = formatDateKey(new Date(Date.now() + DELETE_REGISTRATIONS_WINDOW_FORWARD_DAYS * 86400000));

  const clubEventIds = collectClubEventIds();
  const byEvent = {};
  getSectionedRows(registrantsSheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < backKey || dateKey > forwardKey) return;

    if (!byEvent[eventId]) {
      byEvent[eventId] = {
        value: eventId,
        dateKey,
        date,
        title: String(row[map['Event']] || '').trim(),
        location: String(row[map['Location']] || '').trim(),
        count: 0,
        upcoming: dateKey >= todayKey,
        isClub: clubEventIds.has(eventId)
      };
    }
    byEvent[eventId].count++;
  });

  return Object.keys(byEvent)
    .map(k => byEvent[k])
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : (a.dateKey > b.dateKey ? -1 : a.title.localeCompare(b.title))))
    .map(s => ({
      value: s.value,
      count: s.count,
      label: `${formatDateLabel(s.date)} — ${s.title || '(untitled)'} (${s.location}) — ` +
        `${s.count} registration(s)${s.upcoming ? ' · upcoming' : ''}${s.isClub ? ' · club' : ''}`,
      isClub: s.isClub && s.upcoming
    }));
}

/** Event_IDs on the session table whose program is a club — see the club note in the section comment. */
function collectClubEventIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const ids = new Set();
  if (!sheet) return ids;
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    if (map['Club'] === undefined || !isClubColumnValue(row[map['Club']])) return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (eventId) ids.add(eventId);
  });
  return ids;
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildDeleteRegistrationsHtml(sessions) {
  const sessionTags = sessions.map(s =>
    `<label class="row"><input type="checkbox" name="session" value="${escapeHtmlForDialog(s.value)}"> ` +
    `${escapeHtmlForDialog(s.label)}</label>`).join('\n');
  const anyClub = sessions.some(s => s.isClub);
  const clubNote = anyClub
    ? `<p class="warn">Sessions marked <b>club</b> are upcoming meetings of a club. Deleting those rows now
       sticks — the roster will not re-book the same people into the same meetings. It does <b>not</b> take
       anybody off the club, though: they are still booked into every FUTURE meeting. To take somebody off a
       club for good, untick them on the <b>Club_Members</b> tab instead.</p>`
    : '';

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  p.warn { color: #B06000; background: #FFF8E1; border: 1px solid #FFE0A3; border-radius: 4px;
           padding: 6px 8px; margin: 0 0 10px 0; line-height: 1.4; }
  #sessions { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 220px; overflow-y: auto; }
  label.row { display: block; padding: 2px 0; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin: 12px 0 0 0; padding: 8px 10px; }
  legend { font-weight: bold; padding: 0 4px; }
  input[type=text] { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; margin-top: 4px; }
  button { background: #C5221F; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Delete registrations</h3>
<p class="hint">
  Tick the sessions whose registrations should be <b>permanently deleted</b> from
  All_Registrants. This is for test runs and duplicates — to record that somebody is no
  longer coming, set their Program_Status to <b>Cancelled</b> instead, which keeps the row and the
  history. The catering numbers are recalculated afterwards.
</p>
<p class="hint">
  Deleted rows stay deleted: the next sync will not re-import them, and neither the &quot;sign up for every
  date&quot; registry nor a club roster will re-book them into the same session. A genuinely new form
  submission from the same person for the same session still comes through.
</p>
${clubNote}
<div id="sessions">${sessionTags}</div>

<fieldset>
  <legend>Also delete the form responses</legend>
  <label class="row">
    <input type="checkbox" id="alsoResponses">
    Delete the matching responses from the Google Form as well (cannot be undone)
  </label>
</fieldset>

<fieldset>
  <legend>Confirm</legend>
  <input type="text" id="confirmWord" placeholder="Type ${DELETE_REGISTRATIONS_CONFIRM_WORD} to enable the button"
         oninput="toggle()" autocomplete="off">
</fieldset>

<button id="go" onclick="submit()" disabled>Delete registrations</button>
<div id="status"></div>
<script>
  function toggle() {
    var typed = document.getElementById('confirmWord').value.trim().toUpperCase();
    document.getElementById('go').disabled = typed !== '${DELETE_REGISTRATIONS_CONFIRM_WORD}';
  }
  function submit() {
    var picked = [].slice.call(document.querySelectorAll('input[name=session]:checked')).map(function (el) { return el.value; });
    if (picked.length === 0) { say('Tick at least one session first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… this can take a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        toggle();
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        toggle();
        say('Failed: ' + err.message, 'err');
      })
      .deleteRegistrationsForSessions(picked, {
        confirm: document.getElementById('confirmWord').value,
        alsoDeleteResponses: document.getElementById('alsoResponses').checked
      });
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Deletes every registrant row belonging to the given
 * sessions, optionally deletes the form responses behind them, and puts the
 * counts that those rows were feeding back in line.
 *
 * Takes the same script lock syncRegistrations() does. Without it, a sync
 * running in parallel would read the tab before the deletion and write its own
 * copy back afterwards, restoring every row this just removed — the same
 * lost-update race that lock was introduced for, in the other direction.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function deleteRegistrationsForSessions(eventIds, options) {
  options = options || {};
  if (!isAuthorizedAdmin()) {
    return '⚠️ Deleting registrations is an admin action — ask an admin to run it.';
  }
  if (String(options.confirm || '').trim().toUpperCase() !== DELETE_REGISTRATIONS_CONFIRM_WORD) {
    return `⚠️ Type ${DELETE_REGISTRATIONS_CONFIRM_WORD} to confirm.`;
  }
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ No sessions were selected.';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    return '⚠️ A sync is running right now — try again in a moment.';
  }
  try {
    return deleteRegistrationsForSessionsInternal(wanted, !!options.alsoDeleteResponses);
  } finally {
    lock.releaseLock();
  }
}

function deleteRegistrationsForSessionsInternal(wanted, alsoDeleteResponses) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return '⚠️ There is no registrants tab yet.';

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const allRows = getSectionedRows(sheet, headers, 'Event_ID');

  const keepRows = [];
  const doomedRows = [];
  allRows.forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    (wanted.has(eventId) ? doomedRows : keepRows).push(row);
  });
  if (doomedRows.length === 0) return '⚠️ Those sessions have no registrations to delete.';

  // BEFORE anything is written: record that these were deleted deliberately.
  // Without this the rows come straight back — the all-dates registry and the
  // club roster both re-book from standing state, and the form responses are
  // still there to be re-imported. See section 5c.
  recordRegistrantTombstones(doomedRows, map);

  // The responses go FIRST, while the rows that name them are still readable.
  // A failure here must not cost the deletion — it is reported and the rows go
  // anyway, since "the rows are gone but two responses survived in the form"
  // is recoverable and "half the rows are gone" is not.
  let responsesDeleted = 0;
  let responseFailures = 0;
  if (alsoDeleteResponses) {
    const result = deleteFormResponsesForRows(doomedRows, map, wanted);
    responsesDeleted = result.deleted;
    responseFailures = result.failed;
  }

  renderRegistrantsSheet(false, keepRows);
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, keepRows);
    updateMasterLunchDashboard(keepRows);
  } catch (err) {
    log(`⚠️ Deleted ${doomedRows.length} registration(s), but could not recalculate the counts (${err}).`);
    return `Deleted ${doomedRows.length} registration(s) — but the counts could not be recalculated (${err}). ` +
      `Run Sync Registrations to bring them back in line.`;
  }

  const message = `Deleted ${doomedRows.length} registration(s) across ${wanted.size} session(s).` +
    (alsoDeleteResponses
      ? ` ${responsesDeleted} form response(s) deleted${responseFailures > 0 ? `, ${responseFailures} could not be` : ''}.`
      : ' The form responses behind them were left in place.') +
    ' They will not be re-imported by the next sync; a genuinely new submission for the same person and session' +
    ' still comes through as normal.';
  log(`deleteRegistrationsForSessions: ${message}`);
  return message;
}

/**
 * Deletes the Google Form responses that produced `rows`.
 *
 * A row names its response in Party_ID (the response ID — see
 * buildRegistrantRow()) and its session in Event_ID; the session table maps
 * that Event_ID to the form the response lives in. Rows with no Party_ID —
 * walk-ins, club bookings, anything typed straight onto the tab — never had a
 * response and are simply skipped.
 *
 * ONE RESPONSE CAN COVER SEVERAL ROWS (a party of four, or one person on six
 * dates of a grouped form), so response IDs are deduplicated. That also means
 * deleting a response can reach further than the sessions picked: a response
 * covering six dates is one object, and there is no way to remove three dates
 * from it. The rows for the other dates are left exactly where they are — they
 * are the record — but the response behind them is gone, which is stated in
 * the dialog's warning that this cannot be undone.
 */
function deleteFormResponsesForRows(rows, map, wanted) {
  const formIdByEventId = buildFormIdByEventId();
  const byForm = {};
  rows.forEach(row => {
    const partyId = String(row[map['Party_ID']] || '').trim();
    if (!partyId) return;
    const formId = formIdByEventId[String(row[map['Event_ID']] || '').trim()] || '';
    if (!formId) return;
    if (!byForm[formId]) byForm[formId] = new Set();
    byForm[formId].add(partyId);
  });

  let deleted = 0;
  let failed = 0;
  Object.keys(byForm).forEach(formId => {
    let form;
    try {
      form = openFormCached(formId);
    } catch (err) {
      failed += byForm[formId].size;
      log(`⚠️ Could not open form ${formId} to delete responses (${err}).`);
      return;
    }
    byForm[formId].forEach(responseId => {
      try {
        form.deleteResponse(responseId);
        deleted++;
      } catch (err) {
        failed++;
        log(`⚠️ Could not delete response ${responseId} from form ${formId} (${err}).`);
      }
    });
  });

  if (deleted > 0 || failed > 0) {
    log(`deleteFormResponsesForRows: deleted ${deleted} response(s), ${failed} failed (${wanted.size} session(s) selected).`);
  }
  return { deleted, failed };
}

/** { Event_ID: Form_ID } from the session table. */
function buildFormIdByEventId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const out = {};
  if (!sheet) return out;
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const formId = String(row[map['Form_ID']] || '').trim();
    if (eventId && formId) out[eventId] = formId;
  });
  return out;
}


