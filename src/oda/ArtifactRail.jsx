// ArtifactRail.jsx — the right collapsible rail for the ODA workspace.
// Read-only mirror of the run's durable state (pipeline, evidence,
// assumptions, gates, artifacts, verification) — resolution itself happens
// in the canvas GateCard, never here.
import React from 'react';
import {
  ChevronLeft, ChevronRight, CheckCircle2, Loader2, Circle, AlertTriangle,
  Download, Eye,
} from 'lucide-react';

const NODE_ICON = {
  completed: { Icon: CheckCircle2, cls: 'oda-rail__icon--completed', label: 'Completed' },
  running: { Icon: Loader2, cls: 'oda-rail__icon--running oda-spin', label: 'Running' },
  queued: { Icon: Circle, cls: 'oda-rail__icon--queued', label: 'Queued' },
  failed: { Icon: AlertTriangle, cls: 'oda-rail__icon--failed', label: 'Failed' },
};

const ARTIFACT_BADGE = {
  verified: { cls: 'oda-badge--verified', label: 'Verified' },
  draft: { cls: 'oda-badge--draft', label: 'Draft' },
  verifying: { cls: 'oda-badge--verifying', label: 'Verifying' },
  failed: { cls: 'oda-badge--failed', label: 'Failed' },
  superseded: { cls: 'oda-badge--draft', label: 'Superseded' },
};

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function fmtClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** m:ss between two REAL ISO timestamps — never fabricated. */
function fmtDuration(startTs, endTs) {
  if (!startTs || !endTs) return '—';
  const ms = new Date(endTs).getTime() - new Date(startTs).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Group artifacts by logicalId, newest version first within each group. */
function groupArtifacts(artifacts) {
  const byLogical = new Map();
  for (const a of artifacts || []) {
    const key = a.logicalId || a.artifactId;
    if (!byLogical.has(key)) byLogical.set(key, []);
    byLogical.get(key).push(a);
  }
  return Array.from(byLogical.entries()).map(([logicalId, list]) => {
    const sorted = [...list].sort((x, y) => (y.version || 0) - (x.version || 0));
    return { logicalId, latest: sorted[0], history: sorted.slice(1) };
  });
}

function dedupeEvidence(evidence) {
  const seen = new Set();
  const out = [];
  for (const e of evidence || []) {
    const key = (e.claim || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function NodeBadge({ status }) {
  const { Icon, cls, label } = NODE_ICON[status] || NODE_ICON.queued;
  return (
    <div className={`oda-rail__badge oda-rail__badge--${status || 'queued'}`}>
      <Icon size={13} className={cls} aria-hidden /> {label}
    </div>
  );
}

export default function ArtifactRail({ run, collapsed, onToggle, onDownload, onPreview }) {
  if (collapsed) {
    return (
      <aside className="oda-rail oda-rail--collapsed">
        <button type="button" className="oda-rail__toggle" onClick={() => onToggle?.()} aria-label="Expand artifact rail">
          <ChevronLeft size={16} aria-hidden />
        </button>
      </aside>
    );
  }

  const r = run || {};
  const pipeline = r.pipeline || [];
  const nodeStates = r.nodeStates || {};
  const currentNode = pipeline.find((n) => n.nodeId === r.currentNodeId) || null;
  const currentState = currentNode ? nodeStates[currentNode.nodeId] : null;

  const evidenceUnique = dedupeEvidence(r.evidence);
  const evidenceTop = evidenceUnique.slice(0, 8);
  const assumptions = r.assumptions || [];
  const assumptionsTop = assumptions.slice(0, 6);
  const openGates = (r.gates || []).filter((g) => g.status === 'open');
  const artifactGroups = groupArtifacts(r.artifacts).sort((a, b) => {
    const at = a.latest?.ts ? new Date(a.latest.ts).getTime() : 0;
    const bt = b.latest?.ts ? new Date(b.latest.ts).getTime() : 0;
    return bt - at;
  });
  const verificationLast3 = (r.verification || []).slice(-3).reverse();
  const events = r.events || [];
  const firstTs = events[0]?.ts || null;
  const lastTs = events.length ? events[events.length - 1].ts : null;

  return (
    <aside className="oda-rail">
      <button type="button" className="oda-rail__toggle" onClick={() => onToggle?.()} aria-label="Collapse artifact rail">
        <ChevronRight size={16} aria-hidden />
      </button>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Active skill</div>
        {currentNode ? (
          <div className="oda-rail__active">
            <div className="oda-rail__active-name">{currentNode.skill}</div>
            <div className="oda-muted">{currentNode.route ? `${currentNode.route} · ` : ''}{currentNode.mode || '—'}</div>
            {r.safeStatus && <div className="oda-rail__active-safe oda-muted">{r.safeStatus}</div>}
            <NodeBadge status={currentState?.status} />
          </div>
        ) : (
          <div className="oda-empty">No active skill</div>
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Pipeline</div>
        {pipeline.length === 0 ? (
          <div className="oda-empty">No pipeline yet</div>
        ) : (
          pipeline.map((n, i) => {
            const st = nodeStates[n.nodeId]?.status || 'queued';
            const { Icon, cls } = NODE_ICON[st] || NODE_ICON.queued;
            return (
              <div className="oda-rail__row" key={n.nodeId}>
                <span className="oda-rail__order">{i + 1}</span>
                <span className="oda-rail__skill">{n.skill}</span>
                <Icon size={14} className={cls} aria-hidden />
              </div>
            );
          })
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Verified sources</div>
        {evidenceTop.length === 0 ? (
          <div className="oda-empty">No sources yet</div>
        ) : (
          <>
            {evidenceTop.map((e) => (
              <div className="oda-rail__row oda-rail__row--evidence" key={e.id}>
                <span className={`oda-tag oda-tag--${e.tag || 'fact'}`}>{e.tag || 'fact'}</span>
                <span className="oda-rail__claim">{truncate(e.claim, 90)}</span>
              </div>
            ))}
            {evidenceUnique.length > evidenceTop.length && (
              <div className="oda-rail__more oda-muted">+{evidenceUnique.length - evidenceTop.length} more</div>
            )}
          </>
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Assumptions</div>
        {assumptionsTop.length === 0 ? (
          <div className="oda-empty">No assumptions recorded</div>
        ) : (
          <>
            {assumptionsTop.map((a, i) => (
              <div className="oda-rail__row" key={i}>{truncate(typeof a === 'string' ? a : JSON.stringify(a), 100)}</div>
            ))}
            {assumptions.length > assumptionsTop.length && (
              <div className="oda-rail__more oda-muted">+{assumptions.length - assumptionsTop.length} more</div>
            )}
          </>
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Open decisions</div>
        {openGates.length === 0 ? (
          <div className="oda-empty">No open decisions</div>
        ) : (
          openGates.map((g) => (
            <div className="oda-rail__row oda-rail__row--gate" key={g.gateId}>
              <span className="oda-pill">{g.gateType}</span>
              <span className="oda-rail__claim">{truncate(g.prompt, 90)}</span>
            </div>
          ))
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Files</div>
        {artifactGroups.length === 0 ? (
          <div className="oda-empty">No files yet</div>
        ) : (
          artifactGroups.map((group) => {
            const a = group.latest;
            const badge = ARTIFACT_BADGE[a.status] || ARTIFACT_BADGE.draft;
            return (
              <div className="oda-rail__file" key={group.logicalId}>
                <div className="oda-rail__file-row">
                  <span className={`oda-badge ${badge.cls}`}>{badge.label}</span>
                  <span className="oda-rail__file-title">{a.title || a.logicalId}</span>
                  <span className="oda-pill">{a.type}</span>
                  <span className="oda-rail__file-version">v{a.version}</span>
                  {a.url && (
                    <button type="button" className="oda-rail__icon-btn" title="Download" onClick={() => onDownload?.(a)}>
                      <Download size={13} aria-hidden />
                    </button>
                  )}
                  <button type="button" className="oda-rail__icon-btn" title="Preview" onClick={() => onPreview?.(a)}>
                    <Eye size={13} aria-hidden />
                  </button>
                </div>
                {group.history.length > 0 && (
                  <details className="oda-rail__history">
                    <summary>History</summary>
                    {group.history.map((h) => (
                      <div className="oda-rail__file-row oda-rail__file-row--old" key={h.artifactId}>
                        <span className="oda-rail__file-title">{h.title || h.logicalId}</span>
                        <span className="oda-rail__file-version">v{h.version}</span>
                        {h.url && (
                          <button type="button" className="oda-rail__icon-btn" title="Download" onClick={() => onDownload?.(h)}>
                            <Download size={13} aria-hidden />
                          </button>
                        )}
                        <button type="button" className="oda-rail__icon-btn" title="Preview" onClick={() => onPreview?.(h)}>
                          <Eye size={13} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Verification</div>
        {verificationLast3.length === 0 ? (
          <div className="oda-empty">No verification runs yet</div>
        ) : (
          verificationLast3.map((v, i) => {
            const findings = v.findings || [];
            return (
              <div className="oda-rail__row oda-rail__row--verif" key={`${v.artifactId}-${i}`}>
                <span className={`oda-pill ${v.status === 'passed' ? 'oda-pill--pass' : 'oda-pill--fail'}`}>{v.status}</span>
                <span className="oda-muted">{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
                {findings[0] && <span className="oda-rail__claim">{truncate(findings[0].message, 80)}</span>}
              </div>
            );
          })
        )}
      </section>

      <section className="oda-rail__sec">
        <div className="oda-rail__h">Run metadata</div>
        <div className="oda-rail__meta">
          <div><span className="oda-muted">Run</span> {r.runId ? r.runId.slice(0, 8) : '—'}</div>
          <div><span className="oda-muted">Mode</span> {r.mode || '—'}</div>
          <div><span className="oda-muted">Started</span> {fmtClock(firstTs)}</div>
          <div><span className="oda-muted">Duration</span> {fmtDuration(firstTs, lastTs)}</div>
          <div><span className="oda-muted">Events</span> {events.length}</div>
        </div>
      </section>
    </aside>
  );
}
