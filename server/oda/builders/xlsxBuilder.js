// xlsxBuilder.js — XLSX with LIVE FORMULAS (Phase 4 §3).
// Assumptions-first structure: README → Assumptions → Model (cross-sheet
// formula references, no hardcoded results) → Sensitivity (delta + %-swing
// formulas) → Methodology (sources). QA re-reads the written workbook and
// asserts formula cells actually exist — verified, not assumed.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { COLORS, FONTS, sourcesLine } from './theme.js';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.MIST_SOFT}` } };
const GOLD_FONT = { name: FONTS.BODY, size: 10, bold: true, color: { argb: `FF${COLORS.GOLD}` } };
const BODY_FONT = { name: FONTS.BODY, size: 10, color: { argb: `FF${COLORS.INK}` } };

function styleHeader(row) {
  row.eachCell((c) => { c.fill = HEADER_FILL; c.font = GOLD_FONT; });
  row.commit?.();
}

/** @returns {Promise<{path, bytes, qa}>} */
export async function build(spec, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Office of Development Affairs';
  wb.created = new Date();

  // Default assumptions when the spec carries none — flagged honestly in QA
  // (an empty model workbook would be useless; the flag surfaces the gap).
  const flags = [];
  let assumptions = Array.isArray(spec.assumptions) && spec.assumptions.length ? spec.assumptions : null;
  if (!assumptions) {
    flags.push('no-assumptions-in-spec: workbook shipped with placeholder rows');
    assumptions = [
      { name: 'Primary driver', low: 1, base: 2, high: 3, unit: 'x', source: 'stated assumption' },
      { name: 'Unit cost', low: 90, base: 100, high: 115, unit: 'USD', source: 'stated assumption' },
    ];
  }

  // ---- README ----
  const readme = wb.addWorksheet('README');
  readme.columns = [{ width: 28 }, { width: 70 }];
  readme.addRow(['Title', spec.title]).font = { name: FONTS.BODY, size: 12, bold: true };
  readme.addRow(['Generated', new Date().toISOString()]);
  readme.addRow(['Structure', 'Assumptions-first: every Model figure derives from the Assumptions sheet by live formula']);
  readme.addRow([]);
  readme.addRow(['Sheet', 'Purpose']).eachCell((c) => { c.fill = HEADER_FILL; c.font = GOLD_FONT; });
  [['Assumptions', 'All model inputs — Low/Base/High per assumption, with source'],
   ['Model', 'Computed blocks referencing Assumptions via cross-sheet formulas (no hardcoded results)'],
   ['Sensitivity', 'Per-assumption swing: High−Low delta and % swing vs Base (formulas)'],
   ['Methodology', 'Approach, structure and sources'],
  ].forEach((r) => readme.addRow(r));
  readme.eachRow((r) => r.eachCell((c) => { if (!c.font) c.font = BODY_FONT; }));

  // ---- Assumptions ----
  const asws = wb.addWorksheet('Assumptions');
  asws.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Low', key: 'low', width: 12 },
    { header: 'Base', key: 'base', width: 12 },
    { header: 'High', key: 'high', width: 12 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Source', key: 'source', width: 34 },
  ];
  styleHeader(asws.getRow(1));
  asws.views = [{ state: 'frozen', ySplit: 1 }];
  assumptions.forEach((a) => {
    const row = asws.addRow({ name: a.name, low: a.low, base: a.base, high: a.high, unit: a.unit || '', source: a.source || 'stated assumption' });
    row.eachCell((c) => { c.font = BODY_FONT; });
  });

  // ---- Model (live cross-sheet formulas ONLY — no cached result values) ----
  const model = wb.addWorksheet('Model');
  model.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleHeader(model.addRow(['Line item', 'Low', 'Base', 'High']));
  model.views = [{ state: 'frozen', ySplit: 1 }];
  const firstDataRow = 2;
  assumptions.forEach((a, i) => {
    const ar = i + 2; // row on Assumptions (1-based, header row 1)
    const r = model.addRow([a.name]);
    r.getCell(2).value = { formula: `Assumptions!B${ar}` };
    r.getCell(3).value = { formula: `Assumptions!C${ar}` };
    r.getCell(4).value = { formula: `Assumptions!D${ar}` };
    r.getCell(1).font = BODY_FONT;
  });
  const lastDataRow = firstDataRow + assumptions.length - 1;
  const totals = model.addRow(['Total']);
  totals.getCell(1).font = { ...BODY_FONT, bold: true };
  totals.getCell(2).value = { formula: `SUM(B${firstDataRow}:B${lastDataRow})` };
  totals.getCell(3).value = { formula: `SUM(C${firstDataRow}:C${lastDataRow})` };
  totals.getCell(4).value = { formula: `SUM(D${firstDataRow}:D${lastDataRow})` };
  const totalRowIdx = totals.number;

  // ---- Sensitivity (delta + % swing vs base, all formulas) ----
  const sens = wb.addWorksheet('Sensitivity');
  sens.columns = [{ width: 30 }, { width: 16 }, { width: 20 }];
  styleHeader(sens.addRow(['Assumption', 'Δ (High − Low)', '% swing vs Base total']));
  sens.views = [{ state: 'frozen', ySplit: 1 }];
  assumptions.forEach((a, i) => {
    const mr = firstDataRow + i;
    const r = sens.addRow([a.name]);
    r.getCell(1).font = BODY_FONT;
    r.getCell(2).value = { formula: `Model!D${mr}-Model!B${mr}` };
    r.getCell(3).value = { formula: `IF(Model!C$${totalRowIdx}=0,0,(Model!D${mr}-Model!B${mr})/Model!C$${totalRowIdx})` };
    r.getCell(3).numFmt = '0.0%';
  });

  // ---- Methodology ----
  const meth = wb.addWorksheet('Methodology');
  meth.columns = [{ width: 100 }];
  [
    `Model: ${spec.title}`,
    'Structure: assumptions-first. The Assumptions sheet is the single source of every input; the Model sheet references it exclusively by formula; totals are SUM() ranges; the Sensitivity sheet derives High−Low deltas and % swings against the Base total. No calculated result is hardcoded anywhere a formula belongs.',
    'Scenario logic: Low/Base/High columns carry the three cases side by side; edit any assumption and every dependent figure recomputes on open.',
    sourcesLine(spec.citations, 'Sources: internal brief'),
  ].forEach((t) => { const r = meth.addRow([t]); r.getCell(1).font = BODY_FONT; r.getCell(1).alignment = { wrapText: true }; });

  await wb.xlsx.writeFile(outPath);

  // ---- QA: re-read the written file and count REAL formula cells ----
  const check = new ExcelJS.Workbook();
  await check.xlsx.readFile(outPath);
  let formulaCells = 0;
  let headerStyled = false;
  for (const wsName of ['Model', 'Sensitivity']) {
    const ws = check.getWorksheet(wsName);
    ws?.eachRow((row) => row.eachCell((cell) => {
      if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === 'object' && 'formula' in cell.value)) formulaCells++;
    }));
  }
  const hdr = check.getWorksheet('Assumptions')?.getRow(1)?.getCell(1);
  headerStyled = Boolean(hdr?.fill?.fgColor?.argb);
  if (formulaCells === 0) flags.push('QA-FAIL: no formula cells found on re-read');
  if (!headerStyled) flags.push('QA-WARN: header styling missing on re-read');

  const bytes = fs.statSync(outPath).size;
  return {
    path: outPath,
    bytes,
    qa: { sheets: check.worksheets.length, formulaCells, headerStyled, assumptions: assumptions.length, flags },
  };
}
