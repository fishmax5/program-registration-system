// ============================================================================
// 18b. THE REGULAR PROGRAMS PAGE  (a week of standing invitations)
// ============================================================================
//
// The second embed, and the one somebody reads when they are not asking about
// a date at all. Seven headings — EVERY MONDAY through EVERY SUNDAY — and
// under each one the programs that run on that day every week, one tile each,
// carrying their dates.
//
// It is deliberately the SAME TILE the calendar page draws (`91`'s stylesheet,
// the same chips, the same "the whole tile is the button"), because it is the
// same thing being shown: one program, its dates, and the current form behind
// each of them. What differs is the question the page is filed under.
//
// Everything the calendar page promises holds here: the whole fold is inlined
// so the first frame is the answer, the filters are arithmetic in the browser,
// a tap opens the form in its own tab, an embed reports its own height so the
// host's frame grows instead of scrolling, and every value from the workbook
// is written with textContent — the page uses no innerHTML with data in it.
// ============================================================================

/**
 * The regular programs page, as one string.
 *
 * `snapshot` is what publicRegularPrograms() returned; `options` is what
 * publicCalendarViewOptions() read off the query string — the same embed and
 * building pins the calendar page takes, read by the same function, so an
 * embed of one is written the same way as an embed of the other. `span` means
 * nothing here: this page is not a date range.
 */
function buildPublicRegularHtml(snapshot, options) {
  const snap = snapshot || { ok: false, programs: [] };
  const opts = options || {};
  const embed = !!opts.embed;
  const data = JSON.stringify(JSON.stringify(snap)).replace(/<\//g, '<\\/');

  const wanted = String(opts.location || '').trim().toLowerCase();
  const known = (snap && snap.locations) || [];
  let pinnedLocation = '';
  for (let i = 0; i < known.length && !pinnedLocation; i++) {
    if (String(known[i]).trim().toLowerCase() === wanted) pinnedLocation = known[i];
  }
  // The same double escape the snapshot gets, and for a sharper reason: this
  // one came off the URL.
  const embedding = JSON.stringify(JSON.stringify({
    embed,
    location: pinnedLocation,
    message: PUBLIC_CALENDAR_EMBED_MESSAGE
  })).replace(/<\//g, '<\\/');

  return `
${publicEmbedStyles()}${publicEmbedSkinStyles(embed)}

<div class="wrap">
${embed ? '' : `  <header>
    <p class="eyebrow">Every week</p>
    <h1 id="orgName">Regular Programs</h1>
    <p class="blurb" id="blurb">The programs that run every week. Tap one to sign up.</p>
    <p class="lines" id="contact"></p>
    <p class="places" id="places"></p>
  </header>
`}
  <div class="controls">
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

  <div id="list" class="week"></div>

  <footer id="foot"></footer>
</div>

<script>
  var DATA = JSON.parse(${data});
  var PROGRAMS = (DATA && DATA.programs) || [];
  var EMBED = JSON.parse(${embedding});
  var STORE_KEY = 'publicCalendarPrefs.v1';
  // FOUR, not the calendar page's six: a tile here stands in a weekday
  // column a fifth of the screen wide, and six chips in it is four rows of
  // dates under a two-word title. The rest are one tap away.
  var CHIP_LIMIT = 4;
  var DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  ${publicLocationColorScript()}

  /** The class carrying this building's colour, or the neutral outline. */
  function locClass(name) {
    return LOC_COLORS[String(name || '').trim().toLowerCase()] || '';
  }

  // The building is shared with the calendar page's own storage on purpose:
  // somebody who only ever comes to Narberth said so once, and both public
  // pages are the same person's answer to the same question.
  var view = { location: '', q: '' };
  try {
    var saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    if (saved && typeof saved.location === 'string') view.location = saved.location;
  } catch (err) { /* private browsing, or nothing stored yet */ }
  if (EMBED.location) view.location = EMBED.location;

  function save() {
    // A PINNED PAGE REMEMBERS NOTHING — see the note in the calendar page: an
    // embed's pin is the website author's setting, not the visitor's.
    if (EMBED.location) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ location: view.location }));
    } catch (err) { /* private browsing */ }
  }

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

  /** A date somebody can still take a place on, as opposed to join a queue for. */
  function isOpenSession(s) { return !!s.url && s.state !== 'waitlist'; }

  /**
   * The tile's words follow the FIRST DATE SOMEBODY CAN ACTUALLY HAVE, not
   * the next one on the calendar — a class with four open weeks and one full
   * one is a class they can come to, and saying "waiting list" because next
   * Tuesday is full sends them away from something that was theirs.
   */
  function leadOf(sessions) {
    for (var i = 0; i < sessions.length; i++) {
      if (isOpenSession(sessions[i])) return sessions[i];
    }
    for (var j = 0; j < sessions.length; j++) {
      if (sessions[j].url) return sessions[j];
    }
    return sessions[0];
  }

  /**
   * WHAT THE TILE SAYS IN PLACE OF A BUTTON — nothing, for an ordinary open
   * program: the whole tile is the button, and a pill inside it was a second
   * target doing the same job, and the widest thing on a tile in a narrow
   * weekday column. Only the states a tap cannot answer are left.
   */
  function ctaWords(lead, everyDateFull) {
    if (everyDateFull) return 'Join the waiting list';
    if (!lead) return '';
    if (lead.state === 'none') return 'No sign-up needed';
    if (lead.state === 'soon') return 'Sign-up opens soon';
    if (lead.state === 'waitlist') return 'Join the waiting list';
    return '';
  }

  /** One date: a link when it has a form behind it, a plain chip when not. */
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
      + (s.state === 'waitlist' ? ' \\u2014 full, the form joins the waiting list' : '');
    node.addEventListener('click', function (event) {
      event.stopPropagation();
      node.classList.add('opening');
      window.setTimeout(function () { node.classList.remove('opening'); }, 2500);
    });
    return node;
  }

  /**
   * "9:30 AM – 10:30 AM · 8 dates through Nov 27" — and NOT the weekday,
   * which is the column this tile is standing in. Repeating it on every tile
   * would be the heading said again, once per program, down the page.
   */
  function scheduleLine(program) {
    var sessions = program.sessions || [];
    var parts = [];
    if (program.time) parts.push(program.time);
    if (sessions.length) {
      var last = sessions[sessions.length - 1];
      parts.push(sessions.length + ' dates through ' + (last.shortLabel || last.dayLabel));
    }
    return parts.join(' \\u00b7 ');
  }

  function cardFor(program) {
    var sessions = program.sessions || [];
    var lead = leadOf(sessions);
    var withForm = sessions.filter(function (s) { return !!s.url; });
    var fullDates = sessions.filter(function (s) { return s.state === 'waitlist'; });
    var everyDateFull = withForm.length > 0 && fullDates.length === withForm.length;

    var colour = locClass(program.location);
    var card = el('div', 'prog' + (colour ? ' ' + colour : ''));
    var url = lead && lead.url ? lead.url : '';
    if (url) {
      // THE WHOLE RECTANGLE IS THE BUTTON — a div rather than an <a>, because
      // the date chips inside it are links of their own and a browser will
      // not honour an anchor nested in an anchor. Keyboard and screen readers
      // get the same thing the mouse gets, by hand.
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
    head.appendChild(el('div', 'name', program.title));
    var words = ctaWords(lead, everyDateFull);
    if (words) {
      var kind = everyDateFull || (lead && lead.state === 'waitlist') ? 'warn' : '';
      head.appendChild(el('span', 'cta' + (kind ? ' ' + kind : ''), words));
    }
    card.appendChild(head);
    card.setAttribute('aria-label', program.title + (words ? ' \\u2014 ' + words : ''));

    card.appendChild(el('div', 'when', scheduleLine(program)));

    var meta = el('div', 'meta');
    if (program.location) {
      meta.appendChild(tag(program.location, 'where' + (colour ? ' ' + colour : '')));
    }
    if (lead && lead.club) meta.appendChild(tag('Club'));
    if (lead && lead.appointment) meta.appendChild(tag('By appointment'));
    if (everyDateFull) meta.appendChild(tag('Every date full', 'warn'));
    else if (lead && lead.seats) {
      meta.appendChild(tag(lead.seats, lead.state === 'open' ? 'open' : 'warn'));
    }
    if (meta.childNodes.length) card.appendChild(meta);

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
        postHeight();
      });
      dates.appendChild(more);
    }
    card.appendChild(dates);
    if (fullDates.length && !everyDateFull) {
      var legend = el('div', 'legend');
      legend.appendChild(el('b', '', 'Amber'));
      legend.appendChild(document.createTextNode(
        ' dates are full \\u2014 that form joins the waiting list.'));
      card.appendChild(legend);
    }
    return card;
  }

  function drawIntro() {
    if (EMBED.embed) return;
    var intro = (DATA && DATA.intro) || {};
    if (intro.name) document.getElementById('orgName').textContent = intro.name;
    var contact = document.getElementById('contact');
    contact.textContent = '';
    if (intro.phone) {
      contact.appendChild(document.createTextNode('Questions, or rather sign up by phone? '));
      var tel = el('a', '', intro.phone);
      tel.href = 'tel:' + String(intro.phone).replace(/[^0-9+]/g, '');
      contact.appendChild(tel);
    }
    if (intro.email) {
      contact.appendChild(document.createTextNode(intro.phone ? '  \\u00b7  ' : ''));
      var mail = el('a', '', intro.email);
      mail.href = 'mailto:' + intro.email;
      contact.appendChild(mail);
    }
    document.getElementById('places').textContent =
      (intro.places && intro.places.length) ? intro.places.join('   \\u00b7   ') : '';
  }

  function draw() {
    var list = document.getElementById('list');
    var rows = visible();

    list.textContent = '';
    if (!DATA || DATA.ok === false) {
      list.appendChild(el('div', 'notice full', DATA && DATA.message
        ? DATA.message
        : 'We could not read the program calendar just now. Please try again shortly.'));
    } else if (!rows.length) {
      var none = el('div', 'empty full');
      none.appendChild(el('b', '', 'Nothing weekly here yet'));
      none.appendChild(el('div', '', view.q || view.location
        ? 'No weekly programs match that. Try clearing the search or the building.'
        : 'Nothing in the next two months runs every week. Everything else is on the full calendar.'));
      list.appendChild(none);
    } else {
      // ONE COLUMN PER WEEKDAY, in the order the server sorted them — Monday
      // first, because that is how a person planning a week reads one, and a
      // weekday with nothing on gets no column rather than an empty one.
      var column = null, day = '';
      rows.forEach(function (p) {
        if (p.weekday !== day) {
          day = p.weekday;
          column = el('div', 'daycol');
          var h = el('h2', 'day');
          h.appendChild(el('span', '', 'Every ' + p.weekday));
          column.appendChild(h);
          list.appendChild(column);
        }
        column.appendChild(cardFor(p));
      });
    }

    document.getElementById('count').textContent = rows.length
      ? (rows.length === 1 ? '1 weekly program' : rows.length + ' weekly programs')
      : '';
    document.getElementById('foot').textContent = DATA && DATA.generatedAt
      ? 'Updated ' + DATA.generatedAt + '. Seats are checked again when you open a form.'
      : '';
    postHeight();
  }

  function drawLocations() {
    var bar = document.getElementById('locbar');
    var locations = (DATA && DATA.locations) || [];
    if (view.location && locations.indexOf(view.location) === -1) view.location = '';
    bar.textContent = '';
    if (EMBED.location || locations.length < 2) { bar.style.display = 'none'; return; }
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
        // What is drawn is real, it is just a few minutes old; an error
        // banner over a working page would be its own worst moment.
        button.textContent = 'Refresh';
      })
      .publicRegularPrograms(JSON.stringify({ fresh: !!force }));
  }

  // The frame's height — the whole of what an embed says to its host. See the
  // long note in the calendar page: an iframe's height is fixed and this
  // page's is not, and the two disagree as a scrollbar inside the frame.
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
