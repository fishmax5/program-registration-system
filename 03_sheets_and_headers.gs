/**
 * One color per location, used BOTH for the Location cell itself and (on
 * Master_Lunch_Dashboard) for the whole row band — see
 * buildLocationColorRules() / buildLocationRowTintRules().
 */
defineLazyGlobal_('LOCATION_COLOR_MAP', () => ({
  // THE TINT LAYER (see PALETTE): the same three hues these have always been,
  // so nobody has to relearn which building is which — but paled off, because
  // at their old strength they were indistinguishable from the status colors
  // sitting in the next column. A location is context, not a signal.
  'Narberth': PALETTE.LOC_PEACH,
  'Ashbridge': PALETTE.LOC_GREEN,
  'Zoom': PALETTE.LOC_LILAC
}));

const SHEET_NAMES = {
  CONFIG: 'Config',
  // The per-session table. It was called 'Master_Program_Dashboard', then
  // briefly 'Program_Sessions' — it was never a dashboard in the sense the
  // lunch one is: it is the session ledger every other tab is derived from,
  // and the month tab is what a person reads when they want a summary.
  // LEGACY_SHEET_RENAMES carries an existing workbook's tab across in place,
  // rows and formatting intact.
  //
  // Its HEADERS key was renamed with it, unlike the usual practice here
  // (LEADER_SHEET_REGISTRY_PROP_KEY is still spelled
  // 'INSTRUCTOR_SHEET_REGISTRY_V1'): HEADERS is indexed by SHEET NAME in
  // 13_lunch_only_signup_form.gs and 14_saved_column_widths.gs, and the
  // month tab has now taken the name 'Master_Program_Dashboard' — so a
  // HEADERS key left on the old spelling would hand the month tab the
  // session table's columns.
  PROGRAM_DASHBOARD: 'All_Program_Sessions',
  // ONE ROW PER PROGRAM — one title, at the building(s) it runs in, for as
  // long as it runs. DERIVED, top to bottom, from the session table:
  // nothing is stored here that is not already on a session row, which is
  // what makes deleting this tab a cosmetic act rather than a data loss.
  // See 78_program_month_dashboard.gs. It carries the name the session
  // ledger gave up: 'Master_Program_Dashboard' is what everybody already
  // calls the front page, and the month view is what the front page now is.
  PROGRAM_MONTH: 'Master_Program_Dashboard',
  REGISTRANT_DASH: 'All_Registrants',
  LUNCH_DASHBOARD: 'Master_Lunch_Dashboard',
  LUNCH_ROSTER: 'All_Lunch_Registrants',
  LUNCH_SCHEDULE: 'Lunch_Schedule',
  TRIAGE: 'Deleted_Event_Triage',
  MEMBER_ROLL: 'Member_Roll',
  // EVERYTHING STANDING THAT IS TRUE OF A PROGRAM, on one row.
  //
  // This was two tabs — Program_Options ("the big room, and about twelve
  // people come") and Registrant_Notifications ("invite them, and write the
  // morning of"). They had the SAME GRAIN (one row per Clean_Title x
  // Location), the SAME KEY, the same recomputed left half, and they were
  // refreshed from the same session rows in the same pass. Two tabs answering
  // one question about one program is two tabs to find, two rows to keep in
  // step through a rename, and two places for the same program to be missing
  // from. See section 6c / 9h and LEGACY_SHEET_RENAMES below: an existing
  // workbook's Program_Options tab is carried across in place and the
  // notification tab's ticks are migrated onto it.
  PROGRAM_SETTINGS: 'Program_Settings',
  // Who leads what, where to write to them, and whether they want to hear
  // about it when their roster moves — see section 9c. Separate from
  // Program_Settings because a leader is a PERSON who may lead three programs
  // at two sites, and an address column on a program row could only ever
  // answer that question in one direction. This is the tab the NO WILDCARDS
  // privacy rule lives on, and it is why the merge above stopped where it did.
  PROGRAM_LEADERS: 'Program_Leaders',
  CLUB_MEMBERS: 'Club_Members',
  // The two tabs behind [Personalized Assistance] and the per-program extra
  // questions — see ASSISTANCE_TAG and section 6g.
  PROGRAM_QUESTIONS: 'Program_Questions',
  ASSISTANCE_REQUESTS: 'Assistance_Requests',
  // The standing facts about a person that a sign-in desk would otherwise
  // have to already know — see section 6e.
  REGULAR_NEEDS: 'Regular_Needs',
  // One row per calendar month, written once and then left alone — see
  // 83_monthly_metrics.gs. It is the only tab in this workbook that is a
  // RECORD rather than a projection of the current data: the registrant rows
  // a month was counted from are eventually archived, and a stored row is
  // what still answers "how did last September compare to the one before".
  METRICS: 'Metrics'
};

const LEGACY_ACTIVE_PROGRAMS_SHEET_NAME = 'Active_Programs';

/**
 * The two tab names Program_Settings replaces, spelled out for the migrations
 * that still have to LOOK at them.
 *
 * Program_Options is renamed in place by LEGACY_SHEET_RENAMES, so the name is
 * only needed by the one-time readers that run BEFORE the first merged write
 * (readLegacyInstructorEmails, readLegacyNotifyModeRows) and may therefore
 * meet the tab under either name — see programSettingsSheetForLegacyRead().
 *
 * Registrant_Notifications is NOT renamed: a workbook that has both would
 * otherwise lose one of them. Its staff ticks are copied onto the merged tab
 * once (migrateRegistrantNotificationTicks) and the tab is then marked
 * retired, so nothing is thrown away by a migration nobody watched run.
 */
const LEGACY_PROGRAM_OPTIONS_SHEET_NAME = 'Program_Options';
const LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME = 'Registrant_Notifications';
const RETIRED_SHEET_NAME_SUFFIX = ' (retired)';

/**
 * Tabs this workbook used to call something else -> what they are called now.
 *
 * A tab rename is not cosmetic to a workbook that already holds data: the code
 * asks for a sheet BY NAME, and a workbook whose registrant history sits on a
 * tab nobody asks for any more would answer "no rows" — quietly, and on every
 * path at once. getOrCreateSheet() therefore renames the old tab in place
 * BEFORE it would create an empty new one, which keeps the data, its
 * formatting, and every reference to it intact.
 *
 * Only ever applied when the new name is absent: a workbook that somehow has
 * both is left exactly as it is rather than having one of them clobbered.
 */
// ORDER MATTERS HERE, which it never used to, and a value may now be a LIST.
//
// A tab that has been renamed twice is still sitting under whichever of its
// names its workbook stopped at, so the entry names them newest-first and the
// first one actually present wins:
//
//   Lunch_and_Event_Registrants -> Registrant_Dash -> All_Registrants
//   Master_Program_Dashboard -> Program_Sessions -> All_Program_Sessions
//
// A list rather than a chain of one-hop entries because the destination is
// what the "only when the new name is absent" rule is checked against: an
// already-migrated workbook HAS All_Program_Sessions, so the whole entry is
// skipped — and it has to be, because 'Master_Program_Dashboard' is no longer
// a name nobody is using. It is the MONTH tab now (SHEET_NAMES.PROGRAM_MONTH),
// which is also why that entry is written last: the month tab inherits the
// name only once the session ledger has finished vacating it.
const LEGACY_SHEET_RENAMES = {
  'All_Registrants': ['Registrant_Dash', 'Lunch_and_Event_Registrants'],
  'All_Lunch_Registrants': 'Lunch_Roster',
  // Renamed September 2026. The session ledger, under the two names it carried
  // while it was called a dashboard. A workbook that somehow holds BOTH is
  // left alone by the rule above — which is the case that matters here,
  // because Program_Sessions is a name somebody could plausibly have given a
  // tab of their own.
  'All_Program_Sessions': ['Program_Sessions', 'Master_Program_Dashboard'],
  'Master_Program_Dashboard': 'Program_Month',
  // Renamed September 2026, when Program_Options and Registrant_Notifications
  // became one tab. Program_Options is the one carried across IN PLACE,
  // because it is the older of the two and holds the column nothing can
  // regenerate (Room_Or_Setup, Typical_Attendance, years of Staff_Notes):
  // renaming it keeps the rows, the formatting and every reference to it.
  // The notification tab's ticks are copied onto it afterwards by a migration
  // rather than by a rename — two tabs cannot both become one tab by being
  // renamed, and the ticks are what "an unticked box means off" is standing on.
  'Program_Settings': LEGACY_PROGRAM_OPTIONS_SHEET_NAME
};
/**
 * Column layouts. Every date-bearing sheet now leads with Event_Date (its
 * cell background carries the month tint that used to live in a separate
 * Month column). All_Program_Sessions's session table no longer has a
 * Manual_Override column at all; the other date-bearing tabs keep it as
 * the second column.
 */
defineLazyGlobal_('HEADERS', () => ({
  // The per-session table inside All_Program_Sessions (section C).
  //
  // The KEY still spells the old tab name. That is deliberate: a schema key is
  // read by code, a tab name by people, and the tab was renamed for the
  // people. Renaming the key too would rewrite ~170 call sites to buy nothing
  // and would silently mismatch any workbook mid-upgrade. Same reasoning as
  // LEADER_SHEET_REGISTRY_PROP_KEY still being spelled
  // 'INSTRUCTOR_SHEET_REGISTRY_V1'.
  //
  // Active_Count sits directly beside Status — "how many signed up" and "is it
  // full" is the pair anyone reads first. On an APPOINTMENT session it counts
  // SLOTS TAKEN rather than heads, because that is the unit its Max_Capacity
  // is written in and Remaining_Seats is the subtraction of the two: a couple
  // seeing the provider together is one appointment, and counting them as two
  // closed a session with a free time still on its form. See
  // occupancyForSession(). The three CAPACITY columns
  // (Max_Capacity / Waitlist_Count / Remaining_Seats) trail at the end of the
  // VISIBLE run instead, ahead of the hidden plumbing block: most programs
  // here are uncapped, so all three read "" / "🟢 Unlimited" on most rows, and
  // three columns of nothing sitting between the count and the status pushed
  // the form links off the screen to say it.
  //
  // Hidden columns (PROGRAM_DASHBOARD_HIDDEN_COLUMNS) stay last. They don't
  // have to be — applyColumnVisibility() hides by NAME, not position — but
  // keeping them there means the visible table is a contiguous block, which
  // is what makes "the end of the row" mean anything.
  //
  // Club and No_Registration sit immediately after Type_Tag because the three
  // together are what decide how a program behaves: Type_Tag says which
  // sessions share a form, Club says whether signing up once keeps you signed
  // up (see CLUB_TAG), and No_Registration says whether there is a form at all
  // (see NO_REGISTRATION_TAG).
  //
  // All three are calendar-derived AND editable here. The two flags are real
  // checkboxes: ticking one asks, then writes its tag into the program's
  // calendar event descriptions, which is what makes the tick stick instead of
  // being wiped by the next render (see handleProgramDashboardEdit()).
  //
  // Event_Time reads as a RANGE ("10:00 AM – 11:30 AM"), which needs an end
  // time to exist somewhere. Event_Date has only ever carried the START, so
  // Event_End is stored alongside the other machine columns at the end of the
  // row and hidden: nobody reads a raw datetime, but Event_Time and the
  // registrant rows are both built from it. A row written before this column
  // existed simply has none, and Event_Time falls back to the start time
  // alone rather than inventing an end.
  //
  // Personalized_Assistance is the third flag, beside the other two and for
  // the same reason: it is what decides how the program is registered for at
  // all (by a time, not by a date — see ASSISTANCE_TAG). Slot_Minutes rides
  // with the hidden machine columns because it is an input to the slot
  // arithmetic rather than something staff read: it is how the form layer
  // rebuilds a session's appointment times without going back to the calendar.
  // Registrant_Sheet_Link and Sign_In_Sheet_Link sit with the other two links
  // because they are the same kind of thing: somewhere else to click through
  // to. They point at the two files this system produces OUTSIDE the workbook
  // — the spreadsheet a program leader marks up, and the printed sign-in PDF
  // for that day and building. Both are DERIVED: every render recomputes them
  // from the registries and overwrites whatever is in the cell, so a link can
  // never outlive the file it points at. See 69_generated_file_links.gs.
  //
  // Waitlist_Only is the fourth tick and the odd one out: the other three
  // describe a PROGRAM and are the same on every one of its dates, while this
  // one describes THIS DATE and nothing else (see WAITLIST_ONLY_TAG). It sits
  // with the capacity columns rather than with the flags for exactly that
  // reason — it is the answer to "can this session still take anybody",
  // alongside the three numbers that usually answer it — and ticking it sends
  // every further registration for that one session to the waitlist however
  // much room Max_Capacity says is left, including when there is no cap at all.
  All_Program_Sessions: [
    'Event_Date', 'Location', 'Clean_Title', 'Event_Time', 'Type_Tag', 'Club', 'No_Registration',
    'Personalized_Assistance',
    'Active_Count', 'Status', 'Waitlist_Only', 'Form_Response_Link', 'Edit_Form_Link',
    'Registrant_Sheet_Link', 'Sign_In_Sheet_Link',
    'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats',
    'Form_ID', 'Calendar_Synced?', 'Event_ID', 'Calendar_Source', 'Event_End', 'Slot_Minutes',
    'Max_Per_Month'
  ],
  /**
   * Master_Program_Dashboard — ONE ROW PER PROGRAM (see SHEET_NAMES.PROGRAM_MONTH).
   *
   * It was one row per program-MONTH, which was the right grain for the tab's
   * first question — buildEventGroups() makes one FORM per program per month,
   * so that is the unit a capacity and a set of links belong to. It is the
   * wrong grain for the question people actually bring to a front page:
   * "what do we run, and who runs it?" A weekly class was twelve rows a year,
   * eleven of which differed from the first only in which twelve dates they
   * summed.
   *
   * A PROGRAM IS ITS TITLE AND THE BUILDING(S) IT RUNS IN, and the row's
   * identity says exactly that. Form_ID is still what resolves the one case a
   * (title, location) key gets wrong — a [Shared] program has ONE form across
   * two buildings and is ONE thing to run, so it is one row with Location
   * reading "Narberth + Ashbridge" — but the form is no longer the key
   * itself, because a Regular program takes a NEW form every month and
   * keying on it is how the month got into the grain in the first place.
   *
   * NEXT_DATE LEADS THE ROW AND IS A REAL DATE, for the same reason Event_Date
   * leads every other date-bearing tab: it is what the sectioned readers and
   * the month tint are defined against. It is the next session from today, and
   * it is BLANK for a program that is not currently running — which is the
   * whole of what the Running / Not currently running split is decided on.
   * Last_Date is when it last ran (or last will), and is what the second
   * section is ordered by: a program that finished in June sits above one that
   * finished in 2019.
   *
   * FIFTEEN COLUMNS A PERSON READS, and two behind them. It was nineteen at
   * twelve times the row count. The rule describeProgramMonthSchedule() was
   * written under became the rule for the whole tab: THE FACT GOES IN THE
   * CELL AND THE FOLLOW-UP QUESTION GOES IN A CELL NOTE.
   *
   *   Schedule  the cadence, the times, the span and the count — "Weekly ·
   *             Tue 9:30 AM – 11:30 AM · Sep 2026 – Jun 2027 · 38 sessions".
   *             The per-month breakdown, and any week the run skips, are in
   *             the note. Sessions drills through to the session table, which
   *             is where a month of dates belongs.
   *   Notify    the six notification tick boxes on Program_Settings, as one
   *             phrase — "Cal · 7d · AM". READ-ONLY, and read fresh on every
   *             render off the one memoized read of that tab the invitation
   *             and reminder passes already make. Nothing is stored: the
   *             ticks are the answer, this is a window onto them, and the
   *             place to change one is the tab that owns it.
   *   Room      Program_Settings' Room_Or_Setup, same read, same rule.
   *   Seats     Registered + Max_Capacity + Fill + Waitlist, summed over THIS
   *             MONTH AND NEXT — not over the program's whole life. At this
   *             grain a lifetime total would be a number that only ever goes
   *             up, says nothing about whether there is room next Tuesday, and
   *             would read as a capacity somebody could book against. The
   *             window is stated in the column note, and the Sessions
   *             drill-through is where history lives.
   *   Links     Form_Response_Link, Edit_Form_Link, Registrant_Sheet_Link and
   *             Sign_In_Sheet_Link, in one cell of rich text with a live link
   *             per word — the CURRENT ones, off the program's most recent
   *             session, because a Regular program has a form per month and
   *             the one worth handing out is this month's.
   *
   * THE THREE PROGRAM FLAGS LIVE HERE — Club, No_Registration and
   * Personalized_Assistance, as real tick boxes on the row of the thing they
   * describe. They were on the session table, where they were ticked onto
   * EVERY row of a program because they are facts about the program and not
   * about a date: twelve identical checkboxes, eleven of which existed only so
   * that the twelfth could not disagree with them. This is the row that IS the
   * program, so it is the row that carries them; the session table keeps the
   * columns as hidden plumbing (PROGRAM_DASHBOARD_HIDDEN_COLUMNS), because
   * they are still where the answer is stored and where the calendar sync
   * reconciles it.
   *
   * They are WINDOWS, like Leader, and for the same reason: ticking one writes
   * through to every session row of that program and queues the tag onto the
   * calendar (handleProgramMonthFlagEdit in 18), and the next render reads the
   * answer back off the session rows. Nothing is stored here.
   *
   * LEADER IS NOT STORAGE. It is the one column on this tab that a person may
   * TYPE into, and what they type is written straight onto Program_Leaders —
   * the tab that actually shares a roster and sends the mail. Nothing here is
   * ever read back as the answer to "who leads this": the next render reads it
   * off Program_Leaders again. Two records disagreeing about who may read a
   * roster is found out the day somebody is emailed a class they do not teach,
   * so there is only ever one. Leader_Source used to sit beside it saying
   * 'typed' or 'matched'; a yellow wash and a cell note say the interesting
   * half on their own.
   *
   * Form_ID trails at the end with Group_Key, hidden like the session table's
   * plumbing block (PROGRAM_MONTH_HIDDEN_COLUMNS): Form_ID is the program's
   * current form, and Group_Key is the row's own identity — both are for
   * reading in the formula bar when something has gone wrong, not for
   * scanning.
   */
  Master_Program_Dashboard: [
    'Next_Date', 'Location', 'Program', 'Leader', 'Type_Tag',
    'Club', 'No_Registration', 'Personalized_Assistance',
    'Schedule', 'Sessions', 'Room', 'Seats', 'Notify', 'Links', 'Status', 'Last_Date',
    'Form_ID', 'Group_Key'
  ],
  // Order_Ahead_Flag is computed once, at import time, and never recomputed
  // afterward — a registration's notice period is a fact about when it
  // happened, not something that should drift if Config changes later.
  // Event_Date leads the row, the same as every other date-bearing tab (it
  // is what these tabs are sorted and split by, and it carries the month
  // tint), with Location and Event right behind it so staff never have to
  // scroll to see which program a registrant belongs to. Party_ID (the Form
  // response ID) sits at the very end — it's an internal grouping key, not
  // something staff read first; Party_Size (the headcount on that
  // submission) stays up front near the person since it IS worth reading at
  // a glance.
  // Attended and Lunch_Served are the two DAY-OF columns: they're what staff
  // tick on the day, and they sit immediately after Name so marking a row is
  // one glance and one click, with no horizontal scrolling.
  //
  // MEALS_ORDERED is HOW MANY MEALS THIS PERSON IS DOWN FOR, and it is the
  // planned counterpart of the consumed counts behind it. One row used to mean
  // exactly one meal — buildDashboardRollup() counted PEOPLE and the kitchen
  // ordered one per head — which cannot express the standing orders the desk
  // actually takes: Joan orders four meals every lunch day, all of them hers,
  // and the Ginsburgs collect three between two people. The only way to say
  // that was to invent guests ("Extra Meal 1", "Extra Meal 2"), which puts
  // people who do not exist on the roster, the sign-in sheet and the party
  // count.
  //
  // BLANK MEANS ONE — the rule the workbook has always followed silently, so
  // turning this column on moves no number in any existing workbook. A number
  // typed here is how many meals that registrant is ordering, and it is what
  // Master_Lunch_Dashboard's Registered_Count adds up (see
  // readRegistrantMealsOrdered() and countLunchMeals()).
  //
  // It is a count of MEALS, never of people: Party_Size still says how many
  // human beings arrived together, All_Lunch_Registrants still lists one row per
  // person, and four meals for Joan is one name with a 4 beside it.
  //
  // To order NO meal, set Lunch_Status to "No Lunch" — that is the column that
  // says whether this registrant eats at all, and a 0 here would be a second,
  // quieter way to say the same thing (readRegistrantMealsOrdered() therefore
  // floors a lunch-needing row at one).
  //
  // THE FOUR MEAL COUNTS behind them (plus Meals_In_Fridge) are what let ONE
  // PERSON account for SEVERAL DIFFERENT MEALS on the same day, which is what
  // actually happens at the counter: Joe eats the day-1 hot meal in the dining
  // room and carries out two subs on his way home. The previous shape could
  // not say that — it had one Dine_In_Count, one Subs_Count and a single
  // Meals_In_Fridge CHECKBOX that flipped BOTH counts to takeaway together, so
  // every meal on a row had to be the same kind. Splitting dined-in from
  // taken-out per meal type makes the mixed case expressible, and keeps it
  // attached to the person who took them rather than only to the day's total:
  //
  //   Day1_Dined_In    day-1 meals eaten here
  //   Day1_Taken_Out   day-1 meals carried out
  //   Subs_Dined_In    subs eaten here
  //   Subs_Taken_Out   subs carried out
  //   Meals_In_Fridge  meals of theirs left in the fridge to collect later
  //
  // MEAL_SOURCE — WHICH lunch those counts were portions of. The five counts
  // say how many and in what manner; none of them says what the food WAS.
  // That was never a question the workbook could ask, because the answer was
  // assumed: a meal counted on a row dated D at location L is a portion of
  // whatever Lunch_Schedule lists for D x L. The join is a shared date key and
  // nothing else.
  //
  // Leftovers break that assumption, and they break it in both directions at
  // once. Serve Wednesday's chicken on Thursday and Wednesday reads as twelve
  // meals wasted while Thursday reads as takeaway demand on a day nothing was
  // ordered — one real batch, reported as two wrong numbers.
  //
  // So: Meal_Source holds the Meal_ID of the batch this row's meals came out
  // of, and BLANK MEANS "today's" — which is exactly the rule the workbook has
  // always followed silently. Every row in every existing workbook is blank,
  // so turning this column on moves no number anywhere; it only gives staff a
  // way to say the one thing they previously could not.
  //
  // buildDashboardRollup() sends the counts to the named batch's date and
  // location instead of the row's own, so a carried-over meal lands on the
  // batch that actually produced it (and shows up in that row's Carried_Over).
  //
  // One source per row is the deliberate limit: a row that ate today's meal
  // AND carried out yesterday's can only name one of them. Recording several
  // different batches per person per day needs a row per handover, which is a
  // ledger, not a column — see MEAL_IDENTITY_DESIGN.md.
  //
  // buildDashboardRollup() tallies the four straight into
  // Master_Lunch_Dashboard's Day_1_In-Person / Day_1_Takeaway /
  // Subs_In-Person / Subs_Takeaway columns (and Meals_In_Fridge into In_Fridge)
  // the same way Lunch_Served rolls into Served_Confirmed. Everything the form
  // supplied (Lunch_Type, Party_Size, Form_Source...) follows behind them, and
  // the internal keys trail at the end.
  //
  // Phone and Email come off the form itself (Email is the respondent address
  // Forms collects). Email is what inviteRegistrantsToCalendarEvents() adds as
  // a calendar guest; Phone is what the printed sign-in sheet needs and what
  // staff ring when a program moves.
  // Registrant_Sheet_Link and Sign_In_Sheet_Link are the same derived pair the
  // session table carries, repeated here so the day's roster is one click
  // from the sheet the leader is marking and the PDF the desk printed — see
  // 69_generated_file_links.gs.
  All_Registrants: [
    'Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended', 'Lunch_Served',
    'Meals_Ordered',
    'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
    'Meal_Source',
    'Phone', 'Email',
    'Person_Type', 'Lunch_Type', 'Lunch_Status', 'Program_Status', 'Earlier_Appointment',
    'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes',
    'Primary_Registrant', 'Party_Size', 'Order_Ahead_Flag', 'Admin_Notes', 'Form_Answers',
    'Registrant_Sheet_Link', 'Sign_In_Sheet_Link',
    'Manual_Override', 'Form_Source', 'Event_ID', 'Party_ID'
  ],
  // Registered_Count (what the forms say) and Served_Confirmed (what was
  // actually ticked off on the Registrants tab) sit side by side on purpose —
  // planned versus real is the comparison this tab exists to support.
  //
  // Registered_Count counts MEALS and Served_Confirmed counts PEOPLE, and the
  // difference is deliberate rather than an oversight. What the kitchen orders
  // is meals, and one person can be down for four of them (Meals_Ordered on
  // All_Registrants) — so a day where Joan orders four and nobody else eats
  // reads 4 registered. What a tick on Lunch_Served records is that a PERSON
  // was handed their food; how much of it they took is the four consumption
  // counts beside it, which is the honest place for that number. All_Lunch_Registrants
  // shows both per person, which is where the two are reconciled by eye.
  //
  // The consumption columns are no longer hand-typed here (see
  // LUNCH_DASHBOARD_MANUAL_COLUMNS): they're tallied by buildDashboardRollup()
  // from the five per-person meal counts on All_Registrants, the
  // same way Served_Confirmed is tallied from Lunch_Served.
  // updateMasterLunchDashboard() only overwrites a cell when the tally is
  // greater than zero, so a value typed here before that wiring existed is
  // left alone until the Registrants tab actually reports something for that
  // date+location.
  //
  // The two BUFFER columns now trail at the very end, behind even the
  // consumption/reconciliation block. They are READ-ONLY: every render re-reads
  // them from Config's "Meal Buffer Amounts" section for that row's location
  // and Hot/Cold type (see updateMasterLunchDashboard()), so the number here
  // and the number in Config can no longer disagree — which is what "they all
  // read 0" was a symptom of, since the old code only ever wrote them at
  // row-creation time and wrote 0 whenever the date had no registrations yet.
  // Change a buffer in Config, not here. Total_to_Order's formula still
  // references them by cell (writeMasterLunchDashboardSheet() builds the A1
  // refs from this array), so their position is free to move.
  //
  // In_Fridge sits with the other consumption tallies: it is what the
  // Registrants tab's Meals_In_Fridge counts add up to for that date+location.
  //
  // Carried_Over is how many of the meals on THIS row were eaten on a
  // different day from the one the row is dated — portions of this batch that
  // went out later, attributed here because this is the row with the
  // Actual_Ordered to reconcile them against (see Meal_Source on
  // All_Registrants). It is always a subset of the consumption
  // columns beside it, never an addition to them: it explains part of those
  // numbers rather than adding to the total. A row reading 40 ordered, 14
  // takeaway, 8 carried over means eight of that fourteen left the building
  // on a later day.
  // Sign_In_Sheet_Link trails at the very end, behind even the buffers: it is
  // the printed sheet for that date x location (there is no registrant sheet for a
  // meal), derived on every render from the registry in
  // 69_generated_file_links.gs. Its position is free to move for the same
  // reason the buffers' is — the formulas build their A1 refs from this array.
  Master_Lunch_Dashboard: [
    'Event_Date', 'Location', 'Lunch_Type', 'Meal_Shorthand',
    'Registered_Count', 'Served_Confirmed', 'Total_to_Order', 'Actual_Ordered',
    'Day_1_In-Person', 'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'In_Fridge',
    'Carried_Over',
    'Total_Consumed', 'Thrown_Away', 'Discrepancy', 'Manual_Override',
    'Standard_Buffer', 'Tester_Buffer',
    'Sign_In_Sheet_Link'
  ],
  /**
   * All_Lunch_Registrants - WHO is eating, one row per PERSON per date+location.
   *
   * Master_Lunch_Dashboard answers "how many lunches do we order"; it is a
   * count and nothing but a count. This tab answers the other half of the same
   * question - "which people are those" - which is what the desk needs to hand
   * the meals out against, and what gets typed into CoPilot afterwards.
   * All_Registrants has the names but it is every registration for every
   * program, so finding the day's eaters in it means reading past the eleven
   * people who signed up for Chair Yoga and never asked for food.
   *
   * DERIVED AND REBUILT ON EVERY SYNC, never hand-edited: every row here comes
   * from buildDashboardRollup(), the same pass that produces the number on the
   * dashboard, so the names and the count can never disagree. To add somebody
   * at the desk, use Quick Mark - which writes a real registrant row, which
   * shows up here on the next render.
   *
   * Requests_Merged is the column that makes the count auditable: 2 means this
   * person asked for lunch on three different program forms for this one day
   * and is being ordered ONE meal. That de-duplication used to be done by hand
   * every morning; the column is what shows it happened.
   *
   * Meals is the other half of that audit, and the reason the dashboard's
   * Registered_Count can be larger than the number of rows here: it is how
   * many meals this ONE PERSON is down for (Meals_Ordered on All_Registrants).
   * Joan is one row reading 4, not four rows — which is what the desk needs to
   * see when it hands the meals over, and what stops "Extra Meal 1" and "Extra
   * Meal 2" being typed into the guest boxes as though they were people.
   */
  All_Lunch_Registrants: [
    'Event_Date', 'Location', 'Name', 'Lunch_Type', 'Meals', 'Lunch_Served',
    'Registered', 'Requests_Merged', 'Programs', 'Phone', 'Source'
  ],
  // Now one row per Event_Date PER LOCATION. Type includes "Not Serving"
  // (see CATERED_LUNCH_TYPES vs LUNCH_TYPE_OPTIONS below).
  // Meal_ID names the BATCH — the food itself, as distinct from the day it is
  // handed over. Everything else on this tab describes a date; this is the one
  // column that describes a thing that can outlive its date, which is what
  // makes "we served yesterday's chicken today" recordable at all (see
  // Meal_Source on All_Registrants).
  //
  // DERIVED, never typed: deriveMealId() computes it from the row's own date,
  // location and type, and renderLunchScheduleSheet() re-stamps every row on
  // every render. That is deliberate — this tab is cleared and rebuilt
  // constantly, and an ID that had to be preserved across those rebuilds would
  // be one more thing to lose. It also means an existing workbook needs no
  // migration: the first render fills the whole column in.
  //
  // Last on the row because nobody reads it — it is a join key that happens to
  // be visible, and the menu is what staff come to this tab for.
  Lunch_Schedule: ['Event_Date', 'Location', 'Type', 'Meal_Description', 'Meal_Shorthand', 'Meal_ID'],
  // A superset of All_Registrants' own array (same columns, same
  // order) plus 4 triage-only columns — moveRegistrantsToTriage() copies by
  // HEADER NAME, so keeping this a true prefix-plus-extra of the Registrants
  // array is what keeps every registrant column (Location/Event included)
  // landing in triage rows automatically, with no per-column wiring.
  Deleted_Event_Triage: [
    'Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended', 'Lunch_Served',
    'Meals_Ordered',
    'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
    'Meal_Source',
    'Phone', 'Email',
    'Person_Type', 'Lunch_Type', 'Lunch_Status', 'Program_Status', 'Earlier_Appointment',
    'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes',
    'Primary_Registrant', 'Party_Size', 'Order_Ahead_Flag', 'Admin_Notes', 'Form_Answers',
    'Manual_Override', 'Form_Source', 'Event_ID', 'Party_ID',
    'Deleted_Event_Title', 'Deleted_Event_Location', 'Flagged_Date', 'Triage_Notes'
  ],
  /**
   * Member_Roll — one row per unique PERSON ever seen on a form, with columns
   * the system maintains and columns only staff write. The point is that a
   * name typed into a registration form once becomes a known member with
   * standing notes attached, instead of a string that has to be re-learned
   * every time.
   *
   * Times_Seen/First_Seen/Last_Seen/Locations are RECOMPUTED from the
   * registrant history on every refresh; Usual_Guests, Dietary_Notes,
   * Contact and Staff_Notes are never touched once written — see
   * MEMBER_ROLL_STAFF_COLUMNS.
   *
   * There used to be a Usual_Lunch column here — the meal this person had
   * ordered most often. It was removed: a member's dietary needs are what
   * staff actually act on, and those live in Dietary_Notes, while the meal
   * for a given session is on the row that session made. A "usually gets the
   * hot lunch" cell was read as a standing instruction it never was. The
   * column simply disappears on the next refresh: writeMemoryTab() rewrites
   * the tab whole, and readSimpleTable() projects by header NAME, so a roll
   * still carrying the old column loses it without losing a staff note.
   */
  //
  // Phone/Email are RECOMPUTED (the most recent non-blank one this person gave
  // on a form), which is why they sit on the left with the other derived
  // columns. Contact stays a staff column: it is where a note like "reach her
  // daughter Ann first" belongs, and that is not something a form can supply.
  //
  // Display_Name / Nickname / Household_ID / Household / Household_Override —
  // see 77_households_and_names.gs, which owns all four.
  //
  // Name stays the JOIN KEY and is the string every other tab carries: it is
  // what normalizeNameKey() is taken of, what a form response arrives under,
  // and what All_Registrants, Club_Members and Regular_Needs match on. So a
  // spelling correction is not a matter of retyping it — Display_Name is
  // where staff write the right one, and applyMemberNameCorrection() is what
  // carries it out to every tab and remembers it for the responses still to
  // come. Nickname is what parseMemberName() lifted out of a parenthetical or
  // a quoted middle ("Bob (Robert)", 'Robert "Bob" Smith'), so the door and
  // Quick Mark can find a person under the name they are actually called.
  //
  // Household_ID and Household are RECOMPUTED from shared contact details
  // every refresh; Household_Override is the staff's answer when that guess
  // is wrong — see householdOverrideIntent().
  //
  // FIRST_NAME / LAST_NAME are the same person's name as a PERSON rather than
  // as a string: a roll that sorts by surname, addresses by first name, and
  // hands to a mail merge. They are SPLIT from Display_Name or Name
  // (splitPersonName, section 79) wherever they are blank, and are the staff's
  // once written — but they are never composed BACK onto Name, because
  // renaming somebody is Display_Name's job and doing it here as well would
  // rename them on this tab alone. See backfillMemberNameParts().
  //
  // STATUS / RETIRED_DATE retire somebody without losing them: the row keeps
  // every note it has ever carried and simply stops being offered — sorted
  // below the retired divider on this tab, absent from the door's search box
  // and Quick Mark's directory. A member roll is a history, so nothing on it
  // is ever deleted to mean "they stopped coming".
  //
  // MERGED_FROM is the dedupe's receipt: every other spelling this row has
  // absorbed, kept so that a merge can be read back and argued with rather
  // than being a silent disappearance.
  Member_Roll: [
    'Name', 'Display_Name', 'First_Name', 'Last_Name', 'Nickname', 'Phone', 'Email',
    'Times_Seen', 'First_Seen', 'Last_Seen', 'Locations',
    'Household_ID', 'Household', 'Usual_Guests', 'Dietary_Notes', 'Contact',
    'Household_Override', 'Staff_Notes', 'Status', 'Retired_Date', 'Merged_From'
  ],
  /**
   * Club_Members — the standing roster of every club (see CLUB_TAG). One row
   * per person per club.
   *
   * Active is the whole point of the tab, and the only column staff normally
   * touch: tick it and applyClubRosterCatchup() books that person into every
   * session of the club from now on; untick it and they stop being booked,
   * with their already-created UPCOMING rows offered up for cancellation on
   * the spot (see handleClubMembersEdit()). "Sign up once, forever" needs an
   * undo, and this is it.
   *
   * Club_Key is the machine key (computeClubKey()) — hidden, and the thing
   * that keeps a Regular club's roster attached across a new form every month.
   */
  Club_Members: [
    'Club', 'Location', 'Name', 'Person_Type', 'Primary_Registrant',
    'Phone', 'Email', 'Lunch', 'Joined_On', 'Active', 'Source', 'Staff_Notes', 'Club_Key'
  ],
  /**
   * Regular_Needs — one row per standing fact about a person, plus when it
   * applies. See section 6e for what the columns mean and why the recurrence
   * is spread across four of them rather than crammed into one.
   *
   * Name leads, because that is what somebody scans this tab for. Everything
   * from Frequency rightwards is the WHEN, and every one of those columns is
   * allowed to be blank — a bare "Jane Smith / No milk" is a complete row.
   */
  Regular_Needs: [
    'Name', 'Need', 'Kind', 'Quantity', 'Location', 'Program',
    'Frequency', 'Weekdays', 'Interval', 'Dates', 'Starts', 'Ends',
    'Active', 'Auto_Note', 'Last_Applied', 'Added_By', 'Added_On', 'Staff_Notes', 'Need_ID'
  ],
  /**
   * Program_Settings — ONE ROW PER PROGRAM (Clean_Title x Location), and
   * everything standing that is true of it.
   *
   * The usual memory-tab split: the left columns are recomputed every refresh
   * so a row can be found and read in context, and everything from
   * Typical_Attendance rightwards is the staff's own (see
   * PROGRAM_SETTINGS_STAFF_COLUMNS). The right half is now two half-tabs'
   * worth of answers, in the order somebody actually asks them — how the
   * program RUNS first, then what it SENDS.
   *
   * WHY THE TWO TABS BECAME ONE. Program_Options and Registrant_Notifications
   * had the same grain, the same key, the same recomputed left half, and were
   * written from the same session rows in the same pass of refreshMemoryTabs().
   * Everything that made them two tabs was the order they were built in. What
   * it cost was real: a program had to be found twice, a rename had to move
   * two rows (22 and 9h each carried their own copy of that code), and a
   * program present on one tab and missing from the other was a state nothing
   * reported.
   *
   * HOW THE PROGRAM RUNS:
   *   Typical_Attendance  what usually turns up.
   *   Usual_Capacity      the cap to suggest, seeded from a consistent calendar.
   *   Room_Or_Setup       the room, the chairs, the projector.
   *
   * WHAT IT SENDS THE PEOPLE ON IT — the channels are NOT exclusive, which is
   * the whole reason these are tick boxes and not one dropdown:
   *
   *   Add_To_Calendar    put each registrant on the real calendar event's
   *                      guest list, so Google's own reminders and any change
   *                      to the event reach them without this workbook doing
   *                      anything further.
   *   Week_Before        an email 7 days before the session.
   *   Day_Before         an email 1 day before.
   *   Morning_Of         an email on the day itself.
   *   Other_Reminders    any other day counts, comma-separated ("14, 3"). Adds
   *                      to the three boxes; it does not replace them.
   *   Confirm_On_Booking a confirmation the moment somebody registers. This is
   *                      where an appointment's own time is stated — a
   *                      calendar event has ONE description shared by every
   *                      guest, so "your appointment is at 2:15" can only be
   *                      said in an email.
   *
   * A NEW ROW IS BORN TICKED THE WAY ITS KIND IS NORMALLY NOTIFIED
   * (defaultNotificationPolicy), never blank. Unticked has to mean OFF for a
   * tick box to be honest, so "nobody has decided yet" cannot also be blank —
   * the refresh decides on the program's behalf when it first writes the row,
   * and from then on the boxes say exactly what happens.
   *
   * ONE Staff_Notes, at the end, where it has always been. The two tabs each
   * had one; the merge joins them rather than picking a winner.
   *
   * Instructor_Email USED TO LIVE HERE (on Program_Options) and no longer
   * does. It answered "who leads this program" and nothing else, which is the
   * wrong half of the question the moment you want to write to a person rather
   * than to a program: one address column on a program row cannot say that
   * Jane leads three of these, cannot carry whether Jane wants to be emailed,
   * and gives a leader who moves sites three cells to find. Program_Leaders
   * holds it now, one row per leader-and-program, and
   * migrateProgramLeaderAddresses() carries the old column's values across
   * before this layout drops it.
   *
   * Notify_Mode and Reminder_Days USED TO LIVE HERE TOO, and went the same
   * way for the same reason: one dropdown and one day list could not say that
   * a program invites its people AND writes a week out AND writes again the
   * morning of. The six columns above are the answer now, and
   * readLegacyNotifyModeRows() carries the two old cells across before this
   * layout drops them.
   */
  Program_Settings: [
    'Event', 'Location', 'Type_Tag', 'Sessions_Tracked', 'Next_Date', 'Last_Date',
    'Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup',
    'Add_To_Calendar', 'Week_Before', 'Day_Before', 'Morning_Of',
    'Other_Reminders', 'Confirm_On_Booking', 'Staff_Notes'
  ],
  /**
   * Program_Leaders — WHO LEADS WHAT, and how they hear about it.
   *
   * One row per leader-and-program-at-a-location, which is the normalized
   * shape and the only one that answers the question in both directions: a
   * leader's programs are their rows, and a program's leaders are the rows
   * naming it. A leader with three classes has three rows, sorted together
   * because the tab sorts by name.
   *
   * NO WILDCARDS, deliberately. A blank Program meaning "everything at this
   * site" would be a convenient row to type and a quiet way to hand somebody
   * every roster in a building. The privacy boundary for a shared sheet is
   * one program at one location (see section 9b) and this tab is held to
   * exactly the same grain, so the two can never disagree about who may read
   * what.
   *
   * Notify_Roster_Changes is still the on/off switch — blank or unticked
   * means this leader hears nothing from section 9d, whatever Notify_Timing
   * says. Notify_Timing is the NEW question, asked only once that switch is
   * on: "At each registration" (the default, and everything this tab did
   * before the column existed) rides the diff pass in 66, mid-hour, whenever
   * something on the roster actually moves. "N days before each date" instead
   * gets one countdown digest per session, listing who is on it as of that
   * morning — see 66's DAY-BEFORE ROSTER DIGESTS section. A leader with
   * several classes can pick differently per row.
   *
   * Title_Match is how a program finds its leader instead of the other way
   * round: comma-separated phrases ("yoga, chair yoga") meaning "a program
   * whose title contains this is mine". A new calendar event nobody has typed
   * a row for is PROPOSED to the matching leader — a real, concrete
   * title|location row written onto this tab with the notification tick clear
   * and a note saying which phrase found it. It is a suggestion, never an
   * authority: a phrase shares nothing and sends nothing, because
   * buildProgramLeaderIndex() still reads concrete rows only, and a phrase
   * never overrides a row somebody typed. See 65's TITLE MATCHING section.
   *
   * Staff own everything except Sheet_Link and Last_Notified, which are the
   * tab reporting back: whether that program's shared sheet exists yet, and
   * when this leader was last actually told something (either channel).
   */
  Program_Leaders: [
    'Leader_Name', 'Email', 'Program', 'Location', 'Title_Match',
    'Notify_Roster_Changes', 'Notify_Timing', 'Sheet_Link', 'Last_Notified', 'Staff_Notes'
  ],
  /**
   * Program_Questions — THE TAB THAT MAKES A FORM ASK SOMETHING EXTRA.
   *
   * Every registration form is built from one template, which is what keeps
   * the parser honest: it knows every question by title. The cost of that was
   * that a program needing to ask something of its own — a zip code, whether
   * you are a member, which document you need drawn up — had nowhere to put
   * it. Typing the question straight onto the live form worked until the next
   * template migration rebuilt that form from scratch and silently deleted it,
   * along with a month of answers.
   *
   * So extra questions live HERE, as rows, and are re-applied to the form on
   * every sync and after every rebuild. They are additive by construction:
   *
   *   - a question may never take a title the template already uses
   *     (RESERVED_QUESTION_TITLES) — that is the one way an added question
   *     could change what an existing answer means, so it is refused with a
   *     note rather than applied;
   *   - the answers are recorded in ONE column, Form_Answers, as
   *     "Question: answer" pairs. Adding a question therefore never changes
   *     the shape of All_Registrants, so nothing downstream — counts, lunch
   *     rollups, instructor sheets — has to learn about it;
   *   - a question is added to BOTH branch pages of the form, so it is asked
   *     whichever way somebody signs up, and read back by title exactly like
   *     every template question (getResponseValueByTitle() already handles a
   *     title appearing on several pages);
   *   - deleting the row, or unticking Active, takes the question off the form
   *     on the next sync. Answers already collected stay on the rows they were
   *     collected onto.
   *
   *   Program     the program's name as the calendar spells it. Blank or "*"
   *               means every form in the workbook.
   *   Location    blank means every location; otherwise only forms covering it.
   *   Match_Keywords
   *               the OTHER way to aim a row, and the one that survives a
   *               program being renamed: a word (or several, one per line or
   *               separated by "|" or ",") matched as text against the
   *               program titles the form covers, its locations, and its
   *               calendar type tags. "wills" reaches "Low-Cost Wills" and
   *               "Wills & Estates Clinic" without either being typed out;
   *               "zoom" reaches every online session. Any one keyword
   *               matching is enough. Blank means "do not narrow by keyword",
   *               so a row that names neither a program nor a keyword still
   *               reaches every form as it always did.
   *   Question    the question text, and its identity. Renaming it is adding a
   *               new question and retiring the old one.
   *   Type        Short answer / Paragraph / Dropdown / Checkboxes /
   *               Multiple choice / Date / Time / Scale, or one of the four
   *               that ask nothing — Notice, Image, Header image, Form
   *               description.
   *   Choices     one per line (or separated by "|"), for the three choice
   *               types; the picture's Drive link for an Image; the range and
   *               end labels for a Scale ("1-5 | Not at all | Very much").
   *               Ignored by the text types.
   *   Sort        the order they appear in. Ties fall back to the row order.
   */
  Program_Questions: [
    'Program', 'Location', 'Match_Keywords', 'Question', 'Type', 'Choices', 'Help_Text',
    'Required', 'Sort', 'Active'
  ],
  /**
   * Assistance_Requests — people who want a personalized-assistance
   * appointment that no calendar date can currently offer them.
   *
   * A Medicare counselor comes in when there is demand; the demand exists
   * months before the date does. Before this tab the only way to record that
   * was to invent a calendar event to register them against, which puts a
   * fictional appointment in front of a real person. A request is not a
   * booking, so it is kept somewhere that is not the booking table, and
   * Status is what staff move it through by hand.
   */
  Assistance_Requests: [
    'Received', 'Program', 'Location', 'Name', 'Phone', 'Email', 'Answers',
    'Status', 'Scheduled_For', 'Staff_Notes', 'Request_ID'
  ],
  /**
   * Metrics — ONE ROW PER MONTH, AND WHY IT IS STORED RATHER THAN COMPUTED.
   *
   * Every other number in this workbook is derived on demand from the rows
   * that are still on the tabs. That is right for "how full is next week" and
   * wrong for a year-over-year comparison, because the rows a year-old month
   * was counted from are exactly the rows that get archived (see
   * collapseOldPastMonths) or deleted. A comparison whose baseline quietly
   * empties out is worse than no comparison: it reports a collapse that only
   * happened to the storage.
   *
   * So a month is COUNTED once and then WRITTEN DOWN, and the year-over-year
   * block on this tab reads these rows rather than the registrant tab. A month
   * still present in the data can be recounted at any time (the menu item does
   * exactly that, and the monthly trigger recounts the month just ended); a
   * month whose rows are gone keeps the numbers it was captured with.
   *
   * Month is the key — 'YYYY-MM', sortable as text — and Month_Label is the
   * same month spelled for a human. Captured_On says when the row was last
   * counted, which is what tells a reader whether a thin-looking month is a
   * quiet month or one captured mid-way through.
   *
   * Notes is the one staff-owned column: it is carried across every recount,
   * so "closed for renovations" typed against March 2026 survives the row
   * being recounted.
   *
   * The two rate columns hold FRACTIONS (0.63) formatted as percentages, the
   * same as every other percentage cell in this workbook. Anything reading
   * them back for a comparison wants percentage POINTS — see
   * metricsRateToPoints().
   */
  Metrics: [
    'Month', 'Month_Label',
    'Sessions', 'Programs', 'Locations', 'Club_Sessions', 'Assistance_Sessions',
    'Drop_In_Sessions', 'Lunch_Sessions',
    'Registrations', 'Avg_Per_Session', 'Participants', 'New_People', 'Guests',
    'Waitlisted', 'Cancellations',
    'Attended', 'Attendance_Rate', 'Seats_Filled_Rate', 'Empty_Seats',
    'Meals_Ordered', 'Meals_Served', 'Meals_Consumed', 'Lunch_Only_Signups',
    'Captured_On', 'Notes'
  ]
}));

/** Assistance_Requests columns the importer must never overwrite — the staff's own follow-up. */
const ASSISTANCE_REQUEST_STAFF_COLUMNS = ['Status', 'Scheduled_For', 'Staff_Notes'];

/** Program_Questions columns staff type into — which is all of them. */
const PROGRAM_QUESTIONS_STAFF_COLUMNS = [
  'Program', 'Location', 'Match_Keywords', 'Question', 'Type', 'Choices', 'Help_Text',
  'Required', 'Sort', 'Active'
];

/** The one column on Metrics a person types into. Carried across every recount. */
const METRICS_STAFF_COLUMNS = ['Notes'];

/** What a request's Status can say. New until somebody looks at it. */
const ASSISTANCE_REQUEST_STATUSES = ['New', 'Contacted', 'Scheduled', 'Closed'];

/**
 * Member_Roll columns the refresh must never overwrite — the staff's own
 * knowledge.
 *
 * First_Name/Last_Name are on this list because a person's name is the one
 * thing on the roll that a form cannot be trusted about: "BOB SMITH JR" typed
 * into a phone at 8am is not a reason to undo the office's reading of who that
 * is. The split is derived ONCE, from whatever spelling the row already had,
 * and after that it is the staff's (see backfillMemberNameParts).
 *
 * Status/Retired_Date are here for the same reason in the other direction:
 * nothing this workbook syncs knows that somebody has stopped coming, and a
 * refresh that could clear a retirement would un-retire the whole roll on its
 * next run.
 */
const MEMBER_ROLL_STAFF_COLUMNS = ['Display_Name', 'First_Name', 'Last_Name', 'Usual_Guests',
  'Dietary_Notes', 'Contact', 'Household_Override', 'Staff_Notes', 'Status', 'Retired_Date'];
/**
 * Program_Settings columns the refresh must never overwrite — the two
 * half-tabs' worth of staff answers this tab was merged out of, in one list.
 *
 * Every one of them, because the right half of this tab exists to be filled
 * in: the three standing facts about how the program runs, and the six that
 * say what it sends the people on it.
 */
const PROGRAM_SETTINGS_STAFF_COLUMNS = ['Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup',
  'Add_To_Calendar', 'Week_Before', 'Day_Before', 'Morning_Of',
  'Other_Reminders', 'Confirm_On_Booking', 'Staff_Notes'];

/**
 * Program_Leaders columns the staff own — which is nearly all of them.
 *
 * The tab is a form somebody fills in, not a table the sync derives: nothing
 * in this workbook knows who leads a class, and nothing ever will. The two
 * columns NOT listed here (Sheet_Link, Last_Notified) are the refresh
 * reporting back, and refreshProgramLeadersTab() is careful to be the only
 * thing that ever writes them.
 */
const PROGRAM_LEADERS_STAFF_COLUMNS = ['Leader_Name', 'Email', 'Program', 'Location',
  'Title_Match', 'Notify_Roster_Changes', 'Notify_Timing', 'Staff_Notes'];

/**
 * Club_Members columns the roster refresh must never overwrite — the staff's
 * own decisions about who is on the list and what they eat. Everything else on
 * the row (contact details, which club, when they joined) is refreshed from
 * the person's most recent registration.
 */
const CLUB_MEMBERS_STAFF_COLUMNS = ['Lunch', 'Active', 'Staff_Notes'];

/** What a Club_Members row's Lunch cell can say. Mirrors the form's own yes/no, not the Hot/Cold a day resolves to. */
const CLUB_LUNCH_OPTIONS = ['Yes - Lunch', 'No Lunch'];

/** Day-of columns on Registrants that staff tick by hand. TRUE/FALSE checkboxes. */
/**
 * THE FIVE COLUMNS THE PROGRAM LEADER OWNS, in the order they appear on both
 * All_Registrants and the shared sheet. This one array drives the checkbox
 * formatting, the yellow wash, the snapshot encoding and the merge — they can
 * never disagree about what is leader-owned, which is the kind of drift that
 * turns a merge into data loss.
 *
 * Waitlisted is deliberately SEPARATE from Program_Status's own "Waitlisted"
 * value. They answer different questions: Program_Status is what the system
 * decided from Max_Capacity, and this is what the leader decided about a
 * person they have actually spoken to. Ticking one does not move the other —
 * Program_Status rides along on the shared sheet, read-only, so the leader
 * can see both.
 */
const LEADER_OWNED_COLUMNS = ['Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes'];

/** The first four of those are real checkboxes; Leader_Notes is free text. */
const LEADER_FLAG_COLUMNS = ['Contacted', 'Confirmed', 'Waitlisted', 'Dropped'];

const REGISTRANT_DAYOF_COLUMNS = ['Attended', 'Lunch_Served'];

/**
 * Day-of NUMBER columns on Registrants — how many meals of each kind THIS
 * PERSON accounted for. All five are independent: one row can carry a dined-in
 * day-1 meal and two taken-out subs at once, which is the case the old single
 * "was this takeaway?" checkbox could not express (see
 * HEADERS.All_Registrants).
 */
const REGISTRANT_MEAL_COUNT_COLUMNS = [
  'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge'
];

/**
 * Which Master_Lunch_Dashboard tally each per-registrant meal count feeds.
 * One list, so the rollup, the printed sign-in sheet and the dashboard's
 * numeric formatting can never drift apart on what counts as what.
 */
/**
 * Every whole-number meal quantity on a registrant row: what they ORDERED,
 * then what they actually took. One list because they get the same treatment
 * on the sheet — integer validation, no free text, centred — and because a
 * column that is a count of meals should look like one wherever it appears.
 */
const REGISTRANT_MEAL_QUANTITY_COLUMNS = ['Meals_Ordered'].concat(REGISTRANT_MEAL_COUNT_COLUMNS);

const MEAL_COUNT_TO_DASHBOARD_COLUMN = {
  Day1_Dined_In: 'Day_1_In-Person',
  Day1_Taken_Out: 'Day_1_Takeaway',
  Subs_Dined_In: 'Subs_In-Person',
  Subs_Taken_Out: 'Subs_Takeaway',
  Meals_In_Fridge: 'In_Fridge'
};

/**
 * Header names this workbook USED to use, and what they are now. Consulted by
 * buildHeaderProjection() when a canonical column is nowhere on the sheet, so
 * a workbook written by an earlier version keeps its values through the first
 * render on the new layout instead of silently reading blank.
 *
 * Dine_In_Count/Subs_Count meant "in-person unless the Meals_In_Fridge
 * checkbox was ticked", so they map to the DINED-IN halves of the new split —
 * the reading that is right for every row where that box was clear, which is
 * nearly all of them. buildDashboardRollup() handles the ticked ones (see
 * isLegacyFridgeCheckbox()).
 */
const LEGACY_HEADER_ALIASES = {
  Day1_Dined_In: ['Dine_In_Count'],
  Subs_Dined_In: ['Subs_Count'],
  // "Instructor" became "program leader" everywhere the workbook says it, and
  // this is the one rename that would otherwise cost data: the column holds
  // notes typed by a person about a person, which nothing can regenerate. The
  // alias means a workbook rendered by the old version reads its notes into
  // the new column on the first render rather than showing an empty one.
  Leader_Notes: ['Instructor_Notes'],
  // The shared per-program roster stopped being "the leader's sheet" when the
  // desk, the office and the leader all turned out to read it — see 46's
  // banner. This column is DERIVED, rewritten from the registry on every
  // render, so the alias buys nothing but a first render that still shows the
  // link instead of a blank while the old header is on the sheet.
  Registrant_Sheet_Link: ['Leader_Sheet_Link']
};

/** Headers for the small "Today at Each Location" section (A) inside All_Program_Sessions. */
const TODAY_AT_LOCATIONS_HEADERS = ['Location', 'Programs Today', 'Sessions Today', 'Registered Today'];

/** Headers for Master_Lunch_Dashboard's "Today's Lunch Needs" block — its own short list. */
const TODAY_LUNCH_HEADERS = ['Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count', 'Served_Confirmed', 'Total_to_Order'];

/** Zero-based { header: index } map for a plain headers array (not a sheet). */
function getIndexMap(headersArray) {
  const map = {};
  headersArray.forEach((h, i) => { map[h] = i; });
  return map;
}

