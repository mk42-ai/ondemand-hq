// StageBenchmark.jsx — benchmark matrix (Phase 3).
// Renders every markdown table in the benchmark artifact (the first is the
// full comparison matrix), shortlist/longlist sections as a two-column list,
// and implication sections as gold cards. The benchmark_shortlist gate sits
// inside the matrix card, directly under the shortlist table.
import React from 'react';
import { parseMdStructure } from '../md';
import GateCard from '../GateCard';

const SHORTLIST_RE = /shortlist|longlist/i;
const IMPLICATION_RE = /implication/i;

function MdTable({ table }) {
  if (!table || !table.rows.length) return null;
  const [header, ...rows] = table.rows;
  return (
    <table className="oda-table">
      <thead>
        <tr>{header.map((c, i) => <th key={i}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StageBenchmark({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const content = artifactContent?.content || null;
  const running = run?.currentNodeId && run?.nodeStates?.[run.currentNodeId]?.status === 'running';
  const structure = content ? parseMdStructure(content) : null;
  const sections = structure?.sections || [];

  const allTables = [];
  for (const s of sections) for (const t of s.tables) allTables.push({ section: s, table: t });
  const [matrix, ...otherTables] = allTables;

  const shortlistSections = sections.filter((s) => SHORTLIST_RE.test(s.heading));
  const implicationSections = sections.filter((s) => IMPLICATION_RE.test(s.heading));

  return (
    <div className="oda-card">
      <div className="oda-kicker">Benchmark matrix</div>

      {!content ? (
        <div className="oda-empty" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {running && <span className="oda-spin" aria-hidden />}
          <span>Scanning comparable programmes…</span>
        </div>
      ) : (
        <>
          {matrix ? (
            <div style={{ width: '100%' }}>
              <div className="oda-sub">{matrix.section.heading}</div>
              <MdTable table={matrix.table} />
              {gate?.gateType === 'benchmark_shortlist' && (
                <div style={{ marginTop: 16 }}>
                  <GateCard gate={gate} onResolve={onResolveGate} allowEdits editLabel="Edit shortlist" />
                </div>
              )}
            </div>
          ) : (
            <div className="oda-muted">No comparison matrix found in this artifact yet.</div>
          )}

          {gate && gate.gateType !== 'benchmark_shortlist' && (
            <div style={{ marginTop: 16 }}>
              <GateCard gate={gate} onResolve={onResolveGate} allowEdits editLabel="Edit shortlist" />
            </div>
          )}

          {otherTables.length > 0 && otherTables.map(({ section, table }, i) => (
            <div key={i} style={{ marginTop: 16 }}>
              <div className="oda-sub">{section.heading}</div>
              <MdTable table={table} />
            </div>
          ))}

          {shortlistSections.length > 0 && (
            <div className="oda-two" style={{ marginTop: 16 }}>
              {shortlistSections.map((s, i) => (
                <div key={i} className="oda-card">
                  <div className="oda-sub">{s.heading}</div>
                  <ul>
                    {(s.bullets.length ? s.bullets : s.lines).map((item, j) => <li key={j}>{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {implicationSections.map((s, i) => (
            <div key={i} className="oda-card--gold" style={{ marginTop: 16 }}>
              <div className="oda-kicker">{s.heading}</div>
              {(s.bullets.length ? s.bullets : s.lines).map((item, j) => <p key={j}>{item}</p>)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
