// THE PUBLIC PAGES, PUBLISHED AS FILES (99zu).
//
// Run against an in-memory fake of GitHub's Contents API (shas, 422 on a stale
// or missing sha, 404 on a missing file), because the failure modes that matter
// are the ones a real repository produces on the fourth push, not the first.
//
// What has to hold:
//   1. NOT SET UP = NOTHING HAPPENS: no request is made, from the trigger or
//      from anywhere else, and a page view never publishes.
//   2. THE FIRST PUBLISH writes all four files, JSON before HTML, under the
//      configured folder, with the token only in the Authorization header.
//   3. "SKIP THE PUSH IF UNCHANGED": a rebuild that differs only in builtAt /
//      generatedAt makes ZERO requests; a real change pushes the JSON files
//      and not the HTML; the remembered sha is used (no GET first).
//   4. THE HEARTBEAT: an unchanged JSON file is re-pushed after 3 hours, the
//      static HTML is not.
//   5. A STALE SHA (state lost, file moved) is healed with one GET and one
//      retry — and a remote that already equals ours costs no commit.
//   6. FAILURE NEVER THROWS, never blocks the sync, and is filed for the office
//      once a day after three runs in a row.
//   7. NOTHING NEW LEAVES THE WORKBOOK: the files carry the agreed fields and
//      nothing else, and the HTML carries no data at all.
//   8. THE SNIPPET switches to Pages only once all four files are live, and its
//      listener then accepts Pages' origin as well as Google's.
//   9. SETUP validates, verifies with GitHub, warns about a private repo, and
//      OFF forgets everything including the token.
const vm = require('vm');
const crypto = require('crypto');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TOKEN = 'github_pat_SECRETSECRETSECRET';

// ---------------------------------------------------------------------------
// The fake GitHub.
// ---------------------------------------------------------------------------
const repoFiles = {};          // path -> { b64, sha }
let shaSeq = 0;
const requests = [];           // every UrlFetchApp call, in order
let repoInfo = { status: 200, body: { private: false, permissions: { push: true } } };
let forceStatus = null;        // make every contents request answer this status
let throwOnFetch = false;

function response(status, body) {
  return { getResponseCode: () => status, getContentText: () => JSON.stringify(body || {}) };
}

function fakeFetch(url, options) {
  if (throwOnFetch) throw new Error('Address unavailable');
  const method = String(options.method || 'get').toLowerCase();
  const payload = options.payload ? JSON.parse(options.payload) : null;
  requests.push({ url, method, options, payload });
  const path = url.replace('https://api.github.com', '');
  if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return response(repoInfo.status, repoInfo.body);
  if (forceStatus) return response(forceStatus, { message: 'Bad credentials' });
  const m = /^\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/.exec(path);
  const file = decodeURIComponent(m[1]);
  if (method === 'get') {
    if (!repoFiles[file]) return response(404, { message: 'Not Found' });
    return response(200, { sha: repoFiles[file].sha, encoding: 'base64',
      content: repoFiles[file].b64.replace(/(.{60})/g, '$1\n') });
  }
  const existing = repoFiles[file];
  if (existing && payload.sha !== existing.sha) return response(422, { message: "sha wasn't supplied" });
  if (!existing && payload.sha) return response(422, { message: 'sha does not match' });
  const sha = 'sha' + (++shaSeq);
  repoFiles[file] = { b64: payload.content, sha };
  return response(existing ? 200 : 201, { content: { sha } });
}

const props = {};
const logs = [];
const notes = [];
const alerts = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd' ? dateKey(d) : 'Sep 28, 9:00 AM'),
    getUuid: () => 'x', sleep: () => {},
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text)).digest())
      .map(b => (b > 127 ? b - 256 : b)),
    base64Encode: (text) => Buffer.from(String(text), 'utf8').toString('base64')
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (key, value) => { props[key] = String(value); },
      deleteProperty: key => { delete props[key]; }
    })
  },
  CacheService: { getScriptCache: () => null },
  DriveApp: {
    getFileById: () => { throw new Error('no file'); },
    createFile: () => ({ getId: () => 'f1' })
  },
  UrlFetchApp: { fetch: fakeFetch },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, LockService: {}, HtmlService: {},
  MailApp: {}, DocumentApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });
// A clock the test can move: the heartbeat is about elapsed time.
vm.runInContext('var __realNow = Date.now.bind(Date); var __skew = 0; Date.now = function () { return __realNow() + __skew; };', sandbox);

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// ---------------------------------------------------------------------------
// Fixture: a snapshot with every field the public pages may carry.
// ---------------------------------------------------------------------------
const todayKey = dateKey(new Date());
const VIEW = 'https://docs.google.com/forms/d/e/ABC/viewform';
const sessionRow = (offset, over) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return Object.assign({
    id: `${dateKey(d)}|EV`, dateKey: dateKey(d), weekday: 'Mon', dayLabel: 'Monday, October 5',
    shortLabel: 'Mon Oct 5', monthLabel: 'October 2026', title: 'Chair Yoga',
    programKey: 'chair yoga|narberth', location: 'Narberth', time: '9:30 AM', sortTime: '0930',
    lunch: false, club: false, appointment: false, url: VIEW, state: 'open', seats: 'Seats available'
  }, over || {});
};
let builtAtSeq = 1000;
let sessions = [sessionRow(0), sessionRow(7), sessionRow(14)];
sandbox.buildPublicProgramCalendar = () => ({
  ok: true, generatedAt: 'built ' + (++builtAtSeq), todayKey, horizonKey: todayKey,
  intro: { name: 'The Centre', blurb: 'Hello', phone: '555', email: 'a@b.c', places: ['Narberth'] },
  locations: ['Narberth'], sessions
});
sandbox.getOrCreateSystemFolder = () => null;
sandbox.log = msg => { logs.push(String(msg)); };
sandbox.spoolOfficeNote = (section, message) => { notes.push({ section, message }); return true; };
sandbox.workbookHeldElsewhere = () => false;
sandbox.requireAuthorizedAdmin = () => true;

const configure = (extra) => {
  props.PUBLIC_PAGES_SETTINGS_PROP_KEY_ = undefined;
  props.PUBLIC_PAGES_SETTINGS_V1 = JSON.stringify(Object.assign(
    { repo: 'my-org/public-schedule', branch: 'main', folder: '' }, extra || {}));
  props.PUBLIC_PAGES_GITHUB_TOKEN_V1 = TOKEN;
};
const reset = () => {
  Object.keys(props).forEach(k => delete props[k]);
  Object.keys(repoFiles).forEach(k => delete repoFiles[k]);
  requests.length = 0; logs.length = 0; notes.length = 0;
  forceStatus = null; throwOnFetch = false;
  sandbox.__skew = 0;
  vm.runInContext('__skew = 0', sandbox);
};
const names = list => list.map(r => decodeURIComponent(r.url.split('/contents/')[1]));
const puts = () => requests.filter(r => r.method === 'put');

// ---------------------------------------------------------------------------
// 1. Not set up = nothing happens.
// ---------------------------------------------------------------------------
reset();
ok('not set up: the trigger builds and makes no request',
  sandbox.refreshPublicScheduleSnapshot() === true && requests.length === 0);
ok('...nor does the end of a calendar sync',
  (sandbox.refreshPublicScheduleSnapshotAfterSync_(), requests.length === 0));
configure();
const viewsBefore = requests.length;
sandbox.publicProgramCalendar({ fresh: true });
sandbox.getScheduleSnapshot(JSON.stringify({ mode: 'regular', fresh: true }));
ok('a page view never publishes, even when set up', requests.length === viewsBefore);
reset();
props.PUBLIC_PAGES_SETTINGS_V1 = JSON.stringify({ repo: 'my-org/public-schedule' });
ok('settings without a token publish nothing',
  sandbox.publishPublicPagesToGitHub_(sandbox.buildPublicProgramCalendar(), {}).reason === 'not configured'
  && requests.length === 0);

// ---------------------------------------------------------------------------
// 2. The first publish.
// ---------------------------------------------------------------------------
reset();
configure({ folder: 'docs' });
const first = sandbox.refreshPublicScheduleSnapshot();
ok('the trigger publishes once configured', first === true);
ok('all four files are pushed, under the folder',
  JSON.stringify(Object.keys(repoFiles).sort())
  === JSON.stringify(['docs/index.html', 'docs/regular.html', 'docs/regular.json', 'docs/schedule.json']));
const order = names(puts());
ok('...JSON before HTML, so a page is never live ahead of its data',
  order.indexOf('docs/schedule.json') < order.indexOf('docs/index.html')
  && order.indexOf('docs/regular.json') < order.indexOf('docs/regular.html'));
ok('the token travels only in the Authorization header',
  requests.every(r => r.options.headers.Authorization === 'Bearer ' + TOKEN)
  && requests.every(r => !(r.options.payload || '').includes(TOKEN) && !r.url.includes(TOKEN))
  && logs.every(l => !l.includes(TOKEN)));
ok('...and every request names the API version and the repository',
  requests.every(r => r.options.headers['X-GitHub-Api-Version'] && r.url.indexOf('/repos/my-org/public-schedule/') !== -1));
ok('the commit targets the configured branch',
  puts().every(r => r.payload.branch === 'main'));
const pushedSchedule = JSON.parse(Buffer.from(repoFiles['docs/schedule.json'].b64, 'base64').toString('utf8'));
ok('schedule.json is the snapshot, builtAt included (the pages compare it)',
  pushedSchedule.ok === true && pushedSchedule.sessions.length === 3 && typeof pushedSchedule.builtAt === 'number');
const pushedRegular = JSON.parse(Buffer.from(repoFiles['docs/regular.json'].b64, 'base64').toString('utf8'));
ok('regular.json is the weekly fold of the same snapshot, same builtAt',
  pushedRegular.programs.length === 1 && pushedRegular.builtAt === pushedSchedule.builtAt);

// ---------------------------------------------------------------------------
// 3. Skip the push if unchanged.
// ---------------------------------------------------------------------------
requests.length = 0;
sandbox.refreshPublicScheduleSnapshot();
ok('a rebuild that differs only in builtAt / generatedAt makes ZERO requests', requests.length === 0);

sessions = sessions.concat([sessionRow(21)]);
requests.length = 0;
sandbox.refreshPublicScheduleSnapshot();
ok('a real change pushes the two JSON files and not the HTML',
  JSON.stringify(names(puts()).sort()) === JSON.stringify(['docs/regular.json', 'docs/schedule.json']));
ok('...using the remembered sha, with no GET first',
  requests.every(r => r.method === 'put') && puts().every(r => !!r.payload.sha));

requests.length = 0;
sessions = sessions.map((s, i) => i === 0 ? Object.assign({}, s, { state: 'waitlist', seats: 'Waiting list' }) : s);
sandbox.refreshPublicScheduleSnapshotAfterSync_();
ok('the end of a calendar sync publishes the same way', puts().length === 2);

// ---------------------------------------------------------------------------
// 4. The heartbeat.
// ---------------------------------------------------------------------------
requests.length = 0;
vm.runInContext('__skew = ' + (3 * 60 * 60 * 1000 + 5000), sandbox);
sandbox.refreshPublicScheduleSnapshot();
ok('an unchanged JSON file is pushed again after the heartbeat; the HTML is not',
  JSON.stringify(names(puts()).sort()) === JSON.stringify(['docs/regular.json', 'docs/schedule.json']));
requests.length = 0;
sandbox.refreshPublicScheduleSnapshot();
ok('...and then it is quiet again', requests.length === 0);

// ---------------------------------------------------------------------------
// 5. A stale sha is healed; an identical remote costs no commit.
// ---------------------------------------------------------------------------
sessions = sessions.concat([sessionRow(28)]);
repoFiles['docs/schedule.json'].sha = 'moved-under-us';   // someone edited it by hand
requests.length = 0;
sandbox.refreshPublicScheduleSnapshot();
const healed = requests.filter(r => decodeURIComponent(r.url).indexOf('docs/schedule.json') !== -1);
ok('a stale sha: PUT is refused, one GET fetches the real sha, one retry succeeds',
  healed.map(r => r.method).join(',') === 'put,get,put'
  && healed[2].payload.sha === 'moved-under-us');

reset();
configure();
sandbox.refreshPublicScheduleSnapshot();                      // repo now holds the files
Object.keys(props).filter(k => k === 'PUBLIC_PAGES_PUBLISH_STATE_V1').forEach(k => delete props[k]); // state lost
const shasBefore = JSON.stringify(Object.keys(repoFiles).map(k => repoFiles[k].sha));
sandbox.publishPublicPagesToGitHub_(JSON.parse(Buffer.from(repoFiles['schedule.json'].b64, 'base64').toString('utf8')), {});
ok('state lost but the remote already equals ours: no new commit for the JSON',
  JSON.stringify(Object.keys(repoFiles).map(k => repoFiles[k].sha)) === shasBefore
  && Object.keys(JSON.parse(props.PUBLIC_PAGES_PUBLISH_STATE_V1).files).length === 4);

// ---------------------------------------------------------------------------
// 6. Failure never throws, and is filed once a day.
// ---------------------------------------------------------------------------
reset();
configure();
forceStatus = 401;
let threw = false;
let res;
try { res = sandbox.publishPublicPagesToGitHub_(sandbox.buildPublicProgramCalendar(), {}); } catch (e) { threw = true; }
ok('a refused push does not throw and reports every file as failed',
  !threw && res.ok === false && res.failed.length === 4 && res.failed[0].error.indexOf('401') !== -1);
ok('...nothing is filed for the office after one failed run', notes.length === 0);
sandbox.refreshPublicScheduleSnapshot();
sandbox.refreshPublicScheduleSnapshot();
ok('...but after three runs in a row it is, once', notes.length === 1 && notes[0].section === 'Public schedule');
sandbox.refreshPublicScheduleSnapshot();
sandbox.refreshPublicScheduleSnapshot();
ok('...and not again the same day', notes.length === 1);
ok('the note carries no token', notes.every(n => n.message.indexOf(TOKEN) === -1));
forceStatus = null;
sandbox.refreshPublicScheduleSnapshot();
ok('a later success pushes the files and resets the count',
  Object.keys(repoFiles).length === 4 && JSON.parse(props.PUBLIC_PAGES_PUBLISH_STATE_V1).failures === 0);

reset();
configure();
throwOnFetch = true;
threw = false;
try { sandbox.refreshPublicScheduleSnapshot(); } catch (e) { threw = true; }
ok('a network error (UrlFetchApp throws) is swallowed per file', !threw);

// ---------------------------------------------------------------------------
// 7. Nothing new leaves the workbook.
// ---------------------------------------------------------------------------
reset();
configure();
sessions = [sessionRow(0), sessionRow(7), sessionRow(14)];
sandbox.refreshPublicScheduleSnapshot();
const ALLOWED = ['id', 'dateKey', 'weekday', 'dayLabel', 'shortLabel', 'monthLabel', 'title',
  'programKey', 'location', 'time', 'sortTime', 'lunch', 'club', 'appointment', 'url',
  'state', 'seats'];
const read = name => Buffer.from(repoFiles[name].b64, 'base64').toString('utf8');
const sched = JSON.parse(read('schedule.json'));
ok('schedule.json: the top level is the snapshot and nothing more',
  Object.keys(sched).sort().join(',') === 'builtAt,generatedAt,horizonKey,intro,locations,ok,sessions,todayKey');
ok('...every session carries only the agreed fields',
  sched.sessions.every(s => Object.keys(s).every(k => ALLOWED.indexOf(k) !== -1)));
const reg = JSON.parse(read('regular.json'));
ok('regular.json: its sessions are the same rows, untouched',
  reg.programs[0].sessions.every(s => Object.keys(s).every(k => ALLOWED.indexOf(k) !== -1)));
ok('no file mentions a registrant', ['schedule.json', 'regular.json', 'index.html', 'regular.html']
  .every(n => read(n).toLowerCase().indexOf('registrant') === -1));
ok('the HTML pages carry no data: no title, no form link, no phone',
  ['index.html', 'regular.html'].every(n => read(n).indexOf('Chair Yoga') === -1
    && read(n).indexOf(VIEW) === -1 && read(n).indexOf('555') === -1));
ok('...and name their data file and the Apps Script fallback',
  read('index.html').indexOf('schedule.json') !== -1
  && read('index.html').indexOf('https://script.google.com/macros/s/ABC/exec?mode=public') !== -1
  && read('regular.html').indexOf('regular.json') !== -1
  && read('regular.html').indexOf('exec?mode=regular') !== -1);

// ---------------------------------------------------------------------------
// 8. The snippet.
// ---------------------------------------------------------------------------
reset();
const execUrl = 'https://script.google.com/macros/s/ABC/exec?mode=public&embed=1';
ok('not set up: the embed is the Apps Script address, as ever',
  sandbox.publicCalendarEmbedUrl({}) === execUrl);
configure();
ok('configured but nothing published yet: still the Apps Script address (no 404 window)',
  sandbox.publicCalendarEmbedUrl({}) === execUrl
  && sandbox.publicRegularEmbedUrl({}).indexOf('script.google.com') !== -1);
sandbox.refreshPublicScheduleSnapshot();
ok('once all four files are live: the Pages address',
  sandbox.publicCalendarEmbedUrl({}) === 'https://my-org.github.io/public-schedule/index.html?embed=1');
ok('...a pinned building and range are carried, spelled as the printed links spell them',
  sandbox.publicCalendarEmbedUrl({ location: "St. John's", span: 'weekly' })
    === "https://my-org.github.io/public-schedule/index.html?span=week&embed=1&building=St.%20John's");
ok('...and the weekly page has its own file',
  sandbox.publicRegularEmbedUrl({}) === 'https://my-org.github.io/public-schedule/regular.html?embed=1');
const snippet = sandbox.publicCalendarEmbedSnippet({});
ok('the snippet frames the Pages address',
  snippet.indexOf('src="https://my-org.github.io/public-schedule/index.html?embed=1"') !== -1);
ok('...its listener accepts Pages\' origin AND Google\'s (the fallback page posts from there)',
  snippet.indexOf('origin !== "https://my-org.github.io"') !== -1 && snippet.indexOf('googleusercontent') !== -1);
ok('...still keyed on the message type and mode, still never on event.source',
  snippet.indexOf('programCalendarHeight.v1') !== -1 && snippet.indexOf('data.mode !== "public"') !== -1
  && snippet.indexOf('event.source') === -1);
const execSnippet = (reset(), sandbox.publicCalendarEmbedSnippet({}));
ok('the Apps Script snippet has no extra origin',
  execSnippet.indexOf('origin !==') === -1 && execSnippet.indexOf('googleusercontent') !== -1);
ok('a custom domain is honoured',
  (configure({ baseUrl: 'https://schedule.example.org' }),
    sandbox.publishPublicPagesToGitHub_(sandbox.buildPublicProgramCalendar(), {}),
    sandbox.publicCalendarEmbedUrl({}) === 'https://schedule.example.org/index.html?embed=1'));
ok('a user-site repository is served from the bare address',
  (reset(), configure({ repo: 'My-Org/my-org.github.io' }),
    sandbox.publishPublicPagesToGitHub_(sandbox.buildPublicProgramCalendar(), {}),
    sandbox.publicCalendarEmbedUrl({}) === 'https://my-org.github.io/index.html?embed=1'));

// ---------------------------------------------------------------------------
// 9. Setup.
// ---------------------------------------------------------------------------
reset();
const norm = sandbox.normalizePublicPagesSettings_;
ok('settings: owner/name, a URL and a .git suffix are all accepted',
  norm({ repo: 'a/b' }).repo === 'a/b' && norm({ repo: 'https://github.com/a/b.git' }).repo === 'a/b');
ok('...anything else is refused before it reaches a URL',
  norm({ repo: 'not a repo' }) === null && norm({ repo: 'a/b/c' }) === null
  && norm({ repo: 'a/b', branch: 'x y' }) === null && norm({ repo: 'a/b', branch: 'a..b' }) === null
  && norm({ repo: 'a/b', folder: '../etc' }) === null && norm({ repo: 'a/b', baseUrl: 'http://x/' }) === null);
ok('...a folder is trimmed of slashes and a base URL gets its trailing one',
  norm({ repo: 'a/b', folder: '/docs/' }).folder === 'docs'
  && norm({ repo: 'a/b', baseUrl: 'https://x.org' }).baseUrl === 'https://x.org/');

const bad = sandbox.savePublicPagesSetup_({ repo: 'nope', token: TOKEN });
ok('setup with a bad repository stores nothing', bad.ok === false && !props.PUBLIC_PAGES_GITHUB_TOKEN_V1);
repoInfo = { status: 404, body: { message: 'Not Found' } };
const missing = sandbox.savePublicPagesSetup_({ repo: 'a/b', token: TOKEN });
ok('a repository the token cannot see is reported and nothing is stored',
  missing.ok === false && missing.message.indexOf('404') !== -1 && !props.PUBLIC_PAGES_GITHUB_TOKEN_V1);
repoInfo = { status: 200, body: { private: false, permissions: { push: false } } };
ok('a read-only token is refused, in words',
  sandbox.savePublicPagesSetup_({ repo: 'a/b', token: TOKEN }).message.indexOf('Contents: Read and write') !== -1);
repoInfo = { status: 200, body: { private: false, permissions: { push: true } } };
const good = sandbox.savePublicPagesSetup_({ repo: 'a/b', branch: 'main', folder: '', token: TOKEN });
ok('setup stores the settings and the token, and publishes once, forced',
  good.ok === true && props.PUBLIC_PAGES_GITHUB_TOKEN_V1 === TOKEN && puts().length === 4);
ok('...and tells the admin the address and the Pages setting to switch on',
  good.url === 'https://a.github.io/b/index.html' && good.message.indexOf('Settings ▸ Pages') !== -1);
ok('...the token is not in the message or the log',
  good.message.indexOf(TOKEN) === -1 && logs.every(l => l.indexOf(TOKEN) === -1));
const kept = sandbox.savePublicPagesSetup_({ repo: 'a/b', token: '' });
ok('a blank token keeps the stored one', kept.ok === true && props.PUBLIC_PAGES_GITHUB_TOKEN_V1 === TOKEN);
repoInfo = { status: 200, body: { private: true, permissions: { push: true } } };
ok('a private repository is warned about',
  sandbox.savePublicPagesSetup_({ repo: 'a/b', token: TOKEN }).message.indexOf('PRIVATE') !== -1);
repoInfo = { status: 200, body: { private: false, permissions: { push: true } } };
ok('the status line says where it is publishing and that a token is stored, never what it is',
  sandbox.describePublicPagesStatus_().indexOf('a/b') !== -1
  && sandbox.describePublicPagesStatus_().indexOf('token stored') !== -1
  && sandbox.describePublicPagesStatus_().indexOf(TOKEN) === -1);
const off = sandbox.savePublicPagesSetup_({ off: true });
ok('OFF forgets the settings, the token and the state',
  off.ok === true && !props.PUBLIC_PAGES_GITHUB_TOKEN_V1 && !props.PUBLIC_PAGES_SETTINGS_V1
  && !props.PUBLIC_PAGES_PUBLISH_STATE_V1);
ok('...and the embed is the Apps Script address again', sandbox.publicCalendarEmbedUrl({}) === execUrl);

// The menu path: four prompts in, one alert out, gated.
reset();
const answers = ['a/b', 'main docs', TOKEN, ''];
let asked = 0;
sandbox.SpreadsheetApp.getUi = () => ({
  ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' }, Button: { OK: 'OK' },
  prompt: () => { const text = answers[asked++]; return { getSelectedButton: () => 'OK', getResponseText: () => text }; },
  alert: (title, text) => { alerts.push(text); }
});
sandbox.setUpPublicPagesPublishing();
ok('the menu item asks four things and publishes under the folder it was given',
  asked === 4 && !!repoFiles['docs/schedule.json'] && alerts.length === 1);
let gated = false;
sandbox.requireAuthorizedAdmin = name => { gated = name === 'Set Up GitHub Pages Schedule'; return false; };
asked = 0;
sandbox.setUpPublicPagesPublishing();
ok('it is behind the admin gate, under the name the gate list holds',
  gated && asked === 0 && sandbox.isAdminGatedAction('Set Up GitHub Pages Schedule'));

console.log(fail ? `\n${fail} failed` : '\nAll GitHub Pages publisher checks passed');
if (fail) process.exit(1);
