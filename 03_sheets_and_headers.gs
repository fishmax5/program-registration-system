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
  PROGRAM_DASHBOARD: 'Master_Program_Dashboard',
  REGISTRANT_DASH: 'Registrant_Dash',
  LUNCH_DASHBOARD: 'Master_Lunch_Dashboard',
  LUNCH_ROSTER: 'Lunch_Roster',
  LUNCH_SCHEDULE: 'Lunch_Schedule',
  TRIAGE: 'Deleted_Event_Triage',
  MEMBER_ROLL: 'Member_Roll',
  PROGRAM_OPTIONS: 'Program_Options',
  // Who leads what, where to write to them, and whether they want to hear
  // about it when their roster moves — see section 9c. Separate from
  // Program_Options because a leader is a PERSON who may lead three programs
  // at two sites, and an address column on a program row could only ever
  // answer that question in one direction.
  PROGRAM_LEADERS: 'Program_Leaders',
  CLUB_MEMBERS: 'Club_Members',
  // The two tabs behind [Personalized Assistance] and the per-program extra
  // questions — see ASSISTANCE_TAG and section 6g.
  PROGRAM_QUESTIONS: 'Program_Questions',
  ASSISTANCE_REQUESTS: 'Assistance_Requests',
  // The standing facts about a person that a sign-in desk would otherwise
  // have to already know — see section 6e.
  REGULAR_NEEDS: 'Regular_Needs'
};

const LEGACY_ACTIVE_PROGRAMS_SHEET_NAME = 'Active_Programs';

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
const LEGACY_SHEET_RENAMES = {
  'Registrant_Dash': 'Lunch_and_Event_Registrants'
};

/**
 * Column layouts. Every date-bearing sheet now leads with Event_Date (its
 * cell background carries the month tint that used to live in a separate
 * Month column). Master_Program_Dashboard's session table no longer has a
 * Manual_Override column at all; the other date-bearing tabs keep it as
 * the second column.
 */
defineLazyGlobal_('HEADERS', () => ({
  // The per-session table inside Master_Program_Dashboard (section C).
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
  // Leader_Sheet_Link and Sign_In_Sheet_Link sit with the other two links
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
  Master_Program_Dashboard: [
    'Event_Date', 'Location', 'Clean_Title', 'Event_Time', 'Type_Tag', 'Club', 'No_Registration',
    'Personalized_Assistance',
    'Active_Count', 'Status', 'Waitlist_Only', 'Form_Response_Link', 'Edit_Form_Link',
    'Leader_Sheet_Link', 'Sign_In_Sheet_Link',
    'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats',
    'Form_ID', 'Calendar_Synced?', 'Event_ID', 'Calendar_Source', 'Event_End', 'Slot_Minutes',
    'Max_Per_Month'
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
  // human beings arrived together, Lunch_Roster still lists one row per
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
  // Leader_Sheet_Link and Sign_In_Sheet_Link are the same derived pair the
  // session table carries, repeated here so the day's roster is one click
  // from the sheet the leader is marking and the PDF the desk printed — see
  // 69_generated_file_links.gs.
  Registrant_Dash: [
    'Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended', 'Lunch_Served',
    'Meals_Ordered',
    'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
    'Meal_Source',
    'Phone', 'Email',
    'Person_Type', 'Lunch_Type', 'Lunch_Status', 'Program_Status', 'Earlier_Appointment',
    'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes',
    'Primary_Registrant', 'Party_Size', 'Order_Ahead_Flag', 'Admin_Notes', 'Form_Answers',
    'Leader_Sheet_Link', 'Sign_In_Sheet_Link',
    'Manual_Override', 'Form_Source', 'Event_ID', 'Party_ID'
  ],
  // Registered_Count (what the forms say) and Served_Confirmed (what was
  // actually ticked off on the Registrants tab) sit side by side on purpose —
  // planned versus real is the comparison this tab exists to support.
  //
  // Registered_Count counts MEALS and Served_Confirmed counts PEOPLE, and the
  // difference is deliberate rather than an oversight. What the kitchen orders
  // is meals, and one person can be down for four of them (Meals_Ordered on
  // Registrant_Dash) — so a day where Joan orders four and nobody else eats
  // reads 4 registered. What a tick on Lunch_Served records is that a PERSON
  // was handed their food; how much of it they took is the four consumption
  // counts beside it, which is the honest place for that number. Lunch_Roster
  // shows both per person, which is where the two are reconciled by eye.
  //
  // The consumption columns are no longer hand-typed here (see
  // LUNCH_DASHBOARD_MANUAL_COLUMNS): they're tallied by buildDashboardRollup()
  // from the five per-person meal counts on Registrant_Dash, the
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
  // Registrant_Dash). It is always a subset of the consumption
  // columns beside it, never an addition to them: it explains part of those
  // numbers rather than adding to the total. A row reading 40 ordered, 14
  // takeaway, 8 carried over means eight of that fourteen left the building
  // on a later day.
  // Sign_In_Sheet_Link trails at the very end, behind even the buffers: it is
  // the printed sheet for that date x location (there is no leader sheet for a
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
   * Lunch_Roster - WHO is eating, one row per PERSON per date+location.
   *
   * Master_Lunch_Dashboard answers "how many lunches do we order"; it is a
   * count and nothing but a count. This tab answers the other half of the same
   * question - "which people are those" - which is what the desk needs to hand
   * the meals out against, and what gets typed into CoPilot afterwards.
   * Registrant_Dash has the names but it is every registration for every
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
   * many meals this ONE PERSON is down for (Meals_Ordered on Registrant_Dash).
   * Joan is one row reading 4, not four rows — which is what the desk needs to
   * see when it hands the meals over, and what stops "Extra Meal 1" and "Extra
   * Meal 2" being typed into the guest boxes as though they were people.
   */
  Lunch_Roster: [
    'Event_Date', 'Location', 'Name', 'Lunch_Type', 'Meals', 'Lunch_Served',
    'Registered', 'Requests_Merged', 'Programs', 'Phone', 'Source'
  ],
  // Now one row per Event_Date PER LOCATION. Type includes "Not Serving"
  // (see CATERED_LUNCH_TYPES vs LUNCH_TYPE_OPTIONS below).
  // Meal_ID names the BATCH — the food itself, as distinct from the day it is
  // handed over. Everything else on this tab describes a date; this is the one
  // column that describes a thing that can outlive its date, which is what
  // makes "we served yesterday's chicken today" recordable at all (see
  // Meal_Source on Registrant_Dash).
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
  // A superset of Registrant_Dash' own array (same columns, same
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
   * Times_Seen/First_Seen/Last_Seen/Locations/Usual_Lunch are RECOMPUTED from
   * the registrant history on every refresh; Usual_Guests, Dietary_Notes,
   * Contact and Staff_Notes are never touched once written — see
   * MEMBER_ROLL_STAFF_COLUMNS.
   */
  //
  // Phone/Email are RECOMPUTED (the most recent non-blank one this person gave
  // on a form), which is why they sit on the left with the other derived
  // columns. Contact stays a staff column: it is where a note like "reach her
  // daughter Ann first" belongs, and that is not something a form can supply.
  Member_Roll: [
    'Name', 'Phone', 'Email', 'Times_Seen', 'First_Seen', 'Last_Seen', 'Locations', 'Usual_Lunch',
    'Usual_Guests', 'Dietary_Notes', 'Contact', 'Staff_Notes'
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
   * Program_Options — one row per unique PROGRAM (Clean_Title x Location),
   * same split: the left columns are recomputed, the right columns are the
   * staff's own standing notes about how that program actually runs.
   *
   * Instructor_Email USED TO LIVE HERE and no longer does. It answered "who
   * leads this program" and nothing else, which is the wrong half of the
   * question the moment you want to write to a person rather than to a
   * program: one address column on a program row cannot say that Jane leads
   * three of these, cannot carry whether Jane wants to be emailed, and gives
   * a leader who moves sites three cells to find. Program_Leaders holds it
   * now, one row per leader-and-program, and migrateProgramLeaderAddresses()
   * carries the old column's values across before this layout drops it.
   *
   * Notify_Mode and Reminder_Days are the staff's answer to "how often does
   * this program write to the people signed up for it?" — a dropdown and a
   * list of day counts, both read by section 9e. Left blank, a program is
   * notified the way its KIND normally is, which for everything except
   * Personalized Assistance is exactly what this workbook did before the two
   * columns existed.
   */
  Program_Options: [
    'Event', 'Location', 'Type_Tag', 'Sessions_Tracked', 'Next_Date', 'Last_Date',
    'Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup',
    'Notify_Mode', 'Reminder_Days', 'Staff_Notes'
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
   * Staff own everything except Sheet_Link and Last_Notified, which are the
   * tab reporting back: whether that program's shared sheet exists yet, and
   * when a roster-change alert last went out for it.
   */
  Program_Leaders: [
    'Leader_Name', 'Email', 'Program', 'Location',
    'Notify_Roster_Changes', 'Sheet_Link', 'Last_Notified', 'Staff_Notes'
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
   *     the shape of Registrant_Dash, so nothing downstream — counts, lunch
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
  ]
}));

/** Assistance_Requests columns the importer must never overwrite — the staff's own follow-up. */
const ASSISTANCE_REQUEST_STAFF_COLUMNS = ['Status', 'Scheduled_For', 'Staff_Notes'];

/** Program_Questions columns staff type into — which is all of them. */
const PROGRAM_QUESTIONS_STAFF_COLUMNS = [
  'Program', 'Location', 'Match_Keywords', 'Question', 'Type', 'Choices', 'Help_Text',
  'Required', 'Sort', 'Active'
];

/** What a request's Status can say. New until somebody looks at it. */
const ASSISTANCE_REQUEST_STATUSES = ['New', 'Contacted', 'Scheduled', 'Closed'];

/** Member_Roll columns the refresh must never overwrite — the staff's own knowledge. */
const MEMBER_ROLL_STAFF_COLUMNS = ['Usual_Guests', 'Dietary_Notes', 'Contact', 'Staff_Notes'];
/** Program_Options columns the refresh must never overwrite. */
const PROGRAM_OPTIONS_STAFF_COLUMNS = ['Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup',
  'Notify_Mode', 'Reminder_Days', 'Staff_Notes'];

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
  'Notify_Roster_Changes', 'Staff_Notes'];

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
 * Registrant_Dash and the shared sheet. This one array drives the checkbox
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
 * HEADERS.Registrant_Dash).
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
  Leader_Notes: ['Instructor_Notes']
};

/** Headers for the small "Today at Each Location" section (A) inside Master_Program_Dashboard. */
const TODAY_AT_LOCATIONS_HEADERS = ['Location', 'Programs Today', 'Sessions Today', 'Registered Today'];

/** Headers for Master_Lunch_Dashboard's "Today's Lunch Needs" block — its own short list. */
const TODAY_LUNCH_HEADERS = ['Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count', 'Served_Confirmed', 'Total_to_Order'];

/** Zero-based { header: index } map for a plain headers array (not a sheet). */
function getIndexMap(headersArray) {
  const map = {};
  headersArray.forEach((h, i) => { map[h] = i; });
  return map;
}

