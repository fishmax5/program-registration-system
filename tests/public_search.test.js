// THE ?q= SEARCH ON THE PUBLIC PAGES (86, 87, 91, 93).
//
//   1. ?q= is trimmed, whitespace-folded and capped at 100 characters, and is
//      read for both public pages through publicCalendarViewOptions().
//   2. A hostile term never reaches the page as markup: the page carries it
//      only inside the double-encoded embed JSON, with every `<` escaped.
//   3. Words are ANDed, case-insensitively, over whatever haystack the page
//      builds (matchesSearch).
//   4. The bar and the empty state say what was asked for with textContent,
//      count results, and "Clear search" targets the top window at the one
//      editable constant — or clears in place if the visitor has typed since.
//   5. With no ?q= the pages are drawn exactly as before (no query in the
//      options, an empty bar).
const vm = require('vm');
const assert = require('assert');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '', getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' } },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => (key === 'CHECK_IN_WEB_APP_URL' ? 'https://script.google.com/macros/s/ABC/exec' : null),
    setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSpreadsheetTimeZone: () => 'America/New_York', getSheetByName: name => ({ getName: () => name }) }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, LockService: {},
  HtmlService: { XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' } },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  CacheService: { getScriptCache: () => { throw new Error('no cache here'); } }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const run = code => vm.runInContext(code, sandbox);
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (err) { failures++; console.log('FAIL ' + name + '\n     ' + err.message); }
}

// ---- 1. reading the term ---------------------------------------------------
check('q is trimmed and whitespace-folded', () => {
  assert.strictEqual(run(`publicCalendarViewOptions({ q: '  tai   chi \\n' }).query`), 'tai chi');
});
check('q is capped at 100 characters', () => {
  assert.strictEqual(run(`publicCalendarViewOptions({ q: 'a'.repeat(300) }).query.length`), 100);
});
check('no q reads as an empty query, and the other options are untouched', () => {
  assert.strictEqual(run(`publicCalendarViewOptions({ embed: '1', span: 'week' }).query`), '');
  assert.strictEqual(run(`publicCalendarViewOptions({ embed: '1', span: 'week' }).span`), 'week');
  assert.strictEqual(run(`publicCalendarViewOptions({ embed: '1' }).embed`), true);
});

// ---- 2. nothing raw in the page -------------------------------------------
const HOSTILE = '</script><img src=x onerror=alert(1)><!--';
check('a hostile q appears in neither page as markup', () => {
  const opts = run(`publicCalendarViewOptions({ embed: '1', q: ${JSON.stringify(HOSTILE)} })`);
  sandbox.__opts = opts;
  const pages = [
    run(`buildPublicCalendarHtml({ ok: true, sessions: [], locations: [] }, __opts)`),
    run(`buildPublicRegularHtml({ ok: true, programs: [], locations: [] }, __opts)`)
  ];
  pages.forEach(html => {
    assert.ok(html.indexOf('<img src=x') === -1, 'raw tag present');
    assert.ok(html.indexOf('onerror=alert(1)><') === -1);
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1, 'extra </script>');
    assert.ok(html.indexOf('<!--') === -1, 'comment opener present');
    assert.ok(html.indexOf('\\u003c') !== -1, 'term should be present, escaped');
  });
});
check('the Clear search address is the one editable constant', () => {
  const html = run(`buildPublicCalendarHtml({ ok: true, sessions: [], locations: [] },
    publicCalendarViewOptions({ q: 'x' }))`);
  assert.ok(html.indexOf(run('PUBLIC_CALENDAR_SEARCH_HOME_URL')) !== -1);
});

// ---- 3 & 4. the shared script, against a stub DOM ---------------------------
function node(tag) {
  return { tag, className: '', textContent: '', children: [], style: {}, listeners: {}, value: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; },
    text() { return (this.textContent || '') + this.children.map(c => c.text ? c.text() : c.data).join(''); } };
}
function harness(query, typed) {
  const bar = node('div'), box = node('input');
  const doc = { getElementById: id => (id === 'qbar' ? bar : box),
    createTextNode: data => ({ data }) };
  const ctx = { document: doc, DATA: { ok: true }, drawn: 0,
    EMBED: { query, clearUrl: 'https://site.example/programming' },
    view: { q: typed === undefined ? query : typed },
    el: (tag, cls, text) => { const n = node(tag); n.className = cls; n.textContent = text || ''; return n; },
    draw() { ctx.drawn++; } };
  vm.createContext(ctx);
  vm.runInContext(sandbox.publicSearchScript(), ctx);
  return { ctx, bar, box, run: code => vm.runInContext(code, ctx) };
}

check('words are ANDed, case-insensitively, in any order', () => {
  const h = harness('Tai  CHI narberth');
  assert.strictEqual(h.run(`searchWords().join('|')`), 'tai|chi|narberth');
  assert.ok(h.run(`matchesSearch('tai chi class narberth tuesdays', searchWords())`));
  assert.ok(!h.run(`matchesSearch('tai chi class ashbridge', searchWords())`));
  assert.ok(h.run(`matchesSearch('anything', (view.q = '', searchWords()))`));
});
check('the bar reads Showing programs matching "q" · N results · Clear search', () => {
  const h = harness('tai chi');
  h.run('drawSearchBar(3)');
  assert.strictEqual(h.bar.style.display, 'block');
  assert.strictEqual(h.bar.text(), 'Showing programs matching "tai chi" · 3 results · Clear search');
  h.run('drawSearchBar(1)');
  assert.ok(h.bar.text().indexOf('1 result ·') !== -1);
});
check('the bar is hidden with no query', () => {
  const h = harness('');
  h.run('drawSearchBar(5)');
  assert.strictEqual(h.bar.style.display, 'none');
  assert.strictEqual(h.bar.text(), '');
});
check('a hostile term goes through textContent only', () => {
  const h = harness(HOSTILE);
  h.run('drawSearchBar(0)');
  assert.ok(h.bar.text().indexOf(HOSTILE) !== -1);
  assert.ok(h.bar.children.every(c => c.tag !== 'img'));
});
check('the empty state names the term and offers Clear search', () => {
  const h = harness('zzz');
  const box = h.run('noMatchBox()');
  assert.strictEqual(box.children[0].textContent, 'No programs match "zzz".');
  assert.strictEqual(box.children[1].textContent, 'Clear search');
});
check('Clear search targets the top window; typing since clears in place', () => {
  const h = harness('tai chi');
  const link = h.run('clearSearchLink()');
  assert.strictEqual(link.href, 'https://site.example/programming');
  assert.strictEqual(link.target, '_top');
  let prevented = false;
  link.listeners.click({ preventDefault() { prevented = true; } });
  assert.ok(!prevented, 'untouched term should navigate');
  const h2 = harness('tai chi', 'yoga');
  const link2 = h2.run('clearSearchLink()');
  link2.listeners.click({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.strictEqual(h2.ctx.view.q, '');
  assert.strictEqual(h2.ctx.drawn, 1);
});

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('All public search checks passed');
