// THE MONTH THE DOOR CAN REGISTER INTO (section 16e), and what the staff
// roster's register screen does with it.
//
// The three things that break quietly:
//
//   1. THE HORIZON IS A MONTH BOUNDARY, not "sixty days". A person holding a
//      paper calendar asks about October; a horizon that stops on the 19th of
//      it is a page that appears to have lost half the month.
//   2. THE PAGE PICKS A DAY AND THEN A BOX. A dropdown of every session is a
//      one-line target that opens a screen of more one-line targets, which is
//      the thing a thumb cannot use — so the DAY is the dropdown and the
//      sessions on it are cards.
//   3. THE SESSION THAT GETS WRITTEN IS THE ONE IN THE HIDDEN FIELD. Every
//      write on the check-in page reads #session / #reg-session by id, so a
//      box that looks picked and a field that says otherwise would be a mark
//      landing on another session.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'yyyy-MM-dd') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
          `${String(d.getDate()).padStart(2, '0')}`;
      }
      if (fmt === 'MMMM yyyy') return 'October 2026';
      return '9:00 AM';
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// ---------------------------------------------------------------------------
// 1. The horizon
// ---------------------------------------------------------------------------
ok('the horizon is the last day of NEXT month',
  sandbox.deskMonthHorizonKey(new Date(2026, 8, 2)) === '2026-10-31');
ok('and it knows how long February is',
  sandbox.deskMonthHorizonKey(new Date(2028, 0, 20)) === '2028-02-29');
// The last day of the month is still inside its own month: a desk asking on
// the 31st must not be told the month it is standing in has ended.
ok('asking on the last day of a month still reaches the end of the next one',
  sandbox.deskMonthHorizonKey(new Date(2026, 8, 30)) === '2026-10-31');

// A workbook with no tabs answers with a list, never a throw — the page has a
// person standing in front of it.
ok('no workbook is an empty month, not an error',
  Array.isArray(sandbox.readDeskMonthSessions('Narberth')) &&
  sandbox.readDeskMonthSessions('Narberth').length === 0);

const noLocation = sandbox.deskMonthSessions(JSON.stringify({ location: '' }));
ok('a call with no location is refused', noLocation.ok === false);

// ---------------------------------------------------------------------------
// 2. The register screen asks for it, and draws a day then boxes
// ---------------------------------------------------------------------------
const roster = sandbox.buildCheckInHtml({
  builtAt: '9:00 AM',
  sessions: [{
    value: 'Chair Yoga · Wed, Sep 16, 2026', label: 'Chair Yoga · Wed, Sep 16, 2026',
    location: 'Narberth', title: 'Chair Yoga', dateKey: '2026-09-16',
    byAppointment: false, times: [], group: 'Upcoming'
  }],
  namesBySession: {}, members: [], needs: []
}, { location: 'Narberth', page: 'register' });

ok('the register screen reads the two months live',
  roster.indexOf("call('deskMonthSessions'") !== -1);

ok('the check-in screen picks a day from a dropdown',
  /<select id="day"/.test(roster));
ok('and the sessions on it are boxes',
  /<div class="cards" id="session-boxes">/.test(roster));
ok('the register screen does the same',
  /<select id="reg-day"/.test(roster) && /id="reg-session-boxes"/.test(roster));

// The hidden fields are what every write reads — see the note at the top.
ok('the chosen session is kept in one place on the check-in screen',
  /<input type="hidden" id="session">/.test(roster));
ok('and on the register screen',
  /<input type="hidden" id="reg-session">/.test(roster));

// ---------------------------------------------------------------------------
// 3. The club place
// ---------------------------------------------------------------------------
ok('the register screen calls it a club place',
  /Club place/.test(roster) && /id="reg-standing"/.test(roster));
// A future date is a REGISTRATION. A door that could mark somebody present for
// a class three weeks out is a door that inflates every attendance number.
ok('a future date is never marked as attended',
  /upcoming\.forEach/.test(src) && !/upcoming\.forEach[\s\S]{0,600}attended: true/.test(src));
// A standing lunch is a standing order with a caterer — not a tablet's to make.
ok('and never a standing lunch',
  /upcoming\.forEach[\s\S]{0,900}standingLunch: false/.test(src));

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed');
process.exit(fail ? 1 : 0);
