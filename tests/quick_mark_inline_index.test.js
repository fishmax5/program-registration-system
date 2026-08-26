// Quick Mark's lists now travel INSIDE the dialog's own markup, so the page
// paints with its dropdowns already populated and asks the server nothing at
// all until somebody presses Mark. Every google.script.run is a round trip of
// its own, and the dialog's whole job on opening was to make one.
//
// Shipping data inside a <script> block is also the one way this could go
// badly wrong: a member called O'Brien, or a program title containing the
// two characters that end a script tag, would otherwise end the page in the
// middle of a sentence and leave a dialog that does nothing at all. So what
// this file pins is that the literal is a literal — through a name chosen to
// break it — and that the script block is still valid JavaScript.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sandbox = {
  console:{log:()=>{}},
  Utilities:{formatDate:()=>'9:00 AM', getUuid:()=>'x', sleep:()=>{}, computeDigest:()=>[1], DigestAlgorithm:{MD5:'MD5'}},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty:()=>{},deleteProperty:()=>{}})},
  SpreadsheetApp:{getActiveSpreadsheet:()=>null},
  FormApp:{ItemType:{}},CalendarApp:{},DriveApp:{},HtmlService:{},LockService:{},
  Session:{getScriptTimeZone:()=>'America/New_York',getEffectiveUser:()=>({getEmail:()=>'a@b.c'})},
  ScriptApp:{},MailApp:{},DocumentApp:{},UrlFetchApp:{},Calendar:{},CacheService:{}
};
vm.createContext(sandbox);
vm.runInContext(src+';this.buildQuickMarkHtml=buildQuickMarkHtml;',sandbox,{filename:'Code.gs'});

const nasty = 'O\'Brien </script><script>alert("x")</script> "quoted"';
const index = {
  builtAt:'9:00 AM',
  sessions:[{value:'Chair Yoga · Wed, Sep 16',label:'Chair Yoga · Wed, Sep 16',location:'Narberth',
             title:'Chair Yoga',dateKey:'2026-09-16',byAppointment:false,times:[],group:'Upcoming'}],
  namesBySession:{'Narberth|~|Chair Yoga · Wed, Sep 16':{names:[nasty],keys:['x'],times:['']}},
  members:[{name:nasty,key:'x'}],
  needs:[{text:'No milk',when:'every time',nameKey:'x',location:'',program:'',frequency:'Every time',
          weekdays:[],dates:[],startsKey:'',endsKey:''}]
};

let fail=0;
function ok(n,c){ if(c) console.log('ok   '+n); else {fail++;console.log('FAIL '+n);} }

const withIndex = sandbox.buildQuickMarkHtml(index);
const without  = sandbox.buildQuickMarkHtml(null);

ok('an index-less dialog still says INDEX = null', /var INDEX = null \? JSON\.parse\(null\) : null;/.test(without));
ok('a preloaded dialog carries the data inline', withIndex.indexOf('Chair Yoga') !== -1);

// The </script> in the hostile name must not appear raw anywhere, or the page
// ends in the middle of the script block.
const scriptStart = withIndex.indexOf('<script>');
const body = withIndex.substring(scriptStart);
const closes = body.split('</script>').length - 1;
ok('the page has exactly one closing script tag', closes === 1);

// And the literal must actually parse back to the same object.
const m = /var INDEX = ("(?:[^"\\]|\\.)*") \? JSON\.parse/.exec(withIndex);
ok('the inlined value is a single string literal', !!m);
if (m) {
  const parsed = JSON.parse(JSON.parse(m[1]));
  ok('it round-trips to the same index', JSON.stringify(parsed) === JSON.stringify(index));
  ok('including the hostile name, intact', parsed.members[0].name === nasty);
}

// The whole script block has to be valid JS.
const js = body.replace(/^<script>/,'').replace(/<\/script>[\s\S]*$/,'');
try { new vm.Script('(function(){' + js + '})'); ok('the dialog script parses as JavaScript', true); }
catch(e){ ok('the dialog script parses as JavaScript ('+e.message+')', false); }

console.log(fail===0?'\nAll inline checks passed.':`\n${fail} failure(s).`);
process.exit(fail===0?0:1);
