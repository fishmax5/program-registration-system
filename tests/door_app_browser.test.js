// THE DOOR APP IN A REAL BROWSER (73's page, run in Chromium).
//
// The other door tests read the template or run the script against a fake DOM.
// What breaks for a member at the tablet — typing wiped by a background
// refresh, a tap that opens staff setup, a spinner that never gives up, a
// button under the keyboard — is behaviour of a rendered page, so it is pinned
// here, with google.script.run replaced by a stub that serves a fixed day.
// SKIPPED, SAYING SO, when Playwright or Chromium is absent: the rest of the
// suite stays dependency-free.
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfyTEST/exec' }) },
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

const TODAY = '2026-11-05';
const SEP = ' · ';
const val = t => t + SEP + 'Thu, Nov 5, 2026';
function dayFixture(extraPeople) {
  const people = [
    { name: 'Ann Adler', key: 'ann adler', registered: [val('Jigsaw')], attended: [], household: [], guests: [], lunchRegistered: true },
    { name: 'Bo Baker', key: 'bo baker', registered: [val('Jigsaw')], attended: [], household: [], guests: [] },
    { name: 'Cy Cohen', key: 'cy cohen', registered: [val('Chair Yoga')], attended: [], household: [], guests: [] }
  ].concat(extraPeople || []);
  return {
    location: 'Narberth', dateKey: TODAY, dateLabel: 'Thu, Nov 5, 2026',
    programs: [
      { value: val('Jigsaw'), title: 'Jigsaw', time: '9:00 AM', byAppointment: false },
      { value: val('Chair Yoga'), title: 'Chair Yoga', time: '10:00 AM', byAppointment: false }
    ],
    lunch: { offered: false, ruledOut: true, type: '', dish: '', title: 'Lunch', value: val('Lunch') },
    people, past: [],
    members: [{ name: 'Mary Smith', key: 'mary smith', search: 'mary smith' },
      { name: 'Tom Marsh', key: 'tom marsh', search: 'tom marsh' },
      { name: 'Ann Adler', key: 'ann adler', search: 'ann adler' }],
    readAt: '9:00 AM'
  };
}

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* try the global install */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (e) { return null; }
}

async function main() {
  const pw = loadPlaywright();
  if (!pw) { console.log('skip door app browser checks: Playwright is not installed'); return; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) {
    console.log('skip door app browser checks: Chromium could not be launched (' + String(e).slice(0, 80) + ')');
    return;
  }
  const html = sandbox.buildDoorAppHtml({
    location: '', pinRequired: false, locations: ['Narberth', 'Ashbridge'], todayKey: TODAY
  });
  const doc = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + html + '</body></html>';

  // A page on a tablet: stubbed server, setup already stored.
  async function openPage(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1024, height: 768 }, hasTouch: !!opts.touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('http://door.test/**', route => route.fulfill({ contentType: 'text/html', body: doc }));
    await page.addInitScript(({ seed, mode, day }) => {
      try { if (seed) localStorage.setItem('doorSetup:v1', JSON.stringify(seed)); } catch (e) { /* ignore */ }
      window.__day = day;
      window.__mode = mode || 'ok';
      window.__calls = [];
      function runner(ok, fail) {
        const api = {
          withSuccessHandler(f) { ok = f; return proxy; },
          withFailureHandler(f) { fail = f; return proxy; }
        };
        const proxy = new Proxy(api, {
          get(t, name) {
            if (name in t) return t[name];
            return payload => {
              window.__calls.push({ name, payload });
              if (name === 'doorDay') {
                if (window.__mode === 'hang') return;
                if (window.__mode === 'fail') return setTimeout(() => fail && fail(new Error('boom')), 20);
                return setTimeout(() => ok && ok({ ok: true, day: JSON.parse(JSON.stringify(window.__day)) }), 20);
              }
              setTimeout(() => ok && ok({ ok: true }), 20);
            };
          }
        });
        return proxy;
      }
      window.google = { script: { get run() { return runner(); } } };
    }, { seed: opts.noSetup ? null : { location: 'Narberth', dateKey: TODAY }, mode: opts.mode, day: opts.day || dayFixture() });
    await page.goto('http://door.test/');
    return { page, ctx, errors };
  }

  // -------------------------------------------------------------------------
  // CRITICAL 1. A background refresh must not wipe a name being typed.
  // -------------------------------------------------------------------------
  {
    const { page, ctx, errors } = await openPage();
    await page.waitForSelector('ul.events li.item');
    await page.click('ul.events li.item .what');          // straight on to the names
    await page.waitForSelector('#search');
    await page.click('#search');
    await page.keyboard.type('Ma');
    const refreshed = dayFixture([{ name: 'Zed Zimmer', key: 'zed zimmer', registered: [val('Jigsaw')], attended: [], household: [], guests: [] }]);
    await page.evaluate(d => { window.__day = d; return syncDay(); }, refreshed);
    await page.waitForTimeout(150);
    ok('typing survives a background refresh (text kept)', (await page.inputValue('#search')) === 'Ma');
    ok('and the box keeps focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'search'));
    ok('the new day is held back while they type',
      await page.evaluate(() => PENDING !== null && !(DAY.people || []).some(p => p.name === 'Zed Zimmer')));
    await page.fill('#search', '');
    await page.evaluate(() => document.getElementById('search').blur());
    await page.waitForTimeout(100);
    ok('and applied once the box is empty and blurred',
      await page.evaluate(() => PENDING === null && (DAY.people || []).some(p => p.name === 'Zed Zimmer')));
    ok('no script errors', errors.length === 0);
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  // CRITICAL 3. Change setup is a long press, with progress and a hint.
  // -------------------------------------------------------------------------
  {
    const { page, ctx } = await openPage();
    await page.waitForSelector('ul.events li.item');
    const box = await page.locator('#setupbtn').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    ok('a short press does not open setup', (await page.textContent('#subheading')) !== 'Set up this tablet');
    ok('and says how to do it', /hold/i.test(await page.textContent('#status')));
    await page.mouse.down();
    await page.waitForTimeout(900);
    ok('while held, the button shows progress', await page.evaluate(() => document.getElementById('setupbtn').classList.contains('holding')));
    await page.mouse.up();
    ok('letting go early cancels it', (await page.textContent('#subheading')) !== 'Set up this tablet');
    await page.mouse.down();
    await page.waitForTimeout(2300);
    await page.mouse.up();
    ok('holding for two seconds opens setup', (await page.textContent('#subheading')) === 'Set up this tablet');
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  // CRITICAL 4. Loading shows a spinner, not "Try again"; failure and a
  // timeout show Try again.
  // -------------------------------------------------------------------------
  {
    const { page, ctx } = await openPage({ mode: 'hang' });
    await page.waitForSelector('.spinner');
    const txt = await page.textContent('#app');
    ok('while loading: a spinner and "Reading the list…"', /Reading the list/.test(txt));
    ok('and no Try again button yet', !/Try again/.test(txt));
    ok('and no dark toast', !(await page.evaluate(() => document.getElementById('status').classList.contains('show'))));
    await page.evaluate(() => { DAY_TIMEOUT_MS = 400; loadDay(); });
    await page.waitForSelector('#app button:has-text("Try again")', { timeout: 3000 });
    ok('after the timeout, Try again appears', true);
    await ctx.close();
  }
  {
    const { page, ctx } = await openPage({ mode: 'fail' });
    await page.waitForSelector('#app button:has-text("Try again")', { timeout: 3000 });
    ok('after a failure, Try again appears', !(await page.locator('.spinner').count()));
    await ctx.close();
  }

  await browser.close();
}

main().then(() => {
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}).catch(err => { console.log('FAIL browser half threw: ' + (err && err.stack || err)); process.exit(1); });
