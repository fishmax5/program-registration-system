// THE PUBLIC SCHEDULE, BUILT AHEAD (99y).
//
// What has to hold:
//   1. A page view with nothing stored builds ONCE and stores the result —
//      in the cache (chunked, because CacheService refuses a value over
//      100KB) and in the Drive fallback.
//   2. A page view with something stored does not build.
//   3. A cold cache falls back to Drive and re-warms the cache.
//   4. A snapshot from a previous DAY is never served.
//   5. Refresh rebuilds only when what is stored is older than a minute.
//   6. A failed build stores nothing, so the last good snapshot survives.
//   7. The trigger stands down while a sync holds the workbook.
//   8. getScheduleSnapshot answers each page in its own shape, with builtAt.
//   9. A chunk evicted on its own makes the entry missing, not half-parsed.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const cacheStore = {};
const props = {};
const files = {};
let fileSeq = 0;

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd' ? dateKey(d) : 'Sep 28, 9:00 AM'),
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (key, value) => { props[key] = String(value); },
      deleteProperty: key => { delete props[key]; }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: key => (key in cacheStore ? cacheStore[key] : null),
      getAll: keys => {
        const out = {};
        keys.forEach(k => { if (k in cacheStore) out[k] = cacheStore[k]; });
        return out;
      },
      putAll: values => {
        Object.keys(values).forEach(k => {
          if (String(values[k]).length > 100000) throw new Error('Argument too large');
          cacheStore[k] = values[k];
        });
      },
      put: (k, v) => { cacheStore[k] = v; }
    })
  },
  DriveApp: {
    getFileById: id => {
      if (!files[id]) throw new Error('No item with the given ID');
      return {
        setContent: text => { files[id] = text; },
        getBlob: () => ({ getDataAsString: () => files[id] })
      };
    },
    createFile: (name, text) => {
      const id = 'file' + (++fileSeq);
      files[id] = text;
      return { getId: () => id };
    }
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, LockService: {}, HtmlService: {},
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// The fixture: a snapshot big enough to need more than one cache chunk, and
// sessions that fold into one weekly program.
const todayKey = dateKey(new Date());
let builds = 0;
let buildThrows = false;
const weekly = [0, 7, 14].map(offset => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return { programKey: 'yoga::a', title: 'Yoga', location: 'A', dateKey: dateKey(d),
    dayLabel: 'Monday, X', time: '9:30 AM', sortTime: 930, state: 'open', url: 'https://x' };
});
sandbox.buildPublicProgramCalendar = () => {
  builds++;
  if (buildThrows) throw new Error('sheet unreadable');
  return { ok: true, todayKey, horizonKey: todayKey, generatedAt: 'now',
    locations: ['A'], intro: {}, sessions: weekly, padding: 'x'.repeat(150000) };
};
sandbox.getOrCreateSystemFolder = () => null;
sandbox.log = () => {};
let held = false;
sandbox.workbookHeldElsewhere = () => held;

const wipeCache = () => Object.keys(cacheStore).forEach(k => delete cacheStore[k]);

// 1
const first = sandbox.publicProgramCalendar({});
ok('nothing stored: builds once', builds === 1 && first.ok === true);
ok('...stamps builtAt', typeof first.builtAt === 'number' && first.builtAt > 0);
ok('...caches it in more than one chunk', Object.keys(cacheStore).length >= 3);
ok('...and writes the Drive fallback', Object.keys(files).length === 1
  && !!props.PUBLIC_SCHEDULE_SNAPSHOT_FILE_V1);

// 2
const second = sandbox.publicProgramCalendar({});
ok('something stored: no second build', builds === 1 && second.builtAt === first.builtAt);

// 3
wipeCache();
const third = sandbox.publicProgramCalendar({});
ok('cold cache: served from Drive without a build', builds === 1 && third.builtAt === first.builtAt);
ok('...and the cache is warm again', Object.keys(cacheStore).length >= 3);

// 9
const chunkKey = Object.keys(cacheStore).find(k => k.indexOf('#1') !== -1);
delete cacheStore[chunkKey];
const ninth = sandbox.publicProgramCalendar({});
ok('a chunk evicted alone: falls through to Drive rather than half-parsing',
  builds === 1 && ninth.builtAt === first.builtAt);

// 5
sandbox.publicProgramCalendar({ fresh: true });
ok('Refresh within a minute of the last build: no rebuild', builds === 1);
const fileId = props.PUBLIC_SCHEDULE_SNAPSHOT_FILE_V1;
const aged = JSON.parse(files[fileId]); aged.builtAt = Date.now() - 5 * 60 * 1000;
files[fileId] = JSON.stringify(aged); wipeCache();
const fresh = sandbox.publicProgramCalendar({ fresh: true });
ok('Refresh on an older snapshot: rebuilds', builds === 2 && fresh.builtAt > aged.builtAt);

// 4
const stale = JSON.parse(files[fileId]); stale.todayKey = '2000-01-01';
files[fileId] = JSON.stringify(stale); wipeCache();
sandbox.publicProgramCalendar({});
ok('a snapshot from a previous day is rebuilt, not served', builds === 3);

// 6
const before = files[fileId];
buildThrows = true;
ok('trigger: a failed build reports failure', sandbox.refreshPublicScheduleSnapshot() === false);
ok('...and stores nothing', files[fileId] === before);
buildThrows = false;
ok('...so the last good snapshot is still served', sandbox.publicProgramCalendar({}).ok === true
  && builds === 4);

// 7
held = true;
const count = builds;
ok('trigger: stands down while a sync holds the workbook',
  sandbox.refreshPublicScheduleSnapshot() === false && builds === count);
held = false;
ok('...and rebuilds when it does not', sandbox.refreshPublicScheduleSnapshot() === true
  && builds === count + 1);

// 8
const cal = sandbox.getScheduleSnapshot(JSON.stringify({ mode: 'public' }));
const reg = sandbox.getScheduleSnapshot(JSON.stringify({ mode: 'regular' }));
ok('getScheduleSnapshot: the calendar shape for mode=public', Array.isArray(cal.sessions));
ok('...the weekly shape for mode=regular, carrying the same builtAt',
  Array.isArray(reg.programs) && reg.programs.length === 1 && reg.builtAt === cal.builtAt);

console.log(fail ? `\n${fail} failed` : '\nAll public schedule snapshot checks passed');
if (fail) process.exit(1);
