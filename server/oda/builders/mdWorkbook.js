// mdWorkbook.js — markdown analytical workbook (Phase 4 §6).
// Canonical ODA workbook shape: status header → Bottom-line blockquote →
// numbered sections (clean GFM) → Citations → Verification gaps. QA flags any
// section that ships without a sources line (no-invent traceability).
import fs from 'node:fs';
import { sourcesLine } from './theme.js';

/** @returns {Promise<{path, bytes, qa}>} */
export async function build(spec, outPath) {
  const lines = [];
  const flags = [];
  let sourceLines = 0;

  lines.push(`# ${spec.title}`);
  lines.push('');
  lines.push(`> **Status** · Generated ${spec.date || new Date().toISOString().slice(0, 10)} · Language: ${spec.lang.toUpperCase()} · ODA Productivity Suite`);
  lines.push('');

  // Bottom-line box: the first section's first paragraph leads the workbook.
  const lead = spec.sections[0];
  if (lead?.paragraphs?.length) {
    lines.push(`> **Bottom line** — ${lead.paragraphs[0]}`);
    lines.push('');
  }

  spec.sections.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.heading}`);
    lines.push('');
    for (const bn of s.bigNumbers || []) {
      lines.push(`**${bn.label}:** ${bn.value}${bn.context ? ` — ${bn.context}` : ''}`);
    }
    if ((s.bigNumbers || []).length) lines.push('');
    for (const p of s.paragraphs) { lines.push(p); lines.push(''); }
    for (const b of s.bullets) lines.push(`- ${b}`);
    if (s.bullets.length) lines.push('');
    if (s.table) {
      lines.push(`| ${s.table.header.join(' | ')} |`);
      lines.push(`|${s.table.header.map(() => '---').join('|')}|`);
      for (const r of s.table.rows) lines.push(`| ${r.join(' | ')} |`);
      lines.push('');
    }
    if (s.sources?.length) {
      lines.push(`Sources: ${s.sources.map((x) => (x.url ? `[${x.name}](${x.url})` : x.name)).join('; ')}`);
      sourceLines++;
    } else {
      lines.push('Sources: internal brief');
      flags.push(`section ${i + 1} "${s.heading}" has no external sources`);
      sourceLines++;
    }
    lines.push('');
  });

  lines.push('## Citations');
  lines.push('');
  if (spec.citations?.length) {
    for (const c of spec.citations) lines.push(`- ${c.url ? `[${c.name}](${c.url})` : c.name}${c.note ? ` — ${c.note}` : ''}`);
  } else {
    lines.push('- No external citations — content derives from the internal brief');
  }
  lines.push('');
  lines.push('## Verification gaps');
  lines.push('');
  if (spec.gaps?.length) {
    for (const g of spec.gaps) lines.push(`- ${g}`);
  } else {
    lines.push('- None declared');
  }
  lines.push('');

  const text = lines.join('\n');
  fs.writeFileSync(outPath, text, 'utf8');
  return {
    path: outPath,
    bytes: Buffer.byteLength(text),
    qa: { sections: spec.sections.length, sourceLines, flags },
  };
}
