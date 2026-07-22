// useLiveDeck.js — React hook for the live-render page (live-render upgrade).
// Consumes the SAME run SSE stream as useOdaRun (real ODARunEvent frames only)
// and applies slide.update patches to the pre-cooked four-slide scaffold.
// No timers, no simulated progress — every visual change maps to a frame.
import { useCallback, useRef, useState } from 'react';

const SCAFFOLD = [
  { no: 1, kind: 'headline', kicker: 'Understanding', title: '', bullets: [], status: 'pending', confidence: null },
  { no: 2, kind: 'evidence', kicker: 'Evidence & analysis', title: '', bullets: [], status: 'pending', confidence: null },
  { no: 3, kind: 'core', kicker: 'Core findings', title: '', bullets: [], status: 'pending', confidence: null },
  { no: 4, kind: 'actions', kicker: 'Recommendations & next steps', title: '', bullets: [], status: 'pending', confidence: null },
];

const EMPTY = {
  runId: null,
  status: 'idle',
  slides: SCAFFOLD.map((s) => ({ ...s })),
  downloadUrl: null,
  brain: 'sonnet-5',
  safeStatus: null,
  activeSlide: null,
  error: null,
  events: [],
};

export default function useLiveDeck() {
  const [state, setState] = useState(EMPTY);
  const esRef = useRef(null);
  const seqRef = useRef(0);

  const close = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  }, []);

  const listen = useCallback((runId) => {
    close();
    const es = new EventSource(`/api/oda/runs/${runId}/events?since=0`);
    esRef.current = es;

    const onFrame = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (!ev || ev.seq <= seqRef.current) return;
      seqRef.current = ev.seq;
      setState((prev) => {
        const s = { ...prev, events: [...prev.events, { seq: ev.seq, type: ev.type, ts: ev.ts }] };
        const d = ev.data || {};
        switch (ev.type) {
          case 'run.created': s.status = 'interpreting'; break;
          case 'request.interpreted':
            s.status = 'planning';
            s.safeStatus = d.safeStatus || d.control?.safe_status || s.safeStatus;
            break;
          case 'slide.update': {
            const idx = (d.slideNo || 0) - 1;
            if (idx >= 0 && idx < 4) {
              const slides = s.slides.map((sl, i) => (i === idx ? { ...sl, ...d.patch } : sl));
              s.slides = slides;
              s.activeSlide = d.slideNo;
            }
            s.status = ['interpreting', 'planning'].includes(s.status) ? 'executing' : s.status;
            break;
          }
          case 'skill.progress': if (d.safeStatus) s.safeStatus = d.safeStatus; break;
          case 'deck.ready':
            s.slides = s.slides.map((sl) => ({ ...sl, status: 'final' }));
            break;
          case 'artifact.download.ready':
            s.downloadUrl = d.downloadUrl || s.downloadUrl;
            break;
          case 'run.completed':
            s.status = 'completed';
            if (d.downloadUrl) s.downloadUrl = d.downloadUrl;
            if (d.brain) s.brain = d.brain;
            break;
          case 'run.failed':
            s.status = 'failed';
            s.error = d.error || 'Run failed';
            break;
          default: break;
        }
        return s;
      });
    };

    [
      'run.created', 'request.interpreted', 'pipeline.selected', 'skill.queued', 'skill.started',
      'skill.progress', 'question.required', 'evidence.added', 'artifact.created',
      'artifact.preview.updated', 'verification.started', 'verification.failed',
      'verification.passed', 'skill.completed', 'run.completed', 'run.failed',
      'slide.update', 'deck.ready', 'artifact.download.ready',
    ].forEach((t) => es.addEventListener(t, onFrame));
    es.onmessage = onFrame;
  }, [close]);

  /** Start a live run with the selected brain. */
  const start = useCallback(async ({ text, brain = 'sonnet-5' }) => {
    seqRef.current = 0;
    setState({ ...EMPTY, slides: SCAFFOLD.map((s) => ({ ...s })), status: 'interpreting', brain });
    const r = await fetch('/api/oda/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, externalUserId: 'oda-live', brain }),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
      setState((prev) => ({ ...prev, status: 'failed', error: err }));
      throw new Error(err);
    }
    const { runId } = await r.json();
    setState((prev) => ({ ...prev, runId }));
    listen(runId);
    return runId;
  }, [listen]);

  const reset = useCallback(() => { close(); seqRef.current = 0; setState(EMPTY); }, [close]);

  return { state, start, reset };
}
