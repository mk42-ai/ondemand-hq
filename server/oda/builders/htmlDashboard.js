// htmlDashboard.js — self-contained interactive HTML dashboard (Phase 4 §5).
// ONE file, ZERO external network dependencies: inline CSS with ODA tokens,
// vanilla-JS tabs, CSS-only tooltips, hand-rolled inline-SVG bar charts (no
// chart lib, no CDN, no webfont <link> — local font stacks with fallbacks).
// QA asserts self-containment (no http(s) refs in script/link/img), size cap,
// and tab/panel parity.
import fs from 'node:fs';
import { COLORS, FONTS, sourcesLine } from './theme.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function num(raw) {
  const c = String(raw ?? '').replace(/[^0-9.-]/g, '');
  const n = parseFloat(c);
  return Number.isFinite(n) ? n : NaN;
}

/** Inline SVG horizontal bar chart for a table's first numeric column. */
function svgBar(table) {
  if (!table) return { svg: '', drawn: false };
  const colIdx = table.header.findIndex((_, i) => i > 0 && table.rows.filter((r) => Number.isFinite(num(r[i]))).length >= Math.max(2, table.rows.length * 0.6));
  if (colIdx < 1) return { svg: '', drawn: false };
  const data = table.rows
    .map((r) => ({ label: r[0], v: num(r[colIdx]) }))
    .filter((d) => Number.isFinite(d.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  if (data.length < 2) return { svg: '', drawn: false };
  const max = Math.max(...data.map((d) => d.v)) || 1;
  const rowH = 30; const chartW = 640; const labelW = 170; const H = data.length * rowH + 24;
  let bars = '';
  data.forEach((d, i) => {
    const w = Math.max(2, Math.round((d.v / max) * (chartW - labelW - 90)));
    const y = 12 + i * rowH;
    bars += `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end" font-size="12" fill="#${COLORS.INK70}" font-family="Montserrat, sans-serif">${esc(String(d.label).slice(0, 24))}</text>`;
    bars += `<rect x="${labelW}" y="${y + 3}" width="${w}" height="16" rx="2" fill="#${COLORS.GOLD}"></rect>`;
    bars += `<text x="${labelW + w + 6}" y="${y + 15}" font-size="12" fill="#${COLORS.INK}" font-family="Montserrat, sans-serif">${esc(String(d.v))}</text>`;
  });
  return {
    svg: `<svg viewBox="0 0 ${chartW} ${H}" role="img" aria-label="${esc(table.header[colIdx])} by ${esc(table.header[0])}" style="width:100%;max-width:${chartW}px">${bars}</svg>`,
    drawn: true,
  };
}

function tableHtml(t) {
  if (!t) return '';
  return `<table><thead><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="first"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** @returns {Promise<{path, bytes, qa}>} */
export async function build(spec, outPath) {
  const tabs = spec.sections.map((s, i) => ({ id: `t${i}`, label: s.heading.slice(0, 28), sec: s }));
  let svgCharts = 0;

  const panels = tabs.map((t, i) => {
    const s = t.sec;
    const bar = svgBar(s.table);
    if (bar.drawn) svgCharts++;
    return `<section class="panel${i === 0 ? ' active' : ''}" id="${t.id}" role="tabpanel">
      <h2>${esc(s.heading)}</h2>
      ${s.bigNumbers?.length ? `<div class="nums">${s.bigNumbers.map((bn) => `<div class="num" data-tip="${esc(bn.context || bn.label)}"><div class="v">${esc(bn.value)}</div><div class="l">${esc(bn.label)}</div></div>`).join('')}</div>` : ''}
      ${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
      ${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${bar.svg}
      ${tableHtml(s.table)}
      <div class="src">${esc(sourcesLine(s.sources))}</div>
    </section>`;
  });

  // Sources + gaps tabs.
  tabs.push({ id: 'tsrc', label: 'Sources' });
  panels.push(`<section class="panel" id="tsrc" role="tabpanel"><h2>Sources</h2>${spec.citations?.length ? `<ul>${spec.citations.map((c) => `<li>${esc(c.name)}${c.url ? ` — <span class="url">${esc(c.url)}</span>` : ''}</li>`).join('')}</ul>` : '<p>No external citations — content from the internal brief.</p>'}</section>`);
  if (spec.gaps?.length) {
    tabs.push({ id: 'tgap', label: 'Gaps' });
    panels.push(`<section class="panel" id="tgap" role="tabpanel"><h2>Verification gaps</h2><ul>${spec.gaps.map((g) => `<li class="gap">${esc(g)}</li>`).join('')}</ul></section>`);
  }

  const html = `<!doctype html>
<html lang="${spec.lang === 'ar' ? 'ar' : 'en'}"${spec.lang === 'ar' ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title)}</title>
<style>
:root{--ink:#${COLORS.INK};--gold:#${COLORS.GOLD};--cream:#${COLORS.CREAM};--mist:#${COLORS.MIST};--mist-soft:#${COLORS.MIST_SOFT};--ink70:#${COLORS.INK70}}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:${FONTS.BODY_STACK.replace(/'/g, '')};font-size:14px;line-height:1.6}
[lang=ar],[dir=rtl] body{font-family:${FONTS.ARABIC_STACK.replace(/'/g, '')}}
header{padding:26px 34px 18px;border-bottom:1px solid var(--mist-soft)}
header .k{font:600 10.5px ${FONTS.BODY_STACK.replace(/'/g, '')};letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
h1{font-family:${FONTS.TITLE_STACK.replace(/'/g, '')};font-weight:600;font-size:26px;margin:6px 0 2px}
h2{font-family:${FONTS.TITLE_STACK.replace(/'/g, '')};font-weight:600;font-size:18px;margin:0 0 12px}
.sub{color:var(--ink70);font-size:13px}
nav{display:flex;gap:4px;padding:0 34px;border-bottom:1px solid var(--mist-soft);overflow-x:auto}
nav button{appearance:none;border:0;background:none;padding:12px 14px;font:600 12.5px ${FONTS.BODY_STACK.replace(/'/g, '')};color:var(--ink70);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
nav button.active{color:var(--ink);border-bottom-color:var(--gold)}
main{padding:24px 34px;max-width:1080px}
.panel{display:none}.panel.active{display:block}
.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:0 0 18px}
.num{background:#fff;border:1px solid var(--mist-soft);border-radius:10px;padding:14px;position:relative;cursor:default}
.num .v{font-family:${FONTS.TITLE_STACK.replace(/'/g, '')};font-weight:600;font-size:30px;color:var(--gold)}
.num .l{font-size:12px;color:var(--ink70);margin-top:2px}
[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:0;bottom:calc(100% + 6px);background:var(--ink);color:#fff;font-size:11.5px;padding:6px 9px;border-radius:6px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;z-index:5}
table{width:100%;border-collapse:collapse;margin:14px 0}
th{font:600 11.5px ${FONTS.BODY_STACK.replace(/'/g, '')};letter-spacing:.06em;text-transform:uppercase;color:var(--gold);text-align:left;padding:8px 10px;border-bottom:1.5px solid var(--gold)}
[dir=rtl] th{text-align:right}
td{padding:8px 10px;border-bottom:1px solid var(--mist-soft);font-size:13px}
td.first{font-weight:600}
ul{padding-left:20px}[dir=rtl] ul{padding-right:20px;padding-left:0}
li{margin:5px 0}
li.gap{border-left:3px solid var(--gold);padding-left:10px;list-style:none;margin-left:-14px;color:var(--ink70)}
.src{font-size:11.5px;color:var(--ink70);margin-top:14px;border-top:1px solid var(--mist-soft);padding-top:8px}
.url{color:var(--ink70);word-break:break-all}
svg{margin:10px 0}
footer{padding:16px 34px;border-top:1px solid var(--mist-soft);color:var(--ink70);font-size:11.5px}
@media(max-width:640px){header,main,nav,footer{padding-left:16px;padding-right:16px}}
</style>
</head>
<body>
<header><div class="k">Office of Development Affairs</div><h1>${esc(spec.title)}</h1><div class="sub">${esc(spec.subtitle || 'Interactive briefing dashboard')} · ${esc(spec.date || '')}</div></header>
<nav role="tablist">${tabs.map((t, i) => `<button role="tab" data-t="${t.id}"${i === 0 ? ' class="active"' : ''}>${esc(t.label)}</button>`).join('')}</nav>
<main>${panels.join('\n')}</main>
<footer>Prepared by the ODA Productivity Suite · every figure sourced or flagged</footer>
<script>
document.querySelector('nav').addEventListener('click',function(e){
  var b=e.target.closest('button[data-t]'); if(!b) return;
  document.querySelectorAll('nav button').forEach(function(x){x.classList.toggle('active',x===b)});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active',p.id===b.dataset.t)});
});
</script>
</body></html>`;

  fs.writeFileSync(outPath, html, 'utf8');
  const bytes = fs.statSync(outPath).size;

  // QA: self-containment — no external refs in script/link/img (the .url spans
  // in the Sources tab are plain text, not loads); size; tab/panel parity.
  const externalLoads = (html.match(/<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']https?:\/\//gi) || []).length;
  const flags = [];
  if (externalLoads > 0) flags.push(`QA-FAIL: ${externalLoads} external resource loads`);
  if (bytes > 400 * 1024) flags.push('QA-WARN: file exceeds 400KB');
  const panelCount = (html.match(/class="panel/g) || []).length;
  if (panelCount !== tabs.length) flags.push('QA-FAIL: tab/panel mismatch');

  return {
    path: outPath,
    bytes,
    qa: { tabs: tabs.length, svgCharts, selfContained: externalLoads === 0, flags },
  };
}
