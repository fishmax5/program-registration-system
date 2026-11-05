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
      { value: val('Jigsaw'), title: 'Jigsaw', time: '9:00 AM', byAppointment: false, startMin: 540, endMin: 600 },
      { value: val('Chair Yoga'), title: 'Chair Yoga', time: '10:00 AM', byAppointment: false, startMin: 600, endMin: 660 },
      { value: val('Bingo'), title: 'Bingo', time: '1:00 PM', byAppointment: false, startMin: 780, endMin: 840 },
      { value: val('Tai Chi'), title: 'Tai Chi', time: '10:30 AM', byAppointment: false, startMin: 630, endMin: 690 },
      { value: val('Puzzles'), title: 'Puzzles', time: '', byAppointment: false, startMin: null, endMin: null }
    ],
    lunch: { offered: false, ruledOut: true, type: '', dish: '', title: 'Lunch', value: val('Lunch') },
    people, past: [],
    members: [{ name: 'Mary Smith', key: 'mary smith', search: 'mary smith' },
      { name: 'Tom Marsh', key: 'tom marsh', search: 'tom marsh' },
      { name: 'Tamara Jones', key: 'tamara jones', search: 'tamara jones' },
      { name: 'Rosemary Lee', key: 'rosemary lee', search: 'rosemary lee' },
      { name: 'Robert Kaplan', key: 'robert kaplan', search: 'robert (bob) kaplan' },
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

  // -------------------------------------------------------------------------
  // HIGH. The names screen, search and typing layout.
  // -------------------------------------------------------------------------
  async function toNames(page, title) {
    await page.waitForSelector('ul.events li.item');
    await page.click('ul.events li.item:has-text("' + title + '") .what');
    await page.waitForSelector('#search');
  }
  {
    const { page, ctx, errors } = await openPage({ touch: true });
    await toNames(page, 'Jigsaw');
    const labels = await page.$$eval('.rowletter', n => n.length);
    ok('there are no per-row letter labels', labels === 0);
    ok('each letter is a real heading', await page.$$eval('.letter', n => n.map(x => x.textContent).join('') === 'AB'));
    ok('the name list is two columns',
      await page.evaluate(() => getComputedStyle(document.querySelector('.cards.names')).gridTemplateColumns.split(' ').length === 2));
    ok('names are 20px or larger', await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('button.card')).fontSize) >= 20));
    ok('card detail text is 16px or larger',
      await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('button.card .meta')).fontSize) >= 16));
    ok('the checkbox beside a name is smaller than before (20px)',
      await page.evaluate(() => document.querySelector('.cardwrap .tickzone input').getBoundingClientRect().width <= 20));
    ok('the name box has a visible label above it',
      (await page.textContent('label[for=search]')) === 'Type your name');
    ok('body, hint and footer text are 18px or larger and dark',
      await page.evaluate(() => ['body', 'p.hint', '.foot'].every(sel => {
        const e = document.querySelector(sel); if (!e) return true;
        const c = getComputedStyle(e);
        const m = /rgb\((\d+), (\d+), (\d+)/.exec(c.color);
        return parseFloat(c.fontSize) >= 18 && +m[1] <= 0x22 + 2 && +m[2] <= 0x22 + 2 && +m[3] <= 0x22 + 2;
      })));
    ok('the Back button is neutral, not red',
      await page.evaluate(() => { const c = getComputedStyle(document.querySelector('button.plain.back')); return !/197, 34, 31/.test(c.color + c.borderTopColor); }));
    ok('the member footer does not mention staff or Change setup',
      !/Staff|Change setup/.test(await page.textContent('.foot')));

    // search semantics
    async function hitsFor(text) {
      await page.fill('#search', '');
      await page.type('#search', text);
      return page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#matches button.card'), b => b.firstChild.textContent));
    }
    const mar = await hitsFor('mar');
    ok('a name is matched from the START of a word (mar: Mary, Marsh)', mar.indexOf('Mary Smith') !== -1 && mar.indexOf('Tom Marsh') !== -1);
    ok('and not from the middle of one (Tamara, Rosemary are not offered)', mar.indexOf('Tamara Jones') === -1 && mar.indexOf('Rosemary Lee') === -1);
    ok('two typed words both have to start a word', (await hitsFor('tom ma')).join() === 'Tom Marsh');
    ok('a nickname on the roll is still found', (await hitsFor('bob')).join() === 'Robert Kaplan');
    ok('the last name finds the person too', (await hitsFor('kap')).join() === 'Robert Kaplan');

    // the Sign in as button
    await page.fill('#search', '');
    await page.type('#search', 'Zo');
    ok('"Sign in as" is disabled under three characters', await page.evaluate(() => document.getElementById('astyped').disabled === true));
    await page.type('#search', 'e');
    ok('and enabled from three', await page.evaluate(() => document.getElementById('astyped').disabled === false));
    ok('it reads "Sign in as <name>"', (await page.textContent('#astyped')) === 'Sign in as Zoe');
    ok('and sits BELOW the matches', await page.evaluate(() => {
      const m = document.getElementById('matches'); const b = document.getElementById('astyped');
      return !m || m.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1;
    }));

    // typing mode: everything that matters is above where a keyboard would be
    await page.fill('#search', '');
    await page.type('#search', 'ma');
    await page.waitForTimeout(150);
    const geo = await page.evaluate(() => ({
      ih: innerHeight, kb: keyboardTopY(), typing: document.body.classList.contains('typing'),
      input: document.getElementById('search').getBoundingClientRect().bottom,
      btn: document.getElementById('astyped').getBoundingClientRect().bottom,
      back: !!document.querySelector('main > button.back') && getComputedStyle(document.querySelector('main > button.back')).display
    }));
    ok('typing compacts the screen', geo.typing === true && geo.back === 'none');
    ok('the assumed keyboard covers about the bottom half (touch device, no signal)', geo.kb < geo.ih * 0.6 && geo.kb > geo.ih * 0.4);
    ok('the box and the Sign in button are both above it', geo.input < geo.kb && geo.btn < geo.kb);
    // a LONG match list scrolls inside its own box and the button stays put
    const many = [];
    for (let i = 0; i < 30; i++) many.push({ name: 'Mabel Z' + String.fromCharCode(65 + (i % 26)) + i, key: 'mz' + i, search: 'mabel z' + i });
    await page.evaluate(m => { DAY.members = m; }, many);
    await page.fill('#search', '');
    await page.type('#search', 'mab');
    await page.waitForTimeout(150);
    const geo2 = await page.evaluate(() => {
      const m = document.getElementById('matches');
      return { btn: document.getElementById('astyped').getBoundingClientRect().bottom, kb: keyboardTopY(),
        scrolls: m.scrollHeight > m.clientHeight, matchesBottom: m.getBoundingClientRect().bottom,
        btnTop: document.getElementById('astyped').getBoundingClientRect().top };
    });
    ok('a long list scrolls inside its own box', geo2.scrolls === true);
    ok('and the Sign in button is still above the keyboard', geo2.btn <= geo2.kb);
    ok('with the matches ending where the button begins', geo2.matchesBottom <= geo2.btnTop + 1);
    // leaving the box brings the full screen back
    await page.evaluate(() => document.getElementById('search').blur());
    await page.waitForTimeout(500);
    ok('leaving the box ends typing mode', await page.evaluate(() => !document.body.classList.contains('typing')));
    ok('no script errors on the names screen', errors.length === 0);
    await ctx.close();
  }
  // A short landscape tablet, and a browser that DID resize the page.
  {
    const { page, ctx } = await openPage({ touch: true, viewport: { width: 1024, height: 600 } });
    await toNames(page, 'Jigsaw');
    await page.click('#search');
    await page.type('#search', 'mar');
    await page.waitForTimeout(200);
    const g = await page.evaluate(() => ({ kb: keyboardTopY(),
      btn: document.getElementById('astyped').getBoundingClientRect().bottom,
      input: document.getElementById('search').getBoundingClientRect().bottom }));
    ok('on a short (600px) landscape tablet the box and button still clear the keyboard', g.input < g.kb && g.btn <= g.kb);
    await page.setViewportSize({ width: 1024, height: 300 });   // the browser shrank the page for its keyboard
    await page.waitForTimeout(250);
    const g2 = await page.evaluate(() => ({ kb: keyboardTopY(), ih: innerHeight,
      btn: document.getElementById('astyped').getBoundingClientRect().bottom }));
    ok('when the page is really resized, the keyboard is not assumed a second time', g2.kb === g2.ih);
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  // HIGH. Empty list, resets, selected tile.
  // -------------------------------------------------------------------------
  {
    const { page, ctx } = await openPage();
    await toNames(page, 'Bingo');
    const body = await page.textContent('#app');
    ok('an empty list shows only how to type', /Type your name/.test(body) && !/Tap your name/.test(body) && !/Nobody is signed up/.test(body));
    await ctx.close();
  }
  {
    const { page, ctx } = await openPage();
    await page.waitForSelector('ul.events li.item');
    await page.click('ul.events li.item:first-child label.tickzone');
    const on = await page.$eval('ul.events li.item:first-child', li => {
      const c = getComputedStyle(li), a = getComputedStyle(li.querySelector('.what'), '::after');
      return { bg: c.backgroundColor, shadow: c.boxShadow, word: a.content };
    });
    ok('a selected program tile has a strong fill, a thick border and says Selected',
      on.bg !== 'rgb(255, 255, 255)' && /3px/.test(on.shadow) && /Selected/.test(on.word));
    // ONE focusable element per tile
    const stops = await page.$$eval('ul.events li.item', lis => lis.map(li =>
      Array.prototype.filter.call(li.querySelectorAll('*'), e => e.tabIndex >= 0).length + (li.tabIndex >= 0 ? 1 : 0)));
    ok('each program tile is ONE tab stop', stops.every(n => n === 1));
    ok('the tile is a button for assistive tech', await page.$eval('ul.events li.item', li => li.getAttribute('role') === 'button'));
    await page.focus('ul.events li.item:nth-child(2)');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#search');
    ok('Enter on a focused tile goes on to the names', true);
    const ring = await page.evaluate(() => { const css = document.querySelector('style').textContent; return /:focus-visible\s*\{[^}]*outline:\s*4px/.test(css) && /outline-offset:\s*3px/.test(css); });
    ok('there is a global 4px focus ring with an offset', ring);
    await ctx.close();
  }
  {
    const { page, ctx } = await openPage();
    await toNames(page, 'Jigsaw');
    await page.click('.cardwrap .tickzone');              // tick somebody
    await page.click('button.back');
    ok('Back to programs clears what was ticked and the answer',
      await page.evaluate(() => hereForCount() === 0 && Object.keys(TICKED).length === 0 && SHOW_ALL === false && STEP === 'events'));
    // idle reset
    await page.evaluate(() => { IDLE_RESET_MS = 400; });
    await page.click('ul.events li.item:first-child label.tickzone');
    await page.waitForTimeout(150);
    await page.evaluate(() => touchIdle());               // restart the clock with the short setting
    await page.waitForTimeout(700);
    ok('after a minute of nothing (shortened here) the answer is cleared and the first question is back',
      await page.evaluate(() => hereForCount() === 0 && STEP === 'events'));
    await toNames(page, 'Jigsaw');
    await page.evaluate(() => touchIdle());
    await page.waitForTimeout(700);
    ok('and from the names screen too', await page.evaluate(() => STEP === 'events' && hereForCount() === 0));
    await ctx.close();
  }
  // Setup: footer for staff here, and a big keyboard switch.
  {
    const { page, ctx } = await openPage({ noSetup: true });
    await page.waitForSelector('.foot');
    ok('the staff line is shown on the setup screen', /hold/i.test(await page.textContent('.foot')));
    const sw = await page.$eval('button.switch', b => ({ fs: parseFloat(getComputedStyle(b).fontSize), h: b.getBoundingClientRect().height, role: b.getAttribute('role') }));
    ok('the keyboard toggle is a large switch (18px+ text)', sw.fs >= 18 && sw.h >= 60 && sw.role === 'switch');
    await page.click('button.switch');
    ok('and says ON when on', /ON/.test(await page.textContent('button.switch')) &&
      (await page.getAttribute('button.switch', 'aria-checked')) === 'true');
    await ctx.close();
  }
  // Program screen sizes.
  {
    const { page, ctx } = await openPage();
    await page.waitForSelector('ul.events li.item');
    const sz = await page.evaluate(() => ({
      tile: document.querySelector('ul.events li.item').getBoundingClientRect().height,
      title: parseFloat(getComputedStyle(document.querySelector('ul.events .title')).fontSize),
      go: document.getElementById('go').getBoundingClientRect().height,
      plain: parseFloat(getComputedStyle(document.querySelector('main button.plain')).fontSize)
    }));
    ok('program tiles are tall with large titles', sz.tile >= 150 && sz.title >= 28);
    ok('Continue is at least 64px tall', sz.go >= 64);
    ok('"Not sure?" is 18px or larger', sz.plain >= 18);
    ok('the program checkbox is smaller than before', await page.$eval('ul.events li.item input', i => i.getBoundingClientRect().width <= 24));
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  // Programs sorted by time: now first, then soon, then later, untimed, ended.
  // -------------------------------------------------------------------------
  {
    const { page, ctx } = await openPage();
    await page.waitForSelector('ul.events li.item');
    async function order(minute) {
      await page.evaluate(m => { nowMinutes = () => m; draw(); }, minute);
      return page.$$eval('ul.events li.item .title', n => n.map(x => x.textContent));
    }
    // 10:20 — Chair Yoga is on, Tai Chi starts in 10 minutes, Bingo is later, Jigsaw is over.
    ok('on now first, then soon, then later, then untimed, then ended',
      (await order(620)).join() === 'Chair Yoga,Tai Chi,Bingo,Puzzles,Jigsaw');
    ok('the running program says HAPPENING NOW',
      (await page.textContent('ul.events li.item:first-child')).includes('HAPPENING NOW'));
    ok('the next one says STARTING SOON',
      (await page.textContent('ul.events li.item:nth-child(2)')).includes('STARTING SOON'));
    ok('a later program has no badge', !(await page.textContent('ul.events li.item:nth-child(3)')).match(/HAPPENING|STARTING/));
    ok('the highlight is a thick border as well as words',
      await page.$eval('ul.events li.item:first-child', li => parseFloat(getComputedStyle(li).borderTopWidth) >= 4));
    // 08:00 — nothing on; strictly by start time, 9:00 is within the hour
    ok('early morning is plain time order with the 9am one soon',
      (await order(480)).join() === 'Jigsaw,Chair Yoga,Tai Chi,Bingo,Puzzles');
    ok('and 9am is called soon (within the hour)',
      (await page.textContent('ul.events li.item:first-child')).includes('STARTING SOON'));
    // another day: no judging at all, plain time order
    await page.evaluate(() => { nowMinutes = function () { return null; }; draw(); });
    ok('with no clock to judge by, it is plain time order and no badges',
      (await page.$$eval('ul.events li.item .title', n => n.map(x => x.textContent))).join() === 'Jigsaw,Chair Yoga,Tai Chi,Bingo,Puzzles' &&
      !(await page.textContent('ul.events')).match(/HAPPENING|STARTING/));
    await ctx.close();
  }

  await browser.close();
}

main().then(() => {
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}).catch(err => { console.log('FAIL browser half threw: ' + (err && err.stack || err)); process.exit(1); });
