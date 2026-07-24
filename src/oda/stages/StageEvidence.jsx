// StageEvidence.jsx — evidence board (Phase 3).
// A card grid of run.evidence items with fact/assumption/web tag chips and
// source lines, plus a live "gathering evidence" row while the current
// research node is running. Any open gate renders at the top of the board.
import React from 'react';
import GateCard from '../GateCard';

const TAG_CLASS = {
  fact: 'oda-tag--fact',
  assumption: 'oda-tag--assumption',
  web: 'oda-tag--web',
};

export default function StageEvidence({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const evidence = run?.evidence || [];
  const currentNodeId = run?.currentNodeId;
  const isGathering = currentNodeId && run?.nodeStates?.[currentNodeId]?.status === 'running';

  return (
    <div className="oda-card">
      <div className="oda-kicker">Evidence board</div>

      {gate && (
        <div style={{ marginBottom: 16 }}>
          <GateCard gate={gate} onResolve={onResolveGate} />
        </div>
      )}

      <div className="oda-h">{evidence.length} verified evidence items</div>

      {isGathering && (
        <div className="oda-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="oda-spin" aria-hidden />
          <span>Gathering evidence</span>
        </div>
      )}

      {evidence.length === 0 ? (
        <div className="oda-empty">No evidence gathered yet</div>
      ) : (
        <div className="oda-cardgrid">
          {evidence.map((item) => {
            const tagClass = TAG_CLASS[item.tag] || '';
            return (
              <div key={item.id} className="oda-card">
                <div>{item.claim}</div>
                {item.tag && <span className={`oda-pill ${tagClass}`}>{item.tag}</span>}
                {item.source && <div className="oda-src">{item.source}</div>}
                <div className="oda-muted">
                  {[item.addedBy, item.nodeId].filter(Boolean).join(' · ')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
