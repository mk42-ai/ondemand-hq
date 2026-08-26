// htmlToMd.js — dependency-free HTML → markdown preprocessor for the builders.
// The `design` skill sometimes authors a full HTML deck (<!DOCTYPE html>…),
// but parseContentSpec understands MARKDOWN — so without this, raw tags like
// "<!DOCTYPE html>" render as body text on a slide (observed 2026-07-24).
// This flattens the common deck/document HTML into the markdown the parser
// expects: headings → #/##, list items → bullets, images → ![](), tables →
// pipe rows, anchors → [text](url) (so sources survive). Best-effort and never
// throws — an unconvertible fragment simply loses its tags.

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', deg: '°', times: '×', euro: '€',
  pound: '£', copy: '©', reg: '®', trade: '™',
});

/** Decode HTML entities (named + numeric, decimal and hex). */
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip inline tags and collapse whitespace from an element's inner HTML. */
const cleanInline = (t) => decodeEntities(String(t).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Heuristic: does this string look like an HTML document/fragment rather than
 * markdown? True on a doctype/<html>, or ≥3 block-level tags.
 */
export function looksLikeHtml(s) {
  const str = String(s || '');
  if (/<!doctype html|<html[\s>]/i.test(str)) return true;
  const blocks = str.match(/<\/?(?:div|section|article|header|footer|main|h[1-6]|p|ul|ol|li|table|tr|td|th|img|span|body)\b/gi) || [];
  return blocks.length >= 3;
}

/**
 * Convert HTML into markdown the ODA content-spec parser understands.
 * @param {string} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  let s = String(html || '');

  // 1) Drop non-content regions and the doctype outright.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<!doctype[^>]*>/gi, '');
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, '');
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');

  // 2) Anchors → [text](url) so citation/source links survive the flattening.
  s = s.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (m, href, txt) => { const t = cleanInline(txt); return t ? `[${t}](${href})` : ''; });

  // 3) Images → ![alt](url) (attribute order tolerant).
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    const alt = (tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    return src ? `\n![${cleanInline(alt)}](${src})\n` : '';
  });

  // 4) Tables → pipe rows (one row per <tr>, cells from <td>/<th>).
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (m, inner) => {
    const cells = [];
    inner.replace(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi, (mm, c) => { cells.push(cleanInline(c) || ' '); return ''; });
    return cells.length ? `\n| ${cells.join(' | ')} |` : '';
  });

  // 5) Headings, list items, paragraph/section breaks.
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (m, t) => `\n\n# ${cleanInline(t)}\n`);
  s = s.replace(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi, (m, t) => `\n\n## ${cleanInline(t)}\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (m, t) => `\n- ${cleanInline(t)}`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|header|footer|main|ul|ol|blockquote|figure|figcaption)>/gi, '\n\n');

  // 6) Strip every remaining tag, decode entities, tidy whitespace.
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  return s.trim();
}

export default { looksLikeHtml, htmlToMarkdown };
