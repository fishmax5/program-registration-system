// ============================================================================
// 99g. CLOSING A RUN OF DATES AT ONCE  (bulk [Waitlist Only])
// ============================================================================
//
// Waitlist_Only is the one tick on the session table that means something
// about a DATE rather than about a program (see WAITLIST_ONLY_TAG and
// SESSION_FLAG_COLUMNS), and until now the only way to set it was one cell at
// a time on a tab of several hundred rows — find the program, find the date,
// tick, repeat. Which is the wrong shape for the thing people actually say:
// "the Tuesday class is full from now until the new term", "close the whole of
// December while the hall is being painted".
//
// So this is a picker with a program at the top of it, which is also what
// makes it safe: choosing the program first means every date in the list is
// one program's, and a tick can never land on the Bingo that happens to sit
// beside it in date order.
//
// IT GOES THROUGH THE SAME TWO STEPS AN EDIT DOES, deliberately. The tick is
// not a cell — it is a cell AND a queue entry that the installable trigger
// turns into a [Waitlist Only] tag in the calendar event's description (see
// handleWaitlistOnlyEdit(), 18). Writing only the cell would leave the sheet
// saying one thing and the calendar another, and the next syncCalendars()
// recomputes this column FROM the calendar — so a bulk tick that skipped the
// queue would be quietly undone within the hour. recordPendingProgramFlag()
// carries the row's dateKey for exactly this reason: one program, several
// dates, each queued on its own.
//
// AND IT UNTICKS. The list arrives with the dates that are already closed
// already ticked, so what is applied is the WHOLE picture rather than a set of
// additions — which is the only way "we are reopening the 14th but not the
// 21st" is one action instead of two. A date whose tick did not change is not
// queued and not written; an hourly sync should not be asked to re-stamp a
// calendar that already agrees.
//
// NOBODY ALREADY REGISTERED IS MOVED, here or anywhere else this tick is set.
// It decides where the NEXT person to sign up goes. Promoting or waitlisting
// somebody who already has a place is 71's business and stays there.
// ============================================================================

/** How far ahead the picker looks, in days. Past dates are never offered — closing one says nothing. */
const BULK_WAITLIST_WINDOW_FORWARD_DAYS = 365;

/** MENU ENTRY: pick a program, then pick its dates. */
function showBulkWaitlistOnlyDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const programs = listWaitlistProgramSessions();
  if (programs.length === 0) {
    toastIfPossible('No upcoming sessions to close — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildBulkWaitlistOnlyHtml(programs))
    .setWidth(640)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Close Sessions to New Registrations');
}

/**
 * Every program with at least one upcoming session, each carrying its dates.
 *
 * WHAT COUNTS AS ONE PROGRAM here is `Calendar_Source | Clean_Title` — the same
 * boundary spreadFlagToSiblingRows() and reconcileProgramFlagColumns() draw,
 * and for the same reason: two locations running an unlinked "Chair Yoga" are
 * two programs with two forms, and offering them as one would close both from
 * a single tick. A program tagged [All Locations] therefore appears once per
 * calendar too — its dates are genuinely separate events in separate rooms,
 * and [Waitlist Only] is a statement about an event.
 *
 * Returns [{ key, label, sessions: [{ eventId, dateKey, label, on }] }].
 */
function listWaitlistProgramSessions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];

  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  if (map['Waitlist_Only'] === undefined) return [];

  const todayKey = formatDateKey(new Date());
  const limitKey = formatDateKey(
    new Date(Date.now() + BULK_WAITLIST_WINDOW_FORWARD_DAYS * 86400000));

  const byProgram = {};
  const order = [];

  getSectionedRowValues(sheet, headers, 'Event_ID').forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const calendarId = String(row[map['Calendar_Source']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    const eventId = String(row[map['Event_ID']] || '').trim();
    // A row with no calendar behind it is a lunch or hand-typed row: there is
    // no event to stamp the tag onto, so closing it would be half an answer.
    if (!title || !calendarId || !date || !eventId) return;

    const dateKey = formatDateKey(date);
    if (dateKey < todayKey || dateKey > limitKey) return;

    const time = String(row[map['Event_Time']] || '').trim();
    const key = `${calendarId}|${title}`;
    if (!byProgram[key]) {
      byProgram[key] = {
        key,
        title,
        calendarId,
        label: `${title} (${String(row[map['Location']] || '').trim() || 'no location'})`,
        sessions: []
      };
      order.push(key);
    }
    byProgram[key].sessions.push({
      eventId,
      dateKey,
      label: `${formatDateLabel(date)}${time ? ` · ${time}` : ''}`,
      on: isWaitlistOnlyColumnValue(row[map['Waitlist_Only']])
    });
  });

  return order
    .map(k => byProgram[k])
    .map(p => {
      p.sessions.sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
      p.label = `${p.label} — ${p.sessions.length} upcoming date(s)`;
      return p;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The dialog's markup. Inline, so this project stays a set of .gs files.
 *
 * The whole program list is inlined rather than fetched a program at a time:
 * it is a few hundred short strings, and a round trip per selection on a
 * modal somebody is scanning through is the delay that makes a tool feel
 * broken. Everything from the workbook crosses into the script through
 * JSON.stringify twice over — the same rule every served page here follows,
 * for the member called O'Brien and the program titled "Bingo </script>".
 */
function buildBulkWaitlistOnlyHtml(programs) {
  const options = programs.map((p, i) =>
    `<option value="${i}">${escapeHtmlForDialog(p.label)}</option>`).join('\n');
  // Every "<" escaped, not only "</script>": the doubled stringify makes this
  // a JSON string inside a JS string literal inside a <script> block, and the
  // HTML parser closes that block on the first "</script>" it sees whatever
  // JavaScript thinks the quotes mean. \u003c is a valid JSON escape for "<",
  // so a program actually called "Bingo </script>" survives the round trip and
  // reads back correctly in the dialog. Same guard, same reason, as
  // showVolunteerHoursDialog() (99e) and the program review (58).
  const payload = JSON.stringify(JSON.stringify(programs)).replace(/</g, '\\u003c');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  select, input[type=date] { padding: 6px; font-size: 13px; box-sizing: border-box; }
  #program { width: 100%; margin-bottom: 10px; }
  .dates { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 230px; overflow-y: auto; }
  label.row { display: block; padding: 3px 0; }
  .range { margin: 0 0 10px 0; color: #444; }
  .range label { margin-right: 10px; }
  .tools { margin: 8px 0 0 0; }
  .tools a { color: #1155CC; cursor: pointer; text-decoration: underline; margin-right: 12px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  .already { color: #B06000; }
</style>
<h3>Close sessions to new registrations</h3>
<p class="hint">
  Pick a program, then tick the dates that should take no more places. Anyone signing up for a
  ticked date from now on goes on the waiting list, whatever the seats say — <b>nobody already
  registered is moved</b>. Dates already closed arrive ticked; unticking one reopens it.
</p>

<select id="program" onchange="drawDates()"></select>

<div class="range">
  <label>From <input type="date" id="from" onchange="drawDates()"></label>
  <label>To <input type="date" id="to" onchange="drawDates()"></label>
  <a onclick="clearRange()">clear range</a>
</div>

<div class="dates" id="dates"></div>
<div class="tools">
  <a onclick="setAll(true)">Tick all shown</a>
  <a onclick="setAll(false)">Untick all shown</a>
</div>

<button id="go" onclick="submit()">Apply to this program</button>
<div id="status"></div>
<script>
  var PROGRAMS = JSON.parse(${payload});
  // The answer being edited, per program, keyed eventId -> boolean. Seeded from
  // the sheet the first time a program is opened and kept afterwards, so
  // narrowing the date range does not throw away ticks made before it.
  var STATE = {};

  function init() {
    var sel = document.getElementById('program');
    PROGRAMS.forEach(function (p, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
    drawDates();
  }

  function current() { return PROGRAMS[Number(document.getElementById('program').value || 0)]; }

  function stateFor(p) {
    if (!STATE[p.key]) {
      var seeded = {};
      p.sessions.forEach(function (s) { seeded[s.eventId] = !!s.on; });
      STATE[p.key] = seeded;
    }
    return STATE[p.key];
  }

  function shown(p) {
    var from = document.getElementById('from').value;
    var to = document.getElementById('to').value;
    return p.sessions.filter(function (s) {
      if (from && s.dateKey < from) return false;
      if (to && s.dateKey > to) return false;
      return true;
    });
  }

  function drawDates() {
    var p = current();
    var state = stateFor(p);
    var list = shown(p);
    var box = document.getElementById('dates');
    box.textContent = '';
    if (list.length === 0) {
      var none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No dates for this program in that range.';
      box.appendChild(none);
      return;
    }
    list.forEach(function (s) {
      var label = document.createElement('label');
      label.className = 'row';
      var box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.checked = !!state[s.eventId];
      box2.onchange = function () { state[s.eventId] = box2.checked; };
      label.appendChild(box2);
      label.appendChild(document.createTextNode(' ' + s.label));
      if (s.on) {
        var note = document.createElement('span');
        note.className = 'already';
        note.textContent = '  · already closed';
        label.appendChild(note);
      }
      box.appendChild(label);
    });
    say('', '');
  }

  function setAll(on) {
    var p = current();
    var state = stateFor(p);
    shown(p).forEach(function (s) { state[s.eventId] = on; });
    drawDates();
  }

  function clearRange() {
    document.getElementById('from').value = '';
    document.getElementById('to').value = '';
    drawDates();
  }

  function submit() {
    var p = current();
    var state = stateFor(p);
    // The WHOLE program's answer is sent, not just what is on screen: a date
    // filtered out of view was not being left undecided, it was being left
    // alone, and the server drops anything that did not actually change.
    var picks = p.sessions.map(function (s) {
      return { eventId: s.eventId, on: !!state[s.eventId] };
    });
    document.getElementById('go').disabled = true;
    say('Working…', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
        // The sheet has moved; what arrives ticked next time should match it.
        picks.forEach(function (pick) {
          p.sessions.forEach(function (s) { if (s.eventId === pick.eventId) s.on = pick.on; });
        });
        drawDates();
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .applyBulkWaitlistOnly(p.key, picks);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  init();
</script>`;
}

/**
 * Called from the dialog. Sets Waitlist_Only to exactly what `picks` says for
 * every session named, and queues the calendar tag for the ones that changed.
 *
 * `picks` is [{ eventId, on }]. `programKey` is `Calendar_Source|Clean_Title`
 * and is checked against every row rather than trusted: the dialog sends what
 * it was drawn from, and a row that has since been renamed or moved to another
 * calendar is not the session that was ticked.
 *
 * Returns the sentence the dialog shows.
 */
function applyBulkWaitlistOnly(programKey, picks) {
  const wanted = {};
  (picks || []).forEach(pick => {
    const id = String((pick && pick.eventId) || '').trim();
    if (id) wanted[id] = !!pick.on;
  });
  if (Object.keys(wanted).length === 0) return '⚠️ Nothing was selected, so nothing changed.';

  return withScriptLock(SYNC_LOCK_WAIT_MS,
    () => applyBulkWaitlistOnlyLocked_(programKey, wanted),
    '⚠️ The workbook is mid-update — nothing was changed. Try again in a moment.');
}

/** The write itself, under the lock. */
function applyBulkWaitlistOnlyLocked_(programKey, wanted) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return '⚠️ There is no session table to change.';

  const flag = getSessionFlagByColumn('Waitlist_Only');
  if (!flag) return '⚠️ This workbook has no Waitlist Only column.';

  const model = loadSessionGrid(sheet);
  if (!model || model.map['Waitlist_Only'] === undefined) {
    return '⚠️ This workbook has no Waitlist Only column.';
  }

  const changed = [];
  let alreadyRight = 0;

  model.zones.forEach(zone => {
    const ids = sessionGridColumn(model, zone, 'Event_ID');
    const flags = sessionGridColumn(model, zone, 'Waitlist_Only');
    const titles = sessionGridColumn(model, zone, 'Clean_Title');
    const sources = sessionGridColumn(model, zone, 'Calendar_Source');
    const dates = sessionGridColumn(model, zone, 'Event_Date');
    if (!ids || !flags || !titles || !sources || !dates) return;

    let dirty = false;
    for (let r = 0; r < zone.count; r++) {
      const eventId = String(ids[r] || '').trim();
      if (!eventId || wanted[eventId] === undefined) continue;

      const title = String(titles[r] || '').trim();
      const calendarId = String(sources[r] || '').trim();
      // The row has to still be the session that was ticked. A rename or a
      // repointed calendar between the dialog opening and this running makes
      // it a different program, and closing that one is not what anybody said.
      if (`${calendarId}|${title}` !== programKey) continue;

      const on = wanted[eventId];
      if (isWaitlistOnlyColumnValue(flags[r]) === on) { alreadyRight++; continue; }

      flags[r] = on ? WAITLIST_ONLY_COLUMN_VALUE : false;
      dirty = true;

      const date = coerceDate(dates[r]);
      changed.push({ title, calendarId, on, date, dateKey: date ? formatDateKey(date) : '' });
    }
    if (dirty) markSessionGridColumn(model, zone, 'Waitlist_Only');
  });

  if (changed.length === 0) {
    return alreadyRight > 0
      ? `Nothing to do — all ${alreadyRight} date(s) already say what you asked for.`
      : '⚠️ None of those dates are on the session table any more. Run Sync Cal and try again.';
  }

  flushSessionGrid(model, true);

  // The cell is only half of a tick. The calendar is told through the same
  // queue an edit uses — one entry per DATE, which is what keeps "the 14th is
  // full" off the 21st. See handleWaitlistOnlyEdit() (18).
  changed.forEach(c => {
    if (!c.dateKey) return; // no date, no session to tag
    recordPendingProgramFlag(flag.column, c.calendarId, c.title, c.on, c.dateKey);
  });

  const closed = changed.filter(c => c.on).length;
  const reopened = changed.length - closed;
  const parts = [];
  if (closed > 0) parts.push(`${closed} date(s) closed to new registrations`);
  if (reopened > 0) parts.push(`${reopened} date(s) reopened`);

  const summary = `${parts.join(', ')}. Writing [${flag.tag}] to the calendar — nobody already ` +
    `registered was moved.`;
  log(`applyBulkWaitlistOnly: ${programKey} — ${parts.join(', ')}` +
    (alreadyRight > 0 ? `, ${alreadyRight} already right` : '') + '.');
  toastIfPossible(summary);
  return summary;
}
