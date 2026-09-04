// ============================================================================
// 6d. QUICK MARK  (the sign-in desk tool, on the menu)
// ============================================================================
//
// Marking people off on a serving day is the highest-frequency job in this
// workbook and was the worst served: find the right one of hundreds of rows,
// scroll right, tick two boxes, don't lose your place. The tab is sorted by
// date, so a given program's people aren't even contiguous.
//
// Quick Mark is a dialog off the menu: Location -> Session -> Name, each list
// narrowed by the one before it, then Attended and/or Lunch. Pick, mark, and
// the matching registrant row is updated in place wherever it happens to be —
// the dialog stays open and resets to the same session, because the real job
// is thirty people in a row, not one.
//
// IT USED TO LIVE ON THE SHEET, as a band of cells frozen above the tables,
// and every part of that was a fight with Sheets rather than with the problem:
// the panel had to be written and re-written on every render, its dropdowns
// rebuilt cell by cell through data validations, its feedback squeezed into
// one overflowing cell, its state carried in cells anybody could type over,
// and its every keystroke routed through onEdit — which also meant a stray
// paste over row 3 ran a marking action. A dialog has real controls, real
// lists, real feedback, and no ability to be clobbered by a paste. The panel
// rows are gone; the tables now start at row 1.
//
// ATTENDED AND LUNCH ARE INDEPENDENT, and that is the whole vocabulary. A
// member can pick up a take-out meal without ever attending, so Lunch on its
// own means exactly that: lunch served, not present. There is no separate
// "Lunch Only" option any more — it said the same thing as a Lunch tick with
// Attended left clear, and two ways to say one thing is two ways to get it
// wrong. Ticking Lunch alone now also CLEARS Attended, which is what makes it
// a correction as well as a record ("I marked her present, she only collected
// a meal").
//
// The lists narrow with each selection, because a static list of every name in
// the workbook is not a usable list once there are hundreds — narrowing is the
// entire value. But the NARROWING IS DONE IN THE BROWSER, over one index
// fetched when the dialog opens (buildQuickMarkIndex()). It used to be a
// server call per step, each re-reading whole tabs, which put a wait between
// every pick — thirty times over at a sign-in desk, which is what made the
// tool too slow to be worth opening. Only pressing Mark talks to the sheet
// now.
//
// AND THE DIALOG NO LONGER WAITS FOR THAT ONE FETCH EITHER. Three things, in
// the order a person notices them:
//
//   1. The LOCATIONS are drawn before anything is fetched. There are three of
//      them and they are a constant in this file (CALENDAR_MAP) — spending a
//      five-tab read to find that out was the whole of "it takes twenty
//      seconds just to load the three locations".
//   2. The lists TRAVEL INSIDE THE DIALOG'S OWN MARKUP. The page paints with
//      its dropdowns already populated and makes no server call at all until
//      somebody presses Mark — every google.script.run being a round trip of
//      its own, and the dialog's whole job on opening having been to make one.
//   3. What gets inlined is a PRE-BUILT index, kept both in CacheService and
//      on a hidden tab (QUICK_MARK_INDEX_SHEET_NAME), rebuilt in the
//      background at the end of every registrations sync
//      (warmQuickMarkIndexCache()) — so the read is paid for on a trigger with
//      nobody waiting, not at the desk with a queue. Opening the dialog is
//      never allowed to trigger a rebuild (readyQuickMarkIndex()).
//   4. Building it reads each tab ONCE (readAllSectionedRowValues()) instead
//      of three times, for the times it does have to be built.
// ============================================================================

/** Menu entry: opens the Quick Mark dialog. */
function showQuickMarkDialog() {
  // isDeskWorkBlocked(), not isBootstrapActive(): a forms sweep is no reason to
  // shut the sign-in desk. See isDeskWorkBlocked().
  if (isDeskWorkBlocked()) {
    toastIfPossible(deskBusyMessage());
    return;
  }
  // THE LISTS TRAVEL WITH THE PAGE. Every google.script.run costs a round trip
  // of its own — a second or two before the browser has even asked its
  // question — and the dialog's whole job on opening is to have the lists.
  // Handing them over inside the markup removes that call entirely: the
  // dropdowns are populated in the same paint as the dialog itself.
  //
  // Only ever a STORED index, never a fresh build (readyQuickMarkIndex()):
  // opening the dialog must not be the thing that pays for a rebuild, because
  // that is a modal with a spinner in front of a queue. A workbook with no
  // stored index yet gets null here and the dialog fetches as it always did.
  const html = HtmlService.createHtmlOutput(buildQuickMarkHtml(readyQuickMarkIndex()))
    .setWidth(560)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Quick Mark');
}

/**
 * The stored index if there is one to hand, null otherwise — never a build.
 *
 * The distinction from getQuickMarkIndex() is the whole point: that one is
 * allowed to take twenty seconds because something asked it for an answer.
 * This one is called while a modal is opening, where the honest answer to "is
 * it ready?" is sometimes no.
 */
function readyQuickMarkIndex() {
  try {
    return readCachedQuickMarkIndex() || readSheetQuickMarkIndex();
  } catch (err) {
    log(`ℹ️ Could not read the stored Quick Mark lists while opening the dialog (${err}).`);
    return null;
  }
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * The lists are fetched rather than baked in: the session list depends on the
 * chosen location and the name list on the chosen session, and a dialog that
 * shipped all three cross-products would be most of the workbook.
 */
function buildQuickMarkHtml(preloadedIndex) {
  // The locations are handed over as DATA rather than baked into the markup:
  // the index that arrives a moment later is what fills the dropdown, and one
  // list built one way is one list to keep right.
  const locations = JSON.stringify(Object.values(CALENDAR_MAP).filter((v, i, a) => a.indexOf(v) === i));
  // The shared vocabulary and the recurrence words, handed over as DATA for
  // the same reason the locations are: one list, defined once, so the dropdown
  // on the tab and the dropdown in the dialog cannot drift apart.
  const needPresets = JSON.stringify(REGULAR_NEED_PRESETS);
  const needFrequencies = JSON.stringify(REGULAR_NEED_FREQUENCIES);
  const needWeekdays = JSON.stringify(REGULAR_NEED_WEEKDAYS);
  // The lists themselves, when there is a stored copy — see
  // showQuickMarkDialog(). JSON.stringify twice over: once to make the data,
  // once to make it a STRING LITERAL that cannot break out of the <script>
  // block. A name with a quote in it, or the two-character sequence that ends
  // a script tag, would otherwise end the page mid-sentence.
  const inlineIndex = preloadedIndex
    ? JSON.stringify(JSON.stringify(preloadedIndex)).replace(/<\//g, '<\\/')
    : 'null';

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 4px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
  label.field { display: block; font-weight: bold; margin: 10px 0 3px 0; }
  select, input[type=text] { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; }
  select[disabled], input[disabled] { background: #F1F3F4; color: #80868B; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin: 14px 0 0 0; padding: 8px 10px; }
  legend { font-weight: bold; padding: 0 4px; }
  label.tick { display: block; padding: 3px 0; }
  label.tick span.note { color: #666; font-weight: normal; }
  /* A tick that qualifies the one above it rather than standing on its own —
     indented to the same 22px the meal boxes use, so the shape of the answer
     is visible before anything is read. */
  label.tick.sub { padding-left: 22px; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 9px 18px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; } .busy { color: #666; font-weight: normal; }
  #log { margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px; color: #444; font-size: 12px; }
  #log div { padding: 1px 0; }
  #freshness { color: #666; font-size: 11px; margin-top: 3px; }
  #freshness a { color: #1A73E8; cursor: pointer; text-decoration: underline; }
  button.secondary { background: #fff; color: #1A73E8; border: 1px solid #DADCE0; }
  #needs { margin-top: 8px; }
  #needs .need { background: #FEF7E0; border-left: 3px solid #F9AB00; border-radius: 3px;
                 padding: 5px 8px; margin: 3px 0; font-size: 12px; line-height: 1.4; }
  #needs .need b { font-size: 13px; }
  #needs .need span.when { color: #666; }
  #needs a.add { color: #1A73E8; cursor: pointer; text-decoration: underline; font-size: 12px; }
  #needDays label { display: inline-block; margin-right: 8px; font-size: 12px; }
  .meals { margin: 2px 0 8px 22px; padding: 6px 8px; background: #F1F3F4; border-radius: 3px; }
  .meals label.num { display: inline-block; margin-right: 10px; font-size: 12px; }
  .meals input[type=number] { width: 52px; margin-left: 4px; padding: 2px 4px; }
</style>
<h3>Quick Mark</h3>
<p class="hint">
  Pick a location, then the session, then a person. Tick <b>Attended</b> for someone who came in;
  tick <b>Lunch</b> on its own for a meal collected without attending; tick <b>Register them</b> to
  put somebody on a session they have not signed up for — over the phone or at the desk, with no
  form. The dialog stays open on the same session, so a queue of people is one pick and one click
  each.<br>
  <b>Full?</b> Tick <b>Add to waitlist</b> instead of registering them. It works on somebody already
  on the list as well — that gives their seat and their lunch back — and staff take them off the
  waitlist on the Registrants tab when a place comes free.<br>
  <b>More than one meal?</b> Ticking <b>Lunch</b> opens boxes for how many they ate here and how many
  they took home; ticking <b>Sign up for lunch</b> opens one for how many meals to order.
</p>

<label class="field" for="location">1. Location</label>
<select id="location" onchange="locationChanged()">
  <option value="">— choose a location —</option>
</select>
<div id="freshness"></div>

<label class="field" for="session">2. Session (soonest first)</label>
<select id="session" onchange="sessionChanged()" disabled>
  <option value="">— choose a location first —</option>
</select>

<label class="field" for="name">3. Name</label>
<select id="name" onchange="nameChanged()" disabled>
  <option value="">— choose a session first —</option>
</select>
<label class="tick" id="householdLabel" style="display:none">
  <input type="checkbox" id="household" onchange="refreshButton()"> 👪 Mark the whole household
  <span class="note" id="householdNote"></span></label>
<label class="field" for="newName" id="newNameLabel" style="display:none">Name of the walk-in</label>
<input type="text" id="newName" placeholder="Type their name" style="display:none" autocomplete="off"
       oninput="refreshButton()">

<label class="tick" id="moveLabel" style="display:none">
  <input type="checkbox" id="moveTime" onchange="showAppointmentTimes(); refreshButton()"> 🕐 Move them to a different time
  <span class="note">— they rang to reschedule, or turned up for the wrong slot</span></label>
<label class="field" for="apptTime" id="apptTimeLabel" style="display:none">4. Appointment time</label>
<select id="apptTime" onchange="refreshButton()" style="display:none">
  <option value="">— choose a time —</option>
</select>
<p class="hint" id="apptNote" style="display:none">
  This program is booked by appointment. Times already taken are not listed.
</p>
<label class="tick" id="earlierLabel" style="display:none">
  <input type="checkbox" id="earlier" onchange="refreshButton()"> ☎️ Call them if an earlier appointment opens up
  <span class="note">— ask while they are on the phone; it saves ringing round later</span></label>

<div id="needs"></div>

<fieldset id="needBox" style="display:none">
  <legend>Regular need</legend>
  <p class="hint" style="margin:0 0 6px 0">
    A standing fact about this person — "put her meals in the fridge", "no milk", "one meal every
    World Affairs day". It shows here every time they are picked, and lands on the row you mark.
  </p>
  <label class="field" for="needText">What</label>
  <input type="text" id="needText" list="needPresets" placeholder="Pick one, or type your own"
         autocomplete="off" oninput="refreshNeedButton()">
  <datalist id="needPresets"></datalist>

  <label class="field" for="needWhen">When</label>
  <select id="needWhen" onchange="needWhenChanged()"></select>

  <label class="field" for="needDays" id="needDaysLabel" style="display:none">On which days</label>
  <div id="needDays" style="display:none"></div>

  <label class="field" for="needEvery" id="needEveryLabel" style="display:none">Every how many weeks</label>
  <input type="number" id="needEvery" min="1" max="52" value="2" style="display:none">

  <label class="field" for="needDates" id="needDatesLabel" style="display:none">Which dates</label>
  <input type="text" id="needDates" placeholder="16 Sep 2026, 23 Sep 2026" style="display:none"
         autocomplete="off">

  <label class="tick"><input type="checkbox" id="needThisProgram"> Only for this program
    <span class="note">— "one meal every World Affairs day"</span></label>
  <label class="tick"><input type="checkbox" id="needThisLocation"> Only at this location</label>

  <button id="needGo" onclick="saveNeed()" disabled>Save this need</button>
  <button class="secondary" onclick="toggleNeedBox(false)">Cancel</button>
</fieldset>

<fieldset>
  <legend>Mark</legend>
  <label class="tick"><input type="checkbox" id="attended" onchange="clearWaitlistTick(); refreshButton()"> Attended</label>
  <label class="tick"><input type="checkbox" id="lunch" onchange="clearWaitlistTick(); exclusiveLunch('lunch'); refreshButton()"> Lunch
    <span class="note">— on its own means a meal collected, not present</span></label>
  <div id="servedBox" class="meals" style="display:none">
    <p class="hint" style="margin:0 0 4px 0">How many meals did they actually take? Leave them all at 0
      to record only that they were served.</p>
    <label class="num">Ate here <input type="number" id="ateHere" min="0" max="20" step="1" value="0"></label>
    <label class="num">Took home <input type="number" id="tookHome" min="0" max="20" step="1" value="0"></label>
    <label class="num">Into the fridge <input type="number" id="inFridge" min="0" max="20" step="1" value="0"></label>
  </div>
  <label class="tick"><input type="checkbox" id="signup" onchange="clearWaitlistTick(); exclusiveLunch('signup'); refreshButton()"> Sign up for lunch
    <span class="note">— they want a meal on this date; nothing has been served yet</span></label>
  <div id="mealsBox" class="meals" style="display:none">
    <label class="num">Meals to order <input type="number" id="mealsOrdered" min="1" max="20" step="1" value="1"></label>
    <span class="note">— more than one for a standing order ("Joan takes four")</span>
  </div>
  <label class="tick"><input type="checkbox" id="register" onchange="registerChanged()"> Register them for this session
    <span class="note">— no form needed; nothing is marked attended</span></label>
  <label class="tick"><input type="checkbox" id="waitlist" onchange="waitlistChanged()"> Add to waitlist
    <span class="note">— the session is full: they hold no seat and no meal is ordered</span></label>
  <label class="tick" id="standingLabel" style="display:none">
    <input type="checkbox" id="standing" onchange="standingChanged()"> …and every future session of it
    <span class="note">— a standing place on the list, until staff untick them on Club_Members</span></label>
  <label class="tick sub" id="standingLunchLabel" style="display:none">
    <input type="checkbox" id="standingLunch" onchange="refreshButton()"> …and a lunch every time
    <span class="note">— a meal on every future session too, not only this one</span></label>
</fieldset>

<button id="go" onclick="submit(false)" disabled>Mark</button>
<div id="status"></div>
<div id="log"></div>

<script>
  var WALK_IN = '__WALK_IN__';
  var LOCATIONS = ${locations};
  var SEP = '${QUICK_MARK_SESSION_KEY_SEPARATOR}';
  var NAME_TIME_SEP = '${QUICK_MARK_NAME_TIME_SEPARATOR}';
  var NEED_PRESETS = ${needPresets};
  var NEED_FREQUENCIES = ${needFrequencies};
  var NEED_WEEKDAYS = ${needWeekdays};
  // Everything the three dropdowns are built from. Normally ALREADY HERE,
  // shipped inside this page — see showQuickMarkDialog(). Null only on a
  // workbook that has never built its lists, and then the fetch below fills it
  // in exactly as it used to.
  var INDEX = ${inlineIndex} ? JSON.parse(${inlineIndex}) : null;

  function el(id) { return document.getElementById(id); }
  function say(msg, cls) { var s = el('status'); s.textContent = msg; s.className = cls || ''; }

  function fill(select, options, placeholder) {
    select.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder;
    select.appendChild(blank);
    var group = null;
    options.forEach(function (opt) {
      if (opt.group && (!group || group.label !== opt.group)) {
        group = document.createElement('optgroup');
        group.label = opt.group;
        select.appendChild(group);
      }
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      (opt.group ? group : select).appendChild(o);
    });
    select.disabled = false;
  }

  // THE LOCATIONS ARE HERE ALREADY, so they are drawn before anything is
  // fetched. There are three of them and they are a constant in this file —
  // waiting on a five-tab read to find that out was the single most visible
  // thing about opening this dialog, and the one that made it feel broken:
  // twenty seconds of "— loading… —" to arrive at a list that never changes.
  // A location can now be picked while the sessions are still on their way.
  function drawLocations() {
    var keep = el('location').value;
    fill(el('location'), LOCATIONS.map(function (loc) { return { value: loc, label: loc }; }),
      '— choose a location —');
    if (keep) { el('location').value = keep; }
  }

  // The need form's own vocabulary, drawn once. Same reasoning as
  // drawLocations(): none of it is on the server.
  function drawNeedForm() {
    var presets = el('needPresets');
    presets.innerHTML = '';
    NEED_PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.text;
      o.label = p.group;
      presets.appendChild(o);
    });
    var when = el('needWhen');
    when.innerHTML = '';
    NEED_FREQUENCIES.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      when.appendChild(o);
    });
    var days = el('needDays');
    days.innerHTML = '';
    NEED_WEEKDAYS.forEach(function (d) {
      var label = document.createElement('label');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('data-day', d);
      label.appendChild(box);
      label.appendChild(document.createTextNode(' ' + d));
      days.appendChild(label);
    });
    needWhenChanged();
  }

  // ONE SERVER CALL, at the start — and normally a cache read rather than a
  // rebuild, see getQuickMarkIndex(). Everything after it — narrowing to a
  // location, to a session, to the people on it — is a filter over what is
  // already here, which is what makes each selection instant instead of a
  // wait. See buildQuickMarkIndex().
  //
  // An "again" is the ↻ link, which asks for a genuine rebuild: the whole
  // point of pressing it is to pick up somebody who registered five minutes
  // ago, and the stored copy is exactly what would not have them.
  function loadIndex(again) {
    el('session').disabled = true;
    el('name').disabled = true;
    say(again ? 'Reloading lists…' : 'Loading the sessions…', 'busy');
    var call = google.script.run
      .withSuccessHandler(function (ix) {
        INDEX = ix;
        drawLocations();
        el('freshness').innerHTML = 'Lists read at ' + ix.builtAt +
          ' · <a onclick="loadIndex(true)">↻ reload</a>';
        say(again ? 'Lists reloaded.' : 'Ready.', '');
        locationChanged();
      })
      .withFailureHandler(function (err) {
        say('Could not load the lists: ' + err.message, 'err');
        el('freshness').innerHTML = '<a onclick="loadIndex(true)">↻ try again</a>';
      });
    if (again) call.refreshQuickMarkIndex(); else call.getQuickMarkIndex();
  }

  function locationChanged() {
    var loc = el('location').value;
    el('name').disabled = true;
    el('name').innerHTML = '<option value="">— choose a session first —</option>';
    showWalkIn(false);
    // The session dropdown is about to be rebuilt, so no session is chosen —
    // which means no appointment times and no standing tick until one is.
    showAppointmentTimes();
    registerChanged();
    // A location picked before the sessions have landed is not an error and
    // not a wasted click: loadIndex() calls back through here the moment they
    // arrive, and the choice is still sitting in the dropdown.
    if (!INDEX) {
      el('session').innerHTML = '<option value="">— loading… —</option>';
      el('session').disabled = true;
      if (loc) say('Loading the sessions at ' + loc + '…', 'busy');
      return;
    }
    if (!loc) {
      el('session').innerHTML = '<option value="">— choose a location first —</option>';
      el('session').disabled = true;
      return;
    }
    var sessions = INDEX.sessions.filter(function (s) { return s.location === loc; });
    fill(el('session'), sessions, sessions.length ? '— choose a session —' : '— no sessions found —');
    say(sessions.length + ' session(s) at ' + loc + '.', '');
  }

  // The names for one session: those registered for it, then everyone else on
  // the roll. The roll arrives once for the whole dialog, so subtracting this
  // session's people from it is done here rather than sent per session.
  function namesFor(loc, session) {
    var bucket = (INDEX && INDEX.namesBySession[loc + SEP + session]) || { names: [], keys: [], times: [] };
    var times = bucket.times || [];
    var taken = {};
    bucket.keys.forEach(function (k) { taken[k] = true; });

    // ON AN APPOINTMENT SESSION THE TIME IS HALF THE NAME. A Personalized
    // Assistance morning IS a list of times — 10:30, 11:00, 11:30 — and a desk
    // marking one off is looking at a person who arrived for a slot, not at an
    // alphabetical roll. Listed as "10:30 AM — Jane Smith", in time order, the
    // dropdown reads like the schedule taped to the desk. It also makes the
    // one case that was previously unmarkable possible: the same person
    // holding two slots is now two entries, each of which marks its own row.
    var order = bucket.names.map(function (n, i) { return i; });
    var showTimes = times.some(function (t) { return !!t; });
    if (showTimes) {
      order.sort(function (a, b) {
        var ta = minutesOfDay(times[a]), tb = minutesOfDay(times[b]);
        if (ta !== tb) return ta - tb;
        return bucket.names[a].localeCompare(bucket.names[b]);
      });
    }
    var out = order.map(function (i) {
      var name = bucket.names[i];
      var time = times[i] || '';
      return {
        value: packNamePick(name, time),
        label: (showTimes && time) ? time + '  —  ' + name : name,
        group: 'Registered for this session'
      };
    });
    INDEX.members.forEach(function (m) {
      if (taken[m.key]) return;
      out.push({ value: packNamePick(m.name, ''), label: m.name, group: 'Other known members' });
    });
    return { options: out, registeredCount: bucket.names.length, otherCount: out.length - bucket.names.length };
  }

  // "10:30 AM" -> 630, for sorting a session's people into the order they are
  // actually due. Anything unparseable sorts last rather than at midnight,
  // which is where a blank would otherwise put a walk-in with no slot.
  function minutesOfDay(label) {
    var m = /^(\d{1,2}):(\d{2})\s*([AaPp])/.exec(String(label || '').trim());
    if (!m) return 99999;
    var hour = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') hour += 12;
    return hour * 60 + Number(m[2]);
  }

  // A pick is a NAME AND A SLOT, because on an appointment session the name
  // alone does not identify a row. Packed into the option's value and taken
  // apart again on the way out, so nothing else in the dialog has to care.
  function packNamePick(name, time) { return time ? (name + NAME_TIME_SEP + time) : name; }
  function unpackNamePick(value) {
    var raw = String(value || '');
    var at = raw.lastIndexOf(NAME_TIME_SEP);
    if (at < 0) return { name: raw, time: '' };
    return { name: raw.substring(0, at), time: raw.substring(at + NAME_TIME_SEP.length) };
  }

  // The chosen session's own entry in the index — where its appointment times
  // (if it has any) live.
  function chosenSession() {
    var loc = el('location').value;
    var label = el('session').value;
    if (!INDEX || !label) return null;
    return INDEX.sessions.filter(function (s) {
      return s.location === loc && s.value === label;
    })[0] || null;
  }

  // A session with times is an appointment session, and picking a person on
  // one is not enough — the desk has to say WHICH chair, exactly as the public
  // form makes them. A session with none never shows the dropdown at all.
  function showAppointmentTimes() {
    var session = chosenSession();
    var free = (session && session.times) || [];
    var on = !!(session && session.byAppointment);
    // THE TIME DROPDOWN HAS TWO JOBS, and which one it is doing depends on
    // whether the person already has a slot. Booking somebody new offers the
    // FREE slots. Moving somebody who is already down for 10:30 has to offer
    // their own slot as well — it is not free, it is theirs — or the control
    // opens on a blank and the desk cannot see what they are moving from.
    var held = chosenBookedTime();
    var moving = !!held && el('moveTime').checked;
    var showPicker = on && (el('register').checked || moving);

    el('moveLabel').style.display = (on && held) ? 'block' : 'none';
    if (!on || !held) el('moveTime').checked = false;
    el('apptTimeLabel').style.display = showPicker ? 'block' : 'none';
    el('apptTime').style.display = showPicker ? 'block' : 'none';
    el('apptNote').style.display = showPicker ? 'block' : 'none';
    el('earlierLabel').style.display = on ? 'block' : 'none';
    if (!on) el('earlier').checked = false;

    el('apptTimeLabel').textContent = moving ? 'Move them to' : '4. Appointment time';
    el('apptNote').textContent = moving
      ? 'Currently at ' + held + '. Only free slots are listed, plus the one they already hold.'
      : (free.length
        ? 'This program is booked by appointment. Times already taken are not listed.'
        : 'Every appointment on this date is taken — nobody else can be booked onto it.');

    // Their own slot first when moving, then everything still free. Sorted
    // back into clock order so the list reads like the afternoon does.
    var offered = free.slice();
    if (moving && !offered.some(function (t) { return t.value === held; })) {
      offered.push({ value: held, label: held + ' (their slot now)' });
    }
    offered.sort(function (a, b) { return minutesOfDay(a.value) - minutesOfDay(b.value); });

    el('apptTime').innerHTML = '';
    if (!offered.length) { el('apptTime').value = ''; return; }
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— choose a time —';
    el('apptTime').appendChild(blank);
    offered.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.value;
      o.textContent = t.label;
      el('apptTime').appendChild(o);
    });
    if (moving) el('apptTime').value = held;
  }

  /** True when a booking on the chosen session has to name an appointment time. */
  function appointmentSession() {
    var session = chosenSession();
    return !!(session && session.byAppointment);
  }

  function sessionChanged() {
    var loc = el('location').value;
    var session = el('session').value;
    showWalkIn(false);
    showAppointmentTimes();
    registerChanged();
    if (!session || !INDEX) { el('name').disabled = true; return; }
    var res = namesFor(loc, session);
    fill(el('name'), res.options, '— choose a name —');
    var walkIn = document.createElement('option');
    walkIn.value = WALK_IN;
    walkIn.textContent = '➕ Someone not on this list…';
    el('name').appendChild(walkIn);
    say(res.registeredCount + ' registered' +
      (res.otherCount ? ', plus ' + res.otherCount + ' other known member(s)' : '') + '.', '');
  }

  // A walk-in that was just written is on that session from now on, without
  // going back to the server for a list we can correct here.
  function rememberWalkIn(loc, session, name, nameKey, time) {
    if (!INDEX || !name || !nameKey) return;
    var key = loc + SEP + session;
    var bucket = INDEX.namesBySession[key];
    if (!bucket) { bucket = { names: [], keys: [], times: [] }; INDEX.namesBySession[key] = bucket; }
    if (!bucket.times) bucket.times = bucket.names.map(function () { return ''; });
    if (bucket.keys.some(function (k, i) { return k === nameKey && bucket.times[i] === (time || ''); })) return;
    bucket.names.push(name);
    bucket.keys.push(nameKey);
    bucket.times.push(time || '');
  }

  // The same correction rememberWalkIn() makes, for a slot that MOVED rather
  // than a name that arrived: the row is the same row, at a different time.
  function retimeName(loc, session, nameKey, fromTime, toTime) {
    if (!INDEX || !nameKey) return;
    var bucket = INDEX.namesBySession[loc + SEP + session];
    if (!bucket || !bucket.times) return;
    for (var i = 0; i < bucket.keys.length; i++) {
      if (bucket.keys[i] === nameKey && bucket.times[i] === (fromTime || '')) {
        bucket.times[i] = toTime || '';
        return;
      }
    }
  }

  function nameChanged() {
    showWalkIn(el('name').value === WALK_IN);
    showHousehold();
    // The chosen person's own slot is what the time controls key off — whether
    // "move them" is even offered, and what it starts from.
    el('moveTime').checked = false;
    showAppointmentTimes();
    showNeeds();
    toggleNeedBox(false);
    refreshButton();
  }

  /**
   * WHO ELSE ARRIVES WITH THIS PERSON. Offered only when the roll actually
   * says somebody does (Member_Roll's household columns, carried in the index)
   * — a tick that is always there and usually means nothing is a tick people
   * stop reading, and this one marks other people present.
   *
   * Untouched by default: two people who share a phone number usually arrive
   * together, but "usually" is not something to assert about somebody's
   * attendance without being asked.
   */
  function householdForPick() {
    if (!INDEX || !INDEX.members) return [];
    var name = chosenName();
    if (!name || el('name').value === WALK_IN) return [];
    var key = nameKeyOf(name);
    var found = null;
    INDEX.members.forEach(function (m) { if (m.key === key) found = m; });
    return (found && found.household) || [];
  }

  function showHousehold() {
    var list = householdForPick();
    var label = el('householdLabel');
    if (!list.length) {
      el('household').checked = false;
      label.style.display = 'none';
      return;
    }
    el('householdNote').textContent = '— ' + list.map(function (m) { return m.name; }).join(', ') +
      (list.length === 1 ? ' arrives with them' : ' arrive with them');
    label.style.display = '';
  }

  // ------------------------------------------------------------------
  // Regular needs
  // ------------------------------------------------------------------

  // WHAT THIS PERSON ALWAYS NEEDS, the instant their name is picked — before
  // the mark, which is the only moment it is any use. Filtered in the browser
  // over the list the index already carries, so there is no wait in the middle
  // of the one interaction this tool exists to make fast.
  function needsForPick() {
    if (!INDEX || !INDEX.needs) return [];
    var name = chosenName();
    if (!name) return [];
    var key = nameKeyOf(name);
    var session = chosenSession();
    var loc = el('location').value;
    var title = session ? titleOf(session.label) : '';
    var dateKey = session ? dateKeyOf(session.label) : '';
    return INDEX.needs.filter(function (need) {
      if (need.nameKey && need.nameKey !== key) return false;
      if (need.location && loc && need.location !== loc) return false;
      if (need.program && title && need.program !== title) return false;
      if (need.program && !title) return false;
      return needAppliesOn(need, dateKey);
    });
  }

  function showNeeds() {
    var box = el('needs');
    var name = chosenName();
    if (!name) { box.innerHTML = ''; return; }
    var list = needsForPick();
    box.innerHTML = '';
    list.forEach(function (need) {
      var div = document.createElement('div');
      div.className = 'need';
      var strong = document.createElement('b');
      strong.textContent = '🔔 ' + need.text;
      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = '  — ' + need.when;
      div.appendChild(strong);
      div.appendChild(when);
      box.appendChild(div);
    });
    var add = document.createElement('a');
    add.className = 'add';
    add.textContent = list.length ? '+ add another regular need' : '+ add a regular need for ' + name;
    add.onclick = function () { toggleNeedBox(true); };
    box.appendChild(add);
  }

  function toggleNeedBox(on) {
    el('needBox').style.display = on ? 'block' : 'none';
    if (!on) return;
    el('needText').value = '';
    el('needThisProgram').checked = false;
    el('needThisLocation').checked = false;
    needWhenChanged();
    refreshNeedButton();
    el('needText').focus();
  }

  function needWhenChanged() {
    var when = el('needWhen').value;
    var days = when === 'Weekly' || when === 'Every N weeks' || when === 'Every time';
    var every = when === 'Every N weeks';
    var dates = when === 'Specific dates';
    el('needDaysLabel').style.display = days ? 'block' : 'none';
    el('needDays').style.display = days ? 'block' : 'none';
    el('needEveryLabel').style.display = every ? 'block' : 'none';
    el('needEvery').style.display = every ? 'block' : 'none';
    el('needDatesLabel').style.display = dates ? 'block' : 'none';
    el('needDates').style.display = dates ? 'block' : 'none';
  }

  function refreshNeedButton() {
    el('needGo').disabled = !el('needText').value.trim() || !chosenName();
  }

  function chosenWeekdays() {
    var out = [];
    var boxes = el('needDays').getElementsByTagName('input');
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) out.push(boxes[i].getAttribute('data-day'));
    }
    return out.join(', ');
  }

  function saveNeed() {
    var name = chosenName();
    if (!name) return;
    el('needGo').disabled = true;
    say('Saving the need…', 'busy');
    var session = chosenSession();
    google.script.run
      .withSuccessHandler(function (res) {
        say(res.message, res.ok ? 'ok' : 'err');
        if (res.ok) {
          // Added to the copy the dialog is holding, so it shows on this
          // person straight away rather than at the next reload.
          if (INDEX && INDEX.needs && res.stored) INDEX.needs.push(res.stored);
          toggleNeedBox(false);
          showNeeds();
        }
        refreshNeedButton();
      })
      .withFailureHandler(function (err) { say('Failed: ' + err.message, 'err'); refreshNeedButton(); })
      .addRegularNeedFromDialog({
        name: name,
        need: el('needText').value.trim(),
        frequency: el('needWhen').value,
        weekdays: chosenWeekdays(),
        interval: el('needEvery').value,
        dates: el('needDates').value,
        location: el('needThisLocation').checked ? el('location').value : '',
        program: el('needThisProgram').checked && session ? titleOf(session.label) : ''
      });
  }

  // The three rules the browser has to be able to apply on its own, kept
  // deliberately in step with regularNeedAppliesOn() on the server — the
  // server is still the one that decides what gets WRITTEN; this only decides
  // what is SHOWN.
  function needAppliesOn(need, dateKey) {
    if (!dateKey) return need.frequency === 'Every time' || !need.frequency;
    if (need.startsKey && dateKey < need.startsKey) return false;
    if (need.endsKey && dateKey > need.endsKey) return false;
    var day = new Date(dateKey + 'T12:00:00').getDay();
    if (need.weekdays && need.weekdays.length && need.weekdays.indexOf(day) === -1) return false;
    if (need.frequency === 'Once') return dateKey === need.startsKey;
    if (need.frequency === 'Specific dates') return (need.dates || []).indexOf(dateKey) !== -1;
    return true;
  }

  // The same loose identity rule normalizeNameKey() uses on the server.
  function nameKeyOf(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // "Chair Yoga · Wed, Sep 16" -> the title, and the date key the index put on
  // the session. The label is what the dropdown holds; the session entry is
  // where anything more exact lives.
  function titleOf(label) {
    var session = INDEX && INDEX.sessions.filter(function (x) { return x.label === label; })[0];
    return (session && session.title) || String(label || '').split(' · ')[0];
  }
  function dateKeyOf(label) {
    var session = INDEX && INDEX.sessions.filter(function (x) { return x.label === label; })[0];
    return (session && session.dateKey) || '';
  }

  function showWalkIn(on) {
    el('newNameLabel').style.display = on ? 'block' : 'none';
    el('newName').style.display = on ? 'block' : 'none';
    if (!on) el('newName').value = '';
  }

  function chosenName() {
    var picked = el('name').value;
    if (picked === WALK_IN) return el('newName').value.trim();
    return unpackNamePick(picked).name;
  }

  /**
   * The SLOT the chosen person already holds, or '' — which is what tells the
   * server which of two appointment rows a mark is for, and what the "move
   * them" control starts from.
   */
  function chosenBookedTime() {
    var picked = el('name').value;
    if (picked === WALK_IN) return '';
    return unpackNamePick(picked).time;
  }

  // "Lunch" and "Sign up for lunch" are the same fact at two different times —
  // already handed over, versus expected. Ticking both says nothing coherent,
  // so the later one wins and the other clears itself, rather than the dialog
  // accepting it and the server quietly picking one.
  function exclusiveLunch(justTicked) {
    var other = justTicked === 'lunch' ? 'signup' : 'lunch';
    if (el(justTicked).checked) el(other).checked = false;
    showMealBoxes();
  }

  // THE TWO MEAL BOXES ANSWER TWO DIFFERENT QUESTIONS, which is why they are
  // two boxes and not one. "Sign up" is an ORDER — how many meals to put on
  // the kitchen's list — and "Lunch" is a HANDOVER: how many they took, and
  // whether they ate them here or carried them out. Somebody can order four
  // and eat one; the counter needs both numbers and they are never the same
  // column (see Meals_Ordered and the four consumption counts).
  function showMealBoxes() {
    el('servedBox').style.display = el('lunch').checked ? 'block' : 'none';
    el('mealsBox').style.display = el('signup').checked ? 'block' : 'none';
    // Untick "sign up for lunch" after the standing box has already defaulted
    // itself from it and the default is stale — a standing lunch order nobody
    // asked for. Only ever taken AWAY here: ticking lunch again does not
    // re-tick a box the person has deliberately cleared.
    if (!el('signup').checked && el('standingLunchLabel').style.display !== 'none') {
      el('standingLunch').checked = false;
    }
  }

  /** A number field's value as a whole count, floored at 0 — a blank box is 0. */
  function countIn(id, min) {
    var n = Math.floor(Number(el(id).value));
    if (!(n > 0)) return min || 0;
    return Math.min(n, 20);
  }

  // "Every future session" is a rider on registering, not a mark of its own:
  // it only means anything once somebody is being put on the list.
  // WAITLISTING SAYS THE OPPOSITE OF EVERY MARK BESIDE IT — no seat, no meal,
  // not here — so ticking it clears them rather than leaving the desk to find
  // out from a refusal after they press the button. The server refuses the
  // combination anyway (see applyQuickMarkLocked()); this is so nobody ever
  // reaches it.
  function waitlistChanged() {
    if (el('waitlist').checked) {
      el('attended').checked = false;
      el('lunch').checked = false;
      el('signup').checked = false;
      el('standing').checked = false;
      el('standingLunch').checked = false;
      showMealBoxes();
    }
    registerChanged();
  }

  // And the reverse: ticking any of them unticks the waitlist. One line rather
  // than three handlers, called from each.
  function clearWaitlistTick() {
    if (el('waitlist').checked) { el('waitlist').checked = false; waitlistChanged(); }
  }

  function registerChanged() {
    // Not offered on an appointment session: an appointment is booked one at a
    // time, so "every future one" is not a thing anybody can be put down for.
    var on = el('register').checked && !appointmentSession() && !el('waitlist').checked;
    el('standingLabel').style.display = on ? 'block' : 'none';
    if (!on) el('standing').checked = false;
    standingChanged();
    // Ticking Register is the other thing that brings the time dropdown out.
    showAppointmentTimes();
    refreshButton();
  }

  // THREE DIFFERENT THINGS A DESK CAN MEAN, and until now the middle one was
  // the only one it could say:
  //
  //   Register                          → this session, and this session only.
  //   Register + every future session   → a standing place on the program.
  //   Register + every future session
  //            + a lunch every time     → and a meal on each of those dates.
  //
  // The third is what Caroline asked for, and it is a great many of the people
  // who come: a program they never miss and a lunch they always stay for.
  // The standing place already lands on Club_Members, which carries a Lunch
  // column that applyClubRosterCatchup() honours on every booking it makes —
  // so this tick is not a new mechanism, it is the desk finally being asked
  // which of the two kinds of standing place it means.
  //
  // DEFAULTED FROM THE LUNCH TICK BESIDE IT, because somebody signing a person
  // up for lunch today AND putting them on every future session has almost
  // certainly described the whole standing arrangement, not half of it. Shown
  // ticked rather than applied invisibly: it is one line above the button, and
  // untickable by anyone who meant only today's meal.
  function standingChanged() {
    var on = el('standing').checked && el('standingLabel').style.display !== 'none';
    var box = el('standingLunchLabel');
    var wasOn = box.style.display !== 'none';
    box.style.display = on ? 'block' : 'none';
    if (!on) el('standingLunch').checked = false;
    else if (!wasOn) el('standingLunch').checked = el('signup').checked;
    refreshButton();
  }

  function refreshButton() {
    var registering = el('register').checked;
    var waitlisting = el('waitlist').checked;
    // Moving somebody to another time IS a thing to press the button for, on
    // its own — "she rang to move to 11:30" is not an attendance mark and not
    // a registration, and until it counted here the button stayed grey.
    var moving = el('moveTime').checked && !!chosenBookedTime();
    var ready = !!el('session').value && !!chosenName() &&
      (el('attended').checked || el('lunch').checked || el('signup').checked || registering ||
        waitlisting || moving) &&
      // An appointment session cannot be booked, or moved, without naming the slot.
      !(appointmentSession() && (registering || moving) && !el('apptTime').value) &&
      // And moving somebody onto the slot they already hold is not a move.
      !(moving && el('apptTime').value === chosenBookedTime() && !el('attended').checked &&
        !el('lunch').checked && !el('signup').checked && !registering);
    el('go').disabled = !ready;
    var onlySignup = el('signup').checked && !el('attended').checked && !el('lunch').checked;
    // Ahead of every other label: it is the one word that describes what the
    // button will actually do when it is ticked, whatever else is.
    el('go').textContent = waitlisting ? 'Add to waitlist'
      : registering ? 'Sign up'
      : (moving && !el('attended').checked && !el('lunch').checked && !onlySignup) ? 'Move'
        : (onlySignup ? 'Sign up' : 'Mark');
  }

  function submit(confirmWalkIn) {
    el('go').disabled = true;
    say('Marking…', 'busy');
    google.script.run
      .withSuccessHandler(function (res) {
        // A walk-in needs a yes first, and the dialog has to be the one that
        // asks: Apps Script will not show an alert over an open modal.
        if (res.needsConfirm) {
          refreshButton();
          if (window.confirm(res.question)) { submit(true); }
          else { say('Nothing added — ' + res.message, ''); }
          return;
        }
        say(res.message, res.ok ? 'ok' : 'err');
        if (res.ok) {
          var line = document.createElement('div');
          line.textContent = '• ' + res.message;
          el('log').insertBefore(line, el('log').firstChild);
          // Same session, next person: clear the name and the ticks only.
          el('name').value = '';
          showWalkIn(false);
          el('household').checked = false;
          showHousehold();
          el('attended').checked = false;
          el('lunch').checked = false;
          el('signup').checked = false;
          el('register').checked = false;
          el('waitlist').checked = false;
          el('mealsOrdered').value = '1';
          el('ateHere').value = '0';
          el('tookHome').value = '0';
          el('inFridge').value = '0';
          showMealBoxes();
          el('standing').checked = false;
          el('standingLunch').checked = false;
          el('earlier').checked = false;
          el('moveTime').checked = false;
          registerChanged();
          // A slot just booked is gone for the next person in the queue, and a
          // slot just vacated by a move is free again. The dialog holds the
          // only copy of that list until it is reloaded, so it keeps its own
          // copy honest rather than re-fetching between two people in a queue.
          if (res.bookedTime || res.freedTime) {
            var session = chosenSession();
            if (session && session.times) {
              if (res.bookedTime) {
                session.times = session.times.filter(function (t) { return t.value !== res.bookedTime; });
              }
              if (res.freedTime && !session.times.some(function (t) { return t.value === res.freedTime; })) {
                session.times.push({ value: res.freedTime, label: res.freedTime });
                session.times.sort(function (a, b) { return minutesOfDay(a.value) - minutesOfDay(b.value); });
              }
            }
            showAppointmentTimes();
          }
          // A move rewrites the slot on a row the list is already showing, so
          // the list has to be rebuilt for the next person to see it.
          if (res.namesChanged || res.movedTime) {
            if (res.namesChanged) {
              rememberWalkIn(el('location').value, el('session').value, res.addedName, res.addedNameKey,
                res.bookedTime);
            }
            if (res.movedTime) {
              retimeName(el('location').value, el('session').value, res.addedNameKey, res.freedTime,
                res.bookedTime);
            }
            sessionChanged();
          }
        }
        refreshButton();
      })
      .withFailureHandler(function (err) { say('Failed: ' + err.message, 'err'); refreshButton(); })
      // THE SAME MARK, ONE PERSON OR A WHOLE HOUSEHOLD. Two server functions
      // taking the identical payload, chosen by the tick above — picked by
      // name here rather than by branching the whole call, so there is one
      // copy of what a mark consists of and no chance of the two drifting.
      [el('household').checked && householdForPick().length
        ? 'applyQuickMarkForHousehold' : 'applyQuickMarkFromDialog']({
        location: el('location').value,
        session: el('session').value,
        name: chosenName(),
        attended: el('attended').checked,
        lunch: el('lunch').checked,
        signup: el('signup').checked,
        register: el('register').checked,
        waitlist: el('waitlist').checked,
        standing: el('standing').checked,
        standingLunch: el('standingLunch').checked,
        appointmentTime: el('apptTime').value,
        // How many meals, on both sides of the same tab. Sent whatever is
        // ticked; the server ignores the half that does not apply.
        mealsOrdered: countIn('mealsOrdered', 1),
        ateHere: countIn('ateHere', 0),
        tookHome: countIn('tookHome', 0),
        inFridge: countIn('inFridge', 0),
        // WHICH ROW this mark is for, when the name alone does not say — see
        // QUICK_MARK_NAME_TIME_SEPARATOR.
        bookedTime: chosenBookedTime(),
        moveTime: el('moveTime').checked,
        earlierAppointment: el('earlier').checked,
        confirmWalkIn: !!confirmWalkIn
      });
  }

  // The locations first and synchronously — nothing about them is on the
  // server. Then the fetch, which overlaps with the person reaching for that
  // first dropdown rather than blocking it.
  drawLocations();
  drawNeedForm();
  // NOTHING IS FETCHED WHEN THE LISTS CAME WITH THE PAGE, which is the normal
  // case: the dialog paints with its dropdowns already populated and asks the
  // server nothing at all until somebody presses Mark. The ↻ link is still
  // there for the desk that wants this minute's registrations.
  if (INDEX) {
    el('freshness').innerHTML = 'Lists read at ' + INDEX.builtAt +
      ' · <a onclick="loadIndex(true)">↻ reload</a>';
    say('Ready.', '');
    locationChanged();
  } else {
    loadIndex(false);
  }
</script>`;
}


