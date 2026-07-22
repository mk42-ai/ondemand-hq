// StageCountry.jsx — country profile / data dashboard (Phase 3).
// Visualises the data-scout artifact: headline big-number cards, every
// markdown table, an optional horizontal bar chart for tables with two or
// more numeric columns, and the source links cited in the content. Renders
// only real artifact content — no simulated data.
import React from 'react';
import ReactECharts from 'echarts-for-react';
import { parseMdStructure } from '../md';

const RUNNING = ['interpreting', 'planning', 'executing', 'verifying', 'revising'];
const AXIS_COLOR = '#5B6770';
const SPLIT_LINE = '#E5EDF2';
const FONT_FAMILY = 'Montserrat, sans-serif';

function parseNumber(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return NaN;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseLabelValue(bullet) {
  const m = String(bullet || '').match(/^\*{0,2}([^:]{1,60}):\*{0,2}\s*(.+)$/);
  if (!m) return null;
  return { label: m[1].replace(/\*/g, '').trim(), value: m[2].replace(/\*/g, '').trim() };
}

function extractLinks(md) {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(String(md || '')))) {
    if (!seen.has(m[2])) { seen.add(m[2]); out.push({ label: m[1], url: m[2] }); }
  }
  return out;
}

/** A table qualifies for a chart when ≥2 of its columns are mostly numeric. */
function analyseTable(table) {
  if (!table || !table.rows || table.rows.length < 2) return null;
  const [header, ...body] = table.rows;
  const numericCols = [];
  header.forEach((_, c) => {
    const vals = body.map((r) => parseNumber(r[c]));
    const finite = vals.filter((v) => Number.isFinite(v)).length;
    if (finite > 0 && finite >= Math.ceil(body.length * 0.6)) numericCols.push(c);
  });
  if (numericCols.length < 2) return null;
  const valueCol = numericCols[0];
  const labelCol = header.findIndex((_, c) => !numericCols.includes(c));
  const safeLabelCol = labelCol === -1 ? 0 : labelCol;
  const rows = body
    .map((r) => ({ label: r[safeLabelCol] || '—', value: parseNumber(r[valueCol]) }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (!rows.length) return null;
  return { rows, metric: header[valueCol] };
}

function barOption(rows, metric) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT_FAMILY, color: AXIS_COLOR },
    grid: { left: 120, right: 28, top: 12, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      name: metric || undefined,
      axisLabel: { color: AXIS_COLOR },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => r.label),
      axisLabel: { color: AXIS_COLOR },
      axisLine: { lineStyle: { color: SPLIT_LINE } },
    },
    series: [{ type: 'bar', data: rows.map((r) => r.value), itemStyle: { color: '#AD833B' }, barMaxWidth: 18 }],
  };
}

export default function StageCountry({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const running = RUNNING.includes(run?.status);
  const content = artifactContent?.content;

  if (!content) {
    return (
      <div className="oda-card">
        <div className="oda-kicker">Country data</div>
        <div className="oda-h">{artifact?.logicalId || 'Country profile'}</div>
        <div className="oda-empty">
          Fetching sourced data…
          {running && <div className="oda-spin" aria-hidden="true" />}
        </div>
      </div>
    );
  }

  const structure = parseMdStructure(content);
  const headlineNumbers = structure.sections
    .filter((s) => /headline|fast facts|identity/i.test(s.heading))
    .flatMap((s) => s.bullets.map(parseLabelValue))
    .filter(Boolean);
  const allTables = structure.sections.flatMap((s) => s.tables.map((t) => ({ table: t, heading: s.heading })));
  const links = extractLinks(content);

  return (
    <div className="oda-card">
      <div className="oda-kicker">Country data</div>
      <div className="oda-h">{structure.title || artifact?.logicalId || 'Country profile'}</div>

      {headlineNumbers.length > 0 && (
        <div className="oda-cardgrid">
          {headlineNumbers.map((n, i) => (
            <div className="oda-num" key={i}>
              <div className="oda-muted">{n.label}</div>
              <div>{n.value}</div>
            </div>
          ))}
        </div>
      )}

      {allTables.length === 0 && headlineNumbers.length === 0 && (
        <div className="oda-empty">No structured data parsed from this artifact yet.</div>
      )}

      {allTables.map(({ table, heading }, i) => {
        const chart = analyseTable(table);
        return (
          <div key={i} style={{ marginTop: 18 }}>
            {heading && <div className="oda-sub">{heading}</div>}
            <table className="oda-table">
              <thead>
                <tr>{table.rows[0].map((c, ci) => <th key={ci}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.slice(1).map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {chart && (
              <div style={{ marginTop: 10 }}>
                <ReactECharts option={barOption(chart.rows, chart.metric)} style={{ height: 260 }} notMerge />
              </div>
            )}
          </div>
        );
      })}

      {links.length > 0 && (
        <div className="oda-cardgrid" style={{ marginTop: 18 }}>
          {links.map((l, i) => (
            <a key={i} className="oda-src" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
          ))}
        </div>
      )}
    </div>
  );
}
