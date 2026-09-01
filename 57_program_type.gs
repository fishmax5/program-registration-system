// ============================================================================
// 13. WHAT KIND OF PROGRAM IS THIS?  (one answer instead of four)
// ============================================================================
//
// FOUR CONTROLS FOR ONE DECISION. A program's registration is currently set
// by a Type_Tag dropdown and three checkboxes — Club, No_Registration,
// Personalized_Assistance — sitting side by side on the dashboard, each with
// its own tag, its own calendar stamp and its own meaning. They are genuinely
// orthogonal in the code, and that is why they were built that way. They are
// NOT orthogonal in anybody's head:
//
//   • ticking Personalized_Assistance makes Type_Tag irrelevant — an
//     appointment form has no grouping to speak of;
//   • ticking No_Registration makes all three of the others irrelevant, since
//     there is no form for them to describe;
//   • Club with No_Registration is a contradiction that the sheet will happily
//     let somebody enter;
//   • and the commonest question — "what sort of thing is this?" — has no
//     single place to be answered or read.
//
// So there is now ONE vocabulary of six named kinds, and every one of them is
// exactly a set of values for the four controls. Nothing underneath changes:
// the tags are the same tags, the calendar stamps are the same stamps, the
// dashboard columns still hold what they always held, and a workbook edited by
// hand goes on working. What changes is that a person picks "Appointments —
// book a time" from one list, and the four controls are set to agree.
//
// The round trip is exact in both directions: any combination of the four
// resolves to one of the six (resolveProgramFormType), and each of the six
// resolves back to the four (PROGRAM_FORM_TYPES[].settings). That is the
// property the review dialog depends on — it must be able to show what a
// program currently IS, not merely set what it should be.
//
// [All Locations] is deliberately NOT one of the six. It answers WHERE, not
// what kind, and it composes cleanly with all six — see SHARED_LOCATION_SCOPE.
// ============================================================================

/**
 * The six kinds, in the order somebody would read them: the ordinary one
 * first, then the ones that are more of the same, then the two that are a
 * different thing altogether.
 *
 * `settings` is the complete state of all four controls, so applying a kind
 * never has to reason about what to leave alone.
 */
const PROGRAM_FORM_TYPES = [
  {
    key: 'MONTHLY',
    label: 'Monthly sign-up',
    blurb: 'The ordinary case. A fresh form each calendar month, so the dates and the menu stay current.',
    settings: { typeTag: EVENT_TYPES.REGULAR, isClub: false, noRegistration: false, isAssistance: false }
  },
  {
    key: 'SERIES',
    label: 'One form for the whole series',
    blurb: 'A course that runs to an end. Every date shares one form, however many months it spans.',
    settings: { typeTag: EVENT_TYPES.GROUPED, isClub: false, noRegistration: false, isAssistance: false }
  },
  {
    key: 'CLUB',
    label: 'Club — join once, monthly form',
    blurb: 'People sign up once and stay signed up. A new form each month, and the roster carries across it.',
    settings: { typeTag: EVENT_TYPES.REGULAR, isClub: true, noRegistration: false, isAssistance: false }
  },
  {
    key: 'CLUB_SERIES',
    label: 'Club — join once, one form for the series',
    blurb: 'The same standing membership, on a single form for the whole run rather than one a month.',
    settings: { typeTag: EVENT_TYPES.GROUPED, isClub: true, noRegistration: false, isAssistance: false }
  },
  {
    key: 'APPOINTMENTS',
    label: 'Appointments — book a time, not a day',
    blurb: 'One visitor at a time: computer help, wills, Medicare counselling. Each event is cut into ' +
      'back-to-back slots and the form asks which one.',
    settings: { typeTag: EVENT_TYPES.REGULAR, isClub: false, noRegistration: false, isAssistance: true }
  },
  {
    key: 'DROP_IN',
    label: 'Drop-in — no registration at all',
    blurb: 'A coffee hour, a rolling art room, a lobby concert. It shows on the dashboard and gets no ' +
      'form and no "register here" link.',
    settings: { typeTag: EVENT_TYPES.REGULAR, isClub: false, noRegistration: false, isAssistance: false,
      noRegistrationOverride: true }
  }
];

// DROP_IN's settings are spelled out above with the override flag rather than
// noRegistration: true, purely so the object reads as "everything else off, and
// registration off" — normalizeProgramFormTypeSettings() folds the two.
PROGRAM_FORM_TYPES.forEach(type => {
  if (type.settings.noRegistrationOverride) {
    type.settings.noRegistration = true;
    delete type.settings.noRegistrationOverride;
  }
});

/** The kind with this key, or null. */
function getProgramFormType(key) {
  return PROGRAM_FORM_TYPES.filter(t => t.key === String(key || '').trim().toUpperCase())[0] || null;
}

/**
 * Which of the six a program currently IS, from the four things that decide
 * it. Takes whatever shape the caller has: a group off the calendar
 * ({ isClub, noRegistration, isAssistance, typeTag/isFixed }) or a row's worth
 * of dashboard values.
 *
 * PRECEDENCE IS THE SAME PRECEDENCE THE REST OF THE FILE USES, so this can
 * never disagree with what the forms actually do:
 *   [No Registration] wins over everything — there is no form for the rest to
 *   describe. Then [Personalized Assistance], which decides the form's shape.
 *   Only then does Club, and only then grouping.
 *
 * Always returns one of the six; there is no "other".
 */
function resolveProgramFormType(state) {
  const s = state || {};
  if (s.noRegistration) return getProgramFormType('DROP_IN');
  if (s.isAssistance) return getProgramFormType('APPOINTMENTS');
  const grouped = s.typeTag !== undefined ? isGroupedTypeTag(s.typeTag) : !!s.isFixed;
  if (s.isClub) return getProgramFormType(grouped ? 'CLUB_SERIES' : 'CLUB');
  return getProgramFormType(grouped ? 'SERIES' : 'MONTHLY');
}

/**
 * The four controls a kind implies, as a fresh object the caller may keep.
 * Returns null for a key that names no kind, so a caller can tell "not a kind"
 * apart from "the default kind".
 */
function programFormTypeSettings(key) {
  const type = getProgramFormType(key);
  if (!type) return null;
  return {
    typeTag: type.settings.typeTag,
    isClub: type.settings.isClub,
    noRegistration: type.settings.noRegistration,
    isAssistance: type.settings.isAssistance
  };
}


