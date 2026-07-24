// theme.js — ODA design system: single source of truth for colour, type and
// geometry tokens shared by every artifact builder (pptx/docx/xlsx/html/md/pdf).
// Plain ES module. See MIGRATION_MAP.md §5 (M8-M10) for the artefact-pipeline
// context this feeds; see contracts.d.ts for the ODAArtifactType this renders.

/** Hex colour tokens (no leading '#' — callers prefix per-library needs). */
export const COLORS = Object.freeze({
  INK: '1D252C',
  GOLD: 'AD833B',
  CREAM: 'F1E7D6',
  MIST: 'CBDCE6',
  MIST_SOFT: 'E5EDF2',
  WHITE: 'FFFFFF',
  INK70: '5B6770',
});

/**
 * Font family tokens.
 * NB: 'Sakkal Majalla' is listed FIRST in Arabic stacks for local/Office
 * fallback rendering; 'Noto Naskh Arabic' is the web/embedded face used when
 * a system does not carry Sakkal Majalla (e.g. non-Windows browsers).
 */
export const FONTS = Object.freeze({
  TITLE: 'Lora',
  BODY: 'Montserrat',
  ARABIC: 'Noto Naskh Arabic',
  ARABIC_STACK: "'Sakkal Majalla', 'Noto Naskh Arabic', serif",
  TITLE_STACK: "'Lora', Georgia, serif",
  BODY_STACK: "'Montserrat', Inter, system-ui, sans-serif",
});

/** Canvas the brand was designed at (1920x1080 px, 96dpi) mapped to inches for pptxgenjs. */
export const CANVAS = Object.freeze({ widthPx: 1920, heightPx: 1080, dpi: 96 });

/** pptxgenjs 16:9 layout definition — 13.333in x 7.5in @ 96dpi matches the 1920x1080 canvas. */
export const PPTX_LAYOUT = Object.freeze({ name: 'ODA_16x9', width: 13.333, height: 7.5 });

/**
 * Shared slide/page geometry (inches) — kept identical across pptx/pdf so the
 * two paginated formats read as siblings of the same brand system.
 */
export const GEOMETRY = Object.freeze({
  marginIn: 0.9,
  titleBandY: 0.35,
  titleBandH: 1.1,
  bodyStartY: 1.9,
  bodyEndY: 7.0,
  footerY: 6.95,
});

/** px -> inch (96dpi) and inch -> EMU (914400 EMU per inch) converters. */
export const pxToIn = (px) => px / CANVAS.dpi;
export const inToEmu = (inches) => Math.round(inches * 914400);
export const emuToIn = (emu) => emu / 914400;

/**
 * Render a "Sources: A; B; C" line from a sources/citations array.
 * Accepts {name,url?} items or plain strings; defensive against nullish input.
 * @param {Array<{name?:string,url?:string}|string>} [sources]
 * @param {string} [fallback] text used when there is nothing to cite
 * @returns {string}
 */
export function sourcesLine(sources, fallback = 'Sources: internal brief') {
  if (!Array.isArray(sources) || sources.length === 0) return fallback;
  const names = sources
    .map((s) => (typeof s === 'string' ? s : s && s.name))
    .filter((n) => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim());
  if (!names.length) return fallback;
  return `Sources: ${names.join('; ')}`;
}

/** Word-boundary safe truncation with an ellipsis, used by QA title/bullet lint. */
export function truncateAtWord(text, maxLen) {
  if (typeof text !== 'string' || text.length <= maxLen) return text;
  const cut = text.slice(0, Math.max(0, maxLen - 1));
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trim()}…`;
}

/** True when the spec/section language calls for right-to-left rendering. */
export function isRtl(lang) {
  return lang === 'ar';
}

/** True when the spec renders both languages (EN section then AR mirror). */
export function isBilingual(lang) {
  return lang === 'bilingual';
}

export default { COLORS, FONTS, CANVAS, PPTX_LAYOUT, GEOMETRY, pxToIn, inToEmu, emuToIn, sourcesLine, truncateAtWord, isRtl, isBilingual };
