// StageModel.jsx — quantitative model preview + sensitivity (Phase 3).
// Assumptions-first: the assumptions table renders at the top, then the
// Low/Base/High scenario cards, then a sensitivity chart when the artifact
// carries a sensitivity table. Gates (model_structure / Low-Base-High
// assumptions) render in-context beneath the section they govern. Only real
// artifact/run state is shown — no simulated numbers.
import React from 'react';
import ReactECharts from 'echarts-for-react';
import GateCard from '../GateCard.jsx';
import { parseMdStructure } from '../md.js';

const AXIS = '#5B6770';
const SPLIT = '#E5EDF2';
const FONT = 'Montserrat, sans-serif';

function num(raw) {
  const c = String(raw ?? '').replace(/[^0-9.-]/g, '');
  const n = parseFloat(c);
  return Number.isFinite(n) ? n : NaN;
}

function MdTable({ table }) {
  if (!table?.rows?.length) return null;
  const [head, ...rows] = table.rows;
  return (
    <table className="oda-table">
      <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default function StageModel({ run, gate, artifact, artifactContent, onResolveGate }) {
  const md = artifactContent?.content || artifact?.preview || '';
  const doc = parseMdStructure(md);
  const running = ['executing', 'verifying', 'revising'].includes(run.status);

  const assumptionSecs = doc.sections.filter((s) => /assumption/i.test(s.heading));
  const scenarioSecs = doc.sections.filter((s) => /\b(low|base|high|scenario)\b/i.test(s.heading) && !/assumption/i.test(s.heading));
  const sensitivitySecs = doc.sections.filter((s) => /sensitivit|tornado/i.test(s.heading));
  const otherSecs = doc.sections.filter((s) => !assumptionSecs.includes(s) && !scenarioSecs.includes(s) && !sensitivitySecs.includes(s));

  const structureGate = gate && gate.gateType === 'model_structure' ? gate : null;
  const assumptionsGate = gate && gate.gateType === 'assumptions_low_base_high' ? gate : null;
  const otherGate = gate && !structureGate && !assumptionsGate ? gate : null;

  // Sensitivity chart: first sensitivity table with a numeric column → tornado bars.
  let sensChart = null;
  for (const s of sensitivitySecs) {
    const t = s.tables[0];
    if (!t || t.rows.length < 2) continue;
    const [head, ...rows] = t.rows;
    const lowIdx = head.findIndex((h) => /low|min|-|down/i.test(h));
    const highIdx = head.findIndex((h) => /high|max|\+|up/i.test(h));
    const valIdx = head.findIndex((h, i) => i > 0 && rows.some((r) => Number.isFinite(num(r[i]))));
    const labels = rows.map((r) => r[0]).reverse();
    if (lowIdx > 0 && highIdx > 0) {
      sensChart = {
        grid: { left: 130, right: 30, top: 10, bottom: 26 },
        xAxis: { type: 'value', axisLabel: { color: AXIS, fontFamily: FONT, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
        yAxis: { type: 'category', data: labels, axisLabel: { color: AXIS, fontFamily: FONT, fontSize: 11 } },
        series: [
          { name: head[lowIdx], type: 'bar', stack: 's', data: rows.map((r) => num(r[lowIdx])).reverse(), itemStyle: { color: '#CBDCE6' } },
          { name: head[highIdx], type: 'bar', stack: 's', data: rows.map((r) => num(r[highIdx])).reverse(), itemStyle: { color: '#AD833B' } },
        ],
        legend: { bottom: 0, textStyle: { color: AXIS, fontFamily: FONT, fontSize: 11 } },
        backgroundColor: 'transparent',
      };
      break;
    }
    if (valIdx > 0) {
      sensChart = {
        grid: { left: 130, right: 30, top: 10, bottom: 10 },
        xAxis: { type: 'value', axisLabel: { color: AXIS, fontFamily: FONT, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
        yAxis: { type: 'category', data: labels, axisLabel: { color: AXIS, fontFamily: FONT, fontSize: 11 } },
        series: [{ type: 'bar', data: rows.map((r) => num(r[valIdx])).reverse(), itemStyle: { color: '#AD833B' }, barMaxWidth: 18 }],
        backgroundColor: 'transparent',
      };
      break;
    }
  }

  if (!md && running) {
    return <div className="oda-empty"><span className="oda-spin" /> Building the model…</div>;
  }
  if (!md) return <div className="oda-empty">No model artifact yet</div>;

  return (
    <div>
      {otherGate && <GateCard gate={otherGate} onResolve={onResolveGate} allowEdits />}

      <div className="oda-kicker" style={{ marginBottom: 8 }}>Assumptions first</div>
      {assumptionSecs.length === 0 && run.assumptions.length > 0 && (
        <div className="oda-card" style={{ marginBottom: 14 }}>
          <table className="oda-table"><tbody>
            {run.assumptions.slice(0, 10).map((a, i) => (
              <tr key={i}><td style={{ width: 30 }}>{i + 1}</td><td>{a}</td><td><span className="oda-pill">stated</span></td></tr>
            ))}
          </tbody></table>
        </div>
      )}
      {assumptionSecs.map((s, i) => (
        <div className="oda-card" key={i} style={{ marginBottom: 14 }}>
          <h3 className="oda-h" style={{ fontSize: 15.5, margin: '0 0 8px' }}>{s.heading}</h3>
          {s.tables.map((t, j) => <MdTable table={t} key={j} />)}
          {s.bullets.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{s.bullets.map((b, j) => <li key={j} style={{ fontSize: 13, margin: '3px 0' }}>{b}</li>)}</ul>}
        </div>
      ))}
      {(structureGate || assumptionsGate) && (
        <GateCard gate={structureGate || assumptionsGate} onResolve={onResolveGate} allowEdits editLabel="Edit structure/assumptions" />
      )}

      {scenarioSecs.length > 0 && (
        <>
          <div className="oda-kicker" style={{ margin: '18px 0 8px' }}>Scenarios</div>
          <div className="oda-cardgrid">
            {scenarioSecs.map((s, i) => (
              <div className={`oda-card${/base/i.test(s.heading) ? ' oda-card--gold' : ''}`} key={i}>
                <div className="oda-kicker">{s.heading}</div>
                {s.lines.slice(0, 2).map((l, j) => <p key={j} style={{ fontSize: 13, margin: '6px 0 0' }}>{l}</p>)}
                {s.bullets.slice(0, 4).map((b, j) => <div key={j} style={{ fontSize: 12.5, margin: '4px 0', color: '#5B6770' }}>• {b}</div>)}
                {s.tables.map((t, j) => <MdTable table={t} key={j} />)}
              </div>
            ))}
          </div>
        </>
      )}

      {(sensChart || sensitivitySecs.length > 0) && (
        <>
          <div className="oda-kicker" style={{ margin: '18px 0 8px' }}>Sensitivity</div>
          <div className="oda-card">
            {sensChart && <ReactECharts option={sensChart} style={{ height: 240 }} notMerge lazyUpdate />}
            {sensitivitySecs.map((s, i) => (
              <div key={i}>
                {!sensChart && s.tables.map((t, j) => <MdTable table={t} key={j} />)}
                {s.bullets.map((b, j) => <div key={j} style={{ fontSize: 12.5, margin: '4px 0', color: '#5B6770' }}>• {b}</div>)}
              </div>
            ))}
          </div>
        </>
      )}

      {otherSecs.slice(0, 4).map((s, i) => (
        <div className="oda-card" key={i} style={{ marginTop: 14 }}>
          <h3 className="oda-h" style={{ fontSize: 15, margin: '0 0 8px' }}>{s.heading}</h3>
          {s.lines.slice(0, 3).map((l, j) => <p key={j} style={{ fontSize: 13.5, margin: '4px 0' }}>{l}</p>)}
          {s.tables.map((t, j) => <MdTable table={t} key={j} />)}
        </div>
      ))}

      {/[=]\w+\(/.test(md) && <div className="oda-muted" style={{ marginTop: 10, fontSize: 12 }}>Live formulas ship in the XLSX artifact</div>}
    </div>
  );
}
