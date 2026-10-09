// ============================================================================
// 99zna. THE LEADER ROSTER PAGE, AND ITS STAFF DIALOG  (the HTML half of 99zn)
// ============================================================================
//
// Two template literals. Everything from the workbook crosses into the page's
// script through the double JSON.stringify every other page here uses, with
// `</` broken so a title containing `</script>` cannot end the block, and is
// drawn with textContent — no innerHTML carries data. The page's script holds
// NO backslashes: a template literal eats them (see
// tests/inline_pages_parse.test.js), so newlines are String.fromCharCode(10).
//
// Behavior only; nothing here is read at load time.
// ============================================================================

/** JSON for an inline <script>, safe against a value that contains `</script>`. */
function leaderRosterInlineJson_(value) {
  return JSON.stringify(JSON.stringify(value)).replace(/<\//g, '<\\/');
}

/**
 * The page a leader opens. `view` is leaderRosterView()'s answer (or its
 * refusal); `token` is the ?t= the page was opened with, which it sends back
 * on every call — it is already in the address bar, and it is never logged.
 */
function buildLeaderRosterPageHtml(view, token) {
  const boot = leaderRosterInlineJson_({ view: view || { ok: false, message: LEADER_ROSTER_INVALID_LINK_TEXT },
    token: String(token || '') });
  return `
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         font-size: 16px; color: #202124; margin: 0; background: #F8F9FA; line-height: 1.45; }
  header { background: #1A73E8; color: #fff; padding: 14px 16px; }
  header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  header .sub { font-size: 14px; opacity: .9; }
  main { padding: 12px 16px 60px; max-width: 980px; margin: 0 auto; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 12px; }
  .bar button { padding: 9px 14px; font-size: 15px; border: 1px solid #DADCE0; border-radius: 8px;
    background: #fff; cursor: pointer; }
  .bar .when { color: #5F6368; font-size: 13px; margin-left: auto; }
  .note { background: #FEF7E0; border: 1px solid #FDD663; border-radius: 8px; padding: 10px 12px;
    font-size: 15px; margin: 0 0 12px; }
  .msg { padding: 10px 12px; border-radius: 8px; margin: 0 0 12px; font-weight: 600; }
  .msg.ok { background: #E6F4EA; color: #137333; }
  .msg.bad { background: #FCE8E6; color: #C5221F; }
  h2.band { background: #E8F0FE; color: #174EA6; font-size: 16px; margin: 18px 0 8px; padding: 8px 12px;
    border-radius: 8px; }
  h2.band.past { background: #F1F3F4; color: #5F6368; }
  .person { background: #fff; border: 1px solid #DADCE0; border-radius: 10px; padding: 10px 12px;
    margin-bottom: 8px; }
  .person.wait { background: #FEEFE3; }
  .person.gone { opacity: .6; }
  .top { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; }
  .name { font-weight: 600; font-size: 17px; }
  .meta { color: #5F6368; font-size: 14px; }
  .meta a { color: #1A73E8; }
  .status { font-size: 13px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: #E6F4EA; color: #137333; }
  .status.Waitlisted { background: #FEEFE3; color: #B06000; }
  .status.Cancelled { background: #FCE8E6; color: #C5221F; }
  .ticks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .tick { padding: 7px 12px; border: 1px solid #DADCE0; border-radius: 18px; background: #fff;
    font-size: 14px; cursor: pointer; }
  .tick[aria-pressed=true] { background: #1A73E8; border-color: #1A73E8; color: #fff; }
  .tick[disabled] { cursor: default; opacity: .7; }
  textarea { width: 100%; margin-top: 8px; padding: 8px; font: inherit; font-size: 14px;
    border: 1px solid #DADCE0; border-radius: 8px; min-height: 40px; }
  .answers { white-space: pre-wrap; font-size: 14px; color: #3C4043; margin-top: 6px;
    border-left: 3px solid #DADCE0; padding-left: 8px; }
  .empty { color: #5F6368; font-style: italic; }
  [hidden] { display: none !important; }
  @media print {
    header { background: none; color: #000; padding: 0 0 6px; }
    .bar, .msg, .note, textarea[data-empty=true] { display: none !important; }
    .tick { border: 0; padding: 0 6px 0 0; background: none !important; color: #000 !important; }
    .tick[aria-pressed=false] { display: none; }
    .person { break-inside: avoid; border-color: #999; }
    h2.band { break-after: avoid; }
  }
</style>
<header><h1 id="title">Class roster</h1><div class="sub" id="sub"></div></header>
<main>
  <div class="bar" id="bar">
    <button id="refresh">Refresh</button>
    <button id="print">Print</button>
    <button id="csv">Download CSV</button>
    <span class="when" id="when"></span>
  </div>
  <div id="reason" class="note" hidden></div>
  <div id="msg" hidden></div>
  <div id="list"></div>
  <div id="waitWrap" hidden>
    <h2 class="band">Waiting list</h2>
    <div id="wait"></div>
  </div>
</main>
<script>
  var BOOT = JSON.parse(${boot});
  var TOKEN = BOOT.token;
  var VIEW = BOOT.view;
  var NL = String.fromCharCode(10);
  var TICKS = ['Contacted', 'Confirmed', 'Waitlisted', 'Dropped'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function say(text, ok) {
    var m = document.getElementById('msg');
    if (!text) { m.hidden = true; return; }
    m.hidden = false;
    m.className = 'msg ' + (ok ? 'ok' : 'bad');
    m.textContent = text;
  }
  function server() {
    return google.script.run.withFailureHandler(function () {
      say('Could not reach the workbook — check the connection and try again.', false);
    });
  }

  function draw() {
    var list = document.getElementById('list');
    list.textContent = '';
    document.getElementById('waitWrap').hidden = true;
    var reason = document.getElementById('reason');
    if (!VIEW || !VIEW.ok) {
      document.getElementById('bar').hidden = true;
      reason.hidden = true;
      list.appendChild(el('p', 'note', (VIEW && VIEW.message) || 'This roster could not be opened.'));
      return;
    }
    document.getElementById('title').textContent = VIEW.title || 'Class roster';
    document.title = (VIEW.title || 'Class roster') + ' — roster';
    document.getElementById('sub').textContent = VIEW.location || '';
    document.getElementById('when').textContent = 'Updated ' + (VIEW.refreshed || '');
    reason.hidden = !VIEW.reason;
    reason.textContent = VIEW.reason || '';
    if (!VIEW.sessions.length) list.appendChild(el('p', 'empty', 'Nobody has signed up yet.'));
    VIEW.sessions.forEach(function (s) {
      list.appendChild(el('h2', 'band' + (s.past ? ' past' : ''), s.label));
      s.rows.forEach(function (r) { list.appendChild(drawPerson(r)); });
    });
    if (VIEW.waitlist.length) {
      document.getElementById('waitWrap').hidden = false;
      var w = document.getElementById('wait');
      w.textContent = '';
      VIEW.waitlist.forEach(function (p) {
        var box = el('div', 'person wait');
        var top = el('div', 'top');
        top.appendChild(el('span', 'name', p.name));
        if (p.party && p.party !== '1') top.appendChild(el('span', 'meta', 'party of ' + p.party));
        top.appendChild(el('span', 'meta', p.dates));
        box.appendChild(top);
        box.appendChild(contactLine(p.phone, p.email));
        if (p.notes) box.appendChild(el('div', 'answers', p.notes));
        w.appendChild(box);
      });
    }
  }

  function contactLine(phone, email) {
    var meta = el('div', 'meta');
    if (phone) { var a = el('a', '', phone); a.href = 'tel:' + phone; meta.appendChild(a); }
    if (phone && email) meta.appendChild(document.createTextNode(' · '));
    if (email) { var b = el('a', '', email); b.href = 'mailto:' + email; meta.appendChild(b); }
    return meta;
  }

  function drawPerson(r) {
    var cls = 'person' + (r.status === 'Waitlisted' ? ' wait' : '') +
      (r.status === 'Cancelled' ? ' gone' : '');
    var box = el('div', cls);
    var top = el('div', 'top');
    top.appendChild(el('span', 'name', r.name));
    if (r.party && r.party !== '1') top.appendChild(el('span', 'meta', 'party of ' + r.party));
    top.appendChild(el('span', 'status ' + r.status, r.status));
    if (r.time) top.appendChild(el('span', 'meta', r.time));
    box.appendChild(top);
    box.appendChild(contactLine(r.phone, r.email));
    var ticks = el('div', 'ticks');
    TICKS.forEach(function (col) {
      var b = el('button', 'tick', col);
      b.setAttribute('aria-pressed', r[col] ? 'true' : 'false');
      b.disabled = !VIEW.writable;
      b.onclick = function () { toggle(r, col, b); };
      ticks.appendChild(b);
    });
    box.appendChild(ticks);
    var notes = el('textarea');
    notes.value = r.notes || '';
    notes.placeholder = 'Notes';
    notes.setAttribute('data-empty', r.notes ? 'false' : 'true');
    notes.disabled = !VIEW.writable;
    notes.onchange = function () { save(r, 'Leader_Notes', notes.value); };
    box.appendChild(notes);
    if (r.answers) box.appendChild(el('div', 'answers', r.answers));
    return box;
  }

  function toggle(r, col, button) {
    var value = !r[col];
    if (value && col === 'Dropped' && !confirm('Mark ' + r.name + ' as dropped? This cancels their place on ' +
      r.date + ' and frees the seat. The office can put them back.')) return;
    if (value && col === 'Waitlisted' && !confirm('Move ' + r.name + ' to the waiting list for ' + r.date +
      '? Their seat is freed.')) return;
    r[col] = value;
    button.setAttribute('aria-pressed', value ? 'true' : 'false');
    save(r, col, value);
  }

  function save(r, col, value) {
    say('Saving…', true);
    server().withSuccessHandler(function (res) {
      if (!res || !res.ok) { say((res && res.message) || 'That could not be saved.', false); refresh(); return; }
      say(res.message || 'Saved.', true);
      if (res.view) { VIEW = res.view; draw(); }
    }).leaderRosterMark(TOKEN, r.key, col, value);
  }

  function refresh() {
    server().withSuccessHandler(function (v) { VIEW = v; draw(); }).leaderRosterData(TOKEN);
  }

  function csvCell(value) {
    var s = String(value === undefined || value === null ? '' : value);
    if (s && '=+-@'.indexOf(s.charAt(0)) !== -1) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function downloadCsv() {
    if (!VIEW || !VIEW.ok) return;
    var lines = [['Date', 'Time', 'Name', 'Party_Size', 'Phone', 'Email', 'Program_Status',
      'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes', 'Answers'].map(csvCell).join(',')];
    VIEW.sessions.forEach(function (s) {
      s.rows.forEach(function (r) {
        lines.push([r.date, r.time, r.name, r.party, r.phone, r.email, r.status,
          r.Contacted ? 'Yes' : '', r.Confirmed ? 'Yes' : '', r.Waitlisted ? 'Yes' : '', r.Dropped ? 'Yes' : '',
          r.notes, r.answers].map(csvCell).join(','));
      });
    });
    VIEW.waitlist.forEach(function (p) {
      lines.push(['Waiting list: ' + p.dates, '', p.name, p.party, p.phone, p.email, 'Waiting',
        '', '', '', '', p.notes, ''].map(csvCell).join(','));
    });
    var text = lines.join(NL);
    var name = (VIEW.title || 'roster') + ' — ' + (VIEW.location || '') + '.csv';
    try {
      var blob = new Blob([text], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      window.open('data:text/csv;charset=utf-8,' + encodeURIComponent(text));
    }
  }

  document.getElementById('refresh').onclick = function () { say('', true); refresh(); };
  document.getElementById('print').onclick = function () { window.print(); };
  document.getElementById('csv').onclick = downloadCsv;
  draw();
</script>`;
}

/** The staff dialog: one row per program, its delivery, its link and what can be done to it. */
function buildLeaderRosterPagesDialogHtml(options) {
  const o = options || {};
  const boot = leaderRosterInlineJson_({ staffKey: String(o.staffKey || ''), programs: o.programs || [] });
  return `
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #202124; margin: 0; padding: 8px; }
  p.hint { color: #5F6368; margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px; border-bottom: 1px solid #E8EAED; vertical-align: top; }
  th { background: #F1F3F4; position: sticky; top: 0; }
  input.link { width: 100%; font-size: 12px; }
  button { font-size: 12px; margin: 2px 2px 0 0; }
  .msg { margin: 6px 0; font-weight: bold; }
  .muted { color: #5F6368; }
</style>
<p class="hint">Each program's roster as a web page. <b>Roster_Delivery</b> on Program_Settings decides which is
  the roster: Sheet (today's spreadsheet), Both (page as a read-only preview), Web (the page; its spreadsheet is
  frozen after one last read). A link opens that one program's roster to whoever has it — send it only to the
  leader, and make a new one if it has gone further.</p>
<input id="filter" placeholder="Filter programs" style="width:100%;margin-bottom:6px">
<div class="msg" id="msg"></div>
<table><thead><tr><th>Program</th><th>Delivery</th><th>Link</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<script>
  var BOOT = JSON.parse(${boot});
  var PROGRAMS = BOOT.programs;
  function el(tag, text) { var n = document.createElement(tag); if (text) n.textContent = text; return n; }
  function act(key, action) {
    if (action === 'revoke' && !confirm('Turn this link off? Anyone using it will see "not valid".')) return;
    if (action === 'rotate' && !confirm('Make a new link? The old one stops working at once.')) return;
    document.getElementById('msg').textContent = 'Working…';
    google.script.run.withSuccessHandler(function (res) {
      document.getElementById('msg').textContent = (res && res.message) || '';
      if (res && res.programs) { PROGRAMS = res.programs; draw(); }
    }).withFailureHandler(function (err) {
      document.getElementById('msg').textContent = 'Failed: ' + err;
    }).leaderRosterPagesAction(BOOT.staffKey, key, action);
  }
  function button(label, key, action) {
    var b = el('button', label);
    b.onclick = function () { act(key, action); };
    return b;
  }
  function draw() {
    var want = document.getElementById('filter').value.toLowerCase();
    var body = document.getElementById('rows');
    body.textContent = '';
    PROGRAMS.forEach(function (p) {
      if (want && (p.title + ' ' + p.location).toLowerCase().indexOf(want) === -1) return;
      var tr = el('tr');
      var name = el('td', p.title);
      name.appendChild(el('div', p.location)).className = 'muted';
      tr.appendChild(name);
      var state = p.delivery;
      if (p.delivery === 'Web' && p.hasSheet) state += p.move === 'moved' ? ' (sheet frozen)' : ' (moving)';
      tr.appendChild(el('td', state));
      var linkCell = el('td');
      if (p.url) {
        var input = el('input');
        input.className = 'link';
        input.readOnly = true;
        input.value = p.url;
        input.onclick = function () { input.select(); };
        linkCell.appendChild(input);
      } else {
        linkCell.appendChild(el('span', 'No link yet')).className = 'muted';
      }
      tr.appendChild(linkCell);
      var actions = el('td');
      if (p.url) {
        actions.appendChild(button('New link', p.key, 'rotate'));
        actions.appendChild(button('Turn off', p.key, 'revoke'));
      } else {
        actions.appendChild(button('Make link', p.key, 'create'));
      }
      if (p.delivery === 'Web' && p.hasSheet && p.move !== 'moved') {
        actions.appendChild(button('Switch now', p.key, 'switch'));
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
  }
  document.getElementById('filter').oninput = draw;
  draw();
</script>`;
}
