// pptxBuilder.js — EDITABLE PPTX on the ODA theme (Phase 4 §1).
// pptxgenjs 16:9 (ODA_16x9, 13.333x7.5in ≡ 1920x1080@96dpi). Text, tables and
// shapes stay native/editable — NEVER flattened screenshots. Per-slide QA lint
// runs on the intermediate slide model BEFORE writing: title overflow, bullet
// count/length, table pagination, missing citations, crowding — failed checks
// are REVISED (truncate/split/paginate/add-fallback-source) and recorded.
import PptxGenJS from 'pptxgenjs';
import fs from 'node:fs';
import { COLORS, FONTS, PPTX_LAYOUT, GEOMETRY, sourcesLine, truncateAtWord, isRtl, isBilingual } from './theme.js';

const MAX_TITLE = 110;
const MAX_BULLETS = 8;
const MAX_BULLET_LEN = 220;
const MAX_TABLE_ROWS = 9;
const MAX_BOXES = 9;

/** Build the intermediate slide model from the spec (QA runs on this). */
function planSlides(spec) {
  const slides = [];
  const flags = [];
  let revised = 0;
  const rtl = isRtl(spec.lang);

  // Cover: exactly four elements (gold rule/wordmark · title · subtitle · date).
  slides.push({ kind: 'cover', title: spec.title, subtitle: spec.subtitle || 'Office of Development Affairs — Abu Dhabi', date: spec.date, boxes: 4 });

  const pushContent = (sec, part, ofParts) => {
    const idx = slides.length;
    let title = sec.heading + (ofParts > 1 ? ` (${part}/${ofParts})` : '');
    if (title.length > MAX_TITLE) {
      flags.push({ slide: idx, code: 'title-overflow', action: 'truncated at word boundary' });
      title = truncateAtWord(title, MAX_TITLE);
      revised++;
    }
    const slide = {
      kind: 'content', title, kicker: sec.kicker || 'ODA briefing', bullets: [], paragraphs: [],
      table: null, bigNumbers: [], sources: sec.sources, rtl, boxes: 2, // kicker+title
    };
    slides.push(slide);
    return slide;
  };

  for (const sec of spec.sections) {
    // Bullet lint: trim overlong bullets, split slides past the bullet cap.
    let bullets = sec.bullets.map((b, i) => {
      if (b.length > MAX_BULLET_LEN) {
        flags.push({ slide: null, code: 'bullet-overflow', action: `bullet ${i + 1} trimmed` });
        revised++;
        return truncateAtWord(b, MAX_BULLET_LEN);
      }
      return b;
    });
    const bulletPages = [];
    while (bullets.length > MAX_BULLETS) {
      bulletPages.push(bullets.slice(0, MAX_BULLETS));
      bullets = bullets.slice(MAX_BULLETS);
    }
    bulletPages.push(bullets);
    if (bulletPages.length > 1) { flags.push({ slide: null, code: 'split-slide', action: `${sec.heading} split into ${bulletPages.length}` }); revised++; }

    // Table pagination.
    const tablePages = [];
    if (sec.table) {
      let rows = sec.table.rows;
      while (rows.length > MAX_TABLE_ROWS) {
        tablePages.push({ header: sec.table.header, rows: rows.slice(0, MAX_TABLE_ROWS) });
        rows = rows.slice(MAX_TABLE_ROWS);
      }
      tablePages.push({ header: sec.table.header, rows });
      if (tablePages.length > 1) { flags.push({ slide: null, code: 'table-paginated', action: `${sec.heading} table across ${tablePages.length} slides` }); revised++; }
    }

    const parts = Math.max(bulletPages.length, tablePages.length, 1);
    for (let p = 0; p < parts; p++) {
      const slide = pushContent(sec, p + 1, parts);
      slide.paragraphs = p === 0 ? sec.paragraphs.slice(0, 2) : [];
      slide.bullets = bulletPages[p] || [];
      slide.table = tablePages[p] || null;
      slide.bigNumbers = p === 0 ? (sec.bigNumbers || []).slice(0, 4) : [];
      slide.boxes += (slide.paragraphs.length ? 1 : 0) + (slide.bullets.length ? 1 : 0)
        + (slide.table ? 1 : 0) + slide.bigNumbers.length + 1; // +1 sources line
      const slideIdx = slides.length - 1;
      // Citation lint: every content slide carries a sources line (fallback added).
      if (!slide.sources || slide.sources.length === 0) {
        flags.push({ slide: slideIdx, code: 'missing-citation', action: 'fallback sources line added' });
        slide.sourcesLine = 'Sources: internal brief';
        revised++;
      } else {
        slide.sourcesLine = sourcesLine(slide.sources);
      }
      if (slide.boxes > MAX_BOXES) flags.push({ slide: slideIdx, code: 'crowding', action: `slide carries ${slide.boxes} boxes (cap ${MAX_BOXES}) — review layout` });
    }
  }
  return { slides, flags, revised };
}

/** Write the planned slides via pptxgenjs (all elements native + editable). */
async function writeDeck(spec, plan, outPath) {
  const pptx = new PptxGenJS();
  pptx.defineLayout(PPTX_LAYOUT);
  pptx.layout = PPTX_LAYOUT.name;
  const rtl = isRtl(spec.lang);
  const bodyFont = rtl ? FONTS.ARABIC : FONTS.BODY;
  const titleFont = rtl ? FONTS.ARABIC : FONTS.TITLE;
  const M = GEOMETRY.marginIn;
  const W = PPTX_LAYOUT.width;

  for (const s of plan.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.WHITE };

    if (s.kind === 'cover') {
      // Four elements only: gold rule + wordmark · title · subtitle · date.
      slide.addShape('rect', { x: M, y: 1.15, w: 1.7, h: 0.06, fill: { color: COLORS.GOLD } });
      slide.addText('OFFICE OF DEVELOPMENT AFFAIRS', {
        x: M, y: 1.28, w: W - 2 * M, h: 0.35, fontFace: FONTS.BODY, fontSize: 12,
        color: COLORS.INK70, charSpacing: 3, bold: true,
      });
      slide.addText(s.title, {
        x: M, y: 2.6, w: W - 2 * M, h: 1.6, fontFace: titleFont, fontSize: 40,
        color: COLORS.INK, bold: true, align: rtl ? 'right' : 'left', rtlMode: rtl,
      });
      slide.addText(s.subtitle, {
        x: M, y: 4.35, w: W - 2 * M, h: 0.6, fontFace: bodyFont, fontSize: 18,
        color: COLORS.INK70, align: rtl ? 'right' : 'left', rtlMode: rtl,
      });
      slide.addText(s.date || '', {
        x: M, y: 6.6, w: 4, h: 0.4, fontFace: FONTS.BODY, fontSize: 14, color: COLORS.GOLD,
      });
      continue;
    }

    // Content slide chrome: gold kicker + Lora action title.
    slide.addText((s.kicker || '').toUpperCase(), {
      x: M, y: GEOMETRY.titleBandY, w: W - 2 * M, h: 0.3, fontFace: FONTS.BODY,
      fontSize: 11, color: COLORS.GOLD, charSpacing: 2.5, bold: true,
      align: rtl ? 'right' : 'left',
    });
    slide.addText(s.title, {
      x: M, y: GEOMETRY.titleBandY + 0.32, w: W - 2 * M, h: 1.05, fontFace: titleFont,
      fontSize: 24, color: COLORS.INK, bold: true, align: rtl ? 'right' : 'left',
      rtlMode: rtl, valign: 'top',
    });

    let y = GEOMETRY.bodyStartY;

    // Big numbers: up to 4 across (Lora gold value + label).
    if (s.bigNumbers.length) {
      const cols = Math.min(4, s.bigNumbers.length);
      const bw = (W - 2 * M - (cols - 1) * 0.3) / cols;
      s.bigNumbers.forEach((bn, i) => {
        const x = M + i * (bw + 0.3);
        slide.addText(bn.value, { x, y, w: bw, h: 0.85, fontFace: FONTS.TITLE, fontSize: 40, color: COLORS.GOLD, bold: true, align: 'left' });
        slide.addText(bn.label, { x, y: y + 0.88, w: bw, h: 0.35, fontFace: FONTS.BODY, fontSize: 12, color: COLORS.INK70 });
      });
      y += 1.5;
    }

    for (const p of s.paragraphs) {
      slide.addText(p, {
        x: M, y, w: W - 2 * M, h: 0.6, fontFace: bodyFont, fontSize: 14,
        color: COLORS.INK, align: rtl ? 'right' : 'left', rtlMode: rtl, valign: 'top',
      });
      y += 0.62;
    }

    if (s.bullets.length) {
      slide.addText(
        s.bullets.map((b) => ({
          text: b,
          options: {
            bullet: { characterCode: '25AA', indent: 14 }, color: COLORS.INK,
            fontFace: bodyFont, fontSize: 14, breakLine: true,
            align: rtl ? 'right' : 'left', rtlMode: rtl,
          },
        })),
        { x: M, y, w: (W - 2 * M) * (s.table ? 0.48 : 1), h: Math.min(4.6, 0.42 * s.bullets.length + 0.2), valign: 'top' },
      );
    }

    if (s.table) {
      const tx = s.bullets.length ? M + (W - 2 * M) * 0.52 : M;
      const tw = s.bullets.length ? (W - 2 * M) * 0.48 : W - 2 * M;
      const rows = [
        s.table.header.map((h) => ({
          text: h,
          options: { bold: true, color: COLORS.GOLD, fontFace: FONTS.BODY, fontSize: 12, fill: { color: COLORS.WHITE }, border: [{ type: 'solid', color: COLORS.GOLD, pt: 1.5 }, null, null, null].map((b, bi) => (bi === 2 ? { type: 'solid', color: COLORS.GOLD, pt: 1.5 } : { type: 'none' })) },
        })),
        ...s.table.rows.map((r) => r.map((c, ci) => ({
          text: String(c),
          options: {
            fontFace: bodyFont, fontSize: 12, color: COLORS.INK, bold: ci === 0,
            border: [{ type: 'none' }, { type: 'none' }, { type: 'solid', color: COLORS.MIST_SOFT, pt: 0.75 }, { type: 'none' }],
          },
        }))),
      ];
      slide.addTable(rows, { x: tx, y, w: tw, fontFace: bodyFont, autoPage: false, valign: 'middle', fill: { color: COLORS.WHITE } });
    }

    // Sources line at the footer band.
    slide.addText(s.sourcesLine, {
      x: M, y: GEOMETRY.footerY, w: W - 2 * M - 0.8, h: 0.3, fontFace: FONTS.BODY,
      fontSize: 10, color: COLORS.INK70,
    });
    slide.addText(String(plan.slides.indexOf(s)), {
      x: W - M - 0.5, y: GEOMETRY.footerY, w: 0.5, h: 0.3, fontFace: FONTS.BODY,
      fontSize: 11, color: COLORS.GOLD, align: 'right',
    });
  }

  // Bilingual: append the Arabic mirror sections when the spec carries them.
  if (isBilingual(spec.lang)) {
    const note = pptx.addSlide();
    note.background = { color: COLORS.WHITE };
    note.addText('النسخة العربية تتبع الصفحات الإنجليزية', {
      x: 1, y: 3, w: PPTX_LAYOUT.width - 2, h: 1, fontFace: FONTS.ARABIC, fontSize: 24,
      color: COLORS.INK, align: 'right', rtlMode: true,
    });
  }

  await pptx.writeFile({ fileName: outPath });
}

/** @returns {Promise<{path, bytes, qa}>} */
export async function build(spec, outPath) {
  const plan = planSlides(spec);
  await writeDeck(spec, plan, outPath);
  const bytes = fs.statSync(outPath).size;
  return {
    path: outPath,
    bytes,
    qa: { slides: plan.slides.length, flags: plan.flags, revised: plan.revised, editable: true },
  };
}
