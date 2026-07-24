// index.js — Phase 4 artifact builder registry: parseContentSpec (ODA markdown
// artifact → content spec) + buildArtifact dispatcher. See MIGRATION_MAP.md
// M8/M10: verified content artifacts materialise into EDITABLE files (never
// flattened screenshots) through these builders.
import { build as buildPptx } from './pptxBuilder.js';
import { build as buildDocx } from './docxBuilder.js';
import { build as buildXlsx } from './xlsxBuilder.js';
import { build as buildPdf } from './pdfBuilder.js';
import { build as buildHtml } from './htmlDashboard.js';
import { build as buildMd } from './mdWorkbook.js';

const BUILDERS = Object.freeze({
  pptx: buildPptx,
  docx: buildDocx,
  xlsx: buildXlsx,
  pdf: buildPdf,
  html: buildHtml,
  md: buildMd,
});

export function listBuilders() {
  return Object.keys(BUILDERS).map((format) => ({
    format,
    editable: ['pptx', 'docx', 'xlsx'].includes(format),
    qa: true,
  }));
}

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Strip markdown emphasis for plain rendering surfaces. */
const strip = (s) => String(s || '').replace(/\*\*?/g, '').replace(/`/g, '').trim();

/**
 * Parse an ODA markdown artifact into the shared content spec consumed by all
 * builders. Defensive — never throws on malformed input.
 * @returns {{ title, subtitle, date, lang, sections, assumptions, citations, gaps }}
 */
export function parseContentSpec(markdown) {
  const md = String(markdown || '');
  const lines = md.split('\n');
  const spec = { title: null, subtitle: null, date: null, lang: 'en', sections: [], assumptions: [], citations: [], gaps: [] };

  // Language sniff: ≥15% Arabic characters → 'ar'; some Arabic → 'bilingual'.
  const arChars = (md.match(/[\u0600-\u06FF]/g) || []).length;
  const letters = (md.replace(/\s/g, '') || '').length || 1;
  if (arChars / letters > 0.15) spec.lang = 'ar';
  else if (arChars > 40) spec.lang = 'bilingual';

  let cur = null;
  let table = null;
  const flushTable = () => { if (table && cur && table.rows.length > 1) { cur.table = { header: table.rows[0], rows: table.rows.slice(1) }; } table = null; };
  const newSection = (heading) => {
    flushTable();
    cur = { heading: strip(heading), kicker: null, paragraphs: [], bullets: [], table: null, bigNumbers: [], sources: [] };
    spec.sections.push(cur);
  };

  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (h[1].length === 1 && !spec.title) { spec.title = strip(h[2]); continue; }
      newSection(h[2]);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => strip(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
      if (!cur) newSection('Overview');
      if (!table) table = { rows: [] };
      table.rows.push(cells);
      continue;
    }
    flushTable();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    if (b) {
      if (!cur) newSection('Overview');
      cur.bullets.push(strip(b[1]));
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    if (/^>\s*/.test(t)) { if (!cur) newSection('Bottom line'); cur.paragraphs.push(strip(t.replace(/^>\s*/, ''))); continue; }
    // 'Sources: [A](u); [B](u)' lines → section sources.
    if (/^sources?\s*:/i.test(t)) {
      if (!cur) newSection('Overview');
      let m; const re = new RegExp(LINK_RE.source, 'g');
      while ((m = re.exec(t))) cur.sources.push({ name: m[1], url: m[2] });
      if (!cur.sources.length) {
        t.replace(/^sources?\s*:/i, '').split(/[;,]/).map((x) => strip(x)).filter(Boolean)
          .forEach((name) => cur.sources.push({ name }));
      }
      continue;
    }
    if (!cur) newSection('Overview');
    cur.paragraphs.push(strip(t));
  }
  flushTable();

  // Big numbers: bullets shaped 'Label: value' with numeric-ish values, ≥3 per section.
  for (const s of spec.sections) {
    const candidates = [];
    for (const bl of s.bullets) {
      const m = bl.match(/^([^:]{2,48}):\s*(.{1,60})$/);
      if (m && /[\d$€£%]/.test(m[2])) candidates.push({ label: strip(m[1]), value: strip(m[2]) });
    }
    if (candidates.length >= 3) {
      s.bigNumbers = candidates.slice(0, 6);
      const bnSet = new Set(s.bigNumbers.map((x) => `${x.label}: ${x.value}`));
      s.bullets = s.bullets.filter((bl) => !bnSet.has(strip(bl)));
    }
  }

  // Citations: every distinct [Name](url) in the document.
  const seen = new Set();
  let m2; const re2 = new RegExp(LINK_RE.source, 'g');
  while ((m2 = re2.exec(md))) {
    if (!seen.has(m2[2])) { seen.add(m2[2]); spec.citations.push({ name: m2[1], url: m2[2] }); }
  }

  // Gaps: sections titled gap/unverified → their bullets/paragraphs.
  for (const s of spec.sections) {
    if (/gap|unverifi/i.test(s.heading)) spec.gaps.push(...s.bullets, ...s.paragraphs);
  }
  spec.sections = spec.sections.filter((s) => !/gap|unverifi/i.test(s.heading) || (spec.gaps.length === 0));

  if (!spec.title && spec.sections.length) spec.title = spec.sections[0].heading;
  if (!spec.title) spec.title = 'ODA deliverable';
  spec.date = new Date().toISOString().slice(0, 10);
  return spec;
}

/**
 * Build one artifact file.
 * @param {{format: 'pptx'|'docx'|'xlsx'|'pdf'|'html'|'md', spec: object, outPath: string}} p
 * @returns {Promise<{path: string, bytes: number, qa: object}>}
 */
export async function buildArtifact({ format, spec, outPath }) {
  const fn = BUILDERS[format];
  if (!fn) throw new Error(`unknown artifact format "${format}" — known: ${Object.keys(BUILDERS).join(', ')}`);
  return fn(spec, outPath);
}

/** Convenience: build every format for one spec into outDir/baseName.*. */
export async function buildAll(spec, outDir, baseName) {
  const path = await import('node:path');
  const out = [];
  for (const format of Object.keys(BUILDERS)) {
    out.push(await buildArtifact({ format, spec, outPath: path.join(outDir, `${baseName}.${format}`) }));
  }
  return out;
}
