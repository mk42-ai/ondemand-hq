// LiveRender.jsx — the live real-time rendering page (/oda/live).
// Pre-cooked four-slide template fills in real time from SSE ODARunEvent
// frames (GLM 4.7 slide director) — every visual change maps to a real state
// transition; no timers anywhere. The selected brain authors the final
// document; a download URL is surfaced the moment the run completes.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, Play, RotateCcw } from 'lucide-react';
import useLiveDeck from './useLiveDeck.js';
import SlideTemplate from './SlideTemplate.jsx';
import BrainSelector from './BrainSelector.jsx';
import './live.css';

const STATUS_LABEL = {
  idle: 'Ready', interpreting: 'Interpreting…', planning: 'Planning…',
  executing: 'Rendering live', verifying: 'Verifying…', revising: 'Revising…',
  completed: 'Completed', failed: 'Failed', waiting_for_user: 'Waiting for you',
};

export default function LiveRender({ onExit }) {
  const { state, start, reset } = useLiveDeck();
  const [text, setText] = useState('');
  const [brain, setBrain] = useState('sonnet-5');
  const [brains, setBrains] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/oda/brains').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.brains) setBrains(j.brains);
      if (j?.default) setBrain((prev) => prev || j.default);
    }).catch(() => { /* fallback list inside BrainSelector */ });
  }, []);

  const running = !['idle', 'completed', 'failed'].includes(state.status);

  const onStart = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try { await start({ text: text.trim(), brain }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="oda-live">
      <header className="oda-live__pagehead">
        <div className="oda-live__brand">
          <img src="/oda-logo-bw.png" alt="Office of Development Affairs" className="oda-live__logo" />
          <div>
            <div className="oda-live__brandname">ODA Live Render</div>
            <div className="oda-live__brandsub">Office of Development Affairs · Abu Dhabi</div>
          </div>
        </div>
        <div className="oda-live__headright">
          <span className={`oda-live__chip oda-live__chip--${state.status === 'completed' ? 'final' : running ? 'filling' : 'pending'}`}>
            {running && <span className="oda-live__dot" aria-hidden />}
            {STATUS_LABEL[state.status] || state.status}
          </span>
          {state.safeStatus && running && <span className="oda-live__safestatus">{state.safeStatus}</span>}
          <button type="button" className="oda-live__ghostbtn" onClick={onExit}>
            <ArrowLeft size={13} aria-hidden /> Workspace
          </button>
        </div>
      </header>

      <section className="oda-live__composer">
        <textarea
          className="oda-live__input"
          rows={2}
          value={text}
          disabled={running}
          placeholder="Describe the deliverable — the four slides fill in live as the run progresses…"
          onChange={(e) => setText(e.target.value)}
        />
        <BrainSelector value={brain} onChange={setBrain} disabled={running} brains={brains} />
        <div className="oda-live__actions">
          <button type="button" className="oda-live__startbtn" onClick={onStart} disabled={running || busy || !text.trim()}>
            <Play size={14} aria-hidden /> {busy ? 'Starting…' : 'Start live run'}
          </button>
          {(state.status === 'completed' || state.status === 'failed') && (
            <button type="button" className="oda-live__ghostbtn" onClick={() => { reset(); setError(null); }}>
              <RotateCcw size={13} aria-hidden /> New run
            </button>
          )}
          {state.downloadUrl && (
            <a className="oda-live__dlbtn" href={state.downloadUrl} target="_blank" rel="noopener noreferrer">
              <Download size={14} aria-hidden /> Download final document
            </a>
          )}
        </div>
        {(error || state.error) && <div className="oda-live__err">{error || state.error}</div>}
      </section>

      <SlideTemplate slides={state.slides} activeSlide={state.activeSlide} logoUrl="/oda-logo-bw.png" />

      <footer className="oda-live__foot">
        {state.runId ? `run ${state.runId.slice(0, 8)} · brain ${state.brain} · interpreter glm-4.7 · ${state.events.length} live frames` : 'GLM 4.7 drives the live template · your selected brain writes the final document'}
      </footer>
    </div>
  );
}
