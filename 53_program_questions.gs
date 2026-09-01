// ============================================================================
// 6g-ii. PER-PROGRAM QUESTIONS  (the Program_Questions tab -> form items)
// ============================================================================

// ---------------------------------------------------------------------------
// PER-PROGRAM QUESTIONS  (Program_Questions)
// ---------------------------------------------------------------------------

/**
 * Titles a custom question may NEVER take. This is the single guard that makes
 * "add a question" safe: every template question is read back BY TITLE, so a
 * custom question wearing one of these names would be answered by the wrong
 * person's data — silently, and only visibly wrong weeks later.
 *
 * Refused rather than renamed: a question staff wrote and cannot find on the
 * form is a bug they will report; one that was quietly re-titled is a bug they
 * will not.
 */
function reservedQuestionTitles() {
  const titles = Object.keys(TEMPLATE_ITEM_TITLES).map(k => TEMPLATE_ITEM_TITLES[k])
    .concat(Object.keys(TEMPLATE_PAGE_TITLES).map(k => TEMPLATE_PAGE_TITLES[k]))
    .concat([LEGACY_FOOTER_ITEM_TITLE, LEGACY_GUEST_COUNT_TITLE, APPOINTMENT_PAGE_TITLE]);
  for (let g = 1; g <= MAX_GUESTS; g++) titles.push(`Guest ${g} Name`);
  return new Set(titles.filter(Boolean).map(t => String(t).trim().toLowerCase()));
}

/** The question types staff can ask for, and what each one builds. */
const PROGRAM_QUESTION_TYPES = {
  'short answer': 'TEXT',
  'short': 'TEXT',
  'text': 'TEXT',
  'paragraph': 'PARAGRAPH',
  'long answer': 'PARAGRAPH',
  'dropdown': 'LIST',
  'list': 'LIST',
  'checkboxes': 'CHECKBOX',
  'checkbox': 'CHECKBOX',
  'check all that apply': 'CHECKBOX',
  'multiple choice': 'MULTIPLE_CHOICE',
  'radio': 'MULTIPLE_CHOICE',
  // THE TWO THAT ASK NOTHING. Both were requested in the same breath from the
  // office: "Any form for T'ai Chi needs to contain the following disclaimer…",
  // and "Is there a way to add images and small touches to the forms that will
  // stay? In the old forms, we were able to put headers in and/or images of the
  // books/films/people."
  //
  // The answer to "that will stay" is what makes them belong HERE rather than
  // on the form. Anything typed onto a live form by hand is deleted the next
  // time that form is rebuilt from the template — which is exactly the trap
  // Program_Questions was built to get out of. A notice or an image listed on
  // this tab is re-applied after every rebuild, like every other row.
  'notice': 'SECTION_HEADER',
  'note': 'SECTION_HEADER',
  'header': 'SECTION_HEADER',
  'disclaimer': 'SECTION_HEADER',
  'image': 'IMAGE',
  'picture': 'IMAGE',
  'photo': 'IMAGE',
  // 'text' USED TO BE IN HERE TWICE — once at the top meaning a short answer
  // box, and again down here meaning a notice. The second one won, silently,
  // so a row typed as "Text" became a block of words with nothing to type
  // into. It is a short answer, which is what the first entry always said and
  // what anybody writing "text" in a Type column means; the notice types are
  // the four named above it.
  //
  // THE THREE ADDED SHAPES. Date, Time and Scale are questions the office
  // asked for by example rather than by name — "which day would suit you",
  // "what time do you normally arrive", "how did you hear about us, 1 to 5" —
  // and each was being approximated with a short answer box that then had to
  // be read by a human.
  'date': 'DATE',
  'time': 'TIME',
  'scale': 'SCALE',
  'rating': 'SCALE',
  'linear scale': 'SCALE',
  // ASKS NOTHING AND IS NOT AN ITEM AT ALL: this wording is appended to the
  // form's own DESCRIPTION, the block of text above the first question. A
  // notice sits in the middle of the form where somebody scrolling may not
  // reach it; a description is read before anybody starts. "Bring a photo ID"
  // belongs in one, "please note this class involves floor work" in the other.
  'form description': 'DESCRIPTION',
  'description': 'DESCRIPTION',
  'intro': 'DESCRIPTION',
  'preamble': 'DESCRIPTION',
  // THE PICTURE AT THE TOP. Same item as 'image' — a picture with a caption —
  // but placed at the head of the form rather than down beside the last
  // question, which is what "put our logo on it" and "show them the book
  // cover" actually mean. See imageGoesAtTheTop().
  'header image': 'HEADER_IMAGE',
  'header photo': 'HEADER_IMAGE',
  'banner': 'HEADER_IMAGE',
  'logo': 'HEADER_IMAGE',
  'top image': 'HEADER_IMAGE'
};

/** What the Type column offers as a dropdown — the canonical spelling of each shape. */
const PROGRAM_QUESTION_TYPE_OPTIONS = [
  'Short answer', 'Paragraph', 'Dropdown', 'Checkboxes', 'Multiple choice',
  'Date', 'Time', 'Scale', 'Notice', 'Header image', 'Image', 'Form description'
];

/**
 * What Program (or Location) says for "every one of them". Blank means the
 * same thing and always has — this is the spelling the dropdown offers,
 * because a blank cell in a dropdown looks like a cell nobody filled in.
 */
const PROGRAM_QUESTION_ALL_PROGRAMS = '*';

/**
 * Every program title currently on the session table, once each, in
 * alphabetical order — the Program dropdown's list on Program_Questions and
 * on the review dialog.
 *
 * Read from the dashboard rather than the calendar: the calendar takes seconds
 * to read and this is called while drawing a tab, and a program that has no
 * session row is a program no form covers, so offering it would be offering
 * a title that matches nothing.
 */
function listKnownProgramTitles() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];
  try {
    const headers = HEADERS.Master_Program_Dashboard;
    const map = getIndexMap(headers);
    const seen = {};
    readAllSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
      const title = String(row[map['Clean_Title']] || '').trim();
      if (title) seen[title] = true;
    });
    return Object.keys(seen).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    log(`Could not list the program titles for a dropdown (${err}) — offering none.`);
    return [];
  }
}

/** True for the three types that need a Choices cell to mean anything. */
function questionTypeNeedsChoices(kind) {
  return kind === 'LIST' || kind === 'CHECKBOX' || kind === 'MULTIPLE_CHOICE';
}

/**
 * True for the types that DISPLAY something instead of asking it — a notice
 * and an image. They collect no answer, so Required means nothing to them and
 * setRequired() does not exist on either item; see addCustomQuestionItem().
 */
function questionTypeIsDisplayOnly(kind) {
  return kind === 'SECTION_HEADER' || questionTypeIsImage(kind) || kind === 'DESCRIPTION';
}

/** True for both picture kinds — the one in place and the one at the top. Both need a Drive link. */
function questionTypeIsImage(kind) {
  return kind === 'IMAGE' || kind === 'HEADER_IMAGE';
}

/**
 * True for the picture that belongs at the HEAD of the form rather than down
 * beside the last question.
 *
 * Google gives a form one banner image, in its theme, and there is no way to
 * set it from Apps Script or from the Forms API — so "put our photo at the top
 * of the form" is done the one way a script can do it: an image item moved to
 * index 0, above the first question. It is the first thing on the page, which
 * is what was actually being asked for.
 */
function imageGoesAtTheTop(kind) {
  return kind === 'HEADER_IMAGE';
}

/**
 * True for the one kind that is not an ITEM on the form at all — its wording
 * goes into the form's description, above every question. Filtered out of the
 * item passes and handled by syncDescriptionInjectionsOnForm().
 */
function questionTypeIsDescription(kind) {
  return kind === 'DESCRIPTION';
}

/**
 * The scale row's shape, out of the Choices cell: "1-5", "0-10 | Never |
 * Always", or blank for the default.
 *
 * Google's own limits are 0-or-1 at the bottom and at most 10 at the top, and
 * a scale outside them is refused by the Forms API with an error that names
 * neither the row nor the tab it came from — so it is clamped here, where the
 * reason can be said in the row's own terms.
 */
function parseQuestionScale(raw) {
  const parts = parseQuestionChoices(raw);
  const range = /^\s*(\d+)\s*[-–to]+\s*(\d+)\s*$/i.exec(String(parts[0] || ''));
  let lower = 1;
  let upper = 5;
  let labelsFrom = 0;
  if (range) {
    lower = Math.min(1, Math.max(0, Number(range[1])));
    upper = Math.max(lower + 1, Math.min(10, Number(range[2])));
    labelsFrom = 1;
  }
  return {
    lower,
    upper,
    lowerLabel: String(parts[labelsFrom] || '').trim(),
    upperLabel: String(parts[labelsFrom + 1] || '').trim()
  };
}

/**
 * The keywords on one row, lower-cased: one per line, or separated by "|" or
 * ",". Reuses the Choices splitter so a staff member who types a list one way
 * in one column and another way in the next is understood both times.
 */
function parseQuestionKeywords(raw) {
  return parseQuestionChoices(raw).map(k => k.trim().toLowerCase()).filter(Boolean);
}

/**
 * The Drive file ID inside whatever somebody pasted into Choices for an image
 * row — a share link, an open link, or the bare ID.
 *
 * Pasting the link out of the browser is what people actually do, and every
 * one of these shapes is a link Drive itself hands you:
 *   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   https://drive.google.com/open?id=FILE_ID
 *   https://docs.google.com/.../d/FILE_ID/edit
 *   FILE_ID
 */
function parseDriveFileId(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const byPath = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(text);
  if (byPath) return byPath[1];
  const byQuery = /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(text);
  if (byQuery) return byQuery[1];
  // A bare ID: no slashes, no spaces, and long enough to be one.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return '';
}

/**
 * Splits a Choices cell into options. Newlines first, then "|", then commas —
 * in that order and never combined, because "New Power of Attn, Update Power
 * of Attn" is one option per LINE and two options per COMMA, and only the
 * person who typed it knows which they meant. Whichever separator they
 * actually used is the one that produces more than one option.
 */
function parseQuestionChoices(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const trySplit = sep => text.split(sep).map(v => v.trim()).filter(Boolean);
  const byLine = trySplit(/\r?\n/);
  if (byLine.length > 1) return byLine;
  const byPipe = trySplit('|');
  if (byPipe.length > 1) return byPipe;
  const byComma = trySplit(',');
  if (byComma.length > 1) return byComma;
  return [text];
}

/**
 * The question specs for THIS EXECUTION, read once.
 *
 * applyProgramFormExtensions() runs per form, and a sync touches every form —
 * so without this the tab would be read from the spreadsheet once per program,
 * every sync, to answer a question whose answer cannot change mid-run. Per the
 * caching contract in the file header: one cache, one invalidator, and it dies
 * with the execution so there is no staleness to reason about.
 */
let __programQuestionSpecsCache = null;

function getProgramQuestionSpecs() {
  if (!__programQuestionSpecsCache) {
    __programQuestionSpecsCache = buildProgramQuestionSpecs(readProgramQuestionRows(null));
  }
  return __programQuestionSpecsCache;
}

/** Dropped by whatever rewrites the tab — see renderProgramQuestionsSheet(). */
function invalidateProgramQuestionSpecs() {
  __programQuestionSpecsCache = null;
}

/** Reads the Program_Questions tab (banner + header + rows, like the other memory tabs). */
function readProgramQuestionRows(sheet) {
  const target = sheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_QUESTIONS);
  if (!target) return [];
  try {
    return readSimpleTable(target, HEADERS.Program_Questions);
  } catch (err) {
    log(`Could not read "${SHEET_NAMES.PROGRAM_QUESTIONS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/**
 * Every usable question on the tab, as
 * { program, location, title, kind, choices, help, required, sort }.
 *
 * A row that cannot be used is DROPPED WITH A REASON — an unrecognized type, a
 * reserved title, a choice question with no choices. Silently skipping it
 * would leave staff staring at a form that refuses to grow the question they
 * typed, with nothing anywhere saying why.
 */
function buildProgramQuestionSpecs(rows) {
  const map = getIndexMap(HEADERS.Program_Questions);
  const reserved = reservedQuestionTitles();
  const specs = [];
  const seen = new Set();

  (rows || []).forEach((row, i) => {
    const outcome = readProgramQuestionRow(row, map, reserved, i);
    if (!outcome) return; // blank or unticked — not a row, and not a mistake either
    if (outcome.error) {
      log(`${SHEET_NAMES.PROGRAM_QUESTIONS}: skipping "${outcome.title}" — ${outcome.error}.`);
      noteForAdmin('Program questions not added',
        `"${outcome.title}" on "${SHEET_NAMES.PROGRAM_QUESTIONS}" was skipped — ${outcome.error}.`);
      return;
    }
    if (seen.has(outcome.spec.key)) {
      log(`${SHEET_NAMES.PROGRAM_QUESTIONS}: skipping "${outcome.title}" — it is already listed for this program.`);
      noteForAdmin('Program questions not added',
        `"${outcome.title}" on "${SHEET_NAMES.PROGRAM_QUESTIONS}" was skipped — it is already listed for ` +
        `this program.`);
      return;
    }
    seen.add(outcome.spec.key);
    specs.push(outcome.spec);
  });

  specs.sort((a, b) => a.sort - b.sort);
  return specs;
}

/**
 * ONE ROW, READ AND CHECKED: { spec } when it is usable, { error } when it is
 * not, and null when it is not a row at all (no wording, or Active unticked).
 *
 * Split out of buildProgramQuestionSpecs() so the question builder dialog can
 * put a row through the SAME rules before it is written to the tab. Two copies
 * of "is this title reserved" is how a dialog comes to accept a question the
 * sync then silently refuses — the person who typed it watching a form that
 * never grows it, and the only explanation in an admin email they may not
 * read.
 */
function readProgramQuestionRow(row, map, reserved, index) {
  const title = String(row[map['Question']] || '').trim();
  if (!title) return null;
  const active = row[map['Active']];
  // Blank means ACTIVE. A row somebody typed is a question they want asked;
  // making them also tick a box to mean it is a trap, and the tab is
  // rendered with the box ticked anyway.
  if (active === false || /^(no|false|off)$/i.test(String(active || '').trim())) return null;

  const fail = error => ({ title, error });

  if ((reserved || reservedQuestionTitles()).has(title.toLowerCase())) {
    return fail('that is one of the registration form\'s own question titles, and re-using it would ' +
      'make the answers to both unreadable. Give it a different wording');
  }
  const rawType = String(row[map['Type']] || '').trim().toLowerCase();
  const kind = rawType ? (PROGRAM_QUESTION_TYPES[rawType] || null) : 'TEXT';
  if (!kind) {
    return fail(`"${row[map['Type']]}" is not a question type. Use one of: ` +
      PROGRAM_QUESTION_TYPE_OPTIONS.join(', '));
  }
  const choices = parseQuestionChoices(row[map['Choices']]);
  if (questionTypeNeedsChoices(kind) && choices.length === 0) {
    return fail('a dropdown, checkbox or multiple-choice question needs its options in the Choices column');
  }
  // An image row carries a Drive link in Choices instead of options. Checked
  // HERE rather than when the form is built, because this is where a rejected
  // row can still say why on a tab somebody is looking at — a link that
  // failed at form-build time would show up as a form quietly missing its
  // picture.
  let imageFileId = '';
  if (questionTypeIsImage(kind)) {
    imageFileId = parseDriveFileId(row[map['Choices']]);
    if (!imageFileId) {
      return fail('an image row needs the picture\'s Google Drive link in the Choices column. Either use ' +
        '"➕ Build a Form Question…", which uploads the picture for you, or upload it to Drive yourself, ' +
        'use Share ▸ Copy link, and paste that here');
    }
  }
  // NOTE ON THE QUESTION COLUMN FOR THE DISPLAY-ONLY TYPES. Every row needs
  // one (the blank-title check at the top), because the title is this
  // question's identity: it is how a duplicate is spotted, how the form is
  // searched for an existing copy, and how a row that gets deleted from the
  // tab is found and taken off the form again. So a notice's heading and an
  // image's caption are not optional — which is no hardship, since a notice
  // wants a heading and an untitled picture on a form is a puzzle.
  //
  // For a notice, the long wording goes in Help_Text and the Question column
  // is the bold line above it ("Please note", "About this class"). A form
  // description row is the same arrangement: the row's name here, the words
  // people read in Help_Text.

  const program = String(row[map['Program']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  const keywords = parseQuestionKeywords(row[map['Match_Keywords']]);
  const required = row[map['Required']] === true ||
    /^(yes|true|required)$/i.test(String(row[map['Required']] || '').trim());
  const sortRaw = Number(row[map['Sort']]);
  const at = index || 0;

  return {
    title,
    spec: {
      program, location, keywords, title, kind, choices, imageFileId,
      scale: kind === 'SCALE' ? parseQuestionScale(row[map['Choices']]) : null,
      help: String(row[map['Help_Text']] || '').trim(),
      // A notice, an image and a description collect nothing, so Required
      // cannot apply to them however the cell is filled in — see
      // questionTypeIsDisplayOnly().
      required: required && !questionTypeIsDisplayOnly(kind),
      // Identity is title + program + location + keywords: the same question
      // asked of two programs is two rows, and the same question twice for one
      // program is a duplicate that would appear on the form twice. The
      // keywords are part of it because "Bring your ID" aimed at wills and the
      // same wording aimed at Medicare are two rules, not a duplicate.
      key: `${program.toLowerCase()}|${location.toLowerCase()}|${keywords.join(',')}|${title.toLowerCase()}`,
      // Row order breaks ties, so a tab with no Sort column filled in still
      // asks the questions in the order they were typed.
      sort: isNaN(sortRaw) || String(row[map['Sort']] || '').trim() === '' ? at : sortRaw * 1000 + at
    }
  };
}

/**
 * The questions that belong on ONE form: those whose Program matches a program
 * the form covers (or is blank/"*" for every form), and whose Location matches
 * one the form covers (or is blank for all of them).
 */
function questionsForFormContext(specs, context) {
  const norm = v => String(v || '').trim().toLowerCase();
  const titles = new Set((context.titles || []).map(norm));
  const locations = new Set((context.locations || []).map(norm));
  // WHAT A KEYWORD IS MATCHED AGAINST: everything about this form that names
  // what it is for — the programs on it, the sites it runs at, and the
  // bracket tags its calendar events carry ([Club], [Personalized
  // Assistance], [Zoom]...). One blob, searched as text, because a keyword
  // rule is a staff member saying "anything to do with wills" and they should
  // not have to know which of the three columns the word lives in.
  const haystack = (context.titles || [])
    .concat(context.locations || [])
    .concat(context.typeTags || [])
    .map(norm).filter(Boolean).join(' \n ');
  // "*" MEANS EVERY ONE, IN BOTH COLUMNS. Program has always read it that
  // way; Location had not, so a row saying Location "*" — which is what the
  // dropdown on that column now offers, and what somebody copying the
  // Program cell would write — matched no location at all and the question
  // was asked on nothing. Blank still means the same thing, as it always did.
  const isEvery = value => !value || value === '*';
  return (specs || []).filter(spec => {
    const p = norm(spec.program);
    if (!isEvery(p) && !titles.has(p)) return false;
    const l = norm(spec.location);
    if (!isEvery(l) && !locations.has(l)) return false;
    // ANY keyword matching is enough, and all three columns narrow TOGETHER.
    // A row naming Location "Narberth" and keyword "wills" is asking for the
    // wills clinic at Narberth, not for either — which is the reading that
    // lets one row do what previously took a row per program title.
    const keywords = spec.keywords || [];
    if (keywords.length > 0 && !keywords.some(k => haystack.indexOf(k) !== -1)) return false;
    return true;
  });
}

/**
 * The wording every matching "Form description" row contributes to ONE form,
 * in Sort order, or '' when none match.
 *
 * The Question column is the row's name (it has to be — that is how a row is
 * spotted as a duplicate and how a deleted one is found again); the wording
 * itself is Help_Text. A row with only a name says that name, which is the
 * generous reading of somebody who typed their sentence into the first column
 * they came to.
 */
function buildDescriptionInjectionText(specs) {
  const blocks = (specs || [])
    .filter(spec => questionTypeIsDescription(spec.kind))
    .map(spec => String(spec.help || spec.title || '').trim())
    .filter(Boolean);
  return blocks.length === 0 ? '' : `\n\n${blocks.join('\n\n')}`;
}

/**
 * A freshly built description with the matching injections on the end.
 *
 * PURE, and used by the path that rebuilds the description from scratch
 * (applyFormDescription()). The other path — a sync where the dates have not
 * moved and only the injection has — cannot rebuild the base text and so has
 * to strip its own last block off the live description instead; see
 * syncDescriptionInjectionsOnForm().
 */
function applyDescriptionInjectionsToText(description, context, specs) {
  let matching;
  try {
    matching = questionsForFormContext(specs || getProgramQuestionSpecs(), context);
  } catch (err) {
    log(`Could not read the description rows for form ${context.formId || ''} (${err}) — ` +
      `the form keeps its plain description.`);
    return description;
  }
  const injection = buildDescriptionInjectionText(matching);
  if (!injection) return description;
  return `${description}${injection}`;
}

