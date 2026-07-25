// StageStoryline.jsx — storyline / slide map canvas (Phase 3).
// Three artifact shapes: a storyline/dot-dash spec (slide cards in order), the
// five-zone executive one-pager (SUMMARY route), and ranked action titles
// (TITLES route). The storyline approval gate renders INSIDE the slide map.
import React from 'react';
import GateCard from '../GateCard.jsx';
import { parseMdStructure } from '../md.js';

const ZONES = ['Scope', 'Context', 'Approach', 'Objectives', 'Next steps'];

function SlideCard({ index, heading, bullets, mainAppendix }) {
  return (
    <div className="oda-slide">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="oda-pill">{index + 1}</span>
        {mainAppendix && <span className={`oda-pill${mainAppendix === 'MAIN' ? '' : ' oda-pill--muted'}`}>{mainAppendix}</span>}
      </div>
      <div className="oda-slide__title">{heading}</div>
      {bullets.slice(0, 2).map((b, i) => (
        <div key={i} style={{ fontSize: 12, color: '#5B6770', margin: '4px 0' }}>— {b}</div>
      ))}
    </div>
  );
}

export default function StageStoryline({ run, gate, artifact, artifactContent, onResolveGate }) {
  const md = artifactContent?.content || artifact?.preview || '';
  const doc = parseMdStructure(md);
  const running = ['executing', 'verifying', 'revising'].includes(run.status);
  const type = artifact?.type;

  if (!md && running) return <div className="oda-empty"><span className="oda-spin" /> Preparing the narrative…</div>;
  if (!md) return <div className="oda-empty">No storyline artifact yet</div>;

  // ---- TITLES route: ranked option cards ----
  if (type === 'action-titles-md' || /##\s*Option\s+\d/i.test(md)) {
    const opts = doc.sections.filter((s) => /option\s*\d/i.test(s.heading));
    return (
      <div>
        {gate && <GateCard gate={gate} onResolve={onResolveGate} allowEdits />}
        <div className="oda-kicker" style={{ marginBottom: 10 }}>Ranked action titles</div>
        <div className="oda-cardgrid">
          {(opts.length ? opts : doc.sections).map((s, i) => {
            const words = (s.lines.join(' ').match(/\d+\s*words?/i) || [])[0];
            const titleLine = s.lines.find((l) => l.length > 20) || s.lines[0] || '';
            return (
              <div className={`oda-card${i === 0 ? ' oda-card--gold' : ''}`} key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="oda-kicker">{s.heading}</span>
                  {words && <span className="oda-pill">{words}</span>}
                </div>
                <p className="oda-h" style={{ fontSize: 14.5, margin: '8px 0 4px', lineHeight: 1.45 }}>{titleLine.replace(/\*/g, '')}</p>
                {s.bullets.slice(0, 2).map((b, j) => <div key={j} className="oda-muted" style={{ fontSize: 12 }}>{b}</div>)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- SUMMARY route: the five-zone one-pager ----
  if (type === 'one-pager-summary' || ZONES.filter((z) => doc.sections.some((s) => new RegExp(`^${z}$`, 'i').test(s.heading.trim()))).length >= 3) {
    const zoneSec = (z) => doc.sections.find((s) => new RegExp(`^\\*{0,2}${z}\\*{0,2}$`, 'i').test(s.heading.trim()))
      || doc.sections.find((s) => new RegExp(z, 'i').test(s.heading));
    const headline = doc.sections.find((s) => !ZONES.some((z) => new RegExp(z, 'i').test(s.heading)));
    return (
      <div>
        {gate && <GateCard gate={gate} onResolve={onResolveGate} allowEdits />}
        <div className="oda-kicker" style={{ marginBottom: 8 }}>Executive one-pager · five zones</div>
        {doc.title && <h2 className="oda-h" style={{ fontSize: 19, margin: '0 0 6px' }}>{doc.title}</h2>}
        {headline?.lines?.[0] && <div className="oda-card oda-card--gold" style={{ marginBottom: 14 }}><strong>{headline.lines[0].replace(/\*/g, '')}</strong></div>}
        <div className="oda-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {ZONES.map((z) => {
            const s = zoneSec(z);
            return (
              <div className="oda-card" key={z}>
                <div className="oda-kicker">{z}</div>
                {s ? (
                  <>
                    {s.lines.slice(0, 2).map((l, i) => <p key={i} style={{ fontSize: 13, margin: '6px 0 0' }}>{l.replace(/\*/g, '')}</p>)}
                    <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                      {s.bullets.slice(0, 4).map((b, i) => <li key={i} style={{ fontSize: 12.5, margin: '3px 0' }}>{b.replace(/\*/g, '')}</li>)}
                    </ul>
                  </>
                ) : <p className="oda-muted" style={{ fontSize: 12.5 }}>—</p>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- Storyline spec: ordered slide map ----
  const slideSecs = doc.sections.filter((s) => /^(slide|page|\d+[.)])/i.test(s.heading) || s.depth === 2);
  return (
    <div>
      <div className="oda-kicker" style={{ marginBottom: 10 }}>Slide map · {slideSecs.length} pages</div>
      <div className="oda-slidegrid">
        {slideSecs.map((s, i) => {
          const text = [s.heading, ...s.lines, ...s.bullets].join(' ');
          const ma = /\bAPPENDIX\b/i.test(text) ? 'APPENDIX' : /\bMAIN\b/.test(text) ? 'MAIN' : null;
          return <SlideCard key={i} index={i} heading={s.heading.replace(/^(slide|page)\s*\d*[—:-]?\s*/i, '')} bullets={s.bullets} mainAppendix={ma} />;
        })}
      </div>
      {gate && <GateCard gate={gate} onResolve={onResolveGate} allowEdits editLabel="Edit storyline" />}
    </div>
  );
}
