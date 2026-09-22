// ============================================================================
// 99f. THE VOLUNTEER'S OWN HOURS PAGE  (a link, not a seat at the workbook)
// ============================================================================
//
// Numbered after `99e` for the usual reason — never renumber, and this landed
// last. Safe there: behavior only, its own three constants stand alone, its
// schema is `HEADERS.Volunteer_Hours` in `03` like every other tab's, and
// everything it reaches for — `logVolunteerVisit` and the clock helpers (99e),
// `checkInPinAccepted` / `checkInPinRefusal` / `checkInLocations` (60),
// `listKnownProgramTitles` (53), `spoolOfficeNote` (88) — it reads at CALL
// time or through a hoisted function declaration. `60`'s DOOR_ROUTES gains a
// `volunteer` entry that names the page, which is lazy for exactly this
// reason.
//
// WHY THIS EXISTS. `99e` records a volunteer visit from a MODAL DIALOG INSIDE
// THE SPREADSHEET, which is the same thing that was wrong with Quick Mark at a
// door: to use it a person has to be signed into an account with edit access
// to this workbook and have it open in front of them. Every volunteer this
// tab is about is the one kind of person who does not — and the ones whose
// hours are hardest to capture are the ones who are never in the building at
// all. A volunteer who takes a technical support call at home on a Saturday
// has done half an hour of the work the centre is credited for, and under the
// old arrangement he typed it in himself. Under this one his only route is to
// email somebody in the office and hope they retype it, which is two people's
// time to record one person's, and which stops happening in about a month.
//
// So this is the same write on a URL: `?mode=volunteer` on the SAME deployment
// the door pages are served from — no second system, no second thing to keep
// deployed — writing through `logVolunteerVisit()` (99e), which is the tab's
// one writer, under the same desk lock, with the same arithmetic and the same
// refusals. Nothing here derives an hour or a row of its own.
//
// WHAT IS DELIBERATELY DIFFERENT FROM THE STAFF DIALOG:
//
//   1. IT NAMES NOBODY. The dialog offers `collectKnownMembers()` in a
//      dropdown, which is right in front of a member of staff and wrong on a
//      link that leaves the building: a page that hands anyone holding the URL
//      the centre's whole roll of names is a page that has published the roll.
//      The volunteer TYPES their own name. Program titles are offered, because
//      those are already on the public calendar (86) and are the field most
//      worth getting spelled consistently — a report folds by program.
//   2. IT DEFAULTS TO OFF-SITE AND TO TODAY'S DATE, and it takes a plain
//      number of hours as readily as a pair of times, because the visit it
//      exists for has no arrival time: nobody watched it start. See the
//      banner in 99e for why typed hours are a first-class answer rather than
//      a fallback.
//   3. IT REMEMBERS WHO IS HOLDING IT. The name, email, role and program go
//      into that person's own browser storage, so the second entry is a date
//      and a number — the difference between a thing somebody does every week
//      and a thing they do twice.
//   4. IT TELLS THE OFFICE. Every self-logged visit files one line in the
//      daily digest (88), which is what replaces the email Gerry would
//      otherwise have sent: the office still hears what was recorded, once a
//      day and in one message, and nobody has to retype anything for it to
//      have landed.
//
// ATTRIBUTION, AND THE ONE THING THIS PAGE CANNOT KNOW. A web app deployed
// "execute as me" runs as the workbook's owner, so `getCurrentUserEmail()` in
// `logVolunteerVisit()` would stamp `Logged_By` with the OWNER's address on
// every row this page writes — which reads, on the tab and in the year-end
// report, as the office having typed them all in. So the writer takes an
// explicit `loggedBy`, and this page passes what the volunteer said they were:
// their own address, marked `(self-logged)` so nobody mistakes it for a
// verified one. It is a signature on a timesheet, not an identity claim, and
// it is treated as exactly that much.
//
// THE PIN IS THE SAME PIN (60). What it stops is the link being forwarded to a
// mailing list and becoming an open write endpoint into this tab; with no PIN
// set nothing is gated, which is right for the "anyone in the organization"
// deployment and wrong for a link sent to a volunteer's personal address. The
// dialog in 61 says so beside the link.
// ============================================================================

/**
 * What `?mode=` has to say to get this page. Spelled several ways for the same
 * reason the roster's modes are: the address is pasted into an email and typed
 * off a phone screen, and refusing `?mode=hours` because the route is called
 * `volunteer` is a link that mysteriously opens the door app instead.
 */
const VOLUNTEER_SELF_LOG_MODES = ['volunteer', 'volunteers', 'hours', 'volunteer-hours'];

/**
 * The most hours one entry may claim. Not a policy about how long anybody may
 * work — it is the typo guard: "30" typed into a box labelled hours when the
 * answer was thirty minutes is the mistake this page invites, and a 30-hour
 * visit in a figure the centre is credited on is worse than a refusal.
 */
const VOLUNTEER_SELF_LOG_MAX_HOURS = 16;

/** How far back a self-logged visit may be dated, in days. */
const VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS = 120;

/** The digest section every self-logged visit is filed under. */
const VOLUNTEER_SELF_LOG_DIGEST_SECTION = 'Volunteer hours logged by volunteers';

// ---------------------------------------------------------------------------
// 99f-a. What the page is drawn from
// ---------------------------------------------------------------------------

/**
 * Everything the page needs, in one read, and NOTHING ELSE — the list below is
 * the whole of what leaves the workbook through this route, and it is worth
 * reading as such: the roles (a constant), the buildings (a constant), the
 * program TITLES (already on the public calendar), and today's date. No names,
 * no contact details, no hours anybody else has logged.
 */
function volunteerSelfLogContext(options) {
  const opts = options || {};
  let programs = [];
  try {
    programs = listKnownProgramTitles();
  } catch (err) {
    // A page that cannot offer the titles still takes a typed one; a page that
    // throws takes nothing at all.
    log(`ℹ️ Volunteer self-log: could not list program titles (${err}).`);
    programs = [];
  }
  return {
    roles: VOLUNTEER_ROLES,
    locations: checkInLocations().concat([VOLUNTEER_OFF_SITE_LOCATION]),
    offSite: VOLUNTEER_OFF_SITE_LOCATION,
    programs: programs,
    today: formatDateKey(new Date()),
    pinRequired: !!opts.pinRequired,
    centerName: typeof CENTER_NAME === 'string' ? CENTER_NAME : ''
  };
}

// ---------------------------------------------------------------------------
// 99f-b. The one call the page makes
// ---------------------------------------------------------------------------

/**
 * ONE SELF-LOGGED VISIT, through the tab's own writer.
 *
 * Payload: { name, email, date, role, program, location, arrived, departed,
 * hours, notes, pin }. Returns { ok, message } — the page shows the message
 * either way, which is the convention every other served page here answers on.
 *
 * WHAT IS CHECKED HERE AND WHAT IS NOT. The arithmetic, the lock, the row and
 * the refusal for "no hours at all" belong to `logVolunteerVisit()` and are not
 * repeated: a second copy of the hours rule is a second thing to keep in step
 * with the annual report. What is checked here is what only a PUBLIC page has
 * to worry about — the PIN, a name, a date somebody can be held to, and the
 * typo guard above.
 */
function volunteerSelfLog(payload) {
  const args = payload || {};
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();

  const name = String(args.name || '').trim();
  if (!name) return { ok: false, message: 'Type your name first — nothing was recorded.' };
  const email = String(args.email || '').trim();

  const date = coerceDate(args.date);
  if (!date) {
    return { ok: false, message: 'That date could not be read — nothing was recorded.' };
  }
  const dateRefusal = volunteerSelfLogDateRefusal_(date);
  if (dateRefusal) return { ok: false, message: dateRefusal };

  // Asked BEFORE the write so the refusal names the number the person typed,
  // rather than reporting a row that did not land. The same arithmetic the
  // writer will do — read, not re-implemented.
  const hours = volunteerVisitHours(args.arrived, args.departed, args.hours);
  if (!hours) {
    return {
      ok: false,
      message: 'No hours to record — fill in both times, or type how many hours it was.'
    };
  }
  if (hours > VOLUNTEER_SELF_LOG_MAX_HOURS) {
    return {
      ok: false,
      message: `That works out to ${hours} hours, which is more than one visit can be logged as ` +
        `here (${VOLUNTEER_SELF_LOG_MAX_HOURS}). If it really was, email the office and they ` +
        'will add it. If you meant minutes, 30 minutes is 0.5 hours. Nothing was recorded.'
    };
  }

  const notes = String(args.notes || '').trim();
  const written = logVolunteerVisit({
    name: name,
    date: date,
    role: String(args.role || '').trim(),
    program: String(args.program || '').trim(),
    location: String(args.location || '').trim() || VOLUNTEER_OFF_SITE_LOCATION,
    arrived: args.arrived,
    departed: args.departed,
    hours: args.hours,
    notes: volunteerSelfLogNote_(email, notes),
    // See the banner: the page is running as the workbook's owner, so the
    // writer's own getCurrentUserEmail() would sign every row with the office's
    // address. The volunteer signs their own, marked for what it is worth.
    loggedBy: email ? `${email} (self-logged)` : 'self-logged'
  });

  // The writer answers in a sentence and marks a refusal with ⚠️ — the one
  // convention every dialog in this project shares. Read rather than guessed
  // at, so a refusal it grows later arrives here as a refusal.
  const refused = /^⚠️/.test(String(written || ''));
  if (refused) return { ok: false, message: String(written).replace(/^⚠️\s*/, '') };

  // The office is told ONCE A DAY, in one message, which is the whole of what
  // replaces the email this page exists instead of. Never urgent: nobody has
  // to act on a volunteer's timesheet at two in the morning.
  try {
    spoolOfficeNote(VOLUNTEER_SELF_LOG_DIGEST_SECTION,
      `${name}${email ? ` (${email})` : ''} logged ${hours} hour(s) on ` +
      `${formatDateLabel(date)}` +
      (args.program ? ` — ${String(args.program).trim()}` : '') +
      (args.role ? ` · ${String(args.role).trim()}` : '') + '.');
  } catch (err) {
    // The row is on the tab. A digest line that could not be filed is not a
    // reason to tell somebody their hours were not recorded.
    log(`ℹ️ Volunteer self-log: could not file the digest line (${err}).`);
  }

  log(`volunteerSelfLog: ${written}`);
  return { ok: true, message: String(written), hours: hours };
}

/**
 * Why this date cannot be logged, or ''. Two bounds, and they are not the same
 * kind of thing: tomorrow is somebody filling the form in before the visit
 * (which is a guess, and the tab is a record), and a date four months back is
 * a year-end catch-up that the office should be doing deliberately rather than
 * a volunteer doing from memory.
 */
function volunteerSelfLogDateRefusal_(date) {
  const todayKey = formatDateKey(new Date());
  const key = formatDateKey(date);
  if (key > todayKey) {
    return 'That date is in the future — log the visit after it happens. Nothing was recorded.';
  }
  // Through parseDateKey() rather than `new Date(key)`: a bare 'yyyy-MM-dd'
  // is parsed as UTC midnight by the Date constructor, which is the previous
  // day in this workbook's timezone and is one day of slack nobody asked for.
  const from = parseDateKey(key);
  const to = parseDateKey(todayKey);
  const days = (from && to) ? Math.round((to.getTime() - from.getTime()) / 86400000) : 0;
  if (days > VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS) {
    return `That date is more than ${VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS} days ago — email ` +
      'the office and they will add it for you. Nothing was recorded.';
  }
  return '';
}

/** The note the row carries: who filed it, then whatever they wrote. */
function volunteerSelfLogNote_(email, notes) {
  const parts = ['Self-logged' + (email ? ` by ${email}` : '')];
  if (notes) parts.push(notes);
  return parts.join(' — ');
}

// ---------------------------------------------------------------------------
// 99f-c. The page
// ---------------------------------------------------------------------------

/**
 * The served page, one template literal, like every other page in this project.
 *
 * EVERYTHING FROM THE WORKBOOK CROSSES INTO THE SCRIPT AS ONE DOUBLE-ENCODED
 * STRING and is written with textContent or through an option element's own
 * text — a program called "Tai Chi </script>" otherwise ends the page in the
 * middle of the payload. Same guard and same reason as 61, 73, 87 and 99e;
 * see tests/check_in_page.test.js.
 */
function buildVolunteerSelfLogHtml(context) {
  const payload = JSON.stringify(JSON.stringify(context || {})).replace(/</g, '\\u003c');
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --ink: #202124; --muted: #5f6368; --line: #dadce0; --blue: #1a73e8; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         color: var(--ink); background: #f1f3f4; margin: 0; padding: 16px; font-size: 16px; }
  main { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px;
         padding: 20px; box-shadow: 0 1px 3px rgba(60,64,67,.3); }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  p.hint { color: var(--muted); margin: 0 0 16px 0; line-height: 1.45; font-size: 14px; }
  label { display: block; margin-top: 14px; font-weight: 600; font-size: 14px; }
  label span.opt { font-weight: 400; color: var(--muted); }
  input, select, textarea { width: 100%; padding: 12px; font-size: 16px; margin-top: 4px;
                            border: 1px solid var(--line); border-radius: 8px; background: #fff;
                            color: var(--ink); }
  .pair { display: flex; gap: 12px; }
  .pair > div { flex: 1; }
  button { width: 100%; background: var(--blue); color: #fff; border: 0; border-radius: 8px;
           padding: 16px; font-size: 17px; font-weight: 600; margin-top: 20px; cursor: pointer; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 14px; min-height: 20px; font-weight: 600; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #c5221f; }
  #mine { margin-top: 18px; border-top: 1px solid #eee; padding-top: 10px; color: var(--muted);
          font-size: 14px; }
  #mine ul { margin: 6px 0 0 18px; padding: 0; }
  #pinwrap { display: none; }
</style>
</head>
<body>
<main>
  <h1>Log your volunteer hours</h1>
  <p class="hint" id="intro">Anything you do for us counts — a class you led, a shift at the desk,
    a phone call you took at home. One entry per visit or per call. We are credited for these,
    so the more of them are on here the better.</p>

  <div id="pinwrap">
    <label for="pin">Access code</label>
    <input id="pin" type="text" inputmode="numeric" autocomplete="off"
           placeholder="The code the office gave you">
  </div>

  <label for="name">Your name</label>
  <input id="name" type="text" autocomplete="name" placeholder="First and last">

  <label for="email">Your email <span class="opt">(so we can ask if something looks wrong)</span></label>
  <input id="email" type="email" autocomplete="email" placeholder="you@example.com">

  <label for="date">Date</label>
  <input id="date" type="date">

  <label for="role">What were you doing?</label>
  <select id="role"></select>

  <label for="program">Program <span class="opt">(if it was one)</span></label>
  <input id="program" list="programs" placeholder="Start typing, or leave blank">
  <datalist id="programs"></datalist>

  <label for="location">Where</label>
  <select id="location"></select>

  <label>How long <span class="opt">— times if you have them, or just the hours</span></label>
  <div class="pair">
    <div><input id="arrived" type="time" aria-label="Started"></div>
    <div><input id="departed" type="time" aria-label="Finished"></div>
  </div>
  <input id="hours" type="number" step="0.25" min="0" max="${VOLUNTEER_SELF_LOG_MAX_HOURS}"
         placeholder="or hours, e.g. 0.5 for half an hour" style="margin-top:8px">

  <label for="notes">Anything worth noting <span class="opt">(optional)</span></label>
  <textarea id="notes" rows="2" placeholder="e.g. helped a client with their email by phone"></textarea>

  <button id="go" type="button">Record it</button>
  <div id="status"></div>

  <div id="mine" style="display:none">
    <b>Logged from this phone today</b>
    <ul id="minelist"></ul>
  </div>
</main>

<script>
  // Double-encoded on the way in (see the banner above), so this is one parse
  // of one string rather than markup the browser was asked to believe.
  var CTX = JSON.parse(${payload});
  var STORE_KEY = 'nh_volunteer_self_log_v1';
  var MINE = [];

  function el(id) { return document.getElementById(id); }

  /** An option list built through each option's own text — never innerHTML. */
  function fillSelect(select, values, selected) {
    select.textContent = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— choose —';
    select.appendChild(blank);
    for (var i = 0; i < values.length; i++) {
      var option = document.createElement('option');
      option.value = values[i];
      option.textContent = values[i];
      if (selected && values[i] === selected) option.selected = true;
      select.appendChild(option);
    }
  }

  function remembered() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; }
    catch (err) { return {}; }
  }

  function remember() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        name: el('name').value, email: el('email').value, role: el('role').value,
        program: el('program').value, location: el('location').value, pin: el('pin').value
      }));
    } catch (err) { /* a browser with storage off still records hours */ }
  }

  function draw() {
    var saved = remembered();
    fillSelect(el('role'), CTX.roles || [], saved.role);
    fillSelect(el('location'), CTX.locations || [], saved.location || CTX.offSite);

    var list = el('programs');
    list.textContent = '';
    var programs = CTX.programs || [];
    for (var i = 0; i < programs.length; i++) {
      var option = document.createElement('option');
      option.value = programs[i];
      list.appendChild(option);
    }

    el('date').value = CTX.today || '';
    el('name').value = saved.name || '';
    el('email').value = saved.email || '';
    el('program').value = saved.program || '';
    if (CTX.pinRequired) {
      el('pinwrap').style.display = 'block';
      el('pin').value = saved.pin || '';
    }
  }

  function say(text, cls) {
    var status = el('status');
    status.textContent = text;
    status.className = cls || '';
  }

  function submit() {
    var button = el('go');
    button.disabled = true;
    say('Recording\\u2026', '');
    remember();
    google.script.run
      .withSuccessHandler(function (result) {
        button.disabled = false;
        if (!result || !result.ok) {
          say((result && result.message) || 'Nothing was recorded. Try again.', 'err');
          if (result && result.needsPin) el('pinwrap').style.display = 'block';
          return;
        }
        say(result.message, 'ok');
        MINE.push(result.message);
        showMine();
        // The fields somebody changes per entry are cleared; the ones that
        // describe the person are not, because the next entry is the same
        // person doing the same thing on a different day.
        el('arrived').value = '';
        el('departed').value = '';
        el('hours').value = '';
        el('notes').value = '';
      })
      .withFailureHandler(function (err) {
        button.disabled = false;
        say('That did not go through (' + (err && err.message ? err.message : err) +
            '). Nothing was recorded — try again.', 'err');
      })
      .volunteerSelfLog({
        name: el('name').value, email: el('email').value, date: el('date').value,
        role: el('role').value, program: el('program').value, location: el('location').value,
        arrived: el('arrived').value, departed: el('departed').value, hours: el('hours').value,
        notes: el('notes').value, pin: el('pin').value
      });
  }

  /** What this browser has recorded since the page was opened. textContent. */
  function showMine() {
    var box = el('mine');
    var list = el('minelist');
    list.textContent = '';
    for (var i = MINE.length - 1; i >= 0; i--) {
      var item = document.createElement('li');
      item.textContent = MINE[i];
      list.appendChild(item);
    }
    box.style.display = MINE.length ? 'block' : 'none';
  }

  draw();
  el('go').addEventListener('click', submit);
</script>
</body>
</html>`;
}
