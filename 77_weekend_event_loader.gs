// ============================================================================
// 77. LOADING WEEKEND EVENTS ON PURPOSE  (the one-off, not a change to sync)
// ============================================================================
//
// The ordinary sync treats every event in its window the same way, and that is
// right for a Monday-to-Friday building: what is on the calendar is what is
// on. Weekends are not like that. A Saturday event on a program calendar is as
// likely to be a room booking, a rental, a staff thing, or somebody's
// placeholder as it is a program the public signs up for — and each one the
// sync picks up costs a form, a link written into the event's description, and
// a row on the dashboard that somebody then has to triage back out.
//
// So this is the deliberate version: LOOK at the weekend dates in a window,
// SHOW them, and load only the ones a person ticked. Nothing here changes what
// syncCalendars() does or which events it considers — it is the same import,
// pointed at a hand-picked list of sessions.
//
// WHAT "LOAD" MEANS HERE is exactly what the sync means by it: the chosen
// sessions go through processCalendarGroup(), so they get their group's form
// (built, reused, or recovered), their rows on the dashboard, and the
// registration link stamped back onto the calendar event. A session already on
// the dashboard is never offered — this only ever ADDS dates.
//
// WHY IT IS NOT ADMIN-GATED: it creates nothing that cannot be undone by
// deleting the rows it wrote, and it is the sort of thing the person at the
// desk who noticed the Saturday concert should be able to press. The gate is
// for the irreversible items — see requireAuthorizedAdmin().
// ============================================================================

/** Sun and Sat, as Date.getDay() reports them. The whole definition of "not a weekday". */
const NON_WEEKDAY_DAYS = [0, 6];

/**
 * How far ahead the dialog looks when it opens: today through the end of NEXT
 * month. Two months is the horizon staff actually plan weekends on, and it is
 * short enough that the list is readable without scrolling for a minute. The
 * dialog's own date boxes override it.
 */
const NON_WEEKDAY_DEFAULT_MONTHS_AHEAD = 1;

/** Is this date a Saturday or a Sunday? */
function isNonWeekdayDate(date) {
  return !!date && NON_WEEKDAY_DAYS.indexOf(date.getDay()) !== -1;
}

/** The window the dialog opens on: local midnight today → end of the month N months out. */
function defaultNonWeekdayWindow() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
  const end = new Date(today.getFullYear(), today.getMonth() + NON_WEEKDAY_DEFAULT_MONTHS_AHEAD + 1, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Resolves the window the dialog asked for. Both keys are "yyyy-MM-dd" from
 * the date inputs; either being blank or unparseable falls back to that half
 * of the default, so a half-filled form still produces a sensible scan rather
 * than an error the person has to decode.
 */
function resolveNonWeekdayWindow(startKey, endKey) {
  const fallback = defaultNonWeekdayWindow();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(startKey || '')) ? parseDateKey(startKey) : fallback.start;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(endKey || '')) ? parseDateKey(endKey) : fallback.end;
  // parseDateKey() lands on midnight; the end of the window has to include the
  // whole of its last day or a Saturday evening event falls outside it.
  const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
  return { start, end: endOfDay < start ? new Date(start.getTime() + 86400000) : endOfDay };
}

/** MENU ENTRY: show the weekend dates in the window and let somebody pick. */
function showWeekendEventLoaderDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const html = HtmlService.createHtmlOutput(buildWeekendEventLoaderHtml(defaultNonWeekdayWindow()))
    .setWidth(640)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Load Weekend Events');
}

/**
 * READ-ONLY. Every Saturday/Sunday session in the window that is NOT already
 * on the dashboard, as `{ value, label, dateKey }` for the dialog's list.
 *
 * `value` is the Event_ID the sync itself would compute for that session, so
 * loadWeekendEvents() can match a tick back to a session without carrying any
 * state between the two calls — a dialog left open while somebody else runs a
 * sync simply finds fewer of its ticks still outstanding, which is the correct
 * outcome rather than a stale one.
 */
function scanNonWeekdayEvents(startKey, endKey) {
  const { start, end } = resolveNonWeekdayWindow(startKey, endKey);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const existing = registrySheet ? getExistingRegistryState(registrySheet) : { eventIds: new Set() };

  const groups = buildGroupsForWindow(getCalendarEventsForWindow(start, end));
  const found = [];

  groups.forEach(group => {
    group.sessions.forEach(session => {
      const when = session.event.getStartTime();
      if (!isNonWeekdayDate(when)) return;
      const dateKey = formatDateKey(when);
      const eventId = computeEventId(session.calendarId, group.cleanTitle, dateKey);
      if (existing.eventIds.has(eventId)) return;
      found.push({
        value: eventId,
        dateKey,
        label: `${formatDateLabel(when)} — ${group.cleanTitle} (${session.locationName})` +
          (group.noRegistration ? ` — no registration form` : '')
      });
    });
  });

  found.sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : a.label.localeCompare(b.label))));
  log(`Weekend scan ${formatDateLabel(start)} – ${formatDateLabel(end)}: ${found.length} unloaded Sat/Sun date(s).`);
  return {
    startKey: formatDateKey(start),
    endKey: formatDateKey(end),
    windowLabel: `${formatDateLabel(start)} – ${formatDateLabel(end)}`,
    events: found
  };
}

/**
 * Called from the dialog. Loads exactly the ticked sessions and nothing else.
 *
 * The window is rescanned rather than trusted from the dialog: between opening
 * it and pressing the button an hourly sync may have loaded some of these
 * already, and re-deriving the groups here is what keeps a tick from turning
 * into a second row for a date that now exists.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function loadWeekendEvents(eventIds, startKey, endKey) {
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ Nothing was ticked — no dates were loaded.';
  if (isBootstrapActive()) return `⚠️ ${bootstrapBusyMessage()}`;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) return '⚠️ A sync is already running — try again in a moment.';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    if (findProgramSessionHeaderRows(registrySheet).length === 0) renderProgramDashboard();

    const { start, end } = resolveNonWeekdayWindow(startKey, endKey);
    const existingState = getExistingRegistryState(registrySheet);
    const groups = buildGroupsForWindow(getCalendarEventsForWindow(start, end));

    // One unit of work per group, carrying ONLY the ticked sessions. That is
    // the whole difference between this and a sync: processCalendarGroup()
    // writes rows for the sessions it is handed, so handing it three of a
    // program's Saturdays loads three Saturdays.
    const work = [];
    groups.forEach(group => {
      const chosen = group.sessions.filter(session => {
        const when = session.event.getStartTime();
        if (!isNonWeekdayDate(when)) return false;
        const eventId = computeEventId(session.calendarId, group.cleanTitle, formatDateKey(when));
        return wanted.has(eventId) && !existingState.eventIds.has(eventId);
      });
      if (chosen.length === 0) return;
      work.push({
        group,
        configInfo: { footerNote: buildFooterNoteForLocations(group.locations) },
        newSessions: chosen
      });
    });

    if (work.length === 0) {
      return '⚠️ Those dates are already loaded, or are no longer on the calendar. Rescan to see what is left.';
    }

    let loaded = 0;
    let failed = 0;
    work.forEach(item => {
      try {
        // Deliberately the sync's own function: a weekend date loaded here has
        // to be indistinguishable from one the sync loaded, or every repair
        // downstream has a second shape to know about.
        loaded += processCalendarGroup(registrySheet, item, existingState).eventsAdded;
      } catch (err) {
        failed++;
        log(`⚠️ Could not load weekend dates for ${describeGroup(item.group)}: ${err}`);
        noteForAdmin('Weekend dates that could not be loaded',
          `${item.group.cleanTitle} (${describeLocations(item.group.locations)}) — ${err}`);
      }
    });

    flushPersistentRegistries();
    renderProgramDashboard();
    flushAdminDigest('Load weekend events');

    const summary = `✅ Loaded ${loaded} weekend date(s) across ${work.length} program(s).` +
      (failed > 0 ? ` ⚠️ ${failed} program(s) failed — see the execution log.` : '');
    log(`loadWeekendEvents: ${summary}`);
    toastIfPossible(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/** The dialog's markup. Inline, so this project stays a set of .gs files. */
function buildWeekendEventLoaderHtml(range) {
  const startKey = escapeHtmlForDialog(formatDateKey(range.start));
  const endKey = escapeHtmlForDialog(formatDateKey(range.end));

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  .dates { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 10px; }
  .dates label { display: block; font-size: 12px; color: #444; }
  input[type=date] { padding: 5px; font-size: 13px; }
  #events { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 280px; overflow-y: auto; }
  label.row { display: block; padding: 2px 0; }
  .muted { color: #666; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; }
  button.secondary { background: #5f6368; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  .actions { margin-top: 14px; display: flex; gap: 8px; align-items: center; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Load weekend events</h3>
<p class="hint">
  Saturday and Sunday dates on the program calendars that are <b>not yet on the dashboard</b>.
  Tick the ones that are really programs; each ticked date gets its program's registration form,
  its dashboard row, and the registration link on its calendar event. Nothing else is loaded, and
  the ordinary sync is not changed.
</p>

<div class="dates">
  <div><label for="from">From</label><input type="date" id="from" value="${startKey}"></div>
  <div><label for="to">To</label><input type="date" id="to" value="${endKey}"></div>
  <button class="secondary" id="rescan" onclick="scan()">Rescan</button>
</div>

<div id="events"><span class="muted">Looking at the calendars…</span></div>

<div class="actions">
  <button id="go" onclick="load()">Load ticked dates</button>
  <button class="secondary" onclick="setAll(true)">Tick all</button>
  <button class="secondary" onclick="setAll(false)">Clear</button>
</div>
<div id="status"></div>
<script>
  function scan() {
    document.getElementById('rescan').disabled = true;
    document.getElementById('go').disabled = true;
    document.getElementById('events').innerHTML = '<span class="muted">Looking at the calendars…</span>';
    say('', '');
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function (err) {
        document.getElementById('rescan').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .scanNonWeekdayEvents(document.getElementById('from').value, document.getElementById('to').value);
  }

  function render(result) {
    document.getElementById('rescan').disabled = false;
    document.getElementById('go').disabled = false;
    document.getElementById('from').value = result.startKey;
    document.getElementById('to').value = result.endKey;
    var box = document.getElementById('events');
    if (!result.events.length) {
      box.innerHTML = '<span class="muted">No unloaded Saturday or Sunday dates in ' +
        escapeHtml(result.windowLabel) + '.</span>';
      return;
    }
    box.innerHTML = result.events.map(function (ev) {
      return '<label class="row"><input type="checkbox" name="ev" value="' + escapeHtml(ev.value) + '"> ' +
        escapeHtml(ev.label) + '</label>';
    }).join('');
  }

  function setAll(on) {
    [].slice.call(document.querySelectorAll('input[name=ev]')).forEach(function (el) { el.checked = on; });
  }

  function load() {
    var picked = [].slice.call(document.querySelectorAll('input[name=ev]:checked')).map(function (el) { return el.value; });
    if (!picked.length) { say('Tick at least one date first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Loading… this can take a moment — forms may be built.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
        scan();
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .loadWeekendEvents(picked, document.getElementById('from').value, document.getElementById('to').value);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  // The labels are program titles and location names off a calendar — an
  // apostrophe or an angle bracket in one must not be able to end the markup.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  scan();
</script>`;
}
