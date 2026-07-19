// IntelPanelsV2.jsx — CE-V2 intelligence-layer panels (2026-07-19):
// (a) DeepSearchSelector — research-window dropdown (default 3y + 30-day boost)
// (e) PredictionsPanel — probability-scored forecasts w/ supporting + counter evidence
// (g) StoryDrawer — one-click executive briefing, SSE-streamed with thinking tokens
//     shown separately from answer tokens per the existing UI contract.
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, BookOpen, Sparkles, Search } from 'lucide-react';

/* ── (a) Deep Search window selector ─────────────────────────────── */
export function DeepSearchSelector({ value, onChange }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    fetch('/api/correlation/v2/config').then(r => r.json()).then(setCfg).catch(() => {});
  }, []);
  if (!cfg) return null;
  return (
    <label className="ce-dswin" title={`Deep Search window — default ${cfg.windows[cfg.defaultWindow]?.label}; evidence from the last ${cfg.defaultPolicy.recencyBoostDays} days is weighted ×${cfg.defaultPolicy.recencyBoostFactor} on top of tier weights`}>
      <Search size={11} />
      <select value={value || cfg.defaultWindow} onChange={(e) => onChange?.(e.target.value)} aria-label="Research window">
        {Object.entries(cfg.windows).map(([k, w]) => (
          <option key={k} value={k}>{w.label}{k === cfg.defaultWindow ? ' ★' : ''}</option>
        ))}
      </select>
      <span className="ce-dswin__boost">+30d boost</span>
    </label>
  );
}

/* ── (e) Predictions panel ────────────────────────────────────────── */
export function PredictionsPanel({ run, onClose, onQuickQuery }) {
  const preds = run.predictions || [];
  return (
    <motion.aside className="ce-preds" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
      role="complementary" aria-label="Predictive intelligence">
      <div className="ins-head">
        <div>
          <div className="ins-kicker">PREDICTIVE INTELLIGENCE</div>
          <h3>{preds.length ? `${preds.length} forecasts` : 'No predictions on this run'}</h3>
          <div className="ins-sub">evidence-backed vs speculative — enforced server-side</div>
        </div>
        <button className="ins-x" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      <div className="ins-body">
        {!preds.length && <p className="ins-muted">Run the V2 pipeline (Deep Search) to generate probability-scored forecasts.</p>}
        {preds.map(p => (
          <div key={p.id} className={`pred ${p.speculative ? 'pred--spec' : ''}`}>
            <div className="pred__top">
              <span className="pred__kind">{p.kind}</span>
              <span className={`pred__badge ${p.speculative ? 'is-spec' : 'is-ev'}`}>{p.speculative ? 'SPECULATIVE' : 'EVIDENCE-BACKED'}</span>
            </div>
            <p className="pred__stmt">{p.statement}</p>
            <div className="pred__bar" title={`probability ${(p.probability * 100).toFixed(0)}%`}>
              <i style={{ width: `${p.probability * 100}%` }} />
              <b>{(p.probability * 100).toFixed(0)}%</b>
            </div>
            <div className="pred__meta">
              <span>confidence {(p.confidence * 100).toFixed(0)}%</span>
              {p.supportingEvidenceIds?.length > 0 && <span>for: {p.supportingEvidenceIds.join(', ')}</span>}
              {p.counterEvidenceIds?.length > 0 && <span className="pred__counter">against: {p.counterEvidenceIds.join(', ')}</span>}
            </div>
            {p.counterEvidence && <p className="pred__counterTxt">⚖ {p.counterEvidence}</p>}
            {p.reasoning && <p className="pred__why">{p.reasoning}</p>}
          </div>
        ))}
        {preds.length > 0 && (
          <button className="ce-btn qq-trigger" onClick={() => onQuickQuery?.({ kind: 'predictions', runId: run.runId, country: run.country, predictions: preds.slice(0, 5) })}>
            ⚡ Quick Query these forecasts
          </button>
        )}
      </div>
    </motion.aside>
  );
}

/* ── (g) Story Mode drawer — streamed executive briefing ─────────── */
export function StoryDrawer({ iso, run, onClose }) {
  const [thinking, setThinking] = useState('');
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [err, setErr] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`/api/correlation/v2/story/${iso}/${run.runId}/stream`);
    es.onmessage = (e) => {
      if (e.data === '[DONE]') { es.close(); setStreaming(false); return; }
      try {
        const evt = JSON.parse(e.data);
        if (evt.eventType === 'fulfillment' && typeof evt.answer === 'string') setText(t => t + evt.answer);
        else if (typeof evt?.thinking?.delta === 'string') setThinking(t => (t + evt.thinking.delta).slice(-1200));
      } catch { /* heartbeat */ }
    };
    // separate SSE event name for thinking frames (UI contract: thinking ≠ answer)
    es.addEventListener('thinking', (e) => {
      try { const evt = JSON.parse(e.data); if (typeof evt?.thinking?.delta === 'string') setThinking(t => (t + evt.thinking.delta).slice(-1200)); } catch { /* noop */ }
    });
    es.addEventListener('error', (e) => {
      try { const evt = JSON.parse(e.data || '{}'); if (evt.error) setErr(evt.error); } catch { /* transport error */ }
      es.close(); setStreaming(false);
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, run.runId]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [text]);

  return (
    <motion.div className="ce-story" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
      role="dialog" aria-label="Story Mode — executive briefing">
      <div className="ins-head">
        <div>
          <div className="ins-kicker"><BookOpen size={10} /> STORY MODE</div>
          <h3>Executive briefing — {run.country}</h3>
          <div className="ins-sub">run {run.runId} · every claim cited [A#/C#] · speculation labelled</div>
        </div>
        <button className="ins-x" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      {streaming && thinking && (
        <div className="ce-story__thinking" aria-label="Model reasoning (streamed separately)">
          <Sparkles size={10} /> <span>{thinking.slice(-260)}</span>
        </div>
      )}
      <div className="ce-story__body" ref={bodyRef}>
        {err && <p className="ce-error">Story stream failed: {err}</p>}
        {text || (!err && <span className="ins-muted">Composing the briefing from run evidence…</span>)}
        {streaming && !err && <span className="qq-caret">▍</span>}
      </div>
    </motion.div>
  );
}
