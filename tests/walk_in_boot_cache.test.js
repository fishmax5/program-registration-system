// THE SIGN-IN APP'S BOOT SNAPSHOT (section 16d) — today's list, stored so a
// tablet does not have to wait for it.
//
// A door page that serves a document with no data in it and then spends a
// round trip — two sectioned-tab passes and the whole member roll — finding
// out what to draw is, every morning on a tablet's wifi, a blue header and the
// word "Reading..." in front of a queue. The store is what that is paid out
// of. What this pins is the store and the read that keeps it fed, and the ways
// each of them fails QUIETLY:
//
//   1. THE STORE. A day is kept per building, with the member roll lifted out
//      and kept once, and it is served ONLY for the date it was built on. A
//      store that outlives its day is the worst failure this file has: a page
//      showing yesterday's programs with yesterday's sign-ins ticked looks
//      completely normal and records nothing.
//   2. IT IS TRIMMED TO A SIZE A PAGE CAN CARRY, and the roll is what gets
//      dropped — it sits behind a search box, and the day itself does not.
//   3. AND A BLOCKED DESK IS STILL A DOOR. A workbook mid-sweep answers the
//      day read with the stored day rather than a refusal.
//
// The page that used to inline this snapshot (section 16b) was retired — see
// the banner in 62_walk_in_page.gs; the door app's own boot is pinned in
// door_app.test.js.
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
