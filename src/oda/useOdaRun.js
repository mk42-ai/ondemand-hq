// useOdaRun.js — THE single state hook for the ODA workspace (Phase 3).
// All canvas/rail state is driven EXCLUSIVELY by real ODARunEvent SSE frames
// from GET /api/oda/runs/:id/events (?since= replay) — no timers, no simulated
// progress anywhere. Refresh recovery: the runId persists in localStorage; on
// mount the hook rehydrates via GET /api/oda/runs/:id then resubscribes from
// the last seen seq, so paused-gate state survives a refresh (M13).
import { useCallback, useEffect, useRef, useState } from 'react';

const LS_KEY = 'oda-ws-run-id';

const EMPTY = {
  runId: null,
  status: 'idle',
  intent: null,
  mode: null,
  control: null,
  pipeline: [],
  nodeStates: {},
  currentNodeId: null,
  artifacts: [],
  gates: [],
  evidence: [],
  assumptions: [],
  decisions: [],
  verification: [],
  safeStatus: null,
  brain: null,
  requestText: null,
  liveDeck: null,
  liveThinking: '',
  downloadUrl: null,
  clarifications: [],
  events: [],
  error: null,
};

/** Reduce one ODARunEvent frame into workspace state (pure, replay-safe). */
function reduceEvent(state, ev) {
  const s = { ...state };
  const d = ev.data || {};
  switch (ev.type) {
    case 'run.created':
      s.status = 'interpreting';
      if (d.text) s.requestText = d.text;
      if (d.brain) s.brain = d.brain;
      break;
    case 'request.interpreted':
      s.control = d.control || null;
      s.intent = d.control?.intent || null;
      s.mode = d.control?.mode || null;
      s.safeStatus = d.safeStatus || d.control?.safe_status || null;
      s.status = 'planning';
      break;
    case 'pipeline.selected':
      s.pipeline = d.pipeline || [];
      s.status = 'executing';
      break;
    case 'skill.queued':
      s.nodeStates = { ...s.nodeStates, [d.nodeId]: { status: 'queued' } };
      break;
    case 'skill.started':
      s.nodeStates = { ...s.nodeStates, [d.nodeId]: { ...(s.nodeStates[d.nodeId] || {}), status: 'running', attempt: d.attempt } };
      s.currentNodeId = d.nodeId;
      s.status = 'executing';
      break;
    case 'skill.progress':
      if (d.safeStatus) s.safeStatus = d.safeStatus;
      s.nodeStates = { ...s.nodeStates, [d.nodeId]: { ...(s.nodeStates[d.nodeId] || {}), note: d.note } };
      break;
    case 'skill.thinking':
      // Live reasoning tokens — rolling buffer (cap so long runs never bloat state).
      s.liveThinking = (s.liveThinking + (d.delta || '')).slice(-4000);
      break;
    case 'question.required': {
      const gate = { gateId: d.gateId, gateType: d.gateType, nodeId: d.nodeId ?? null, prompt: d.prompt, options: d.options || [], payload: d.payload ?? null, status: 'open', raisedAt: ev.ts };
      s.gates = [...s.gates.filter((g) => g.gateId !== gate.gateId), gate];
      s.status = 'waiting_for_user';
      break;
    }
    case 'evidence.added':
      s.evidence = [...s.evidence, { id: d.evidenceId || `${ev.seq}`, claim: d.claim, tag: d.tag, nodeId: d.nodeId, ts: ev.ts }];
      break;
    case 'artifact.created': {
      const a = { artifactId: d.artifactId, logicalId: d.logicalId, type: d.type, version: d.version, nodeId: d.nodeId, status: 'draft', ts: ev.ts };
      s.artifacts = [...s.artifacts.filter((x) => x.artifactId !== a.artifactId), a];
      break;
    }
    case 'artifact.preview.updated':
      s.artifacts = s.artifacts.map((a) => (a.artifactId === d.artifactId ? { ...a, preview: d.preview } : a));
      break;
    case 'verification.started':
      s.status = 'verifying';
      s.artifacts = s.artifacts.map((a) => (a.artifactId === d.artifactId ? { ...a, status: 'verifying' } : a));
      break;
    case 'verification.failed':
      s.status = 'revising';
      s.artifacts = s.artifacts.map((a) => (a.artifactId === d.artifactId ? { ...a, status: 'failed', verification: d.verification } : a));
      if (d.verification) s.verification = [...s.verification, { ...d.verification, artifactId: d.artifactId, ts: ev.ts }];
      break;
    case 'verification.passed':
      s.artifacts = s.artifacts.map((a) => (a.artifactId === d.artifactId ? { ...a, status: 'verified', verification: d.verification } : a));
      if (d.verification) s.verification = [...s.verification, { ...d.verification, artifactId: d.artifactId, ts: ev.ts }];
      break;
    case 'skill.completed':
      s.nodeStates = { ...s.nodeStates, [d.nodeId]: { ...(s.nodeStates[d.nodeId] || {}), status: 'completed' } };
      break;
    case 'slide.update': {
      const slides = (s.liveDeck?.slides || [1, 2, 3, 4].map((no) => ({ no, title: '', bullets: [], status: 'pending', confidence: null })))
        .map((sl) => (sl.no === d.slideNo ? { ...sl, ...d.patch } : sl));
      s.liveDeck = { slides };
      break;
    }
    case 'deck.ready':
      if (s.liveDeck) s.liveDeck = { slides: s.liveDeck.slides.map((sl) => ({ ...sl, status: 'final' })) };
      break;
    case 'artifact.download.ready':
      s.downloadUrl = d.downloadUrl || s.downloadUrl;
      break;
    case 'run.completed':
      s.status = 'completed';
      if (d.downloadUrl) s.downloadUrl = d.downloadUrl;
      break;
    case 'run.failed': s.status = 'failed'; s.error = d.error || 'Run failed'; break;
    default: break;
  }
  s.events = [...s.events, ev];
  return s;
}

/** Hydrate full durable run JSON (GET /api/oda/runs/:id) into workspace state. */
function hydrate(run) {
  return {
    ...EMPTY,
    runId: run.runId,
    status: run.status,
    intent: run.intent,
    brain: run.brain ?? null,
    requestText: run.request?.text ?? run.text ?? null,
    mode: run.mode,
    control: run.control,
    pipeline: run.pipeline || [],
    nodeStates: run.nodeStates || {},
    currentNodeId: run.currentNodeId,
    artifacts: (run.artifacts || []).map((a) => ({ ...a })),
    gates: run.gates || [],
    evidence: run.evidence || [],
    assumptions: run.assumptions || [],
    decisions: run.decisions || [],
    verification: run.verification || [],
    safeStatus: run.control?.safe_status || null,
    liveDeck: run.liveDeck || null,
    downloadUrl: run.downloadUrl || run.finalArtifact?.downloadUrl || null,
    clarifications: run.clarifications || [],
    events: run.events || [],
    error: run.error?.message || null,
  };
}

export default function useOdaRun() {
  const [run, setRun] = useState(EMPTY);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);
  const lastSeqRef = useRef(0);

  const close = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setConnected(false);
  }, []);

  /** Subscribe to the SSE stream from the given seq (replay-safe). */
  const listen = useCallback((runId, since = 0) => {
    close();
    const es = new EventSource(`/api/oda/runs/${runId}/events?since=${since}`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource auto-reconnects; replay via ?since on manual re-listen
    const onFrame = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.seq <= lastSeqRef.current) return; // replay dedupe
        lastSeqRef.current = ev.seq;
        setRun((prev) => reduceEvent(prev, ev));
      } catch { /* keepalive/comment noise */ }
    };
    // Named SSE events (event:<type>) — register every ODARunEvent type.
    [
      'run.created', 'request.interpreted', 'pipeline.selected', 'skill.queued', 'skill.started',
      'skill.progress', 'question.required', 'evidence.added', 'artifact.created',
      'artifact.preview.updated', 'verification.started', 'verification.failed',
      'verification.passed', 'skill.completed', 'run.completed', 'run.failed',
      'slide.update', 'deck.ready', 'artifact.download.ready',
    ].forEach((t) => es.addEventListener(t, onFrame));
    es.onmessage = onFrame; // unnamed frames
  }, [close]);

  /** Rehydrate a run by id (refresh recovery), then resubscribe from last seq. */
  const attach = useCallback(async (runId) => {
    const r = await fetch(`/api/oda/runs/${runId}`);
    if (!r.ok) { localStorage.removeItem(LS_KEY); return false; }
    const full = await r.json();
    const st = hydrate(full);
    lastSeqRef.current = st.events.length ? st.events[st.events.length - 1].seq : 0;
    setRun(st);
    localStorage.setItem(LS_KEY, runId);
    if (!['completed', 'failed', 'cancelled'].includes(full.status)) listen(runId, lastSeqRef.current);
    return true;
  }, [listen]);

  /** Start a new run from the composer. Depth travels structurally — the
   *  backend treats it as authoritative over any prose hint in the text. */
  const start = useCallback(async ({ text, attachments = [], brain = null, output = null, depth = null }) => {
    const r = await fetch('/api/oda/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, attachments, externalUserId: 'oda-workspace', ...(brain ? { brain } : {}), ...(output ? { output } : {}), ...(depth ? { depth } : {}) }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const { runId } = await r.json();
    lastSeqRef.current = 0;
    setRun({ ...EMPTY, runId, status: 'interpreting' });
    localStorage.setItem(LS_KEY, runId);
    listen(runId, 0);
    return runId;
  }, [listen]);

  /** Retry a failed run by re-submitting the SAME request as a fresh run.
   *  A node-level retry can't resume an engine lost to a server restart (the
   *  dominant failure — see runStore orphan sweep), so a clean re-run is the
   *  reliable recovery. */
  const retry = useCallback(async () => {
    const text = run.requestText || run.intent;
    if (!text) throw new Error('Nothing to retry — enter a request and Start run.');
    return start({ text, brain: run.brain || undefined });
  }, [run.requestText, run.intent, run.brain, start]);

  /** Resolve a gate (approve / choice / edits) — the backend resumes the engine. */
  const resolveGate = useCallback(async (gateId, { approved, choice = null, edits = null }) => {
    if (!run.runId) return;
    const r = await fetch(`/api/oda/runs/${run.runId}/gates/${gateId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, choice, edits }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    // Optimistically mark the gate resolved; authoritative state arrives on SSE.
    setRun((prev) => ({
      ...prev,
      gates: prev.gates.map((g) => (g.gateId === gateId ? { ...g, status: approved ? 'approved' : 'rejected' } : g)),
      status: approved ? 'executing' : prev.status,
    }));
  }, [run.runId]);

  /** Conversational continuation: answer the open gate (or leave a note) on
   *  the ACTIVE run instead of forking a new one (RC-5). The backend routes
   *  the text to the open gate if one exists; otherwise it records a note. */
  const sendMessage = useCallback(async (text) => {
    if (!run.runId) throw new Error('No active run to message.');
    const r = await fetch(`/api/oda/runs/${run.runId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const body = await r.json();
    const noneOpen = Array.isArray(body.openGates) && body.openGates.length === 0;
    // Optimistically mark the open gate resolved; authoritative state arrives on SSE.
    setRun((prev) => {
      const open = prev.gates.find((g) => g.status === 'open');
      return {
        ...prev,
        gates: open ? prev.gates.map((g) => (g.gateId === open.gateId ? { ...g, status: 'approved' } : g)) : prev.gates,
        status: noneOpen ? 'executing' : prev.status,
      };
    });
    return body;
  }, [run.runId]);

  const lifecycle = useCallback(async (op) => {
    if (!run.runId) return;
    await fetch(`/api/oda/runs/${run.runId}/${op}`, { method: 'POST' });
    if (op === 'resume') listen(run.runId, lastSeqRef.current);
    if (op === 'cancel') close();
    // status lands via SSE / next hydrate
    await attach(run.runId);
  }, [run.runId, listen, close, attach]);

  const reset = useCallback(() => { close(); lastSeqRef.current = 0; localStorage.removeItem(LS_KEY); setRun(EMPTY); }, [close]);

  /** Fetch one artifact's full content on demand (previews are truncated). */
  const fetchArtifact = useCallback(async (artifactId) => {
    if (!run.runId) return null;
    const r = await fetch(`/api/oda/runs/${run.runId}/artifacts/${artifactId}`);
    return r.ok ? r.json() : null;
  }, [run.runId]);

  // Mount: recover the last run (refresh recovery — paused gates persist).
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) attach(saved).catch(() => localStorage.removeItem(LS_KEY));
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { run, connected, start, retry, attach, resolveGate, sendMessage, lifecycle, reset, fetchArtifact };
}

export { reduceEvent, hydrate };
