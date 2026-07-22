// StageUnderstanding.jsx — request-understanding canvas (Phase 3).
// Shows how the ODA interpreter read the user's request: the safe-status
// line while interpreting/planning, then the resolved intent, mode, primary
// skill, confidence and deliverables once run.control lands. Renders any
// pre-execution scope_edit gate beneath, in context.
import React from 'react';
import GateCard from '../GateCard';

/** First defined, non-empty value among the given keys of obj. */
function pick(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Format a confidence value (0–1 or 0–100) as a rounded percentage string. */
function formatConfidence(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  const pct = v <= 1 ? v * 100 : v;
  return `${Math.round(pct)}%`;
}

export default function StageUnderstanding({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const control = run?.control || null;
  const status = run?.status;
  const isThinking = status === 'interpreting' || status === 'planning';

  const requestText = pick(control, ['request', 'originalRequest', 'original_request', 'text']);
  const intentSentence = pick(control, ['intent', 'intentSummary', 'intent_summary', 'summary']) || run?.intent;
  const mode = run?.mode || pick(control, ['mode']);
  const primarySkill = pick(control, ['primarySkill', 'primary_skill', 'skill']);
  const confidence = formatConfidence(pick(control, ['confidence', 'confidenceScore', 'confidence_score']));
  const deliverables = pick(control, ['deliverables', 'expectedDeliverables', 'expected_deliverables']) || [];
  const source = pick(control, ['source', 'interpreterSource', 'interpreter_source', 'notes']);

  return (
    <div className="oda-card">
      <div className="oda-kicker">Request understanding</div>
      {requestText && <div className="oda-h">{requestText}</div>}

      <div className="oda-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isThinking && <span className="oda-spin" aria-hidden />}
        <span>
          {run?.safeStatus || (isThinking ? 'Interpreting the request…' : control ? 'Request understood' : 'Waiting for the request…')}
        </span>
      </div>

      {control ? (
        <>
          {intentSentence && <p className="oda-sub">{intentSentence}</p>}

          <div className="oda-cardgrid" style={{ marginTop: 12 }}>
            {mode && <span className="oda-pill">{String(mode).toUpperCase()}</span>}
            {primarySkill && <span className="oda-pill">{primarySkill}</span>}
            {confidence && <span className="oda-pill">Confidence {confidence}</span>}
          </div>

          {deliverables.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="oda-muted">Deliverables</div>
              <div className="oda-cardgrid">
                {deliverables.map((d, i) => (
                  <span key={i} className="oda-pill">{typeof d === 'string' ? d : (d?.name || d?.type || JSON.stringify(d))}</span>
                ))}
              </div>
            </div>
          )}

          {source && <div className="oda-muted" style={{ marginTop: 12 }}>Interpreter source: {source}</div>}
        </>
      ) : (
        !isThinking && <div className="oda-empty">Waiting to interpret the request…</div>
      )}

      {gate && (
        <div style={{ marginTop: 16 }}>
          <GateCard gate={gate} onResolve={onResolveGate} allowEdits />
        </div>
      )}
    </div>
  );
}
