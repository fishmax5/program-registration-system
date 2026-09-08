// ============================================================================
// 17. THE PUBLIC PROGRAM CALENDAR  (what is on, and the form to sign up with)
// ============================================================================
//
// Every page this deployment served before this one was written for somebody
// who is already INSIDE the system: a volunteer at a tablet, a staff member
// with the workbook open, or a member opening the cancel link out of their own
// calendar invitation. The person this file is for has none of those. They
// have heard there is a chair yoga class, they are on a phone, and the only
// answers available to them today are a phone call to the office or a form
// link somebody pasted into an email six weeks ago — which, for a Regular
// program, is last month's form.
//
// So this is one public, read-only page: everything running between now and
// the end of next month, filtered to a week or a month with one tap, and every
// session carrying the CURRENT registration link for that session. Tapping a
// date opens the Google Form this workbook already generates and maintains for
// it. Nothing here registers anybody, and nothing here is a second place a
// registration can come from — the form is still the only door in.
//
// READ BY PROGRAM, NOT BY DATE. The page draws one card per PROGRAM carrying
// its dates (see 87), so each session says which program it belongs to
// (`programKey` — title + building) rather than being filed under a day of
// its own. A weekly class was eight near-identical cards down a phone screen
// and lunch was one a day for two months; both are one card now. Lunch is
// also RENAMED here: the session tab calls those rows "🥡 Lunch Only (no
// program)", which is machinery talking to itself, and on a flyer's calendar
// it is Lunch, at a building the card already names.
//
// WHAT IT DELIBERATELY DOES NOT CARRY, and why the page can be public at all:
//
//   1. NO NAMES. Not a roster, not a count of who, not a household. The only
//      facts about a session that leave the workbook are the ones already
//      printed on the calendar event a member can see anyway — title, date,
//      time, building — plus whether there is room. buildPublicSessionRow()
//      is the whole of that list, and it is built from the SESSION tab only;
//      All_Registrants is never read here.
//   2. NO WRITES, AND SO NO PIN. Every other door page asks for the desk PIN
//      because a link that leaks becomes the ability to write attendance into
//      this workbook. This one cannot write anything, so a PIN would buy
//      nothing and would cost the only thing the page is for: a link that
//      works when it is printed on a flyer.
//   3. NO EDIT LINKS. Edit_Form_Link is the form's own settings page and is
//      never read here — only Form_Response_Link, the published /viewform
//      address a respondent gets.
//
// WHY THE WHOLE WINDOW TRAVELS AT ONCE. The page's one job is to feel instant:
// a person deciding whether to come on Thursday taps between "this week" and
// "this month" three or four times, and a round trip per tap is a page that
// feels broken on a phone on a bus. Two months of sessions is a few hundred
// rows of short strings — smaller than the door's stored index — so the whole
// window is inlined into the page, every filter is arithmetic in the browser,
// and the server is asked again only when somebody pulls to refresh. See
// 87_public_program_calendar_html.gs for what the browser does with it.
//
// WHY IT IS CACHED. Unlike the door pages there is no upper bound on who has
// this link: a flyer, a newsletter, a website. The read itself is one pass
// over one tab, but a hundred people opening it in one morning is a hundred
// passes, so the built snapshot is kept in CacheService for
// PUBLIC_CALENDAR_CACHE_SECONDS and everybody in that window is served the
// same one. Five minutes is chosen against what actually changes: seats.
// A session that fills is stale on somebody's screen for at most five minutes
// and the FORM is the thing that refuses them, not this page — the page has
// never been the authority on whether there is a seat, and does not claim to
// be.
// ============================================================================

/** What lunch is called on a page a stranger reads. See buildPublicSessionRow(). */
const PUBLIC_LUNCH_PROGRAM_TITLE = 'Lunch';

/**
 * THE PARAGRAPH AT THE TOP OF THE PAGE — the only words here written for
 * somebody who does not yet know what this place is.
 *
 * Every other page this deployment serves opens straight onto a list, because
 * everybody holding one already knows whose list it is. This link is printed
 * on a flyer and forwarded by a neighbour, so the page has to say what it is
 * before it says what is on. Kept as one string here rather than typed into
 * the page's markup so the office can change the sentence without touching
 * HTML — and deliberately short: the calendar is what somebody came for.
 *
 * The NAME, PHONE and EMAIL beside it are not repeated here — they are
 * CENTER_NAME / CENTER_PHONE / CENTER_EMAIL in `04`, the same three constants
 * the forms and the sign-in sheet print, so a changed number cannot be right
 * on a form and wrong on the calendar.
 */
const PUBLIC_CALENDAR_INTRO =
  'Classes, clubs, trips, lunch and one-to-one help \u2014 most days, at both of our ' +
  'buildings. Pick a program below and tap a date to open its sign-up form. Would you ' +
  'rather sign up by phone, or have a question about a program? Please call us.';

/** How long a built snapshot is served to everybody who asks. See the banner. */
const PUBLIC_CALENDAR_CACHE_SECONDS = 300;

/**
 * The cache key. THE DATE IS IN IT on purpose: the snapshot's first day is
 * "today", so a snapshot built at 11pm is wrong at midnight in a way no TTL
 * catches — it would go on offering yesterday as the first day for another
 * five minutes. A key that changes with the day cannot do that.
 */
function publicCalendarCacheKey() {
  return `PUBLIC_CALENDAR_V1|${formatDateKey(new Date())}`;
}

/**
 * THE CALL THE PAGE MAKES — and the one buildPublicCalendarHtml() inlines.
 *
 * Payload: { fresh } — anything truthy skips the cache, which is what the
 * page's Refresh control sends. Everything else is ignored: this endpoint is
 * reachable by anyone with the link, so it takes no location, no PIN and no
 * identity, and there is nothing in it to get wrong.
 *
 * Returns { ok, generatedAt, todayKey, horizonKey, locations, sessions } — or
 * { ok: false, message } for a workbook that cannot be read, which the page
 * draws as a sentence rather than as an empty calendar. "Nothing is on" and
 * "we could not look" are the same picture otherwise, and only one of them is
 * a reason to phone the office.
 */
function publicProgramCalendar(payload) {
  const args = (payload && typeof payload === 'string') ? safeParsePublicPayload_(payload)
    : (payload || {});
  const cache = args.fresh ? null : tryGetScriptCache();
  const key = publicCalendarCacheKey();
  if (cache) {
    try {
      const hit = cache.get(key);
      if (hit) return JSON.parse(hit);
    } catch (err) {
      log(`Public calendar cache read failed (${err}) — building it instead.`);
    }
  }
  let snapshot;
  try {
    snapshot = buildPublicProgramCalendar();
  } catch (err) {
    log(`publicProgramCalendar could not read the sessions: ${err}`);
    return {
      ok: false,
      message: 'We could not read the program calendar just now. Please try again in a ' +
        'few minutes, or call the office.'
    };
  }
  if (cache) {
    try {
      cache.put(key, JSON.stringify(snapshot), PUBLIC_CALENDAR_CACHE_SECONDS);
    } catch (err) {
      // A snapshot too large for one cache entry, most likely. Serving it
      // uncached is slower and completely correct, so this is a note, not a
      // failure.
      log(`Public calendar snapshot was not cached (${err}).`);
    }
  }
  return snapshot;
}

/** google.script.run hands strings; a payload that will not parse is an empty one. */
function safeParsePublicPayload_(payload) {
  try {
    return JSON.parse(payload) || {};
  } catch (err) {
    return {};
  }
}

/**
 * THE SNAPSHOT, built from one read of the session tab.
 *
 * The rows come back FORMULA-PRESERVING (getSectionedRows rather than
 * getSectionedRowValues) for one reason: Form_Response_Link holds a
 * `=HYPERLINK("…","View Live Form")` formula, and the values read of that cell
 * is the words "View Live Form" — the link this entire page exists to hand out
 * is only in the formula.
 */
function buildPublicProgramCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  const rows = sheet ? getSectionedRows(sheet, HEADERS.All_Program_Sessions, 'Event_ID') : [];
  const map = getIndexMap(HEADERS.All_Program_Sessions);

  const todayKey = formatDateKey(new Date());
  // The same horizon the door's month picker uses, and for the same reason:
  // somebody holding a paper calendar asks about October, and a window that
  // stops on the 19th of it looks like a month with nothing in the back half.
  const horizonKey = deskMonthHorizonKey(new Date());

  const sessions = [];
  const locations = {};
  rows.forEach(row => {
    const session = buildPublicSessionRow(row, map, todayKey, horizonKey);
    if (!session) return;
    sessions.push(session);
    if (session.location) locations[session.location] = true;
  });

  sessions.sort(comparePublicSessions_);

  return {
    ok: true,
    // WHO THIS IS, for the one reader who does not already know. See
    // PUBLIC_CALENDAR_INTRO — and note the addresses are only for buildings
    // that actually have something on, for the same reason the location
    // filter is: a page that names a building with nothing in it is a page
    // somebody drives to.
    intro: {
      name: CENTER_NAME,
      blurb: PUBLIC_CALENDAR_INTRO,
      phone: CENTER_PHONE,
      email: CENTER_EMAIL,
      places: Object.keys(locations).sort().map(describeLocationWithAddress)
    },
    // Stamped so the page can say how old what it is showing is, rather than
    // presenting a five-minute-old cache as this second's truth.
    generatedAt: Utilities.formatDate(new Date(), TIMEZONE, 'MMM d, h:mm a'),
    todayKey,
    horizonKey,
    // The buildings that actually have something on, not every configured
    // calendar: a filter chip for a location with no sessions behind it is a
    // chip that empties the page when it is tapped.
    locations: Object.keys(locations).sort(),
    sessions
  };
}

/** Date first, then start time as it is written, then title. */
function comparePublicSessions_(a, b) {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
  if (a.sortTime !== b.sortTime) return a.sortTime < b.sortTime ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * ONE SESSION ROW, AS MUCH OF IT AS A STRANGER MAY SEE — or null for a row
 * that does not belong on a public calendar at all.
 *
 * Dropped here rather than in the page, because a session that must not be
 * shown must not be SENT: the page is one string of HTML on the open internet,
 * and a filter in its JavaScript is not a filter.
 *
 *   - anything outside today → end of next month;
 *   - a row with no title, which is a half-written or half-deleted row;
 *   - a CANCELLED session (Status), which is the one status that means the
 *     thing is not happening.
 */
function buildPublicSessionRow(row, map, todayKey, horizonKey) {
  const date = coerceDate(row[map['Event_Date']]);
  if (!date) return null;
  const dateKey = formatDateKey(date);
  if (dateKey < todayKey || dateKey > horizonKey) return null;

  const title = String(row[map['Clean_Title']] || '').trim();
  if (!title) return null;

  const status = String(row[map['Status']] || '').trim();
  if (/cancel/i.test(status)) return null;

  const eventId = String(row[map['Event_ID']] || '').trim();
  const lunch = isLunchOnlyEventId(eventId);
  const linkCell = row[map['Form_Response_Link']];
  const url = hyperlinkFormulaUrl(linkCell);
  const noRegistration = isNoRegistrationColumnValue(row[map['No_Registration']])
    || String(linkCell || '').trim() === NO_REGISTRATION_LINK_LABEL;
  const waitlistOnly = isWaitlistOnlyColumnValue(row[map['Waitlist_Only']])
    || status === WAITLIST_ONLY_STATUS;

  const location = String(row[map['Location']] || '').trim();
  // WHAT THE LUNCH ROWS ARE CALLED HERE. On the session tab a lunch-only row
  // is named for the machinery that made it — "🥡 Lunch Only (no program)",
  // or "Lunch @ Narberth — Chx Parm" — and a stranger reading a flyer's
  // calendar has no idea what "(no program)" is denying. It is lunch, at a
  // building, and the building is already on the card: one program called
  // Lunch per location, which is also what stops twenty dated lunch rows
  // filling the page.
  const publicTitle = lunch ? PUBLIC_LUNCH_PROGRAM_TITLE : title;

  return {
    // Nothing is keyed on this in the workbook — it is the browser's own list
    // key, so a redraw reuses a card instead of rebuilding one under a finger.
    id: `${dateKey}|${eventId || title}`,
    dateKey,
    weekday: Utilities.formatDate(date, TIMEZONE, 'EEE'),
    dayLabel: Utilities.formatDate(date, TIMEZONE, 'EEEE, MMMM d'),
    // The short form the date chips on a program card are drawn with — one
    // per session, so the label a person taps is built once, here, rather
    // than by parsing a date key in the browser.
    shortLabel: Utilities.formatDate(date, TIMEZONE, 'EEE MMM d'),
    monthLabel: Utilities.formatDate(date, TIMEZONE, 'MMMM yyyy'),
    title: publicTitle,
    // WHAT THE PAGE GROUPS ON. The calendar reads by PROGRAM, not by date:
    // a weekly class is one card carrying its dates, not six cards a page
    // apart. Title + building, because that is the thing a person signs up
    // for — a `[Shared]` program running in two buildings is two cards, and
    // has to be: they are two different rooms to turn up at.
    programKey: `${(publicTitle || '').toLowerCase()}|${location.toLowerCase()}`,
    location,
    time: publicSessionTimeLabel_(row, map, date),
    // Sorting on the CELL is what puts 9:30 AM above 1:00 PM; sorting on the
    // label would put "1:00 PM" first, every day, on every building.
    sortTime: publicSessionSortTime_(date),
    lunch,
    club: isClubColumnValue(row[map['Club']]),
    appointment: isAssistanceColumnValue(row[map['Personalized_Assistance']]),
    // The link is withheld from a session nobody may register for, so a card
    // that says "just come along" cannot also be a card that opens a form.
    url: (noRegistration || !url) ? '' : url,
    state: publicSessionState_(noRegistration, waitlistOnly, url, status),
    seats: publicSeatsPhrase_(row, map, noRegistration, waitlistOnly)
  };
}

/**
 * THE TIME, AS WORDS — BUILT, NEVER READ OFF THE CELL.
 *
 * Event_Time on the session tab is a FORMULA (see setEventTimeFormulas), and
 * this file's read is deliberately formula-preserving because the sign-up
 * link exists only inside a formula. So the Event_Time cell arrives here as
 * `=IF(W9="",TEXT(A9,"h:mm AM/PM"),…)` — which is exactly what a page printed
 * on the open internet put where the time should have been.
 *
 * Rebuilt from the row's own start and end instead, which is where that
 * formula was reading it from anyway. The cell is still the fallback for a
 * row that holds words rather than a formula (a hand-typed or legacy row);
 * a value that starts with '=' is never one of those.
 */
function publicSessionTimeLabel_(row, map, date) {
  const start = formatTimeLabel(date);
  const endCell = map['Event_End'] === undefined ? '' : row[map['Event_End']];
  const end = formatTimeLabel(coerceDate(endCell));
  if (start && end && end !== start) return `${start} \u2013 ${end}`;
  if (start) return start;
  const raw = String(row[map['Event_Time']] || '').trim();
  return raw.charAt(0) === '=' ? '' : raw;
}

/** 'HHmm' from the session's start, for sorting. */
function publicSessionSortTime_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'HHmm');
}

/**
 * WHAT THE CARD SAYS ABOUT SIGNING UP, as one of four words the page draws
 * differently. The distinction that matters to a stranger is not how full a
 * session is, it is whether there is something for them to DO:
 *
 *   open       there is a form and there is room — tap it
 *   waitlist   there is a form and it will put you on a waiting list
 *   none       no registration is taken; come along
 *   soon       registration for this one is not open yet — the sessions are
 *              on the calendar but the form has not been generated, which is
 *              a real and ordinary state a month out (see buildEventGroups)
 */
function publicSessionState_(noRegistration, waitlistOnly, url, status) {
  if (noRegistration) return 'none';
  if (!url) return 'soon';
  if (waitlistOnly) return 'waitlist';
  return /almost/i.test(status) ? 'almost' : 'open';
}

/**
 * THE SEAT SENTENCE, or ''. Deliberately vague at the top end and exact at
 * the bottom: "3 seats left" is what changes somebody's afternoon, and
 * "37 registered" is an internal number that tells a stranger nothing and
 * tells a neighbour how popular their neighbour's class is.
 */
function publicSeatsPhrase_(row, map, noRegistration, waitlistOnly) {
  if (noRegistration) return '';
  if (waitlistOnly) return 'Waiting list';
  const remaining = Number(row[map['Remaining_Seats']]);
  const capacity = Number(row[map['Max_Capacity']]);
  if (!capacity || !isFinite(capacity) || capacity <= 0) return '';
  if (!isFinite(remaining)) return '';
  if (remaining <= 0) return 'Waiting list';
  if (remaining <= Math.max(1, Math.ceil(capacity * 0.15))) {
    return remaining === 1 ? '1 seat left' : `${remaining} seats left`;
  }
  return 'Seats available';
}

// ============================================================================
// 17b. THE EMBED  (the same page, inside somebody else's website)
// ============================================================================
//
// The link above is the thing you print. This is the thing you PASTE — into
// the organization's own site, where a Google Calendar embed would otherwise
// be: a grid in Google's typeface with Google's chrome around it, which shows
// a title and a time and cannot say whether there is a seat, cannot carry the
// sign-up form for THIS month's session, and cannot be made to look like the
// page it sits on. This page can do all three, and it is already built.
//
// So an embed is not a second page. It is the SAME route with ?embed=1 on it,
// which does three things and no more:
//
//   1. TAKES THE CHROME OFF. No heading, no page background of its own, no
//      footer paragraph — the host page has already said who this
//      organization is, and a card with its own grey backdrop inside a white
//      website reads as a screenshot of another site rather than as part of
//      this one.
//   2. LETS THE FRAME BE THE RIGHT HEIGHT. An iframe has a fixed height and
//      the page inside it does not; the two disagree as an inner scrollbar,
//      which on a phone is the interaction where a person scrolls the frame
//      when they meant to scroll the page and concludes the site is broken.
//      The page measures itself and posts its height out (see the resizer in
//      publicCalendarEmbedSnippet) — the host listens and grows the frame, so
//      there is one scrollbar on the screen and it belongs to the website.
//   3. LETS ONE PAGE BE ONE BUILDING. ?building= pins the building and ?span=
//      the range — the same ?span= the two printed links carry, read by the
//      same function — so the Narberth page embeds Narberth's week and the
//      events page embeds everything.
//
// WHAT IT DELIBERATELY DOES NOT DO IS RELAX ANYTHING. The embed reads the same
// snapshot the public link reads, through the same function, with the same
// fields in it — there is no second read here and nothing new leaves the
// workbook. The one permission granted anywhere for this is the `frameable`
// flag on the public route in DOOR_ROUTES, which is a per-route answer for the
// reason its comment gives: this page cannot write.
// ============================================================================

/**
 * What the parent page listens for. Versioned in the STRING rather than in a
 * key, because the listener is pasted into somebody else's website and will
 * still be running there long after this file has moved on: a message shape
 * that changes gets a new type, and the old snippet goes on being ignored
 * politely rather than resizing a frame to the wrong number.
 */
const PUBLIC_CALENDAR_EMBED_MESSAGE = 'programCalendarHeight.v1';

/**
 * THE PRESENTATION OPTIONS IN A REQUEST — and nothing else is read from one.
 *
 * Deliberately separate from publicProgramCalendar(): what the snapshot
 * CONTAINS must not depend on the query string, because the snapshot is cached
 * and served to everybody, and because a page whose payload varies with its URL
 * is a page somebody will one day widen with a parameter. These are how the
 * already-public payload is DRAWN, so they are read here and applied in the
 * browser.
 *
 * { embed, location, days } — location is what the visitor typed and is
 * resolved against the real buildings in buildPublicCalendarHtml(), days is
 * null when the URL did not ask, meaning "whatever this browser last chose".
 */
function publicCalendarViewOptions(params) {
  const p = params || {};
  return {
    embed: isPublicCalendarEmbedRequest_(p),
    // ?building= is the word a person writing the embed reaches for; ?location=
    // is what every other page on this deployment already calls it, and a URL
    // that carries both is answered by the one that is about this page.
    location: String(p.building || p.location || p.loc || '').trim(),
    // ONE VOCABULARY FOR THE RANGE, and it is the printed link's. An embed
    // pinning a week and a newsletter link opening on one are the same thing
    // said by two different people, so they are read by one function
    // (publicCalendarSpanRequested_, in 60) and a spelling that works in a
    // newsletter works in an iframe without anybody having to know it should.
    span: publicCalendarSpanRequested_(p)
  };
}

/**
 * Is this request asking for the embed skin? Any of the usual ways somebody
 * writes "yes" — and the bare `?embed` a hand-typed URL ends up with, which
 * arrives as an empty string and would otherwise read as "no".
 */
function isPublicCalendarEmbedRequest_(params) {
  const p = params || {};
  if (!Object.prototype.hasOwnProperty.call(p, 'embed')) return false;
  const value = String(p.embed === undefined || p.embed === null ? '' : p.embed)
    .trim().toLowerCase();
  return value !== 'no' && value !== 'false' && value !== '0';
}

/**
 * THE URL A WEBSITE FRAMES. Same route, same page, ?embed=1 on it.
 *
 * options: { location, span } — both optional, both pins (see the banner), and
 * the span is spelled the way the printed links spell it. Returns '' when the
 * script has never been deployed, which the dialog draws as "no link yet"
 * rather than as a snippet nobody can use.
 */
function publicCalendarEmbedUrl(options) {
  const opts = options || {};
  return checkInPageUrl({
    mode: 'public',
    span: opts.span || '',
    params: { embed: '1', building: opts.location || '' }
  });
}

/**
 * THE WHOLE THING SOMEBODY PASTES INTO THEIR WEBSITE, as one string.
 *
 * An <iframe> and eleven lines of listener. The listener is what stops the
 * inner scrollbar, and it is written to be safe in a page it knows nothing
 * about: it answers only messages from THIS frame's own window (`event.source
 * !== frame.contentWindow` is the check that matters — an origin string is not
 * available to compare against reliably across Google's two web-app hostnames),
 * only messages carrying this file's own type, and it only ever sets a height.
 *
 * The `height` on the iframe itself is the FALLBACK, not the plan: a visitor
 * whose browser drops the message, or a site whose CSP blocks the inline
 * script, gets a 900px calendar that scrolls inside itself — which is what a
 * Google Calendar embed does on its best day.
 */
function publicCalendarEmbedSnippet(options) {
  return publicEmbedSnippetFor_(publicCalendarEmbedUrl(options), {
    id: 'program-calendar',
    title: 'Programs and sign-ups'
  });
}

/**
 * THE SNIPPET, FOR EITHER PUBLIC PAGE. The calendar and the regular-programs
 * page are embedded the same way and report their height with the same
 * message, so the eleven lines are written once — and given their own frame
 * `id`, because a website that embeds BOTH would otherwise have two listeners
 * resizing one frame and one page that never grows.
 */
function publicEmbedSnippetFor_(url, options) {
  if (!url) return '';
  const opts = options || {};
  const id = String(opts.id || 'program-calendar');
  const title = String(opts.title || 'Programs and sign-ups');
  return [
    `<iframe id="${id}" src="${url}"`,
    `        title="${title}" loading="lazy"`,
    '        style="width:100%;height:900px;border:0;display:block"></iframe>',
    '<script>',
    '(function () {',
    `  var frame = document.getElementById(${JSON.stringify(id)});`,
    '  window.addEventListener("message", function (event) {',
    '    if (!frame || event.source !== frame.contentWindow) return;',
    '    var data = event.data;',
    `    if (!data || data.type !== ${JSON.stringify(PUBLIC_CALENDAR_EMBED_MESSAGE)}) return;`,
    '    var height = Number(data.height);',
    '    if (height > 0) frame.style.height = Math.ceil(height) + "px";',
    '  });',
    '}());',
    '</script>'
  ].join('\n');
}
