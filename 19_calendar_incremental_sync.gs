// ============================================================================
// 3b. CALENDAR INCREMENTAL SYNC  (onCalendarChange -> Calendar.Events.list)
// ============================================================================
//
// Requires the "Calendar" Advanced Service (Editor -> Services -> + Calendar
// API). The standard EventUpdated trigger payload doesn't say WHICH event
// changed, so instead of re-scanning the whole calendar on every edit, this
// keeps a per-calendar syncToken (Script Properties) and asks the Calendar
// API for only what changed since the last check. If that delta contains
// something we actually care about (a new/modified/cancelled TIMED event,
// matching our title pattern, inside the tracked lookahead window), it
// hands off to the existing, fully-tested syncCalendars() reconciliation
// pass — re-implementing that whole pipeline (grouping, form reuse,
// capacity/waitlist recompute, triage) per single delta event would
// duplicate a lot of carefully-tested logic for very little benefit; the
// real win of incremental sync here is that an edit that ISN'T relevant to
// us (an all-day reminder, a change far outside our window) now costs one
// cheap Events.list call instead of a full multi-calendar scan + form sync.
// ============================================================================

const CALENDAR_SYNC_TOKEN_PROP_PREFIX = 'CALENDAR_SYNC_TOKEN_';
/** Baseline lookback for a calendar's very first (no-token) incremental sync call. */
const CALENDAR_SYNC_TOKEN_TIMEMIN_DAYS_BACK = 1;

function getCalendarSyncTokenPropKey(calendarId) {
  return `${CALENDAR_SYNC_TOKEN_PROP_PREFIX}${calendarId}`;
}

function saveCalendarSyncToken(calendarId, token) {
  const props = PropertiesService.getScriptProperties();
  const key = getCalendarSyncTokenPropKey(calendarId);
  if (token) props.setProperty(key, token);
  else props.deleteProperty(key);
}

/**
 * Fired by the calendar-edit triggers installed in writeCalendarChangeTriggers().
 */
function onCalendarChange(e) {
  // FIRST LINE, before anything else costs a call: a bootstrap import deletes
  // these triggers, but a firing can still arrive afterwards — Google's
  // notification channel for a calendar is torn down asynchronously, and the
  // import is generating hundreds of changes for it to deliver. Deletion
  // stops NEW subscriptions; it does not recall what is already in flight.
  //
  // So the handler treats being called during an import as normal and makes
  // it free: one log line, no delta call, no lock, no sheet read. If these
  // keep appearing long after an import ends, the triggers are being
  // re-created rather than drained — logProjectTriggers() tells you which.
  if (!automationGateAllows('onCalendarChange', true)) return; // quiet: this can fire hundreds of times

  if (isBootstrapActive()) {
    log('onCalendarChange ignored — a large-setup import or forms-rebuild sweep is running and is editing these events itself.');
    return;
  }

  // After the bootstrap check, not before: firings that arrive from a
  // torn-down notification channel during an import are drained noise, and
  // attributing them would report an account that no longer holds a trigger.
  recordHandlerRun('onCalendarChange');

  const calendarId = e && e.calendarId;
  if (!calendarId) {
    log('onCalendarChange fired with no calendarId on the event object — falling back to a full syncCalendars().');
    syncCalendars();
    return;
  }
  log(`onCalendarChange fired (calendarId: ${calendarId}) — running an incremental delta check.`);
  processCalendarDeltaForCalendar(calendarId);
}

function processCalendarDeltaForCalendar(calendarId) {
  if (isBootstrapActive()) {
    log(`processCalendarDeltaForCalendar: a large-setup import or forms-rebuild sweep is in progress — skipping (it is editing these events itself).`);
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('processCalendarDeltaForCalendar: another sync is already running — skipping this run.');
    return;
  }
  let releasedEarly = false;
  try {
    const result = fetchCalendarDelta(calendarId);
    if (result.fullSyncRequired) {
      log(`Sync token for "${CALENDAR_MAP[calendarId] || calendarId}" was invalid/expired or the API call failed — falling back to a full syncCalendars().`);
      releasedEarly = true;
      lock.releaseLock();
      syncCalendars(); // acquires its own lock
      return;
    }
    if (result.changedEvents.length === 0) {
      log(`No calendar changes for "${CALENDAR_MAP[calendarId] || calendarId}" since the last check.`);
      return;
    }
    applyCalendarDeltaToSheets(calendarId, result.changedEvents);
  } finally {
    if (!releasedEarly) lock.releaseLock();
  }
}

/**
 * Pulls just the events that changed on `calendarId` since the last call,
 * using the Calendar API's incremental sync-token pattern. On the very
 * first call for a calendar (no stored token yet), this instead does a
 * bounded baseline fetch purely to obtain a starting nextSyncToken — it
 * does NOT try to reconcile historical events that way (the daily full
 * syncCalendars() scan, and the menu, already handle that).
 */
function fetchCalendarDelta(calendarId) {
  const tokenKey = getCalendarSyncTokenPropKey(calendarId);
  const props = PropertiesService.getScriptProperties();
  const syncToken = props.getProperty(tokenKey);

  const options = { showDeleted: true, singleEvents: true, maxResults: 250 };
  if (syncToken) {
    options.syncToken = syncToken;
  } else {
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - CALENDAR_SYNC_TOKEN_TIMEMIN_DAYS_BACK);
    options.timeMin = timeMin.toISOString();
  }

  const changedEvents = [];
  let pageToken = null;
  let nextSyncToken = null;

  try {
    do {
      if (pageToken) options.pageToken = pageToken; else delete options.pageToken;
      // Requires the "Calendar" Advanced Service to be enabled for this
      // project (Editor -> Services -> + Calendar API).
      const eventList = Calendar.Events.list(calendarId, options);
      (eventList.items || []).forEach(ev => changedEvents.push(ev));
      pageToken = eventList.nextPageToken;
      if (eventList.nextSyncToken) nextSyncToken = eventList.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const isExpiredToken = msg.indexOf('410') !== -1 || /sync ?token/i.test(msg);
    if (isExpiredToken) {
      log(`⚠️ Calendar sync token for ${calendarId} expired/invalid (${err}) — clearing it so the next check re-baselines.`);
      saveCalendarSyncToken(calendarId, null);
    } else {
      log(`⚠️ Calendar.Events.list failed for ${calendarId} (${err}).`);
    }
    return { fullSyncRequired: true, changedEvents: [] };
  }

  if (nextSyncToken) saveCalendarSyncToken(calendarId, nextSyncToken);

  if (!syncToken) {
    log(`Established an initial Calendar sync token for "${CALENDAR_MAP[calendarId] || calendarId}" — no deltas processed on this baseline call.`);
    return { fullSyncRequired: false, changedEvents: [] };
  }

  return { fullSyncRequired: false, changedEvents };
}

/**
 * Advances every calendar's sync token past changes THIS SCRIPT just made,
 * without acting on them. Call it after anything that edits calendar events,
 * immediately before the calendar-edit triggers go back on.
 *
 * Removing the triggers during a sync only stops them FIRING; it does not
 * stop the changes accumulating. Re-creating them afterwards therefore hands
 * onCalendarChange() a backlog of our own description writes — one per event
 * — every one of which reads as "relevant" and escalates to a full
 * syncCalendars(). One import of 272 events becomes a queue of full syncs,
 * each re-reading every calendar and re-rendering every tab. That storm is
 * what this prevents.
 *
 * The trade-off is deliberate: a genuine third-party edit made in the same
 * window is drained too, and waits for the next scheduled full sync (hourly
 * for registrations, daily for calendars) instead of being reacted to
 * immediately. Losing a few minutes of reaction time beats a self-sustaining
 * sync loop.
 */
function primeCalendarSyncTokens(reason) {
  let primed = 0;
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    try {
      const result = fetchCalendarDelta(calendarId);
      if (result.fullSyncRequired) {
        log(`ℹ️ Could not prime the sync token for "${CALENDAR_MAP[calendarId]}" — its next delta check will re-baseline.`);
        return;
      }
      primed++;
    } catch (err) {
      // Typically the Calendar Advanced Service not being enabled. Nothing
      // here is load-bearing enough to fail a sync over.
      log(`ℹ️ Could not prime the sync token for "${CALENDAR_MAP[calendarId]}" (${err}).`);
    }
  });
  if (primed > 0) log(`Primed ${primed} calendar sync token(s) past this ${reason}'s own edits.`);
  return primed;
}

function isRawEventAllDay(ev) {
  return !!(ev.start && ev.start.date && !ev.start.dateTime);
}

function getRawEventStart(ev) {
  if (!ev.start) return null;
  if (ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start.date) return new Date(ev.start.date);
  return null;
}

/**
 * Decides whether the delta contains anything worth reconciling. A
 * cancelled (event.status === 'cancelled') event always counts as
 * potentially relevant, since a tracked session may have just been
 * deleted. An active event counts if it's a timed event, inside our
 * tracked lookahead window, and matches our title pattern.
 *
 * A still-tentative event ("*" title) is NOT relevant — the full sync
 * would skip it anyway. Note this still catches CONFIRMATION correctly:
 * dropping the asterisk makes the delta's new title non-tentative, which
 * reads as relevant here and triggers the sync that builds its form.
 */
function applyCalendarDeltaToSheets(calendarId, changedEvents) {
  const { start, end } = computeSyncDateRange();
  const locationName = CALENDAR_MAP[calendarId] || calendarId;

  const relevant = changedEvents.some(ev => {
    if (isRawEventAllDay(ev)) return false;
    const evStart = getRawEventStart(ev);
    if (!evStart || evStart < start || evStart > end) return false;
    if (ev.status === 'cancelled') return true;
    const parsed = parseEventTitle(ev.summary);
    return !!parsed && !parsed.isTentative;
  });

  if (!relevant) {
    log(`Calendar delta for "${locationName}" contained ${changedEvents.length} change(s), none relevant to tracked sessions — skipping a full sync.`);
    return;
  }

  log(`Calendar delta for "${locationName}" contained a relevant change — running a full syncCalendars() to reconcile.`);
  invalidateCalendarEventsCache(); // the delta just told us the event set moved
  syncCalendars();
}


