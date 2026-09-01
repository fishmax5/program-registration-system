#!/usr/bin/env node
// ONE FILE, FOR WHEN PASTING SIXTY-FOUR IS THE WRONG SHAPE OF WORK.
//
// The script's source of truth is the numbered `.gs` files, because that is
// what Apps Script itself runs and what makes a change readable. But the
// Apps Script editor has no "import a folder", so a first install by hand
// means creating one script file per source file — fine once, tedious under
// time pressure.
//
// This writes every source file, in evaluation order, into a single
// `Code.bundle.gs` that can be pasted into one script file instead. It is a
// BUILD OUTPUT: never edit it, and never commit it (.gitignore has it). The
// order it writes is the order Apps Script would have used, so a bundle and
// a proper multi-file project run identically.
//
//   node tools/bundle.js            -> Code.bundle.gs
//   node tools/bundle.js out.gs     -> out.gs
const fs = require('fs');
const path = require('path');
const { sourceFiles } = require('../tests/helpers/source');

const out = process.argv[2] || path.join(__dirname, '..', 'Code.bundle.gs');
const files = sourceFiles();
fs.writeFileSync(out, files.map(f => fs.readFileSync(f, 'utf8')).join('\n'));
console.log(`Wrote ${out} from ${files.length} files.`);
