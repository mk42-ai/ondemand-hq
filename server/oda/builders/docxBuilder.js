// docxBuilder.js — structured DOCX on the ODA theme (Phase 4 §2).
// Proper heading hierarchy (Lora headings / Montserrat body), ODA header with
// gold rule + page-number footer, EDITABLE tables (shaded header row), source
// notes per section, page breaks between sections, and full EN-LTR / AR-RTL
// paragraph+run direction (bidirectional paragraphs, rightToLeft runs).
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, Header, Footer, PageNumber, BorderStyle, ShadingType,
} from 'docx';
import fs from 'node:fs';
import { COLORS, FONTS, sourcesLine, isRtl, isBilingual } from './theme.js';

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const ruleBorder = { style: BorderStyle.SINGLE, size: 4, color: COLORS.MIST_SOFT };

function para({ text, size = 22, color = COLORS.INK, font = FONTS.BODY, bold = false, rtl = false, spacingAfter = 120, heading = null, pageBreakBefore = false, alignment = null }) {
  return new Paragraph({
    heading: heading || undefined,
    pageBreakBefore,
    bidirectional: rtl,
    alignment: alignment || (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT),
    spacing: { after: spacingAfter },
    children: [new TextRun({ text, size, color, font: rtl ? FONTS.ARABIC : font, bold, rightToLeft: rtl })],
  });
}

function bulletPara(text, { rtl = false } = {}) {
  return new Paragraph({
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 22, color: COLORS.INK, font: rtl ? FONTS.ARABIC : FONTS.BODY, rightToLeft: rtl })],
  });
}

function mdTable(t, { rtl = false } = {}) {
  const headerCells = t.header.map((h) => new TableCell({
    shading: { type: ShadingType.CLEAR, fill: COLORS.MIST_SOFT },
    borders: { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.GOLD } },
    children: [new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text: h, bold: true, size: 20, color: COLORS.GOLD, font: rtl ? FONTS.ARABIC : FONTS.BODY, rightToLeft: rtl })],
    })],
  }));
  const bodyRows = t.rows.map((r) => new TableRow({
    children: r.map((c, ci) => new TableCell({
      borders: { top: noBorder, left: noBorder, right: noBorder, bottom: ruleBorder },
      children: [new Paragraph({
        bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: String(c), size: 20, bold: ci === 0, color: COLORS.INK, font: rtl ? FONTS.ARABIC : FONTS.BODY, rightToLeft: rtl })],
      })],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: headerCells }), ...bodyRows],
  });
}

/** Emit the docx children for one section (EN or AR pass). */
function sectionChildren(sec, { rtl, first, counters }) {
  const out = [];
  out.push(para({ text: sec.heading, heading: HeadingLevel.HEADING_1, font: FONTS.TITLE, size: 34, bold: true, pageBreakBefore: !first, rtl, spacingAfter: 200 }));
  counters.sections++;
  for (const bn of sec.bigNumbers || []) {
    out.push(new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 60 },
      children: [
        new TextRun({ text: `${bn.value}  `, size: 40, color: COLORS.GOLD, bold: true, font: FONTS.TITLE, rightToLeft: rtl }),
        new TextRun({ text: bn.label, size: 20, color: COLORS.INK70, font: rtl ? FONTS.ARABIC : FONTS.BODY, rightToLeft: rtl }),
      ],
    }));
    if (rtl) counters.rtlRuns += 2;
  }
  for (const p of sec.paragraphs) { out.push(para({ text: p, rtl })); if (rtl) counters.rtlRuns++; }
  for (const b of sec.bullets) { out.push(bulletPara(b, { rtl })); if (rtl) counters.rtlRuns++; }
  if (sec.table) { out.push(mdTable(sec.table, { rtl })); counters.tables++; }
  if (sec.sources?.length || true) {
    out.push(para({ text: sourcesLine(sec.sources), size: 18, color: COLORS.INK70, rtl, spacingAfter: 200 }));
  }
  return out;
}

/** @returns {Promise<{path, bytes, qa}>} */
export async function build(spec, outPath) {
  const rtlDoc = isRtl(spec.lang);
  const bilingual = isBilingual(spec.lang);
  const counters = { sections: 0, tables: 0, rtlRuns: 0 };
  const flags = [];

  const children = [
    // Cover block.
    para({ text: 'OFFICE OF DEVELOPMENT AFFAIRS', size: 18, color: COLORS.INK70, bold: true, spacingAfter: 60 }),
    para({ text: spec.title, font: FONTS.TITLE, size: 56, bold: true, rtl: rtlDoc, spacingAfter: 120 }),
    para({ text: spec.subtitle || 'Prepared briefing document', size: 24, color: COLORS.INK70, rtl: rtlDoc, spacingAfter: 60 }),
    para({ text: spec.date || '', size: 20, color: COLORS.GOLD, spacingAfter: 400 }),
  ];

  spec.sections.forEach((sec, i) => {
    children.push(...sectionChildren(sec, { rtl: rtlDoc, first: i === 0, counters }));
    // Bilingual: AR mirror follows the EN section when provided (or spec is bilingual
    // and the section itself carries Arabic paragraphsAr/bulletsAr).
    if (bilingual) {
      const arSec = {
        heading: sec.headingAr || sec.heading,
        paragraphs: sec.paragraphsAr || [],
        bullets: sec.bulletsAr || [],
        table: sec.tableAr || null,
        bigNumbers: [],
        sources: sec.sources,
      };
      if (arSec.paragraphs.length || arSec.bullets.length) {
        children.push(...sectionChildren(arSec, { rtl: true, first: false, counters }));
      }
    }
  });

  // Citations + gaps end-matter.
  if (spec.citations?.length) {
    children.push(para({ text: 'Citations', heading: HeadingLevel.HEADING_1, font: FONTS.TITLE, size: 30, bold: true, pageBreakBefore: true, spacingAfter: 160 }));
    for (const c of spec.citations) children.push(bulletPara(c.url ? `${c.name} — ${c.url}` : c.name));
  }
  if (spec.gaps?.length) {
    children.push(para({ text: 'Verification gaps', heading: HeadingLevel.HEADING_1, font: FONTS.TITLE, size: 30, bold: true, spacingAfter: 160 }));
    for (const g of spec.gaps) {
      children.push(new Paragraph({
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: COLORS.GOLD, space: 8 } },
        spacing: { after: 100 },
        children: [new TextRun({ text: g, size: 20, color: COLORS.INK70, font: FONTS.BODY })],
      }));
    }
  } else {
    flags.push('no-gaps-declared');
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONTS.BODY, size: 22, color: COLORS.INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', run: { font: FONTS.TITLE, size: 34, bold: true, color: COLORS.INK } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', run: { font: FONTS.TITLE, size: 26, bold: true, color: COLORS.INK } },
      ],
    },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.GOLD, space: 4 } },
            children: [new TextRun({ text: 'Office of Development Affairs', size: 18, color: COLORS.INK70, font: FONTS.BODY })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `${spec.date || ''}  ·  Page `, size: 16, color: COLORS.INK70, font: FONTS.BODY }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLORS.INK70, font: FONTS.BODY }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  return {
    path: outPath,
    bytes: buf.length,
    qa: { sections: counters.sections, tables: counters.tables, rtlRuns: counters.rtlRuns, flags },
  };
}
