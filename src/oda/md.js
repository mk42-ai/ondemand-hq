// md.js — shared markdown → sanitised HTML helper for ODA workspace renderers.
// Wraps the repo's existing marked + dompurify deps; every stage renderer uses
// THIS helper (never raw dangerouslySetInnerHTML on unsanitised strings).
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

/** Render markdown to sanitised HTML (links open in a new tab). */
export function mdToHtml(mdText) {
  const raw = marked.parse(String(mdText || ''));
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
  return clean.replaceAll('<a ', '<a target="_blank" rel="noopener noreferrer" ');
}

/** Strip markdown to plain text (for previews/labels). */
export function mdToText(mdText) {
  const html = mdToHtml(mdText);
  const el = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!el) return String(mdText || '');
  el.innerHTML = html;
  return el.textContent || '';
}

/**
 * Lightweight markdown structure parser used by stage renderers to visualise
 * artifact content: returns { title, sections:[{depth, heading, lines, bullets, tables}] }.
 * Defensive — never throws on malformed input.
 */
export function parseMdStructure(mdText) {
  const lines = String(mdText || '').split('\n');
  const out = { title: null, sections: [] };
  let cur = null;
  let table = null;
  const flushTable = () => { if (table && cur) cur.tables.push(table); table = null; };
  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushTable();
      if (h[1].length === 1 && !out.title) { out.title = h[2].trim(); continue; }
      cur = { depth: h[1].length, heading: h[2].trim(), lines: [], bullets: [], tables: [] };
      out.sections.push(cur);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      if (!table) table = { rows: [] };
      table.rows.push(cells);
      continue;
    }
    flushTable();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    if (b) { if (cur) cur.bullets.push(b[1].trim()); continue; }
    if (cur && line.trim()) cur.lines.push(line.trim());
  }
  flushTable();
  return out;
}
