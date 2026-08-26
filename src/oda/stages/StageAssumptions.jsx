// StageAssumptions.jsx — assumption register (Phase 3).
// Tables run.assumptions with a guessed category chip, and — when the
// assumptions_low_base_high gate is open — renders the gate's own
// low/base/high payload as a read-only preview table beside the GateCard.
import React from 'react';
import GateCard from '../GateCard';

const SCENARIO_RE = /\b(low|base|high)\b/i;

function categoryFor(text) {
  return SCENARIO_RE.test(String(text || '')) ? 'scenario' : 'stated';
}

export default function StageAssumptions({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const assumptions = run?.assumptions || [];
  const gateAssumptions = gate?.payload?.assumptions || null;

  return (
    <div className="oda-card">
      <div className="oda-kicker">Assumption register</div>
      <div className="oda-h">Assumptions used in this analysis</div>

      {assumptions.length === 0 ? (
        <div className="oda-empty">No assumptions recorded yet</div>
      ) : (
        <table className="oda-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Assumption</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a, i) => {
              const text = typeof a === 'string' ? a : (a?.text || a?.name || JSON.stringify(a));
              const cat = categoryFor(text);
              return (
                <tr key={i}>
                  <td className="oda-num">{i + 1}</td>
                  <td>{text}</td>
                  <td><span className={`oda-pill${cat === 'scenario' ? ' oda-tag--assumption' : ''}`}>{cat}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {gateAssumptions && gateAssumptions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="oda-sub">Proposed low / base / high scenarios</div>
          <table className="oda-table">
            <thead>
              <tr>
                <th>Assumption</th>
                <th>Low</th>
                <th>Base</th>
                <th>High</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {gateAssumptions.map((row, i) => (
                <tr key={i}>
                  <td>{row.name}</td>
                  <td>{row.low}</td>
                  <td>{row.base}</td>
                  <td>{row.high}</td>
                  <td className="oda-muted">{row.unit || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gate && (
        <div style={{ marginTop: 16 }}>
          <GateCard gate={gate} onResolve={onResolveGate} allowEdits editLabel="Edit assumptions" />
        </div>
      )}
    </div>
  );
}
