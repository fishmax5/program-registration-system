// ============================================================================
// 16f. THE DOOR APP'S PAGE  (setup, the name list, the person, the walk-in)
// ============================================================================
//
// One served page with four screens and one address. What each screen is for
// is in the section note of 67_door_app.gs; what is worth knowing HERE is why
// it is one page rather than four:
//
//   - A door has one tablet and one queue. Every screen change is a redraw of
//     the same <main>, never a navigation, so nothing on this page can ever be
//     a load a person in a queue is watching.
//   - The day is read ONCE per open and re-read quietly after every write,
//     never under a finger. A person who has tapped their name is looking at a
//     screen of ticks, and a tick that moves while a thumb is on its way to it
//     is how the wrong thing gets recorded — so a background day waits until
//     the page is back at the name list.
//   - Everything interpolated into the page below goes through JSON.stringify
//     twice or through esc(), because a member called O'Brien and a program
//     called "Movie Night </script>" are both real and both end the page
//     mid-sentence otherwise. See tests/check_in_page.test.js.
// ============================================================================

/**
 * The door app, as one string.
 *
 * `options` is { location, pinRequired, locations, todayKey } — a location pin
 * from the query string if anybody still has one on a bookmark (it seeds the
 * setup screen rather than skipping it), whether writes need a PIN, the
 * buildings this workbook has, and the date the SERVER is on.
 *
 * NO DAY IS INLINED. The walk-in page inlined a stored snapshot of today so
 * the first frame had a list on it; this page cannot, because the day it is
 * about is whichever one the tablet was set up for, and a stored TODAY drawn
 * under a header that says "Thursday" is a page lying about which list it is
 * showing. The read it makes instead is one location's single day.
 */
function buildDoorAppHtml(options) {
  const opts = options || {};
  const inlineOptions = JSON.stringify(JSON.stringify({
    location: String(opts.location || ''),
    pinRequired: !!opts.pinRequired,
    locations: opts.locations || checkInLocations(),
    todayKey: opts.todayKey || formatDateKey(new Date())
  })).replace(/<\//g, '<\\/');

  return `
<style>
  /* Every target is a thumb's worth: this is used standing up, on a tablet,
     by people who are not staff and are not looking for long. */
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         font-size: 16px; color: #202124; margin: 0; background: #F8F9FA; }
  header { background: #1A73E8; color: #fff; padding: 12px 16px; position: sticky; top: 0; z-index: 5;
           display: flex; align-items: center; gap: 12px; }
  header .who { flex: 1; min-width: 0; }
  header h1 { margin: 0; font-size: 19px; font-weight: 600; }
  header .sub { font-size: 14px; opacity: .92; margin-top: 3px; }
  header button.setup { background: rgba(255,255,255,.16); color: #fff; border: 1px solid rgba(255,255,255,.4);
                        border-radius: 8px; padding: 9px 11px; font-size: 13px; cursor: pointer; }
  main { padding: 14px 16px 110px 16px; max-width: 820px; margin: 0 auto; }
  h2 { font-size: 17px; margin: 22px 0 8px 0; }
  h2:first-child { margin-top: 4px; }
  p.hint { color: #5F6368; font-size: 14px; line-height: 1.5; margin: 0 0 10px 0; }

  input[type=text], input[type=tel], input[type=email], input[type=date], select {
    width: 100%; padding: 13px; font-size: 16px; border: 1px solid #DADCE0;
    border-radius: 8px; background: #fff; }
  label.field { display: block; font-weight: 600; margin: 12px 0 5px 0; font-size: 14px; color: #5F6368; }

  /* THE NAME LIST. Letter headings and a dense grid, because the whole point
     of the list is that finding your own name on it beats typing it. */
  .letter { font-size: 13px; font-weight: 700; color: #5F6368; letter-spacing: .08em;
            margin: 16px 0 6px 0; border-bottom: 1px solid #E8EAED; padding-bottom: 4px; }
  .letter:first-of-type { margin-top: 4px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  button.card { background: #fff; border: 1px solid #DADCE0; border-radius: 10px; padding: 14px 12px;
                font-size: 17px; text-align: left; cursor: pointer; min-height: 62px; color: #202124; }
  button.card .meta { display: block; font-size: 12px; color: #5F6368; margin-top: 3px; line-height: 1.35; }
  button.card.here { background: #E6F4EA; border-color: #B7DFC4; }
  button.card.here .meta { color: #188038; }
  button.card.pick { border-color: #1A73E8; border-width: 2px; background: #F1F7FE; }

  /* THE WALK-IN BOX. Immediately under the names and never behind a tap of
     its own: the person it is for is the one who does not find themselves on
     the list, and asking them to go looking for a second screen is how they
     end up asking a volunteer instead. */
  .walkin { margin-top: 20px; background: #fff; border: 2px solid #1A73E8; border-radius: 12px;
            padding: 16px; }
  .walkin h2 { margin: 0 0 6px 0; }

  ul.list { list-style: none; margin: 0; padding: 0; }
  li.item { background: #fff; border: 1px solid #E8EAED; border-radius: 10px; margin-bottom: 8px; }
  li.item label { display: flex; align-items: flex-start; gap: 12px; padding: 14px 12px; cursor: pointer; }
  li.item input[type=checkbox], li.item input[type=radio] { width: 26px; height: 26px; margin: 0; flex: 0 0 auto; }
  li.item .what { flex: 1; }
  li.item .title { font-size: 17px; }
  li.item .meta { display: block; font-size: 13px; color: #5F6368; margin-top: 3px; line-height: 1.4; }
  li.item.on { border-color: #B7DFC4; background: #F4FBF6; }
  li.item.off label { cursor: default; opacity: .72; }
  .tag { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .04em;
         border-radius: 999px; padding: 2px 8px; margin-right: 6px; vertical-align: 1px; }
  .tag.yes { background: #E6F4EA; color: #137333; }
  .tag.no { background: #FEF7E0; color: #B06000; }
  .tag.grey { background: #F1F3F4; color: #5F6368; }
  .warn { color: #B06000; }
  .banner { background: #FEF7E0; border: 1px solid #FDE293; color: #B06000; border-radius: 10px;
            padding: 12px 14px; font-size: 14px; line-height: 1.45; margin-bottom: 12px; }

  button.big { width: 100%; background: #1A73E8; color: #fff; border: 0; border-radius: 10px;
               padding: 16px; font-size: 18px; font-weight: 600; cursor: pointer; margin-top: 16px; }
  button.big[disabled] { opacity: .5; }
  button.plain { background: #fff; border: 1px solid #DADCE0; color: #1A73E8; border-radius: 8px;
                 padding: 13px 14px; font-size: 15px; cursor: pointer; min-height: 48px; width: 100%;
                 margin-top: 8px; }
  .foot { margin-top: 26px; font-size: 13px; color: #5F6368; line-height: 1.6; }

  #status { position: fixed; left: 0; right: 0; bottom: 0; padding: 13px 16px; background: #202124;
            color: #fff; font-size: 14px; line-height: 1.45; transform: translateY(120%);
            transition: transform .18s ease; }
  #status.show { transform: translateY(0); }
  #status.err { background: #C5221F; }
  #status.ok { background: #188038; }
  ul.result { list-style: none; margin: 12px 0 0 0; padding: 0; }
  ul.result li { background: #fff; border: 1px solid #E8EAED; border-radius: 8px; padding: 12px;
                 margin-bottom: 8px; font-size: 15px; line-height: 1.45; }
  .hide { display: none !important; }
</style>

<header>
  <div class="who">
    <h1 id="heading">Sign In</h1>
    <div class="sub" id="subheading"></div>
  </div>
  <button class="setup hide" id="setupbtn" onclick="openSetup()">Change setup</button>
</header>

<div id="pinbox" class="hide" style="padding:24px 16px;max-width:360px;margin:0 auto;">
  <h2>Enter the desk PIN</h2>
  <input type="tel" id="pin" inputmode="numeric" autocomplete="off" placeholder="PIN">
  <button class="big" onclick="savePin()">Continue</button>
</div>

<main id="app" class="hide"></main>
<div id="status"></div>

<script>
  var OPTS = JSON.parse(${inlineOptions});
  var SETUP_KEY = 'doorSetup:v1';

  var SETUP = null;        // { location, dateKey } — this tablet's own default
  var DAY = null;          // the day, as readWalkInDay() sent it
  var PENDING = null;      // a background day held back until the screen is idle
  var STEP = 'setup';      // setup -> names -> person -> walkin -> done
  var PERSON = null;       // { name, key, isNew, phone, email, registered[], ... }
  var PICKED = {};         // session value -> true
  var LUNCH = false;
  var RECURRING = 'none';  // none | month | club
  // WHAT HAS BEEN TYPED INTO THE WALK-IN FORM, held outside the DOM. Picking a
  // radio redraws the whole screen (one render function, one truth about what
  // is selected), and a redraw that emptied the name box somebody had just
  // filled in would be the page losing their answer for them.
  var WALKIN = { name: '', email: '', phone: '' };
  var MEMBER = '';         // yes | no
  var RESULT = null;
  var busy = false;
  var pin = '';

  // --------------------------------------------------------------- the setup
  // WHAT USED TO BE IN THE URL. One address is deployed; the building and the
  // day live in this tablet's own localStorage, so the second boot goes
  // straight to the name list and a volunteer never has to get a query string
  // right. Private browsing and a cleared cache both simply mean the setup
  // screen again, which is the correct failure.
  function readSetup() {
    try {
      var raw = window.localStorage.getItem(SETUP_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || !saved.location) return null;
      // A TABLET LEFT ON TUESDAY MUST NOT STILL BE ON IT ON WEDNESDAY. A past
      // date is snapped forward to today — every program on it would be over,
      // every sign-in already ticked, and every tap would record something
      // nobody meant. A date in the FUTURE is kept, because that one was
      // somebody deliberately setting the tablet up ahead, and the header
      // says so in words.
      if (!saved.dateKey || saved.dateKey < OPTS.todayKey) saved.dateKey = OPTS.todayKey;
      return { location: saved.location, dateKey: saved.dateKey };
    } catch (err) {
      return null;
    }
  }

  function writeSetup(setup) {
    try { window.localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (err) { /* private browsing */ }
  }

  function start() {
    try { pin = window.localStorage.getItem('checkInPin') || ''; } catch (err) { pin = ''; }
    if (OPTS.pinRequired && !pin) return showPin();
    showApp();
  }

  function showPin() {
    document.getElementById('pinbox').classList.remove('hide');
    document.getElementById('app').classList.add('hide');
    document.getElementById('setupbtn').classList.add('hide');
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
    SETUP = readSetup();
    if (!SETUP) return openSetup();
    STEP = 'names';
    loadDay();
  }

  function openSetup() {
    STEP = 'setup';
    PERSON = null; RESULT = null; PICKED = {}; LUNCH = false;
    hideStatus();
    draw();
  }

  // ---------------------------------------------------------------- the day
  function loadDay(then) {
    setBusy(true);
    draw();
    say('Reading the list...', '');
    call('doorDay', { location: SETUP.location, dateKey: SETUP.dateKey }, function (res) {
      setBusy(false);
      if (!res || !res.ok) { DAY = null; draw(); return handle(res); }
      DAY = res.day;
      hideStatus();
      draw();
      if (then) then();
    });
  }

  /**
   * THE SAME READ, SILENTLY — after every write, so the next person in the
   * queue sees this one as signed in. No busy state and no redraw under a
   * finger: a fresh day that arrives mid-sign-in waits until the page is back
   * at the name list (see draw()). A failure is not reported at all — the page
   * has a list on it, nobody asked for this, and an error banner over a working
   * screen is worse than being a few minutes out of date.
   */
  function syncDay() {
    if (!SETUP) return;
    call('doorDay', { location: SETUP.location, dateKey: SETUP.dateKey }, function (res) {
      if (!res || !res.ok || !res.day) return;
      if (STEP !== 'names' || PERSON) { PENDING = res.day; return; }
      DAY = res.day;
      draw();
    });
  }

  // --------------------------------------------------------------------- draw
  function draw() {
    if (PENDING && STEP === 'names' && !PERSON) { DAY = PENDING; PENDING = null; }
    var main = document.getElementById('app');
    var setupBtn = document.getElementById('setupbtn');
    main.innerHTML = '';
    document.getElementById('subheading').textContent = (STEP === 'setup' || !SETUP)
      ? 'Set up this tablet'
      : (SETUP.location + ' — ' + ((DAY && DAY.dateLabel) || SETUP.dateKey));
    if (STEP === 'setup' || !SETUP) { setupBtn.classList.add('hide'); return drawSetup(main); }
    setupBtn.classList.remove('hide');
    if (STEP === 'done') return drawDone(main);
    if (!DAY) return drawEmpty(main);
    if (STEP === 'person') return drawPerson(main);
    if (STEP === 'walkin') return drawWalkIn(main);
    drawNames(main);
  }

  function drawEmpty(main) {
    main.appendChild(el('p', 'hint', busy ? 'Reading the list...' : 'The list has not loaded yet.'));
    main.appendChild(button('plain', 'Try again', function () { loadDay(); }));
  }

  // SCREEN 1 — set this tablet up: which door, and which day.
  function drawSetup(main) {
    var chosenLoc = (SETUP && SETUP.location) || OPTS.location || '';
    var chosenDay = (SETUP && SETUP.dateKey) || OPTS.todayKey;
    main.appendChild(el('h2', '', 'Which building?'));
    main.appendChild(el('p', 'hint',
      'This is remembered on this tablet. Change it any time with the button at the top.'));
    var grid = el('div', 'cards', '');
    (OPTS.locations || []).forEach(function (loc) {
      var b = document.createElement('button');
      b.className = 'card' + (loc === chosenLoc ? ' pick' : '');
      b.textContent = loc;
      b.onclick = function () { chosenLoc = loc; drawSetupAgain(chosenLoc, dateBoxValue(chosenDay)); };
      grid.appendChild(b);
    });
    if (!(OPTS.locations || []).length) {
      main.appendChild(el('p', 'hint',
        'This workbook has no locations set up yet — add them on the Config tab.'));
    }
    main.appendChild(grid);

    main.appendChild(el('h2', '', 'Which day?'));
    main.appendChild(el('p', 'hint', 'Today, unless you are setting the tablet up ahead of time.'));
    var wrap = document.createElement('div');
    var date = document.createElement('input');
    date.type = 'date';
    date.id = 'setupdate';
    date.value = chosenDay;
    wrap.appendChild(date);
    main.appendChild(wrap);
    main.appendChild(button('plain', 'Use today', function () {
      document.getElementById('setupdate').value = OPTS.todayKey;
    }));

    var go = button('big', 'Start', function () {
      var day = document.getElementById('setupdate').value || OPTS.todayKey;
      if (!chosenLoc) return say('Pick a building first.', 'err');
      SETUP = { location: chosenLoc, dateKey: day };
      writeSetup(SETUP);
      hideStatus();
      STEP = 'names';
      DAY = null;
      loadDay();
    });
    main.appendChild(go);
  }

  /** Redrawing setup without losing what has been typed into the date box. */
  function drawSetupAgain(loc, dayValue) {
    SETUP = { location: loc, dateKey: dayValue || OPTS.todayKey };
    draw();
  }

  function dateBoxValue(fallback) {
    var box = document.getElementById('setupdate');
    return (box && box.value) || fallback || OPTS.todayKey;
  }

  // SCREEN 2 — everybody expected, A–Z, and the walk-in box under them.
  function drawNames(main) {
    if (DAY.dateKey !== OPTS.todayKey) {
      main.appendChild(el('div', 'banner',
        'This tablet is set up for ' + DAY.dateLabel + ', which is not today. ' +
        'Everything signed in here is recorded against that date.'));
    }
    main.appendChild(el('h2', '', 'Tap your name'));
    var people = (DAY.people || []).slice().sort(function (a, b) {
      var d = sortKey(a.name).localeCompare(sortKey(b.name));
      return d || a.name.localeCompare(b.name);
    });
    if (people.length) {
      main.appendChild(el('p', 'hint',
        'Everybody signed up for anything at ' + DAY.location + ' on ' + DAY.dateLabel + '.'));
      // LETTER HEADINGS, off the surname — which is how a list of people is
      // read, and the only thing that makes a screen of eighty names usable
      // without a search.
      var letter = '';
      var grid = null;
      people.forEach(function (p) {
        var initial = (sortKey(p.name).charAt(0) || '#').toUpperCase();
        if (initial !== letter) {
          letter = initial;
          main.appendChild(el('div', 'letter', letter));
          grid = el('div', 'cards', '');
          main.appendChild(grid);
        }
        grid.appendChild(personCard(p));
      });
    } else {
      main.appendChild(el('p', 'hint',
        'Nobody is signed up for anything here on ' + DAY.dateLabel + '. ' +
        'Search below, or sign in as a walk-in.'));
    }

    // The regular who did not register this time: found on the member roll and
    // opened on the same personal screen as anybody on the list.
    main.appendChild(el('h2', '', 'Not seeing your name?'));
    var box = document.createElement('input');
    box.type = 'text';
    box.id = 'search';
    box.placeholder = 'Search for your name';
    box.autocomplete = 'off';
    box.oninput = drawSearchResults;
    main.appendChild(box);
    var results = el('div', 'cards', '');
    results.id = 'results';
    results.style.marginTop = '10px';
    main.appendChild(results);
    if (!(DAY.members || []).length) {
      main.appendChild(el('p', 'hint',
        'The member directory is empty — run "Update Everything Now" in the workbook to build it. ' +
        'Anybody can still sign in as a walk-in below.'));
    }

    // THE WALK-IN BOX — always on screen, never behind a tap of its own.
    var walk = el('div', 'walkin', '');
    walk.appendChild(el('h2', '', 'New here, or not registered?'));
    walk.appendChild(el('p', 'hint',
      'Sign in as a walk-in: pick what you are here for, and tell us who you are. ' +
      'It takes a minute.'));
    walk.appendChild(button('big', 'Sign in as a walk-in', function () {
      PERSON = null; PICKED = {}; LUNCH = false; RECURRING = 'none'; MEMBER = '';
      WALKIN = { name: '', email: '', phone: '' };
      STEP = 'walkin';
      draw();
      window.scrollTo(0, 0);
    }));
    main.appendChild(walk);
    main.appendChild(footer());
  }

  /** Sorted and headed on the LAST word of the name — the surname, usually. */
  function sortKey(name) {
    var parts = String(name || '').trim().split(/\\s+/);
    return (parts.length ? parts[parts.length - 1] : String(name || '')).toUpperCase();
  }

  function drawSearchResults() {
    var typed = document.getElementById('search').value.trim();
    var needle = typed.toLowerCase();
    var box = document.getElementById('results');
    box.innerHTML = '';
    if (needle.length < 2) return;
    var hits = (DAY.members || []).filter(function (m) {
      return m.name.toLowerCase().indexOf(needle) !== -1;
    }).slice(0, 24);
    if (!hits.length) {
      box.appendChild(el('p', 'hint', 'No member matches "' + typed +
        '". Sign in as a walk-in below.'));
      return;
    }
    hits.forEach(function (m) {
      var person = null;
      (DAY.people || []).forEach(function (p) { if (p.key === m.key) person = p; });
      box.appendChild(person ? personCard(person) : personCard({
        name: m.name, key: m.key, registered: [], attended: [], lunchRegistered: false, here: false
      }));
    });
  }

  function personCard(p) {
    var b = document.createElement('button');
    b.className = 'card' + (p.here ? ' here' : '');
    b.disabled = busy;
    var bits = [];
    if (p.here) bits.push('Already signed in');
    if ((p.registered || []).length) bits.push((p.registered || []).map(titleOf).join(', '));
    if (p.lunchRegistered) bits.push('lunch ordered');
    b.innerHTML = esc(p.name) + (bits.length ? '<span class="meta">' + esc(bits.join(' · ')) + '</span>' : '');
    b.onclick = function () { choose(p); };
    return b;
  }

  function choose(p) {
    PERSON = p;
    PICKED = {};
    // WHAT THEY ARE ALREADY DOWN FOR COMES PRE-TICKED. Somebody registered for
    // Chair Yoga is here for Chair Yoga; making them tick it again is asking a
    // question the workbook already knows the answer to. The screen is a
    // CONFIRMATION with the ticks live, so changing one is the same tap.
    (p.registered || []).forEach(function (v) { PICKED[v] = true; });
    LUNCH = !!p.lunchRegistered;
    RECURRING = 'none';
    MEMBER = '';
    STEP = 'person';
    draw();
    window.scrollTo(0, 0);
  }

  // SCREEN 3 — one person: everything they are down for today, to confirm.
  function drawPerson(main) {
    main.appendChild(el('h2', '', 'Hello, ' + PERSON.name));
    main.appendChild(el('p', 'hint',
      'This is what you are down for on ' + DAY.dateLabel +
      '. Change anything that is wrong, then confirm.'));

    var list = el('ul', 'list', '');
    (DAY.programs || []).forEach(function (program) { list.appendChild(programItem(program)); });
    if (!(DAY.programs || []).length) {
      list.appendChild(el('p', 'hint', 'No programs are on at ' + DAY.location + ' that day.'));
    }
    main.appendChild(list);

    var lunchList = el('ul', 'list', '');
    lunchList.appendChild(lunchItem(!!PERSON.lunchRegistered));
    main.appendChild(lunchList);

    var go = button('big', 'Confirm and sign in', submit);
    go.id = 'go';
    go.disabled = busy;
    main.appendChild(go);
    main.appendChild(button('plain', 'Not you? Back to the list', function () {
      PERSON = null; STEP = 'names'; draw();
    }));
  }

  // SCREEN 4 — a walk-in: what they are here for, then who they are.
  function drawWalkIn(main) {
    main.appendChild(el('h2', '', 'What are you here for?'));
    main.appendChild(el('p', 'hint',
      'Pick everything you are here for on ' + DAY.dateLabel + '.'));
    var list = el('ul', 'list', '');
    (DAY.programs || []).forEach(function (program) { list.appendChild(programItem(program)); });
    if (!(DAY.programs || []).length) {
      list.appendChild(el('p', 'hint', 'No programs are on at ' + DAY.location + ' that day.'));
    }
    main.appendChild(list);

    var lunchList = el('ul', 'list', '');
    lunchList.appendChild(lunchItem(false));
    main.appendChild(lunchList);

    main.appendChild(el('h2', '', 'Who are you?'));
    main.appendChild(el('p', 'hint',
      'An email or a phone number — whichever you have. We need one of them so the office ' +
      'can follow up.'));
    main.appendChild(field('newname', 'Your name', 'text', WALKIN.name));
    main.appendChild(field('newemail', 'Email', 'email', WALKIN.email));
    main.appendChild(field('newphone', 'Phone', 'tel', WALKIN.phone));

    main.appendChild(el('h2', '', 'Coming back?'));
    var rec = el('ul', 'list', '');
    rec.appendChild(radioItem('recurring', 'none', 'Just today',
      'Only the sessions ticked above.', RECURRING === 'none', function (v) { RECURRING = v; }));
    rec.appendChild(radioItem('recurring', 'month', 'The rest of this month',
      'You are registered for every later session of the programs you ticked, this month.',
      RECURRING === 'month', function (v) { RECURRING = v; }));
    rec.appendChild(radioItem('recurring', 'club', 'Every time — put me on the club list',
      'A standing place on the programs you ticked, and on future sessions as they are added. ' +
      'Programs booked by appointment cannot take one.',
      RECURRING === 'club', function (v) { RECURRING = v; }));
    main.appendChild(rec);

    main.appendChild(el('h2', '', 'Are you a member?'));
    var mem = el('ul', 'list', '');
    mem.appendChild(radioItem('member', 'yes', 'Yes, I am a member',
      'You are added to today\\'s list and nothing else changes.',
      MEMBER === 'yes', function (v) { MEMBER = v; }));
    mem.appendChild(radioItem('member', 'no', 'Not yet',
      'You can sign in and join today either way — the office will send you the membership form.',
      MEMBER === 'no', function (v) { MEMBER = v; }));
    main.appendChild(mem);

    var go = button('big', 'Sign in', submitWalkIn);
    go.id = 'go';
    go.disabled = busy;
    main.appendChild(go);
    main.appendChild(button('plain', 'Back to the name list', function () {
      STEP = 'names'; PICKED = {}; LUNCH = false; draw();
    }));
  }

  function programItem(program) {
    var registered = PERSON && (PERSON.registered || []).indexOf(program.value) !== -1;
    var attended = PERSON && (PERSON.attended || []).indexOf(program.value) !== -1;
    // An appointment nobody booked is not something a door can hand out: a
    // slot is a chair at a time and choosing one is a conversation. Shown, so
    // it is plainly not missing; not tickable.
    var locked = !registered && program.byAppointment;
    var li = el('li', 'item' + (locked ? ' off' : (PICKED[program.value] ? ' on' : '')), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!PICKED[program.value] && !locked;
    box.disabled = locked || busy;
    box.onchange = function () {
      if (box.checked) PICKED[program.value] = true; else delete PICKED[program.value];
      li.className = 'item' + (box.checked ? ' on' : '');
    };
    var what = el('div', 'what', '');
    var tag = attended ? '<span class="tag yes">SIGNED IN</span>'
      : (registered ? '<span class="tag yes">REGISTERED</span>'
        : (locked ? '<span class="tag grey">BY APPOINTMENT</span>'
          : '<span class="tag no">NOT REGISTERED</span>'));
    var meta = [];
    if (program.time) meta.push(program.time);
    if (locked) meta.push('Booked by appointment — see a staff member to make one.');
    else if (!registered) meta.push('Tick this and you will be added to the list.');
    what.innerHTML = tag + '<span class="title">' + esc(program.title) + '</span>' +
      (meta.length ? '<span class="meta' + (locked ? ' warn' : '') + '">' +
        esc(meta.join(' — ')) + '</span>' : '');
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
  }

  function lunchItem(registered) {
    var lunch = DAY.lunch || {};
    var offered = !!lunch.offered;
    var locked = !offered && !registered;
    var li = el('li', 'item' + (locked ? ' off' : (LUNCH ? ' on' : '')), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = LUNCH && !locked;
    box.disabled = locked || busy;
    box.onchange = function () {
      LUNCH = box.checked;
      li.className = 'item' + (LUNCH ? ' on' : '');
    };
    var what = el('div', 'what', '');
    var title = 'Lunch' + (lunch.dish ? ' — ' + lunch.dish : '');
    var tag = registered ? '<span class="tag yes">ORDERED FOR YOU</span>'
      : (locked ? '<span class="tag grey">NOT THAT DAY</span>'
        : '<span class="tag no">NOT REGISTERED</span>');
    var meta = [];
    if (lunch.type && lunch.type !== 'Not Serving') meta.push(lunch.type);
    if (registered) {
      meta.push('Your meal is ordered. Ticking this records it as handed to you — ' +
        'leave it unticked if you are not taking it.');
    } else if (locked) {
      meta.push(lunch.ruledOut
        ? 'No lunch is served here that day.'
        : 'That day\\'s menu has not been set. Ask a staff member.');
    } else {
      // THE SENTENCE THE LUNCH LINE EXISTS FOR. Meals are ordered days ahead
      // against a count, so a tick here is a request for one that may not
      // exist — recorded, and never promised.
      meta.push('You are not signed up for lunch. Tick this to be added to the list, then check ' +
        'with a staff member that a meal is available — meals are ordered in advance.');
    }
    what.innerHTML = tag + '<span class="title">' + esc(title) + '</span>' +
      '<span class="meta' + (registered || locked ? '' : ' warn') + '">' +
      esc(meta.join(' — ')) + '</span>';
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
  }

  function radioItem(group, value, title, meta, checked, onpick) {
    var li = el('li', 'item' + (checked ? ' on' : ''), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'radio';
    box.name = group;
    box.checked = !!checked;
    box.disabled = busy;
    box.onchange = function () {
      onpick(value);
      // Redrawn rather than patched, so every sibling's highlight is right —
      // the whole screen is one render function and this is the cheap way to
      // keep one truth about what is selected. What was typed is stashed
      // first and put back by drawWalkIn(), and the scroll position is kept,
      // so the redraw is invisible.
      stashWalkIn();
      var y = window.scrollY;
      draw();
      window.scrollTo(0, y);
    };
    var what = el('div', 'what', '');
    what.innerHTML = '<span class="title">' + esc(title) + '</span>' +
      (meta ? '<span class="meta">' + esc(meta) + '</span>' : '');
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
  }

  // ------------------------------------------------------------------ writes
  function submit() {
    var programs = Object.keys(PICKED);
    if (!programs.length && !LUNCH) return say('Tick what you are here for first.', 'err');
    send({
      name: PERSON.name,
      phone: PERSON.phone || '',
      email: PERSON.email || '',
      newMember: false,
      programs: programs,
      lunch: !!LUNCH,
      recurring: 'none',
      member: ''
    });
  }

  /** Whatever is in the walk-in form's boxes right now, kept across a redraw. */
  function stashWalkIn() {
    var name = document.getElementById('newname');
    var email = document.getElementById('newemail');
    var phone = document.getElementById('newphone');
    if (name) WALKIN.name = name.value;
    if (email) WALKIN.email = email.value;
    if (phone) WALKIN.phone = phone.value;
  }

  function submitWalkIn() {
    var programs = Object.keys(PICKED);
    if (!programs.length && !LUNCH) return say('Pick what you are here for first.', 'err');
    stashWalkIn();
    var name = WALKIN.name.trim();
    var email = WALKIN.email.trim();
    var phone = WALKIN.phone.trim();
    if (!name) return say('Type your name first.', 'err');
    var hasEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
    var hasPhone = phone.replace(/[^0-9]/g, '').length >= 7;
    if (!hasEmail && !hasPhone) {
      return say('An email address or a phone number is needed so the office can follow up.', 'err');
    }
    if (!MEMBER) return say('Tell us whether you are a member already.', 'err');
    send({
      name: name,
      phone: phone,
      email: email,
      // A walk-in always writes the member roll row: this is the person the
      // office has to be able to find afterwards, member or not.
      newMember: true,
      programs: programs,
      lunch: !!LUNCH,
      recurring: RECURRING,
      member: MEMBER
    });
  }

  function send(payload) {
    payload.location = SETUP.location;
    payload.dateKey = SETUP.dateKey;
    setBusy(true);
    draw();
    say('Signing you in...', '');
    call('doorSignIn', payload, function (res) {
      setBusy(false);
      if (!res) { draw(); return handle(res); }
      RESULT = res;
      STEP = 'done';
      draw();
      window.scrollTo(0, 0);
      say(res.message, res.ok ? 'ok' : 'err');
      // Re-read rather than patch: the next person in the queue has to see
      // this one as signed in, and the sheet is the truth. Quietly, because
      // the volunteer is reading the receipt this would otherwise paper over.
      syncDay();
    });
  }

  function drawDone(main) {
    main.appendChild(el('h2', '', (RESULT && RESULT.ok ? '✅ ' : '⚠️ ') + ((RESULT && RESULT.name) || '')));
    main.appendChild(el('p', 'hint', (RESULT && RESULT.message) || ''));
    var list = el('ul', 'result', '');
    ((RESULT && RESULT.lines) || []).forEach(function (line) { list.appendChild(el('li', '', line)); });
    main.appendChild(list);
    main.appendChild(button('big', 'Done — next person', function () {
      PERSON = null; RESULT = null; PICKED = {}; LUNCH = false;
      RECURRING = 'none'; MEMBER = '';
      WALKIN = { name: '', email: '', phone: '' };
      STEP = 'names';
      hideStatus();
      draw();
      window.scrollTo(0, 0);
    }));
  }

  function footer() {
    var d = el('div', 'foot', '');
    var when = '';
    if (DAY && DAY.stale) {
      when = 'Showing the list stored at ' + (DAY.storedAt || DAY.readAt || 'earlier') +
        ' — it refreshes after the next sign-in. ';
    } else if (DAY && DAY.readAt) {
      when = 'Read at ' + DAY.readAt + '. ';
    }
    d.textContent = when + 'Staff: use "Change setup" at the top to switch building or day.';
    return d;
  }

  // ------------------------------------------------------------------ plumbing
  function titleOf(value) {
    var idx = value.lastIndexOf(' · ');
    return idx > 0 ? value.substring(0, idx) : value;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function button(cls, text, onclick) {
    var b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.disabled = busy;
    b.onclick = onclick;
    return b;
  }

  function field(id, label, type, value) {
    var wrap = document.createElement('div');
    var l = el('label', 'field', label);
    l.setAttribute('for', id);
    var i = document.createElement('input');
    i.type = type; i.id = id; i.value = value || ''; i.autocomplete = 'off';
    wrap.appendChild(l);
    wrap.appendChild(i);
    return wrap;
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

  function handle(res) {
    if (res && res.needsPin) {
      try { window.localStorage.removeItem('checkInPin'); } catch (err) { /* ignore */ }
      pin = '';
      say(res.message || 'Wrong PIN.', 'err');
      return showPin();
    }
    say((res && res.message) || 'Something went wrong — nothing was recorded.', 'err');
  }

  function setBusy(v) { busy = v; }

  var hideTimer = null;
  function say(text, kind) {
    var box = document.getElementById('status');
    box.textContent = text || '';
    box.className = 'show' + (kind ? ' ' + kind : '');
    if (hideTimer) window.clearTimeout(hideTimer);
    if (kind === 'ok') hideTimer = window.setTimeout(hideStatus, 6000);
  }

  function hideStatus() {
    var box = document.getElementById('status');
    box.className = '';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  start();
</script>
`;
}
