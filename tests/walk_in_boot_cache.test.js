// THE SIGN-IN APP'S BOOT SNAPSHOT (section 16d) — the page draws today before
// it asks for it.
//
// The sign-in page used to serve a document with no data in it and then spend
// a round trip — two sectioned-tab passes and the whole member roll — finding
// out what to draw. Every morning, on a tablet's wifi, that was a blue header
// and the word "Reading..." in front of a queue. What this pins is the two
// halves of the fix, and the ways each of them fails QUIETLY:
//
//   1. THE STORE. A day is kept per building, with the member roll lifted out
//      and kept once, and it is served ONLY for the date it was built on. A
//      store that outlives its day is the worst failure this file has: a page
//      showing yesterday's programs with yesterday's sign-ins ticked looks
//      completely normal and records nothing.
//   2. THE BOOT. The page inlines that store and paints it on the first frame,
//      with the live read running behind it. So the assertion that matters is
//      not "the page can render the snapshot" — it is that the names are on
//      screen while NO server call has been answered yet, and that nothing on
//      that first frame says "wait".
//
//   3. AND THE FRESH DAY WAITS ITS TURN. A background answer that redraws the
//      screen while somebody is mid-sign-in moves the tick they are reaching
//      for. It is held until the page is back at the name list.
const vm = require('vm');

const src = require('./helpers/source').readSource();

// Yesterday and today as the script's own formatDateKey() spells them, so the
// date guard is tested against the same string the runtime builds.
function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = dateKeyOf(new Date());
const YESTERDAY = dateKeyOf(new Date(new Date().getTime() - 24 * 60 * 60 * 1000));

// A real (in-memory) cache and property store: the whole point of the store is
// that it survives between executions, and a stub that forgets proves nothing.
let cacheStore = {};
let props = {};
let deskBlocked = false;

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'yyyy-MM-dd') return dateKeyOf(d);
      if (fmt === 'EEE, MMM d, yyyy') return 'Wed, Sep 16, 2026';
      return '9:00 AM';
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' },
    // The store is packed with gzip + base64 (packCachedText). What matters
    // here is the round trip, not the compression.
    newBlob: data => ({ getBytes: () => data, getDataAsString: () => String(data) }),
    gzip: blob => blob,
    ungzip: blob => blob,
    base64Encode: bytes => Buffer.from(String(bytes)).toString('base64'),
    base64Decode: text => Buffer.from(String(text), 'base64').toString()
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (props[key] === undefined ? null : props[key]),
      setProperty: (key, value) => { props[key] = String(value); },
      setProperties: values => {
        Object.keys(values).forEach(k => { props[k] = String(values[k]); });
      },
      deleteProperty: key => { delete props[key]; }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: key => (cacheStore[key] === undefined ? null : cacheStore[key]),
      put: (key, value) => { cacheStore[key] = String(value); },
      putAll: values => {
        Object.keys(values).forEach(k => { cacheStore[k] = String(values[k]); });
      },
      getAll: keys => {
        const out = {};
        keys.forEach(k => { if (cacheStore[k] !== undefined) out[k] = cacheStore[k]; });
        return out;
      },
      remove: key => { delete cacheStore[key]; },
      removeAll: keys => { keys.forEach(k => { delete cacheStore[k]; }); }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: {
    getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + ';this.HEADERS = HEADERS; this.CALENDAR_MAP = CALENDAR_MAP;',
  sandbox, { filename: 'program.gs' });
// A function DECLARATION becomes a property of the context's global, so the
// one thing this file has to steer from outside — "is the workbook mid-sweep?"
// — can be replaced by name. (A `const` could not be; see check_in_page.test.js.)
sandbox.isDeskWorkBlocked = () => deskBlocked;

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

function reset() {
  cacheStore = {};
  props = {};
}

/** One building's day, in the shape readWalkInDay() returns it. */
function dayFor(location, names, dateKey) {
  return {
    location,
    dateKey: dateKey || TODAY,
    dateLabel: 'Wed, Sep 16, 2026',
    programs: [{
      value: 'Chair Yoga · Wed, Sep 16, 2026', title: 'Chair Yoga', time: '9:00 AM',
      byAppointment: false, noRegistration: false, order: 540
    }],
    lunch: { offered: false, ruledOut: false, type: '', dish: '', title: 'Lunch', value: 'Lunch · Wed, Sep 16, 2026' },
    people: names.map(name => ({
      name, key: name.toLowerCase(), phone: '', registered: [], attended: [],
      lunchRegistered: false, lunchOnly: false, lunchOn: '', lunchServed: false, here: false
    })),
    readAt: '9:00 AM'
  };
}

/**
 * The same day as a LIVE read hands it back — with the roll still on it. The
 * store lifts that out; a hand-written fixture has to hand it something to
 * lift, or the test proves nothing.
 */
function liveDay(location, names, dateKey) {
  const day = dayFor(location, names, dateKey);
  day.members = [{ name: 'Ruth Adler', key: 'ruth adler' }];
  return day;
}

// ---------------------------------------------------------------------------
// 1. The store: what goes in comes back, per building, for today only.
// ---------------------------------------------------------------------------
reset();
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: TODAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: [{ name: 'Ruth Adler', key: 'ruth adler' }],
  days: { Narberth: dayFor('Narberth', ['Ada Cole']) }
});
const stored = sandbox.storedWalkInDay('Narberth');
ok('a stored day comes back for the building it was filed under',
  !!stored && stored.location === 'Narberth' && stored.people[0].name === 'Ada Cole');
ok('and it says out loud that it is a stored one', stored.stale === true);
ok('and carries the time it was stored, for the footer to print',
  stored.storedAt === '8:40 AM');
// THE ROLL IS KEPT ONCE. Four buildings would otherwise mean four copies of
// the same four thousand names in a store that has to fit in chunked
// properties — but a caller must not have to know that.
ok('the member roll is put back on the way out',
  !!stored.members && stored.members[0].name === 'Ruth Adler');
ok('a building with nothing stored is null, not an empty day',
  sandbox.storedWalkInDay('Ashbridge') === null);

// THE DATE GUARD — the one that matters most. A tablet awake since yesterday
// must not open on yesterday.
reset();
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: YESTERDAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: [], days: { Narberth: dayFor('Narberth', ['Ada Cole'], YESTERDAY) }
});
ok('yesterday\'s store is never served', sandbox.storedWalkInDay('Narberth') === null);
ok('and it is dropped rather than carried until something overwrites it',
  props.WALK_IN_DAY_STORE_V1 === undefined &&
  cacheStore.WALK_IN_DAY_STORE_V1 === undefined);

// A blob this version of the script cannot read is not half-read.
reset();
sandbox.writeWalkInDayStore({ schema: 99, dateKey: TODAY, members: [], days: {} });
ok('a store from another schema is refused', sandbox.readWalkInDayStore() === null);

// ---------------------------------------------------------------------------
// 2. The durable half. A cache expires in six hours and is dropped by a
//    redeploy, and the first tablet of the morning is the one that finds it
//    gone — which is the boot this section is about.
// ---------------------------------------------------------------------------
reset();
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: TODAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: [], days: { Narberth: dayFor('Narberth', ['Ada Cole']) }
});
ok('the store is written to Script Properties too',
  typeof props.WALK_IN_DAY_STORE_V1 === 'string');
cacheStore = {};   // the cache expires; the property copy does not
const fromProps = sandbox.storedWalkInDay('Narberth');
ok('and the day survives the cache going away',
  !!fromProps && fromProps.people[0].name === 'Ada Cole');

// ---------------------------------------------------------------------------
// 3. rememberWalkInDay() — every live read leaves the store better than it
//    found it, without knocking the other buildings out of it.
// ---------------------------------------------------------------------------
reset();
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: TODAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: [{ name: 'Ruth Adler', key: 'ruth adler' }],
  days: {
    Narberth: dayFor('Narberth', ['Ada Cole']),
    Ashbridge: dayFor('Ashbridge', ['Ben Roth'])
  }
});
sandbox.rememberWalkInDay(liveDay('Narberth', ['Ada Cole', 'Cy Neale']));
ok('a fresh day replaces the building it is for',
  sandbox.storedWalkInDay('Narberth').people.length === 2);
ok('and leaves the other buildings where they were',
  sandbox.storedWalkInDay('Ashbridge').people[0].name === 'Ben Roth');
const packedStore = sandbox.readWalkInDayStore();
ok('the roll is lifted off the day and kept once, not once per building',
  !packedStore.days.Narberth.members && packedStore.members.length === 1);

// A day read for another date — the override the tests use — is not what a
// door boots on, and storing it would poison the date guard above.
sandbox.rememberWalkInDay(liveDay('Narberth', ['Nobody At All'], YESTERDAY));
ok('a day for another date is not stored',
  sandbox.storedWalkInDay('Narberth').people.length === 2);

// ---------------------------------------------------------------------------
// 4. The snapshot the page is served with — every building, and a size limit.
// ---------------------------------------------------------------------------
const boot = sandbox.walkInBootSnapshot();
ok('the boot snapshot carries every building, not just the pinned one',
  !!boot && !!boot.days.Narberth && !!boot.days.Ashbridge);
ok('and the date it belongs to, for the tablet to check', boot.dateKey === TODAY);
ok('and the roll, once', boot.members.length === 1);

// THE ROLL IS WHAT GETS DROPPED when the page would otherwise be too big to
// download — it is behind a search box, and the day itself is not.
reset();
const bigRoll = [];
for (let i = 0; i < 20000; i++) bigRoll.push({ name: `Member Number ${i}`, key: `m${i}` });
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: TODAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: bigRoll, days: { Narberth: dayFor('Narberth', ['Ada Cole']) }
});
const trimmed = sandbox.walkInBootSnapshot();
ok('an oversized roll is left out of the page', trimmed.members.length === 0);
ok('and the page is told the search box is still filling',
  trimmed.membersDeferred === true);
ok('while the day itself always travels',
  trimmed.days.Narberth.people[0].name === 'Ada Cole');

// ---------------------------------------------------------------------------
// 5. THE BOOT ITSELF. The names are on screen before any server call has been
//    answered, and nothing on that first frame says "wait".
// ---------------------------------------------------------------------------
const NASTY = 'O\'Brien </script><script>alert(1)</script> "quoted"';

/** The one <script> body of a built page. */
function scriptBody(html) {
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  return html.substring(open + '<script>'.length, close);
}

/** Enough of a DOM for the page's own draw() to run against. */
function makeDom() {
  const fixed = {};
  function makeEl(tag) {
    const node = {
      tagName: String(tag).toUpperCase(), children: [], className: '', id: '',
      style: {}, value: '', disabled: false, placeholder: '', type: '',
      autocomplete: '', onclick: null, oninput: null,
      setAttribute: () => {}, focus: () => {},
      appendChild: child => { node.children.push(child); return child; }
    };
    let text = '';
    let html = '';
    Object.defineProperty(node, 'textContent', {
      get: () => text, set: v => { text = String(v === undefined ? '' : v); }
    });
    // Setting innerHTML is how every draw() clears what it is replacing.
    Object.defineProperty(node, 'innerHTML', {
      get: () => html,
      set: v => { html = String(v === undefined ? '' : v); node.children.length = 0; }
    });
    node.classList = {
      add: c => {
        if (node.className.split(/\s+/).indexOf(c) === -1) {
          node.className = (node.className + ' ' + c).trim();
        }
      },
      remove: c => {
        node.className = node.className.split(/\s+/).filter(x => x && x !== c).join(' ');
      },
      contains: c => node.className.split(/\s+/).indexOf(c) !== -1
    };
    return node;
  }
  ['heading', 'subheading', 'pinbox', 'app', 'status', 'pin'].forEach(id => {
    fixed[id] = makeEl('div');
    fixed[id].id = id;
  });
  function find(node, id) {
    if (node.id === id) return node;
    for (let i = 0; i < node.children.length; i++) {
      const hit = find(node.children[i], id);
      if (hit) return hit;
    }
    return null;
  }
  return {
    fixed,
    document: {
      createElement: makeEl,
      getElementById: id => fixed[id] || find(fixed.app, id) || find(fixed.pinbox, id)
    }
  };
}

/** Everything a person standing at the tablet can read on the screen. */
function screenText(node) {
  let out = node.textContent + ' ' + String(node.innerHTML).replace(/<[^>]*>/g, ' ');
  node.children.forEach(child => { out += ' ' + screenText(child); });
  return out;
}

/** Finds the button whose label contains `text`, so a test can tap it. */
function tap(node, text) {
  if (node.onclick && screenText(node).indexOf(text) !== -1 &&
    node.tagName === 'BUTTON') { node.onclick(); return true; }
  for (let i = 0; i < node.children.length; i++) {
    if (tap(node.children[i], text)) return true;
  }
  return false;
}

/**
 * Runs a built page's script the way a browser would, with every server call
 * PARKED rather than answered — which is the whole question this section is
 * about: what is on the screen while the round trip is still in the air.
 */
function bootPage(html) {
  const dom = makeDom();
  const calls = [];
  const store = {};
  const ctx = {
    console: { log: () => {} },
    document: dom.document,
    window: {
      localStorage: {
        getItem: k => (store[k] === undefined ? null : store[k]),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
      },
      setTimeout: () => 0,
      clearTimeout: () => {}
    },
    google: {
      script: {
        run: {
          withSuccessHandler(fn) { this._ok = fn; return this; },
          withFailureHandler(fn) { this._err = fn; return this; },
          walkInDay(json) { calls.push({ fn: 'walkInDay', payload: JSON.parse(json), ok: this._ok }); },
          walkInSignIn(json) { calls.push({ fn: 'walkInSignIn', payload: JSON.parse(json), ok: this._ok }); }
        }
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(scriptBody(html), ctx, { filename: 'walk_in_page.js' });
  return { dom, calls, storage: store, text: () => screenText(dom.fixed.app) };
}

// A page served WITH a snapshot in it.
reset();
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: TODAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: [{ name: NASTY, key: 'nasty' }],
  days: { Narberth: dayFor('Narberth', ['Ada Cole', NASTY]) }
});
const page = sandbox.buildWalkInHtml({
  location: 'Narberth', pinRequired: false, locations: ['Narberth'],
  rosterUrl: 'https://example.org/exec'
});

// The snapshot rides inside a template literal, so it is the same hazard the
// check-in page's inlined lists are: a name carrying the two characters that
// end a script tag would end the page mid-sentence.
ok('the page still has exactly one closing script tag',
  page.substring(page.indexOf('<script>')).split('</script>').length - 1 === 1);
const literal = /var OPTS = JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(page);
ok('the options and the snapshot are one string literal', !!literal);
if (literal) {
  const parsed = JSON.parse(JSON.parse(literal[1]));
  ok('the literal parses back to the same snapshot',
    parsed.boot.days.Narberth.people[1].name === NASTY);
  ok('and carries the date the SERVER is on, not the tablet\'s idea of it',
    parsed.todayKey === TODAY);
}

const warm = bootPage(page);
ok('the names are on screen on the first frame',
  warm.text().indexOf('Ada Cole') !== -1);
// THE ASSERTION THIS FILE EXISTS FOR: nothing has answered yet.
ok('and no server call has been answered to put them there',
  warm.calls.length === 1 && warm.calls[0].fn === 'walkInDay');
ok('nothing on that first frame says "Reading..."',
  warm.dom.fixed.status.className.indexOf('show') === -1 &&
  warm.text().indexOf('Reading today') === -1);
ok('the footer says which list is on screen',
  warm.text().indexOf('stored at 8:40 AM') !== -1);

// The background answer lands and replaces it, silently.
warm.calls[0].ok({ ok: true, day: liveDay('Narberth', ['Ada Cole', 'Cy Neale']) });
ok('the fresh day replaces the stored one', warm.text().indexOf('Cy Neale') !== -1);
ok('and the footer stops saying it is showing a stored list',
  warm.text().indexOf('stored at') === -1 && warm.text().indexOf('Read at 9:00 AM') !== -1);
ok('and the tablet keeps it for its own next boot',
  !!warm.storage['walkInDay:Narberth'] &&
  JSON.parse(warm.storage['walkInDay:Narberth']).dateKey === TODAY);

// ---------------------------------------------------------------------------
// 6. A page served with NOTHING stored opens the way it always did — asking,
//    and saying so. A silent blank page would be worse than a spinner.
// ---------------------------------------------------------------------------
const cold = bootPage(sandbox.buildWalkInHtml({
  location: 'Narberth', pinRequired: false, locations: ['Narberth'],
  rosterUrl: '', boot: null
}));
ok('with nothing stored the page says it is reading',
  cold.dom.fixed.status.className.indexOf('show') !== -1 &&
  screenText(cold.dom.fixed.status).indexOf('Reading today') !== -1);
ok('and there are no names on it until the read answers',
  cold.text().indexOf('Ada Cole') === -1);
cold.calls[0].ok({ ok: true, day: liveDay('Narberth', ['Ada Cole']) });
ok('and the names arrive when it does', cold.text().indexOf('Ada Cole') !== -1);

// A SNAPSHOT FOR ANOTHER DAY IS NOT A SNAPSHOT. The server sends its own date
// with the page precisely so the tablet can refuse this.
const staleBoot = bootPage(sandbox.buildWalkInHtml({
  location: 'Narberth', pinRequired: false, locations: ['Narberth'], rosterUrl: '',
  boot: {
    dateKey: YESTERDAY, builtAt: '8:40 AM', members: [],
    days: { Narberth: dayFor('Narberth', ['Ada Cole'], YESTERDAY) }
  }
}));
ok('yesterday\'s snapshot is not drawn',
  staleBoot.text().indexOf('Ada Cole') === -1);
ok('and the page falls back to asking',
  staleBoot.dom.fixed.status.className.indexOf('show') !== -1);

// ---------------------------------------------------------------------------
// 7. A BACKGROUND ANSWER DOES NOT REDRAW UNDER A THUMB. Somebody who has
//    tapped their name is looking at a screen of ticks; moving them while a
//    finger is on the way to one is how the wrong thing gets recorded.
// ---------------------------------------------------------------------------
const midFlow = bootPage(page);
ok('tapping a name opens the second screen', tap(midFlow.dom.fixed.app, 'Ada Cole') &&
  midFlow.text().indexOf('Hello, Ada Cole') !== -1);
midFlow.calls[0].ok({ ok: true, day: liveDay('Narberth', ['Ada Cole', 'Cy Neale']) });
ok('the background answer does not take the screen away',
  midFlow.text().indexOf('Hello, Ada Cole') !== -1);
ok('and going back to the name list is where it lands',
  tap(midFlow.dom.fixed.app, 'Not you?') && midFlow.text().indexOf('Cy Neale') !== -1);

// ---------------------------------------------------------------------------
// 8. THE SERVER SIDE OF THE SAME PROMISE. walkInDay() is the background call
//    now, so a workbook mid-sweep answers with the stored day rather than
//    taking the door's list away over something the door does not care about.
// ---------------------------------------------------------------------------
reset();
sandbox.writeWalkInDayStore({
  schema: 1, dateKey: TODAY, builtAt: '8:40 AM', builtAtMs: 1,
  members: [], days: { Narberth: dayFor('Narberth', ['Ada Cole']) }
});
sandbox.CALENDAR_MAP.__test__ = 'Narberth';
deskBlocked = true;
const blocked = sandbox.walkInDay(JSON.stringify({ location: 'Narberth' }));
ok('a blocked desk still gets today\'s list',
  blocked.ok === true && blocked.day.people[0].name === 'Ada Cole');
ok('and is told it is a stored one', blocked.stale === true);
deskBlocked = false;
delete sandbox.CALENDAR_MAP.__test__;

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
