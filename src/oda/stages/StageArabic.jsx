// StageArabic.jsx — Arabic side-by-side review (Phase 3).
// English source LEFT, Arabic RIGHT (dir=rtl, Sakkal Majalla local-first stack
// with Noto Naskh Arabic embedded — styled by .oda-doc--rtl). Bilingual
// artifacts split on the first strongly-Arabic line. The english_before_arabic
// gate renders above the panes; verifier findings render beside the panes.
import React from 'react';
import GateCard from '../GateCard.jsx';
import { mdToHtml } from '../md.js';

const AR_RE = /[\u0600-\u06FF]/g;
function arabicRatio(line) {
  const chars = line.replace(/\s/g, '');
  if (!chars) return 0;
  return ((line.match(AR_RE) || []).length) / chars.length;
}

/** Split a bilingual document on the first line that is ≥60% Arabic. */
function splitBilingual(md) {
  const lines = String(md || '').split('\n');
  const idx = lines.findIndex((l) => l.trim().length > 3 && arabicRatio(l) >= 0.6);
  if (idx < 0) return null;
  return { en: lines.slice(0, idx).join('\n'), ar: lines.slice(idx).join('\n') };
}

export default function StageArabic({ run, gate, artifact, artifactContent, onResolveGate }) {
  const content = artifactContent?.content || artifact?.preview || '';
  const running = ['executing', 'verifying', 'revising'].includes(run.status);

  // English source: latest verified non-Arabic content artifact on the run.
  const englishTypes = ['one-pager-summary', 'storyline-md', 'markdown', 'media-bilingual-md', 'workbook-md', 'benchmark-report-md'];
  const enArtifact = [...(run.artifacts || [])].reverse().find(
    (a) => a.status === 'verified' && englishTypes.includes(a.type) && a.artifactId !== artifact?.artifactId,
  );

  const bilingual = splitBilingual(content);
  const enText = bilingual ? bilingual.en : (enArtifact?.preview || '');
  const arText = bilingual ? bilingual.ar : (arabicRatio(content) > 0.2 ? content : '');

  if (!content && running) return <div className="oda-empty"><span className="oda-spin" /> Translating the document…</div>;

  // Findings for this artifact (register/terminology issues shown beside the text).
  const findings = artifact?.verification?.findings || [];

  return (
    <div>
      {gate && <GateCard gate={gate} onResolve={onResolveGate} />}
      <div className="oda-two">
        <div className="oda-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="oda-kicker" style={{ padding: '10px 16px', borderBottom: '1px solid #E5EDF2' }}>English source</div>
          {enText
            ? <div className="oda-doc" style={{ padding: '16px 20px' }} dangerouslySetInnerHTML={{ __html: mdToHtml(enText) }} />
            : <div className="oda-empty" style={{ padding: 30 }}>English source pending</div>}
        </div>
        <div className="oda-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="oda-kicker" style={{ padding: '10px 16px', borderBottom: '1px solid #E5EDF2' }}>Arabic · العربية</div>
          {arText
            ? <div className="oda-doc oda-doc--rtl" dir="rtl" lang="ar" style={{ padding: '16px 20px' }} dangerouslySetInnerHTML={{ __html: mdToHtml(arText) }} />
            : <div className="oda-empty" style={{ padding: 30 }}>{running ? <><span className="oda-spin" /> Arabic version in progress…</> : 'Arabic version pending English approval'}</div>}
        </div>
      </div>
      {findings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="oda-kicker" style={{ marginBottom: 6 }}>Review findings</div>
          {findings.slice(0, 6).map((f, i) => (
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
