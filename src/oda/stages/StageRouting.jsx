// StageRouting.jsx — skill-routing map (Phase 3).
// Visualises run.pipeline as a horizontal flow of skill nodes, coloured by
// run.nodeStates[nodeId].status, with parallel nodes (sharing a dependsOn)
// grouped vertically and simple arrows for linear dependencies.
import React from 'react';
import GateCard from '../GateCard';

const STATE_CLASS = {
  queued: 'oda-flow__node--queued',
  running: 'oda-flow__node--running',
  completed: 'oda-flow__node--completed',
  failed: 'oda-flow__node--failed',
};

const STATE_LABEL = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

function truncate(text, n) {
  if (!text) return '';
  const s = String(text);
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Group pipeline nodes into columns; nodes sharing the same dependsOn key sit
 * in the same column (parallel), columns ordered by first appearance. */
function toColumns(pipeline) {
  const columns = [];
  const seenKey = new Map();
  for (const node of pipeline || []) {
    const deps = Array.isArray(node.dependsOn) ? [...node.dependsOn].sort().join(',') : (node.dependsOn || '');
    if (!seenKey.has(deps)) {
      seenKey.set(deps, columns.length);
      columns.push({ key: deps, nodes: [] });
    }
    columns[seenKey.get(deps)].nodes.push(node);
  }
  return columns;
}

export default function StageRouting({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const pipeline = run?.pipeline || [];
  const nodeStates = run?.nodeStates || {};
  const control = run?.control || null;
  const deliverables = (control && (control.deliverables || control.expectedDeliverables)) || [];
  const columns = toColumns(pipeline);

  return (
    <div className="oda-card">
      <div className="oda-kicker">Skill routing</div>
      <div className="oda-h">How this request is being executed</div>

      {pipeline.length === 0 ? (
        <div className="oda-empty">Selecting the pipeline…</div>
      ) : (
        <div className="oda-flow" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          {columns.map((col, ci) => (
            <React.Fragment key={col.key || ci}>
              {ci > 0 && <span className="oda-flow__arrow" aria-hidden>→</span>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {col.nodes.map((node) => {
                  const st = nodeStates[node.nodeId]?.status || 'queued';
                  const route = node.route;
                  return (
                    <div
                      key={node.nodeId}
                      className={`oda-flow__node ${STATE_CLASS[st] || 'oda-flow__node--queued'}`}
                      data-node-id={node.nodeId}
                    >
                      <div className="oda-h" style={{ fontSize: '1em' }}>{node.skill}</div>
                      {route && <div className="oda-pill">{route}</div>}
                      {node.objective && <div className="oda-sub">{truncate(node.objective, 80)}</div>}
                      {node.mode && <div className="oda-muted">Mode: {node.mode}</div>}
                    </div>
                  );
                })}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="oda-two" style={{ marginTop: 16 }}>
        <div>
          <div className="oda-muted">Node states</div>
          <div className="oda-cardgrid">
            {Object.entries(STATE_LABEL).map(([key, label]) => (
              <span key={key} className={`oda-pill oda-flow__node--${key}`}>{label}</span>
            ))}
          </div>
        </div>
        {deliverables.length > 0 && (
          <div>
            <div className="oda-muted">Deliverables</div>
            <div className="oda-cardgrid">
              {deliverables.map((d, i) => (
                <span key={i} className="oda-pill">{typeof d === 'string' ? d : (d?.name || d?.type || JSON.stringify(d))}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {gate && (
        <div style={{ marginTop: 16 }}>
          <GateCard gate={gate} onResolve={onResolveGate} allowEdits />
        </div>
      )}
    </div>
  );
}
