// ============================================================================
// 18b. THE WEEKLY PROGRAMS PAGE  (a week's worth of standing invitations)
// ============================================================================
//
// The second embed, and the one a person reads when they are not asking about
// a date at all. Seven headings, Monday to Sunday, and under each one the
// programs that run on that day every week — one card per PROGRAM, not per
// date, so a class that runs eight times in the window is one line rather
// than eight.
//
// It shares the calendar page's stylesheet (publicEmbedStyles(), 88) and every
// promise the calendar page makes: the whole fold travels inlined so the first
// frame is the answer, every filter is arithmetic in the browser, a tap opens
// the form in its own tab, and everything from the workbook is written with
// textContent. What it does NOT share is a second read — the fold is built
// from the calendar's own snapshot (see 89), so the two pages cannot disagree
// about what is on or about what a stranger may see.
//
// WHAT A CARD SAYS, IN THE ORDER SOMEBODY ASKS IT: the time it starts, what it
// is, where it is, whether there is room, and the one thing to do next. The
// dates themselves are a quiet line under the title — "Next: Thursday,
// October 2 · 8 more through November 27" — because the promise a weekly page
// makes is the WEEKDAY, and a list of eight dates is the calendar page's job.
// ============================================================================

/**
 * The weekly programs page, as one string.
 *
 * `snapshot` is what publicWeeklyPrograms() returned. A failed read is inlined
 * as faithfully as a good one: the page says it could not look, which is a
 * different sentence from "nothing runs weekly" and the only one of the two
 * that should send somebody to the phone.
 */
function buildPublicWeeklyHtml(snapshot) {
  const data = JSON.stringify(JSON.stringify(snapshot || { ok: false, programs: [] }))
    .replace(/<\//g, '<\\/');

  return `
${publicEmbedStyles()}

<div class="wrap">
  <header>
    <h1>Weekly Programs</h1>
    <p id="lede">Programs that run every week. Tap one to open its sign-up form.</p>
  </header>

  <div class="controls">
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
  var PROGRAMS = (DATA && DATA.programs) || [];
  var STORE_KEY = 'weeklyProgramsPrefs.v1';
  var DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // The filter, and the whole of the page's state. The building is remembered
  // in this browser for the same reason the calendar page remembers it:
  // somebody who only ever comes to one building should not be asked which
  // one every time they open the link.
  var view = { location: '', q: '' };
  try {
    var saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    if (saved && typeof saved.location === 'string') view.location = saved.location;
  } catch (err) { /* private browsing, or nothing stored yet */ }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ location: view.location }));
    } catch (err) { /* private browsing */ }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  }

  function tag(text, kind) {
    return el('span', 'tag' + (kind ? ' ' + kind : ''), text);
  }

  function visible() {
    var needle = view.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < PROGRAMS.length; i++) {
      var p = PROGRAMS[i];
      if (view.location && p.location !== view.location) continue;
      if (needle && (p.title + ' ' + p.location).toLowerCase().indexOf(needle) === -1) continue;
      out.push(p);
    }
    return out;
  }

  function cardFor(p) {
    var node;
    if (p.url) {
      node = el('a', 'card');
      node.href = p.url;
      node.target = '_blank';
      node.rel = 'noopener';
      // Optimistic, and honest about it: the form is somebody else's page on
      // somebody else's network, so the card answers the tap in this frame
      // and lets the new tab take as long as it takes.
      node.addEventListener('click', function () {
        node.classList.add('opening');
        window.setTimeout(function () { node.classList.remove('opening'); }, 2500);
      });
    } else {
      node = el('div', 'card');
    }

    var top = el('div', 'top');
    top.appendChild(el('span', 'time', p.time || 'All day'));
    top.appendChild(el('span', 'title', p.title));
    node.appendChild(top);

    var meta = el('div', 'meta');
    if (p.location) meta.appendChild(tag('\\u25CF ' + p.location, 'where'));
    if (p.lunch) meta.appendChild(tag('Lunch'));
    if (p.club) meta.appendChild(tag('Club'));
    if (p.appointment) meta.appendChild(tag('By appointment'));
    if (p.seats) meta.appendChild(tag(p.seats, p.state === 'open' ? 'open' : 'warn'));

    var cta = el('span', 'cta');
    if (p.state === 'none') { cta.className = 'cta quiet'; cta.textContent = 'No sign-up needed'; }
    else if (p.state === 'soon') { cta.className = 'cta quiet'; cta.textContent = 'Sign-up opens soon'; }
    else if (p.state === 'waitlist') { cta.textContent = 'Join the waiting list'; }
    else { cta.textContent = 'Sign up'; }
    meta.appendChild(cta);
    node.appendChild(meta);

    // THE DATES, QUIETLY. The weekday is the promise this page makes; the
    // next date is what somebody writes down, and the count is how they know
    // it is still running in six weeks. A list of every date belongs on the
    // calendar page, which is one tap away.
    var when = el('div', 'when');
    var line = 'Next: ' + (p.nextDayLabel || '');
    if (p.count > 1) {
      line += ' \\u00b7 ' + (p.count - 1) + ' more through ' + (p.lastDayLabel || '');
    }
    when.textContent = line;
    node.appendChild(when);
    return node;
  }

  function draw() {
    var list = document.getElementById('list');
    var rows = visible();

    list.textContent = '';
    if (!DATA || DATA.ok === false) {
      list.appendChild(el('div', 'notice', DATA && DATA.message
        ? DATA.message
        : 'We could not read the program calendar just now. Please try again shortly.'));
    } else if (!rows.length) {
      var none = el('div', 'empty');
      none.appendChild(el('b', '', 'Nothing weekly here yet'));
      none.appendChild(el('div', '', view.q || view.location
        ? 'No weekly programs match that. Try clearing the search or the building.'
        : 'Nothing in the next two months runs every week. Everything else is on the full calendar.'));
      list.appendChild(none);
    } else {
      // Grouped by weekday in the order the server sorted them — Monday
      // first, because that is how a person planning a week reads one.
      var day = '';
      rows.forEach(function (p) {
        if (p.weekday !== day) {
          day = p.weekday;
          var h = el('h2', 'day');
          h.appendChild(document.createTextNode(everyDayLabel(p.weekday)));
          list.appendChild(h);
        }
        list.appendChild(cardFor(p));
      });
    }

    document.getElementById('count').textContent = rows.length
      ? (rows.length === 1 ? '1 weekly program' : rows.length + ' weekly programs')
      : '';
    document.getElementById('foot').textContent = DATA && DATA.generatedAt
      ? 'Updated ' + DATA.generatedAt + '. Seats are checked again when you open a form.'
      : '';
  }

  /** "Every Monday" — the heading, and the whole point of the page. */
  function everyDayLabel(weekday) {
    return DAY_ORDER.indexOf(weekday) === -1 ? weekday : 'Every ' + weekday;
  }

  function drawLocations() {
    var bar = document.getElementById('locbar');
    var locations = (DATA && DATA.locations) || [];
    if (view.location && locations.indexOf(view.location) === -1) view.location = '';
    bar.textContent = '';
    if (locations.length < 2) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.appendChild(locationPill('', 'All locations'));
    locations.forEach(function (name) { bar.appendChild(locationPill(name, name)); });
  }

  function locationPill(value, label) {
    var button = el('button', '', '');
    button.type = 'button';
    if (value) button.appendChild(el('span', 'pin', '\\u25CF'));
    button.appendChild(document.createTextNode(label));
    button.setAttribute('aria-pressed', view.location === value ? 'true' : 'false');
    button.addEventListener('click', function () {
      view.location = value; save(); drawLocations(); draw();
    });
    return button;
  }

  var searchTimer = null;
  function onSearch() {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      view.q = document.getElementById('q').value;
      draw();
    }, 40);
  }

  /** The quiet re-read, on the same terms as the calendar page's. */
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
        PROGRAMS = res.programs || [];
        drawLocations();
        draw();
      })
      .withFailureHandler(function () {
        // What is drawn is real, it is just a few minutes old. An error
        // banner over a working page would be its own worst moment.
        button.textContent = 'Refresh';
      })
      .publicWeeklyPrograms(JSON.stringify({ fresh: !!force }));
  }

  drawLocations();
  draw();
  window.setTimeout(function () { refresh(false); }, 400);
</script>
`;
}
