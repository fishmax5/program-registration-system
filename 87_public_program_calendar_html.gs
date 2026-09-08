// ============================================================================
// 17a. THE PUBLIC CALENDAR'S PAGE  (one tile per program, and one tap to a form)
// ============================================================================
//
// One served page, no navigations, no spinners on the path a person actually
// takes. What is in 86_public_program_calendar.gs is the read and the rules
// about what a stranger may see; what is here is the promise the page makes
// about how it feels:
//
//   1. IT SAYS WHOSE CALENDAR THIS IS BEFORE IT SAYS WHAT IS ON. Every other
//      page here opens straight onto a list, because everybody holding one
//      already knows. This link is printed on a flyer and forwarded by a
//      neighbour, so it opens with the centre's name, a sentence, the phone
//      number and the two buildings with their addresses — all of it out of
//      the snapshot (PUBLIC_CALENDAR_INTRO and the CENTER_* constants in
//      `04`), never typed into this markup, so a changed phone number cannot
//      be right on a form and wrong here.
//   2. IT READS BY PROGRAM, NOT BY DATE, AS A GRID. This page was a diary:
//      one card per SESSION under a heading per day, which for a weekly class
//      was the same four words repeated eight times down a phone screen and
//      for lunch was a card a day for two months. A program is now ONE TILE
//      carrying its dates, two tiles to a row on anything wider than a phone,
//      so what is on fits on a screen instead of a scroll. `programKey` on
//      each session is what the grouping is done on; the server decides it
//      (title + building), so a `[Shared]` program running in two buildings
//      stays two tiles.
//   3. LUNCH IS PINNED, AND FULL WIDTH. It runs nearly every weekday at both
//      buildings, it is what the largest number of people are looking for,
//      and in date order it would sit wherever tomorrow happens to fall.
//   4. THE WHOLE TILE IS THE BUTTON. Not a link tucked in a corner: the
//      rectangle opens the next date somebody can actually get into, and the
//      date chips inside it are still their own links for the months the
//      program's form changes over. That is why the tile is a role="button"
//      div and not an <a> — an anchor inside an anchor is not a thing a
//      browser will honour.
//   5. "WAITING LIST" IS SAID ABOUT A PROGRAM ONLY WHEN EVERY DATE IN VIEW IS
//      FULL. A class with four open weeks and one full one is a class you can
//      come to; labelling the whole tile "waiting list" because its NEXT date
//      is full sends that person away from something they could have had. The
//      full dates are coloured instead, and the tile says which colour means
//      what when it is carrying both.
//   6. THE FIRST FRAME IS THE ANSWER. The whole window — today to the end of
//      next month — is inlined into the page, so the calendar is drawn before
//      the browser has made a single request of its own.
//   7. EVERY FILTER IS ARITHMETIC, NEVER A ROUND TRIP. Week, month, building,
//      search: each one re-runs against the array already in memory and
//      redraws in the same frame as the tap. This is the whole reason the
//      window travels at once (see the banner in 86). `?span=week` and
//      `?span=month` only decide which of those filters is already pressed
//      when the page opens — which is what makes a weekly link and a monthly
//      link two printable addresses rather than two pages to maintain.
//   8. THE REFRESH IS QUIET AND IT IS BEHIND THEM. A background read runs
//      once after the first paint and replaces the inlined snapshot if it has
//      moved — but never while a filter is being tapped, and never as a
//      flash of empty. A page that redraws under a thumb is how somebody taps
//      the wrong Thursday.
//
// EVERYTHING FROM THE WORKBOOK IS WRITTEN WITH textContent. Program titles are
// typed by staff into a calendar and they contain apostrophes, ampersands and
// — this has happened — angle brackets. This page uses no innerHTML with data
// in it at all: tiles are built out of createElement, and the one place data
// crosses into script is the double-JSON.stringify below. See
// tests/public_calendar.test.js, which is what holds that line.
// ============================================================================

/**
 * The public calendar, as one string.
 *
 * `snapshot` is what publicProgramCalendar() returned — inlined so the first
 * frame is complete. A FAILED read is inlined just as faithfully: the page
 * says it could not look, which is a different sentence from "nothing is on"
 * and the only one of the two that should send somebody to the phone.
 *
 * `options` is what publicCalendarViewOptions() read off the query string, and
 * it changes how this page is DRAWN and nothing about what it contains:
 *
 *   span      the range the page opens on — 'week', 'month', 'all' or '' for
 *             whatever this browser last chose. Resolved from the URL by
 *             publicCalendarSpanRequested_() in 91, so the two printed links,
 *             the embed and the page cannot disagree about what "weekly" means
 *   embed     this page is inside somebody else's website — see the banner in
 *             17b, and publicEmbedSkinStyles() in 91
 *   location  one building, pinned by the embed's author
 *
 * THE PINNED BUILDING IS RESOLVED HERE, against the buildings the snapshot
 * actually has, and case-insensitively: an embed is typed by hand into a
 * website's HTML months before anybody notices it says "narberth". A pin that
 * matches nothing is DROPPED rather than applied — a website showing an empty
 * calendar because a building was renamed is worse than one showing every
 * building, and it is the failure nobody reports because it looks deliberate.
 */
function buildPublicCalendarHtml(snapshot, options) {
  const snap = snapshot || { ok: false, sessions: [] };
  const opts = options || {};
  const embed = !!opts.embed;
  const data = JSON.stringify(JSON.stringify(snap)).replace(/<\//g, '<\\/');
  const span = JSON.stringify(String(opts.span || ''));

  const wanted = String(opts.location || '').trim().toLowerCase();
  const known = (snap && snap.locations) || [];
  let pinnedLocation = '';
  for (let i = 0; i < known.length && !pinnedLocation; i++) {
    if (String(known[i]).trim().toLowerCase() === wanted) pinnedLocation = known[i];
  }
  // THE SAME DOUBLE ESCAPE THE SNAPSHOT GETS, and for a sharper reason: this
  // one came off the URL. ?building=</script> is a page ended mid-sentence by
  // anybody who can type an address, so nothing here is ever interpolated raw.
  const embedding = JSON.stringify(JSON.stringify({
    embed,
    location: pinnedLocation,
    message: PUBLIC_CALENDAR_EMBED_MESSAGE
  })).replace(/<\//g, '<\\/');

  return `
${publicEmbedStyles()}${publicEmbedSkinStyles(embed)}

<div class="wrap">
${embed ? '' : `  <header>
    <p class="eyebrow">Programs &amp; sign-ups</p>
    <h1 id="orgName">Programs &amp; Sign-Ups</h1>
    <p class="blurb" id="blurb">Everything coming up. Tap a program to open its sign-up form.</p>
    <p class="lines" id="contact"></p>
    <p class="places" id="places"></p>
  </header>
`}
  <div class="controls">
    <div class="seg" role="group" aria-label="How far ahead">
      <button type="button" id="r7" onclick="setRange(7)">This week</button>
      <button type="button" id="r31" onclick="setRange(31)">This month</button>
      <button type="button" id="r0" onclick="setRange(0)">Everything</button>
    </div>
    <div class="locbar" id="locbar" role="group" aria-label="Location"></div>
    <div class="row2">
      <input type="search" id="q" placeholder="Search programs" autocomplete="off"
             oninput="onSearch()" aria-label="Search programs">
    </div>
    <div class="count">
      <span id="count"></span>
      <button type="button" onclick="refresh(true)" id="refresh">Refresh</button>
    </div>
  </div>

  <div id="list"></div>

  <footer id="foot"></footer>
</div>

<script>
  var DATA = JSON.parse(${data});
  var SESSIONS = (DATA && DATA.sessions) || [];
  var SPAN = ${span};
  var EMBED = JSON.parse(${embedding});
  var STORE_KEY = 'publicCalendarPrefs.v1';
  // How many dates a tile shows before it offers the rest. Six is two rows in
  // a half-width tile: enough to see the rhythm of a weekly class, short of
  // the wall of chips a daily one would otherwise be.
  var CHIP_LIMIT = 6;

  // The filter, and the whole of the page's state. Restored from this
  // browser's own storage so somebody who only ever wants Narberth is not
  // asked which building every single time they open the link.
  var view = { days: 7, location: '', q: '' };
  try {
    var saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      if (saved.days === 0 || saved.days === 7 || saved.days === 31) view.days = saved.days;
      if (typeof saved.location === 'string') view.location = saved.location;
    }
  } catch (err) { /* private browsing, or nothing stored yet */ }

  // THE LINK WINS OVER THE MEMORY, and only over the range. Somebody who
  // opened the weekly link asked for this week just now; what they chose on
  // some previous visit is the older answer of the two. Their BUILDING is
  // left alone — no printed link claims to know which one they want.
  if (SPAN === 'week') view.days = 7;
  else if (SPAN === 'month') view.days = 31;
  else if (SPAN === 'all') view.days = 0;

  // AN EMBED'S BUILDING IS THE EXCEPTION, and it is a different kind of claim:
  // a printed link is handed to a person, but a pinned embed IS a page on the
  // website — the Narberth page shows Narberth to a visitor whose last visit
  // was to the flyer link and left Ashbridge in this browser's storage.
  if (EMBED.location) view.location = EMBED.location;

  function save() {
    // A PINNED PAGE REMEMBERS NOTHING. The embed and the printed link are the
    // same origin and share this key, so an embed that stored its own pin
    // would quietly re-open the flyer link on one building — a setting the
    // person who typed the URL made, applied to somebody who never saw it.
    if (EMBED.location) return;
    try {
      window.localStorage.setItem(STORE_KEY,
        JSON.stringify({ days: view.days, location: view.location }));
    } catch (err) { /* private browsing */ }
  }

  // --------------------------------------------------------------------
  // Dates. All comparison is on the 'yyyy-MM-dd' keys the server built, so
  // nothing here has to parse a date or know a timezone — a browser in
  // another one still agrees with the workbook about which day is Thursday.
  // --------------------------------------------------------------------
  function todayKey() { return (DATA && DATA.todayKey) || ''; }

  function keyPlusDays(key, days) {
    var p = String(key).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  /** "Today" / "Tomorrow" for the two dates that earn a word instead of a date. */
  function relativeDay(key) {
    var t = todayKey();
    if (!t) return '';
    if (key === t) return 'Today';
    if (key === keyPlusDays(t, 1)) return 'Tomorrow';
    return '';
  }

  var PLURAL_DAYS = { Sun: 'Sundays', Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays',
                      Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays' };

  // --------------------------------------------------------------------
  // The filter — one pass, no allocation per keystroke beyond the result.
  // --------------------------------------------------------------------
  function visible() {
    var last = view.days ? keyPlusDays(todayKey(), view.days - 1) : '';
    var needle = view.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < SESSIONS.length; i++) {
      var s = SESSIONS[i];
      if (last && s.dateKey > last) break; // sorted by date: nothing after this matches either
      if (view.location && s.location !== view.location) continue;
      if (needle && (s.title + ' ' + s.location).toLowerCase().indexOf(needle) === -1) continue;
      out.push(s);
    }
    return out;
  }

  /**
   * THE GROUPING — sessions in date order, folded into programs in the order
   * their NEXT session falls, with LUNCH PINNED AHEAD OF ALL OF IT.
   *
   * The date ordering is free: the array is already sorted by date, so the
   * first time a program is seen is its next date. The pin is not about
   * dates at all — lunch runs nearly every weekday at both buildings and is
   * what the largest number of people come to this page for, and in date
   * order it lands wherever tomorrow happens to fall.
   */
  function programsFrom(rows) {
    var order = [], byKey = {};
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i];
      var key = s.programKey || (s.title + '|' + s.location);
      var group = byKey[key];
      if (!group) {
        group = byKey[key] = {
          key: key, title: s.title, location: s.location,
          lunch: false, club: false, appointment: false, sessions: []
        };
        order.push(group);
      }
      group.sessions.push(s);
      group.lunch = group.lunch || !!s.lunch;
      group.club = group.club || !!s.club;
      group.appointment = group.appointment || !!s.appointment;
    }
    var lunch = [], rest = [];
    order.forEach(function (g) { (g.lunch ? lunch : rest).push(g); });
    return lunch.concat(rest);
  }

  // --------------------------------------------------------------------
  // Drawing. createElement and textContent throughout — see the banner.
  // --------------------------------------------------------------------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  }

  function tag(text, kind) {
    return el('span', 'tag' + (kind ? ' ' + kind : ''), text);
  }

  /** The distinct values of one field, in the order they first appear. */
  function distinct(list, field) {
    var seen = {}, out = [];
    list.forEach(function (s) {
      var value = s[field] || '';
      if (!value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    });
    return out;
  }

  /**
   * WHEN A PROGRAM RUNS, in one line — the sentence a tile is worth reading
   * for. A single date says the date; a rhythm says the rhythm ("Tuesdays &
   * Thursdays"); anything less regular than that says how many dates there
   * are, because naming five weekdays is not a rhythm, it is a list.
   */
  function scheduleLine(group) {
    var sessions = group.sessions;
    var times = distinct(sessions, 'time');
    var when = times.length === 1 ? times[0] : (times.length ? 'times vary' : '');
    var head;
    if (sessions.length === 1) {
      head = relativeDay(sessions[0].dateKey) || sessions[0].shortLabel || sessions[0].dayLabel;
    } else {
      var days = distinct(sessions, 'weekday').map(function (d) { return PLURAL_DAYS[d] || d; });
      head = (days.length && days.length <= 2)
        ? days.join(' & ')
        : sessions.length + ' dates';
    }
    return when ? head + ' · ' + when : head;
  }

  /** A date somebody can still take a place on, as opposed to join a queue for. */
  function isOpenSession(s) { return !!s.url && s.state !== 'waitlist'; }

  /**
   * WHAT THE TILE SAYS ABOUT SIGNING UP — decided across every date in view,
   * not off the next one.
   *
   * "Waiting list" is the label that costs somebody an afternoon when it is
   * wrong: a class with four open weeks and one full one is a class they can
   * come to, and a tile that says otherwise because its NEXT date is full
   * sends them away from something that was theirs. So the words follow the
   * FIRST DATE THEY CAN ACTUALLY HAVE, and only a program with no such date
   * left in view is called a waiting list.
   */
  function leadOf(group) {
    var sessions = group.sessions;
    for (var i = 0; i < sessions.length; i++) {
      if (isOpenSession(sessions[i])) return sessions[i];
    }
    for (var j = 0; j < sessions.length; j++) {
      if (sessions[j].url) return sessions[j];
    }
    return sessions[0];
  }

  function ctaWords(lead, everyDateFull) {
    if (everyDateFull) return 'Join the waiting list';
    if (!lead) return '';
    if (lead.state === 'none') return 'No sign-up needed';
    if (lead.state === 'soon') return 'Sign-up opens soon';
    if (lead.state === 'waitlist') return 'Join the waiting list';
    return 'Sign up';
  }

  /**
   * ONE DATE. A link when that session has a form behind it, and a plain chip
   * when it does not — so a date nothing can happen on never invites a tap.
   * A chip's click never reaches the tile underneath it: the tile opens the
   * next date somebody can have, and this one is a different answer.
   */
  function chipFor(s) {
    var label = relativeDay(s.dateKey) || s.shortLabel || s.dayLabel;
    var kind = s.state === 'waitlist' ? ' full'
      : (s.dateKey === todayKey() ? ' today' : (s.url ? '' : ' quiet'));
    if (!s.url) return el('span', 'chip' + kind, label);
    var node = el('a', 'chip' + kind, label);
    node.href = s.url;
    node.target = '_blank';
    node.rel = 'noopener';
    node.title = s.dayLabel + (s.time ? ', ' + s.time : '')
      + (s.state === 'waitlist' ? ' — full, the form joins the waiting list' : '');
    // OPTIMISTIC, AND HONEST ABOUT IT. The form is somebody else's page on
    // somebody else's network; what this page can answer for is that the tap
    // registered, so it says so in the same frame and lets the new tab take
    // as long as it takes.
    node.addEventListener('click', function (event) {
      event.stopPropagation();
      node.classList.add('opening');
      window.setTimeout(function () { node.classList.remove('opening'); }, 2500);
    });
    return node;
  }

  function cardFor(group) {
    var sessions = group.sessions;
    var lead = leadOf(group);
    var withForm = sessions.filter(function (s) { return !!s.url; });
    var fullDates = sessions.filter(function (s) { return s.state === 'waitlist'; });
    // Only a program every one of whose dates is spoken for is a waiting
    // list. A tile with nothing bookable on it at all (no forms yet, or no
    // registration taken) is neither — it is answered by the state words.
    var everyDateFull = withForm.length > 0 && fullDates.length === withForm.length;

    var card = el('div', 'prog' + (group.lunch ? ' full' : ''));
    var url = lead && lead.url ? lead.url : '';
    if (url) {
      // THE WHOLE RECTANGLE IS THE BUTTON — a div rather than an <a> because
      // the date chips inside it are links of their own, and a browser will
      // not honour an anchor nested in an anchor. Keyboard and screen readers
      // are given the same thing the mouse gets, by hand.
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      var open = function () {
        card.classList.add('opening');
        window.setTimeout(function () { card.classList.remove('opening'); }, 2500);
        window.open(url, '_blank', 'noopener');
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          open();
        }
      });
    } else {
      card.className += ' flat';
    }

    var head = el('div', 'head');
    head.appendChild(el('div', 'name', group.title));
    var words = ctaWords(lead, everyDateFull);
    if (words) {
      var kind = everyDateFull || (lead && lead.state === 'waitlist') ? 'warn'
        : (url ? '' : 'quiet');
      head.appendChild(el('span', 'cta' + (kind ? ' ' + kind : ''), words));
    }
    card.appendChild(head);
    card.setAttribute('aria-label', group.title + (words ? ' — ' + words : ''));

    card.appendChild(el('div', 'when', scheduleLine(group)));

    var meta = el('div', 'meta');
    if (group.location) meta.appendChild(tag(group.location, 'where'));
    if (group.club) meta.appendChild(tag('Club'));
    if (group.appointment) meta.appendChild(tag('By appointment'));
    if (group.lunch) meta.appendChild(tag('Lunch'));
    // The seat sentence belongs to the date the tile would open, not to the
    // program — "3 seats left" about a date three weeks after the one being
    // offered is a number about the wrong afternoon.
    if (everyDateFull) meta.appendChild(tag('Every date full', 'warn'));
    else if (lead && lead.seats) {
      meta.appendChild(tag(lead.seats, lead.state === 'open' ? 'open' : 'warn'));
    }
    if (meta.childNodes.length) card.appendChild(meta);

    // A single date is already the whole of the line above, so a chip
    // repeating it would be the same fact twice — the tile itself is the tap
    // target there. Everything else gets its dates.
    if (sessions.length > 1) {
      var dates = el('div', 'dates');
      var shown = sessions.slice(0, CHIP_LIMIT);
      shown.forEach(function (s) { dates.appendChild(chipFor(s)); });
      var rest = sessions.length - shown.length;
      if (rest > 0) {
        var more = el('button', 'chip more', '+' + rest + ' more');
        more.type = 'button';
        more.addEventListener('click', function (event) {
          event.stopPropagation();
          dates.removeChild(more);
          sessions.slice(CHIP_LIMIT).forEach(function (s) { dates.appendChild(chipFor(s)); });
        });
        dates.appendChild(more);
      }
      card.appendChild(dates);
      // Said only where it is needed: a tile carrying both kinds of date is
      // the only place the colour has a question to answer.
      if (fullDates.length && !everyDateFull) {
        var legend = el('div', 'legend');
        legend.appendChild(el('b', '', 'Amber'));
        legend.appendChild(document.createTextNode(
          ' dates are full — that form joins the waiting list.'));
        card.appendChild(legend);
      }
    }
    return card;
  }

  function drawIntro() {
    // THE HEADER IS NOT ON THE PAGE AT ALL WHEN IT IS EMBEDDED (see the embed
    // stylesheet), so there is nothing here to write into — and the host site
    // has already said whose calendar this is, in its own typeface.
    if (EMBED.embed) return;
    var intro = (DATA && DATA.intro) || {};
    if (intro.name) document.getElementById('orgName').textContent = intro.name;
    if (intro.blurb) document.getElementById('blurb').textContent = intro.blurb;

    var contact = document.getElementById('contact');
    contact.textContent = '';
    if (intro.phone) {
      contact.appendChild(document.createTextNode('Questions, or rather sign up by phone? '));
      var tel = el('a', '', intro.phone);
      // Dialled by a thumb on the phone the page is being read on — which is
      // the whole point of the number being here rather than in a footer.
      tel.href = 'tel:' + String(intro.phone).replace(/[^0-9+]/g, '');
      contact.appendChild(tel);
    }
    if (intro.email) {
      contact.appendChild(document.createTextNode(intro.phone ? '  ·  ' : ''));
      var mail = el('a', '', intro.email);
      mail.href = 'mailto:' + intro.email;
      contact.appendChild(mail);
    }
    document.getElementById('places').textContent =
      (intro.places && intro.places.length) ? intro.places.join('   ·   ') : '';
  }

  function draw() {
    var list = document.getElementById('list');
    var rows = visible();
    var groups = programsFrom(rows);

    list.textContent = '';
    if (!DATA || DATA.ok === false) {
      var warn = el('div', 'notice full', DATA && DATA.message
        ? DATA.message
        : 'We could not read the program calendar just now. Please try again shortly.');
      list.appendChild(warn);
    } else if (!groups.length) {
      var none = el('div', 'empty full');
      none.appendChild(el('b', '', 'Nothing here yet'));
      none.appendChild(el('div', '', view.q
        ? 'No programs match that search in this date range.'
        : 'Nothing is scheduled in this date range. Try a longer one.'));
      list.appendChild(none);
    } else {
      groups.forEach(function (group) { list.appendChild(cardFor(group)); });
    }

    document.getElementById('count').textContent = groups.length
      ? (groups.length === 1 ? '1 program' : groups.length + ' programs')
        + ' · ' + (rows.length === 1 ? '1 date' : rows.length + ' dates')
      : '';
    document.getElementById('foot').textContent = DATA && DATA.generatedAt
      ? 'Updated ' + DATA.generatedAt + '. Seats are checked again when you open a form.'
      : '';
    [7, 31, 0].forEach(function (d) {
      document.getElementById('r' + d).setAttribute('aria-pressed', view.days === d ? 'true' : 'false');
    });
    postHeight();
  }

  /**
   * THE BUILDING FILTER, AS PILLS. It was a <select>, which on a colored
   * website block read as decoration and hid the answer to the second
   * question every caller asks. Pills say both things at once: which
   * buildings have anything on, and which one is being shown.
   */
  function drawLocations() {
    var bar = document.getElementById('locbar');
    var locations = (DATA && DATA.locations) || [];
    // A remembered building that has nothing on any more is dropped rather
    // than left selected, which would be an empty page nobody could explain.
    if (view.location && locations.indexOf(view.location) === -1) view.location = '';
    bar.textContent = '';
    // ONE BUILDING IS NOT A CHOICE, and neither is a pinned one: an embed
    // that says Narberth is a page about Narberth, and a filter on it is an
    // invitation to make the host site's own page say something else.
    if (EMBED.location || locations.length < 2) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.appendChild(locationPill('', 'All locations'));
    locations.forEach(function (name) { bar.appendChild(locationPill(name, name)); });
  }

  function locationPill(value, label) {
    var button = el('button', '', '');
    button.type = 'button';
    if (value) button.appendChild(el('span', 'pin', '\u25CF'));
    button.appendChild(document.createTextNode(label));
    button.setAttribute('aria-pressed', view.location === value ? 'true' : 'false');
    button.addEventListener('click', function () {
      view.location = value; save(); drawLocations(); draw();
    });
    return button;
  }

  // --------------------------------------------------------------------
  // The controls. Every one of these redraws from memory — nothing here
  // asks the server anything.
  // --------------------------------------------------------------------
  function setRange(days) { view.days = days; save(); draw(); }

  var searchTimer = null;
  function onSearch() {
    // Redrawn on the next frame rather than inside the keystroke: on a long
    // window that is the difference between typing smoothly and typing into
    // treacle, and nobody can perceive one frame.
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      view.q = document.getElementById('q').value;
      draw();
    }, 40);
  }

  /**
   * THE QUIET RE-READ. Runs once after the first paint, and on the Refresh
   * control. The inlined snapshot is up to five minutes old (see the cache
   * note in 86) and seats move; asking again after the page is already on
   * screen costs the person nothing and keeps the numbers honest.
   */
  function refresh(force) {
    var button = document.getElementById('refresh');
    if (force) button.textContent = 'Refreshing…';
    google.script.run
      .withSuccessHandler(function (res) {
        button.textContent = 'Refresh';
        if (!res || res.ok === false) {
          if (force) { DATA = res || DATA; draw(); }
          return;
        }
        DATA = res;
        SESSIONS = res.sessions || [];
        drawIntro();
        drawLocations();
        draw();
      })
      .withFailureHandler(function () {
        // A failed background read changes nothing on screen: what is drawn
        // is real, it is just a few minutes old, and an error banner over a
        // working calendar would be the page's own worst moment.
        button.textContent = 'Refresh';
      })
      .publicProgramCalendar(JSON.stringify({ fresh: !!force }));
  }

  // --------------------------------------------------------------------
  // THE FRAME'S HEIGHT, WHICH IS THE WHOLE OF WHAT AN EMBED SAYS TO ITS HOST.
  //
  // An iframe's height is fixed and this page's is not, and the two disagree
  // as a scrollbar INSIDE the frame — which on a phone is the gesture where
  // somebody scrolls the calendar when they meant to scroll the website and
  // decides the site is broken. So the page measures itself after every draw
  // and posts the number out; the eleven-line listener in the snippet (see
  // publicCalendarEmbedSnippet) grows the frame to match. A tile expanded to
  // show the rest of its dates is exactly the case that needs it.
  //
  // The target origin is '*' on purpose: the host is somebody else's website
  // and this page is not told its address. What is published to it is a
  // number of pixels — there is nothing in this message anybody may not see —
  // and the listener's own check is that the message came from ITS frame.
  // --------------------------------------------------------------------
  var lastHeight = 0;
  function postHeight() {
    if (!EMBED.embed || window.parent === window) return;
    var height = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0);
    if (!height || Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    try {
      window.parent.postMessage({ type: EMBED.message, height: height }, '*');
    } catch (err) { /* a host that will not be spoken to keeps its 900px */ }
  }

  drawIntro();
  drawLocations();
  draw();
  postHeight();
  if (EMBED.embed) {
    // Fonts land after the first paint and change every tile's height by a
    // pixel or two; a tile opened or a filter tapped changes it by hundreds.
    window.addEventListener('load', postHeight);
    window.addEventListener('resize', postHeight);
    if (window.ResizeObserver && document.body) {
      new window.ResizeObserver(postHeight).observe(document.body);
    } else {
      window.setInterval(postHeight, 1000);
    }
  }
  window.setTimeout(function () { refresh(false); }, 400);
</script>
`;
}
