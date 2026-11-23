// WEEKLY EMAIL OPT-OUT (99zzf) — the token, the tab, the page's one call, the
// footer in both emails, and that the weekly pass skips an opted-out address.
const assert = require('assert');
const vm = require('vm');
const crypto = require('crypto');
const src = require('./helpers/source').readSource();

const props = {};
const rows = [['Email', 'Opted_Out_On', 'Source', 'Notes']];
const sheet = {
  getLastRow: () => rows.length,
  getRange: (r, c, nr, nc) => ({
    getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)),
    setValues: v => { v.forEach((x, i) => { rows[r - 1 + i] = x.slice(); }); },
    setFontWeight: () => {}
  }),
  appendRow: r => rows.push(r),
  deleteRow: n => rows.splice(n - 1, 1),
  setFrozenRows: () => {}
};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map(b => (b > 127 ? b - 256 : b)),
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: k => { delete props[k]; }
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, getSpreadsheetTimeZone: () => 'America/New_York' }), getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.ctx = {
  token: weeklyOptOutToken_, valid: weeklyOptOutTokenValid_, set: weeklyOptOutSet,
  page: weeklyOptOutPageContext, footer: weeklyOptOutFooterLines, opted: isWeeklyEmailOptedOut,
  record: recordWeeklyEmailOptOut, html: buildWeeklyOptOutHtml,
  weeklyBody: buildWeeklyEmailBody, addedBody: buildAddedToWeekBody,
  DOOR_ROUTES: DOOR_ROUTES, HEADERS: HEADERS
};
log = function () {};
spoolOfficeNote = function () {};
checkInPageUrl = function (o) { return 'https://x.test/exec?mode=' + o.mode + '&e=' + encodeURIComponent(o.params.e) + '&t=' + o.params.t; };
`, sandbox);
const c = sandbox.ctx;

// Token: stable, case-insensitive on the address, rejects other addresses and junk.
const t = c.token('Ann@Example.com');
assert.ok(t && t === c.token('ann@example.com'));
assert.ok(c.valid('ann@example.com', t));
assert.ok(!c.valid('bob@example.com', t), 'a token is for one address');
assert.ok(!c.valid('ann@example.com', ''), 'no token');
assert.ok(!c.valid('ann@example.com', t.slice(0, -1) + (t.slice(-1) === 'a' ? 'b' : 'a')), 'tampered');

// Page context: opening the page changes nothing; an invalid link carries no address.
assert.strictEqual(c.page({ e: 'ann@example.com', t }).valid, true);
assert.strictEqual(c.opted('ann@example.com'), false, 'opening the link opts nobody out');
const bad = c.page({ e: 'ann@example.com', t: 'nope' });
assert.strictEqual(bad.valid, false);
assert.strictEqual(bad.email, '');

// The call: invalid token refused and nothing written; valid one opts out, idempotently, and back in.
assert.strictEqual(c.set('ann@example.com', 'nope', true).ok, false);
assert.strictEqual(rows.length, 1);
let r = c.set('ann@example.com', t, true);
assert.ok(r.ok && r.optedOut);
assert.ok(c.set('ANN@example.com', t, true).ok);
assert.strictEqual(rows.length, 2, 'one row per address however many times');
assert.strictEqual(rows[1][0], 'ann@example.com');
assert.strictEqual(rows[1][2], 'link');
assert.strictEqual(c.opted('Ann@Example.com'), true);
r = c.set('ann@example.com', t, false);
assert.ok(r.ok && !r.optedOut);
assert.strictEqual(rows.length, 1);
assert.strictEqual(c.opted('ann@example.com'), false);

// A row staff typed by hand counts, in any case and with spaces.
rows.push(['  Bob@Example.COM ', '', 'staff', '']);
vm.runInContext('__weeklyOptOutSetCache = null;', sandbox);
assert.strictEqual(c.opted('bob@example.com'), true);

// Footer: link when there is one, and always the reply line.
const footer = c.footer('ann@example.com').join('\n');
assert.ok(footer.includes('https://x.test/exec?mode=unsubscribe'));
assert.ok(/reply to this message/i.test(footer));
const names = ['Ann'];
const item = { key: 'k', dateKey: '2026-11-24', date: new Date(2026, 10, 24), title: 'Chair Yoga', time: '9:00 AM', waitlisted: false, location: 'Narberth' };
assert.ok(c.weeklyBody(names, '2026-11-23', [item], '2026-11-20', 'ann@example.com').includes('mode=unsubscribe'));
assert.ok(c.addedBody(names, '2026-11-23', [item], 'ann@example.com').includes('mode=unsubscribe'));

// The route exists, is before the catch-all, and claims only its own modes.
const route = c.DOOR_ROUTES.filter(x => x.id === 'unsubscribe')[0];
assert.ok(route && route.match({ mode: 'unsubscribe' }) && !route.match({ mode: 'session' }));
assert.ok(c.DOOR_ROUTES.indexOf(route) < c.DOOR_ROUTES.length - 1);

// The page: a program-free page with the address escaped into script.
const html = c.html({ valid: true, email: 'a</script>@x.com', token: 'z' });
assert.ok(!html.includes('a</script>@x.com'));
new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);

console.log('weekly_email_opt_out: ok');
