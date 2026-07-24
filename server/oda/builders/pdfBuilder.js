// pdfBuilder.js — PDF export on the ODA theme (Phase 4 §4).
// pdfkit, A4 landscape, one page per section: gold kicker, ink title, body,
// gold-square bullets, simple ruled tables, per-section sources line, page
// numbers. HONEST LIMITATION: pdfkit cannot shape Arabic without a bundled
// TTF + shaper — Arabic blocks defer to the DOCX/PPTX artifacts and the QA
// flags 'arabic-deferred-to-docx' rather than faking RTL output.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { COLORS, GEOMETRY, sourcesLine, isRtl, isBilingual } from './theme.js';

const INK = `#${COLORS.INK}`;
const GOLD = `#${COLORS.GOLD}`;
const INK70 = `#${COLORS.INK70}`;
const MIST_SOFT = `#${COLORS.MIST_SOFT}`;

/** @returns {Promise<{path, bytes, qa}>} */
export function build(spec, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 56, bufferPages: true });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    const flags = [];
    const rtl = isRtl(spec.lang);
    if (rtl || isBilingual(spec.lang)) flags.push('arabic-deferred-to-docx');

    const W = doc.page.width - 112; // content width inside margins

    // ---- Cover ----
    doc.rect(56, 96, 120, 4).fill(GOLD);
    doc.fillColor(INK70).font('Helvetica-Bold').fontSize(10).text('OFFICE OF DEVELOPMENT AFFAIRS', 56, 116, { characterSpacing: 2 });
    // Comment: pdfkit lacks the brand TTFs (Lora/Montserrat) — Helvetica stands in.
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(30).text(spec.title, 56, 170, { width: W });
    if (spec.subtitle) doc.fillColor(INK70).font('Helvetica').fontSize(15).text(spec.subtitle, 56, doc.y + 12, { width: W });
    doc.fillColor(GOLD).font('Helvetica').fontSize(12).text(spec.date || '', 56, doc.page.height - 120);

    // ---- Sections (new page each) ----
    for (const s of spec.sections) {
      doc.addPage();
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text((s.kicker || 'ODA BRIEFING').toUpperCase(), 56, 56, { characterSpacing: 2 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(s.heading, 56, 74, { width: W });
      let y = doc.y + 14;

      if (s.bigNumbers?.length) {
        const cols = Math.min(4, s.bigNumbers.length);
        const bw = (W - (cols - 1) * 16) / cols;
        s.bigNumbers.slice(0, cols).forEach((bn, i) => {
          const x = 56 + i * (bw + 16);
          doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(26).text(bn.value, x, y, { width: bw });
          doc.fillColor(INK70).font('Helvetica').fontSize(9).text(bn.label, x, y + 30, { width: bw });
        });
        y += 58;
      }

      doc.font('Helvetica').fontSize(11).fillColor(INK70);
      for (const p of s.paragraphs) {
        if (rtl && /[\u0600-\u06FF]/.test(p)) continue; // deferred (flagged above)
        doc.text(p, 56, y, { width: W, lineGap: 3 });
        y = doc.y + 8;
      }
      for (const b of s.bullets) {
        if (rtl && /[\u0600-\u06FF]/.test(b)) continue;
        doc.rect(56, y + 3.5, 4, 4).fill(GOLD);
        doc.fillColor(INK).font('Helvetica').fontSize(11).text(b, 68, y, { width: W - 12, lineGap: 2 });
        y = doc.y + 6;
        if (y > doc.page.height - 130) { doc.addPage(); y = 56; }
      }

      if (s.table) {
        const cols = s.table.header.length;
        const cw = W / cols;
        if (y > doc.page.height - 180) { doc.addPage(); y = 56; }
        s.table.header.forEach((h, i) => {
          doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9.5).text(String(h).toUpperCase(), 56 + i * cw, y, { width: cw - 8 });
        });
        y += 16;
        doc.moveTo(56, y - 3).lineTo(56 + W, y - 3).lineWidth(1.2).strokeColor(GOLD).stroke();
        for (const r of s.table.rows.slice(0, 14)) {
          r.forEach((c, i) => {
            doc.fillColor(INK).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(String(c), 56 + i * cw, y, { width: cw - 8 });
          });
          y += 18;
          doc.moveTo(56, y - 4).lineTo(56 + W, y - 4).lineWidth(0.5).strokeColor(MIST_SOFT).stroke();
          if (y > doc.page.height - 110) { doc.addPage(); y = 56; }
        }
        if (s.table.rows.length > 14) flags.push(`table in "${s.heading}" truncated at 14 rows for PDF`);
      }

      // Sources line pinned to the footer band of the section's LAST page.
      doc.fillColor(INK70).font('Helvetica').fontSize(8).text(sourcesLine(s.sources), 56, doc.page.height - 88, { width: W - 60 });
    }

    // ---- Citations / gaps ----
    if (spec.citations?.length || spec.gaps?.length) {
      doc.addPage();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('Citations and verification gaps', 56, 60);
      let y = 96;
      for (const c of spec.citations || []) {
        doc.fillColor(INK70).font('Helvetica').fontSize(9.5).text(`• ${c.name}${c.url ? ` — ${c.url}` : ''}`, 56, y, { width: W });
        y = doc.y + 4;
      }
      if (spec.gaps?.length) {
        y += 10;
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(11).text('Verification gaps', 56, y); y = doc.y + 6;
        for (const g of spec.gaps) {
          doc.fillColor(INK70).font('Helvetica').fontSize(9.5).text(`• ${g}`, 56, y, { width: W });
          y = doc.y + 4;
        }
      }
    }

    // ---- Page numbers ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(GOLD).font('Helvetica').fontSize(9)
        .text(String(i + 1), doc.page.width - 80, doc.page.height - 60, { width: 24, align: 'right' });
    }
    doc.flushPages();
    doc.end();

    stream.on('finish', () => {
      const bytes = fs.statSync(outPath).size;
      resolve({ path: outPath, bytes, qa: { pages: range.count, flags } });
    });
    stream.on('error', reject);
  });
}
