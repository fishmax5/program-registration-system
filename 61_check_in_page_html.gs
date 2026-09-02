// ============================================================================
// 16a. THE CHECK-IN PAGE'S HTML  (buildCheckInHtml — the whole served page)
// ============================================================================

function buildCheckInHtml(preloadedIndex, options) {
  const opts = options || {};
  // JSON.stringify TWICE over: once to make the data, once to make it a STRING
  // LITERAL that cannot break out of the <script> block. A member called
  // O'Brien, or a program title containing the two characters that end a
  // script tag, would otherwise end the page in the middle of a sentence and
  // leave a tablet showing half a screen that does nothing at all. The
  // <\/ escape is what handles the second of those.
  // ONLY THE SESSION LIST TRAVELS, not the whole Quick Mark index — see
  // checkInPageIndex(). The dialog's index also carries every name on every
  // session, the entire member roll and the standing needs, which on a
  // workbook with a year of history is hundreds of kilobytes the door page
  // downloads and never once reads.
  const pageIndex = checkInPageIndex(preloadedIndex);
  const inlineIndex = pageIndex
    ? JSON.stringify(JSON.stringify(pageIndex)).replace(/<\//g, '<\\/')
    : 'null';
  const inlineOptions = JSON.stringify(JSON.stringify({
    location: String(opts.location || ''),
    pinRequired: !!opts.pinRequired,
    page: opts.page === 'register' ? 'register' : 'checkin',
    locations: checkInLocations(),
    // Upcoming only, and decided on the server — see upcomingCheckInSessions().
    upcoming: upcomingCheckInSessions(preloadedIndex)
  })).replace(/<\//g, '<\\/');

  return `
<style>
  /* Sized for a THUMB, not a cursor: every target on this page is at least
     44px tall, which is the smallest thing a person reliably hits while
     standing up and holding the tablet in their other hand. */
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         font-size: 16px; color: #202124; margin: 0; background: #F8F9FA; }
  header { background: #1A73E8; color: #fff; padding: 12px 16px; position: sticky; top: 0; z-index: 5; }
  header h1 { margin: 0 0 8px 0; font-size: 18px; font-weight: 600; }
  header .counts { font-size: 14px; opacity: .92; }
  main { padding: 12px 16px 96px 16px; max-width: 720px; margin: 0 auto; }
  select, input[type=text], input[type=tel] {
    width: 100%; padding: 12px; font-size: 16px; border: 1px solid #DADCE0;
    border-radius: 8px; background: #fff; }
  label.field { display: block; font-weight: 600; margin: 14px 0 5px 0; font-size: 14px; color: #5F6368; }
  #search { margin-top: 14px; }

  ul.roster { list-style: none; margin: 14px 0 0 0; padding: 0; }
  li.person { background: #fff; border: 1px solid #E8EAED; border-radius: 10px;
              margin-bottom: 8px; display: flex; align-items: stretch; overflow: hidden; }
  li.person.done { background: #E6F4EA; border-color: #B7DFC4; }
  /* The name is the target. It fills the row so a tap anywhere that is not
     one of the two small buttons is the ordinary "they are here" tap. */
  button.who { flex: 1; text-align: left; background: none; border: 0; padding: 14px 12px;
               font-size: 17px; color: #202124; cursor: pointer; min-height: 56px; }
  button.who .time { display: block; font-size: 13px; color: #5F6368; margin-top: 2px; }
  button.who .tick { color: #188038; font-weight: 700; margin-right: 6px; }
  li.person.done button.who { color: #188038; }
  /* Lunch is a second, narrower target on the same row — a desk that hands
     meals over at the same table marks both without changing screens. */
  button.lunch { width: 76px; border: 0; border-left: 1px solid #E8EAED; background: #fff;
                 font-size: 12px; color: #5F6368; cursor: pointer; }
  button.lunch.on { background: #FEF7E0; color: #B06000; font-weight: 700; }
  button.who[disabled], button.lunch[disabled] { opacity: .45; }

  p.empty { color: #5F6368; text-align: center; padding: 32px 12px; line-height: 1.5; }
  /* The status line sits at the BOTTOM of the screen, pinned. A volunteer's
     eyes are on the row they just tapped, which is in the middle of a long
     list — a message at the top of the page is a message nobody reads. */
  #status { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px;
            background: #202124; color: #fff; font-size: 14px; line-height: 1.4;
            transform: translateY(110%); transition: transform .18s ease; }
  #status.show { transform: translateY(0); }
  #status.err { background: #C5221F; }
  #status.ok { background: #188038; }
  .row-actions { display: flex; gap: 8px; margin-top: 14px; }
  .row-actions button { flex: 1; }
  button.plain { padding: 12px; font-size: 15px; border-radius: 8px; border: 1px solid #DADCE0;
                 background: #fff; color: #1A73E8; cursor: pointer; min-height: 48px; }
  #stale { background: #FEF7E0; border: 1px solid #FDE293; border-radius: 8px;
           padding: 10px 12px; font-size: 13px; color: #5F6368; margin-top: 12px; line-height: 1.4; }
  #pinbox { padding: 24px 16px; max-width: 360px; margin: 0 auto; }
  #pinbox h2 { font-size: 17px; }
  #pinbox button { width: 100%; margin-top: 12px; background: #1A73E8; color: #fff;
                   border: 0; border-radius: 8px; padding: 14px; font-size: 16px; cursor: pointer; }
  .hide { display: none !important; }

  /* A GUEST IS PART OF A ROW, NOT A ROW. The member's name is the heading and
     the people they brought sit under it in smaller type, each its own small
     target so a party where only one guest turned up can still be marked
     honestly. */
  .party { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 12px 12px; }
  button.guest { border: 1px solid #DADCE0; background: #fff; border-radius: 999px;
                 padding: 8px 12px; font-size: 14px; color: #5F6368; cursor: pointer;
                 min-height: 40px; }
  button.guest.on { background: #E6F4EA; border-color: #B7DFC4; color: #188038; font-weight: 600; }
  button.who .party-note { display: block; font-size: 13px; color: #5F6368; margin-top: 2px; }

  /* The one question the door is the right place to ask, asked once, right
     after the tap that answered "are you here". */
  #prompt { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; z-index: 8;
            border-top: 3px solid #1A73E8; padding: 16px; box-shadow: 0 -6px 18px rgba(0,0,0,.18); }
  #prompt h2 { margin: 0 0 4px 0; font-size: 17px; }
  #prompt p { margin: 0 0 12px 0; color: #5F6368; font-size: 14px; line-height: 1.4; }
  #prompt button { width: 100%; margin-bottom: 8px; }
  button.primary { background: #1A73E8; color: #fff; border: 0; border-radius: 8px;
                   padding: 14px; font-size: 16px; cursor: pointer; min-height: 48px; }

  nav.tabs { display: flex; gap: 8px; margin-top: 8px; }
  nav.tabs button { flex: 1; border: 0; border-radius: 8px; padding: 10px; font-size: 14px;
                    background: rgba(255,255,255,.18); color: #fff; cursor: pointer; min-height: 44px; }
  nav.tabs button.on { background: #fff; color: #1A73E8; font-weight: 700; }
  fieldset { border: 1px solid #E8EAED; border-radius: 10px; background: #fff; margin: 14px 0 0 0;
             padding: 8px 14px 14px 14px; }
  legend { font-weight: 600; font-size: 14px; color: #5F6368; padding: 0 4px; }
  label.check { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 15px;
                line-height: 1.35; }
  label.check input { width: 22px; height: 22px; flex: none; }
  .guest-inputs input { margin-top: 8px; }

  /* SESSIONS ARE BOXES, NOT A DROPDOWN LINE. A dropdown is a target the size
     of one line of text that then covers the screen with more of them, and
     this page is used standing up with a thumb: the DAY is a dropdown (a
     date is a single, ordered, obvious choice) and the sessions on that day
     are cards the size of the name cards on the door page. */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
           gap: 8px; margin-top: 8px; }
  button.pick { background: #fff; border: 1px solid #DADCE0; border-radius: 10px;
                padding: 14px 12px; font-size: 17px; text-align: left; cursor: pointer;
                color: #202124; min-height: 64px; }
  button.pick .meta { display: block; font-size: 12px; color: #5F6368; margin-top: 3px;
                      line-height: 1.35; }
  button.pick.on { background: #E8F0FE; border-color: #1A73E8; font-weight: 600; }
  button.pick.on .meta { color: #1967D2; }
  button.pick[disabled] { opacity: .5; }
</style>

<header>
  <h1 id="heading">Check In</h1>
  <div class="counts" id="counts"></div>
  <nav class="tabs" id="tabs">
    <button id="tab-checkin" onclick="showPage('checkin')">Check in</button>
    <button id="tab-register" onclick="showPage('register')">Register someone</button>
  </nav>
</header>

<div id="pinbox" class="hide">
  <h2>Enter the desk PIN</h2>
  <input type="tel" id="pin" inputmode="numeric" autocomplete="off" placeholder="PIN">
  <button onclick="savePin()">Continue</button>
</div>

<main id="app" class="hide">
  <label class="field" for="location">Location</label>
  <select id="location" onchange="locationChanged()"></select>

  <label class="field" for="day">Day</label>
  <select id="day" onchange="dayChanged()" disabled></select>

  <!-- The chosen session, kept in a hidden field rather than in a variable:
       every write on this page reads it by id (refresh(), joinStanding(),
       mark()), and one place holding the answer is what stops a box that
       LOOKS picked from being a different session than the one written to. -->
  <div class="cards" id="session-boxes"></div>
  <input type="hidden" id="session">

  <input type="text" id="search" placeholder="Search for a name" oninput="draw()" class="hide">
  <div id="stale" class="hide"></div>
  <ul class="roster" id="roster"></ul>
  <p class="empty" id="empty"></p>
  <div class="row-actions">
    <button class="plain" onclick="refresh(true)">Refresh list</button>
  </div>
</main>

<main id="regpage" class="hide">
  <label class="field" for="reg-name">Who is registering</label>
  <input type="text" id="reg-name" list="members" autocomplete="off" placeholder="Full name">
  <datalist id="members"></datalist>

  <label class="field" for="reg-location">Location</label>
  <select id="reg-location" onchange="regLocationChanged()"></select>

  <label class="field" for="reg-day">Day</label>
  <select id="reg-day" onchange="regDayChanged()" disabled></select>
  <div class="cards" id="reg-session-boxes"></div>
  <input type="hidden" id="reg-session">

  <div id="reg-timewrap" class="hide">
    <label class="field" for="reg-time">Appointment time</label>
    <select id="reg-time"></select>
  </div>

  <fieldset>
    <legend>Guests</legend>
    <p class="hint" style="margin:0;color:#5F6368;font-size:13px;line-height:1.4">
      Anybody they are bringing. Guests are booked under their name and show under it on the
      door list — they never become a separate person to look up.
    </p>
    <div class="guest-inputs">
      <input type="text" id="reg-guest-1" placeholder="Guest 1 name" autocomplete="off">
      <input type="text" id="reg-guest-2" placeholder="Guest 2 name" autocomplete="off">
      <input type="text" id="reg-guest-3" placeholder="Guest 3 name" autocomplete="off">
    </div>
  </fieldset>

  <fieldset>
    <legend>Club place — every date</legend>
    <label class="check">
      <input type="checkbox" id="reg-standing" onchange="standingChanged()">
      <span>Make this a <b>club place</b>: keep them on the list for <b>every future date</b> of
        this program, so they never have to sign up again.</span>
    </label>
    <label class="check" id="reg-standing-lunch-wrap" style="display:none">
      <input type="checkbox" id="reg-standing-lunch">
      <span>…and put them down for the lunch on each of those dates.</span>
    </label>
  </fieldset>

  <div class="row-actions">
    <button class="primary" id="reg-submit" onclick="submitRegistration()">Register</button>
  </div>
  <div class="row-actions">
    <button class="plain" onclick="showPage('checkin')">Back to the door list</button>
  </div>
</main>

<div id="prompt" class="hide"></div>
<div id="status"></div>

<script>
  // The lists, handed over with the page — see buildCheckInHtml().
  var INDEX = ${inlineIndex} ? JSON.parse(${inlineIndex}) : null;
  var OPTS = JSON.parse(${inlineOptions});

  // The roster for the session on screen. THE PAGE'S ONLY STATE, and it is
  // replaced wholesale by every refresh rather than patched — the sheet is the
  // truth, and a list that has been edited in place for twenty minutes is a
  // list that has quietly drifted from it.
  var ROWS = [];
  var busy = false;
  var pin = '';

  function start() {
    try { pin = window.localStorage.getItem('checkInPin') || ''; } catch (err) { pin = ''; }
    if (OPTS.pinRequired && !pin) return showPin();
    showApp();
  }

  function showPin() {
    document.getElementById('pinbox').classList.remove('hide');
    document.getElementById('app').classList.add('hide');
    document.getElementById('pin').focus();
  }

  function savePin() {
    pin = document.getElementById('pin').value.trim();
    try { window.localStorage.setItem('checkInPin', pin); } catch (err) { /* private browsing */ }
    showApp();
  }

  function showApp() {
    document.getElementById('pinbox').classList.add('hide');
    document.getElementById('app').classList.remove('hide');
    if (!INDEX) {
      document.getElementById('empty').textContent =
        'The lists have not been built yet. Open the workbook and run Update Everything Now, ' +
        'then reload this page.';
      return;
    }
    // WHEN THE SESSION LIST WAS BUILT, said out loud. The roster below it is
    // live, but the sessions and the names on them come off an index built on
    // a trigger — so somebody registered ten minutes ago is not on this page
    // until the next sync, and a volunteer hunting for a name that is not
    // there deserves to know that rather than to conclude the page is broken.
    if (INDEX.builtAt) {
      var stale = document.getElementById('stale');
      // A LIVE list is not a stale one, and saying it is teaches volunteers to
      // distrust a page that is telling them the truth. See
      // readyCheckInSessionIndex(): the stored lists are a snapshot rebuilt on
      // a trigger, and the fallback is read at the moment the page is served.
      stale.textContent = INDEX.live
        ? 'Sessions read just now, live. Only the next ' + (INDEX.liveDays || 14) +
          ' days are listed - open the workbook for anything further out.'
        : 'Session list built at ' + INDEX.builtAt + '. Somebody who registered ' +
          'since then will not be on it yet - check them in from the workbook.';
      stale.classList.remove('hide');
    }
    fillLocations();
    showPage(OPTS.page === 'register' ? 'register' : 'checkin');
  }

  function fillLocations() {
    var sel = document.getElementById('location');
    sel.innerHTML = '<option value="">Choose a location</option>';
    (OPTS.locations || []).forEach(function (loc) {
      var o = document.createElement('option');
      o.value = loc; o.textContent = loc;
      sel.appendChild(o);
    });
    // The ?location= pin: choose it AND move straight on to the session list,
    // so the tablet that lives in one building opens on that building's
    // sessions rather than on a dropdown asking which building it is in.
    if (OPTS.location) { sel.value = OPTS.location; locationChanged(); }
  }

  /**
   * The days on the check-in screen, in the order the index gave them:
   * [ { dateKey, label, group, sessions: [...] } ]. Rebuilt whenever the
   * location changes, and nothing else reads the index for a session again.
   */
  var DAYS = [];

  function locationChanged() {
    var loc = document.getElementById('location').value;
    ROWS = [];
    setSession('');
    draw();
    DAYS = groupSessionsByDay((INDEX.sessions || []).filter(function (s) {
      return s.location === loc;
    }));
    var sel = document.getElementById('day');
    fillDaySelect(sel, DAYS, 'group');
    sel.disabled = !loc || !DAYS.length;
    document.getElementById('session-boxes').innerHTML = '';
    if (!loc || !DAYS.length) return;
    // THE SOONEST DAY, CHOSEN FOR THEM. The list is sorted soonest-first, so
    // the first day is the one a door is almost always standing in — picking
    // it saves the volunteer a tap they were going to make anyway, and the
    // dropdown is right there when it is the wrong guess.
    sel.value = DAYS[0].dateKey;
    dayChanged();
  }

  /**
   * One day's sessions, as BOXES. The day above them is a dropdown because a
   * date is one ordered choice out of many; the sessions are cards because
   * "which class" is the choice a thumb actually has to hit, and there are
   * rarely more than a handful on any one day.
   */
  function dayChanged() {
    var day = dayFor(DAYS, document.getElementById('day').value);
    ROWS = [];
    // One session on the day: it is the answer, so it is given rather than
    // made into a list of one to tap through.
    setSession(day && day.sessions.length === 1 ? day.sessions[0].value : '');
    dayChanged.redraw(day);
    if (document.getElementById('session').value) return sessionChanged();
    draw();
  }

  /** Repaints the boxes so the picked one is the one that looks picked. */
  dayChanged.redraw = function (day) {
    drawSessionBoxes('session-boxes', day, function (session) {
      setSession(session.value);
      dayChanged.redraw(day);
      sessionChanged();
    });
  };

  function setSession(value) {
    document.getElementById('session').value = value || '';
  }

  function sessionChanged() {
    ROWS = [];
    draw();
    refresh();
  }

  // --------------------------------------------------------------------------
  // The day picker and the session boxes, shared by both screens
  // --------------------------------------------------------------------------

  /**
   * Sessions in, days out — keeping the order they arrived in, which is the
   * order the server sorted them into (soonest first). A session with no date
   * on it at all still needs somewhere to live, so it gets its own day with a
   * blank key and a heading that says what it is.
   */
  function groupSessionsByDay(sessions) {
    var days = [];
    var byKey = {};
    sessions.forEach(function (s) {
      var key = s.dateKey || '';
      var day = byKey[key];
      if (!day) {
        day = {
          dateKey: key,
          label: key ? dayLabel(key) : 'Program only (no date)',
          group: s.group || (key ? '' : 'No date'),
          monthLabel: key ? monthLabel(key) : 'No date',
          sessions: []
        };
        byKey[key] = day;
        days.push(day);
      }
      day.sessions.push(s);
    });
    return days;
  }

  /** Every day as one option, headed by the day field named ('group' or 'monthLabel'). */
  function fillDaySelect(sel, days, field) {
    sel.innerHTML = '<option value="">Choose a day</option>';
    var heading = '';
    var holder = sel;
    days.forEach(function (day) {
      var head = day[field] || '';
      if (head && head !== heading) {
        heading = head;
        holder = document.createElement('optgroup');
        holder.label = head;
        sel.appendChild(holder);
      }
      var o = document.createElement('option');
      o.value = day.dateKey;
      // The count belongs on the day, not inside it: "3 programs" is what
      // tells somebody scrolling the dropdown that a day is worth opening.
      o.textContent = day.label + '  (' + day.sessions.length +
        (day.sessions.length === 1 ? ' program)' : ' programs)');
      holder.appendChild(o);
    });
  }

  function dayFor(days, dateKey) {
    for (var i = 0; i < days.length; i++) {
      if (days[i].dateKey === dateKey) return days[i];
    }
    return null;
  }

  /**
   * A box per session on the day, with the picked one marked. onPick is
   * given the session object; a null day empties the container, which is what
   * happens between a location change and the day landing.
   */
  function drawSessionBoxes(containerId, day, onPick) {
    var box = document.getElementById(containerId);
    box.innerHTML = '';
    if (!day) return;
    var picked = containerId === 'session-boxes'
      ? document.getElementById('session').value
      : document.getElementById('reg-session').value;
    day.sessions.forEach(function (session) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (session.value === picked ? ' on' : '');
      var meta = [];
      if (session.byAppointment) {
        meta.push(session.times && session.times.length
          ? session.times.length + ' appointment ' +
            (session.times.length === 1 ? 'time left' : 'times left')
          : 'every appointment has gone');
      }
      b.innerHTML = '<span>' + escapeHtml(session.title || session.label) + '</span>' +
        (meta.length ? '<span class="meta">' + escapeHtml(meta.join(' — ')) + '</span>' : '');
      b.onclick = function () { if (onPick) onPick(session); };
      box.appendChild(b);
    });
  }

  /** 'yyyy-MM-dd' as a person reads it, without asking a Date to parse it. */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function dayParts(dateKey) {
    var bits = String(dateKey || '').split('-');
    // Built from the three NUMBERS, never from the string: new Date('2026-09-02')
    // is parsed as UTC and lands on the 1st for every tablet west of London.
    return new Date(Number(bits[0]), Number(bits[1]) - 1, Number(bits[2]));
  }

  function dayLabel(dateKey) {
    var d = dayParts(dateKey);
    if (isNaN(d.getTime())) return String(dateKey || '');
    return WEEKDAY_NAMES[d.getDay()] + ' ' + MONTH_NAMES[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
  }

  function monthLabel(dateKey) {
    var d = dayParts(dateKey);
    if (isNaN(d.getTime())) return String(dateKey || '');
    return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  }

  /**
   * A truthy 'fresh' is the Refresh button: it makes the server read the
   * registrants tab
   * instead of the stored rosters. Choosing a session does NOT ask for that —
   * the stored copy is the whole reason a session opens instantly — but a desk
   * that thinks the list is wrong needs a way to insist, and this is it.
   */
  function refresh(fresh) {
    var loc = document.getElementById('location').value;
    var session = document.getElementById('session').value;
    if (!loc || !session) return;
    setBusy(true);
    // Redrawn so the rows actually go grey while the list is being fetched —
    // setBusy only sets the flag, and every target on the page reads it at
    // draw time. Without this a volunteer can tap a name off the OLD session's
    // list in the second before the new one lands.
    draw();
    say('Loading the list...', '');
    call('checkInRoster', { location: loc, session: session, fresh: !!fresh }, function (res) {
      setBusy(false);
      if (!res || !res.ok) return handle(res);
      ROWS = res.rows || [];
      document.getElementById('search').classList.toggle('hide', ROWS.length < 12);
      showProblems(res.problems || []);
      hideStatus();
      draw();
    });
  }

  /**
   * Marks the sheet refused after the fact. A queued mark is written a minute
   * later, by which time the volunteer has moved on, so this is the only place
   * a failure can be said out loud - and it is said once, then dismissed.
   */
  function showProblems(problems) {
    if (!problems.length) return;
    say(problems.join(' '), 'err');
    call('checkInDismissProblems', {}, function () {});
  }

  function draw() {
    var list = document.getElementById('roster');
    var empty = document.getElementById('empty');
    var needle = document.getElementById('search').value.trim().toLowerCase();
    list.innerHTML = '';

    // A GUEST'S NAME STILL FINDS THE ROW. They are not a line of their own any
    // more, so searching for one has to land on the member who brought them —
    // otherwise the one thing folding guests in would have cost is the ability
    // to look one up.
    var shown = ROWS.filter(function (r) {
      if (!needle) return true;
      if (r.name.toLowerCase().indexOf(needle) !== -1) return true;
      return (r.guests || []).some(function (g) {
        return g.name.toLowerCase().indexOf(needle) !== -1;
      });
    });
    // COUNTED IN PEOPLE, not in rows: a member with two guests is three people
    // through the door, and a desk that has to order lunches reads this number
    // as a headcount.
    var total = 0, here = 0;
    ROWS.forEach(function (r) {
      total += 1 + (r.guests || []).length;
      if (r.attended) here++;
      (r.guests || []).forEach(function (g) { if (g.attended) here++; });
    });
    document.getElementById('counts').textContent = total
      ? here + ' of ' + total + ' checked in'
      : '';

    if (!shown.length) {
      empty.textContent = ROWS.length
        ? 'Nobody on this list matches "' + document.getElementById('search').value.trim() + '".'
        : (document.getElementById('session').value
          ? 'Nobody is registered for this session yet.'
          : 'Choose a location and a session.');
      return;
    }
    empty.textContent = '';

    shown.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'person' + (r.attended ? ' done' : '');

      var who = document.createElement('button');
      who.className = 'who';
      who.disabled = busy;
      who.onclick = function () { tapName(r); };
      who.innerHTML = (r.attended ? '<span class="tick">OK</span>' : '') + escapeHtml(r.name) +
        subtitle(r);
      li.appendChild(who);

      // The lunch button only appears where a lunch is expected: a row that
      // never asked for a meal has no meal to hand over, and a button that
      // does nothing useful on most rows is a button that gets pressed by
      // accident on all of them.
      if (r.wantsLunch || r.lunch) {
        var meal = document.createElement('button');
        meal.className = 'lunch' + (r.lunch ? ' on' : '');
        meal.disabled = busy;
        meal.textContent = r.lunch ? 'Fed' : 'Lunch';
        meal.onclick = function () { tapLunch(r); };
        li.appendChild(meal);
      }

      var wrap = document.createElement('div');
      wrap.appendChild(li);

      // THE PARTY. One chip per guest, under the member's name — a tap on the
      // member marks the whole party (which is how a party arrives), and a tap
      // on a chip marks or clears that guest alone (which is how a party
      // actually turns up when one of them stayed home).
      if ((r.guests || []).length) {
        var party = document.createElement('div');
        party.className = 'party';
        r.guests.forEach(function (g) {
          var chip = document.createElement('button');
          chip.className = 'guest' + (g.attended ? ' on' : '');
          chip.disabled = busy;
          chip.textContent = (g.attended ? 'OK ' : '') + g.name;
          chip.onclick = function () { tapGuest(r, g); };
          party.appendChild(chip);
        });
        li.style.borderBottomLeftRadius = '0';
        li.style.borderBottomRightRadius = '0';
        li.style.marginBottom = '0';
        party.style.background = r.attended ? '#E6F4EA' : '#fff';
        party.style.border = '1px solid ' + (r.attended ? '#B7DFC4' : '#E8EAED');
        party.style.borderTop = '0';
        party.style.borderRadius = '0 0 10px 10px';
        party.style.marginBottom = '8px';
        wrap.appendChild(party);
      }
      list.appendChild(wrap);
    });
  }

  function subtitle(r) {
    var bits = [];
    // Whose guest an ORPHAN guest is — one whose member is not on this list at
    // all (see nestCheckInGuests()). Without it the row reads as a stranger.
    if (r.guestOf) bits.push('guest of ' + escapeHtml(r.guestOf));
    // The slot, but ONLY where slots differ from row to row. Every session has
    // an Event_Time, so a class of thirty carries the same "10:00 AM" on all
    // thirty rows — thirty lines of subtitle saying what the heading already
    // says. On a Personalized Assistance morning the times are the whole shape
    // of the list, and that is the case this is for.
    if (r.time && timesVary()) bits.push(escapeHtml(r.time));
    // Only shown on an undated "program only" choice, where one list spans
    // several dates and the name alone does not say which.
    if (r.dateLabel && !sessionIsDated()) bits.push(escapeHtml(r.dateLabel));
    if (!r.attended && r.phone) bits.push(escapeHtml(r.phone));
    return bits.length ? '<span class="time">' + bits.join(' - ') + '</span>' : '';
  }

  /**
   * Whether this list holds more than one distinct slot — the difference
   * between a schedule and a class, decided from the data rather than from a
   * flag, so a session that turns out to have slots gets them shown whatever
   * its tags say.
   */
  function timesVary() {
    var first = null;
    for (var i = 0; i < ROWS.length; i++) {
      if (!ROWS[i].time) continue;
      if (first === null) first = ROWS[i].time;
      else if (ROWS[i].time !== first) return true;
    }
    return false;
  }

  function sessionIsDated() {
    var value = document.getElementById('session').value;
    var found = (INDEX.sessions || []).filter(function (s) { return s.value === value; })[0];
    return !!(found && found.dateKey);
  }

  function tapName(r) {
    // A tap on somebody already checked in is the UNDO, and it asks first:
    // the failure mode of a large target is hitting the wrong one, and
    // silently unticking the person above the one you meant is worse than
    // a question.
    if (r.attended) {
      if (!window.confirm('Clear the check-in for ' + r.name + '?')) return;
      return mark(r, { clear: true }, function () { clearParty(r); });
    }
    mark(r, { attended: true }, function () { markParty(r); });
  }

  /**
   * The guests who came WITH the member, marked behind the member's own tap.
   * A party walks up together, so one tap is the honest record of it; the
   * chips are there for the evening when only one of them came.
   */
  function markParty(r) {
    var pending = (r.guests || []).filter(function (g) { return !g.attended; });
    var i = 0;
    (function next() {
      if (i >= pending.length) return afterCheckIn(r);
      var g = pending[i++];
      mark(guestRow(r, g), { attended: true }, function () { g.attended = true; draw(); next(); });
    })();
  }

  function clearParty(r) {
    (r.guests || []).filter(function (g) { return g.attended || g.lunch; }).forEach(function (g) {
      mark(guestRow(r, g), { clear: true }, function () { g.attended = false; g.lunch = false; draw(); });
    });
  }

  function tapGuest(r, g) {
    if (g.attended) {
      if (!window.confirm('Clear the check-in for ' + g.name + '?')) return;
      return mark(guestRow(r, g), { clear: true }, function () {
        g.attended = false; g.lunch = false; draw();
      });
    }
    mark(guestRow(r, g), { attended: true }, function () { g.attended = true; draw(); });
  }

  /**
   * A guest as the SHEET sees it: their own name, on their own row, at the
   * member's slot. The nesting is a property of this screen only — every mark
   * still lands on the guest's own row, which is what keeps the meal counts
   * and the attendance record per person.
   */
  function guestRow(r, g) {
    return { name: g.name, time: g.time || r.time, attended: g.attended, lunch: g.lunch };
  }

  /**
   * THE ONE QUESTION THE DOOR IS THE RIGHT PLACE TO ASK. Somebody has just
   * been marked in; they are standing there, and this is the moment they will
   * say "do I have to do this every week?" — so ask it for them, once, and
   * offer the two answers the system can actually act on.
   *
   * It is a prompt and not a required step: the queue behind them is the
   * reason this page exists, so "No thanks" is the biggest, easiest target and
   * the panel closes on its own if it is ignored.
   */
  function afterCheckIn(r) {
    var el = document.getElementById('prompt');
    var program = sessionTitle();
    el.innerHTML =
      '<h2>' + escapeHtml(r.name) + ' is checked in.</h2>' +
      '<p>While they are here — anything else?</p>' +
      '<button class="primary" id="p-standing">Put them on the list for every ' +
        escapeHtml(program) + '</button>' +
      '<button class="plain" id="p-future">Register them for another date</button>' +
      '<button class="plain" id="p-none">No thanks</button>';
    el.classList.remove('hide');
    document.getElementById('p-standing').onclick = function () {
      closePrompt();
      joinStanding(r);
    };
    document.getElementById('p-future').onclick = function () {
      closePrompt();
      document.getElementById('reg-name').value = r.name;
      showPage('register');
    };
    document.getElementById('p-none').onclick = closePrompt;
    if (promptTimer) window.clearTimeout(promptTimer);
    // Long enough to read and answer, short enough that a volunteer who has
    // already moved on to the next person is not looking at a panel over the
    // list.
    promptTimer = window.setTimeout(closePrompt, 12000);
  }

  var promptTimer = null;
  function closePrompt() {
    if (promptTimer) window.clearTimeout(promptTimer);
    document.getElementById('prompt').classList.add('hide');
  }

  /** "Every week from now on" — the standing place, on the session in front of us. */
  function joinStanding(r) {
    var lunch = window.confirm('Put ' + r.name + ' down for the lunch on every one of those dates too?\\n\\n' +
      'OK = the program and the lunch. Cancel = the program only.');
    setBusy(true);
    say('Adding ' + r.name + ' to the standing list...', '');
    call('checkInRegister', {
      location: document.getElementById('location').value,
      session: document.getElementById('session').value,
      name: r.name,
      standing: true,
      standingLunch: lunch
    }, function (res) {
      setBusy(false);
      draw();
      if (!res || !res.ok) return handle(res);
      say(res.message || 'Added.', 'ok');
    });
  }

  function sessionTitle() {
    var value = document.getElementById('session').value;
    var found = (INDEX.sessions || []).filter(function (s) { return s.value === value; })[0];
    return (found && found.title) || 'this program';
  }

  // --------------------------------------------------------------------------
  // The second screen: registering somebody for a future date
  // --------------------------------------------------------------------------

  function showPage(which) {
    var register = which === 'register';
    document.getElementById('app').classList.toggle('hide', register);
    document.getElementById('regpage').classList.toggle('hide', !register);
    document.getElementById('tab-checkin').className = register ? '' : 'on';
    document.getElementById('tab-register').className = register ? 'on' : '';
    document.getElementById('heading').textContent = register ? 'Register Someone' : 'Check In';
    closePrompt();
    if (register) fillRegister();
  }

  var registerFilled = false;
  function fillRegister() {
    if (registerFilled) return;
    registerFilled = true;
    var names = document.getElementById('members');
    (INDEX.members || []).forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.name;
      names.appendChild(o);
    });
    var sel = document.getElementById('reg-location');
    sel.innerHTML = '<option value="">Choose a location</option>';
    (OPTS.locations || []).forEach(function (loc) {
      var o = document.createElement('option');
      o.value = loc; o.textContent = loc;
      sel.appendChild(o);
    });
    // The building this tablet lives in, or the one the door list is already
    // on — whichever is known. Registering somebody almost always starts from
    // where you are standing.
    sel.value = OPTS.location || document.getElementById('location').value || '';
    regLocationChanged();
  }

  /**
   * TWO MONTHS OF DATES, ASKED FOR ONCE PER LOCATION.
   *
   * The list inlined in the page (OPTS.upcoming) is the door's own week — it
   * is what makes this screen usable on the first frame, and it is nowhere
   * near an answer to "have you got anything in October". deskMonthSessions()
   * reads this month and next live off the workbook; it lands a moment later
   * and replaces the week, and it is kept per location so switching back and
   * forth does not re-read anything.
   */
  var REG_MONTHS = {};      // location -> days, once it has been read
  var REG_DAYS = [];        // the days on screen now
  var REG_MONTHS_ASKED = {};

  function regLocationChanged() {
    var loc = document.getElementById('reg-location').value;
    document.getElementById('reg-session').value = '';
    document.getElementById('reg-session-boxes').innerHTML = '';
    // The inlined week first, so the screen is never empty while the months
    // are being read.
    REG_DAYS = REG_MONTHS[loc] || groupSessionsByDay(
      (OPTS.upcoming || []).filter(function (s) { return s.location === loc; }));
    drawRegDays();
    if (loc && !REG_MONTHS[loc] && !REG_MONTHS_ASKED[loc]) loadRegMonths(loc);
  }

  function loadRegMonths(loc) {
    REG_MONTHS_ASKED[loc] = true;
    call('deskMonthSessions', { location: loc }, function (res) {
      if (!res || !res.ok) {
        // NOT AN ERROR THE VOLUNTEER HAS TO ACT ON: the week is still on
        // screen and still registers people. Said quietly, and the read is
        // allowed to be tried again by re-picking the location.
        REG_MONTHS_ASKED[loc] = false;
        return say((res && res.message) || 'The coming months could not be read — ' +
          'the next few days are still listed.', 'err');
      }
      REG_MONTHS[res.location || loc] = res.days || [];
      if (document.getElementById('reg-location').value !== loc) return;
      var chosen = document.getElementById('reg-day').value;
      REG_DAYS = REG_MONTHS[loc];
      drawRegDays(chosen);
    });
  }

  /** The day dropdown, headed by month — "October 2026" is the thing being asked for. */
  function drawRegDays(keepDateKey) {
    var sel = document.getElementById('reg-day');
    fillDaySelect(sel, REG_DAYS, 'monthLabel');
    sel.disabled = !REG_DAYS.length;
    var wanted = keepDateKey && dayFor(REG_DAYS, keepDateKey) ? keepDateKey
      : (REG_DAYS.length ? REG_DAYS[0].dateKey : '');
    sel.value = wanted;
    regDayChanged();
  }

  function regDayChanged() {
    var day = dayFor(REG_DAYS, document.getElementById('reg-day').value);
    document.getElementById('reg-session').value =
      day && day.sessions.length === 1 ? day.sessions[0].value : '';
    redrawRegSessions(day);
    regSessionChanged();
  }

  function redrawRegSessions(day) {
    drawSessionBoxes('reg-session-boxes', day, function (session) {
      document.getElementById('reg-session').value = session.value;
      redrawRegSessions(day);
      regSessionChanged();
    });
  }

  function regSessionChanged() {
    var found = regSession();
    var wrap = document.getElementById('reg-timewrap');
    var times = document.getElementById('reg-time');
    times.innerHTML = '';
    // AN APPOINTMENT PROGRAM IS BOOKED BY TIME, and only the free times are
    // offered — the same list the public form is offering at this moment
    // (freeAppointmentTimesForChoice()), so the desk and the website never
    // hand out the same chair.
    var slots = (found && found.byAppointment && found.times) || [];
    wrap.classList.toggle('hide', !slots.length);
    slots.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.value; o.textContent = t.label;
      times.appendChild(o);
    });
    if (found && found.byAppointment && !slots.length) {
      say('Every appointment on that date has gone — pick another date.', 'err');
    }
  }

  function regSession() {
    var value = document.getElementById('reg-session').value;
    if (!value) return null;
    var day = dayFor(REG_DAYS, document.getElementById('reg-day').value);
    var found = (day ? day.sessions : []).filter(function (s) { return s.value === value; })[0];
    // The inlined week is still the fallback: a page whose month read failed
    // registers people off it exactly as it did before.
    return found || (OPTS.upcoming || []).filter(function (s) { return s.value === value; })[0] || null;
  }

  function standingChanged() {
    document.getElementById('reg-standing-lunch-wrap').style.display =
      document.getElementById('reg-standing').checked ? 'flex' : 'none';
  }

  function submitRegistration() {
    var name = document.getElementById('reg-name').value.trim();
    var found = regSession();
    if (!name) return say('Type a name first.', 'err');
    if (!found) return say('Pick a session first.', 'err');
    var guests = ['reg-guest-1', 'reg-guest-2', 'reg-guest-3'].map(function (id) {
      return document.getElementById(id).value.trim();
    }).filter(function (g) { return g; });
    var payload = {
      location: document.getElementById('reg-location').value,
      session: found.value,
      name: name,
      appointmentTime: found.byAppointment ? document.getElementById('reg-time').value : '',
      guests: guests,
      standing: document.getElementById('reg-standing').checked,
      standingLunch: document.getElementById('reg-standing-lunch').checked
    };
    document.getElementById('reg-submit').disabled = true;
    say('Registering ' + name + '...', '');
    call('checkInRegister', payload, function (res) {
      document.getElementById('reg-submit').disabled = false;
      if (!res || !res.ok) return handle(res);
      say(res.message || 'Registered.', 'ok');
      // Cleared so the next person typed in is not registered on top of the
      // last one's guests — the commonest way a desk form goes wrong.
      ['reg-name', 'reg-guest-1', 'reg-guest-2', 'reg-guest-3'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      document.getElementById('reg-standing').checked = false;
      document.getElementById('reg-standing-lunch').checked = false;
      standingChanged();
      // The stored lists on the server have been dropped by the write; the
      // roster on the other screen is re-read when it is next chosen, and this
      // page's session list is only ever dates, which have not changed.
      if (!document.getElementById('app').classList.contains('hide')) refresh();
    });
  }

  function tapLunch(r) {
    if (r.lunch) {
      if (!window.confirm('Clear the lunch mark for ' + r.name + '?')) return;
      // Clearing the meal clears the whole row, then puts the attendance back
      // if they were also here — the sheet has one "clear" and this is the
      // page keeping the other half of what it knew.
      return mark(r, { clear: true }, function () {
        if (r.attended) mark(r, { attended: true });
      });
    }
    // Lunch WITHOUT attended clears attended (see applyQuickMarkLocked) — the
    // take-out case. Somebody already marked here keeps their attendance by
    // being sent both.
    mark(r, { attended: r.attended, lunch: true });
  }

  function mark(r, what, then) {
    setBusy(true);
    draw();
    var payload = {
      location: document.getElementById('location').value,
      session: document.getElementById('session').value,
      name: r.name,
      bookedTime: r.time,
      attended: !!what.attended,
      lunch: !!what.lunch,
      clear: !!what.clear
    };
    call('checkInMark', payload, function (res) {
      setBusy(false);
      if (!res || !res.ok) { draw(); return handle(res); }
      // Applied to the row in hand rather than by re-reading the tab: at a
      // door the next person is already standing there, and a full refresh
      // between every two people is the wait that made the dialog unusable.
      if (what.clear) { r.attended = false; r.lunch = false; }
      if (what.attended) r.attended = true;
      if (what.lunch) { r.lunch = true; r.attended = !!what.attended; }
      say(res.message || 'Done.', 'ok');
      draw();
      if (then) then();
    });
  }

  function handle(res) {
    if (res && res.needsPin) {
      try { window.localStorage.removeItem('checkInPin'); } catch (err) { /* ignore */ }
      pin = '';
      say(res.message || 'Wrong PIN.', 'err');
      return showPin();
    }
    say((res && res.message) || 'Something went wrong - nothing was marked.', 'err');
  }

  function call(fn, payload, done) {
    payload.pin = pin;
    google.script.run
      .withSuccessHandler(done)
      .withFailureHandler(function (err) {
        setBusy(false);
        draw();
        say(err && err.message ? err.message : String(err), 'err');
      })[fn](JSON.stringify(payload));
  }

  function setBusy(v) { busy = v; }

  var hideTimer = null;
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'show ' + (cls || '');
    if (hideTimer) window.clearTimeout(hideTimer);
    // Long enough to read standing up, short enough not to sit over the list
    // while the next person is being marked.
    if (cls === 'ok') hideTimer = window.setTimeout(hideStatus, 2600);
  }

  function hideStatus() { document.getElementById('status').className = ''; }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  start();
</script>`;
}

// ----------------------------------------------------------------------------
// The menu item that makes the page findable
// ----------------------------------------------------------------------------

/**
 * WHERE THE LINK LIVES. A web app URL is invisible from inside the workbook:
 * it exists in the Apps Script deployment screen, which is not a place a
 * program director goes, and a URL that has to be fetched from there once per
 * tablet is a URL that ends up pasted into an email and lost.
 *
 * So this dialog says it out loud — the deployment link, one per-building link
 * beside it (the ?location= pin), and the PIN, set and cleared from the same
 * screen.
 *
 * A workbook whose script has never been DEPLOYED as a web app has no URL to
 * show, and getUrl() returns nothing rather than throwing. That is the common
 * case the first time somebody opens this, so it is answered with the four
 * steps rather than with a blank.
 */
function showCheckInPageDialog() {
  const html = HtmlService.createHtmlOutput(buildCheckInPageHtml(readCheckInPageInfo()))
    // Two links per building now, each with a line saying which is which, so
    // a three-location workbook needs the room to show six without the PIN
    // box being scrolled off the bottom.
    .setWidth(560)
    .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Door Pages');
}

/**
 * { url, isDev, locations, pinSet } — everything the dialog above renders.
 *
 * THE DEV-URL TRAP, and why isDev exists. getUrl() does not always hand back
 * the published address: on a script whose head version has never been
 * deployed — and sometimes even on one that has — it returns the script
 * editor's own test address, the one ending in "/dev". That URL works
 * perfectly for the person who owns the script, which is exactly what makes
 * it dangerous: you copy it, it opens on your laptop, you send it to the
 * desk, and the tablet gets
 *
 *     "Sorry, unable to open the file at this time."
 *
 * — because the test address is readable only by an account with EDIT access
 * to the script, and a tablet has none. The published address ends in "/exec"
 * instead, and only a real deployment produces one. So the dialog says which
 * of the two it is holding rather than presenting them as the same link.
 */
function readCheckInPageInfo() {
  const savedUrl = readSavedCheckInWebAppUrl();
  const scriptUrl = readScriptReportedWebAppUrl();
  const url = savedUrl || scriptUrl;
  return {
    url,
    savedUrl,
    scriptUrl,
    // Which of the two the links above are built from, so the dialog can say
    // so rather than presenting a guess as a fact.
    fromSaved: !!savedUrl,
    // Only ever describes the SCRIPT-REPORTED address now: a pasted one can
    // never be a /dev address (normalizeCheckInWebAppUrl() refuses those), so
    // the warning belongs to the fallback and would be a lie about the other.
    isDev: !savedUrl && /\/dev(\?|#|$)/.test(url),
    // TWO DEPLOYMENTS, ONE WORKBOOK. The saved address and the one the script
    // reports carry different ids — so they are not two spellings of one
    // deployment (stripWebAppDomainSegment() has already settled that), they
    // are two deployments with their own access settings and their own pinned
    // versions. Worth saying above the links, because the only other symptom
    // is a link that opens for whoever published it and for nobody else.
    mismatch: !!(savedUrl && scriptUrl &&
      webAppDeploymentId(savedUrl) && webAppDeploymentId(scriptUrl) &&
      webAppDeploymentId(savedUrl) !== webAppDeploymentId(scriptUrl)),
    locations: checkInLocations(),
    pinSet: isCheckInPinSet()
  };
}

/**
 * Sets or clears the check-in PIN. Called from the dialog.
 *
 * A BLANK CLEARS IT, and that is worth saying in the answer rather than
 * leaving to be inferred: "no PIN" is a real, deliberate setting for the
 * deployment where Google is already asking who the visitor is, and somebody
 * who empties the box needs to be told which of the two states they landed in.
 */
function setCheckInPin(pin) {
  const value = String(pin || '').trim();
  const props = PropertiesService.getScriptProperties();
  if (!value) {
    props.deleteProperty(CHECK_IN_PIN_PROP_KEY);
    return {
      ok: true, pinSet: false,
      message: 'PIN cleared. Anyone who can open the link can now mark attendance — ' +
        'only deploy it to your organization, not to the whole internet.'
    };
  }
  props.setProperty(CHECK_IN_PIN_PROP_KEY, value);
  return {
    ok: true, pinSet: true,
    message: `PIN set to ${value}. Each tablet is asked for it once and remembers it.`
  };
}

/** The dialog's markup. Inline, like every other dialog in this file. */
function buildCheckInPageHtml(info) {
  const data = JSON.stringify(JSON.stringify(info || {})).replace(/<\//g, '<\\/');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 14px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.5; }
  .link { background: #F1F3F4; border-radius: 4px; padding: 8px 10px; margin: 6px 0;
          font-size: 12px; word-break: break-all; }
  .link b { font-family: Arial, Helvetica, sans-serif; display: block; margin-bottom: 3px; }
  .link a { font-family: monospace; color: #1A73E8; }
  .link i { display: block; font-family: Arial, Helvetica, sans-serif; font-style: normal;
            color: #666; margin-top: 4px; line-height: 1.4; }
  button.copy { background: #fff; color: #1A73E8; border: 1px solid #DADCE0; border-radius: 4px;
                padding: 3px 8px; font-size: 11px; margin-left: 6px; vertical-align: 1px; }
  ol { padding-left: 20px; line-height: 1.6; }
  input[type=text] { width: 140px; padding: 6px; font-size: 13px; }
  input#weburl { width: 100%; margin-bottom: 6px; font-family: monospace; font-size: 12px; }
  code { background: #F1F3F4; border-radius: 3px; padding: 0 3px; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; }
  #status { margin-top: 10px; min-height: 16px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .warn { color: #B06000; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin-top: 14px; padding: 8px 12px; }
  legend { font-weight: bold; padding: 0 4px; }
</style>
<h3>Door Pages</h3>
<p class="hint">
  Two pages on one deployment, both writing to the same rows Quick Mark writes to.
  The <b>sign-in page</b> is for the tablet by the entrance: it shows everybody signed up here
  today, then today's programs and lunch, and it can register a walk-in — or a brand-new
  member — on the spot. The <b>check-in list</b> is the staff one: one session at a time, tap a
  name to mark them present and tap Lunch as meals are handed over.
</p>
<div id="links"></div>

<fieldset>
  <legend>The deployment address</legend>
  <p class="hint" id="urlstate"></p>
  <input type="text" id="weburl" placeholder="https://script.google.com/…/exec">
  <button onclick="saveUrl()">Save</button>
  <p class="hint">
    <b>If a link above says the page is not accessible, this is the box that fixes it.</b>
    Apps Script does not reliably tell a script its own published address — it often reports the
    editor's test address (ending <code>/dev</code>), which opens only for people who can edit
    this script. Open <b>Deploy ▸ Manage deployments</b>, copy the <b>Web app</b> URL (it ends in
    <code>/exec</code>), and paste it here once. Clear the box and save to go back to guessing.
  </p>
</fieldset>

<fieldset>
  <legend>Desk PIN</legend>
  <p class="hint" id="pinstate"></p>
  <input type="text" id="pin" placeholder="e.g. 4821">
  <button onclick="save()">Save</button>
</fieldset>
<div id="status"></div>

<script>
  var INFO = JSON.parse(${data});

  function draw() {
    var el = document.getElementById('links');
    if (!INFO.url) {
      el.innerHTML = '<p class="hint"><b>Not deployed yet.</b> The page exists in this script but ' +
        'has no address until it is published:</p><ol>' +
        '<li>Extensions &rarr; Apps Script</li>' +
        '<li>Deploy &rarr; New deployment &rarr; Web app</li>' +
        '<li>Execute as <b>Me</b>; Who has access <b>Anyone within your organization</b> ' +
        '(or <b>Anyone</b> if the tablets are not signed in — set a PIN below if so)</li>' +
        '<li>Deploy, then reopen this window for the link</li></ol>';
      return;
    }
    // THE /dev URL IS NOT A LINK YOU CAN HAND OUT. It opens fine for whoever
    // owns the script and fails for everybody else with "unable to open the
    // file at this time" — which reads as a broken page rather than as a
    // permission answer, so say it before the link rather than after it.
    if (INFO.isDev) {
      el.innerHTML = '<p class="hint"><b>This is the test address, not a published one.</b> ' +
        'It ends in <code>/dev</code>, which only opens for accounts that can edit this script — ' +
        'a tablet gets <i>"Sorry, unable to open the file at this time"</i>. To get a link that ' +
        'works at the desk:</p><ol>' +
        '<li>Extensions &rarr; Apps Script</li>' +
        '<li>Deploy &rarr; <b>New deployment</b> &rarr; Web app</li>' +
        '<li>Execute as <b>Me</b>; Who has access <b>Anyone within your organization</b> ' +
        '(or <b>Anyone</b> if the tablets are not signed in — set a PIN below if so)</li>' +
        '<li>Deploy, then paste the <code>/exec</code> address into the box below</li></ol>' +
        '<div class="link"><b>Test address (you only)</b>' +
        '<a href="' + esc(INFO.url) + '" target="_blank" rel="noopener">' + esc(INFO.url) + '</a></div>';
      return;
    }
    // A LINK IS AN ANCHOR. These were printed as plain monospace text, which
    // looks exactly like a link in a dialog and does nothing at all when it is
    // tapped — the reported "the links in the menu don't work". Each one is now
    // a real <a target="_blank"> (a dialog is an iframe; without _blank the
    // page would try to open inside this 520px box), with a Copy button beside
    // it for the far more common job of getting the address onto a tablet.
    var html = '';
    if (INFO.mismatch) {
      html += '<p class="hint warn"><b>Two deployments.</b> The address you saved and the one this ' +
        'script reports for itself are different deployments, with their own access settings and ' +
        'their own published versions. The links below use the saved one. If the door starts ' +
        'serving old behaviour, it is the other deployment that got the new version.</p>';
    }
    (INFO.locations || []).forEach(function (loc) {
      html += linkRow(loc + ' — sign-in page (the door)',
        INFO.url + '?location=' + encodeURIComponent(loc),
        'Everyone signed up today, then today\\'s programs and lunch. Put this one on the ' +
        'tablet by the entrance.');
      html += linkRow(loc + ' — check-in list (staff)',
        INFO.url + '?location=' + encodeURIComponent(loc) + '&mode=session',
        'One session at a time: tap a registered name to mark them present, tap Lunch as ' +
        'meals are handed over.');
    });
    html += linkRow('Any location (asks which)', INFO.url, '');
    // The second screen of the staff list: registering somebody for a future
    // date, with their guests, and onto a program's standing list. Not the
    // default page anywhere, so it needs a link of its own or nobody finds it.
    html += linkRow('Register someone (desk phone)', INFO.url + '?mode=session&page=register',
      'Put a person on any upcoming session — with their guests, and on the every-week list ' +
      'for that program if they never want to sign up again.');
    el.innerHTML = html +
      '<p class="hint">Open one on the tablet and add it to the home screen.' +
      (INFO.fromSaved
        ? ' Built from the address you saved below.'
        : ' Built from the address the script reports, which is not always the published one — ' +
          'if these give an error, paste the real one below.') +
      '</p>' +
      // THE OTHER HALF OF "the link works but the page is out of date". A
      // deployment is pinned to a VERSION, so editing the script changes
      // nothing at the door until a new version is published. It is invisible
      // from here — there is no API for it — so it is said every time.
      '<p class="hint"><b>After pasting new code:</b> Deploy &rarr; Manage deployments &rarr; ' +
      'the pencil &rarr; Version: <b>New version</b> &rarr; Deploy. Until you do, the tablets ' +
      'keep serving the version that was published last, whatever the script now says.</p>';
  }

  function drawUrl() {
    var box = document.getElementById('weburl');
    if (!box.value) box.value = INFO.savedUrl || INFO.scriptUrl || '';
    document.getElementById('urlstate').textContent = INFO.savedUrl
      ? 'Saved — every link above is built from this.'
      : (INFO.scriptUrl
        ? 'Nothing saved. The links above use the address the script reports: ' + INFO.scriptUrl
        : 'Nothing saved, and the script reports no address at all — it has never been deployed.');
  }

  function saveUrl() {
    google.script.run
      .withSuccessHandler(function (res) {
        INFO.savedUrl = res.savedUrl;
        INFO.fromSaved = !!res.savedUrl;
        INFO.url = res.savedUrl || INFO.scriptUrl;
        // NO REGEX LITERAL HERE. This whole page is built inside a template
        // literal, which eats the backslash in \/ on its way out — the emitted
        // script then read //dev(?|#|$)/, a syntax error that killed the
        // dialog's ENTIRE script block, which is why the links area was blank
        // rather than wrong. A string test says the same thing and cannot be
        // damaged in transit.
        INFO.isDev = !res.savedUrl && isDevUrl(INFO.url);
        INFO.mismatch = !!(res.savedUrl && INFO.scriptUrl &&
          deploymentId(res.savedUrl) && deploymentId(INFO.scriptUrl) &&
          deploymentId(res.savedUrl) !== deploymentId(INFO.scriptUrl));
        draw();
        drawUrl();
        var s2 = document.getElementById('status');
        s2.textContent = res.message;
        s2.className = res.ok ? 'ok' : 'warn';
      })
      .withFailureHandler(function (err) {
        var s2 = document.getElementById('status');
        s2.textContent = String(err && err.message ? err.message : err);
        s2.className = 'warn';
      })
      .setCheckInWebAppUrl(document.getElementById('weburl').value);
  }

  /** One labelled, clickable, copyable address. */
  function linkRow(label, url, note) {
    return '<div class="link"><b>' + esc(label) + '</b>' +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>' +
      '<button class="copy" onclick="copyLink(this, \\'' + esc(url).replace(/'/g, '&#39;') +
      '\\')">Copy</button>' +
      (note ? '<i>' + esc(note) + '</i>' : '') + '</div>';
  }

  /**
   * Copy, with the fallback that matters: navigator.clipboard is unavailable
   * in plenty of the browsers this dialog is opened in, and a Copy button that
   * silently does nothing is worse than no button. The selection fallback
   * works everywhere back to IE.
   */
  function copyLink(button, url) {
    var done = function () { button.textContent = 'Copied'; };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(url).then(done, function () { selectFallback(url, done); });
      }
    } catch (err) { /* fall through */ }
    selectFallback(url, done);
  }

  function selectFallback(url, done) {
    var box = document.createElement('textarea');
    box.value = url;
    document.body.appendChild(box);
    box.select();
    try { document.execCommand('copy'); done(); } catch (err) { /* leave it selected */ }
    document.body.removeChild(box);
  }

  function drawPin() {
    document.getElementById('pinstate').textContent = INFO.pinSet
      ? 'A PIN is set. Each tablet is asked for it once. Clear the box and save to remove it.'
      : 'No PIN. Anyone who can open the link can mark attendance — fine when the link is ' +
        'restricted to your organization, not when it is public.';
  }

  function save() {
    google.script.run
      .withSuccessHandler(function (res) {
        INFO.pinSet = res.pinSet;
        drawPin();
        var s = document.getElementById('status');
        s.textContent = res.message;
        s.className = res.pinSet ? 'ok' : 'warn';
      })
      .withFailureHandler(function (err) {
        var s = document.getElementById('status');
        s.textContent = String(err && err.message ? err.message : err);
        s.className = 'warn';
      })
      .setCheckInPin(document.getElementById('pin').value);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // The server's webAppDeploymentId(), repeated here for the one thing the
  // dialog decides on its own: whether the address just saved is the same
  // deployment as the one the script reports, without a second round trip.
  function isDevUrl(url) {
    var path = String(url || '').split('?')[0].split('#')[0];
    return path.slice(-4) === '/dev';
  }

  function deploymentId(url) {
    // Split rather than matched, for the reason isDevUrl() gives: a regex
    // literal written in here loses its backslashes on the way out of the
    // template literal that builds this page.
    var parts = String(url || '').split('/macros/s/');
    if (parts.length < 2) return '';
    return parts[1].split('/')[0].split('?')[0].split('#')[0];
  }

  draw();
  drawUrl();
  drawPin();
</script>`;
}


