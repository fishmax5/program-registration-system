// A provider's afternoon gets typed the way a paper diary is written — one
// calendar event per appointment:
//     12:30–1:00 Low-Cost Wills / 1:00–1:30 Low-Cost Wills / 1:30–2:00 …
// and this system cannot read that as appointments however hard it tries,
// because an Event_ID is md5(calendar | title | DATE) and carries no time.
// Every block hashes to the SAME session, so the dashboard shows one row
// fighting over which block's times to display.
//
// What is pinned here is the DETECTOR — which runs are a diary and which are
// two separate things that happen to share a day:
//   • back-to-back same-title blocks on one day are a run;
//   • a comfort-break gap is still back-to-back, a lunch break is not;
//   • overlapping events are refused outright;
//   • a two-hour block is a double session, not an appointment;
//   • the slot length is the COMMONEST block, not the average;
//   • a tentative "*" event is never merged into anything.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'yyyy-MM-dd') return d.toISOString().slice(0, 10);
      const h = d.getHours(), m = d.getMinutes();
      const ampm = h < 12 ? 'AM' : 'PM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    },
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.describeTimeBlockRun = describeTimeBlockRun;
this.modeOfNumbers = modeOfNumbers;
this.findCollapsibleTimeBlocks = findCollapsibleTimeBlocks;
this.TIME_BLOCK_MAX_GAP_MINUTES = TIME_BLOCK_MAX_GAP_MINUTES;
this.CALENDAR_MAP = CALENDAR_MAP;
this.setStubs = function (getEvents, range) {
  getCalendarEventsForWindow = getEvents;
  computeSyncDateRange = range;
};
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const CAL = Object.keys(sandbox.CALENDAR_MAP)[0];
const at = (h, m) => new Date(2026, 2, 5, h, m, 0);

// One calendar event, reduced to what the detector reads off it.
function ev(title, startH, startM, endH, endM, description) {
  let id = `${title}-${startH}${startM}`;
  return {
    getId: () => id,
    getTitle: () => title,
    getDescription: () => description || '',
    isAllDayEvent: () => false,
    getStartTime: () => at(startH, startM),
    getEndTime: () => at(endH, endM)
  };
}


function runsFor(events) {
  sandbox.setStubs(
    () => { const out = {}; out[CAL] = events; return out; },
    () => ({ start: at(0, 0), end: at(23, 59) })
  );
  return sandbox.findCollapsibleTimeBlocks({});
}

// --- a diary of half-hours is one run ---------------------------------------
{
  const runs = runsFor([
    ev('Low-Cost Wills', 12, 30, 13, 0),
    ev('Low-Cost Wills', 13, 0, 13, 30),
    ev('Low-Cost Wills', 13, 30, 14, 0),
    ev('Low-Cost Wills', 14, 0, 14, 30)
  ]);
  check('four half-hours are one run', runs.length, 1);
  check('with all four blocks in it', runs[0].count, 4);
  check('a half-hour slot', runs[0].slotMinutes, 30);
  check('all the same length', runs[0].uniformSlots, true);
  check('spanning the afternoon', [runs[0].startLabel, runs[0].endLabel], ['12:30 PM', '2:30 PM']);
  check('the first block is the one kept', runs[0].keepId, 'Low-Cost Wills-1230');
  check('and the other three go', runs[0].doomedIds.length, 3);
}

// --- a comfort break is still back to back ----------------------------------
{
  const runs = runsFor([
    ev('Computer Help', 10, 0, 10, 30),
    ev('Computer Help', 10, 35, 11, 5)   // five minutes between people
  ]);
  check('a five-minute gap is still one afternoon', runs.length, 1);
}

// --- a lunch break is two separate things -----------------------------------
{
  const runs = runsFor([
    ev('Computer Help', 10, 0, 10, 30),
    ev('Computer Help', 13, 0, 13, 30)   // three hours later
  ]);
  check('a three-hour gap is not one run', runs.length, 0);
}

// --- overlapping events are refused -----------------------------------------
{
  const runs = runsFor([
    ev('Medicare Counseling', 10, 0, 11, 0),
    ev('Medicare Counseling', 10, 30, 11, 30)
  ]);
  check('overlapping events are never merged', runs.length, 0);
}

// --- a double session is not a diary ----------------------------------------
{
  const runs = runsFor([
    ev('Chair Yoga', 9, 0, 11, 0),     // two hours
    ev('Chair Yoga', 11, 0, 13, 0)
  ]);
  check('two two-hour classes are not appointments', runs.length, 0);
}

// --- the slot length is the commonest block, not the average -----------------
{
  const runs = runsFor([
    ev('Low-Cost Wills', 12, 30, 13, 0),
    ev('Low-Cost Wills', 13, 0, 13, 30),
    ev('Low-Cost Wills', 13, 30, 14, 0),
    ev('Low-Cost Wills', 14, 0, 15, 0)   // one long last appointment
  ]);
  check('a run with one odd block is still a run', runs.length, 1);
  check('and its slot length is the commonest one', runs[0].slotMinutes, 30);
  check('but it says the blocks are not all the same', runs[0].uniformSlots, false);
}
check('the mode of a tie is the smaller number', sandbox.modeOfNumbers([20, 20, 30, 30]), 20);
check('the mode of nothing is nothing', sandbox.modeOfNumbers([]), 0);

// --- a lone event is not a run ----------------------------------------------
{
  check('one event is not a time block', runsFor([ev('Book Club', 10, 0, 11, 30)]).length, 0);
}

// --- different titles on one day are different programmes -------------------
{
  const runs = runsFor([
    ev('Computer Help', 10, 0, 10, 30),
    ev('Low-Cost Wills', 10, 30, 11, 0)
  ]);
  check('two different programmes back to back are not one run', runs.length, 0);
}

// --- a tentative event is never merged --------------------------------------
{
  const runs = runsFor([
    ev('Computer Help', 10, 0, 10, 30),
    ev('*Computer Help', 10, 30, 11, 0)   // not confirmed yet
  ]);
  check('a tentative event is left out of the run', runs.length, 0);
}

// --- an already-tagged run still needs merging, and says it is tagged --------
{
  const runs = runsFor([
    ev('Low-Cost Wills', 12, 30, 13, 0, '[Personalized Assistance]'),
    ev('Low-Cost Wills', 13, 0, 13, 30, '[Personalized Assistance]')
  ]);
  check('a tagged run is still a run', runs.length, 1);
  check('and is reported as already tagged', runs[0].alreadyAssistance, true);
}

// --- an all-day event is never part of one ----------------------------------
{
  const allDay = ev('Closed', 0, 0, 23, 59);
  allDay.isAllDayEvent = () => true;
  check('an all-day event is not a block', runsFor([allDay, ev('Closed', 9, 0, 9, 30)]).length, 0);
}

console.log(failures === 0 ? '\nAll time-block checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
