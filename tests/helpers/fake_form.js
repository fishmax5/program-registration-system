// A Google Form as far as page routing is concerned: item order, page breaks,
// and navigation — both kinds. Lifted out of tests/form_page_routing.test.js
// so a second test can drive the same forms; that file still carries its own
// copy and the long explanation of why the navigation reads backwards.
//
// The throw is modelled deliberately: a break that has never been given a page
// target answers getGoToPage() with an exception rather than with null, and
// code that reads it inside the same try/catch as its own write loses the
// write. That is the failure setNavigationAfterPage() exists to prevent.
const PAGE_BREAK = 'PAGE_BREAK';
const SUBMIT = { nav: 'SUBMIT' };
const CONTINUE = { nav: 'CONTINUE' };
const GO_TO_PAGE = { nav: 'GO_TO_PAGE' };

function fakeForm(id) {
  const items = [];
  let nextId = 1;
  const make = type => {
    const it = {
      _id: nextId++, type, title: '', help: '', choices: [], rows: [], columns: [], goTo: null, navType: CONTINUE,
      getId: () => it._id, getType: () => it.type, getTitle: () => it.title,
      getHelpText: () => it.help, getIndex: () => items.indexOf(it),
      setTitle: t => { it.title = t; return it; },
      setHelpText: t => { it.help = t; return it; },
      setRequired: () => it,
      setChoiceValues: v => { it.choices = v.map(x => ({ getValue: () => x, nav: null })); return it; },
      getChoices: () => it.choices,
      setChoices: cs => { it.choices = cs; return it; },
      createChoice: (v, nav) => ({ getValue: () => v, nav: nav || null }),
      setRows: r => { it.rows = r; return it; }, getRows: () => it.rows || [],
      setColumns: c => { it.columns = c; return it; }, getColumns: () => it.columns || [], setBounds: () => it, setLabels: () => it, setImage: () => it,
      asListItem: () => it, asMultipleChoiceItem: () => it, asCheckboxItem: () => it,
      // The two grid kinds are told apart the way Apps Script tells them
      // apart: a CHECKBOX_GRID is not a GRID and asking for the wrong one
      // throws. The meal-count grid is a GRID; the attendance grid is not.
      asGridItem: () => {
        if (it.type !== 'GRID') throw new Error(`Invalid conversion for item type: ${it.type}`);
        return it;
      },
      asCheckboxGridItem: () => {
        if (it.type !== 'CHECKBOX_GRID') throw new Error(`Invalid conversion for item type: ${it.type}`);
        return it;
      },
      asPageBreakItem: () => {
        if (it.type !== PAGE_BREAK) throw new Error(`Invalid conversion for item type: ${it.type}`);
        return it;
      },
      getPageNavigationType: () => it.navType,
      getGoToPage: () => {
        if (it.navType !== GO_TO_PAGE) throw new Error('navigation type is not GO_TO_PAGE');
        return it.goTo;
      },
      setGoToPage: target => {
        if (target === SUBMIT || target === CONTINUE) { it.navType = target; it.goTo = null; }
        else { it.navType = GO_TO_PAGE; it.goTo = target; }
        return it;
      }
    };
    items.push(it);
    return it;
  };
  return {
    getId: () => id,
    setCollectEmail: () => {}, setAllowResponseEdits: () => {},
    setDescription: function (d) { this._desc = d; }, getDescription: function () { return this._desc || ''; },
    getItems: () => items.slice(),
    deleteItem: it => { items.splice(items.indexOf(it), 1); },
    moveItem: (from, to) => { const [it] = items.splice(from, 1); items.splice(to, 0, it); },
    addTextItem: () => make('TEXT'),
    addParagraphTextItem: () => make('PARAGRAPH_TEXT'),
    addListItem: () => make('LIST'),
    addCheckboxItem: () => make('CHECKBOX'),
    addMultipleChoiceItem: () => make('MULTIPLE_CHOICE'),
    addCheckboxGridItem: () => make('CHECKBOX_GRID'),
    addGridItem: () => make('GRID'),
    addPageBreakItem: () => make(PAGE_BREAK),
    addSectionHeaderItem: () => make('SECTION_HEADER'),
    addScaleItem: () => make('SCALE'),
    addDateItem: () => make('DATE'),
    addTimeItem: () => make('TIME'),
    addImageItem: () => make('IMAGE')
  };
}

/** The Apps Script services these forms need, and nothing else. */
function baseSandbox() {
  const properties = {};
  return {
    console: { log: () => {} },
    Utilities: {
      formatDate: d => d.toISOString(),
      base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
      computeDigest: (alg, payload) => Array.from(Buffer.from(String(payload))),
      DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' }, sleep: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in properties ? properties[k] : null),
        setProperty: (k, v) => { properties[k] = v; },
        deleteProperty: k => { delete properties[k]; }
      })
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
    FormApp: {
      ItemType: { PAGE_BREAK, PARAGRAPH_TEXT: 'PARAGRAPH_TEXT', LIST: 'LIST', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
        GRID: 'GRID', CHECKBOX_GRID: 'CHECKBOX_GRID' },
      PageNavigationType: { SUBMIT, CONTINUE, GO_TO_PAGE }
    },
    CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
    Session: { getScriptTimeZone: () => 'America/New_York',
      getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
    ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
    _properties: properties
  };
}

module.exports = { fakeForm, baseSandbox, PAGE_BREAK, SUBMIT, CONTINUE, GO_TO_PAGE };
