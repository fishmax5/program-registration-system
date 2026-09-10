// ============================================================================
// 16g. THE DOOR APP'S PAGE  (setup, the events, the names, the person, walk-in)
// ============================================================================
//
// One served page with five screens and one address. What each screen is for
// is in the section note of 72_door_app.gs; what is worth knowing HERE is why
// it is one page rather than five:
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
//
// THE FIRST QUESTION IS ASKED OF THE MEMBER, NOT OF THE TABLET. "What are you
// here for today?" — every event on at this building today, nothing ticked,
// tapped by the person standing in front of it. It is not a setup step and it
// is not a filter a volunteer sets in the morning: it is the first thing each
// person does, and it resets for the next one the moment a sign-in is away.
//
// WHY THAT ORDER. Asking it first is what makes the rest of the visit short.
// The name list that follows holds only the people expected at what they just
// tapped — one class instead of two hundred names — and what they tapped is
// already ticked on the confirm screen, so the whole visit is: what I am here
// for, my name, Confirm. Asking it the other way round (find your name, then
// correct a screen of everything the building is doing) is the same three taps
// spent on a longer list.
//
// HERE_FOR is that answer and PICKED is what the confirm screen holds; they
// start the same and part company the moment somebody changes a tick, which is
// why going back to the list does not lose what they said at the door.
//
// AND THE NAME LIST HAS THREE SECTIONS. Registered for what they tapped;
// under them the people who came to those same programs in the last two months
// and have not registered for today (DAY.past, built by foldPastRegistrants()
// in section 16h) — a weekly class has the same eight people in it every week
// and half of them have never filled in a form; then the search box, with the
// walk-in sign-up inside it. Staff can get past the question entirely with
// "Show everyone here today", for the person who cannot work out which class
// is theirs.
//
// WHAT IS NO LONGER HERE: the membership application. It was a fifth screen
// drawn from the office's own Google Form and submitted back through the Forms
// API; a membership application is not a thing to fill in standing at a door
// with a queue behind you, and "not a member yet" is now one note filed for the
// office (recordMembershipHandoff(), 72_door_app.gs). The question itself is
// still asked on the walk-in screen — it is the only place anybody ever asks
// it.
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
  var STEP = 'setup';      // setup -> events -> names -> person | walkin
  var PERSON = null;       // { name, key, isNew, phone, email, registered[], ... }
  var PICKED = {};         // session value -> true — the CONFIRM screen's ticks
  var LUNCH = false;
  // WHAT THE PERSON AT THE DOOR SAID THEY ARE HERE FOR: session value -> true.
  // Answered on the first screen, read by the name list (which sections it
  // filters) and by the confirm screen (which ticks it starts with), and
  // emptied after every sign-in — it is one person's answer about one visit,
  // never a setting.
  var HERE_FOR = {};
  // The staff way past that question: the whole day's names, unfiltered. Also
  // cleared per visit, because it is an answer about one person too.
  var SHOW_ALL = false;
  // WHICH OF THIS PERSON'S HOUSEHOLD IS BEING SIGNED IN WITH THEM: member key
  // -> true. Ticked by default for anyone the workbook expects today and has
  // not already marked present — the couple who always arrive together are the
  // reason this exists, and making them tap twice would be the same two taps
  // as before. Cleared on every choose(), because it is about one visit.
  var PARTY = {};
  var RECURRING = 'none';  // none | month | club
  // WHAT HAS BEEN TYPED INTO THE WALK-IN FORM, held outside the DOM. Picking a
  // radio redraws the whole screen (one render function, one truth about what
  // is selected), and a redraw that emptied the name box somebody had just
  // filled in would be the page losing their answer for them.
  var WALKIN = { name: '', email: '', phone: '' };
  // yes | no. The only thing 'no' does is file a note for the office (see
  // recordMembershipHandoff()); there is no application screen behind it.
  var MEMBER = '';
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
    STEP = 'events';
    loadDay();
  }

  function openSetup() {
    STEP = 'setup';
    startNextPerson();
    hideStatus();
    draw();
  }

  /**
   * BACK TO AN EMPTY SCREEN FOR WHOEVER IS NEXT. Everything on this page is
   * about ONE person's visit — what they are here for, who is with them,
   * whether they are a member — so every one of those is cleared between
   * people. A tick left behind is the next person signed in for somebody
   * else's class, and nobody at a door would ever spot it.
   */
  function startNextPerson() {
    PERSON = null; PICKED = {}; LUNCH = false; PARTY = {};
    HERE_FOR = {}; SHOW_ALL = false;
    RECURRING = 'none'; MEMBER = '';
    WALKIN = { name: '', email: '', phone: '' };
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
      if (!screenIsIdle()) { PENDING = res.day; return; }
      DAY = res.day;
      draw();
    });
  }

  /**
   * IS IT SAFE TO PUT A NEW DAY ON THE SCREEN? Only where nothing is half
   * answered: the name list with nobody chosen, or the "what are you here
   * for" screen before the first tick. A list that reflows under a thumb on
   * its way to a name is how the wrong person gets signed in, and a tick that
   * vanishes mid-answer is worse.
   */
  function screenIsIdle() {
    if (PERSON) return false;
    if (STEP === 'names') return true;
    return STEP === 'events' && !Object.keys(HERE_FOR).length;
  }

  // --------------------------------------------------------------------- draw
  function draw() {
    if (PENDING && screenIsIdle()) { DAY = PENDING; PENDING = null; }
    var main = document.getElementById('app');
    var setupBtn = document.getElementById('setupbtn');
    main.innerHTML = '';
    document.getElementById('subheading').textContent = (STEP === 'setup' || !SETUP)
      ? 'Set up this tablet'
      : (SETUP.location + ' — ' + ((DAY && DAY.dateLabel) || SETUP.dateKey));
    if (STEP === 'setup' || !SETUP) { setupBtn.classList.add('hide'); return drawSetup(main); }
    setupBtn.classList.remove('hide');
    if (!DAY) return drawEmpty(main);
    if (STEP === 'events') return drawEvents(main);
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

  // SCREEN 2 — THE FIRST QUESTION, AND IT IS ASKED OF THE PERSON.
  //
  // EVERY EVENT, WHETHER OR NOT ANYBODY IS REGISTERED FOR IT. A drop-in with
  // no form has no registrations by definition, and a class whose form went
  // out yesterday may have none yet — an event missing from this screen is a
  // person who cannot say why they came.
  //
  // NOTHING IS TICKED TO BEGIN WITH. This is a question, not a filter with a
  // default: a screen that arrives with four things already ticked is a screen
  // somebody taps Continue on, and then everybody is signed in for everything.
  function drawEvents(main) {
    if (DAY.dateKey !== OPTS.todayKey) main.appendChild(offDayBanner());
    main.appendChild(el('h2', '', 'What are you here for today?'));
    main.appendChild(el('p', 'hint',
      'Tap everything you are here for, then find your name on the next screen.'));

    var choices = eventChoices();
    var list = el('ul', 'list', '');
    choices.forEach(function (choice) { list.appendChild(eventChoiceItem(choice)); });
    if (!choices.length) {
      list.appendChild(el('p', 'hint',
        'Nothing is on at ' + DAY.location + ' on ' + DAY.dateLabel + '. ' +
        'You can still sign in — tap the button below.'));
    }
    main.appendChild(list);

    var go = button('big', choices.length ? 'Continue' : 'Find my name', function () {
      if (choices.length && !hereForCount()) {
        return say('Tap what you are here for first.', 'err');
      }
      hideStatus();
      SHOW_ALL = !choices.length;
      STEP = 'names';
      draw();
      window.scrollTo(0, 0);
    });
    go.id = 'go';
    main.appendChild(go);

    // THE WAY PAST THE QUESTION, and it is deliberately the quiet button. It
    // is for the person who cannot work out which of two classes is theirs and
    // for the volunteer helping them — not the path a queue takes, because the
    // whole point of the question above is the short list it produces.
    main.appendChild(button('plain', 'Not sure? Show everyone here today', function () {
      HERE_FOR = {};
      SHOW_ALL = true;
      hideStatus();
      STEP = 'names';
      draw();
      window.scrollTo(0, 0);
    }));
    main.appendChild(footer());
  }

  /**
   * The day as a list of things that can be tapped — every program, and the
   * meal if there is one to have. Lunch is on this screen because at this
   * centre it is one of the things people come for, and somebody here only for
   * the meal is somebody with an honest answer to give.
   */
  function eventChoices() {
    var out = [];
    (DAY.programs || []).forEach(function (program) {
      out.push({
        value: program.value,
        title: program.title,
        time: program.time || '',
        byAppointment: !!program.byAppointment
      });
    });
    var lunch = DAY.lunch || {};
    if (lunch.value && lunch.offered) {
      out.push({
        value: lunch.value,
        title: 'Lunch' + (lunch.dish ? ' — ' + lunch.dish : ''),
        time: lunch.type && lunch.type !== 'Not Serving' ? lunch.type : '',
        isLunch: true
      });
    }
    return out;
  }

  /**
   * One event as a tick. NO COUNT OF WHO IS SIGNED UP: this screen is read by
   * members now, and how many people are registered for a class is an internal
   * number that answers no question the person tapping it has.
   */
  function eventChoiceItem(choice) {
    var on = isHereFor(choice.value);
    var li = el('li', 'item' + (on ? ' on' : ''), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on;
    box.disabled = busy;
    box.onchange = function () {
      if (box.checked) HERE_FOR[choice.value] = true; else delete HERE_FOR[choice.value];
      li.className = 'item' + (box.checked ? ' on' : '');
    };
    var what = el('div', 'what', '');
    var meta = [];
    if (choice.time) meta.push(choice.time);
    // Said here as well as on the confirm screen, because somebody who taps an
    // appointment program and then finds they cannot be booked into it has
    // been sent round a loop the door could have opened flat.
    if (choice.byAppointment) meta.push('Booked by appointment — see a staff member');
    what.innerHTML = '<span class="title">' + esc(choice.title) + '</span>' +
      (meta.length ? '<span class="meta' + (choice.byAppointment ? ' warn' : '') + '">' +
        esc(meta.join(' · ')) + '</span>' : '');
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
  }

  function isHereFor(value) { return !!HERE_FOR[value]; }
  function hereForCount() { return Object.keys(HERE_FOR).length; }

  /** Whether the day's meal is one of the things they said they are here for. */
  function lunchHereFor() {
    var lunch = DAY.lunch || {};
    return !!(lunch.value && isHereFor(lunch.value));
  }

  /** The one banner both the events screen and the name list need. */
  function offDayBanner() {
    return el('div', 'banner',
      'This tablet is set up for ' + DAY.dateLabel + ', which is not today. ' +
      'Everything signed in here is recorded against that date.');
  }

  // SCREEN 3 — everybody expected, A–Z, and the walk-in box under them.
  function drawNames(main) {
    if (DAY.dateKey !== OPTS.todayKey) main.appendChild(offDayBanner());

    // WHAT THIS LIST IS OF, AND ONE TAP BACK TO CHANGING IT. Said in words
    // rather than left to be inferred from who is missing: a filtered list
    // and an empty one look identical to somebody who does not know a filter
    // is on — and the person reading it answered the question a moment ago,
    // so it is also how they check the tablet heard them.
    main.appendChild(button('plain', SHOW_ALL
      ? 'Everybody here today · Choose what you are here for'
      : 'Here for ' + whatIsShowing() + ' · Change',
      function () { STEP = 'events'; hideStatus(); draw(); window.scrollTo(0, 0); }));

    main.appendChild(el('h2', '', 'Tap your name'));
    var people = (DAY.people || []).filter(personIsSelected).sort(function (a, b) {
      var d = sortKey(a.name).localeCompare(sortKey(b.name));
      return d || a.name.localeCompare(b.name);
    });
    if (people.length) {
      main.appendChild(el('p', 'hint', 'Signed up for ' + whatIsShowing() + '.'));
      drawNameGrid(main, people);
    } else {
      main.appendChild(el('p', 'hint',
        'Nobody is signed up for ' + whatIsShowing() + '. ' +
        'Look below, or sign in as a walk-in.'));
    }

    // SECTION 2 — THE REGULARS. Somebody who has been to these same programs
    // in the last two months and is not down for today: the drop-in class
    // nobody registers for, the member who always just turns up. Tapping one
    // is the same personal screen as anybody else's, already ticked for what
    // this tablet is for — which is what it takes the place of, a volunteer
    // typing a name they have known for years into the walk-in box every week.
    var past = (DAY.past || []).filter(pastIsSelected).sort(function (a, b) {
      var d = sortKey(a.name).localeCompare(sortKey(b.name));
      return d || a.name.localeCompare(b.name);
    });
    if (past.length) {
      main.appendChild(el('h2', '', 'Here recently'));
      main.appendChild(el('p', 'hint',
        'Came to ' + whatIsShowing() + ' in the last two months, and is not signed up for ' +
        'today. Tap a name to sign in.'));
      drawNameGrid(main, past.map(pastPerson));
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
    walk.appendChild(button('big', 'Sign in as a walk-in', function () { startWalkIn(''); }));
    main.appendChild(walk);
    main.appendChild(footer());
  }

  /**
   * LETTER HEADINGS, off the surname — which is how a list of people is read,
   * and the only thing that makes a screen of eighty names usable without a
   * search. Shared by both sections, so the regulars underneath are scanned
   * exactly the way the registered names above them are.
   */
  function drawNameGrid(main, people) {
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
  }

  /** What the sections are about, in the words the person tapped. */
  function whatIsShowing() {
    if (SHOW_ALL) return 'anything at ' + DAY.location + ' on ' + DAY.dateLabel;
    var names = eventChoices()
      .filter(function (choice) { return isHereFor(choice.value); })
      .map(function (choice) { return choice.title; });
    if (!names.length) return 'nothing yet';
    if (names.length > 3) return names.length + ' things';
    return names.join(', ');
  }

  /**
   * IS THIS PERSON ONE OF THE ONES THIS TABLET IS FOR? Their own sessions, or
   * their meal if the meal is ticked — and a host counts for anything one of
   * their guests holds, because a party is signed in on one card and hiding
   * the host would hide the guest with them.
   */
  function personIsSelected(p) {
    if (SHOW_ALL) return true;
    if (lunchHereFor() && p.lunchRegistered) return true;
    if ((p.registered || []).some(isHereFor)) return true;
    return (p.guests || []).some(function (g) {
      return (lunchHereFor() && g.lunchRegistered) || (g.registered || []).some(isHereFor);
    });
  }

  /** The same question of a regular, asked of the programs they used to come to. */
  function pastIsSelected(entry) {
    if (SHOW_ALL) return true;
    return (entry.values || []).some(isHereFor);
  }

  /**
   * A REGULAR AS A PERSON THE REST OF THIS PAGE UNDERSTANDS. They hold no rows
   * today, so their registered list is empty and every screen after this treats
   * them as the walk-in they are — what they carry instead is "was", the sessions
   * they used to come to, which is what choose() ticks for them.
   */
  function pastPerson(entry) {
    return {
      name: entry.name, key: entry.key, phone: entry.phone || '',
      registered: [], attended: [], household: [], guests: [],
      lunchRegistered: false, here: false,
      was: (entry.values || []).slice(),
      lastLabel: entry.lastLabel || ''
    };
  }

  /**
   * Sorted and headed on the LAST WORD OF THE NAME — the surname, usually.
   *
   * A TRAILING PARENTHETICAL IS NOT PART OF THE NAME. Somebody typed into a
   * registration as "Robert Klein (wheelchair)" or "Jane Doe (grandmother)"
   * still surnames Klein and Doe — the parenthetical is a note that rode along
   * on the name field, and without stripping it first, sortKey() would read it
   * as the last word and file the card under "(" instead of under K or D.
   */
  function sortKey(name) {
    var stripped = String(name || '').replace(/\\s*\\([^()]*\\)\\s*$/, '').trim();
    var parts = (stripped || String(name || '').trim()).split(/\\s+/);
    return (parts.length ? parts[parts.length - 1] : String(name || '')).toUpperCase();
  }

  function drawSearchResults() {
    var typed = document.getElementById('search').value.trim();
    var needle = typed.toLowerCase();
    var box = document.getElementById('results');
    box.innerHTML = '';
    if (needle.length < 2) return;
    // MATCHED ON EVERY SPELLING, not just the one on the row: the search field carries
    // the nickname a form's parenthetical was holding ("Robert (Bob) Kaplan"),
    // so a volunteer typing what they actually call somebody finds them. See
    // memberSearchNames() in 77_households_and_names.gs.
    var hits = (DAY.members || []).filter(function (m) {
      var hay = m.search || m.name.toLowerCase();
      return hay.indexOf(needle) !== -1;
    }).slice(0, 24);
    if (!hits.length) {
      box.appendChild(el('p', 'hint', 'No member matches "' + typed + '".'));
      // ONE TAP INTO THE WALK-IN FORM, NAME ALREADY IN IT. The old path made
      // someone who typed a name and got no match scroll to the walk-in box,
      // tap it, and retype the name they had just typed — WALKIN.name was
      // reset to '' on that tap regardless of what was in the search box.
      // Carrying the typed text straight into WALKIN here is what removes that.
      box.appendChild(button('big', 'Sign in as a walk-in: ' + typed, function () {
        startWalkIn(typed);
      }));
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
    // A REGULAR SAYS WHEN, AND WHAT FOR. Without it the card is a bare name in
    // a section headed "Here recently", which reads as a claim the workbook
    // cannot make about today — this is the evidence behind the offer.
    if (!(p.registered || []).length && (p.was || []).length) {
      bits.push('Not signed up today — usually ' + p.was.map(titleOf).join(', '));
      if (p.lastLabel) bits.push('last here ' + p.lastLabel);
    }
    // GUESTS LIVE UNDER THE MEMBER WHO BROUGHT THEM (see readWalkInDay()'s
    // guest-folding), not as cards of their own — one line here says who else
    // is in the party, and tapping this card signs the whole party in.
    if ((p.guests || []).length) {
      bits.push('with ' + (p.guests.length === 1 ? 'guest' : 'guests') + ': ' +
        p.guests.map(function (g) { return g.name; }).join(', '));
    }
    // AN ORPHAN GUEST — the host is not expected today, so there is no party
    // to fold this card into. Labelled rather than left to read as a stranger.
    if (p.guestOf) bits.push('guest of ' + p.guestOf);
    // The household on the card as well as on the screen behind it, so a
    // volunteer scanning the list can see that finding one of them is enough.
    if ((p.household || []).length) {
      bits.push('with ' + p.household.map(function (m) { return m.name; }).join(', '));
    }
    b.innerHTML = esc(p.name) + (bits.length ? '<span class="meta">' + esc(bits.join(' · ')) + '</span>' : '');
    b.onclick = function () { choose(p); };
    return b;
  }

  function choose(p) {
    PERSON = p;
    // WHAT THEY SAID AT THE DOOR, CROSSED WITH WHAT THE WORKBOOK EXPECTS OF
    // THEM. Somebody registered for Chair Yoga who tapped Chair Yoga two
    // screens ago has answered this question twice already; the screen is a
    // CONFIRMATION of that, with every tick live so changing one is the same
    // tap. A person registered for four things today is not asked which — they
    // told the door on the way in.
    //
    // FOUR FALLBACKS, IN ORDER, AND NONE OF THEM LEAVES THE SCREEN EMPTY: what
    // they are registered for out of what they tapped; what a regular usually
    // comes to out of what they tapped (they hold no rows today — this is what
    // the "Here recently" section signs somebody in for); what they tapped,
    // for somebody found through the search box who is registered for none of
    // it; and then their own registrations. A confirm screen with nothing on
    // it is a person told to see a staff member for no reason.
    PICKED = {};
    (p.registered || []).forEach(function (v) { if (isHereFor(v)) PICKED[v] = true; });
    if (!Object.keys(PICKED).length) {
      (p.was || []).forEach(function (v) { if (isHereFor(v)) PICKED[v] = true; });
    }
    if (!Object.keys(PICKED).length) {
      Object.keys(HERE_FOR).forEach(function (v) { PICKED[v] = true; });
    }
    if (!Object.keys(PICKED).length) {
      (p.registered || []).forEach(function (v) { PICKED[v] = true; });
    }
    // LAST OF ALL, WHAT THEY USUALLY COME TO. Only reachable through "Show
    // everyone here today", where nothing was tapped at the door and a regular
    // holds no rows for today — without this that person's confirm screen is
    // blank and Confirm refuses, which is the one path this screen must not
    // have.
    if (!Object.keys(PICKED).length) {
      (p.was || []).forEach(function (v) { PICKED[v] = true; });
    }
    LUNCH = !!p.lunchRegistered || lunchHereFor();
    PARTY = {};
    (p.household || []).forEach(function (m) {
      if (m.expected && !m.here) PARTY[m.key] = true;
    });
    RECURRING = 'none';
    MEMBER = '';
    STEP = 'person';
    draw();
    window.scrollTo(0, 0);
  }

  // SCREEN 4 — one person: everything they are down for today, to confirm.
  function drawPerson(main) {
    main.appendChild(el('h2', '', 'Hello, ' + PERSON.name));
    main.appendChild(el('p', 'hint', (PERSON.registered || []).length
      ? 'This is what you are down for on ' + DAY.dateLabel +
        '. Change anything that is wrong, then confirm.'
      : 'You are not signed up for anything on ' + DAY.dateLabel + ' yet — ' +
        'what this tablet is for is ticked below. Change anything that is wrong, then confirm.'));
    // CONFIRMING FOR THE WHOLE PARTY. A guest nested under this person has no
    // screen of their own — tapping "Confirm and sign in" below signs them in
    // too, for whatever they are down for with this person (see walkInSignIn()).
    if ((PERSON.guests || []).length) {
      main.appendChild(el('p', 'hint',
        'Signing in with ' + PERSON.guests.map(function (g) { return g.name; }).join(', ') + '.'));
    }

    var list = el('ul', 'list', '');
    (DAY.programs || []).forEach(function (program) { list.appendChild(programItem(program)); });
    if (!(DAY.programs || []).length) {
      list.appendChild(el('p', 'hint', 'No programs are on at ' + DAY.location + ' that day.'));
    }
    main.appendChild(list);

    // THE HOUSEHOLD, AFTER THE PROGRAMS AND BEFORE THE MEAL. A couple arrive
    // together and are two members with two sets of rows; this is the one tap
    // that stops the volunteer scrolling back up the alphabet to do the second
    // one. Each is signed in for WHAT THEY THEMSELVES ARE DOWN FOR — the ticks
    // above are this person's, not the household's — except somebody the
    // workbook is not expecting today, who comes in on the ticks above because
    // there is nothing else to put them on.
    if ((PERSON.household || []).length) {
      main.appendChild(el('h3', '', 'Signing in with'));
      var party = el('ul', 'list', '');
      PERSON.household.forEach(function (m) { party.appendChild(householdItem(m)); });
      main.appendChild(party);
    }

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

  /**
   * INTO THE WALK-IN SCREEN, WITH WHAT THIS TABLET IS FOR ALREADY TICKED.
   *
   * They answered it two screens ago: a walk-in has already said what they are
   * here for, and asking again — on a list of everything the building is doing
   * — is the door making somebody who is not on any list work hardest. The
   * lunch tick comes across too, because tapping "Lunch" on the first screen IS
   * asking for one; the meal line still says plainly that meals are ordered
   * days ahead and a late one has to be checked with staff (lunchItem()).
   *
   * The name argument is whatever was typed into the search box before it came
   * up empty, so nobody types their own name twice.
   */
  function startWalkIn(name) {
    PERSON = null; PARTY = {}; RECURRING = 'none'; MEMBER = '';
    PICKED = {};
    var lunchValue = (DAY && DAY.lunch) ? DAY.lunch.value : '';
    Object.keys(HERE_FOR).forEach(function (value) {
      if (value !== lunchValue) PICKED[value] = true;
    });
    LUNCH = lunchHereFor();
    WALKIN = { name: name || '', email: '', phone: '' };
    STEP = 'walkin';
    hideStatus();
    draw();
    window.scrollTo(0, 0);
  }

  // SCREEN 5 — a walk-in: what they are here for, then who they are.
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
      'You can sign in and join today either way. The office will be told to send you a ' +
      'membership application.',
      MEMBER === 'no', function (v) { MEMBER = v; }));
    main.appendChild(mem);

    var go = button('big', 'Sign in', submitWalkIn);
    go.id = 'go';
    go.disabled = busy;
    main.appendChild(go);
    main.appendChild(button('plain', 'Back to the name list', function () {
      stashWalkIn();
      STEP = 'names';
      draw();
    }));
  }

  /**
   * One household member as a tick. Somebody already marked present is shown
   * and NOT tickable — signing them in twice is not a thing the door should
   * offer, and hiding them would leave the volunteer wondering where the wife
   * went.
   */
  function householdItem(m) {
    var locked = busy || !!m.here;
    var li = el('li', 'item' + (m.here ? ' off' : (PARTY[m.key] ? ' on' : '')), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!PARTY[m.key] && !m.here;
    box.disabled = locked;
    box.onchange = function () {
      if (box.checked) PARTY[m.key] = true; else delete PARTY[m.key];
      li.className = 'item' + (box.checked ? ' on' : '');
    };
    var what = el('div', 'what', '');
    var tag = m.here ? '<span class="tag yes">SIGNED IN</span>'
      : (m.expected ? '<span class="tag yes">EXPECTED</span>'
        : '<span class="tag no">NOT REGISTERED</span>');
    var meta = [];
    if (m.here) meta.push('Already signed in today.');
    else if ((m.registered || []).length) meta.push((m.registered || []).map(titleOf).join(', '));
    else if (m.expected) meta.push('Down for lunch only.');
    else meta.push('Not down for anything today — ticking this signs them in for the same sessions.');
    if (m.lunchRegistered) meta.push('lunch ordered');
    what.innerHTML = tag + '<span class="title">' + esc(m.name) + '</span>' +
      '<span class="meta">' + esc(meta.join(' — ')) + '</span>';
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
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
    // EACH COMPANION SIGNS IN AS THEMSELVES — their own sessions, their own
    // meal (see doorSignIn()). Only somebody the workbook is not expecting
    // today falls back to this person's ticks, which is the walk-in case
    // wearing a household's clothes: they came along, so put them where the
    // person who brought them is going.
    var party = [];
    (PERSON.household || []).forEach(function (m) {
      if (!PARTY[m.key] || m.here) return;
      var theirs = (m.registered || []).slice();
      party.push({
        name: m.name,
        phone: m.phone || '',
        email: '',
        newMember: false,
        programs: theirs.length ? theirs : programs,
        lunch: !!m.lunchRegistered
      });
    });
    send({
      name: PERSON.name,
      phone: PERSON.phone || '',
      email: PERSON.email || '',
      newMember: false,
      programs: programs,
      lunch: !!LUNCH,
      recurring: 'none',
      member: '',
      party: party
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

  /**
   * OPTIMISTIC. doorSignIn() is still a synchronous call under the hood —
   * google.script.run has no true fire-and-forget from a browser — but
   * nobody standing at a tablet should be made to wait through its lock
   * waits and sheet writes to see anything happen. So this hands the tablet
   * back NOW, showing the sign-in as done, and lets the real write finish
   * underneath whatever screen comes next.
   *
   * A visitor who just said they are not a member yet goes back to the name
   * list like anybody else; the office hears about them from the server (see
   * recordMembershipHandoff()), and there is nothing for them to fill in here.
   *
   * If the write actually fails, the visitor has already moved on by the
   * time anyone could know — so this does not surface an error on the
   * tablet at all. doorSignIn() (section 16f) catches that server-side and
   * emails staff through notifyAdminUrgent() instead, which runs to completion
   * whether or not the tablet is still listening. needsPin is the one
   * exception: a stale PIN fails every sign-in after this one, not just
   * this visitor's, so it still interrupts with the PIN screen.
   */
  function send(payload) {
    payload.location = SETUP.location;
    payload.dateKey = SETUP.dateKey;
    payload.pin = pin;
    var name = payload.name || '';
    var notAMember = payload.member === 'no';

    var partyNames = (payload.party || []).map(function (p) { return p.name; });
    // BACK TO THE FIRST QUESTION, EMPTY. The next person in the queue is a
    // different visit — and a tablet left on the last person's ticks is the
    // one way this page could sign somebody in for a class they never named.
    startNextPerson();
    STEP = 'events';
    draw();
    window.scrollTo(0, 0);
    // THE ONE THING A NON-MEMBER IS TOLD, and it is a promise about somebody
    // else's day rather than a form to fill in: the office has their name and
    // their number and will send them an application.
    say('✅ Signed in — ' + name +
      (partyNames.length ? ' with ' + partyNames.join(', ') : '') +
      (notAMember ? '. The office will send you a membership application.' : ''), 'ok');

    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.needsPin) {
          try { window.localStorage.removeItem('checkInPin'); } catch (err) { /* ignore */ }
          pin = '';
          STEP = 'events';
          draw();
          say(res.message || 'Wrong PIN — ask a staff member to sign back in.', 'err');
          return showPin();
        }
        // Success is already on screen; a real failure was staff's problem
        // the moment it happened (doorSignIn emailed it), not the tablet's.
        // Re-read quietly so the next person in the queue sees this one as
        // signed in, same as before.
        syncDay();
      })
      .withFailureHandler(function () {
        // Reported server-side already (see doorSignIn's own try/catch) for
        // anything that got that far; a transport failure this raw never
        // reached the server at all, and there is nothing left to tell.
      })
      .doorSignIn(JSON.stringify(payload));
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
