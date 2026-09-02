// ============================================================================
// 16. THE CHECK-IN PAGE  (doGet — the same marking, on a tablet at the door)
// ============================================================================
//
// Quick Mark is a MODAL DIALOG INSIDE THE SPREADSHEET, and that is the whole
// of what is wrong with it at a front door. To use it a person has to be
// signed into an account with edit access to the workbook, have the workbook
// open, and have the sheet in front of them — which means the sign-in desk is
// wherever the laptop with the spreadsheet on it happens to be. It is also 560
// pixels of dropdowns built for a mouse, which is not what a volunteer holding
// a tablet in front of a queue of thirty people has.
//
// This is the same job on a URL. doGet() serves a page from this same script,
// so there is no second system to deploy, no API to authenticate against and
// no copy of the data anywhere: it reads the lists this file already builds,
// and it writes through the function Quick Mark already writes through
// (applyQuickMarkFromDialog) — same lock, same row matching, same wording.
//
// WHAT IS DELIBERATELY DIFFERENT FROM THE DIALOG:
//
//   1. IT SHOWS THE ROSTER, not a dropdown. A dropdown is a thing you search;
//      a door list is a thing you look at. The page draws every registered
//      name as a row with a large target, and a name already marked carries a
//      tick — which is what stops one person being marked twice and what
//      answers "has Ruth arrived yet" without anybody being asked. That state
//      is served from the door's own stored rosters, with the marks made since
//      they were built laid over the top (section 16c), so choosing a session
//      costs a cache read rather than a pass over a year of registrations.
//      Refresh list reads the tab itself, for a desk that wants to insist.
//   2. IT IS ONE TAP PER PERSON. Attended is what a door records. Lunch is a
//      second tap on the same row, for the desk that hands meals over at the
//      same table. Everything else Quick Mark can do — registering a walk-in,
//      standing club places, meal counts, moving an appointment — stays in the
//      dialog, which has room to ask the questions those need.
//   3. IT CAN BE PINNED TO A LOCATION with ?location=Narberth, so the tablet
//      that lives at Ashbridge opens on Ashbridge's sessions every morning
//      instead of asking a volunteer to pick the building they are standing
//      in.
//   4. IT UNDOES. A tap on a checked-in row offers to clear the mark, because
//      the failure mode of a large touch target is hitting the wrong one, and
//      a volunteer who cannot take a mistake back will stop using the page.
//
// ACCESS, AND WHY THERE IS A PIN. A web app deployed "execute as me, anyone
// with the link" turns that link into the ability to write attendance into
// this workbook — and that is the deployment a shared tablet with no Google
// account signed into it actually needs. So a PIN can be set (a Script
// Property, from the menu item on Settings & Fixes): when one is set, the page
// asks for it once, remembers it in that tablet's own browser, and every write
// is refused without it. With no PIN set nothing is gated, which is the right
// default for the other deployment — "anyone in the organization", where
// Google has already asked who you are.
//
// The PIN is a door lock, not a safe: what it stops is a link forwarded to the
// wrong mailing list becoming an open write endpoint. Deploy to the whole
// internet only with one set.
// ============================================================================

/** Script Property holding the check-in page's PIN. Absent/blank = no gate. */
const CHECK_IN_PIN_PROP_KEY = 'CHECK_IN_PIN';

/**
 * Script Property holding THE ADDRESS STAFF ACTUALLY PASTED, and why it has to
 * exist.
 *
 * ScriptApp.getService().getUrl() is not reliably the published address, and
 * the ways it is wrong are all silent:
 *
 *   - on a container-bound script it commonly hands back the script editor's
 *     own test address, the one ending "/dev", which opens perfectly for
 *     whoever owns the script and answers everybody else with "Sorry, unable
 *     to open the file at this time" or a Google sign-in wall;
 *   - after a deployment is deleted and remade it can keep reporting the OLD
 *     deployment's id, which is an /exec address that looks completely
 *     ordinary and 404s;
 *   - and it says nothing at all about which VERSION a deployment is pinned
 *     to, so a link that works can still be serving code from six weeks ago.
 *
 * None of that is guessable from inside the script. What is knowable is what
 * the Deploy screen says, and a person is standing in front of it when they
 * publish — so the dialog asks them to paste it once, and every link this file
 * hands out is built from that. getUrl() stays as the fallback and as the
 * thing the dialog compares against, never as the last word.
 */
const CHECK_IN_WEB_APP_URL_PROP_KEY = 'CHECK_IN_WEB_APP_URL';

// ============================================================================
// TEMPORARY DEPLOYMENT CANARY — DELETE THIS BLOCK WHEN THE TEST IS DONE.
// ============================================================================
// Nothing here is a feature. It exists to answer ONE question that no amount
// of reading the pages can answer from the outside: is the address on the
// tablet actually serving THIS code, or a version the deployment is still
// pinned to? Both pages are short-circuited to a single word, so a page that
// still draws program cards is, by definition, old code.
//
// Flip to false (or delete the block and the early return in doGet()) to put
// the real pages back.
const CHECK_IN_CANARY = true;

/** The word both pages are replaced with while the canary is on. */
const CHECK_IN_CANARY_TEXT = 'CANARY';

/**
 * The canary page: the word, and the few facts that make it worth loading.
 *
 * The mode and location are echoed back because a deployment that serves the
 * WRONG PAGE looks identical to one serving old code until you can see which
 * branch of doGet() ran. The timestamp proves the response was generated now
 * rather than pulled from a browser or proxy cache.
 */
function buildCheckInCanaryHtml(mode, location) {
  const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;
             min-height:100vh;font-family:Roboto,Arial,sans-serif;text-align:center">
  <div>
    <div style="font-size:56px;font-weight:700;letter-spacing:2px">${CHECK_IN_CANARY_TEXT}</div>
    <div style="margin-top:14px;font-size:14px;color:#5F6368">
      page: ${mode} &middot; location: ${location || 'all'}<br>served: ${stamp}
    </div>
  </div>
</body></html>`;
}

/**
 * THE WEB APP ENTRY POINT. Serves ONE OF TWO PAGES:
 *
 *   (default)      the walk-in sign-in page — section 16c, the door.
 *   ?mode=session  the session check-in roster — section 16, for staff.
 *
 * ?location=Narberth pins either of them to one building (see the section
 * note). Anything else in the query string is ignored rather than refused — a
 * URL that has been through a QR code generator and back tends to collect
 * parameters.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};

  // TEMPORARY: see the canary block above. Deliberately the FIRST thing doGet()
  // does — before the location match, before the PIN check, before either page
  // is built — so that nothing downstream (a stored index, the sign-in page's
  // boot snapshot, a PIN gate) can be what you are actually looking at.
  if (CHECK_IN_CANARY) {
    return HtmlService
      .createHtmlOutput(buildCheckInCanaryHtml(
        checkInRosterModeRequested(params) ? 'check-in (mode=session)' : 'sign-in (door)',
        String(params.location || params.loc || '').trim()
      ))
      .setTitle(CHECK_IN_CANARY_TEXT)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const requested = String(params.location || params.loc || '').trim();
  const location = matchCheckInLocation(requested);
  const pinRequired = isCheckInPinSet();

  // TWO PAGES, ONE DEPLOYMENT. ?mode=session is the staff-facing session
  // roster (section 16); everything else is the door (section 16c), because
  // the door is what the link on the tablet by the entrance is for and a
  // volunteer should not have to choose a page before they can use one.
  // A deployment cannot be re-published per page, so the mode rides in the
  // query string alongside the location pin.
  // THE CANCEL PAGE COMES FIRST, because it is the only one of the three that
  // is opened by a MEMBER rather than by staff — from the link inside the
  // calendar invitation they were sent (see buildRegistrationLinkLine). It
  // carries its own ?form= and needs no location pin and no PIN: a person
  // cancelling their own booking is not standing at the door, and a page that
  // asks a ninety-year-old for a four-digit staff code is a page that gets a
  // phone call instead. It identifies them from their own contact details
  // instead — see the section note in 67.
  const cancelForm = String(params.form || '').trim();
  if (/^cancel$/i.test(String(params.mode || '').trim()) && cancelForm) {
    return HtmlService.createHtmlOutput(buildCancelPageHtml({
      formId: cancelForm,
      programLabel: cancelPageProgramLabel(cancelForm)
    }))
      .setTitle('Cancel Your Place')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const html = checkInRosterModeRequested(params)
    // Only ever a STORED index, never a build — the same rule the dialog
    // follows (readyQuickMarkIndex()), and for a stronger reason here: a web
    // app has no toast to apologise with, and a volunteer looking at a spinner
    // assumes the page is broken. A workbook with no stored lists yet gets a
    // page that says so in words.
    // ?page=register opens the roster page on its SECOND screen — the one
    // that puts somebody on a future session. Deliberately not the default:
    // the tablet is opened forty times a morning to mark people in and twice a
    // week to register one, and the common case must not cost a tap. A link
    // with this on it is the one a program director keeps for the desk phone.
    ? buildCheckInHtml(readyCheckInSessionIndex(), {
      location, pinRequired,
      page: /^register$/i.test(String(params.page || '').trim()) ? 'register' : 'checkin'
    })
    : buildWalkInHtml({
      location,
      pinRequired,
      locations: checkInLocations(),
      rosterUrl: checkInPageUrl({ location, mode: 'session' })
    });
  // DELIBERATELY NOT setXFrameOptionsMode(ALLOWALL). This page writes to the
  // workbook, and letting any site frame it is what turns a tap on somebody
  // else's page into a check-in on this one. Nothing needs to embed it — it is
  // opened on a tablet, not built into another site.
  return HtmlService.createHtmlOutput(html)
    .setTitle(checkInRosterModeRequested(params) ? 'Check In' : 'Sign In')
    // The tablet case is the entire point, so say so to the browser rather
    // than serving a page that renders at desktop width and needs pinching.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * One of this web app's own URLs — the base deployment address with a
 * ?location= pin and a ?mode= on it.
 *
 * Built in ONE place because it is written in three (the doGet() footer link,
 * the menu dialog's link list, and anything a QR code is generated from), and
 * three hand-assembled query strings is how one of them ends up missing the
 * mode and quietly serving the wrong page. Returns '' when the script has
 * never been deployed, which every caller renders as "no link yet" rather
 * than as a broken one.
 */
function checkInPageUrl(options) {
  const opts = options || {};
  const base = readCheckInBaseUrl();
  if (!base) return '';
  const parts = [];
  if (opts.location) parts.push(`location=${encodeURIComponent(opts.location)}`);
  if (opts.mode) parts.push(`mode=${encodeURIComponent(opts.mode)}`);
  if (!parts.length) return base;
  return `${base}${base.indexOf('?') === -1 ? '?' : '&'}${parts.join('&')}`;
}

/**
 * THE ADDRESS EVERY LINK IS BUILT FROM: what staff pasted, else what the
 * script reports. See CHECK_IN_WEB_APP_URL_PROP_KEY for why those are two
 * different things.
 */
function readCheckInBaseUrl() {
  const saved = readSavedCheckInWebAppUrl();
  if (saved) return saved;
  return readScriptReportedWebAppUrl();
}

/** What staff pasted, or ''. */
function readSavedCheckInWebAppUrl() {
  try {
    return String(PropertiesService.getScriptProperties()
      .getProperty(CHECK_IN_WEB_APP_URL_PROP_KEY) || '').trim();
  } catch (err) {
    log(`Could not read the saved web app URL (${err}).`);
    return '';
  }
}

/** What the script says its own address is, or '' — never trusted on its own. */
function readScriptReportedWebAppUrl() {
  try {
    return stripWebAppDomainSegment(String(ScriptApp.getService().getUrl() || '').trim());
  } catch (err) {
    log(`Could not read the web app URL (${err}).`);
    return '';
  }
}

/**
 * THE /a/<domain>/ SEGMENT, and why it comes off every address this file
 * touches. Google hands a Workspace account its web app addresses in two
 * interchangeable spellings of the same deployment:
 *
 *   https://script.google.com/macros/s/AKfy…/exec              opens for anyone
 *   https://script.google.com/a/example.org/macros/s/AKfy…/exec
 *
 * The second is not a harmless prefix. It tells the browser "serve this as
 * example.org", so it resolves against whichever Google account that browser
 * has in that domain — and a tablet signed into no account, or a laptop whose
 * FIRST signed-in account is personal, is handed the account chooser or
 *
 *     "Sorry, unable to open the file at this time."
 *
 * while the plain spelling of the SAME deployment opens immediately. That is
 * the difference between the link copied out of the Deploy screen and the one
 * this dialog used to print: not the deployment, the spelling.
 *
 * getUrl() returns the domain-scoped form on a Workspace script, so the strip
 * happens where the address is read as well as where one is pasted — a staff
 * member pasting the /a/ form should not be re-saving the same fault.
 *
 * An address that is not an Apps Script web app URL is returned untouched:
 * this function's job is one path segment, and refusing a shape is
 * normalizeCheckInWebAppUrl()'s.
 */
function stripWebAppDomainSegment(url) {
  return String(url || '').replace(
    /^(https:\/\/script\.google\.com)\/a\/[^/]+(\/macros\/s\/)/i, '$1$2');
}

/**
 * The deployment id out of a web app address, or '' — the part that says WHICH
 * deployment, as opposed to which spelling of it. Two addresses that differ
 * here are two different deployments, with their own "Who has access" settings
 * and their own pinned versions; two that agree are the same one.
 */
function webAppDeploymentId(url) {
  const match = String(url || '').match(/\/macros\/s\/([^/?#]+)/);
  return match ? match[1] : '';
}

/**
 * A pasted deployment address, tidied and judged: { ok, url, message }.
 *
 * THE QUERY STRING IS CUT OFF. What gets copied is very often a link that has
 * already been opened once — "…/exec?location=Narberth" — and building
 * "?location=X" onto that gives an address with the parameter twice, where
 * whichever one Apps Script reads last wins. Cutting at the "?" makes a
 * copy-paste from the browser bar work exactly like one from the Deploy
 * screen.
 *
 * A /dev address is REFUSED rather than saved with a warning beside it. It is
 * the single most common way to end up with a link that works for the person
 * who set it up and for nobody else, and saving it would be this dialog
 * carefully recording the exact mistake it exists to prevent.
 */
function normalizeCheckInWebAppUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: true, url: '', message: '' };
  // See stripWebAppDomainSegment(): the /a/<domain>/ spelling is the one that
  // dead-ends on a tablet, and it is exactly the one a signed-in staff member
  // copies out of their own browser bar.
  const cut = stripWebAppDomainSegment(raw.split('#')[0].split('?')[0].trim());
  if (!/^https:\/\//i.test(cut)) {
    return { ok: false, url: '', message: 'That is not a web address — it should start with https://' };
  }
  if (/\/dev$/i.test(cut)) {
    return {
      ok: false,
      url: '',
      message: 'That is the test address (it ends in /dev). It opens only for accounts that can ' +
        'edit this script — a tablet gets "unable to open the file at this time". Use Deploy ▸ ' +
        'Manage deployments and copy the Web app URL, which ends in /exec.'
    };
  }
  if (!/\/exec$/i.test(cut)) {
    return {
      ok: false,
      url: '',
      message: 'A published web app address ends in /exec. Copy the one under Deploy ▸ Manage ' +
        'deployments ▸ Web app.'
    };
  }
  return { ok: true, url: cut, message: '' };
}

/**
 * Saves (or clears) the deployment address the links are built from. Called
 * from the dialog.
 */
function setCheckInWebAppUrl(url) {
  const judged = normalizeCheckInWebAppUrl(url);
  if (!judged.ok) return { ok: false, savedUrl: readSavedCheckInWebAppUrl(), message: `⚠️ ${judged.message}` };
  const props = PropertiesService.getScriptProperties();
  if (!judged.url) {
    props.deleteProperty(CHECK_IN_WEB_APP_URL_PROP_KEY);
    return {
      ok: true,
      savedUrl: '',
      message: 'Cleared. The links now use whatever address the script reports, which is not ' +
        'always the published one.'
    };
  }
  props.setProperty(CHECK_IN_WEB_APP_URL_PROP_KEY, judged.url);
  return { ok: true, savedUrl: judged.url, message: `Saved. Every link below is now built from ${judged.url}` };
}

/**
 * THE SESSION LIST FOR THE CHECK-IN PAGE, and the fallback that stops the page
 * being blank.
 *
 * The stored Quick Mark lists are the fast path and the right one: they carry
 * six months of sessions, and they cost nothing to serve. But they only exist
 * once something has built them — a sync, or ⚡ Rebuild Quick Mark Lists — and
 * a workbook that has been deployed before it has ever been synced serves a
 * page reading "the lists have not been built yet", which from a tablet is
 * indistinguishable from a page that does not work. THAT is what "it opens but
 * there are no names on it" is.
 *
 * So when there are no stored lists, the sessions are read live instead. It is
 * a much smaller question than the one buildQuickMarkIndex() answers — the
 * next fortnight, off the session table, with no names attached, because the
 * roster is fetched per session anyway (see checkInRoster()) — and it is
 * bounded, so it cannot become the slow path by accident.
 */
function readyCheckInSessionIndex() {
  // The PROJECTION first, when one has been stored: it is the same session
  // list without the roll, the names and the needs the page never reads, and
  // reading it is a fraction of the work of ungzipping the whole dialog index
  // on the one path where somebody is watching a blank tablet. See
  // storeCheckInPageIndex().
  const page = storedCheckInPageIndex();
  if (page && page.sessions && page.sessions.length) return page;
  const stored = readyQuickMarkIndex();
  if (stored && stored.sessions && stored.sessions.length) return stored;
  log('ℹ️ The check-in page found no stored session lists — reading the next two weeks live.');
  try {
    return buildLiveCheckInSessionIndex();
  } catch (err) {
    log(`ℹ️ The live session read failed too (${err}) — serving the page with no lists.`);
    return null;
  }
}

/** How far ahead the live fallback looks. A door is not a planning tool. */
const CHECK_IN_LIVE_SESSION_DAYS = 14;

/**
 * An index-shaped object carrying ONLY what the check-in page reads from one:
 * `sessions` and `builtAt`. The dialog's index carries names, the member roll
 * and the standing needs as well; this page uses none of them (it reads its
 * roster live), so none of them is built.
 */
function buildLiveCheckInSessionIndex() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  const sessions = [];
  if (dash) {
    const headers = HEADERS.Master_Program_Dashboard;
    const map = getIndexMap(headers);
    const todayKey = formatDateKey(new Date());
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + CHECK_IN_LIVE_SESSION_DAYS);
    const horizonKey = formatDateKey(horizon);
    const seen = {};
    readAllSectionedRowValues(dash, headers, 'Event_ID').forEach(row => {
      const title = String(row[map['Clean_Title']] || '').trim();
      const location = String(row[map['Location']] || '').trim();
      const date = coerceDate(row[map['Event_Date']]);
      if (!title || !date) return;
      const dateKey = formatDateKey(date);
      if (dateKey < todayKey || dateKey > horizonKey) return;
      const label = `${title}${LOCATION_LABEL_SEPARATOR}${formatDateLabel(date)}`;
      const key = `${location}${QUICK_MARK_SESSION_KEY_SEPARATOR}${label}`;
      if (seen[key]) return;
      seen[key] = true;
      sessions.push({
        value: label,
        label,
        group: dateKey === todayKey ? 'Today' : 'Coming up',
        location,
        title,
        dateKey,
        // Never offered for booking from this page, so the appointment facts
        // the dialog carries would be dead weight — and the page only reads
        // them to decide whether to show a time dropdown it does not have.
        byAppointment: false,
        times: [],
        sortKey: `${dateKey} ${date.getHours()}${date.getMinutes()} ${label}`
      });
    });
    sessions.sort((a, b) => (a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0)));
  }
  return {
    schema: QUICK_MARK_INDEX_SCHEMA,
    sessions,
    namesBySession: {},
    members: [],
    needs: [],
    // What the page says about itself — see the note it renders.
    live: true,
    liveDays: CHECK_IN_LIVE_SESSION_DAYS,
    builtAt: Utilities.formatDate(new Date(), TIMEZONE, 'h:mm a')
  };
}

/**
 * The requested location matched against the ones this workbook actually has
 * — case-insensitively, so a hand-typed ?location=narberth works — or '' when
 * it names none of them. A pin to a location that does not exist would
 * otherwise be a page showing an empty session list with no way out of it.
 */
function matchCheckInLocation(requested) {
  const wanted = String(requested || '').trim().toLowerCase();
  if (!wanted) return '';
  const known = checkInLocations();
  for (let i = 0; i < known.length; i++) {
    if (String(known[i]).toLowerCase() === wanted) return known[i];
  }
  return '';
}

/** The locations, deduped — the same list the dialog's dropdown is built from. */
function checkInLocations() {
  return Object.values(CALENDAR_MAP).filter((v, i, a) => a.indexOf(v) === i);
}

/** Whether a PIN has been set. Blank or absent means the page is ungated. */
function isCheckInPinSet() {
  return !!readCheckInPin();
}

function readCheckInPin() {
  try {
    return String(PropertiesService.getScriptProperties()
      .getProperty(CHECK_IN_PIN_PROP_KEY) || '').trim();
  } catch (err) {
    log(`Could not read the check-in PIN (${err}).`);
    return '';
  }
}

/**
 * Whether this request may write. True when no PIN is set at all.
 *
 * Both sides trimmed: a tablet keyboard that helpfully appends a space to a
 * four-digit PIN would otherwise lock the desk out of its own page, with
 * nothing on screen to say why.
 */
function checkInPinAccepted(supplied) {
  const pin = readCheckInPin();
  if (!pin) return true;
  return String(supplied || '').trim() === pin;
}

/** The refusal, in the words the page shows. */
function checkInPinRefusal() {
  return { ok: false, needsPin: true, message: 'Wrong PIN — nothing was marked.' };
}

// ----------------------------------------------------------------------------
// The two calls the page makes
// ----------------------------------------------------------------------------

/**
 * THE ROSTER FOR ONE SESSION, live off the registrants tab.
 *
 * Served from the door's stored rosters (section 16c) with the marks made
 * since they were built laid over the top, so it costs a cache read rather
 * than a pass over the whole registrants tab. A session the store does not
 * cover — one outside its date window — falls back to reading the tab, and so
 * does `fresh`, which is what the page's Refresh list button sends.
 *
 * Payload: { location, session, pin, fresh }.
 * Returns { ok, message, rows, problems, builtAt, source } — see
 * readCheckInRoster() for a row's shape.
 */
function checkInRoster(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  // isDeskWorkBlocked(), not isBootstrapActive(): a forms sweep is no reason to
  // shut the door desk, the same judgement showQuickMarkDialog() makes.
  if (isDeskWorkBlocked()) return { ok: false, message: deskBusyMessage() };
  const location = String(args.location || '');
  const session = String(args.session || '');
  try {
    // CHANGING SESSION IS THE MOMENT NOBODY IS MID-TAP, so it is where the
    // queued marks get written to the sheet — with a zero wait, because if the
    // workbook is busy the trigger will do it in a minute and the volunteer
    // must not be the one who waits for it. See flushCheckInQueue().
    flushCheckInQueue({ waitMs: 0 });

    // THE STORED ROSTER FIRST — one cache read instead of a pass over a tab
    // holding a year of registrations (see section 16c). `fresh` is the page's
    // pull-to-refresh: a desk that suspects the list is wrong can always ask
    // for the tab itself.
    const stored = args.fresh ? null : storedCheckInRoster(location, session);
    const rows = stored
      ? applyCheckInOverlay(stored.rows, location, session, stored.store)
      : applyCheckInOverlay(readCheckInRoster(location, session), location, session, null);
    // Marks that could not be applied at all, handed back where somebody is
    // actually looking — a queued write fails after the volunteer has walked
    // away, so this is the only place the failure can be said out loud.
    const problems = readCheckInProblems();
    return {
      ok: true,
      rows,
      problems: problems.map(problem => problem.message),
      // What the page shows in its freshness line: a stored list carries the
      // time it was built, a live one is by definition current.
      builtAt: stored ? stored.store.builtAt : '',
      source: stored ? 'stored' : 'sheet'
    };
  } catch (err) {
    log(`checkInRoster failed: ${err}`);
    return { ok: false, message: `Could not read the list (${err}).` };
  }
}

/** The page, having shown the failures, says so — and they stop being shown. */
function checkInDismissProblems(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  clearCheckInProblems();
  return { ok: true };
}

/**
 * ONE MARK — queued, not written; see section 16c for why, and for what the
 * page shows in the meantime. Everything about what a tick MEANS lives in
 * applyQuickMarkFromDialog() — the lock, the row match, the walk-in fallback,
 * the wording it answers with — and this is a doorway onto that, not a second
 * copy of it. The only thing added here is the PIN.
 *
 * Payload: { location, session, name, bookedTime, attended, lunch, clear,
 *            confirmWalkIn, pin }.
 */
function checkInMark(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  if (isDeskWorkBlocked()) return { ok: false, message: deskBusyMessage() };

  // QUEUED, NOT WRITTEN — the whole of what makes a tap instant. The mark goes
  // into a durable queue guarded by a lock no sync ever holds, and reaches the
  // sheet on the next flush (section 16c). What the desk sees is unaffected:
  // the queued mark is laid over the roster on every read until the sheet
  // itself carries it.
  const queued = recordCheckInMark(args);
  if (queued) {
    return {
      ok: true,
      queued: true,
      message: args.clear
        ? `Cleared ${args.name}.`
        : `${args.name} — ${args.lunch ? 'lunch' : 'checked in'}.`
    };
  }

  // The queue could not be reached at all (no Properties service, or a lock
  // that would not come). A mark that goes nowhere is the one outcome a door
  // cannot have, so this falls back to the blocking write it replaced.
  log('checkInMark: the queue could not be written — writing to the sheet directly.');
  if (args.clear) return clearCheckInMark(args);
  return applyQuickMarkFromDialog({
    location: args.location,
    session: args.session,
    name: args.name,
    bookedTime: args.bookedTime,
    attended: !!args.attended,
    lunch: !!args.lunch,
    // The page never registers anybody and never signs anybody up for a meal:
    // both are questions with follow-ups (which club, how many meals, is there
    // even a lunch scheduled that day), and a door is not where those get
    // asked. A name the roster does not hold reaches the dialog's walk-in path
    // only once the page has asked and been told yes.
    confirmWalkIn: !!args.confirmWalkIn
  });
}

/**
 * A REGISTRATION TYPED AT THE DESK — the check-in page's second screen.
 *
 * The door is where people actually ask: "can you put me down for the trip in
 * October?", "do I have to fill this in every week?". Until now the only
 * answer at a tablet was no — the page could mark a person present and nothing
 * else, and the questions went home in somebody's head or onto a sticky note.
 *
 * It is deliberately NOT the default screen (see doGet's ?page=), because a
 * queue at 9:55 wants one list and one tap; this is the screen the volunteer
 * moves to once, for one person, and comes back from.
 *
 * Everything it does, the dialog already does — this is the same call under
 * the same lock (applyQuickMarkFromDialog with register:true), plus the PIN:
 *
 *   - a place on one future session, at one appointment time where the
 *     program books by time;
 *   - a STANDING place on every future session of that program, with or
 *     without the lunch (the Club_Members row, addStandingListMember());
 *   - the same for GUESTS, one row each, carrying Person_Type 'Guest' and the
 *     member's name — which is what keeps them folded under that member on
 *     every door list from now on rather than listed as strangers.
 *
 * Payload: { location, session, name, appointmentTime, standing, standingLunch,
 *            guests: ['Jane Cohen'], pin }.
 *
 * THE GUESTS ARE REGISTERED AFTER THE MEMBER AND REPORTED SEPARATELY. A guest
 * row without its member is the one outcome worth avoiding, so the member goes
 * first and a failure there stops the rest; a guest that fails afterwards is
 * said out loud rather than swallowed, because the desk has to know which of
 * the names it typed actually landed.
 */
function checkInRegister(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  if (isDeskWorkBlocked()) return { ok: false, message: deskBusyMessage() };
  const name = String(args.name || '').trim();
  if (!name) return { ok: false, message: 'Type a name first — nothing was registered.' };
  if (!String(args.session || '').trim()) {
    return { ok: false, message: 'Pick a session first — nothing was registered.' };
  }

  const base = {
    location: String(args.location || ''),
    session: String(args.session || ''),
    appointmentTime: String(args.appointmentTime || ''),
    register: true,
    // The page has already shown the person the session it is about to put
    // them on, so the dialog's "are you sure this is a walk-in" question has
    // been asked and answered by the screen itself.
    confirmWalkIn: true
  };

  const first = applyQuickMarkFromDialog(Object.assign({}, base, {
    name,
    standing: !!args.standing,
    standingLunch: !!args.standingLunch
  }));
  if (!first || !first.ok) return first || { ok: false, message: 'Nothing was registered.' };

  const guestNames = (Array.isArray(args.guests) ? args.guests : [])
    .map(g => String(g || '').trim()).filter(g => g);
  const failed = [];
  guestNames.forEach(guest => {
    // NEVER a standing place for a guest. A club membership is a promise to
    // one person about every future session, and "Ruth's daughter, once, in
    // March" is not that person — carrying it forward would book somebody
    // nobody can name into every meeting of the program for ever.
    const res = applyQuickMarkFromDialog(Object.assign({}, base, {
      name: guest, personType: 'Guest', primaryRegistrant: name
    }));
    if (!res || !res.ok) failed.push(guest);
  });

  const guestNote = guestNames.length
    ? (failed.length
      ? ` ${guestNames.length - failed.length} of ${guestNames.length} guests added — ` +
        `${failed.join(', ')} did not go on. Try again or add them from the workbook.`
      : ` With ${guestNames.length === 1 ? 'their guest' : guestNames.length + ' guests'}.`)
    : '';
  return {
    ok: !failed.length,
    message: String(first.message || 'Registered.').replace(/^\u2705\s*/, '') + guestNote
  };
}

/**
 * The sessions this page will offer to register somebody onto: upcoming only.
 *
 * The stored index carries past sessions too, because marking attendance on
 * one that has already happened is an ordinary thing to do at a desk — and
 * registering somebody for last Tuesday is not. Filtered here rather than in
 * the browser so the rule has one home.
 */
function upcomingCheckInSessions(index) {
  const todayKey = formatDateKey(new Date());
  return ((index && index.sessions) || []).filter(s => s.dateKey && s.dateKey >= todayKey);
}

/**
 * THE UNDO — the one thing the dialog has no button for. Writes both day-of
 * columns back to false on the row the page is looking at.
 *
 * It belongs here rather than in applyQuickMark because "untick what I just
 * ticked" is a property of a list you can SEE, and the dialog cannot see one.
 *
 * Under the same lock as every other desk write, and for the same reason: this
 * finds a row NUMBER and then writes to it, so a render landing in between
 * would send the clear to whichever row had moved into that position.
 */
function clearCheckInMark(args) {
  return withScriptLock(DESK_LOCK_WAIT_MS, () => clearCheckInMarkLocked(args), {
    ok: false,
    message: 'The workbook is mid-update — nothing was changed. Try again in a moment.'
  });
}

/**
 * The body of clearCheckInMark(), which holds the lock for it — split out for
 * the same reason applyQuickMarkLocked() is: the queue flush applies a whole
 * batch of marks under ONE lock (see flushCheckInQueue()), and a function that
 * takes the lock for itself cannot be one of them.
 */
function clearCheckInMarkLocked(args) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return { ok: false, message: 'There is no registrants tab yet.' };
  const map = getIndexMap(HEADERS.Registrant_Dash);
  const target = findCheckInRow(sheet, map, args);
  if (!target) {
    return {
      ok: false,
      message: `${args.name || 'That person'} is not on this list any more — nothing changed.`
    };
  }
  if (map['Attended'] !== undefined) sheet.getRange(target, map['Attended'] + 1).setValue(false);
  if (map['Lunch_Served'] !== undefined) sheet.getRange(target, map['Lunch_Served'] + 1).setValue(false);
  return { ok: true, cleared: true, message: `Cleared ${args.name}.` };
}

/**
 * The sheet row for one person on one session, or 0.
 *
 * The same three-part match applyQuickMarkLocked() makes — location, canonical
 * title, date — plus the appointment slot, because on a Personalized
 * Assistance session one person legitimately holds two rows, and an undo has
 * to land on the one that was ticked.
 */
function findCheckInRow(sheet, map, args) {
  const selection = parseQuickMarkProgramChoice(args.session);
  const nameKey = normalizeNameKey(args.name);
  const location = String(args.location || '').trim();
  const bookedTime = appointmentStartLabelOf(args.bookedTime);
  const numCols = HEADERS.Registrant_Dash.length;
  let found = 0;
  getSectionZones(sheet, 'Event_ID').forEach(zone => {
    if (found) return;
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;
    const values = sheet.getRange(zone.dataStart, 1, count, numCols).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (normalizeNameKey(row[map['Name']]) !== nameKey) continue;
      if (location && String(row[map['Location']] || '').trim() !== location) continue;
      if (selection.title &&
        quickMarkTitleKey(row[map['Event']]) !== quickMarkTitleKey(selection.title)) continue;
      const d = coerceDate(row[map['Event_Date']]);
      if (selection.dateKey && (!d || formatDateKey(d) !== selection.dateKey)) continue;
      if (bookedTime && map['Event_Time'] !== undefined &&
        appointmentStartLabelOf(row[map['Event_Time']]) !== bookedTime) continue;
      found = zone.dataStart + i;
      break;
    }
  });
  return found;
}

/**
 * Every registered person on one session, in the order a door reads them:
 * { name, key, time, attended, lunch, phone, wantsLunch, dateLabel, dateKey }.
 *
 * APPOINTMENT SESSIONS SORT BY TIME and everything else sorts by name, because
 * those are two different questions being asked of one list: a Personalized
 * Assistance morning is read as a schedule ("who is at 10:30"), and a class is
 * read as a directory ("find Ruth").
 *
 * A dateless "program only" choice returns every date's rows, each labelled
 * with its own date — the same fallback the dialog's undated choice makes,
 * except that a list can show which date each row belongs to and a dropdown
 * cannot.
 */
function readCheckInRoster(location, sessionValue) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return [];
  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);
  const selection = parseQuickMarkProgramChoice(sessionValue);
  const wantedLocation = String(location || '').trim();
  const rows = [];
  const seen = {};

  // The VALUES reader, one pass over the tab — see readAllSectionedRowValues().
  readAllSectionedRowValues(sheet, headers, 'Event_ID').forEach(row => {
    const name = String(row[map['Name']] || '').trim();
    if (!name) return;
    if (wantedLocation && String(row[map['Location']] || '').trim() !== wantedLocation) return;
    if (selection.title &&
      quickMarkTitleKey(row[map['Event']]) !== quickMarkTitleKey(selection.title)) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (selection.dateKey && (!date || formatDateKey(date) !== selection.dateKey)) return;

    const time = map['Event_Time'] === undefined
      ? '' : appointmentStartLabelOf(row[map['Event_Time']]);
    const dateKey = date ? formatDateKey(date) : '';
    // DEDUPED ON NAME AND SLOT TOGETHER, the same rule buildQuickMarkIndex()
    // follows: two rows for one name on an ordinary program are a duplicate
    // registration, and two genuine appointments on an assistance one.
    const dedupe = `${normalizeNameKey(name)} ${time} ${dateKey}`;
    if (seen[dedupe]) return;
    seen[dedupe] = true;

    rows.push({
      name,
      key: normalizeNameKey(name),
      // WHO THIS ROW BELONGS TO. A guest is a row on this tab exactly like
      // anybody else — Person_Type 'Guest', Primary_Registrant naming the
      // member who brought them — and a door list that prints them as their
      // own line is a door list where "Ruth Cohen" and "Ruth's daughter" look
      // like two arrivals. So the shape is kept here and the nesting is done
      // below (nestCheckInGuests()).
      personType: map['Person_Type'] === undefined
        ? '' : String(row[map['Person_Type']] || '').trim(),
      primary: map['Primary_Registrant'] === undefined
        ? '' : String(row[map['Primary_Registrant']] || '').trim(),
      time,
      attended: isTruthyCheckbox(row[map['Attended']]),
      lunch: isTruthyCheckbox(row[map['Lunch_Served']]),
      // What a door needs about somebody who has not turned up: the number to
      // ring. Never the email — nobody emails a person who is late.
      phone: map['Phone'] === undefined ? '' : String(row[map['Phone']] || '').trim(),
      // Whether they are down for a meal at all, so the desk can see which
      // rows the lunch tap even applies to.
      wantsLunch: map['Lunch_Status'] !== undefined &&
        String(row[map['Lunch_Status']] || '').trim().toLowerCase() === 'needed',
      dateLabel: date ? formatDateLabel(date) : '',
      dateKey,
      // THE ROW'S OWN IDENTITY, carried so the page can cancel it. Every other
      // action here is addressed by location + session + name, which is enough
      // to FIND a row; a cancellation gives a seat back and is worth
      // addressing by the thing that cannot be two rows at once.
      eventId: map['Event_ID'] === undefined ? '' : String(row[map['Event_ID']] || '').trim()
    });
  });

  // NESTED FIRST, SORTED SECOND: guests fold into the member who brought them
  // (nestCheckInGuests()), and what the door reads is the list of parties.
  return sortCheckInRosterRows(nestCheckInGuests(rows));
}

/**
 * A door list in the order a door reads it, sorted in place.
 *
 * APPOINTMENT SESSIONS SORT BY TIME and everything else by name — see
 * readCheckInRoster(). Split out because the stored rosters (section 16c) are
 * built by a different pass over the same tab and have to come out in the same
 * order: a list that changes its shape depending on which of two code paths
 * built it is a list a volunteer cannot learn.
 */
function sortCheckInRosterRows(rows) {
  const anyTimes = rows.some(r => r.time);
  rows.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (anyTimes && a.time !== b.time) return compareAppointmentStartLabels(a.time, b.time);
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/**
 * GUESTS FOLD INTO THE MEMBER WHO BROUGHT THEM.
 *
 * A party of three arrives at the door as ONE person to greet and three meals
 * to count — not as three names to hunt for in an alphabetical list, two of
 * which ("Guest of Ruth Cohen", or worse, a first name only) sort nowhere near
 * the member and mean nothing to the volunteer holding the tablet.
 *
 * So a row whose Person_Type is Guest is attached to its Primary_Registrant's
 * row on the SAME date and slot, as `guests: [...]`. Each guest keeps its own
 * name, key and marks, because each guest is still its own sheet row and every
 * mark still lands on that row — what changes is only how the list reads.
 *
 * A GUEST WHOSE HOST IS NOT ON THIS LIST STAYS A ROW OF ITS OWN. That happens
 * when the member cancelled and the guest did not, or when a name was retyped
 * on one row and not the other, and the one thing that must never happen at a
 * door is a registered person who is on no list at all. It is labelled with
 * whose guest it is rather than left to look like a stranger.
 */
function nestCheckInGuests(rows) {
  const isGuest = r => /^guest$/i.test(String(r.personType || '').trim());
  const hosts = [];
  const byHostKey = {};
  // COPIES, not the rows themselves. The stored rosters (section 16c) file one
  // entry object under two lookups — the session's own date and the dateless
  // "program only" one — so nesting in place would hang the same guests off
  // the same object twice and print a party of six.
  rows.forEach(row => {
    if (isGuest(row)) return;
    const r = Object.assign({}, row, { guests: [] });
    hosts.push(r);
    // Keyed on the host AND the session slot, so a member holding two
    // appointment rows keeps each guest on the row they were booked with.
    byHostKey[`${r.key}\u0000${r.dateKey}\u0000${r.time}`] = r;
  });
  rows.forEach(r => {
    if (!isGuest(r)) return;
    const hostKey = normalizeNameKey(r.primary);
    const host = hostKey && byHostKey[`${hostKey}\u0000${r.dateKey}\u0000${r.time}`];
    if (!host) {
      hosts.push(Object.assign({}, r, { guests: [], guestOf: String(r.primary || '').trim() }));
      return;
    }
    host.guests.push({
      name: r.name, key: r.key, time: r.time, dateKey: r.dateKey,
      attended: r.attended, lunch: r.lunch, wantsLunch: r.wantsLunch
    });
  });
  return hosts;
}

/**
 * Two "10:30 AM"-shaped labels, earliest first. A blank sorts LAST — a row
 * with no slot on an otherwise timed list is the odd one out, and the bottom
 * is where an odd one out belongs.
 */
function compareAppointmentStartLabels(a, b) {
  const minutes = label => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || '').trim());
    if (!m) return Number.MAX_SAFE_INTEGER;
    let hour = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    return hour * 60 + parseInt(m[2], 10);
  };
  return minutes(a) - minutes(b);
}

/**
 * The page sends its arguments as a JSON STRING rather than as an object.
 *
 * google.script.run will take an object, but it takes it through a converter
 * with opinions about what the values inside it are — and a page served to
 * whatever browser the desk happens to own is not where anybody should be
 * discovering which. One string has one shape.
 */
function parseCheckInPayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  try {
    return JSON.parse(String(payload || '{}')) || {};
  } catch (err) {
    log(`Unreadable check-in payload (${err}).`);
    return {};
  }
}

// ----------------------------------------------------------------------------
// The page
// ----------------------------------------------------------------------------

/**
 * The check-in page's markup. Inline, so this project stays a single .gs file
 * — the same choice buildQuickMarkHtml() makes and for the same reason.
 *
 * THE LISTS TRAVEL INSIDE THE MARKUP, exactly as they do in the dialog: every
 * google.script.run is a round trip of its own, and a page whose first act is
 * to ask the server which locations exist is a page that spends two seconds
 * showing a volunteer nothing. What is NOT inlined is the roster, because that
 * is the one part that has to be live (see checkInRoster()).
 *
 * `options` is { location, pinRequired } — the location pin from the query
 * string, and whether writes need a PIN.
 */
/**
 * THE PART OF QUICK MARK'S INDEX THE DOOR ACTUALLY USES: the session list, and
 * the time it was built.
 *
 * The dialog needs the names on every session, the whole member roll and the
 * standing needs, because it can register a walk-in and answer questions about
 * one. The door page can do neither: it shows a roster it fetches live for the
 * one session on screen. Everything else in that index is payload a tablet on
 * a slow connection downloads before it can draw anything — which is a wait in
 * front of a queue, for data that is never read.
 *
 * Each session keeps only the five fields the page reads: its value, its
 * label, its group heading, its location and whether it is dated. The session
 * LIST itself is not trimmed — a desk marking yesterday's class, or a session
 * three weeks out, has to find it in the dropdown, and a roster the stored
 * copy does not cover is read live off the tab instead (checkInRoster()).
 */
function checkInPageIndex(index) {
  if (!index || !Array.isArray(index.sessions)) return null;
  return {
    builtAt: index.builtAt || '',
    // Carried through, because the page says a different thing about a list
    // read live than about a stored one — see readyCheckInSessionIndex().
    live: !!index.live,
    liveDays: index.liveDays || 0,
    sessions: index.sessions
      .map(session => ({
        value: session.value,
        label: session.label,
        group: session.group,
        location: session.location,
        dateKey: session.dateKey
      }))
  };
}

