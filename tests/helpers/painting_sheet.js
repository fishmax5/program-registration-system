// ============================================================================
// A SHEET THAT REMEMBERS WHAT IT LOOKS LIKE — painted by either API
// ============================================================================
//
// counting_sheet.js counts calls and models VALUES; formatting there is
// answered generically. That is the right fake for a benchmark and the wrong
// one for the question 99zk_sheets_batch_update.gs has to answer: does the
// Sheets API path paint EXACTLY what the SpreadsheetApp path paints?
//
// So this models the paint. One model per sheet — values, and per cell the
// background, font colour / weight / style / size, horizontal and vertical
// alignment, wrap, number format, note and data validation; per row its
// height; per column its width and whether it is hidden; the frozen rows and
// columns; the protections — and TWO ways to paint it:
//
//   • a SpreadsheetApp-shaped Sheet / Range / RangeList, whose setters write
//     the model; and
//   • a `Sheets` advanced-service double (makeSheetsService) whose
//     Spreadsheets.batchUpdate applies v4 requests to the same models.
//
// Both normalize into one vocabulary (hex colours lower-cased, 'left', 'middle',
// 'OVERFLOW', 'checkbox:false'…), and snapshot() renders a model as one plain
// object, so a golden test can paint the same input both ways and deep-compare.
//
// UNKNOWN REQUESTS THROW, and so does a grid range outside the sheet: a fake
// that quietly accepted a request it does not model would let an unsupported
// or off-by-one request pass the very test meant to catch it. Unknown RANGE
// and SHEET methods are recorded in `other` (and compared too), chained like
// the real ones.
// ============================================================================

const RANGE_LIST_MISSING = ['setDataValidation', 'setDataValidations', 'setValue', 'setValues', 'getValues'];

function lowerHex(c) { return c ? String(c).toLowerCase() : undefined; }
function normWrap(w) {
  if (w === null || w === undefined) return undefined;
  const s = String(w);
  return s === 'OVERFLOW_CELL' ? 'OVERFLOW' : s;
}
function hexOf(color) {
  if (!color) return undefined;
  const h = v => Math.round((v || 0) * 255).toString(16).padStart(2, '0');
  return `#${h(color.red)}${h(color.green)}${h(color.blue)}`;
}
function displayLength(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return 12;
  return String(v).split('\n').reduce((m, l) => Math.max(m, l.length), 0);
}

/** A data-validation builder whose rules can be read back — what 99zk translates. */
function makeValidationBuilder() {
  const spec = { type: null, values: [], allowInvalid: true, help: '' };
  const b = {
    requireCheckbox(...vals) { spec.type = 'CHECKBOX'; spec.values = vals; return b; },
    requireValueInList(list, show) { spec.type = 'VALUE_IN_LIST'; spec.values = [list, show === undefined ? true : show]; return b; },
    requireNumberGreaterThanOrEqualTo(n) { spec.type = 'NUMBER_GREATER_THAN_OR_EQUAL_TO'; spec.values = [n]; return b; },
    setAllowInvalid(v) { spec.allowInvalid = !!v; return b; },
    setHelpText(t) { spec.help = t; return b; },
    build() {
      const s = JSON.parse(JSON.stringify(spec));
      return {
        __rule: s,
        getCriteriaType: () => s.type,
        getCriteriaValues: () => s.values,
        getAllowInvalid: () => s.allowInvalid,
        getHelpText: () => s.help
      };
    }
  };
  return new Proxy(b, { get(t, p) { if (p in t) return t[p]; return () => b; } });
}

function ruleDescriptor(rule) {
  if (!rule) return undefined;
  const s = rule.__rule;
  if (!s) return 'unknown-rule';
  if (s.type === 'CHECKBOX') return `checkbox:${!s.allowInvalid}`;
  if (s.type === 'VALUE_IN_LIST') return `list:${!s.allowInvalid}:${s.values[1] !== false}:${(s.values[0] || []).join('|')}`;
  if (s.type === 'NUMBER_GREATER_THAN_OR_EQUAL_TO') return `gte:${!s.allowInvalid}:${s.values[0]}`;
  return `other:${s.type}`;
}

function apiRuleDescriptor(rule) {
  if (!rule) return undefined;
  const c = rule.condition || {};
  if (c.type === 'BOOLEAN') return `checkbox:${!!rule.strict}`;
  if (c.type === 'ONE_OF_LIST') {
    return `list:${!!rule.strict}:${rule.showCustomUi !== false}:${(c.values || []).map(v => v.userEnteredValue).join('|')}`;
  }
  if (c.type === 'NUMBER_GREATER_THAN_EQ') return `gte:${!!rule.strict}:${c.values[0].userEnteredValue}`;
  throw new Error(`fake Sheets: unmodelled validation ${c.type}`);
}

let __protectionSerial = 0;

function makePaintingSheet(options) {
  options = options || {};
  const name = options.name || 'Sheet1';
  const sheetId = options.sheetId === undefined ? 1 : options.sheetId;
  const fileId = options.fileId || 'file-1';
  const m = {
    values: {}, fmt: {}, notes: {}, dv: {},
    rowHeights: {}, colWidths: {}, hidden: {},
    frozenRows: 0, frozenCols: 0, protections: [], other: [],
    maxRows: options.maxRows || 1000, maxCols: options.maxCols || 26
  };
  const stats = { calls: 0 };
  const key = (r, c) => `${r},${c}`;
  const fmtAt = (r, c) => (m.fmt[key(r, c)] = m.fmt[key(r, c)] || {});
  const setAttr = (r, c, attr, v) => {
    const f = fmtAt(r, c);
    if (v === undefined) delete f[attr]; else f[attr] = v;
  };
  const lastRow = () => Object.keys(m.values).reduce((x, k) => {
    const v = m.values[k];
    return v === '' || v === null || v === undefined ? x : Math.max(x, Number(k.split(',')[0]));
  }, 0);
  const lastCol = () => Object.keys(m.values).reduce((x, k) => {
    const v = m.values[k];
    return v === '' || v === null || v === undefined ? x : Math.max(x, Number(k.split(',')[1]));
  }, 0);
  const fit = c => {
    let len = 0;
    for (let r = 1; r <= lastRow(); r++) len = Math.max(len, displayLength(m.values[key(r, c)]));
    return Math.max(40, 7 * len + 10);
  };
  const forCells = (row, col, rows, cols, fn) => {
    if (row < 1 || col < 1 || row + rows - 1 > m.maxRows || col + cols - 1 > m.maxCols) {
      throw new Error(`fake sheet: range R${row}C${col} ${rows}x${cols} is outside ${m.maxRows}x${m.maxCols}`);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) fn(row + r, col + c, r, c);
  };

  function makeRange(row, col, numRows, numCols) {
    const rows = numRows === undefined ? 1 : numRows;
    const cols = numCols === undefined ? 1 : numCols;
    const each = (fn) => forCells(row, col, rows, cols, fn);
    const counted = fn => (...args) => { stats.calls++; return fn(...args); };
    const impl = {
      getRow: () => row, getColumn: () => col, getNumRows: () => rows, getNumColumns: () => cols,
      getA1Notation: () => `${row}:${col}:${rows}:${cols}`,
      getValues: counted(() => {
        const out = [];
        for (let r = 0; r < rows; r++) {
          const line = [];
          for (let c = 0; c < cols; c++) {
            const v = m.values[key(row + r, col + c)];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      }),
      getValue: counted(() => { const v = m.values[key(row, col)]; return v === undefined ? '' : v; }),
      setValues: counted(values => { each((r, c, i, j) => { m.values[key(r, c)] = values[i][j]; }); return proxy; }),
      setValue: counted(v => { m.values[key(row, col)] = v; return proxy; }),
      setBackground: counted(v => { each((r, c) => setAttr(r, c, 'background', lowerHex(v))); return proxy; }),
      setBackgrounds: counted(mx => { each((r, c, i, j) => setAttr(r, c, 'background', lowerHex(mx[i][j]))); return proxy; }),
      setFontColor: counted(v => { each((r, c) => setAttr(r, c, 'fontColor', lowerHex(v))); return proxy; }),
      setFontColors: counted(mx => { each((r, c, i, j) => setAttr(r, c, 'fontColor', lowerHex(mx[i][j]))); return proxy; }),
      setFontWeight: counted(v => { each((r, c) => setAttr(r, c, 'bold', v === null ? undefined : String(v) === 'bold')); return proxy; }),
      setFontWeights: counted(mx => { each((r, c, i, j) => setAttr(r, c, 'bold', String(mx[i][j]) === 'bold')); return proxy; }),
      setFontStyle: counted(v => { each((r, c) => setAttr(r, c, 'italic', v === null ? undefined : String(v) === 'italic')); return proxy; }),
      setFontSize: counted(v => { each((r, c) => setAttr(r, c, 'fontSize', v === null ? undefined : Number(v))); return proxy; }),
      setHorizontalAlignment: counted(v => { each((r, c) => setAttr(r, c, 'hAlign', v ? String(v).toLowerCase() : undefined)); return proxy; }),
      setVerticalAlignment: counted(v => { each((r, c) => setAttr(r, c, 'vAlign', v ? String(v).toLowerCase() : undefined)); return proxy; }),
      setWrapStrategy: counted(v => { each((r, c) => setAttr(r, c, 'wrap', normWrap(v))); return proxy; }),
      setNumberFormat: counted(v => { each((r, c) => setAttr(r, c, 'numberFormat', v)); return proxy; }),
      setNumberFormats: counted(mx => { each((r, c, i, j) => setAttr(r, c, 'numberFormat', mx[i][j])); return proxy; }),
      setNote: counted(v => { each((r, c) => { if (v) m.notes[key(r, c)] = String(v); else delete m.notes[key(r, c)]; }); return proxy; }),
      clearNote: counted(() => { each((r, c) => { delete m.notes[key(r, c)]; }); return proxy; }),
      setDataValidation: counted(rule => { each((r, c) => { const d = ruleDescriptor(rule); if (d) m.dv[key(r, c)] = d; else delete m.dv[key(r, c)]; }); return proxy; }),
      setDataValidations: counted(mx => { each((r, c, i, j) => { const d = ruleDescriptor(mx[i][j]); if (d) m.dv[key(r, c)] = d; else delete m.dv[key(r, c)]; }); return proxy; }),
      clearDataValidations: counted(() => { each((r, c) => { delete m.dv[key(r, c)]; }); return proxy; }),
      // The project's own belief about insertCheckboxes(), and the one this
      // fake encodes: the validation, and the values left as they were.
      insertCheckboxes: counted(() => { each((r, c) => { m.dv[key(r, c)] = 'checkbox:false'; }); return proxy; }),
      clearFormat: counted(() => { each((r, c) => { delete m.fmt[key(r, c)]; }); return proxy; }),
      breakApart: counted(() => proxy),
      protect: counted(() => {
        const p = makeProtection({ r: row, c: col, nr: rows, nc: cols, description: '', warning: false });
        return p;
      })
    };
    const proxy = new Proxy(impl, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== 'string') return undefined;
        return (...args) => {
          stats.calls++;
          if (/^(get|is)[A-Z]/.test(prop)) return prop.startsWith('is') ? false : null;
          m.other.push(`range.${prop}@${row},${col},${rows},${cols}:${safeArgs(args)}`);
          return proxy;
        };
      }
    });
    return proxy;
  }

  function makeProtection(spec) {
    const p = Object.assign({ id: `pr-${++__protectionSerial}` }, spec);
    m.protections.push(p);
    const api = {
      __p: p,
      setDescription(t) { stats.calls++; p.description = t; return api; },
      setWarningOnly(w) { stats.calls++; p.warning = !!w; return api; },
      getDescription: () => p.description,
      remove() { stats.calls++; const i = m.protections.indexOf(p); if (i >= 0) m.protections.splice(i, 1); }
    };
    p.__api = api;
    return api;
  }

  const sheetImpl = {
    model: m, stats,
    getName: () => name,
    getSheetId: () => sheetId,
    getParent: () => ({ getId: () => fileId }),
    getMaxRows: () => m.maxRows,
    getMaxColumns: () => m.maxCols,
    getLastRow: () => { stats.calls++; return lastRow(); },
    getLastColumn: () => { stats.calls++; return lastCol(); },
    getRange: (row, col, numRows, numCols) => { stats.calls++; return makeRange(row, col, numRows, numCols); },
    getRangeList: a1s => {
      stats.calls++;
      const ranges = a1s.map(a1 => { const [r, c, nr, nc] = a1.split(':').map(Number); return makeRange(r, c, nr, nc); });
      const list = new Proxy({}, {
        get(t, prop) {
          if (typeof prop !== 'string') return undefined;
          if (RANGE_LIST_MISSING.indexOf(prop) !== -1) return undefined;
          return (...args) => {
            ranges.forEach(rg => { stats.calls--; rg[prop](...args); });
            stats.calls++;
            return list;
          };
        }
      });
      return list;
    },
    insertRowsAfter: (after, n) => { stats.calls++; m.maxRows += n; },
    insertColumnsAfter: (after, n) => { stats.calls++; m.maxCols += n; },
    clearFormats: () => { stats.calls++; m.fmt = {}; return sheetProxy; },
    clearContents: () => { stats.calls++; m.values = {}; return sheetProxy; },
    clear: () => { stats.calls++; m.values = {}; m.fmt = {}; m.notes = {}; return sheetProxy; },
    getBandings: () => { stats.calls++; return []; },
    getProtections: () => { stats.calls++; return m.protections.map(p => p.__api || makeProtectionApi(p)); },
    setRowHeight: (r, px) => { stats.calls++; m.rowHeights[r] = px; return sheetProxy; },
    setRowHeights: (r, n, px) => { stats.calls++; for (let i = 0; i < n; i++) m.rowHeights[r + i] = px; return sheetProxy; },
    setRowHeightsForced: (r, n, px) => { stats.calls++; for (let i = 0; i < n; i++) m.rowHeights[r + i] = px; return sheetProxy; },
    setFrozenRows: n => { stats.calls++; m.frozenRows = n; return sheetProxy; },
    setFrozenColumns: n => { stats.calls++; m.frozenCols = n; return sheetProxy; },
    getFrozenRows: () => { stats.calls++; return m.frozenRows; },
    getFrozenColumns: () => { stats.calls++; return m.frozenCols; },
    hideColumns: (c, n) => { stats.calls++; for (let i = 0; i < (n || 1); i++) m.hidden[c + i] = true; return sheetProxy; },
    showColumns: (c, n) => { stats.calls++; for (let i = 0; i < (n || 1); i++) delete m.hidden[c + i]; return sheetProxy; },
    autoResizeColumns: (c, n) => { stats.calls++; for (let i = 0; i < n; i++) m.colWidths[c + i] = fit(c + i); return sheetProxy; },
    getColumnWidth: c => { stats.calls++; return m.colWidths[c] || 100; },
    setColumnWidth: (c, px) => { stats.calls++; m.colWidths[c] = px; return sheetProxy; },
    setColumnWidths: (c, n, px) => { stats.calls++; for (let i = 0; i < n; i++) m.colWidths[c + i] = px; return sheetProxy; },
    // ---- the API side, used by makeSheetsService --------------------------
    __fit: fit,
    __forCells: forCells,
    __setAttr: setAttr,
    __key: key,
    __addProtection: spec => makeProtection(spec)
  };
  function makeProtectionApi(p) { return p.__api; }

  const sheetProxy = new Proxy(sheetImpl, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        stats.calls++;
        if (/^(get|is)[A-Z]/.test(prop)) return prop.startsWith('is') ? false : (prop.endsWith('s') ? [] : null);
        m.other.push(`sheet.${prop}:${safeArgs(args)}`);
        return sheetProxy;
      };
    }
  });
  return sheetProxy;
}

function safeArgs(args) {
  try {
    return JSON.stringify(args, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && v.__rule) ? ruleDescriptor(v) : v);
  } catch (err) { return String(args.length); }
}

/** One painting sheet as a plain object — what a golden test compares. */
function snapshot(sheet) {
  const m = sheet.model;
  const cells = {};
  const keys = new Set([].concat(Object.keys(m.values), Object.keys(m.fmt), Object.keys(m.notes), Object.keys(m.dv)));
  Array.from(keys).sort().forEach(k => {
    const out = {};
    const v = m.values[k];
    if (v !== undefined && v !== '' && v !== null) {
      out.value = Object.prototype.toString.call(v) === '[object Date]' ? `date:${new Date(v).toISOString()}` : v;
    }
    const f = m.fmt[k] || {};
    Object.keys(f).sort().forEach(a => { if (f[a] !== undefined) out[a] = f[a]; });
    if (m.notes[k]) out.note = m.notes[k];
    if (m.dv[k]) out.validation = m.dv[k];
    if (Object.keys(out).length) cells[k] = out;
  });
  const truthy = obj => Object.keys(obj).filter(k => obj[k]).sort((a, b) => a - b).map(Number);
  return {
    cells,
    rowHeights: Object.assign({}, m.rowHeights),
    colWidths: Object.assign({}, m.colWidths),
    hidden: truthy(m.hidden),
    frozenRows: m.frozenRows,
    frozenCols: m.frozenCols,
    protections: m.protections.map(p => `${p.r},${p.c},${p.nr},${p.nc}|${p.description}|${!!p.warning}`).sort(),
    other: m.other.slice()
  };
}

/**
 * The `Sheets` advanced service, over painting sheets. `register(sheet)` makes
 * a sheet reachable by its file id. `stats` counts batchUpdate and get calls;
 * `failWith(err)` makes the next call throw — the refusal every caller must
 * survive.
 */
function makeSheetsService() {
  const files = {};
  const stats = { batchUpdate: 0, get: 0, requests: 0, bytes: 0 };
  let failure = null;
  const sheetById = (fileId, sheetId) => {
    const list = files[fileId] || [];
    const s = list.filter(x => x.getSheetId() === sheetId)[0];
    if (!s) throw new Error(`fake Sheets: no sheet ${sheetId} in ${fileId}`);
    return s;
  };
  const bounds = (sheet, range) => {
    const m = sheet.model;
    const r0 = range.startRowIndex === undefined ? 0 : range.startRowIndex;
    const r1 = range.endRowIndex === undefined ? m.maxRows : range.endRowIndex;
    const c0 = range.startColumnIndex === undefined ? 0 : range.startColumnIndex;
    const c1 = range.endColumnIndex === undefined ? m.maxCols : range.endColumnIndex;
    if (r0 < 0 || c0 < 0 || r1 <= r0 || c1 <= c0 || r1 > m.maxRows || c1 > m.maxCols) {
      throw new Error(`fake Sheets: bad range ${JSON.stringify(range)} on ${m.maxRows}x${m.maxCols}`);
    }
    return { row: r0 + 1, col: c0 + 1, rows: r1 - r0, cols: c1 - c0 };
  };
  const applyFields = (sheet, r, c, cell, fields) => {
    const m = sheet.model;
    const k = sheet.__key(r, c);
    const uf = (cell && cell.userEnteredFormat) || {};
    const tf = uf.textFormat || {};
    fields.split(',').map(s => s.trim()).forEach(field => {
      switch (field) {
        case 'userEnteredFormat': {
          delete m.fmt[k];
          if (Object.keys(uf).length) throw new Error('fake Sheets: whole-format writes are only modelled as clears');
          break;
        }
        case 'userEnteredFormat.backgroundColor': sheet.__setAttr(r, c, 'background', hexOf(uf.backgroundColor)); break;
        case 'userEnteredFormat.textFormat.foregroundColor': sheet.__setAttr(r, c, 'fontColor', hexOf(tf.foregroundColor)); break;
        case 'userEnteredFormat.textFormat.bold': sheet.__setAttr(r, c, 'bold', tf.bold === undefined ? undefined : !!tf.bold); break;
        case 'userEnteredFormat.textFormat.italic': sheet.__setAttr(r, c, 'italic', tf.italic === undefined ? undefined : !!tf.italic); break;
        case 'userEnteredFormat.textFormat.fontSize': sheet.__setAttr(r, c, 'fontSize', tf.fontSize); break;
        case 'userEnteredFormat.horizontalAlignment':
          sheet.__setAttr(r, c, 'hAlign', uf.horizontalAlignment ? uf.horizontalAlignment.toLowerCase() : undefined); break;
        case 'userEnteredFormat.verticalAlignment':
          sheet.__setAttr(r, c, 'vAlign', uf.verticalAlignment ? uf.verticalAlignment.toLowerCase() : undefined); break;
        case 'userEnteredFormat.wrapStrategy': sheet.__setAttr(r, c, 'wrap', normWrap(uf.wrapStrategy)); break;
        case 'userEnteredFormat.numberFormat': {
          const nf = uf.numberFormat;
          if (nf && !nf.type) throw new Error('fake Sheets: a number format needs a type');
          sheet.__setAttr(r, c, 'numberFormat', nf ? nf.pattern : undefined);
          break;
        }
        case 'note': if (cell && cell.note) m.notes[k] = cell.note; else delete m.notes[k]; break;
        case 'userEnteredValue': {
          const v = (cell && cell.userEnteredValue) || null;
          if (!v) m.values[k] = '';
          else if ('stringValue' in v) m.values[k] = v.stringValue;
          else if ('numberValue' in v) m.values[k] = v.numberValue;
          else if ('boolValue' in v) m.values[k] = v.boolValue;
          else if ('formulaValue' in v) m.values[k] = v.formulaValue;
          else throw new Error('fake Sheets: unknown value');
          break;
        }
        default: throw new Error(`fake Sheets: unmodelled field ${field}`);
      }
    });
  };
  const apply = (fileId, req) => {
    const type = Object.keys(req)[0];
    const body = req[type];
    switch (type) {
      case 'repeatCell': {
        const sheet = sheetById(fileId, body.range.sheetId);
        const b = bounds(sheet, body.range);
        sheet.__forCells(b.row, b.col, b.rows, b.cols, (r, c) => applyFields(sheet, r, c, body.cell, body.fields));
        return;
      }
      case 'updateCells': {
        const sheet = sheetById(fileId, body.range.sheetId);
        const b = bounds(sheet, body.range);
        if (body.rows.length !== b.rows) throw new Error('fake Sheets: updateCells rows do not match the range');
        body.rows.forEach((line, i) => {
          if (line.values.length !== b.cols) throw new Error('fake Sheets: updateCells columns do not match the range');
          line.values.forEach((cell, j) => applyFields(sheet, b.row + i, b.col + j, cell, body.fields));
        });
        return;
      }
      case 'unmergeCells': { const sheet = sheetById(fileId, body.range.sheetId); bounds(sheet, body.range); return; }
      case 'updateDimensionProperties': {
        const range = body.range;
        const sheet = sheetById(fileId, range.sheetId);
        const m = sheet.model;
        const max = range.dimension === 'ROWS' ? m.maxRows : m.maxCols;
        if (range.startIndex < 0 || range.endIndex > max || range.endIndex <= range.startIndex) {
          throw new Error(`fake Sheets: bad dimension range ${JSON.stringify(range)}`);
        }
        for (let i = range.startIndex; i < range.endIndex; i++) {
          body.fields.split(',').forEach(field => {
            if (field === 'pixelSize') {
              if (range.dimension === 'ROWS') m.rowHeights[i + 1] = body.properties.pixelSize;
              else m.colWidths[i + 1] = body.properties.pixelSize;
            } else if (field === 'hiddenByUser' && range.dimension === 'COLUMNS') {
              if (body.properties.hiddenByUser) m.hidden[i + 1] = true; else delete m.hidden[i + 1];
            } else throw new Error(`fake Sheets: unmodelled dimension field ${field}`);
          });
        }
        return;
      }
      case 'autoResizeDimensions': {
        const d = body.dimensions;
        const sheet = sheetById(fileId, d.sheetId);
        if (d.dimension !== 'COLUMNS') throw new Error('fake Sheets: only columns are fitted');
        for (let i = d.startIndex; i < d.endIndex; i++) sheet.model.colWidths[i + 1] = sheet.__fit(i + 1);
        return;
      }
      case 'updateSheetProperties': {
        const sheet = sheetById(fileId, body.properties.sheetId);
        const gp = body.properties.gridProperties || {};
        body.fields.split(',').forEach(field => {
          if (field === 'gridProperties.frozenRowCount') sheet.model.frozenRows = gp.frozenRowCount;
          else if (field === 'gridProperties.frozenColumnCount') sheet.model.frozenCols = gp.frozenColumnCount;
          else throw new Error(`fake Sheets: unmodelled sheet field ${field}`);
        });
        return;
      }
      case 'setDataValidation': {
        const sheet = sheetById(fileId, body.range.sheetId);
        const b = bounds(sheet, body.range);
        const d = apiRuleDescriptor(body.rule);
        sheet.__forCells(b.row, b.col, b.rows, b.cols, (r, c) => {
          const k = sheet.__key(r, c);
          if (d) sheet.model.dv[k] = d; else delete sheet.model.dv[k];
        });
        return;
      }
      case 'addProtectedRange': {
        const pr = body.protectedRange;
        const sheet = sheetById(fileId, pr.range.sheetId);
        const b = bounds(sheet, pr.range);
        sheet.__addProtection({ r: b.row, c: b.col, nr: b.rows, nc: b.cols, description: pr.description, warning: !!pr.warningOnly });
        return;
      }
      case 'deleteProtectedRange': {
        let found = false;
        (files[fileId] || []).forEach(sheet => {
          const list = sheet.model.protections;
          const i = list.findIndex(p => p.id === body.protectedRangeId);
          if (i >= 0) { list.splice(i, 1); found = true; }
        });
        if (!found) throw new Error(`fake Sheets: no protected range ${body.protectedRangeId}`);
        return;
      }
      default: throw new Error(`fake Sheets: unmodelled request ${type}`);
    }
  };
  const service = {
    stats,
    register(sheet) {
      const id = sheet.getParent().getId();
      (files[id] = files[id] || []).push(sheet);
    },
    failWith(err) { failure = err; },
    Spreadsheets: {
      batchUpdate(resource, fileId) {
        stats.batchUpdate++;
        if (failure) { const f = failure; failure = null; throw f; }
        stats.requests += resource.requests.length;
        stats.bytes += JSON.stringify(resource).length;
        // ATOMIC, like the real one: applied to copies, committed only if all land.
        const list = files[fileId] || [];
        const saved = list.map(s => JSON.stringify(s.model, (k, v) => (k === '__api' ? undefined : v)));
        try {
          resource.requests.forEach(req => apply(fileId, req));
        } catch (err) {
          list.forEach((s, i) => {
            const restored = JSON.parse(saved[i]);
            Object.keys(restored).forEach(k => { s.model[k] = restored[k]; });
          });
          throw err;
        }
        return { replies: [] };
      },
      get(fileId, opts) {
        stats.get++;
        if (failure) { const f = failure; failure = null; throw f; }
        const sheets = (files[fileId] || []).map(s => {
          const out = { properties: { sheetId: s.getSheetId(), title: s.getName() } };
          if (/protectedRanges/.test(opts.fields || '')) {
            out.protectedRanges = s.model.protections.map(p => ({ protectedRangeId: p.id, description: p.description }));
          }
          if (/columnMetadata/.test(opts.fields || '')) {
            const range = (opts.ranges || [])[0] || '';
            const mm = /^'((?:[^']|'')*)'!([A-Z]+)\d+:([A-Z]+)\d+$/.exec(range);
            if (!mm) throw new Error(`fake Sheets: bad range ${range}`);
            if (mm[1].replace(/''/g, "'") !== s.getName()) return null;
            const num = l => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
            const meta = [];
            for (let c = num(mm[2]); c <= num(mm[3]); c++) meta.push({ pixelSize: s.model.colWidths[c] || 100 });
            out.data = [{ columnMetadata: meta }];
          }
          return out;
        }).filter(Boolean);
        return { sheets };
      }
    }
  };
  return service;
}

module.exports = { makePaintingSheet, makeSheetsService, makeValidationBuilder, snapshot };
