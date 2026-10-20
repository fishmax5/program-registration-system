// =============================================================================
// 99zt — GOOGLE MEET LINKS ON THE CALENDAR EVENT
// =============================================================================
//
// An online or hybrid program needs somewhere to meet, and the somewhere was a
// link somebody pasted into the event by hand — or did not, and found out at
// ten past ten. This puts a Google Meet on the REAL calendar event (conference
// data, the "Join with Google Meet" button every guest already sees) and copies
// its address onto the session table's Meet_Link column, which the program
// dashboard (`78`) then shows beside the other links.
//
// WHO GETS ONE is Program_Settings' Google_Meet column (`03`, `40`):
//
//   Auto / blank  -> yes on the Zoom calendar (a location whose name says
//                    "zoom") or for an event carrying a [Hybrid] tag (`02`);
//                    no otherwise.
//   Yes / No      -> exactly that.
//
// A program with no Program_Settings row yet reads as Auto — the tab is
// refreshed later in the sync, and a brand-new Zoom class must not wait a day.
//
// "NO" NEVER REMOVES A MEET. A link already handed out is somebody's way into
// the room; taking it off the event would strand them. "No" only means this
// code will not create one. The column keeps showing whatever Meet the event
// has, because that is what a guest will see.
//
// ONE MEET PER SERIES. A recurring event is patched on its MASTER, so every
// week shares one link — the link handed out in September still works in March,
// the same promise the registrant sheets (`46`) make. A single event is patched
// on itself. Memoized per execution and per series, like `95`'s rule read.
//
// COST. Only a session row with a BLANK Meet_Link that wants one costs a call
// (one read, and a patch when the event has no Meet yet); a row already showing
// a link costs nothing. Capped per run (MEET_LINK_MAX_EVENTS_PER_RUN) and
// stopped at the sync slice's deadline; what is left is picked up next sync.
//
// OPEN ACCESS IS NOT DECIDED HERE, and cannot be. Whether people can join
// without the host is a Google Workspace setting (Admin console ▸ Apps ▸ Google
// Workspace ▸ Google Meet ▸ Meet safety settings — host management and access
// type), not something the Calendar API sets per event. The column note on
// Program_Settings says so, and so does the log line when a link is made.
// Checking it per meeting would need the Meet REST API and a new OAuth scope,
// which was deliberately not taken on.
//
// Behavior plus self-contained constants; everything it reaches for
// (readNotificationPolicyRows in `70`, readSeriesMaster in `95`,
// isTagOnlyBracket in `20`, the session grid in `96`) it reads at CALL time.
// `21` calls reconcileMeetLinksFromCalendar() after the calendar sync's loop.

/** The Google_Meet dropdown on Program_Settings. Blank reads as Auto. */
const GOOGLE_MEET_SETTING_OPTIONS = ['Auto', 'Yes', 'No'];

/** What the session table's link says. */
const MEET_LINK_LABEL = 'Join Meet';

/** At most this many events looked up (and patched) per run. */
const MEET_LINK_MAX_EVENTS_PER_RUN = 40;

/** A location this matches is the online calendar, where Auto means yes. */
const MEET_LINK_ONLINE_LOCATION_REGEX = /\bzoom\b/i;

/** seriesOrEventKey -> url ('' when none could be had). Per execution. */
let __meetLinkMemo = {};

/** 'auto' | 'yes' | 'no' for a cell of the Google_Meet column. */
function parseGoogleMeetSetting(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (text === 'yes' || text === 'y' || text === 'true' || text === 'on') return 'yes';
  if (text === 'no' || text === 'n' || text === 'false' || text === 'off') return 'no';
  return 'auto';
}

/** Is there a tag-only bracket in this text saying [Hybrid]? Prose brackets never count. */
function textHasHybridTag(text) {
  const raw = String(text || '');
  const brackets = raw.match(/\[[^\]]*\]/g) || [];
  return brackets.some(bracket => {
    const content = normalizeBracketContent(bracket.slice(1, -1));
    return isTagOnlyBracket(content) && HYBRID_WORDS_REGEX.test(content);
  });
}

/** Does this calendar event carry [Hybrid], in its title or its description? */
function eventHasHybridTag(event) {
  if (!event) return false;
  try {
    const title = typeof event.getTitle === 'function' ? event.getTitle() : '';
    const description = typeof event.getDescription === 'function' ? event.getDescription() : '';
    return textHasHybridTag(title) || textHasHybridTag(description);
  } catch (err) {
    return false;
  }
}

/**
 * The one decision, pure: should this session's event have a Meet?
 * `setting` is parseGoogleMeetSetting()'s answer.
 */
function meetLinkWanted(setting, locationName, hybrid) {
  if (setting === 'yes') return true;
  if (setting === 'no') return false;
  return MEET_LINK_ONLINE_LOCATION_REGEX.test(String(locationName || '')) || !!hybrid;
}

/** The program's Google_Meet answer off Program_Settings, 'auto' when it has no row. */
function googleMeetSettingFor(title, location) {
  try {
    const row = readNotificationPolicyRows()[notificationProgramKey(title, location)];
    if (!row) return 'auto';
    const map = getIndexMap(HEADERS.Program_Settings);
    return map['Google_Meet'] === undefined ? 'auto' : parseGoogleMeetSetting(row[map['Google_Meet']]);
  } catch (err) {
    return 'auto';
  }
}

/** The Meet address on an advanced-service event resource, or ''. */
function meetUrlOfEventResource(resource) {
  if (!resource) return '';
  if (resource.hangoutLink) return String(resource.hangoutLink);
  const points = (resource.conferenceData && resource.conferenceData.entryPoints) || [];
  const video = points.filter(p => p && p.entryPointType === 'video' && p.uri)[0];
  return video ? String(video.uri) : '';
}

/**
 * The event resource to read and patch: the series MASTER for a recurring
 * event (so every week shares one Meet), the event itself otherwise. Throws
 * when the event cannot be found through the advanced service.
 */
function meetTargetResourceFor_(calendarId, event) {
  let recurring = false;
  try { recurring = typeof event.isRecurringEvent === 'function' && event.isRecurringEvent(); } catch (err) { recurring = false; }
  const rawId = String(event.getId() || '').trim();
  if (recurring) {
    let seriesId = seriesIdFromInstanceId(rawId);
    if (!seriesId) {
      const series = event.getEventSeries();
      seriesId = String((series && series.getId()) || '').split('@')[0].trim();
    }
    return { key: `series:${calendarId}|${seriesId}`, resource: () => readSeriesMaster(calendarId, seriesId, event) };
  }
  const id = rawId.split('@')[0];
  return {
    key: `event:${calendarId}|${rawId}`,
    resource: () => {
      try {
        return Calendar.Events.get(calendarId, id);
      } catch (err) {
        // An imported event keeps the originating system's UID, which is not
        // the API's id — the same 404 `95` answers by listing on iCalUID.
        const found = Calendar.Events.list(calendarId, {
          iCalUID: rawId, singleEvents: false, showDeleted: false, maxResults: 2
        });
        const item = ((found && found.items) || [])[0];
        if (!item) throw err;
        return item;
      }
    }
  };
}

/**
 * The event's Meet address, creating one first when it has none. '' when it
 * could not be had (no write access, the service refused, still pending).
 * `budget` is { left } — decremented per series actually looked up.
 */
function readOrCreateMeetLink_(calendarId, event, budget, stats) {
  const target = meetTargetResourceFor_(calendarId, event);
  if (Object.prototype.hasOwnProperty.call(__meetLinkMemo, target.key)) return __meetLinkMemo[target.key];
  if (budget.left <= 0) return '';
  budget.left--;
  let url = '';
  let title = '';
  try {
    const resource = target.resource();
    title = String((resource && resource.summary) || '');
    url = meetUrlOfEventResource(resource);
    if (!url && resource && resource.id) {
      const patched = Calendar.Events.patch({
        conferenceData: {
          createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
        }
      }, calendarId, resource.id, { conferenceDataVersion: 1, sendUpdates: 'none' });
      url = meetUrlOfEventResource(patched);
      if (url) stats.created++;
      // A create request can come back "pending" with no address yet; the
      // next sync reads it off the event instead of making a second one.
      else stats.pending++;
    }
  } catch (err) {
    stats.failed++;
    log(`⚠️ Could not add a Google Meet to "${title || event.getTitle()}" on ${calendarId}: ${err}`);
    noteForAdmin('Google Meet links that could not be made',
      `${title || event.getTitle()} — ${err}. The account running the sync needs edit access to that calendar.`);
  }
  __meetLinkMemo[target.key] = url;
  return url;
}

/**
 * Puts each eligible session's Meet link onto its row's Meet_Link, creating
 * the Meet on the event when it has none. Upcoming sessions only, and only
 * rows whose Meet_Link is blank. Returns how many rows changed. Never throws.
 */
function reconcileMeetLinksFromCalendar(registrySheet, groups, options) {
  try {
    return reconcileMeetLinks_(registrySheet, groups, options || {});
  } catch (err) {
    log(`⚠️ Google Meet links were not brought up to date this run: ${err}`);
    return 0;
  }
}

function reconcileMeetLinks_(registrySheet, groups, options) {
  if (typeof Calendar === 'undefined' || !Calendar.Events) return 0;
  const todayKey = formatDateKey(new Date());

  // key -> { event, calendarId } for every upcoming session that wants a Meet.
  const wanted = {};
  const settingMemo = {};
  (groups || []).forEach(group => {
    (group.sessions || []).forEach(session => {
      if (!session || !session.event) return;
      let start = null;
      try { start = session.event.getStartTime(); } catch (err) { start = null; }
      if (!start) return;
      const dateKey = formatDateKey(start);
      if (dateKey < todayKey) return;
      const settingKey = `${group.cleanTitle}|${session.locationName}`;
      if (!(settingKey in settingMemo)) settingMemo[settingKey] = googleMeetSettingFor(group.cleanTitle, session.locationName);
      if (!meetLinkWanted(settingMemo[settingKey], session.locationName, eventHasHybridTag(session.event))) return;
      const key = sessionTimeKey(session.calendarId, group.cleanTitle, dateKey);
      if (!wanted[key]) wanted[key] = { event: session.event, calendarId: session.calendarId };
    });
  });
  if (Object.keys(wanted).length === 0) return 0;

  const model = loadSessionGrid(registrySheet);
  if (!model) return 0;
  const needed = ['Calendar_Source', 'Clean_Title', 'Event_Date', 'Meet_Link'];
  if (needed.some(header => !model.map[header])) return 0; // the column arrives with the next render

  const budget = { left: MEET_LINK_MAX_EVENTS_PER_RUN };
  const stats = { created: 0, pending: 0, failed: 0 };
  let changed = 0;
  let outOfTime = false;
  model.zones.forEach(zone => {
    const sources = sessionGridColumn(model, zone, 'Calendar_Source');
    const titles = sessionGridColumn(model, zone, 'Clean_Title');
    const starts = sessionGridColumn(model, zone, 'Event_Date');
    const links = sessionGridColumn(model, zone, 'Meet_Link');
    if (!sources || !titles || !starts || !links) return;
    let touched = false;
    for (let r = 0; r < zone.count; r++) {
      if (String(links[r] || '').trim()) continue;
      const date = coerceDate(starts[r]);
      if (!date) continue;
      const item = wanted[sessionTimeKey(sources[r], String(titles[r] || '').trim(), formatDateKey(date))];
      if (!item) continue;
      if (options.deadline && Date.now() >= options.deadline) { outOfTime = true; break; }
      const url = readOrCreateMeetLink_(item.calendarId, item.event, budget, stats);
      if (!url) continue;
      links[r] = makeHyperlinkFormula(url, MEET_LINK_LABEL);
      touched = true;
      changed++;
    }
    if (touched) markSessionGridColumn(model, zone, 'Meet_Link');
  });
  flushSessionGrid(model);

  if (changed > 0 || stats.created > 0) {
    log(`Google Meet: ${changed} session row(s) linked, ${stats.created} new Meet(s) created. ` +
      `Whether guests can join before the host is your Workspace Meet setting, not set per event.`);
  }
  if (stats.pending > 0) log(`Google Meet: ${stats.pending} Meet(s) still being set up by Google — read next sync.`);
  if (budget.left <= 0 || outOfTime) log('Google Meet: stopped early this run; the rest are picked up next sync.');
  return changed;
}
