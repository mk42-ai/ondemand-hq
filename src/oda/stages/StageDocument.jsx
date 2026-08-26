// StageDocument.jsx — live document / deck preview (Phase 3).
// deck-html artifacts render inside a sandboxed iframe; markdown artifacts
// render as a typeset .oda-doc. The verification_findings gate renders at the
// top of the preview. Real artifact state only.
import React from 'react';
import GateCard from '../GateCard.jsx';
import { mdToHtml } from '../md.js';

const BADGE = { verified: 'oda-badge--verified', draft: 'oda-badge--draft', failed: 'oda-badge--failed', verifying: 'oda-badge--verifying' };

export default function StageDocument({ run, gate, artifact, artifactContent, onResolveGate }) {
  const content = artifactContent?.content || '';
  const running = ['executing', 'verifying', 'revising'].includes(run.status);

  if (!artifact && running) return <div className="oda-empty"><span className="oda-spin" /> Preparing the document…</div>;
  if (!artifact) return <div className="oda-empty">No document artifact yet</div>;

  const isHtml = artifact.type === 'deck-html' && /</.test(content);

  return (
    <div>
      {gate && <GateCard gate={gate} onResolve={onResolveGate} />}
      <div className="oda-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #E5EDF2' }}>
          <div>
            <span className="oda-h" style={{ fontSize: 14.5 }}>{artifact.title || artifact.logicalId}</span>
            <span className="oda-muted" style={{ fontSize: 12, marginLeft: 8 }}>{artifact.type} · v{artifact.version}</span>
          </div>
          <span className={`oda-badge ${BADGE[artifact.status] || 'oda-badge--draft'}`}>{artifact.status}</span>
        </div>
        {isHtml ? (
          <iframe
            title="Document preview"
            srcDoc={content}
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '68vh', border: 0, background: '#fff', display: 'block' }}
          />
        ) : content ? (
          <div className="oda-doc" style={{ padding: '20px 26px' }} dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />
        ) : (
          <div className="oda-empty" style={{ padding: 40 }}>
            {artifact.preview ? <span style={{ whiteSpace: 'pre-wrap', fontStyle: 'normal' }}>{artifact.preview}</span> : <><span className="oda-spin" /> Loading content…</>}
          </div>
        )}
      </div>
      {artifact.verification?.findings?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="oda-kicker" style={{ marginBottom: 6 }}>Verifier findings</div>
          {artifact.verification.findings.slice(0, 6).map((f, i) => (
            <div className="oda-card oda-card--gold" key={i} style={{ marginBottom: 8, padding: 12 }}>
              <span className="oda-pill" style={{ marginRight: 8 }}>{f.severity}</span>
              <strong style={{ fontSize: 12.5 }}>{f.location}</strong>
              <span style={{ fontSize: 12.5 }}> — {f.message}</span>
              {f.requiredAction && <div className="oda-muted" style={{ fontSize: 12, marginTop: 4 }}>→ {f.requiredAction}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
