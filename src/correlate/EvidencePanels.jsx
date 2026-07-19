// EvidencePanels.jsx — ECharts side panels + the novel D3 "Evidence-Density Heat Ring".
// All panels cross-filter the graph: clicking a bar/slice/segment calls onFilter().
import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import * as d3 from 'd3';
import { TYPE_COLORS, hexToRgba } from './graphAdapter.js';

const PLATFORM_COLORS = { web: '#2563aa', x: '#111111', instagram: '#c13584', reddit: '#ff4500' };

export default function EvidencePanels({ evidence, run, onFilterPlatform, onFilterDate, activePlatform }) {
  // ---- evidence volume over time (bar) ----
  const byDate = useMemo(() => {
    const m = {};
    for (const e of evidence) { const d = e.publishDate || 'undated'; m[d] = (m[d] || 0) + 1; }
    const keys = Object.keys(m).sort();
    return { keys, vals: keys.map(k => m[k]) };
  }, [evidence]);

  // ---- platform split (donut) ----
  const byPlatform = useMemo(() => {
    const m = {};
    for (const e of evidence) m[e.platform] = (m[e.platform] || 0) + 1;
    return Object.entries(m).map(([name, value]) => ({ name, value, itemStyle: { color: PLATFORM_COLORS[name] || '#888' } }));
  }, [evidence]);

  // ---- confidence/sentiment strip (avg confidence per platform as heat cells) ----
  const strip = useMemo(() => {
    const m = {};
    for (const e of evidence) { (m[e.platform] = m[e.platform] || []).push(e.confidence || 0.5); }
    return Object.entries(m).map(([p, arr]) => ({ platform: p, avg: arr.reduce((a, b) => a + b, 0) / arr.length }));
  }, [evidence]);

  // ---- NOVEL D3 VIZ: Evidence-Density Heat Ring (INNOVATION_LOG #1) ----
  // 24 angular sectors = hours-of-day-agnostic evidence "clock" over the run window;
  // each evidence record lands in a sector by publish-date order; sector radius grows
  // with count, fill heat = avg confidence, stroke = platform color of the densest
  // platform in that sector. Rendered as a pure D3 arc path list inside SVG.
  const ring = useMemo(() => {
    const N = 12;
    const dated = evidence.filter(e => e.publishDate).sort((a, b) => a.publishDate.localeCompare(b.publishDate));
    const sectors = Array.from({ length: N }, () => ({ count: 0, conf: 0, plats: {} }));
    dated.forEach((e, i) => {
      const s = sectors[Math.min(N - 1, Math.floor((i / Math.max(1, dated.length)) * N))];
      s.count++; s.conf += e.confidence || 0.5; s.plats[e.platform] = (s.plats[e.platform] || 0) + 1;
    });
    const arc = d3.arc();
    const maxC = Math.max(1, ...sectors.map(s => s.count));
    return sectors.map((s, i) => {
      const a0 = (i / N) * 2 * Math.PI, a1 = ((i + 1) / N) * 2 * Math.PI - 0.03;
      const r = 26 + 34 * (s.count / maxC);
      const avg = s.count ? s.conf / s.count : 0;
      const top = Object.entries(s.plats).sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        d: arc({ innerRadius: 24, outerRadius: s.count ? r : 25, startAngle: a0, endAngle: a1 }),
        fill: s.count ? d3.interpolateYlGnBu(0.25 + 0.7 * avg) : '#f1f1f0',
        stroke: top ? (PLATFORM_COLORS[top] || '#999') : '#e5e5e3',
        count: s.count,
      };
    });
  }, [evidence]);

  const volOpt = {
    grid: { left: 28, right: 6, top: 8, bottom: 20 }, animationDuration: 300,
    xAxis: { type: 'category', data: byDate.keys, axisLabel: { fontSize: 8, rotate: 40 } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 9 } },
    series: [{ type: 'bar', data: byDate.vals, itemStyle: { color: '#0f6b5c', borderRadius: [3, 3, 0, 0] } }],
    tooltip: { trigger: 'axis' },
  };
  const platOpt = {
    animationDuration: 300,
    series: [{ type: 'pie', radius: ['45%', '72%'], data: byPlatform, label: { fontSize: 10, formatter: '{b} {c}' } }],
    tooltip: { trigger: 'item' },
  };

  return (
    <aside className="corr-panels">
      <div className="corr-panel">
        <h3>Evidence volume</h3>
        <ReactECharts option={volOpt} style={{ height: 120 }} notMerge
          onEvents={{ click: (p) => onFilterDate?.(byDate.keys[p.dataIndex]) }} />
      </div>
      <div className="corr-panel">
        <h3>Platform split {activePlatform && <button className="corr-clearchip" onClick={() => onFilterPlatform(null)}>clear ×</button>}</h3>
        <ReactECharts option={platOpt} style={{ height: 140 }} notMerge
          onEvents={{ click: (p) => onFilterPlatform?.(p.name === activePlatform ? null : p.name) }} />
      </div>
      <div className="corr-panel">
        <h3>Confidence strip</h3>
        <div className="corr-strip">
          {strip.map(s => (
            <button key={s.platform} className="corr-strip__cell" title={`${s.platform}: avg confidence ${s.avg.toFixed(2)}`}
              onClick={() => onFilterPlatform?.(s.platform === activePlatform ? null : s.platform)}
              style={{ background: hexToRgba(PLATFORM_COLORS[s.platform] || '#888888', 0.15 + 0.8 * s.avg) }}>
              {s.platform}<b>{s.avg.toFixed(2)}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="corr-panel">
        <h3>Evidence-density heat ring <span className="corr-novel">D3 · novel</span></h3>
        <svg viewBox="-70 -70 140 140" className="corr-ring" role="img" aria-label="Evidence density heat ring">
          {ring.map((s, i) => <path key={i} d={s.d} fill={s.fill} stroke={s.stroke} strokeWidth="1.2"><title>{s.count} evidence</title></path>)}
          <text x="0" y="3" textAnchor="middle" className="corr-ring__label">{evidence.length}</text>
        </svg>
      </div>
    </aside>
  );
}
