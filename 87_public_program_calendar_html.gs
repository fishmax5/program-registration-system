// ============================================================================
// 17a. THE PUBLIC CALENDAR'S PAGE  (a week, a month, and one tap to the form)
// ============================================================================
//
// One served page, no navigations, no spinners on the path a person actually
// takes. What is in 86_public_program_calendar.gs is the read and the rules
// about what a stranger may see; what is here is the promise the page makes
// about how it feels:
//
//   1. THE FIRST FRAME IS THE ANSWER. The whole window — today to the end of
//      next month — is inlined into the page, so the calendar is drawn before
//      the browser has made a single request of its own. There is no loading
//      state on open because there is nothing to load.
//   2. EVERY FILTER IS ARITHMETIC, NEVER A ROUND TRIP. Week, month, building,
//      search: each one re-runs against the array already in memory and
//      redraws in the same frame as the tap. This is the whole reason the
//      window travels at once (see the banner in 86).
//   3. A TAP ON A SESSION IS ANSWERED BEFORE THE FORM LOADS. The card marks
//      itself as opening immediately and the form opens in its own tab; the
//      page a person came from is still behind it, still filtered the way
//      they left it, because nothing about opening a form navigated away.
//   4. THE REFRESH IS QUIET AND IT IS BEHIND THEM. A background read runs
//      once after the first paint and replaces the inlined snapshot if it has
//      moved — but never while a filter is being tapped, and never as a
//      flash of empty. A page that redraws under a thumb is how somebody taps
//      the wrong Thursday.
//
// IT IS DRAWN TO SIT INSIDE SOMEBODY ELSE'S PAGE. This is embedded in a
// colored block on the organization's website, so the page has no background
// of its own and every surface that has to be readable paints itself — the
// shared stylesheet is publicEmbedStyles() in 88_public_embeds.gs, which both
// public pages use so the two cannot drift into nearly matching. The control
// bar is a white card rather than a bare line for exactly that reason: on the
// website's green block, transparent controls on a transparent page were a row
// nobody could see.
//
// EVERYTHING FROM THE WORKBOOK IS WRITTEN WITH textContent. Program titles are
// typed by staff into a calendar and they contain apostrophes, ampersands and
// — this has happened — angle brackets. This page uses no innerHTML with data
// in it at all: cards are built out of createElement, and the one place data
// crosses into script is the double-JSON.stringify below. See
// tests/public_calendar_page.test.js, which is what holds that line.
// ============================================================================

/**
 * The public calendar, as one string.
 *
 * `snapshot` is what publicProgramCalendar() returned — inlined so the first
 * frame is complete. A FAILED read is inlined just as faithfully: the page
 * says it could not look, which is a different sentence from "nothing is on"
 * and the only one of the two that should send somebody to the phone.
 */
function buildPublicCalendarHtml(snapshot) {
  const data = JSON.stringify(JSON.stringify(snapshot || { ok: false, sessions: [] }))
    .replace(/<\//g, '<\\/');

  return `
${publicEmbedStyles()}

<div class="wrap">
  <header>
    <h1>Programs &amp; Sign-Ups</h1>
    <p id="lede">Everything coming up. Tap a program to open its sign-up form.</p>
  </header>

  <div class="controls">
    <div class="seg" role="group" aria-label="How far ahead">
      <button type="button" id="r7" onclick="setRange(7)">This week</button>
      <button type="button" id="r31" onclick="setRange(31)">This month</button>
      <button type="button" id="r0" onclick="setRange(0)">Everything</button>
    </div>
    <div class="locbar" id="locbar" role="group" aria-label="Location"></div>
    <div class="searchrow">
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
  var STORE_KEY = 'publicCalendarPrefs.v1';

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

  function save() {
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

  /** "Today" / "Tomorrow" for the two headings that earn a word. */
  function relativeDay(key) {
    var t = todayKey();
    if (!t) return '';
    if (key === t) return 'Today';
    if (key === keyPlusDays(t, 1)) return 'Tomorrow';
    return '';
  }

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

  function cardFor(s) {
    var node;
    if (s.url) {
      node = el('a', 'card');
      node.href = s.url;
      node.target = '_blank';
      node.rel = 'noopener';
      // OPTIMISTIC, AND HONEST ABOUT IT. The form is somebody else's page on
      // somebody else's network; what this page can answer for is that the
      // tap registered, so it says so in the same frame and lets the new tab
      // take as long as it takes.
      node.addEventListener('click', function () {
        node.classList.add('opening');
        window.setTimeout(function () { node.classList.remove('opening'); }, 2500);
      });
    } else {
      node = el('div', 'card');
    }

    var top = el('div', 'top');
    top.appendChild(el('span', 'time', s.time || 'All day'));
    top.appendChild(el('span', 'title', s.title));
    node.appendChild(top);

    var meta = el('div', 'meta');
    // THE BUILDING FIRST, AND IN A BOX. Which building is the second thing a
    // person needs and it used to be flat gray text among flat gray tags.
    if (s.location) meta.appendChild(tag('\u25CF ' + s.location, 'where'));
    if (s.lunch) meta.appendChild(tag('Lunch'));
    if (s.club) meta.appendChild(tag('Club'));
    if (s.appointment) meta.appendChild(tag('By appointment'));
    if (s.seats) meta.appendChild(tag(s.seats, s.state === 'open' ? 'open' : 'warn'));

    // A CARD THAT DOES SOMETHING GETS THE BLACK PILL; a card that does not
    // gets a sentence. The two must not look alike — the pill is the site's
    // own button shape, and printing it on a session nobody can sign up for
    // is how somebody taps four times and phones the office.
    var cta = el('span', 'cta');
    if (s.state === 'none') { cta.className = 'cta quiet'; cta.textContent = 'No sign-up needed'; }
    else if (s.state === 'soon') { cta.className = 'cta quiet'; cta.textContent = 'Sign-up opens soon'; }
    else if (s.state === 'waitlist') { cta.textContent = 'Join the waiting list'; }
    else { cta.textContent = 'Sign up'; }
    meta.appendChild(cta);
    node.appendChild(meta);
    return node;
  }

  function draw() {
    var list = document.getElementById('list');
    var rows = visible();

    list.textContent = '';
    if (!DATA || DATA.ok === false) {
      var warn = el('div', 'notice', DATA && DATA.message
        ? DATA.message
        : 'We could not read the program calendar just now. Please try again shortly.');
      list.appendChild(warn);
    } else if (!rows.length) {
      var none = el('div', 'empty');
      none.appendChild(el('b', '', 'Nothing here yet'));
      none.appendChild(el('div', '', view.q
        ? 'No programs match that search in this date range.'
        : 'Nothing is scheduled in this date range. Try a longer one.'));
      list.appendChild(none);
    } else {
      var day = '';
      rows.forEach(function (s) {
        if (s.dateKey !== day) {
          day = s.dateKey;
          var h = el('h2', 'day');
          var rel = relativeDay(s.dateKey);
          if (rel) {
            h.appendChild(el('span', 'rel', rel));
            h.appendChild(document.createTextNode(' \\u00b7 ' + s.dayLabel));
          } else {
            h.appendChild(document.createTextNode(s.dayLabel));
          }
          list.appendChild(h);
        }
        list.appendChild(cardFor(s));
      });
    }

    document.getElementById('count').textContent = rows.length
      ? (rows.length === 1 ? '1 program' : rows.length + ' programs')
      : '';
    document.getElementById('foot').textContent = DATA && DATA.generatedAt
      ? 'Updated ' + DATA.generatedAt + '. Seats are checked again when you open a form.'
      : '';
    [7, 31, 0].forEach(function (d) {
      document.getElementById('r' + d).setAttribute('aria-pressed', view.days === d ? 'true' : 'false');
    });
  }

  /**
   * THE BUILDING FILTER, AS PILLS. It was a <select>, which on the website's
   * green block was a gray box that read as decoration and hid the answer to
   * the second question every caller asks. Pills say both things at once:
   * which buildings have anything on, and which one is being shown.
   */
  function drawLocations() {
    var bar = document.getElementById('locbar');
    var locations = (DATA && DATA.locations) || [];
    // A remembered building that has nothing on any more is dropped rather
    // than left selected, which would be an empty page nobody could explain.
    if (view.location && locations.indexOf(view.location) === -1) view.location = '';
    bar.textContent = '';
    // ONE BUILDING IS NOT A CHOICE. A control with a single option in it is a
    // control that asks a question nobody has — but the building is still a
    // fact, so it stays on every card either way.
    if (locations.length < 2) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.appendChild(locationPill('', 'All locations'));
    locations.forEach(function (name) { bar.appendChild(locationPill(name, name)); });
  }

  function locationPill(value, label) {
    var button = el('button', '', '');
    button.type = 'button';
    if (value) {
      var pin = el('span', 'pin', '\u25CF');
      button.appendChild(pin);
    }
    button.appendChild(document.createTextNode(label));
    button.setAttribute('aria-pressed', view.location === value ? 'true' : 'false');
    button.addEventListener('click', function () { setLocation(value); });
    return button;
  }

  // --------------------------------------------------------------------
  // The controls. Every one of these redraws from memory — nothing here
  // asks the server anything.
  // --------------------------------------------------------------------
  function setRange(days) { view.days = days; save(); draw(); }
  function setLocation(name) { view.location = name; save(); drawLocations(); draw(); }

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
    if (force) button.textContent = 'Refreshing\\u2026';
    google.script.run
      .withSuccessHandler(function (res) {
        button.textContent = 'Refresh';
        if (!res || res.ok === false) {
          if (force) { DATA = res || DATA; draw(); }
          return;
        }
        DATA = res;
        SESSIONS = res.sessions || [];
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

  drawLocations();
  draw();
  window.setTimeout(function () { refresh(false); }, 400);
</script>
`;
}
