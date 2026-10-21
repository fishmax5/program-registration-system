#!/usr/bin/env node
// MEASUREMENT, NOT A TEST: how long a visitor waits for the public calendar,
// served from Apps Script versus served from GitHub Pages (99zu).
//
//   node tools/public_pages_bench.js \
//     --exec  "https://script.google.com/macros/s/<id>/exec?mode=public&embed=1" \
//     --pages "https://<owner>.github.io/<repo>/index.html?embed=1" \
//     [--runs 7] [--profile phone|none]
//
//   node tools/public_pages_bench.js --self-test [--profile phone]
//
// WHAT IT MEASURES, per address, COLD and WARM:
//   cold  a brand-new browser context for every run: empty HTTP cache, no
//         cookies, no storage. This is a first-time visitor.
//   warm  the second navigation to the same address inside one context: the
//         HTTP cache is populated. This is somebody opening the page again.
//
//   tile      ms from the navigation starting to the first program tile (or the
//             empty / error notice) being on screen — in ANY frame, because the
//             Apps Script page draws inside a nested sandboxed iframe. This is
//             the number a person experiences.
//   dcl       ms to DOMContentLoaded of the top document.
//   requests  and  KB  everything the load pulled, all frames, compressed bytes.
//
// --profile phone throttles the browser to a Lighthouse-style mobile network
// (150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up); `none` is the default.
//
// --self-test serves two local pages with a few hundred realistic sessions: the
// Apps Script form (data inlined) and the static form (data fetched). It
// measures THE PAGES' OWN COST — bytes, requests, time to first tile on a
// throttled link — and deliberately NOT Google's: the redirect, the wrapper
// iframe and the script execution that the Apps Script route pays are only
// there when you point --exec at the real deployment. A self-test number is
// never a before/after.
//
// Needs Playwright with Chromium (this repo has no dependencies; the tool is
// the only thing here that wants one, and nothing else imports it).
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const vm = require('vm');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* global install */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (e) { /* none */ }
  console.error('Playwright is not installed (npm i -g playwright && npx playwright install chromium).');
  process.exit(2);
}

function args() {
  const out = { runs: 7, profile: 'none' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--exec') out.exec = argv[++i];
    else if (a === '--pages') out.pages = argv[++i];
    else if (a === '--runs') out.runs = Math.max(1, Number(argv[++i]) || 7);
    else if (a === '--profile') out.profile = argv[++i];
  }
  return out;
}

const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

/** One navigation. Returns { tile, dcl, requests, kb }. */
async function measure(context, url, profile) {
  const page = await context.newPage();
  if (profile === 'phone') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8
    });
  }
  const requests = [];
  page.on('request', r => requests.push(r));
  const t0 = Date.now();
  let dcl = NaN;
  page.on('domcontentloaded', () => { if (isNaN(dcl)) dcl = Date.now() - t0; });
  page.goto(url, { waitUntil: 'commit' }).catch(() => {});
  let tile = NaN;
  const deadline = t0 + 60000;
  while (Date.now() < deadline && isNaN(tile)) {
    for (const frame of page.frames()) {
      try {
        if (await frame.$('.prog, .empty, .notice')) { tile = Date.now() - t0; break; }
      } catch (e) { /* frame navigating */ }
    }
    if (isNaN(tile)) await new Promise(r => setTimeout(r, 20));
  }
  // Let trailing requests (the quiet re-read, fonts) finish so the byte count is the whole load.
  await new Promise(r => setTimeout(r, 1500));
  let bytes = 0;
  for (const r of requests) {
    try { const s = await r.sizes(); bytes += (s.responseBodySize || 0) + (s.responseHeadersSize || 0); } catch (e) { /* aborted */ }
  }
  await page.close();
  return { tile, dcl, requests: requests.length, kb: bytes / 1024 };
}

async function bench(pw, label, url, runs, profile, blockFonts) {
  // Blocked at the resolver, NOT with context.route(): a routed context turns
  // Chromium's HTTP cache off, and then every "warm" load is a cold one.
  const browser = await pw.chromium.launch(blockFonts
    ? { args: ['--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1:9, MAP fonts.gstatic.com 127.0.0.1:9'] } : {});
  const cold = [], warm = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext();
    cold.push(await measure(context, url, profile));
    warm.push(await measure(context, url, profile));
    await context.close();
  }
  await browser.close();
  return { label, cold, warm };
}

function report(results) {
  const col = (xs, f) => { const v = xs.map(f).filter(x => !isNaN(x)); return v.length ? `${Math.round(median(v))}` : 'n/a'; };
  const range = (xs, f) => { const v = xs.map(f).filter(x => !isNaN(x)); return v.length ? `${Math.round(Math.min.apply(null, v))}–${Math.round(Math.max.apply(null, v))}` : ''; };
  console.log('\n' + 'page'.padEnd(34) + 'load'.padEnd(6) + 'tile ms (min–max)'.padEnd(24) + 'dcl ms'.padEnd(9) + 'requests'.padEnd(10) + 'KB');
  results.forEach(r => {
    [['cold', r.cold], ['warm', r.warm]].forEach(([kind, xs]) => {
      console.log(r.label.padEnd(34) + kind.padEnd(6)
        + `${col(xs, x => x.tile)} (${range(xs, x => x.tile)})`.padEnd(24)
        + col(xs, x => x.dcl).padEnd(9) + col(xs, x => x.requests).padEnd(10) + col(xs, x => x.kb));
    });
  });
  console.log('\nmedians over ' + results[0].cold.length + ' runs each.');
}

// ---------------------------------------------------------------------------
// --self-test: two local servers carrying a realistic snapshot.
// ---------------------------------------------------------------------------
function loadProject() {
  const src = require('../tests/helpers/source').readSource();
  const sb = {
    console: { log: () => {} },
    Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x', sleep: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }) },
    FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
    Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
    MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return sb;
}

function realisticSnapshot() {
  const pad = n => String(n).padStart(2, '0');
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  const sessions = [];
  const titles = ['Chair Yoga', 'Tai Chi', 'Mah Jongg', 'Watercolor Painting', 'Book Club', 'Bridge', 'Line Dancing', 'Memoir Writing',
    'Computer Help', 'Knitting Circle', 'Drumming', 'Spanish', 'Current Events', 'Chorus', 'Strength Training', 'Lunch'];
  for (let day = 0; day < 60; day++) {
    const d = new Date(today); d.setDate(d.getDate() + day);
    titles.forEach((title, i) => {
      if ((day + i) % 3 !== 0 && title !== 'Lunch') return;
      ['Narberth', 'Ashbridge'].forEach((location, j) => {
        if (title !== 'Lunch' && (i + j) % 2) return;
        sessions.push({
          id: `${dk(d)}|${title}${j}`, dateKey: dk(d), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
          dayLabel: d.toDateString(), shortLabel: d.toDateString().slice(0, 10), monthLabel: 'Month',
          title, programKey: `${title.toLowerCase()}|${location.toLowerCase()}`, location, time: '9:30 AM – 10:30 AM',
          sortTime: `09${pad(i)}`, lunch: title === 'Lunch', club: false, appointment: false,
          url: 'https://docs.google.com/forms/d/e/1FAIpQLSd' + 'x'.repeat(40) + '/viewform', state: 'open', seats: 'Seats available'
        });
      });
    });
  }
  sessions.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : (a.sortTime < b.sortTime ? -1 : 1)));
  return {
    ok: true, generatedAt: 'Oct 1, 9:00 AM', todayKey: dk(today), horizonKey: dk(today), builtAt: Date.now(),
    intro: { name: 'New Horizons', blurb: 'Classes, clubs, lunch.', phone: '610-555-0100', email: 'info@example.org', places: ['Narberth', 'Ashbridge'] },
    locations: ['Ashbridge', 'Narberth'], sessions
  };
}

async function selfTest(pw, opts) {
  const sb = loadProject();
  const snap = realisticSnapshot();
  const inlineDoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<script>window.google={script:{run:{withSuccessHandler:function(){return this},withFailureHandler:function(){return this},getScheduleSnapshot:function(){}}}};</script></head><body>'
    + sb.buildPublicCalendarHtml(snap, { embed: true }) + '</body></html>';
  let port = 0;
  const staticDoc = () => sb.publicStaticDocument('Programs', sb.buildPublicCalendarHtml(null,
    { static: { dataUrl: 'schedule.json', execUrl: `http://127.0.0.1:${port}/inline` } }), 'schedule.json');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let type = 'text/html', body;
    if (url.pathname === '/inline') body = inlineDoc;
    else if (url.pathname === '/static') body = staticDoc();
    else if (url.pathname === '/schedule.json') { type = 'application/json'; body = JSON.stringify(snap); }
    else { res.writeHead(404); res.end(); return; }
    // GitHub Pages and Google both compress, and send max-age for static files only.
    const headers = { 'Content-Type': type, 'Cache-Control': url.pathname === '/inline' ? 'no-cache' : 'max-age=600' };
    if (/gzip/.test(req.headers['accept-encoding'] || '')) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers); res.end(zlib.gzipSync(body));
    } else { res.writeHead(200, headers); res.end(body); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  console.log(`self-test: ${snap.sessions.length} sessions, profile=${opts.profile}. THIS IS THE PAGES' OWN COST ONLY — no Google redirect, wrapper iframe or script execution.`);
  const results = [
    await bench(pw, 'Apps Script form (data inlined)', `http://127.0.0.1:${port}/inline`, opts.runs, opts.profile, true),
    await bench(pw, 'static form (JSON fetched)', `http://127.0.0.1:${port}/static`, opts.runs, opts.profile, true)
  ];
  server.close();
  report(results);
}

(async () => {
  const opts = args();
  const pw = loadPlaywright();
  if (opts.selfTest) return selfTest(pw, opts);
  if (!opts.exec || !opts.pages) {
    console.error('usage: node tools/public_pages_bench.js --exec <apps script url> --pages <github pages url> [--runs N] [--profile phone|none]');
    process.exit(2);
  }
  const results = [
    await bench(pw, 'Apps Script (/exec)', opts.exec, opts.runs, opts.profile, false),
    await bench(pw, 'GitHub Pages', opts.pages, opts.runs, opts.profile, false)
  ];
  report(results);
})().catch(err => { console.error(err); process.exit(1); });
