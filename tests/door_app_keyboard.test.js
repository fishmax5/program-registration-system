// THE DOOR APP NEVER HIDES A BUTTON UNDER A KEYBOARD OR A DROPDOWN (16g).
//
// The door tablet is used by seniors, standing up, on a touchscreen. A button
// that is under the on-screen keyboard, or under the browser's own "suggested
// names" dropdown, is to them a button that does not exist. This pins:
//
//   1. Every text box the page makes — the PIN, the name search, the details
//      screen — has the browser's suggestions switched off: autocomplete,
//      autocorrect and spellcheck off, a capitalization that fits the field,
//      and a name the browser has never seen (it keys its memory on that).
//   2. The search's results are IN FLOW, directly under the box, never an
//      absolutely positioned overlay, and "Continue as …" is the FIRST thing
//      in them rather than the last of twenty-four cards.
//   3. The details screen's boxes sit directly above "Sign in".
//   4. visualViewport is listened to (resize AND scroll), the fixed strips are
//      re-docked from visualViewport.height + offsetTop, and there is a
//      scrollIntoView fallback for a browser without it.
//   5. The viewport meta asks for interactive-widget=resizes-content.
//   6. The script block still compiles, and still runs.
//
// The page's script is actually RUN here against a small fake DOM, because
// the attributes in (1) are set by script on elements made by script — a
// string search of the template could not tell a box that has them from a box
// that merely sits near the word.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x' },
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

const html = sandbox.buildDoorAppHtml({
  location: '', pinRequired: false, locations: ['Narberth'], todayKey: '2025-09-02'
});
const open = html.indexOf('<script>');
const close = html.indexOf('</script>', open);
const script = html.substring(open + '<script>'.length, close);
const style = html.substring(html.indexOf('<style>'), html.indexOf('</style>'));

// ---------------------------------------------------------------------------
// 6a. It compiles.
// ---------------------------------------------------------------------------
let parseError = '';
try { new vm.Script(script); } catch (err) { parseError = String(err.message || err); }
ok('the door app script block compiles' + (parseError ? ' — ' + parseError : ''), !parseError);

// ---------------------------------------------------------------------------
// The fake DOM: just enough of one for the page to draw its screens.
// ---------------------------------------------------------------------------
class ClassList {
  constructor(node) { this.node = node; }
  get set() { return new Set(String(this.node.className || '').split(/\s+/).filter(Boolean)); }
  write(s) { this.node.className = Array.from(s).join(' '); }
  add(...c) { const s = this.set; c.forEach(x => s.add(x)); this.write(s); }
  remove(...c) { const s = this.set; c.forEach(x => s.delete(x)); this.write(s); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) {
    const s = this.set;
    const want = on === undefined ? !s.has(c) : !!on;
    if (want) s.add(c); else s.delete(c);
    this.write(s);
    return want;
  }
}

let doc = null;
class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.className = '';
    this.classList = new ClassList(this);
    this._text = '';
    this.value = '';
    this.listeners = {};
  }
  set id(v) { this.attrs.id = v; }
  get id() { return this.attrs.id || ''; }
  set type(v) { this.attrs.type = v; }
  get type() { return this.attrs.type || ''; }
  set autocomplete(v) { this.attrs.autocomplete = v; }
  set name(v) { this.attrs.name = v; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    c.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatchEvent() { return true; }
  getBoundingClientRect() { return { top: 0, bottom: 40, height: 40, left: 0, right: 100, width: 100 }; }
  focus() { doc.activeElement = this; }
  blur() { doc.activeElement = doc.body; }
  scrollIntoView() {}
  contains(n) {
    for (let p = n; p; p = p.parentNode) if (p === this) return true;
    return false;
  }
  walk(fn) { fn(this); this.children.forEach(c => c.walk(fn)); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

function all(root) { const out = []; root.walk(n => out.push(n)); return out; }

const body = new Node('body');
['header', 'pinbox', 'app', 'status', 'done', 'okb', 'heading', 'subheading', 'setupbtn', 'pin']
  .forEach(id => {
    const n = new Node(id === 'pin' ? 'input' : 'div');
    n.id = id;
    body.appendChild(n);
  });
doc = {
  body,
  activeElement: body,
  listeners: {},
  createElement: tag => new Node(tag),
  createTextNode: text => { const n = new Node('#text'); n._text = String(text); return n; },
  getElementById: id => all(body).find(n => n.id === id) || null,
  querySelector: sel => (sel === 'header' ? all(body).find(n => n.id === 'header') : null),
  querySelectorAll: () => [],
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
};

const vvListeners = {};
const win = {
  innerHeight: 800,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  visualViewport: {
    height: 800, offsetTop: 0,
    addEventListener(t, fn) { (vvListeners[t] = vvListeners[t] || []).push(fn); }
  },
  scrollBy: () => {}, scrollTo: () => {},
  setTimeout: () => 0, clearTimeout: () => {},
  requestAnimationFrame: fn => { fn(); return 1; },
  addEventListener: () => {}
};
const page = {
  document: doc,
  window: win,
  google: { script: { run: new Proxy({}, { get: (t, k) => (k.startsWith('with') ? () => page.google.script.run : () => {}) }) } },
  Event: function Event(type) { this.type = type; },
  JSON, Math, Object, Array, String, Date, Set, console
};
page.window.document = doc;
vm.createContext(page);
let runError = '';
try { vm.runInContext(script, page, { filename: 'door-app.js' }); } catch (err) { runError = String(err.stack || err); }
ok('the door app script runs against a page' + (runError ? ' — ' + runError : ''), !runError);

function inputsIn(root) { return all(root).filter(n => n.tagName === 'INPUT'); }
function suggestionsOff(input) {
  return input.getAttribute('autocomplete') === 'off' &&
    input.getAttribute('autocorrect') === 'off' &&
    input.getAttribute('spellcheck') === 'false' &&
    !!input.getAttribute('autocapitalize') &&
    /^door-/.test(input.getAttribute('name') || '');
}

if (!runError) {
  // -------------------------------------------------------------------------
  // 4. visualViewport is actually listened to, both ways.
  // -------------------------------------------------------------------------
  ok('visualViewport resize is listened to', (vvListeners.resize || []).length > 0);
  ok('visualViewport scroll is listened to', (vvListeners.scroll || []).length > 0);

  // -------------------------------------------------------------------------
  // 1 + 2. The names screen and the search.
  // -------------------------------------------------------------------------
  vm.runInContext(`
    SETUP = { location: 'Narberth', dateKey: '2025-09-02' };
    DAY = { location: 'Narberth', dateKey: '2025-09-02', dateLabel: 'Tue, Sep 2',
            programs: [], people: [], past: [],
            members: [{ name: 'Mary Cohen', key: 'mary cohen', search: 'mary cohen' },
                      { name: 'Mary Cohen-Stein', key: 'mary cohen-stein', search: 'mary cohen-stein' }] };
    SHOW_ALL = true; STEP = 'names'; busy = false;
    draw();
  `, page);
  const search = doc.getElementById('search');
  ok('the names screen has a search box', !!search);
  ok('the search box has every browser suggestion switched off', search && suggestionsOff(search));
  ok('the search box capitalizes words (it is a name)', search && search.getAttribute('autocapitalize') === 'words');

  const results = doc.getElementById('results');
  const app = doc.getElementById('app');
  ok('the results sit directly under the search box, in the same flow',
    results && app.children.indexOf(results) === app.children.indexOf(search) + 1);

  search.value = 'Mary';
  vm.runInContext('drawSearchResults();', page);
  const first = results.children[0];
  ok('"Continue as …" is the first thing under the box, ahead of the names',
    first && first.id === 'astyped' && /Continue as "Mary"/.test(first.textContent));
  ok('the matching names still follow it',
    results.children.filter(n => n.tagName === 'BUTTON' && /card/.test(n.className)).length === 2);

  search.value = 'Zelda';
  vm.runInContext('drawSearchResults();', page);
  ok('with nobody matched, "Continue as …" is the big button and still first',
    results.children[0].id === 'astyped' && /big/.test(results.children[0].className));

  // -------------------------------------------------------------------------
  // 1 + 3. The details screen.
  // -------------------------------------------------------------------------
  vm.runInContext(`startWalkIn('Zelda Fitz'); STEP = 'walkin'; draw();`, page);
  const boxes = ['newname', 'newemail', 'newphone'].map(id => doc.getElementById(id));
  ok('the details screen has its three boxes', boxes.every(Boolean));
  ok('every details box has every browser suggestion switched off', boxes.every(b => b && suggestionsOff(b)));
  ok('the name box capitalizes words, the email box does not',
    boxes[0].getAttribute('autocapitalize') === 'words' && boxes[1].getAttribute('autocapitalize') === 'off');
  ok('no two boxes share a name the browser could remember',
    new Set(boxes.map(b => b.getAttribute('name'))).size === 3);
  ok('every text box the page has drawn so far has suggestions off',
    inputsIn(app).filter(n => /^(text|email|tel)$/.test(n.type)).every(suggestionsOff));

  const go = doc.getElementById('go');
  const kids = app.children;
  const phoneWrap = boxes[2].parentNode;
  ok('"Sign in" is the next thing after the last box (not three sections below it)',
    go && kids.indexOf(go) === kids.indexOf(phoneWrap) + 1);
}

// ---------------------------------------------------------------------------
// The static half: the PIN box, the CSS, the viewport handling, the meta.
// ---------------------------------------------------------------------------
const pinTag = (html.match(/<input[^>]*id="pin"[^>]*>/) || [''])[0];
ok('the PIN box has autocomplete, autocorrect and spellcheck off',
  /autocomplete="off"/.test(pinTag) && /autocorrect="off"/.test(pinTag) && /spellcheck="false"/.test(pinTag));
ok('the PIN box has a name the browser has never seen', /name="door-[^"]+"/.test(pinTag));

ok('the results list is never absolutely positioned',
  !/#results\s*\{[^}]*position:\s*(absolute|fixed)/.test(style) &&
  /#results\s*\{[^}]*position:\s*static/.test(style));
ok('nothing in the page is position: absolute', !/position:\s*absolute/.test(style));

ok('the fixed strips are re-docked from visualViewport.height + offsetTop',
  /VV\.offsetTop \+ VV\.height/.test(script) && /okb\.style\.bottom/.test(script) &&
  /status\.style\.bottom/.test(script));
ok('a browser without visualViewport falls back to scrollIntoView on focus',
  /if \(!VV\)[\s\S]{0,120}scrollIntoView/.test(script));

const server = fs.readFileSync(path.join(__dirname, '..', '60_check_in_page_server.gs'), 'utf8');
ok('the viewport meta asks for interactive-widget=resizes-content',
  /addMetaTag\('viewport', '[^']*interactive-widget=resizes-content'\)/.test(server));

if (fail) {
  console.log(`\n${fail} failure(s)`);
  process.exit(1);
}
console.log('\nall door app keyboard checks passed');
