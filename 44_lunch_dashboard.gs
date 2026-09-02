// ============================================================================
// 8. MASTER LUNCH DASHBOARD  (updateMasterLunchDashboard)
// ============================================================================
//
// Row layout:
//   1              Today banner (merged)
//   2              Today headers (TODAY_LUNCH_HEADERS)
//   3..(2+N)       One Today row per location, N = number of locations
//   spacerRow      Blank
//   (from there)   Upcoming Lunch Schedule banner/header/data, then a
//                  spacer, then Past Lunch Schedule banner/header/data —
//                  sizes are dynamic, computed fresh every render.
//
// The Today block is a pure, fully-recomputed READ-ONLY view — it's never
// itself edited. The Full Schedule (Upcoming+Past) is upserted, so
// hand-entered buffers/actuals/discrepancy numbers and Manually Added rows
// survive every sync.
// ============================================================================

function getDashboardRowPlan(signUpRowCount) {
  // The overflow line is a row of the block too — see LUNCH_SIGNUP_PINNED_LIMIT.
  signUpRowCount = Math.min(signUpRowCount || 0, LUNCH_SIGNUP_PINNED_LIMIT) +
    ((signUpRowCount || 0) > LUNCH_SIGNUP_PINNED_LIMIT ? 1 : 0);
  const numLocations = Math.max(Object.keys(CALENDAR_MAP).length, 1);
  // THE SIGN-UP BLOCK IS PINNED ABOVE EVERYTHING, including Today.
  //
  // It is not a number and it does not change day to day, which is normally an
  // argument for putting something further down — but it is the one thing on
  // this tab that is meant to leave the building. Staff are asked for "the
  // lunch link" at the desk, on the phone and by email, and every other home
  // for it (a Drive folder of sixty forms, a session row buried in the
  // program dashboard, an email from three weeks ago) is somewhere it has to
  // be hunted for. Top of the tab whose whole subject is lunch is where
  // somebody looks without being told.
  //
  // At least one row always, so the block never collapses to a bare banner:
  // with no forms yet it carries the line saying why.
  const signUpRows = Math.max(signUpRowCount || 0, 1);
  const signUpBannerRow = 1;
  const signUpHeaderRow = 2;
  const signUpDataStart = 3;
  const signUpDataEnd = signUpDataStart + signUpRows - 1;
  const signUpSpacerRow = signUpDataEnd + 1;

  const todayBannerRow = signUpSpacerRow + 1;
  const todayHeaderRow = todayBannerRow + 1;
  const todayDataStart = todayHeaderRow + 1;
  const todayDataEnd = todayDataStart + numLocations - 1;
  const spacerRow = todayDataEnd + 1;
  const scheduleStartRow = spacerRow + 1;
  return {
    numLocations, signUpRows, signUpBannerRow, signUpHeaderRow, signUpDataStart, signUpDataEnd,
    signUpSpacerRow, todayBannerRow, todayHeaderRow, todayDataStart, todayDataEnd, spacerRow, scheduleStartRow
  };
}

/**
 * The pinned block's own header row — narrower than the schedule beneath it.
 *
 * SIGN_UP_LINK IS LAST, AND THAT IS THE WHOLE POINT OF THE ORDER. This block
 * sits on top of a twenty-column table and shares its column widths, and those
 * widths are sized for the schedule: column D is as wide as "Chx Parm" because
 * that is what Meal_Shorthand holds. A cell only spills into the cells to its
 * right while they are EMPTY, so with the link in D and "Edit Form" in E, the
 * one piece of text this block exists to show — "Sign up for lunch —
 * Narberth, September 2026" — was cut off mid-word by the cell beside it.
 * Putting it last leaves fifteen empty columns to run into, and OVERFLOW (set
 * in writeLunchSignUpBlock()) lets it use them.
 */
const LUNCH_SIGNUP_HEADERS = ['Location', 'Month', 'Lunch_Dates', 'Edit_Form', 'Sign_Up_Link'];

/**
 * How many sign-up rows the pinned block shows.
 *
 * It is capped because everything above the schedule's header is FROZEN (see
 * writeMasterLunchDashboardSheet()) — that is what "pinned" buys, and it is
 * also what it costs: every row added here is a row of the screen the schedule
 * no longer gets. Two locations across a three-month sync window is six rows,
 * on top of the eight the Today block and the headers already take, which
 * leaves a laptop looking at a frozen pane and four dates.
 *
 * Four is the current month and the next at both locations — which is the
 * whole of what anybody is handing out a link for. The rest are one row down
 * on Master_Program_Dashboard like every other form, and the block says so
 * rather than pretending they don't exist.
 */
const LUNCH_SIGNUP_PINNED_LIMIT = 4;

/**
 * Flattens getLunchOnlyFormLinks() into the rows the pinned block shows: one
 * per location per month, soonest month first.
 *
 * SORTED ON monthKey ("2026-09"), WHICH IS STORED, not on the month's NAME.
 * "April" before "September" is not an ordering anybody wants on a lunch
 * calendar, and re-deriving the order from the label means parsing
 * "September 2026" back into a date — which is the kind of round trip that
 * looks free and is not: `new Date("September 2026 1")` lands on midnight in
 * one zone and is then read back in another, putting September's form under
 * an August heading; and it does not fail loudly on rubbish either, since that
 * same parser reads a blank label as a real date rather than as NaN. So the
 * key is written down at the point the dates are actually in hand
 * (syncLunchOnlySessions()) and simply read here.
 *
 * A stored entry with no monthKey — written by a version before this — sorts
 * last rather than first, so it lands under the months it cannot be placed
 * among instead of above them.
 */
function buildLunchSignUpRows(links) {
  const rows = [];
  // Pruned on the way out as well as on the way in: the dashboard renders far
  // more often than the lunch sync runs, and a month that ended overnight
  // must stop being pinned on the next render rather than on the next sync.
  const live = pruneLunchOnlyFormLinks(links);
  Object.keys(live).forEach(groupKey => {
    const m = live[groupKey];
    rows.push({
      location: m.location || '',
      monthLabel: m.monthLabel || '',
      monthKey: m.monthKey || '9999-99',
      dateCount: m.dateCount || 0,
      publishedUrl: m.publishedUrl,
      editUrl: m.editUrl || m.publishedUrl
    });
  });
  return rows.sort((a, b) => (a.monthKey === b.monthKey
    ? String(a.location).localeCompare(String(b.location))
    : (a.monthKey < b.monthKey ? -1 : 1)));
}

/**
 * The person-level record behind one date+location's lunch numbers.
 *
 * WHY THIS EXISTS AT ALL. Both lunch numbers used to be `count++` per
 * REGISTRANT ROW, and a registrant row is one person on one PROGRAM. Somebody
 * who signs up for Chair Yoga, Bingo and the Book Club on the same Tuesday and
 * ticks "yes, lunch" on all three forms - which is the normal thing to do,
 * because each form asks - is three rows, and was therefore three lunches on
 * the order. They eat one. On a busy day that gap was the difference between
 * ordering 30 meals and ordering the 23 that get eaten, and the only thing
 * standing between the kitchen and that over-order was somebody reading down
 * the sheet each morning deleting the repeats by hand.
 *
 * So the tally is now keyed on the PERSON, via normalizeNameKey() - the same
 * identity rule the club rosters, the "sign up for all dates" registry and
 * Quick Mark already use, so "Jane Smith" and "jane  smith " have always been
 * one person everywhere else in this file and are one person here too.
 *
 * A ROW WITH NO NAME NEVER COLLAPSES. An empty Name is not evidence that two
 * rows are the same person; it is evidence that somebody left a guest-name box
 * blank. Merging those would UNDER-order, and under-ordering is the one
 * direction this whole change must never go - a duplicate meal is waste, a
 * missing meal is a person at the counter with nothing to eat. Each unnamed
 * row therefore keeps its own slot.
 *
 * The entry doubles as the source row for Lunch_Roster, which is why it
 * carries names, programs and phone rather than only a flag: the count and the
 * list of who is in it are built in one pass and cannot drift apart.
 */
function lunchPersonEntry(bucket, row, lrMap) {
  const people = bucket.people || (bucket.people = {});
  const displayName = String(row[lrMap['Name']] || '').trim();
  const key = normalizeNameKey(displayName);
  const slot = key || `\u0000unnamed:${(bucket.unnamedSeen = (bucket.unnamedSeen || 0) + 1)}`;

  if (!people[slot]) {
    people[slot] = {
      name: displayName,
      registered: false,
      served: false,
      // How many EXTRA lunch requests this person made for this one day, i.e.
      // how many rows were merged away. 0 on the overwhelming majority.
      mergedRequests: 0,
      // How many MEALS they are down for across those merged rows — see
      // countLunchMeals(). 0 until a row that actually wants lunch sets it.
      mealsOrdered: 0,
      lunchType: '',
      programs: [],
      phone: '',
      source: ''
    };
  }
  const entry = people[slot];

  // Later rows fill in anything the first one left blank rather than
  // overwriting it: the three rows being merged are the same person and
  // between them usually know the phone number even when one doesn't.
  if (!entry.phone) entry.phone = String(row[lrMap['Phone']] || '').trim();
  if (!entry.lunchType) entry.lunchType = String(row[lrMap['Lunch_Type']] || '').trim();
  if (!entry.source) entry.source = String(row[lrMap['Form_Source']] || '').trim();
  const program = String(row[lrMap['Event']] || '').trim();
  if (program && entry.programs.indexOf(program) === -1) entry.programs.push(program);

  return entry;
}

/** Distinct people on a rollup bucket for whom `flag` is true. */
function countLunchPeople(bucket, flag) {
  const people = bucket.people || {};
  return Object.keys(people).reduce((n, k) => n + (people[k][flag] ? 1 : 0), 0);
}

/**
 * How many MEALS the registered people on a bucket add up to — which is what
 * the kitchen orders, and therefore what Registered_Count holds.
 *
 * It is not the same number as countLunchPeople(): one person can be down for
 * four meals (Meals_Ordered), and the whole point of that column is that the
 * order and the roster can differ without either being wrong. The roster still
 * lists Joan once; the order still says four.
 *
 * Anyone whose mealsOrdered never got set still counts as one, so a person who
 * reached this bucket by a path that predates the column is never dropped from
 * the order.
 */
function countLunchMeals(bucket) {
  const people = bucket.people || {};
  return Object.keys(people).reduce((n, k) => {
    const person = people[k];
    if (!person.registered) return n;
    return n + (person.mealsOrdered > 0 ? person.mealsOrdered : 1);
  }, 0);
}

/**
 * Aggregates Master_Program_Dashboard's session table + Registrant_Dash
 * into one row per (date, location): how many people need lunch, plus that
 * day's Meal_Shorthand/Type pulled from Lunch_Schedule (per date AND
 * location now). Only rows with Program_Status=Active AND Lunch_Status=Needed
 * count toward catering.
 *
 * Every UPCOMING session date+location is seeded at count 0 whether or not
 * anyone has registered yet, so the catering schedule shows what is coming
 * instead of materializing a date only once its first registrant appears —
 * staff need the empty rows to plan against (and to hand-enter buffers on).
 * Dates explicitly marked "Not Serving" for their location are left out;
 * a date with no Lunch_Schedule row at all IS seeded, since an unconfigured
 * date is exactly the thing worth surfacing. Past dates are never seeded —
 * that would backfill a wall of empty history.
 */
function buildDashboardRollup(registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);

  // No early return on a missing/empty session table any more: the menu is now
  // a source of dashboard rows in its own right (see SEED 1), so a catered day
  // still has to appear even on a workbook whose calendar hasn't been imported.
  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regRows = registrySheet ? readAllSectionedRows(registrySheet, regHeaders, 'Event_ID') : [];
  const regMap = getIndexMap(regHeaders);

  const eventMeta = {};
  regRows.forEach(row => {
    const eventId = row[regMap['Event_ID']];
    const d = coerceDate(row[regMap['Event_Date']]);
    if (!eventId || !d) return;
    eventMeta[eventId] = { dateKey: formatDateKey(d), location: row[regMap['Location']] || '' };
  });

  const rollup = {};
  /** date|location -> people who wanted lunch on a day now marked Not Serving. */
  const notServingWithSignups = {};
  const todayKey = formatDateKey(new Date());

  const seed = (dateKey, location) => {
    const key = `${dateKey}|${location}`;
    if (!rollup[key]) {
      rollup[key] = { dateKey, location, registeredCount: 0, servedConfirmed: 0 };
    }
    return rollup[key];
  };

  // SEED 1 — every upcoming Hot/Cold row on Lunch_Schedule, whether or not a
  // program runs that day.
  //
  // A catered day is a catering commitment. The kitchen is cooking, the order
  // has to be placed, and the number has to appear somewhere someone looks —
  // and "somewhere someone looks" is this tab. Seeding only from the session
  // table meant a meal with no programming behind it (a drop-in lunch, a
  // holiday meal, a day whose calendar event hasn't been made yet) was
  // invisible here even though the menu plainly said it was happening.
  //
  // The menu row is taken as authoritative, deliberately over the location's
  // catering policy: a policy is a default about what USUALLY happens, and an
  // explicit Hot/Cold row for a specific date is somebody overriding it on
  // purpose. The one case worth querying is a menu row at a Never location,
  // which is contradictory rather than deliberate — flagged below, not
  // silently dropped.
  const menuSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  const menuMap = getIndexMap(HEADERS.Lunch_Schedule);
  /** date|location -> the catered Type already seen there, for the clash check below. */
  const cateredTypeSeen = {};
  (menuSheet ? readLunchScheduleRows(menuSheet) : []).forEach(row => {
    const d = coerceDate(row[menuMap['Event_Date']]);
    const location = String(row[menuMap['Location']] || '').trim();
    const type = String(row[menuMap['Type']] || '').trim();
    if (!d || !location) return;
    if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return; // "Not Serving", or blank
    const dateKey = formatDateKey(d);
    if (dateKey < todayKey) return; // past dates are never seeded — see below

    // ONE CATERED BATCH PER DATE+LOCATION is an assumption this whole tab
    // rests on: the rollup is keyed date|location, getMealInfoForDate() takes
    // the FIRST matching row, and resolveRegistrantLunchType() hands everyone
    // that row's type. A second catered row for the same day and place is
    // therefore not a second order — it is a row that quietly does nothing,
    // while deriveMealId() still mints it a distinct Meal_ID and
    // getRecentMealIdOptions() still offers that ID in the Meal_Source
    // dropdown. Somebody pointing at it would see their meals counted against
    // the OTHER batch's row.
    //
    // Supporting Hot and Cold side by side properly means re-keying this tab,
    // the dashboard and the registrant Lunch_Type together — see
    // STRESS_TEST.md. Until then the clash is at least never silent.
    const clashKey = `${dateKey}|${location}`;
    if (cateredTypeSeen[clashKey] !== undefined) {
      if (cateredTypeSeen[clashKey] !== type) {
        noteForAdmin('Two catered menus for one date and location',
          `Lunch_Schedule has both a ${cateredTypeSeen[clashKey]} and a ${type} row for ${location} on ` +
          `${formatDateLabel(d)}. Only the ${cateredTypeSeen[clashKey]} one is being counted, ordered or shown ` +
          `on the form — this tab holds ONE meal per location per day. Merge them into a single row, or ` +
          `split the day across two locations.`);
      }
      return;
    }
    cateredTypeSeen[clashKey] = type;

    if (getCateringPolicyForLocation(location) === CATERING_POLICIES.NEVER) {
      noteForAdmin('Menu set at a Never-catering location',
        `Lunch_Schedule has a ${type} row for ${location} on ${formatDateLabel(d)}, but that location's ` +
        `policy in Config is "Never". Either change the policy or remove the menu row — as it stands the ` +
        `date is being catered for a location that is supposed to serve no food.`);
      return;
    }
    seed(dateKey, location);
  });

  // SEED 2 — upcoming session date+location pairs, so the schedule also shows
  // programming that is coming but has no menu row yet. Gated on
  // isLunchOfferedOn(), or a never-catering location (Zoom) would contribute a
  // blank row for every single session it runs.
  //
  // Past dates are never seeded by either pass — that would backfill a wall of
  // empty history. Past rows appear only where a registrant or a served meal
  // put them there.
  Object.keys(eventMeta).forEach(eventId => {
    const meta = eventMeta[eventId];
    if (!meta.location || meta.dateKey < todayKey) return;
    if (!isLunchOfferedOn(parseDateKey(meta.dateKey), meta.location)) return;
    seed(meta.dateKey, meta.location);
  });

  if (registrantsSheet || registrantRows) {
    const lrHeaders = HEADERS.Registrant_Dash;
    const lrRows = registrantRows || readAllSectionedRows(registrantsSheet, lrHeaders, 'Event_ID');
    const lrMap = getIndexMap(lrHeaders);
    lrRows.forEach(row => {
      const eventId = row[lrMap['Event_ID']];
      let meta = eventMeta[eventId];
      if (!meta) {
        // A row with no session behind it is normally a stale Event_ID whose
        // event has been deleted, and is triaged rather than counted. The one
        // exception is a LUNCH-ONLY row — somebody who came in for the meal on
        // a day with no program, added from the Quick Mark dialog (see
        // LUNCH_ONLY_EVENT_ID_PREFIX). Those never have a session, and their
        // meal is exactly as real as anyone else's, so they take their date and
        // location from the row itself.
        if (!isLunchOnlyEventId(eventId)) {
          // ...but a row like that can be carrying REAL MEALS — a served tick,
          // a count of portions handed over — and dropping those on the floor
          // is the same mistake an orphan Meal_Source must never make. It is
          // not always a deleted event either: re-pointing CALENDAR_MAP
          // re-keys every Event_ID and strands every existing registrant row
          // behind the old ones (see SYSTEM_REVIEW.md §5), and triage
          // deliberately leaves those alone. So say so rather than subtract
          // food from the record in silence.
          const strandedMeals = readRegistrantMealCounts(row, lrMap).total;
          const strandedServed = isTruthyCheckbox(row[lrMap['Lunch_Served']]);
          if (strandedMeals > 0 || strandedServed) {
            const when = coerceDate(row[lrMap['Event_Date']]);
            noteForAdmin('Served meals on a row with no session',
              `${String(row[lrMap['Name']] || '').trim() || '(unnamed)'} at ` +
              `${String(row[lrMap['Location']] || '').trim() || 'an unnamed location'} on ` +
              `${when ? formatDateLabel(when) : 'an unreadable date'} has ` +
              `${strandedServed ? 'Lunch_Served ticked' : ''}${strandedServed && strandedMeals > 0 ? ' and ' : ''}` +
              `${strandedMeals > 0 ? `${strandedMeals} meal(s) counted` : ''}, but their Event_ID ` +
              `"${eventId}" is on no session — so none of it reaches Master_Lunch_Dashboard. Either restore ` +
              `the session or re-point the row's Event_ID.`);
          }
          return;
        }
        const d = coerceDate(row[lrMap['Event_Date']]);
        const loc = String(row[lrMap['Location']] || '').trim();
        if (!d || !loc) return;
        meta = { dateKey: formatDateKey(d), location: loc };
      }

      // Served_Confirmed counts what staff actually TICKED, independently of
      // what the form said — that's the whole point of the column. A person
      // whose Lunch_Served box is checked counts here even if they never
      // requested lunch on the form (walk-ins happen), which is why this is
      // tallied before the Program_Status/Lunch_Status filter below.
      //
      // Counted PER PERSON, not per row, for the same reason the registration
      // count below is (see lunchPersonEntry()): the duplicate-registration
      // case puts the same person on three rows for one day, staff tick the
      // one they happen to land on - or all three - and "how many people got
      // their lunch" has to stay comparable with "how many people asked for
      // one" or the two columns beside each other stop meaning anything.
      if (isTruthyCheckbox(row[lrMap['Lunch_Served']])) {
        const servedKey = `${meta.dateKey}|${meta.location}`;
        if (!rollup[servedKey]) {
          rollup[servedKey] = {
            dateKey: meta.dateKey, location: meta.location,
            registeredCount: 0, servedConfirmed: 0, unplanned: true
          };
        }
        lunchPersonEntry(rollup[servedKey], row, lrMap).served = true;
      }

      // THE MEAL COUNTS feed Master_Lunch_Dashboard's consumption columns the
      // same way Lunch_Served feeds Served_Confirmed — tallied unconditionally,
      // before the Program_Status/Lunch_Status filter below, because a
      // walk-in's actual meal counts whether or not they were ever registered.
      //
      // Each count now says its own destination (MEAL_COUNT_TO_DASHBOARD_COLUMN),
      // so one row can contribute a dined-in day-1 meal AND two taken-out subs
      // at once. Previously a single Meals_In_Fridge checkbox routed the whole
      // row one way or the other, which made the mixed case unsayable.
      const meals = readRegistrantMealCounts(row, lrMap);
      if (meals.total > 0) {
        // WHICH BATCH these meals came out of, which is not always the day
        // they were handed over. Blank Meal_Source means today's — the rule
        // this tab has always followed silently — so the overwhelming majority
        // of rows resolve to exactly the bucket they used to.
        //
        // A named batch sends the counts to ITS date and location instead. The
        // eight portions of Wednesday's chicken handed out on Thursday belong
        // to Wednesday's order: that is the row that has an Actual_Ordered to
        // reconcile against, and leaving them on Thursday reports the same
        // batch as both waste and phantom demand.
        const source = resolveMealSource(row[lrMap['Meal_Source']], meta, row, lrMap);
        const mealKey = `${source.dateKey}|${source.location}`;
        if (!rollup[mealKey]) {
          rollup[mealKey] = {
            dateKey: source.dateKey, location: source.location,
            registeredCount: 0, servedConfirmed: 0, unplanned: true
          };
        }
        const bucket = rollup[mealKey];
        Object.keys(meals.byDashboardColumn).forEach(column => {
          bucket.mealTallies = bucket.mealTallies || {};
          bucket.mealTallies[column] = (bucket.mealTallies[column] || 0) + meals.byDashboardColumn[column];
        });
        // Carried_Over is what makes the redirected number explainable. Without
        // it Wednesday's takeaway count silently grows by eight and nothing on
        // the row says why. Only counted when the food actually moved days —
        // naming today's own batch explicitly is not a carry-over.
        if (source.carried) {
          bucket.carriedOver = (bucket.carriedOver || 0) + meals.total;
        }
      }

      if (row[lrMap['Program_Status']] !== 'Active' || row[lrMap['Lunch_Status']] !== 'Needed') return;

      if (getCateringPolicyForLocation(meta.location) === CATERING_POLICIES.NEVER) {
        // NEVER is a hard fact ("this location cannot serve food"), not a
        // scheduling gap — so unlike ALWAYS/BY_EXCEPTION below, demand does
        // NOT override it. A row like this is a data artifact, almost
        // always a form that still asked about lunch before its location
        // was set to Never (createRegistrationForm()/refreshFormForNewDates()
        // strip that question going forward, but can't undo an answer
        // someone already submitted). Flag it for cleanup instead of
        // putting a blank row on the dashboard.
        noteForAdmin('Lunch needed at a Never-catering location',
          `${row[lrMap['Name']]} is marked Lunch_Status=Needed for ${meta.location} on ` +
          `${formatDateLabel(parseDateKey(meta.dateKey))}, but that location's policy is "Never." ` +
          `Probably a stale form answer — fix their Lunch_Status on Registrant_Dash.`);
        return;
      }

      // ...EXCEPT over an explicit "Not Serving". A missing menu row is a gap
      // and demand rightly overrides it (below); a row that READS "Not
      // Serving" is somebody's decision that the kitchen is closed that day,
      // and quietly catering it anyway because three people ticked a box on a
      // form weeks ago is not a safety net, it's an unordered meal.
      //
      // So the date leaves the dashboard, and the people who signed up are
      // collected here and reported by name below. Suppressing them silently
      // would be the actually dangerous version of this.
      if (isExplicitlyNotServing(parseDateKey(meta.dateKey), meta.location)) {
        const nsKey = `${meta.dateKey}|${meta.location}`;
        if (!notServingWithSignups[nsKey]) {
          notServingWithSignups[nsKey] = { dateKey: meta.dateKey, location: meta.location, people: [] };
        }
        // Deduped for the same reason the counts are (see lunchPersonEntry()):
        // this warning is read by a person who then goes and rings everyone on
        // it, and one name listed three times reads as three calls to make.
        // An unnamed row is still a person to account for, so it is never
        // merged into another - same rule as the counts.
        const nsName = String(row[lrMap['Name']] || '').trim();
        if (!nsName || notServingWithSignups[nsKey].people.indexOf(nsName) === -1) {
          notServingWithSignups[nsKey].people.push(nsName || '(unnamed)');
        }
        return;
      }

      // DEMAND ALWAYS WINS (for ALWAYS/BY_EXCEPTION). Policy decides what
      // gets SEEDED; it never suppresses a date somebody is actually signed
      // up to eat on. This is the safety net for "By exception" — forgetting
      // to add the menu row can make a date invisible on the schedule, but
      // never invisible once a real person is expecting lunch.
      const key = `${meta.dateKey}|${meta.location}`;
      if (!rollup[key]) {
        rollup[key] = {
          dateKey: meta.dateKey, location: meta.location,
          registeredCount: 0, servedConfirmed: 0, unplanned: true
        };
      }
      // ONE PERSON, ONE MEAL - however many of the day's forms they ticked
      // the lunch box on. See lunchPersonEntry() for why, and for why an
      // unnamed row is never merged into another.
      const entry = lunchPersonEntry(rollup[key], row, lrMap);
      if (entry.registered) entry.mergedRequests++;
      entry.registered = true;
      // THE LARGEST ORDER WINS across merged rows, never the sum. Three rows
      // for one person on one day are three FORMS they ticked the lunch box
      // on, not three orders — that is the whole reason this is keyed on the
      // person — so adding them up would restore the exact over-order
      // lunchPersonEntry() exists to prevent. Somebody who wrote 4 on one form
      // and left the others blank means four, not seven.
      const rowMeals = readRegistrantMealsOrdered(row, lrMap);
      if (rowMeals > entry.mealsOrdered) entry.mealsOrdered = rowMeals;
    });
  }

  // The counts are now READ OFF the person records rather than accumulated as
  // the rows go past, so there is exactly one definition of each number and
  // Lunch_Roster is guaranteed to list the very people the dashboard counted.
  Object.keys(rollup).forEach(key => {
    const r = rollup[key];
    // MEALS, not heads: Registered_Count is the number the kitchen orders
    // against, and one person can be down for four of them (see
    // countLunchMeals() and Meals_Ordered on Registrant_Dash).
    r.registeredCount = countLunchMeals(r);
    r.registeredPeople = countLunchPeople(r, 'registered');
    r.servedConfirmed = countLunchPeople(r, 'served');
    r.mergedRequests = Object.keys(r.people || {})
      .reduce((n, k) => n + r.people[k].mergedRequests, 0);
  });

  // Anything that only exists because someone registered for it, on a date
  // with no catered menu behind it, is worth telling a human about.
  Object.keys(rollup).forEach(key => {
    const r = rollup[key];
    if (!r.unplanned || r.registeredCount === 0 || r.dateKey < todayKey) return;
    const meal = getMealInfoForDate(parseDateKey(r.dateKey), r.location);
    const hasMenu = !!meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1;
    if (hasMenu) return;
    noteForAdmin('Lunch needed with no menu set',
      `${r.registeredCount} meal(s) for ${r.registeredPeople} person(s) are needed at ${r.location} on ` +
      `${formatDateLabel(parseDateKey(r.dateKey))}, ` +
      `but Lunch_Schedule has no Hot/Cold row for it.`);
  });

  // THE ONE THAT MATTERS MOST IN THIS FILE'S DIGEST. Everything else it
  // reports is a number that looks wrong somewhere; this is real people who
  // asked for a meal, are going to turn up expecting it, and are about to
  // stop appearing on every screen anyone looks at. The dashboard row going
  // away is correct — the kitchen is closed — but it must not be the last
  // anyone hears of it, so the names go out by email rather than only to a
  // log nobody reads.
  Object.keys(notServingWithSignups).forEach(key => {
    const entry = notServingWithSignups[key];
    if (entry.dateKey < todayKey) return; // already happened; nothing to act on
    noteForAdmin('⚠️ Lunch cancelled with people signed up',
      `${entry.people.length} person(s) asked for lunch at ${entry.location} on ` +
      `${formatDateLabel(parseDateKey(entry.dateKey))}, which Lunch_Schedule now marks "Not Serving": ` +
      `${entry.people.join(', ')}. They have been removed from the catering count and need telling. ` +
      `To keep the meal, change that date's Type back to Hot or Cold on Lunch_Schedule.`);
  });

  return Object.values(rollup).map(r => {
    const meal = getMealInfoForDate(parseDateKey(r.dateKey), r.location);
    r.mealType = meal ? meal.type : '';
    r.mealShorthand = meal ? (meal.shorthand || meal.description) : '';
    return r;
  }).sort((a, b) => (a.dateKey === b.dateKey ? a.location.localeCompare(b.location) : (a.dateKey < b.dateKey ? -1 : 1)));
}

function updateMasterLunchDashboard(registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_DASHBOARD);
  const headers = HEADERS.Master_Lunch_Dashboard;
  const map = getIndexMap(headers);
  const signUpRows = buildLunchSignUpRows(getLunchOnlyFormLinks());
  const plan = getDashboardRowPlan(signUpRows.length);
  const rollup = buildDashboardRollup(registrantRows);

  // 'Standard_Buffer' is unique to the Full Schedule headers (not present
  // on TODAY_LUNCH_HEADERS), so it safely finds only the schedule's own
  // header rows and not the Today block's.
  const existingTable = readAllSectionedRows(sheet, headers, 'Standard_Buffer');
  const tableByKey = {};
  existingTable.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    tableByKey[`${formatDateKey(d)}|${row[map['Location']]}`] = row;
  });

  rollup.forEach(r => {
    const key = `${r.dateKey}|${r.location}`;
    let row = tableByKey[key];
    const override = row ? String(row[map['Manual_Override']] || '').trim() : '';

    // "Manually Added" is a row somebody created outright — a day this pass
    // knows nothing about — so it stays entirely theirs.
    if (override === 'Manually Added') return;

    // "Manually Edited", though, is set by autoFlipManualOverride() on ANY
    // hand-edit anywhere in the row, and the columns this tab invites you to
    // type in (LUNCH_DASHBOARD_MANUAL_COLUMNS — Actual_Ordered and the
    // reconciliation numbers beside it) are in that row. So the very act of
    // recording what was ordered used to freeze Registered_Count at whatever
    // it read that morning: every registrant who signed up afterwards was
    // imported, counted in the rollup, listed on Lunch_Roster — and silently
    // never reached the number the kitchen orders against.
    //
    // A flip therefore protects the columns a person OWNS, not the ones this
    // pass derives. Registered_Count, Served_Confirmed, the meal type and the
    // buffers are recomputed on a hand-edited row exactly as on any other.
    const handEdited = override === 'Manually Edited';
    const put = (column, value) => {
      if (map[column] === undefined) return;
      if (handEdited && LUNCH_DASHBOARD_MANUAL_COLUMNS.indexOf(column) !== -1) return;
      row[map[column]] = value;
    };

    if (!row) {
      row = new Array(headers.length).fill('');
      row[map['Manual_Override']] = 'Auto-Synced';
      tableByKey[key] = row;
      existingTable.push(row);
    }

    // BUFFERS ARE READ FROM CONFIG ON EVERY RENDER, not written once at row
    // creation. The old code did the latter AND special-cased "no registrants
    // yet" to a hard 0 — so a date seeded before anybody signed up kept a
    // zero buffer forever, which is why the column read as zeroes on exactly
    // the upcoming dates it was supposed to be padding. There is one source of
    // truth for a buffer and it is the Config tab.
    const bufferConfig = getMealBufferConfigForLocation(r.location, r.mealType || 'Hot');
    put('Standard_Buffer', bufferConfig.standardBufferAmount);
    put('Tester_Buffer', bufferConfig.testerBufferAmount);

    put('Event_Date', parseDateKey(r.dateKey));
    put('Location', r.location);
    put('Lunch_Type', r.mealType || '');
    put('Meal_Shorthand', r.mealShorthand || '');
    put('Registered_Count', r.registeredCount);
    // Blank rather than 0 until someone has actually ticked a box: a real
    // zero ("nobody turned up") and "not counted yet" mean very different
    // things to whoever reconciles this, and 0 would assert the first.
    put('Served_Confirmed', r.servedConfirmed > 0 ? r.servedConfirmed : '');

    // The consumption columns only move when the Registrants tab actually
    // reports a meal for this date+location — a zero tally leaves whatever is
    // already in the cell alone, rather than blanking out a value someone
    // typed by hand before the per-person counts existed. Once real counts
    // start coming in they take over automatically, same as Served_Confirmed.
    const tallies = r.mealTallies || {};
    Object.keys(tallies).forEach(column => {
      if (tallies[column] > 0) put(column, tallies[column]);
    });
    // Same "only when there is something to say" rule as the tallies above:
    // a batch nobody carried over leaves the cell alone rather than asserting
    // a zero over it.
    if (r.carriedOver > 0) put('Carried_Over', r.carriedOver);
  });

  const tableRows = dropNotServingRows(existingTable, map, rollup);
  // The printed sheet for that day and building, if one has been built — a
  // derived cell recomputed on every render, never read back (see
  // 67_generated_file_links.gs). No leader sheet here: a meal has no leader.
  stampGeneratedFileLinks(tableRows, map, {});

  writeMasterLunchDashboardSheet(sheet, plan, headers, tableRows, rollup, signUpRows);

  // Same rollup, the other half of the same question: the dashboard says how
  // many meals, this says whose. Rendered from the same object in the same
  // call so the two can never be out of step with each other.
  renderLunchRosterSheet(rollup);
}

/**
 * Writes Lunch_Roster - one row per person per catered date+location.
 *
 * WHOLLY DERIVED. The tab is cleared and rebuilt from `rollup` on every render,
 * so nothing typed into it survives and nothing here needs an upsert, a
 * Manual_Override column or a protected-row rule. That is a deliberate
 * trade: the alternative - a hand-editable roster - would be a second place a
 * lunch registration can live, and the first time the two disagreed the
 * kitchen would get a number nobody could account for. The place to add a
 * person is Quick Mark, which writes a real registrant row; it lands here on
 * the next sync with everything else.
 *
 * Only people are listed, not every catered day: a date with a menu and no
 * takers contributes no rows. The count for such a day is on the dashboard,
 * where a zero is meaningful; a blank name row here would just be noise.
 */
function renderLunchRosterSheet(rollup) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_ROSTER);
  const headers = HEADERS.Lunch_Roster;
  const map = getIndexMap(headers);

  const rows = [];
  (rollup || []).forEach(bucket => {
    const people = bucket.people || {};
    Object.keys(people).forEach(slot => {
      const person = people[slot];
      // Somebody who neither asked for lunch nor was given one is on this
      // bucket only because a meal count or a served tick put them there via
      // another path; nothing to serve, nothing to list.
      if (!person.registered && !person.served) return;
      const row = new Array(headers.length).fill('');
      row[map['Event_Date']] = parseDateKey(bucket.dateKey);
      row[map['Location']] = bucket.location;
      row[map['Name']] = person.name || '(name not given)';
      // The day's menu wins over whatever the person's own row says: one
      // batch is cooked per date and location, and that is what they get.
      row[map['Lunch_Type']] = bucket.mealType || person.lunchType || '';
      // Always a number for somebody who is registered, never a blank that has
      // to be read as "presumably one": this is the column the desk counts
      // meals out against, and a 1 it can see is worth the ink.
      row[map['Meals']] = person.registered ? (person.mealsOrdered > 0 ? person.mealsOrdered : 1) : '';
      row[map['Lunch_Served']] = person.served ? '✅' : '';
      row[map['Registered']] = person.registered ? '✅' : '— walk-in';
      row[map['Requests_Merged']] = person.mergedRequests > 0 ? person.mergedRequests : '';
      row[map['Programs']] = person.programs.join(', ');
      row[map['Phone']] = person.phone;
      row[map['Source']] = person.source;
      rows.push(row);
    });
  });

  rows.sort((a, b) => {
    if (a[map['Location']] !== b[map['Location']]) {
      return String(a[map['Location']]).localeCompare(String(b[map['Location']]));
    }
    return String(a[map['Name']]).localeCompare(String(b[map['Name']]));
  });

  return renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Lunches (who is expecting a meal)',
    pastLabel: '🕓 Past Lunches (who was served)',
    force: true,
    afterWrite: applyLunchRosterFormatting
  });
}

/**
 * Lunch_Roster's afterWrite hook: location tinting like every other tab, and a
 * typing warning on the columns anybody would reach for.
 *
 * The warning is the important half. This is the one tab in the workbook that
 * looks exactly like somewhere you would add a name — it is a list of names,
 * on the lunch side of the workbook, and adding a name to the lunch list is a
 * thing staff do every day. It just isn't done here. Sheets says so at the
 * moment of typing, which is the only moment the message is any use.
 */
function applyLunchRosterFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];
  const activeZones = zones.filter(z => z.count > 0);

  sheet.setConditionalFormatRules(
    buildLocationColorRules(activeZones.map(z => sheet.getRange(z.start, map['Location'] + 1, z.count, 1))));

  activeZones.forEach(z => {
    sheet.getRange(z.start, map['Meals'] + 1, z.count, 1)
      .setNumberFormat('0').setHorizontalAlignment('center');
    sheet.getRange(z.start, map['Lunch_Served'] + 1, z.count, 1).setHorizontalAlignment('center');
    sheet.getRange(z.start, map['Registered'] + 1, z.count, 1).setHorizontalAlignment('center');
    sheet.getRange(z.start, map['Requests_Merged'] + 1, z.count, 1).setHorizontalAlignment('center');
  });

  // Nothing is ever hidden here, but visibility survives clear() — so it has
  // to be re-asserted rather than inherited from whatever the tab was before.
  applyColumnVisibility(sheet, headers, []);
  freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, headers.length));

  // Only the columns somebody would plausibly type into, rather than all ten:
  // each name costs a protection object per zone on every render, and a
  // warning on Source is a warning nobody was ever going to trip.
  protectDerivedColumns(sheet, headers, ['Name', 'Meals', 'Lunch_Served', 'Requests_Merged'], zones);

  // No autosize here: renderFlatDateSheet() does it immediately after.
}

/**
 * Removes the schedule rows for upcoming dates that Lunch_Schedule now marks
 * "Not Serving".
 *
 * WHY THIS IS NEEDED AT ALL: the Full Schedule table is UPSERTED, not rebuilt.
 * That's deliberate — it's what makes hand-entered buffers and actuals survive
 * every sync — but it also means a row, once written, never leaves on its own.
 * So closing the kitchen on a date the dashboard had already picked up left
 * the row sitting there with its old count, indefinitely, and the ordering
 * number stayed on the screen the kitchen orders from.
 *
 * Three things are deliberately NOT dropped:
 *
 *   PAST DATES. Those rows hold Actual_Ordered / Total_Consumed / Thrown_Away —
 *   a record of what really happened. Marking an old date "Not Serving" is
 *   almost always a correction to the plan, and it must not erase the receipt.
 *
 *   HAND-EDITED ROWS (Manually Added / Manually Edited). Everything else in
 *   this workbook treats those as untouchable; an exception here would be the
 *   one place a person's own row disappears under them. Reported instead.
 *
 *   ROWS STILL IN THE ROLLUP. A "Not Serving" day where somebody's
 *   Lunch_Served box is ticked stays, because food demonstrably happened —
 *   Served_Confirmed records reality, not the plan.
 */
function dropNotServingRows(tableRows, map, rollup) {
  const inRollup = {};
  (rollup || []).forEach(r => { inRollup[`${r.dateKey}|${r.location}`] = true; });

  const todayKey = formatDateKey(new Date());
  const kept = [];
  let dropped = 0;

  tableRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    const location = String(row[map['Location']] || '').trim();
    if (!d || !location) { kept.push(row); return; }

    const dateKey = formatDateKey(d);
    if (inRollup[`${dateKey}|${location}`]) { kept.push(row); return; }
    if (dateKey < todayKey) { kept.push(row); return; }
    if (!isExplicitlyNotServing(d, location)) { kept.push(row); return; }

    const override = String(row[map['Manual_Override']] || '').trim();
    if (override === 'Manually Added' || override === 'Manually Edited') {
      noteForAdmin('Not-Serving date still on the lunch dashboard',
        `${formatDateLabel(d)} at ${location} is marked "Not Serving", but its dashboard row was ` +
        `hand-edited (${override}) so it has been left alone. Delete it yourself if it shouldn't be ordered.`);
      kept.push(row);
      return;
    }

    dropped++;
  });

  if (dropped > 0) {
    log(`Master_Lunch_Dashboard: removed ${dropped} upcoming row(s) for date+location(s) now marked "Not Serving".`);
  }
  return kept;
}

/**
 * The pinned block at the very top of Master_Lunch_Dashboard: the lunch-only
 * sign-up form for each location and month, as a link somebody can copy.
 *
 * WHY A LINK COLUMN AND NOT A URL. The published URL of a Google Form is 90-odd
 * characters of no meaning, and five of them stacked in a column is a wall.
 * makeHyperlinkFormula() shows the words and keeps the address behind them —
 * right-click, copy link, paste into an email, same as every other link in this
 * workbook. The Edit_Form link is there because "can you add a note to the
 * form" is the request that follows "can you send me the link".
 *
 * WITH NO FORMS YET the block still draws, carrying the reason instead of a
 * row. An empty block would read as a feature that is broken; a sentence
 * saying "no catered dates on Lunch_Schedule yet" reads as a step not done,
 * which is what it is.
 */
function writeLunchSignUpBlock(sheet, plan, numCols, signUpRows) {
  const rows = signUpRows || [];
  writeSectionBanner(sheet, plan.signUpBannerRow, numCols,
    '🥡 LUNCH SIGN-UP FORMS',
    { hero: true, note: 'For people who come for the meal rather than for a program — ' +
      'one form per location, listed below.' });
  // Padded to the tab's full width so the header BAND spans the sheet like
  // every other header row on it. Stopping at column E left five grey cells
  // floating in a twenty-column row, which reads as a half-drawn table rather
  // than as a section of one.
  const headerRow = LUNCH_SIGNUP_HEADERS.concat(
    new Array(Math.max(0, numCols - LUNCH_SIGNUP_HEADERS.length)).fill(''));
  writeSectionHeader(sheet, plan.signUpHeaderRow, headerRow.length, headerRow);

  // The link column is the last one used, so it may spill across the empty
  // columns to its right instead of being clipped — see LUNCH_SIGNUP_HEADERS.
  const linkCol = LUNCH_SIGNUP_HEADERS.indexOf('Sign_Up_Link') + 1;

  if (rows.length === 0) {
    sheet.getRange(plan.signUpDataStart, 1, 1, LUNCH_SIGNUP_HEADERS.length).setValues([[
      '—', '—', 0, '',
      `No catered dates on ${SHEET_NAMES.LUNCH_SCHEDULE} yet — add a Hot or Cold row and the form builds itself on the next sync.`
    ]]);
    sheet.getRange(plan.signUpDataStart, 1, 1, LUNCH_SIGNUP_HEADERS.length)
      .setFontStyle('italic').setFontColor(TYPO.MUTED.color).setVerticalAlignment('middle');
    sheet.getRange(plan.signUpDataStart, linkCol, 1, 1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
    sheet.getRange(plan.signUpSpacerRow, 1, 1, numCols).clearContent().setBackground(PALETTE.PAPER);
    return;
  }

  const shown = rows.slice(0, LUNCH_SIGNUP_PINNED_LIMIT);
  const values = shown.map(r => [
    r.location,
    r.monthLabel,
    r.dateCount,
    makeHyperlinkFormula(r.editUrl, 'Edit Form'),
    makeHyperlinkFormula(r.publishedUrl, `Sign up for lunch — ${r.location}, ${r.monthLabel}`)
  ]);
  if (rows.length > shown.length) {
    values.push(['…', '…', '', '',
      `+ ${rows.length - shown.length} later month(s) — their links are on ${SHEET_NAMES.PROGRAM_DASHBOARD}, ` +
      `on any "${LUNCH_ONLY_LABEL_PREFIX}…" row.`]);
  }
  const range = sheet.getRange(plan.signUpDataStart, 1, values.length, LUNCH_SIGNUP_HEADERS.length);
  range.setValues(values).setVerticalAlignment('middle');
  sheet.getRange(plan.signUpDataStart, 1, shown.length, 1)
    .setFontSize(TYPO.HERO_LABEL.size).setFontWeight('bold');
  sheet.getRange(plan.signUpDataStart, 3, values.length, 1).setHorizontalAlignment('center');
  sheet.getRange(plan.signUpDataStart, linkCol, values.length, 1)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  if (values.length > shown.length) {
    sheet.getRange(plan.signUpDataStart + shown.length, 1, 1, LUNCH_SIGNUP_HEADERS.length)
      .setFontStyle('italic').setFontColor(TYPO.MUTED.color);
  }
  // Striped across the WHOLE width, not just the five columns in use: the link
  // spills into the empty columns beside it, and a stripe that stopped at
  // column E would cut the text it is meant to sit behind in half.
  applyZebraStripingManualBounded(sheet, plan.signUpDataStart, values.length, numCols);
  sheet.getRange(plan.signUpSpacerRow, 1, 1, numCols).clearContent().setBackground(PALETTE.PAPER);
}

function writeMasterLunchDashboardSheet(sheet, plan, headers, fullTableRows, rollup, signUpRows) {
  const map = getIndexMap(headers);
  const numCols = headers.length;

  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // see renderFlatDateSheet() — hidden rows outlive clear()
  // ...and so do row heights. Everything above the schedule is re-measured
  // from scratch every render and changes size when the pinned block does, so
  // it starts flat and the writers below make tall only what they use.
  resetRowHeights(sheet, 1, plan.scheduleStartRow + 1);
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  writeLunchSignUpBlock(sheet, plan, numCols, signUpRows);

  writeSectionBanner(sheet, plan.todayBannerRow, numCols,
    `📋 TODAY'S LUNCH — ${Utilities.formatDate(new Date(), TIMEZONE, 'EEEE, MMM d, yyyy')}`,
    { hero: true });
  writeSectionHeader(sheet, plan.todayHeaderRow, TODAY_LUNCH_HEADERS.length, TODAY_LUNCH_HEADERS);
  const todayMap = getIndexMap(TODAY_LUNCH_HEADERS);

  const todayKey = formatDateKey(new Date());
  const dateColIdx = map['Event_Date'];
  const { upcoming, past } = partitionByDate(fullTableRows, dateColIdx, todayKey);

  const registeredCol = columnToLetter(map['Registered_Count'] + 1);
  const standardBufferCol = columnToLetter(map['Standard_Buffer'] + 1);
  const testerBufferCol = columnToLetter(map['Tester_Buffer'] + 1);
  const totalToOrderColLetter = columnToLetter(map['Total_to_Order'] + 1);

  // Deterministic row math mirroring exactly what writeUpcomingPastSections()
  // below will place, computed up front so the Total_to_Order formulas (and
  // the Today block's cross-reference to them) can be written before the
  // sections are actually rendered.
  const upcomingHeaderRow = plan.scheduleStartRow + 1;
  const upcomingDataStart = upcomingHeaderRow + 1;
  // +1 blank spacer row, +1 for the Past section's own banner row (writeUpcomingPastSections
  // writes: spacer, banner, header, data — so the header sits TWO rows after the last
  // upcoming data row's end, not one; this previously under-counted by one row).
  const pastHeaderRow = upcomingDataStart + upcoming.length + 2;
  const pastDataStart = pastHeaderRow + 1;

  const scheduleRowByKey = {};
  const assignRowKeyAndFormula = (row, sheetRow) => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d) scheduleRowByKey[`${formatDateKey(d)}|${row[map['Location']]}`] = sheetRow;
    row[map['Total_to_Order']] = `=${registeredCol}${sheetRow}+${standardBufferCol}${sheetRow}+${testerBufferCol}${sheetRow}`;
  };
  upcoming.forEach((row, i) => assignRowKeyAndFormula(row, upcomingDataStart + i));
  past.forEach((row, i) => assignRowKeyAndFormula(row, pastDataStart + i));

  const locations = Object.values(CALENDAR_MAP);
  const todayRows = locations.map(loc => {
    const match = rollup.find(r => r.dateKey === todayKey && r.location === loc);
    const row = new Array(TODAY_LUNCH_HEADERS.length).fill('');
    row[todayMap['Location']] = loc;
    if (match) {
      row[todayMap['Lunch_Type']] = match.mealType || '';
      row[todayMap['Meal_Shorthand']] = match.mealShorthand || '';
      row[todayMap['Registered_Count']] = match.registeredCount;
      row[todayMap['Served_Confirmed']] = match.servedConfirmed > 0 ? match.servedConfirmed : '';
      const scheduleRow = scheduleRowByKey[`${todayKey}|${loc}`];
      row[todayMap['Total_to_Order']] = scheduleRow ? `=${totalToOrderColLetter}${scheduleRow}` : match.registeredCount;
    } else {
      row[todayMap['Lunch_Type']] = '';
      row[todayMap['Meal_Shorthand']] = 'No lunch orders today';
      row[todayMap['Registered_Count']] = 0;
      row[todayMap['Served_Confirmed']] = '';
      row[todayMap['Total_to_Order']] = 0;
    }
    return row;
  });

  if (todayRows.length > 0) {
    const todayRange = sheet.getRange(plan.todayDataStart, 1, todayRows.length, TODAY_LUNCH_HEADERS.length);
    todayRange.setValues(todayRows);
    // The Today block is the one thing on this tab someone reads standing up,
    // mid-service, from further away than a spreadsheet is normally read — so
    // it gets a real size step, taller rows, and centered numbers rather than
    // being just another 10pt table.
    todayRange.setFontSize(TYPO.HERO_LABEL.size).setVerticalAlignment('middle');
    ['Registered_Count', 'Served_Confirmed', 'Total_to_Order'].forEach(h => {
      sheet.getRange(plan.todayDataStart, todayMap[h] + 1, todayRows.length, 1)
        .setNumberFormat('0')
        .setFontSize(TYPO.HERO_VALUE.size)
        .setFontWeight(TYPO.HERO_VALUE.weight)
        .setFontColor(TYPO.HERO_VALUE.color)
        .setHorizontalAlignment('center');
    });
    sheet.getRange(plan.todayDataStart, todayMap['Location'] + 1, todayRows.length, 1)
      .setFontSize(TYPO.HERO_LABEL.size).setFontWeight('bold');
    for (let r = 0; r < todayRows.length; r++) {
      try { sheet.setRowHeight(plan.todayDataStart + r, ROW_HEIGHTS.HERO_DATA); } catch (err) { /* row absent */ }
    }
  }
  applyZebraStripingManualBounded(sheet, plan.todayDataStart, todayRows.length, TODAY_LUNCH_HEADERS.length);
  sheet.getRange(plan.spacerRow, 1, 1, numCols).clearContent().setBackground(PALETTE.PAPER);

  const result = writeUpcomingPastSections(sheet, plan.scheduleStartRow, headers, upcoming, past, {
    upcomingLabel: '📊 Upcoming Lunch Schedule', pastLabel: '📊 Past Lunch Schedule'
  });
  if (result.upcomingDataStart !== upcomingDataStart || result.pastDataStart !== pastDataStart) {
    log(`⚠️ Master_Lunch_Dashboard row math mismatch — Total_to_Order cross-references may be off. ` +
      `Expected upcoming@${upcomingDataStart}/past@${pastDataStart}, got upcoming@${result.upcomingDataStart}/past@${result.pastDataStart}.`);
  }

  labelManualEntryColumns(sheet, result.upcomingHeaderRow, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);
  labelManualEntryColumns(sheet, result.pastHeaderRow, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);

  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];
  const numericCols = ['Registered_Count', 'Served_Confirmed', 'Actual_Ordered', 'Standard_Buffer',
    'Tester_Buffer', 'Day_1_In-Person', 'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'In_Fridge',
    'Carried_Over', 'Total_Consumed', 'Thrown_Away', 'Discrepancy'];

  zones.forEach(z => {
    if (z.count < 1) return;
    sheet.getRange(z.start, map['Event_Date'] + 1, z.count, 1).setNumberFormat(DATE_DISPLAY_FORMAT);
    numericCols.forEach(h => sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0'));
    tintManualEntryColumns(sheet, z.start, z.count, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);
  });

  freezeRowsSafely(sheet, result.upcomingHeaderRow);
  const locationCol = map['Location'] + 1;

  zones.forEach(z => {
    if (z.count < 1) return;
    applyManualOverrideValidationBounded(sheet, map['Manual_Override'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Type'] + 1, LUNCH_TYPE_OPTIONS, z.start, z.count);
    applyLocationValidationBounded(sheet, locationCol, z.start, z.count);
  });

  const todayLocationCol = todayMap['Location'] + 1;
  applyLocationValidationBounded(sheet, todayLocationCol, plan.todayDataStart, plan.numLocations);

  const rules = [];
  const manualEntryColIndexes = LUNCH_DASHBOARD_MANUAL_COLUMNS.map(h => map[h] + 1);
  zones.forEach(z => {
    if (z.count < 1) return;
    rules.push(...buildManualOverrideRowTintRules(sheet, z.start, z.count, numCols, map['Manual_Override'] + 1,
      [locationCol, map['Event_Date'] + 1, ...manualEntryColIndexes]));
  });

  const activeZones = zones.filter(z => z.count > 0);
  const typeRanges = activeZones.map(z => sheet.getRange(z.start, map['Lunch_Type'] + 1, z.count, 1));
  const notServingRule = buildTextEqualsRuleForRanges(typeRanges, 'Not Serving', NOT_SERVING_COLOR);
  if (notServingRule) rules.push(notServingRule);

  // Location color-coding on the LOCATION CELL ONLY, the same as every other
  // tab. It used to wash the whole row, on the theory that a block of color
  // makes "everything for Ashbridge that week" scannable — but this tab
  // already carries the month tint on Event_Date, the grey "Not Serving"
  // type, the purple manual-override tint and a yellow band of hand-entry
  // columns, and a full-row wash underneath all of that turned the numbers
  // people read into figures on a colored background rather than making
  // anything easier to find. One cell says the same thing and gets out of
  // the way.
  const locationRanges = activeZones.map(z => sheet.getRange(z.start, locationCol, z.count, 1));
  locationRanges.push(sheet.getRange(plan.todayDataStart, todayLocationCol, plan.numLocations, 1));
  rules.push(...buildLocationColorRules(locationRanges));

  sheet.setConditionalFormatRules(rules);

  // Everything to the left of the hand-entry columns is derived from the forms
  // and the menu — warn if someone types over it. Manual_Override is left
  // editable on purpose: switching a row to "Manually Added" is precisely how
  // staff tell the sync to stop managing it.
  protectDerivedColumns(sheet, headers,
    ['Event_Date', 'Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count', 'Served_Confirmed',
      'Day_1_In-Person', 'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'In_Fridge', 'Carried_Over',
      // Config owns these now — typing over one is overwritten on the next
      // render, and the warning says where to change it instead.
      'Standard_Buffer', 'Tester_Buffer',
      'Sign_In_Sheet_Link'],
    zones);

  // Nothing on this tab is an internal key, so nothing is hidden — but the
  // call still runs, so a column taken OFF a future hidden list reappears.
  applyColumnVisibility(sheet, headers, LUNCH_DASHBOARD_HIDDEN_COLUMNS);
  freezeColumnsSafely(sheet, 2); // date + location stay visible across the wide reconciliation columns

  autosizeColumns(sheet, { minCols: numCols });
}


