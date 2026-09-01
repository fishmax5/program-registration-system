// ============================================================================
// 12. COLLAPSING A DAY OF TIME BLOCKS INTO ONE EVENT
// ============================================================================
//
// WHAT IS ON THE CALENDAR, and why it is wrong. A provider's afternoon gets
// typed in the way a paper diary is written — one calendar event per
// appointment:
//
//     12:30–1:00  Low-Cost Wills
//      1:00–1:30  Low-Cost Wills
//      1:30–2:00  Low-Cost Wills
//      2:00–2:30  Low-Cost Wills
//
// That is six or seven events saying the same thing, and this system cannot
// read them as six appointments however hard it tries — because an Event_ID is
// md5(calendar | title | DATE) and carries no time at all (computeEventId()).
// Every one of those blocks therefore hashes to the SAME session, so the
// dashboard shows ONE row whose start and end are whichever block the sync
// happened to write last, the capacity is one session's worth rather than
// seven, and the form offers the day rather than the times. Six of the seven
// events are, to this system, invisible duplicates fighting over one row.
//
// The shape it wants instead is the one [Personalized Assistance] was built
// for: ONE event spanning 12:30–4:00, tagged with how long an appointment is,
// cut into slots by the form. Same afternoon, same appointments, one row, and
// a form that asks for a time.
//
// SO THIS CONVERTS ONE INTO THE OTHER. The first block keeps its identity and
// grows to cover the whole run; the rest are deleted; the description gains
// [Personalized Assistance] and [Slots: N], N being how long the blocks
// actually were.
//
// NOTHING IS STRANDED BY IT, and that is a property of computeEventId() rather
// than of any care taken here: the surviving event has the same calendar, the
// same title and the same date as the ones that go, so it hashes to the same
// Event_ID. Registrations already collected keep pointing at the session they
// always pointed at; the session row keeps its form, its link and its
// registrant count. What changes is the row's END time, its slot length and
// its capacity — which applySessionTimesToRows() and
// applyAssistanceSettingsToRows() write directly rather than waiting an hour
// for a sync to derive them.
//
// IT ALSO DOES THE OTHER JOB. Sometimes six half-hour blocks are not
// appointments at all: somebody typed a three-hour art class in half-hour
// pieces. "Merge, but do not tag" is therefore a separate answer, giving one
// event of the right length and no appointment shape at all.
//
// DELETING CALENDAR EVENTS IS THE ONE IRREVERSIBLE PART, so it is the last
// thing done, it is never done to an event this run failed to merge, and the
// dialog names every event that will go before anything is touched.
// ============================================================================

/**
 * How long a gap between two blocks still reads as "back to back".
 *
 * Not zero. A diary typed by hand has 12:30–1:00 followed by 1:05–1:35 in it,
 * because somebody wanted five minutes between people, and refusing to see
 * that as one afternoon would refuse the commonest real case. Fifteen minutes
 * is the outer edge of a comfort break; anything longer is two separate things
 * happening on one day, which is not this function's business.
 */
const TIME_BLOCK_MAX_GAP_MINUTES = 15;

/**
 * The longest a single block can be and still look like an appointment slot
 * rather than a program. Two hours of "Chair Yoga" followed by two more is a
 * double session, not a diary — and merging it would silently turn two classes
 * into one four-hour event.
 */
const TIME_BLOCK_MAX_SLOT_MINUTES = 90;

/** Fewest blocks in a row before this is worth calling a time block at all. */
const TIME_BLOCK_MIN_EVENTS = 2;

/**
 * Every run of same-titled, back-to-back events on one day, across every
 * calendar in the sync window.
 *
 * GROUPED THE WAY computeEventId() GROUPS, which is what makes the result
 * meaningful: calendar + clean title + date. Those are exactly the events that
 * currently collide onto one session row, so a run found here is a run that is
 * already broken, whether or not anybody collapses it.
 *
 * Returns [{ key, calendarId, location, title, dateKey, dateLabel, count,
 *            startLabel, endLabel, spanMinutes, slotMinutes, uniformSlots,
 *            alreadyAssistance, eventIds, doomedIds }], newest last.
 */
function findCollapsibleTimeBlocks(options) {
  options = options || {};
  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const runs = [];

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) return; // unreadable calendar — say nothing about it rather than guess

    const byDayAndTitle = {};
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      // A TENTATIVE EVENT IS NOT PART OF ANYTHING YET — the asterisk means
      // "not confirmed", the sync skips it entirely, and merging one into a
      // run would confirm it on somebody's behalf.
      if (!parsed || parsed.isTentative || !parsed.cleanTitle) return;
      // AND A RECURRING EVENT IS NEVER MERGED. Merging means extending one
      // event over the whole span and deleting the others, and neither
      // operation means what it says on an instance of a series: setTime() on
      // one occurrence is not something Calendar will do, and deleting one is
      // an exception to a rule rather than the removal of an event. A weekly
      // "Computer Help, Tuesdays 10:00 and 10:30" typed as two series is a
      // real thing to want to fix — and the fix is on the series, by hand, not
      // here.
      if (isRecurringCalendarEvent(ev)) return;
      const startTime = ev.getStartTime();
      const key = `${calendarId}|${parsed.cleanTitle}|${formatDateKey(startTime)}`;
      if (!byDayAndTitle[key]) byDayAndTitle[key] = [];
      // resolveEventSettings(), not the title parse: every tag that matters
      // here lives in the DESCRIPTION, and asking parseEventTitle() whether an
      // event is tagged [Personalized Assistance] gets `undefined` for every
      // event on the calendar.
      byDayAndTitle[key].push({
        event: ev, parsed, settings: resolveEventSettings(ev, parsed),
        start: startTime, end: ev.getEndTime()
      });
    });

    Object.keys(byDayAndTitle).forEach(key => {
      const blocks = byDayAndTitle[key].sort((a, b) => a.start - b.start);
      if (blocks.length < TIME_BLOCK_MIN_EVENTS) return;
      const run = describeTimeBlockRun(calendarId, key, blocks);
      if (run) runs.push(run);
    });
  });

  runs.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 :
    a.title.localeCompare(b.title)));
  return options.limit ? runs.slice(0, options.limit) : runs;
}

/**
 * One day's blocks, tested against the rules above and described if they pass.
 * Returns null for a set that is not a time block — overlapping events, a gap
 * too big to be a comfort break, blocks too long to be appointments.
 *
 * OVERLAP IS A REFUSAL, not a warning. Two events at the same time on one
 * calendar are either a duplicate somebody made by accident or two things
 * genuinely running at once, and neither is a run of appointments; merging
 * would swallow one of them into a span it never occupied.
 */
function describeTimeBlockRun(calendarId, key, blocks) {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const lengths = [];

  for (let i = 0; i < blocks.length; i++) {
    const minutes = Math.round((blocks[i].end - blocks[i].start) / 60000);
    if (minutes <= 0 || minutes > TIME_BLOCK_MAX_SLOT_MINUTES) return null;
    lengths.push(minutes);
    if (i === 0) continue;
    const gap = Math.round((blocks[i].start - blocks[i - 1].end) / 60000);
    if (gap < 0) return null;                       // overlapping — not a diary
    if (gap > TIME_BLOCK_MAX_GAP_MINUTES) return null; // two separate things on one day
  }

  // THE MOST COMMON LENGTH, not the average or the first: a run of six
  // half-hours ending in one forty-five-minute block is a half-hour diary with
  // a long last appointment in it, and rounding that to 32.5 would produce a
  // slot length matching nothing on the calendar.
  const slotMinutes = modeOfNumbers(lengths);
  const uniformSlots = lengths.every(n => n === slotMinutes);
  const spanMinutes = Math.round((last.end - first.start) / 60000);
  const parsed = first.parsed;

  return {
    key,
    calendarId,
    location: CALENDAR_MAP[calendarId] || '',
    title: parsed.cleanTitle,
    dateKey: formatDateKey(first.start),
    dateLabel: formatDateLabel(first.start),
    count: blocks.length,
    startLabel: formatTimeLabel(first.start),
    endLabel: formatTimeLabel(last.end),
    spanMinutes,
    slotMinutes,
    uniformSlots,
    // Already carrying the tag, on any of its blocks — worth saying, because
    // the run still needs merging (the tag alone does not stop seven events
    // colliding onto one row) but it is not news that this is appointments.
    alreadyAssistance: blocks.some(b => b.settings.isAssistance),
    keepId: first.event.getId(),
    doomedIds: blocks.slice(1).map(b => b.event.getId()),
    eventIds: blocks.map(b => b.event.getId())
  };
}

/**
 * True when this event is one occurrence of a repeating series.
 *
 * A CALL THAT THROWS ANSWERS YES. Refusing to merge something is recoverable
 * — the events stay exactly as they are and somebody looks at them again — and
 * extending or deleting an occurrence of somebody's weekly series is not. An
 * object with no isRecurringEvent() at all is not a Calendar event and is
 * answered NO, which is what keeps this callable with a plain object.
 */
function isRecurringCalendarEvent(event) {
  try {
    return typeof event.isRecurringEvent === 'function' ? !!event.isRecurringEvent() : false;
  } catch (err) {
    return true;
  }
}

/** The commonest value in a list of numbers; the smallest of them on a tie. */
function modeOfNumbers(values) {
  const counts = {};
  (values || []).forEach(n => { counts[n] = (counts[n] || 0) + 1; });
  let best = 0;
  let bestCount = -1;
  Object.keys(counts).map(Number).sort((a, b) => a - b).forEach(n => {
    if (counts[n] > bestCount) { best = n; bestCount = counts[n]; }
  });
  return best;
}

/**
 * Does the merge for ONE run: grows the first event over the whole span,
 * writes the tags, deletes the rest, and brings the session row into line.
 *
 * `options.asAppointments` — tag it [Personalized Assistance] with a slot
 *   length, which is what a run of half-hours nearly always is. False merges
 *   the blocks and says nothing about appointments: a three-hour class typed
 *   in half-hour pieces is one class, not six bookings.
 * `options.slotMinutes` — override the length detected from the blocks.
 *
 * ORDER IS THE CONSERVATIVE ONE, and it is the whole safety story. The
 * survivor is grown and tagged FIRST; only once that has succeeded are the
 * others deleted. Fail early and the calendar still holds every block it did
 * before, with the first one merely longer — visibly odd, and fixable by hand.
 * Fail the other way round and an afternoon of appointments would be gone with
 * nothing covering it.
 *
 * Returns { ok, merged, deleted, message }.
 */
function collapseTimeBlockRun(run, options) {
  options = options || {};
  if (!run || !run.eventIds || run.eventIds.length < TIME_BLOCK_MIN_EVENTS) {
    return { ok: false, merged: 0, deleted: 0, message: 'Nothing to merge.' };
  }
  const asAppointments = options.asAppointments !== false;
  const slotMinutes = Number(options.slotMinutes) || run.slotMinutes || APPOINTMENT_SLOT_MINUTES;

  let calendar;
  try {
    calendar = CalendarApp.getCalendarById(run.calendarId);
  } catch (err) {
    return { ok: false, merged: 0, deleted: 0, message: `Could not open the ${run.location} calendar (${err}).` };
  }
  if (!calendar) {
    return { ok: false, merged: 0, deleted: 0, message: `Could not open the ${run.location} calendar.` };
  }

  // RE-READ FROM THE CALENDAR, never trusted from the dialog. The listing the
  // user is looking at was made before they read it, and an event moved or
  // deleted in between must not be merged from a stale description of itself.
  const fetched = run.eventIds.map(id => {
    try {
      return calendar.getEventById(id);
    } catch (err) {
      return null;
    }
  });
  if (fetched.some(ev => !ev)) {
    return { ok: false, merged: 0, deleted: 0,
      message: `The calendar has changed since this list was drawn — one of these events is no longer there. ` +
        `Close this and open it again.` };
  }

  const ordered = fetched.slice().sort((a, b) => a.getStartTime() - b.getStartTime());
  const keep = ordered[0];
  const doomed = ordered.slice(1);
  const spanStart = keep.getStartTime();
  const spanEnd = ordered[ordered.length - 1].getEndTime();

  // --- 1. the survivor grows over the whole run ----------------------------
  try {
    keep.setTime(spanStart, spanEnd);
  } catch (err) {
    return { ok: false, merged: 0, deleted: 0,
      message: `Nothing was changed. The first event could not be extended to cover the block (${err}).` };
  }

  // --- 2. and says what it now is ------------------------------------------
  if (asAppointments) {
    try {
      let description = keep.getDescription() || '';
      description = setFlagBracketInDescription(description, ASSISTANCE_WORDS_REGEX, ASSISTANCE_TAG, true);
      description = setSlotMinutesInDescription(description, slotMinutes);
      if (description !== (keep.getDescription() || '')) keep.setDescription(description);
    } catch (err) {
      // The span is already right, which is the half that cannot be undone by
      // hand in a hurry. A missing tag is one line typed into a description.
      log(`⚠️ Merged the ${run.title} blocks on ${run.dateLabel} but could not tag the event ` +
        `as appointments (${err}) — add "[Personalized Assistance, Slots: ${slotMinutes}]" by hand.`);
    }
  }

  // --- 3. only now, the ones it replaced ------------------------------------
  let deleted = 0;
  const stuck = [];
  doomed.forEach(ev => {
    try {
      ev.deleteEvent();
      deleted++;
    } catch (err) {
      stuck.push(`${formatTimeLabel(ev.getStartTime())} (${err})`);
    }
  });
  invalidateCalendarEventsCache(); // the window just changed under the cache

  // --- 4. and the sheet agrees without waiting an hour ----------------------
  let rowsChanged = 0;
  try {
    const registrySheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) {
      // THE SPAN FIRST, and this is what the merge was missing. The row still
      // said whatever one of the old blocks said — half an hour — and the pass
      // below cuts the slots out of the row's own start and end, so a merged
      // afternoon came out as a single appointment and the form went on
      // offering one time. Writing the new span here means the arithmetic
      // below is done against the event that now exists.
      const times = {};
      times[sessionTimeKey(run.calendarId, run.title, run.dateKey)] = { start: spanStart, end: spanEnd };
      applySessionTimesToRows(registrySheet, times);

      const expected = {};
      expected[`${run.calendarId}|${run.title}`] = {
        isAssistance: asAppointments,
        slotMinutes: asAppointments ? slotMinutes : 0,
        statedCapacity: 0
      };
      rowsChanged = applyAssistanceSettingsToRows(registrySheet, expected, { writeFlagColumn: true });
    }
  } catch (err) {
    log(`Merged the ${run.title} blocks on ${run.dateLabel} but could not update the session row (${err}) — ` +
      `the next sync will.`);
  }

  const shape = asAppointments
    ? `${slotMinutes}-minute appointments`
    : 'one event, no appointment times';
  const message = stuck.length > 0
    ? `⚠️ ${run.title} on ${run.dateLabel} is now one event ${formatTimeLabel(spanStart)}–` +
      `${formatTimeLabel(spanEnd)}, but ${stuck.length} of the old blocks could not be deleted ` +
      `(${stuck.join('; ')}). Delete them on the calendar by hand — until then they will keep ` +
      `colliding with the merged one.`
    : `✅ ${run.title} on ${run.dateLabel} — ${run.count} blocks are now one event ` +
      `${formatTimeLabel(spanStart)}–${formatTimeLabel(spanEnd)}, set up as ${shape}.` +
      (rowsChanged > 0 ? ` The dashboard row is updated.` : '');
  log(`collapseTimeBlockRun: ${message}`);
  return { ok: stuck.length === 0, merged: 1, deleted, rowsChanged, message };
}


// ---------------------------------------------------------------------------
// THE DIALOG  (🗓️ Programs & Forms ▸ Merge Half-Hour Blocks…)
// ---------------------------------------------------------------------------

/**
 * MENU ENTRY: show every run of back-to-back blocks on the calendar, and merge
 * the ones that should be one event.
 *
 * A LIST RATHER THAN A SWEEP, because these are not all the same thing. Six
 * half-hours of Low-Cost Wills are six appointments; six half-hours of Chair
 * Yoga are one class somebody typed in pieces; and two 45-minute
 * back-to-back Book Club events are probably a mistake in a third direction
 * entirely. Only a person looking at the titles can tell, so each run is
 * merged on its own, with its own answer to "is this appointments?".
 */
function showTimeBlockDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const runs = findCollapsibleTimeBlocks({ limit: TIME_BLOCK_DIALOG_LIMIT });
  const html = HtmlService.createHtmlOutput(buildTimeBlockHtml(runs))
    .setWidth(680)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Merge Half-Hour Blocks');
}

/** How many runs the dialog draws. More than this on one calendar is a bootstrap problem, not a tidy-up. */
const TIME_BLOCK_DIALOG_LIMIT = 60;

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildTimeBlockHtml(runs) {
  const rows = runs.map((run, i) => {
    const shape = run.uniformSlots
      ? `${run.count} × ${run.slotMinutes} min`
      : `${run.count} blocks, mostly ${run.slotMinutes} min`;
    const tag = run.alreadyAssistance ? ' <span class="tag">already tagged</span>' : '';
    return `<label class="row"><input type="checkbox" name="run" value="${i}" checked>
      <b>${escapeHtmlForDialog(run.title)}</b> — ${escapeHtmlForDialog(run.dateLabel)},
      ${escapeHtmlForDialog(run.location)}<br>
      <span class="detail">${escapeHtmlForDialog(run.startLabel)}–${escapeHtmlForDialog(run.endLabel)}
      &nbsp;·&nbsp; ${escapeHtmlForDialog(shape)}${tag}</span></label>`;
  }).join('\n');

  const empty = `<p class="hint"><b>Nothing to merge.</b> No program on the calendar has two or more
    back-to-back events of the same name on the same day. That is the shape this looks for — an
    afternoon typed in one event per appointment.</p>`;

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.45; }
  #runs { border: 1px solid #ccc; border-radius: 4px; padding: 8px; max-height: 230px; overflow-y: auto; }
  label.row { display: block; padding: 5px 2px; border-bottom: 1px solid #f0f0f0; line-height: 1.4; }
  label.row:last-child { border-bottom: 0; }
  .detail { color: #666; margin-left: 22px; }
  .tag { background: #E8F0FE; color: #1155CC; border-radius: 3px; padding: 1px 5px; font-size: 11px; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin: 12px 0 0 0; padding: 8px 10px; }
  legend { font-weight: bold; padding: 0 4px; }
  fieldset p { margin: 4px 0 0 22px; color: #666; line-height: 1.4; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; line-height: 1.5; white-space: pre-wrap; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Merge back-to-back blocks into one event</h3>
<p class="hint">
  A day typed as one calendar event per appointment cannot be read as appointments: a session is
  identified by its calendar, its name and its <b>date</b>, so every block on that day is the same
  session, and the dashboard shows one row fighting over which block's times to display.
  Merging them gives one event covering the whole span — which is the shape appointments are
  actually booked from.
</p>
<p class="hint">
  <b>Registrations are not affected.</b> The merged event keeps the same name, date and calendar, so
  anybody already registered stays registered for it.
</p>
${runs.length === 0 ? empty : `<div id="runs">${rows}</div>`}

${runs.length === 0 ? '' : `
<fieldset>
  <legend><label><input type="radio" name="mode" value="appointments" checked> These are appointments</label></legend>
  <p>Tags the merged event <b>[Personalized Assistance]</b> with the block length as its slot size.
     Its form asks for a TIME, drops each time as it is taken, and packs the day from the front.</p>
</fieldset>
<fieldset>
  <legend><label><input type="radio" name="mode" value="merge"> Just one longer event</label></legend>
  <p>For a class somebody typed in half-hour pieces. Merges the blocks and says nothing about
     appointments — the form goes on asking for the date.</p>
</fieldset>

<button id="go" onclick="submit()">Merge the ticked blocks</button>`}
<div id="status"></div>
<script>
  function submit() {
    var picked = [];
    var boxes = document.getElementsByName('run');
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(Number(boxes[i].value));
    if (picked.length === 0) { say('Tick at least one.', 'err'); return; }
    var mode = 'appointments';
    var modes = document.getElementsByName('mode');
    for (var m = 0; m < modes.length; m++) if (modes[m].checked) mode = modes[m].value;

    document.getElementById('go').disabled = true;
    say('Merging ' + picked.length + ' block(s)… this edits the calendar, so give it a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === -1 ? 'ok' : 'err');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .mergeTimeBlocksNow(picked, mode);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Merges the picked runs and reports on each.
 *
 * THE LIST IS RE-DERIVED, not carried across from the dialog: the indexes the
 * browser sends back are positions in a list this function rebuilds from the
 * live calendar, and a run whose events have moved since the dialog opened is
 * caught by collapseTimeBlockRun()'s own re-read rather than merged from a
 * stale description of itself.
 */
function mergeTimeBlocksNow(indexes, mode) {
  if (isBootstrapActive()) return `⚠️ ${bootstrapBusyMessage()}`;
  const picked = (indexes || []).map(Number).filter(n => n >= 0);
  if (picked.length === 0) return '⚠️ Nothing was ticked.';

  const runs = findCollapsibleTimeBlocks({ limit: TIME_BLOCK_DIALOG_LIMIT });
  const asAppointments = mode !== 'merge';
  const lines = [];
  let ok = 0;

  picked.forEach(i => {
    const run = runs[i];
    if (!run) {
      lines.push('⚠️ One of the blocks is no longer on the calendar — close this and open it again.');
      return;
    }
    const outcome = collapseTimeBlockRun(run, { asAppointments });
    lines.push(outcome.message);
    if (outcome.ok) ok++;
  });

  if (ok > 0) {
    flushAdminDigest('Merge half-hour blocks');
    toastIfPossible(`Merged ${ok} block(s) into single events. Run "Update Everything Now" to rebuild their forms.`);
  }
  lines.push('');
  lines.push(ok > 0
    ? 'Now run 🔄 Update Everything Now so the forms catch up with the new shape.'
    : 'Nothing was changed.');
  return lines.join('\n');
}


