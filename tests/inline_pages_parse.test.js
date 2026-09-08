// EVERY INLINED PAGE'S SCRIPT BLOCK ACTUALLY PARSES.
//
// This file exists because of a bug with no visible cause. The Door Pages
// dialog rendered its heading, its hint, its PIN box — and nothing at all where
// the links go. Not a wrong link, not an error: blank.
//
// Every page and dialog in this project is built inside a TEMPLATE LITERAL, and
// a template literal eats backslashes. A regex written the way it is written
// everywhere else in the file —
//
//     /\/dev(\?|#|$)/.test(url)
//
// — reaches the browser as
//
//     //dev(?|#|$)/.test(url)
//
// which is a comment followed by a syntax error. The browser throws while
// parsing, so the WHOLE script block is dead: not the one function that carries
// the regex, everything. Nothing calls draw(), so nothing is drawn, and nothing
// anywhere says why.
//
// Reading the .gs file cannot catch it — the script parses perfectly; it is the
// string it produces that does not. So this compiles the script block out of
// each generated page, which is the only place the damage is visible.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: () => '9:00 AM',
    getUuid: () => 'x',
    newBlob: data => ({ getBytes: () => data, getDataAsString: () => String(data) }),
    gzip: blob => blob,
    ungzip: blob => blob,
    base64Encode: bytes => Buffer.from(String(bytes)).toString('base64'),
    base64Decode: text => Buffer.from(String(text), 'base64').toString()
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfyTEST/exec' }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

/** Every <script>…</script> body in `html`, in order. */
function scriptBlocks(html) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf('<script>', from);
    if (open === -1) return blocks;
    const close = html.indexOf('</script>', open);
    if (close === -1) return blocks;
    blocks.push(html.substring(open + '<script>'.length, close));
    from = close + 1;
  }
}

/**
 * Compiles a block the way a browser would, without running it — a page's
 * script is full of google.script.run and document, none of which exists here,
 * and none of which is what this test is about.
 */
function parses(js) {
  try {
    new vm.Script(js);
    return '';
  } catch (err) {
    return String(err && err.message ? err.message : err);
  }
}

const pages = [
  ['the Door Pages dialog', () => sandbox.buildCheckInPageHtml(sandbox.readCheckInPageInfo())],
  ['the check-in roster page', () => sandbox.buildCheckInHtml(null, { location: '', pinRequired: false })],
  ['the door app page', () => sandbox.buildDoorAppHtml({
    location: '', pinRequired: false, locations: ['Narberth'], todayKey: '2025-09-02'
  })],
  ['the Quick Mark dialog', () => sandbox.buildQuickMarkHtml(null)],
  // The one page in this project a MEMBER sees, and the one nobody on staff
  // would notice was blank. A program title is interpolated straight into its
  // heading, so it is exactly the shape this file exists to catch.
  // The other page a stranger sees, and the one whose whole promise is that
  // it draws before anything is requested — a dead script block there is a
  // blank page on a printed link.
  ['the public calendar page', () => sandbox.buildPublicCalendarHtml(publicSnapshot())],
  // AND THE SAME PAGE EMBEDDED, which is a different string: the embed skin is
  // written server-side (see the banner in 87) and so is a second style block
  // and a second branch of markup. A page that only ever compiled unframed is
  // a page that goes blank inside somebody's website and nowhere else.
  ['the public calendar page, embedded', () => sandbox.buildPublicCalendarHtml(
    publicSnapshot(),
    sandbox.publicCalendarViewOptions({ embed: '1', building: 'Narberth', view: 'week' }))],
  // The other public page, on the same terms: it is drawn from an inlined
  // fold, and a dead script block in it is a blank block on the website.
  ['the regular programs page', () => sandbox.buildPublicRegularHtml({
    ok: true, generatedAt: 'Oct 1, 9:00 AM', todayKey: '2026-10-01',
    horizonKey: '2026-11-30', locations: ['Narberth'],
    programs: [{
      key: "women's </script> group|narberth", title: "Women's </script> Group",
      location: 'Narberth', weekday: 'Thursday', time: '9:30 AM', sortTime: '0930',
      sessions: [{
      id: '2026-10-01|EV1', dateKey: '2026-10-01', weekday: 'Thu',
      dayLabel: 'Thursday, October 1', shortLabel: 'Thu Oct 1',
      monthLabel: 'October 2026', title: "Women's </script> Group",
      programKey: "women's </script> group|narberth", location: 'Narberth',
      time: '9:30 AM', sortTime: '0930', lunch: false, club: false, appointment: false,
      url: 'https://docs.google.com/forms/d/e/X/viewform', state: 'open',
      seats: 'Seats available'
    }]
    }]
  }, {})],
  ['the cancel page', () => sandbox.buildCancelPageHtml({
    formId: '1FAIpQLSc_test', programLabel: "Women's </script> Group — Narberth"
  })]
];

/** One session, with every hazard this file exists for in its title. */
function publicSnapshot() {
  return {
    ok: true, generatedAt: 'Oct 1, 9:00 AM', todayKey: '2026-10-01',
    horizonKey: '2026-11-30', locations: ['Narberth'],
    sessions: [{
      id: '2026-10-01|EV1', dateKey: '2026-10-01', weekday: 'Thu',
      dayLabel: 'Thursday, October 1', monthLabel: 'October 2026',
      title: "Women's </script> Group", location: 'Narberth', time: '9:30 AM',
      sortTime: '0930', lunch: false, club: false, appointment: false,
      url: 'https://docs.google.com/forms/d/e/X/viewform', state: 'open',
      seats: 'Seats available'
    }]
  };
}

pages.forEach(([name, build]) => {
  let html = '';
  try {
    html = build();
  } catch (err) {
    ok(`${name} builds`, false);
    console.log('     ' + err);
    return;
  }
  const blocks = scriptBlocks(html);
  ok(`${name} has a script block`, blocks.length > 0);
  blocks.forEach((js, i) => {
    const error = parses(js);
    ok(`${name}'s script block ${i + 1} parses in a browser`, error === '');
    if (error) console.log('     ' + error);
  });
});

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
