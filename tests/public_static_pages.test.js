// THE STATIC FORM OF THE PUBLIC PAGES (91's banner 18c, 87/93's `static` option).
//
// Two halves.
//
// A. NODE ONLY, always run:
//    1. The query string is read in the BROWSER now, and the four readers
//       Apps Script has on the server (embed, building, span, q) are written a
//       second time in JavaScript. Two implementations of one rule is how they
//       drift, so this runs both over the same inputs and demands equal answers.
//    2. The static documents carry no data, name their data file and the Apps
//       Script fallback, and the Apps Script form is unchanged.
//    3. Every script block compiles.
//
// B. IN A REAL BROWSER, when Playwright and Chromium are installed (skipped,
//    loudly, when they are not — this repo has no dependencies and the rest of
//    the suite must run without them): the page draws from the fetched JSON,
//    the embed skin is on before first paint, a pinned building and a span
//    and a search are honoured, a failed / stale / empty fetch hands the visitor
//    to the Apps Script page WITH the query string, Refresh brings in a newer
//    file without a reload, the frame's height reaches the host page, and the
//    page throws nothing.
const vm = require('vm');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

const scriptBlocks = html => {
  const out = []; const re = /<script>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
};
const parses = js => { try { new vm.Script(js); return ''; } catch (e) { return String(e); } };

// ---------------------------------------------------------------------------
// A1. The client's readers equal the server's.
// ---------------------------------------------------------------------------
const calendarDoc = sandbox.publicStaticDocument('Programs & Sign-Ups',
  sandbox.buildPublicCalendarHtml(null, { static: { dataUrl: 'schedule.json', execUrl: 'https://script.google.com/macros/s/ABC/exec?mode=public' } }),
  'schedule.json');
const regularDoc = sandbox.publicStaticDocument('Regular Programs',
  sandbox.buildPublicRegularHtml(null, { static: { dataUrl: 'regular.json', execUrl: 'https://script.google.com/macros/s/ABC/exec?mode=regular' } }),
  'regular.json');
const headScript = scriptBlocks(calendarDoc)[0];

function clientParams(search) {
  const ctx = {
    window: { location: { search }, fetch: undefined },
    document: { documentElement: { className: '' } },
    URLSearchParams
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(headScript, ctx);
  return { params: vm.runInContext('publicStaticParams()', ctx), cls: ctx.document.documentElement.className };
}
function serverParams(search) {
  const parameter = {};
  new URLSearchParams(search).forEach((v, k) => { if (!(k in parameter)) parameter[k] = v; });
  return sandbox.publicCalendarViewOptions(parameter);
}

const searches = [
  '', '?embed=1', '?embed', '?embed=', '?embed=0', '?embed=no', '?embed=false', '?embed=YES',
  '?building=Narberth', '?building=%20Narberth%20', '?location=Ashbridge', '?loc=Ashbridge',
  '?building=A&location=B', '?building=&location=B',
  '?span=week', '?span=weekly', '?span=this-week', '?span=7', '?span=month', '?span=31',
  '?span=all', '?span=0', '?range=month', '?span=bogus', '?span=constructor', '?span=',
  '?q=tai+chi', '?q=%20%20tai%20%20%20chi%20', '?q=' + 'x'.repeat(150), '?q=', '?q=a%20b' + '%20'.repeat(200) + 'c',
  '?q=%3C%2Fscript%3E', '?embed=1&building=Narberth&span=week&q=yoga',
  '?mode=public&embed=1&span=monthly'
];
let parityOk = true;
searches.forEach(search => {
  const c = clientParams(search).params;
  const s = serverParams(search);
  const same = c.embed === s.embed && c.location === s.location && c.span === s.span && c.query === s.query;
  if (!same) { parityOk = false; console.log('     differs for ' + search + ': ' + JSON.stringify(c) + ' vs ' + JSON.stringify(s)); }
});
ok(`the browser reads ${searches.length} query strings exactly as the server does`, parityOk);
ok('the embed class is set from <head>, before anything is drawn',
  clientParams('?embed=1').cls.indexOf('is-embed') !== -1 && clientParams('').cls.indexOf('is-embed') === -1
  && clientParams('?embed=0').cls.indexOf('is-embed') === -1);

// ---------------------------------------------------------------------------
// A2. What the static documents are.
// ---------------------------------------------------------------------------
ok('the document is a whole page: doctype, charset, viewport, title',
  calendarDoc.indexOf('<!doctype html>') === 0 && calendarDoc.indexOf('<meta charset="utf-8">') !== -1
  && calendarDoc.indexOf('name="viewport"') !== -1 && calendarDoc.indexOf('<title>Programs &amp; Sign-Ups</title>') !== -1);
ok('the fetch starts in <head>, before the body is parsed',
  calendarDoc.indexOf('window.fetch("schedule.json"') !== -1
  && calendarDoc.indexOf('window.fetch("schedule.json"') < calendarDoc.indexOf('<body>'));
ok('...and the regular page fetches its own file',
  regularDoc.indexOf('window.fetch("regular.json"') !== -1);
ok('the static page has no data in it', calendarDoc.indexOf('var DATA = null') !== -1
  && calendarDoc.indexOf('JSON.parse("{\\"ok\\"') === -1);
ok('the header is always in the markup (embed hides it by class, not by omission)',
  calendarDoc.indexOf('<h1 id="orgName">') !== -1 && calendarDoc.indexOf('html.is-embed header { display: none; }') !== -1);
ok('the embed skin is scoped under html.is-embed, not unconditional',
  calendarDoc.indexOf('html.is-embed .wrap') !== -1 && calendarDoc.indexOf('\n  .wrap { padding: 0 2px 2px 2px') === -1);
ok('the fallback address is baked in, and only the page\'s own query string is appended at run time',
  calendarDoc.indexOf('"execUrl\\":\\"https://script.google.com/macros/s/ABC/exec?mode=public') !== -1
  && calendarDoc.indexOf('window.location.replace(url)') !== -1);
ok('the stale cut-off and the timeout are the constants in 91',
  calendarDoc.indexOf(`staleMs\\":${vm.runInContext('PUBLIC_STATIC_STALE_AFTER_MS', sandbox)}`) !== -1
  && calendarDoc.indexOf(`timeoutMs\\":${vm.runInContext('PUBLIC_STATIC_FETCH_TIMEOUT_MS', sandbox)}`) !== -1);
ok('the frame\'s height is still posted to window.top, tagged with the mode',
  calendarDoc.indexOf('window.top.postMessage') !== -1 && calendarDoc.indexOf('var HEIGHT_MODE = "public"') !== -1
  && regularDoc.indexOf('var HEIGHT_MODE = "regular"') !== -1
  && calendarDoc.indexOf('programCalendarHeight.v1') !== -1);
ok('the static page never calls google.script.run on the path it runs',
  calendarDoc.indexOf('if (STATIC_MODE) {\n      refreshStatic(') !== -1);

const inlineHtml = sandbox.buildPublicCalendarHtml({ ok: true, sessions: [], locations: [], todayKey: '2026-10-01' }, {});
ok('the Apps Script form is unchanged in kind: data inlined, no loader, no <head> script',
  inlineHtml.indexOf('var STATIC_MODE = false') !== -1 && inlineHtml.indexOf('function loadStatic') === -1
  && inlineHtml.indexOf('publicStaticParams') === -1 && inlineHtml.indexOf('var DATA = JSON.parse(') !== -1);
ok('...and the embed skin there is still unconditional, written server-side',
  sandbox.buildPublicCalendarHtml({ ok: true, sessions: [], locations: [] }, { embed: true })
    .indexOf('\n  .wrap { padding: 0 2px 2px 2px; max-width: none; }') !== -1
  && sandbox.buildPublicCalendarHtml({ ok: true, sessions: [], locations: [] }, { embed: true })
    .indexOf('<h1 id="orgName">') === -1);

// ---------------------------------------------------------------------------
// A3. Every script block compiles.
// ---------------------------------------------------------------------------
[['calendar', calendarDoc], ['regular', regularDoc]].forEach(([name, html]) => {
  const blocks = scriptBlocks(html);
  ok(`the static ${name} page has a head script and a page script`, blocks.length === 2);
  blocks.forEach((js, i) => {
    const error = parses(js);
    ok(`...script block ${i + 1} parses in a browser`, error === '');
    if (error) console.log('     ' + error);
  });
});

// ---------------------------------------------------------------------------
// B. A real browser.
// ---------------------------------------------------------------------------
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* try the global install */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (e) { return null; }
}

async function browserHalf() {
  const pw = loadPlaywright();
  if (!pw) { console.log('skip browser checks: Playwright is not installed'); return; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) {
    console.log('skip browser checks: Chromium could not be launched (' + String(e).slice(0, 80) + ')');
    return;
  }

  // The data the server will hand out, and what it can be made to do wrong.
  const today = new Date();
  const row = (offset, title, location, extra) => {
    const d = new Date(today); d.setDate(d.getDate() + offset);
    return Object.assign({
      id: `${dateKey(d)}|${title}`, dateKey: dateKey(d), weekday: 'Mon', dayLabel: 'Monday, October 5',
      shortLabel: 'Mon Oct 5', monthLabel: 'October 2026', title, programKey: `${title.toLowerCase()}|${location.toLowerCase()}`,
      location, time: '9:30 AM', sortTime: '0930', lunch: false, club: false, appointment: false,
      url: 'https://docs.google.com/forms/d/e/ABC/viewform', state: 'open', seats: 'Seats available'
    }, extra || {});
  };
  const snapshot = (sessions, builtAt) => ({
    ok: true, generatedAt: 'Oct 1, 9:00 AM', todayKey: dateKey(today), horizonKey: dateKey(today),
    intro: { name: 'The Centre', blurb: 'Hello', phone: '555-0100', email: 'a@b.c', places: ['Narberth', 'Ashbridge'] },
    locations: ['Ashbridge', 'Narberth'],
    // The page stops reading at the first session past its window, as the real snapshot is sorted by date.
    sessions: (sessions || []).slice().sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0)), builtAt
  });
  const state = {
    sessions: [row(0, 'Chair Yoga', 'Narberth'), row(7, 'Chair Yoga', 'Narberth'), row(14, 'Chair Yoga', 'Narberth'),
      row(21, 'Chair Yoga', 'Narberth'), row(0, 'Tai Chi', 'Ashbridge')],
    builtAt: Date.now(), status: 200, delayMs: 0, raw: null
  };
  const jsonFor = file => {
    const snap = snapshot(state.sessions, state.builtAt);
    return JSON.stringify(file === 'regular.json' ? sandbox.regularProgramsFromSnapshot_(snap) : snap);
  };

  let port = 0;
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push(url.pathname + url.search);
    const send = (type, body, status) => {
      res.writeHead(status || 200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
    };
    if (url.pathname === '/index.html') return send('text/html', sandbox.publicStaticDocument('Programs & Sign-Ups',
      sandbox.buildPublicCalendarHtml(null, { static: { dataUrl: 'schedule.json', execUrl: `http://127.0.0.1:${port}/exec?mode=public` } }), 'schedule.json'));
    if (url.pathname === '/regular.html') return send('text/html', sandbox.publicStaticDocument('Regular Programs',
      sandbox.buildPublicRegularHtml(null, { static: { dataUrl: 'regular.json', execUrl: `http://127.0.0.1:${port}/exec?mode=regular` } }), 'regular.json'));
    if (url.pathname === '/schedule.json' || url.pathname === '/regular.json') {
      const body = state.status !== 200 ? 'nope' : (state.raw !== null ? state.raw : jsonFor(url.pathname.slice(1)));
      return setTimeout(() => send('application/json', body, state.status), state.delayMs);
    }
    if (url.pathname === '/host.html') {
      return send('text/html', `<!doctype html><body><iframe id="f" src="/index.html?embed=1" style="width:900px;height:100px;border:0"></iframe>
        <script>window.heights=[];window.addEventListener('message',function(e){if(e.data&&e.data.type==='programCalendarHeight.v1')window.heights.push(e.data);});</script>`);
    }
    if (url.pathname === '/exec') return send('text/html', '<!doctype html><title>exec</title><h1 id="exec">Apps Script page</h1>');
    send('text/plain', 'not found', 404);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const open = async (url, opts) => {
    const context = await browser.newContext(opts || {});
    // Google Fonts is a render-blocking stylesheet; offline it would only slow the test.
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return { page, errors, context };
  };

  try {
    let t = await open(`${base}/index.html`);
    await t.page.waitForSelector('.prog', { timeout: 5000 });
    const names = await t.page.$$eval('.prog .name', els => els.map(e => e.textContent).sort());
    ok('the page draws one tile per program from the fetched JSON', names.join(',') === 'Chair Yoga,Tai Chi'); if (names.join(',') !== 'Chair Yoga,Tai Chi') console.log('     saw: ' + names.join(','));
    ok('...the centre\'s introduction is there, unframed',
      (await t.page.textContent('#orgName')) === 'The Centre' && await t.page.isVisible('header'));
    ok('...and it threw nothing', t.errors.length === 0);
    await t.context.close();

    t = await open(`${base}/index.html?embed=1&building=narberth&span=month&q=yoga`);
    await t.page.waitForSelector('.prog', { timeout: 5000 });
    ok('embed: the header is hidden and the class was on before the first paint',
      !(await t.page.isVisible('header')) && (await t.page.evaluate(() => document.documentElement.className)).indexOf('is-embed') !== -1);
    ok('...a pinned building (any case) is resolved against the buildings in the data and its pills are gone',
      (await t.page.$$eval('.prog .name', els => els.map(e => e.textContent))).join(',') === 'Chair Yoga'
      && !(await t.page.isVisible('#locbar')));
    ok('...?span=month is the pressed range, ?q= is in the box and shown',
      (await t.page.getAttribute('#r31', 'aria-pressed')) === 'true'
      && (await t.page.inputValue('#q')) === 'yoga' && await t.page.isVisible('#qbar'));
    await t.context.close();

    t = await open(`${base}/index.html`);
    await t.page.waitForSelector('.prog');
    ok('two buildings, nothing pinned: the building pills are offered',
      (await t.page.$$eval("#locbar button", els => els.length)) === 3);
    const tilesBefore = hits.length;
    await t.page.click('#locbar button:nth-child(2)');
    ok('...a filter is arithmetic: no request is made', hits.length === tilesBefore);
    await t.context.close();

    // Refresh brings in a newer file without a reload.
    t = await open(`${base}/index.html`);
    await t.page.waitForSelector('.prog');
    state.sessions = state.sessions.concat([row(0, 'Mah Jongg', 'Narberth')]);
    state.builtAt += 1000;
    await t.page.click('#refresh');
    await t.page.waitForFunction(() => document.querySelectorAll('.prog').length === 3, null, { timeout: 5000 });
    ok('Refresh picks up a newer file in place (no navigation)', (await t.page.url()).endsWith('/index.html'));
    state.sessions = state.sessions.slice(0, 5);
    await t.context.close();

    // The first fetch goes wrong in three ways; each hands over to Apps Script, query string intact.
    for (const [label, setup] of [
      ['a server error', () => { state.status = 500; }],
      ['a file the publisher stopped refreshing (older than 12 hours)', () => { state.builtAt = Date.now() - 13 * 3600 * 1000; }],
      ['a file with nothing usable in it', () => { state.raw = JSON.stringify({ ok: false, message: 'x' }); }]
    ]) {
      const saved = { status: state.status, builtAt: state.builtAt, raw: state.raw };
      setup();
      const url = `${base}/index.html?embed=1&building=Narberth&span=week`;
      t = await open(url);
      try { await t.page.waitForURL(/\/exec\?/, { timeout: 5000 }); } catch (e) { /* asserted below */ }
      const landed = t.page.url();
      ok(`${label}: the visitor is handed to the Apps Script page`, landed.indexOf('/exec?mode=public') !== -1);
      ok('...with the embed, building and span they asked for', landed.indexOf('embed=1') !== -1
        && landed.indexOf('building=Narberth') !== -1 && landed.indexOf('span=week') !== -1);
      await t.context.close();
      Object.assign(state, saved);
    }

    // The frame's height reaches the website around it.
    t = await open(`${base}/host.html`);
    await t.page.waitForFunction(() => window.heights.length > 0, null, { timeout: 8000 });
    const heights = await t.page.evaluate(() => window.heights);
    ok('framed: the host page hears a height, tagged public, from the Pages origin',
      heights[0].mode === 'public' && heights[0].height > 50);
    await t.context.close();

    // The weekly page.
    t = await open(`${base}/regular.html`);
    await t.page.waitForSelector('.prog', { timeout: 5000 });
    ok('the weekly page draws its weekday column from regular.json',
      (await t.page.textContent('h2.day')).indexOf('Every Monday') !== -1 && t.errors.length === 0);
    await t.context.close();

    // No fallback address at all: say so rather than spin.
    state.status = 500;
    const noExec = http.createServer((req, res) => {
      if (req.url.indexOf('/index.html') === 0) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(sandbox.publicStaticDocument('x', sandbox.buildPublicCalendarHtml(null, { static: { dataUrl: 'schedule.json', execUrl: '' } }), 'schedule.json'));
      } else { res.writeHead(500); res.end('x'); }
    });
    await new Promise(r => noExec.listen(0, '127.0.0.1', r));
    t = await open(`http://127.0.0.1:${noExec.address().port}/index.html`);
    await t.page.waitForSelector('.notice', { timeout: 5000 });
    ok('with nothing to fall back to, the page says it could not look', (await t.page.textContent('.notice')).length > 10);
    await t.context.close();
    noExec.close();
    state.status = 200;
  } finally {
    await browser.close();
    server.close();
  }
}

browserHalf().then(() => {
  console.log(fail ? `\n${fail} failed` : '\nAll static public page checks passed');
  process.exit(fail ? 1 : 0);
}).catch(err => {
  console.log('FAIL browser half threw: ' + err);
  process.exit(1);
});
