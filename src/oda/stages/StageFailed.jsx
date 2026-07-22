// StageFailed.jsx — failed-run canvas (Phase 3).
// Shows the real error, the failed node, and the last events; recovery is via
// the sidebar lifecycle controls (retry re-queues the failed node).
import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function StageFailed({ run }) {
  const failedNode = Object.entries(run.nodeStates || {}).find(([, s]) => s.status === 'failed');
  const lastEvents = (run.events || []).slice(-5);
  return (
    <div className="oda-card oda-card--gold" style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AlertTriangle size={18} color="#A33B2E" aria-hidden />
        <h3 className="oda-h" style={{ fontSize: 16, margin: 0 }}>Run failed</h3>
      </div>
      <p style={{ fontSize: 13.5, margin: '0 0 8px' }}>{run.error || 'The run stopped with an unrecoverable error.'}</p>
      {failedNode && (
        <p className="oda-muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
          Failed stage: <strong>{failedNode[0]}</strong>
          {failedNode[1].error ? ` — ${failedNode[1].error}` : ''}
        </p>
      )}
      {lastEvents.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="oda-kicker" style={{ marginBottom: 4 }}>Last events</div>
          {lastEvents.map((e) => (
            <div key={e.seq} className="oda-muted" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
              {e.ts?.slice(11, 19)} · {e.type}
            </div>
          ))}
        </div>
      )}
      <p className="oda-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Use Retry in the sidebar to re-run the failed stage, or start a new task.</p>
    </div>
  );
}
