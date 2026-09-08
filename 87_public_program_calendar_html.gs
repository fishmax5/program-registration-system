// ============================================================================
// 17a. THE PUBLIC CALENDAR'S PAGE  (one card per program, and one tap to a form)
// ============================================================================
//
// One served page, no navigations, no spinners on the path a person actually
// takes. What is in 86_public_program_calendar.gs is the read and the rules
// about what a stranger may see; what is here is the promise the page makes
// about how it feels:
//
//   1. IT READS BY PROGRAM, NOT BY DATE. This page was a diary: one card per
//      SESSION under a heading per day, which for a weekly class was the same
//      four words repeated eight times down a phone screen, and for lunch was
//      a card a day for two months. A person deciding whether to come to chair
//      yoga is not asking what is on next Thursday, they are asking what chair
//      yoga is and when it runs — so a program is ONE card carrying its dates,
//      and the dates are what they tap. `programKey` on each session is what
//      the grouping is done on; the server decides it (title + building), so
//      a `[Shared]` program running in two buildings stays two cards.
//   2. THE FIRST FRAME IS THE ANSWER. The whole window — today to the end of
//      next month — is inlined into the page, so the calendar is drawn before
//      the browser has made a single request of its own. There is no loading
//      state on open because there is nothing to load.
//   3. EVERY FILTER IS ARITHMETIC, NEVER A ROUND TRIP. Week, month, building,
//      search: each one re-runs against the array already in memory and
//      redraws in the same frame as the tap. This is the whole reason the
//      window travels at once (see the banner in 86). `?span=week` and
//      `?span=month` only decide which of those filters is already pressed
//      when the page opens — which is what makes a weekly link and a monthly
//      link two printable addresses rather than two pages to maintain.
//   4. A TAP ON A DATE IS ANSWERED BEFORE THE FORM LOADS. The chip marks
//      itself as opening immediately and the form opens in its own tab; the
//      page a person came from is still behind it, still filtered the way
//      they left it, because nothing about opening a form navigated away.
//   5. THE REFRESH IS QUIET AND IT IS BEHIND THEM. A background read runs
//      once after the first paint and replaces the inlined snapshot if it has
//      moved — but never while a filter is being tapped, and never as a
//      flash of empty. A page that redraws under a thumb is how somebody taps
//      the wrong Thursday.
//
// EVERYTHING FROM THE WORKBOOK IS WRITTEN WITH textContent. Program titles are
// typed by staff into a calendar and they contain apostrophes, ampersands and
// — this has happened — angle brackets. This page uses no innerHTML with data
// in it at all: cards are built out of createElement, and the one place data
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
 * `options.span` is the range the page opens on — 'week', 'month', 'all' or
 * '' for whatever this browser last chose. It is resolved from the URL by
 * publicCalendarSpanRequested_() in 60, so the two printed links and the page
 * cannot disagree about what "weekly" means.
 */
function buildPublicCalendarHtml(snapshot, options) {
  const data = JSON.stringify(JSON.stringify(snapshot || { ok: false, sessions: [] }))
    .replace(/<\//g, '<\\/');
  const span = JSON.stringify(String((options && options.span) || ''));

  return `
<style>
  /* A stranger on a phone, in a hurry, possibly at arm's length: everything
     here is sized for reading standing up, and every tap target is a thumb. */
  :root {
    --ink: #1B1C1E; --muted: #5F6368; --line: #E3E5E8; --card: #FFFFFF;
    --page: #F6F7F9; --brand: #1A56C4; --brand-ink: #FFFFFF;
    --open: #0F7B3E; --open-bg: #E7F5EC; --warn: #9A5B00; --warn-bg: #FDF1DE;
    --quiet: #4B5563; --quiet-bg: #EEF0F3; --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #E8EAED; --muted: #9AA0A6; --line: #2E3033; --card: #1E2023;
      --page: #141517; --brand: #8AB4F8; --brand-ink: #10131A;
      --open: #7EE2A8; --open-bg: #16301F; --warn: #F3C078; --warn-bg: #33260F;
      --quiet: #C4C7CB; --quiet-bg: #26282C; --shadow: none;
    }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; background: var(--page); color: var(--ink);
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         font-size: 16px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px 64px 16px; }

  header { padding: 26px 0 14px 0; }
  header h1 { margin: 0; font-size: 27px; letter-spacing: -.02em; font-weight: 700; }
  header p { margin: 6px 0 0 0; color: var(--muted); font-size: 15px; }

  /* THE CONTROLS STICK. Somebody four programs down the page who wants "this
     week" instead should not have to scroll back up to say so. */
  .controls { position: sticky; top: 0; z-index: 4; background: var(--page);
              padding: 10px 0 12px 0; border-bottom: 1px solid var(--line); }
  .seg { display: flex; gap: 6px; background: var(--quiet-bg); border-radius: 12px; padding: 4px; }
  .seg button { flex: 1; border: 0; background: transparent; color: var(--quiet); font-size: 14px;
                font-weight: 600; padding: 10px 8px; border-radius: 9px; cursor: pointer;
                font-family: inherit; transition: background .12s ease, color .12s ease; }
  .seg button[aria-pressed="true"] { background: var(--card); color: var(--ink); box-shadow: var(--shadow); }
  .row2 { display: flex; gap: 8px; margin-top: 8px; }
  .row2 input, .row2 select { flex: 1; min-width: 0; font-family: inherit; font-size: 15px;
        padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px;
        background: var(--card); color: var(--ink); }
  .row2 select { flex: 0 0 auto; max-width: 46%; }
  .count { color: var(--muted); font-size: 13px; margin-top: 9px; display: flex; gap: 8px;
           align-items: center; justify-content: space-between; }
  .count button { border: 0; background: transparent; color: var(--brand); font: inherit;
                  font-size: 13px; cursor: pointer; padding: 2px 0; }

  /* ONE PROGRAM, ONE CARD. The title is the first thing on it and it is on a
     line of its own — the old layout put a fixed-width time column beside it,
     which on a phone squeezed every title into three or four words a line. */
  .prog { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
          padding: 13px 15px 11px 15px; margin-bottom: 10px; box-shadow: var(--shadow); }
  .prog .head { display: flex; gap: 10px; align-items: baseline; }
  .prog .name { font-size: 17px; font-weight: 650; letter-spacing: -.01em; flex: 1; min-width: 0; }
  .prog .cta { flex: 0 0 auto; font-size: 14px; font-weight: 650; color: var(--brand);
               text-decoration: none; white-space: nowrap; }
  .prog .cta.quiet { color: var(--muted); font-weight: 600; }
  .prog .when { color: var(--muted); font-size: 14px; margin-top: 3px; }
  .prog .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
  .tag { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
         background: var(--quiet-bg); color: var(--quiet); }
  .tag.where { background: transparent; color: var(--muted); padding-left: 0; }
  .tag.open { background: var(--open-bg); color: var(--open); }
  .tag.warn { background: var(--warn-bg); color: var(--warn); }

  /* THE DATES ARE THE TAP TARGETS. Each one carries its own session's form,
     which for a Regular program is a different form each month — the whole
     reason a printed link goes stale and this page does not. */
  .dates { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip { font-size: 13px; font-weight: 600; padding: 7px 11px; border-radius: 10px;
          border: 1px solid var(--line); background: var(--page); color: var(--ink);
          text-decoration: none; font-variant-numeric: tabular-nums;
          transition: transform .08s ease, border-color .12s ease; }
  a.chip:hover { border-color: var(--brand); }
  a.chip:active { transform: scale(.97); }
  .chip.today { border-color: var(--brand); color: var(--brand); }
  .chip.warn { color: var(--warn); }
  .chip.quiet { color: var(--muted); }
  .chip.opening { opacity: .55; }
  .chip.more { border-style: dashed; color: var(--muted); cursor: pointer; font-family: inherit; }

  .empty { text-align: center; color: var(--muted); padding: 54px 20px; }
  .empty b { display: block; color: var(--ink); font-size: 17px; margin-bottom: 6px; }
  .notice { background: var(--warn-bg); color: var(--warn); border-radius: 12px;
            padding: 14px 16px; margin: 18px 0; font-size: 15px; }
  footer { color: var(--muted); font-size: 13px; text-align: center; margin-top: 34px;
           line-height: 1.6; }
</style>

<div class="wrap">
  <header>
    <h1>Programs &amp; Sign-Ups</h1>
    <p id="lede">Everything coming up. Tap a date to open that session's sign-up form.</p>
  </header>

  <div class="controls">
    <div class="seg" role="group" aria-label="How far ahead">
      <button type="button" id="r7" onclick="setRange(7)">This week</button>
      <button type="button" id="r31" onclick="setRange(31)">This month</button>
      <button type="button" id="r0" onclick="setRange(0)">Everything</button>
    </div>
    <div class="row2">
      <input type="search" id="q" placeholder="Search programs" autocomplete="off"
             oninput="onSearch()" aria-label="Search programs">
      <select id="loc" onchange="onLocation()" aria-label="Location"></select>
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
  var STORE_KEY = 'publicCalendarPrefs.v1';
  // How many dates a card shows before it offers the rest. Six is two rows on
  // a phone: enough to see the rhythm of a weekly class, short of the wall of
  // chips a daily one would otherwise be.
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
   * their NEXT session falls. That ordering is free: the array is already
   * sorted by date, so the first time a program is seen is its next date.
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
    return order;
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
   * WHEN A PROGRAM RUNS, in one line — the sentence a card is worth reading
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

  /** The next session somebody can actually do something with, else the next one. */
  function leadSession(group) {
    for (var i = 0; i < group.sessions.length; i++) {
      if (group.sessions[i].url) return group.sessions[i];
    }
    return group.sessions[0];
  }

  function ctaFor(lead) {
    if (!lead) return null;
    var words = lead.state === 'none' ? 'No sign-up needed'
      : lead.state === 'soon' ? 'Sign-up opens soon'
      : lead.state === 'waitlist' ? 'Join the waiting list'
      : 'Sign up';
    if (!lead.url) return el('span', 'cta quiet', words);
    var link = el('a', 'cta', words);
    link.href = lead.url;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  /**
   * ONE DATE. A link when that session has a form behind it, and a plain chip
   * when it does not — so a date nothing can happen on never invites a tap.
   */
  function chipFor(s) {
    var label = relativeDay(s.dateKey) || s.shortLabel || s.dayLabel;
    var kind = s.dateKey === todayKey() ? ' today'
      : (s.state === 'waitlist' ? ' warn' : (s.url ? '' : ' quiet'));
    if (!s.url) return el('span', 'chip' + kind, label);
    var node = el('a', 'chip' + kind, label);
    node.href = s.url;
    node.target = '_blank';
    node.rel = 'noopener';
    node.title = s.dayLabel + (s.time ? ', ' + s.time : '');
    // OPTIMISTIC, AND HONEST ABOUT IT. The form is somebody else's page on
    // somebody else's network; what this page can answer for is that the tap
    // registered, so it says so in the same frame and lets the new tab take
    // as long as it takes.
    node.addEventListener('click', function () {
      node.classList.add('opening');
      window.setTimeout(function () { node.classList.remove('opening'); }, 2500);
    });
    return node;
  }

  function cardFor(group) {
    var card = el('article', 'prog');

    var head = el('div', 'head');
    head.appendChild(el('div', 'name', group.title));
    var lead = leadSession(group);
    var cta = ctaFor(lead);
    if (cta) head.appendChild(cta);
    card.appendChild(head);

    card.appendChild(el('div', 'when', scheduleLine(group)));

    var meta = el('div', 'meta');
    if (group.location) meta.appendChild(tag(group.location, 'where'));
    if (group.club) meta.appendChild(tag('Club'));
    if (group.appointment) meta.appendChild(tag('By appointment'));
    if (group.lunch) meta.appendChild(tag('Lunch'));
    if (lead && lead.seats) {
      meta.appendChild(tag(lead.seats, lead.state === 'open' ? 'open' : 'warn'));
    }
    if (meta.childNodes.length) card.appendChild(meta);

    // A single date is already the whole of the line above, so a chip
    // repeating it would be the same fact twice — the CTA is the tap target
    // there. Everything else gets its dates.
    if (group.sessions.length > 1) {
      var dates = el('div', 'dates');
      var shown = group.sessions.slice(0, CHIP_LIMIT);
      shown.forEach(function (s) { dates.appendChild(chipFor(s)); });
      var rest = group.sessions.length - shown.length;
      if (rest > 0) {
        var more = el('button', 'chip more', '+' + rest + ' more');
        more.type = 'button';
        more.addEventListener('click', function () {
          dates.removeChild(more);
          group.sessions.slice(CHIP_LIMIT).forEach(function (s) {
            dates.appendChild(chipFor(s));
          });
        });
        dates.appendChild(more);
      }
      card.appendChild(dates);
    }
    return card;
  }

  function draw() {
    var list = document.getElementById('list');
    var rows = visible();
    var groups = programsFrom(rows);

    list.textContent = '';
    if (!DATA || DATA.ok === false) {
      var warn = el('div', 'notice', DATA && DATA.message
        ? DATA.message
        : 'We could not read the program calendar just now. Please try again shortly.');
      list.appendChild(warn);
    } else if (!groups.length) {
      var none = el('div', 'empty');
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
  }

  function drawLocations() {
    var select = document.getElementById('loc');
    var locations = (DATA && DATA.locations) || [];
    // ONE BUILDING IS NOT A CHOICE. A dropdown with a single option in it is
    // a control that asks a question nobody has.
    if (locations.length < 2) { select.style.display = 'none'; return; }
    select.style.display = '';
    select.textContent = '';
    var all = el('option', '', 'All locations');
    all.value = '';
    select.appendChild(all);
    locations.forEach(function (name) {
      var option = el('option', '', name);
      option.value = name;
      select.appendChild(option);
    });
    // A remembered building that has nothing on any more is dropped rather
    // than left selected, which would be an empty page nobody could explain.
    if (view.location && locations.indexOf(view.location) === -1) view.location = '';
    select.value = view.location;
  }

  // --------------------------------------------------------------------
  // The controls. Every one of these redraws from memory — nothing here
  // asks the server anything.
  // --------------------------------------------------------------------
  function setRange(days) { view.days = days; save(); draw(); }
  function onLocation() { view.location = document.getElementById('loc').value; save(); draw(); }

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
