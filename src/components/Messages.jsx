import React, { useEffect, useRef, useState } from 'react';
import { Markdown, dissect } from '../markdown.jsx';
import BilingualLoader from './BilingualLoader.jsx';
import AudioPlayer from './AudioPlayer.jsx';

/* ---------- STEP 4: thinking accordion ---------- */
export function ThinkingAccordion({ thinking, live, forceOpenWhileLive }) {
  const [open, setOpen] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const bodyRef = useRef(null);

  // Live-streaming while open by default; auto-collapse when the answer starts (live=false)
  const effectiveOpen = userToggled ? open : (live && forceOpenWhileLive);

  useEffect(() => {
    if (effectiveOpen && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thinking, effectiveOpen]);

  if (!thinking) return null;
  return (
    <div className="think">
      <button className="think__head" onClick={() => { setUserToggled(true); setOpen(!effectiveOpen); }}>
        <span className={`think__dot${live ? '' : ' idle'}`} />
        {live ? 'Thinking…' : 'Thought process'}
        <span style={{ flex: 1 }} />
        <span className={`chev${effectiveOpen ? ' open' : ''}`}>▶</span>
      </button>
      {effectiveOpen && <div className="think__body" ref={bodyRef}>{thinking}</div>}
    </div>
  );
}

/* ---------- STEP 5: routing trace — ONE slim muted line under the answer ---------- */
export function TraceCard({ routing }) {
  if (!routing) return null;
  return (
    <div className="trace-line" title={routing.reason || ''}>
      {routing.feature} · {routing.mode} · {routing.plugins?.length
        ? routing.plugins.join(', ')
        : 'LLM-direct'} · {routing.model}
    </div>
  );
}

/* ---------- Inline tool-call lines — driven by REAL step_output plugin frames ----------
 * The upstream step_output channel streams the plugin invocation JSON as deltas
 * (live-captured 2026-07-17: {"plugins":[{pluginId,name,api_request_parameters,…}]}).
 * While the JSON is still partial → spinner state; once parseable → each plugin gets a
 * slim line "⚙ name → query" with spinner→✓ (done = answer started), expandable args. */
export function ToolCallLines({ raw, done }) {
  const [openIdx, setOpenIdx] = useState(null);
  if (!raw) return null;
  let plugins = null;
  try { plugins = JSON.parse(raw)?.plugins || null; } catch { /* still streaming */ }
  if (!plugins) {
    return <div className="toolline"><span className="toolline__spin" aria-hidden="true" /> <span className="toolline__name">Preparing tool call…</span></div>;
  }
  return (
    <div className="toollines">
      {plugins.map((p, i) => {
        const target = p.api_request_parameters?.query || p.api_request_parameters?.url
          || Object.values(p.api_request_parameters || {})[0] || '';
        return (
          <div key={i} className="toolline">
            {done ? <span className="toolline__check" aria-hidden="true">✓</span> : <span className="toolline__spin" aria-hidden="true" />}
            <button className="toolline__btn" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
              ⚙ {p.name || p.pluginId} {target ? <span className="toolline__target">→ {String(target).slice(0, 80)}</span> : null}
            </button>
            {openIdx === i && (
              <pre className="toolline__args">{JSON.stringify(p.api_request_parameters || {}, null, 2)}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- STEP 7: artifact card ---------- */
export function ArtifactCard({ artifact }) {
  const fmt = artifact.format?.toUpperCase() || artifact.name.split('.').pop().toUpperCase();
  return (
    <div className="artifact">
      <div className="artifact__icon">{fmt}</div>
      <div className="artifact__meta">
        <div className="artifact__name">{artifact.name}</div>
        <div className="artifact__sub">{fmt} · {(artifact.size / 1024).toFixed(0)} kB · {new Date(artifact.createdAt).toLocaleTimeString('en-GB')}</div>
        {artifact.citations?.length > 0 && (
          <div className="artifact__cites">Citations: {artifact.citations.slice(0, 3).join(' · ')}{artifact.citations.length > 3 ? ` +${artifact.citations.length - 3} more` : ''}</div>
        )}
        {artifact.gaps?.length > 0 && (
          <div className="artifact__gaps">⚠ Gaps (unverifiable): {artifact.gaps.slice(0, 2).join(' · ')}{artifact.gaps.length > 2 ? '…' : ''}</div>
        )}
      </div>
      <div className="artifact__btns">
        <a className="primary" href={`/api/export/${artifact.id}/download`} download>Download</a>
        <a href={`/api/export/${artifact.id}/download`} target="_blank" rel="noreferrer">Open preview</a>
      </div>
    </div>
  );
}

/* ---------- STEP 8: skeleton naming the actual plugin ---------- */
export function PluginSkeleton({ label }) {
  // Workstream-2: bilingual rotating-word loader COEXISTS with the named plugin
  // status line (label) on the same row; static spinner removed.
  return (
    <div className="skel">
      <BilingualLoader size="md" label={label} />
      <div className="skel__bar" />
    </div>
  );
}

/* ---------- assistant message ---------- */
export function AssistantMessage({ msg, live, onOption, onExport, exportBusy, artifacts }) {
  const { body, options } = dissect(msg.text || '');
  const showExports = !live && (msg.text || '').length > 120;
  return (
    <div className="msg-asst">
      {/* Layer 1 — thinking line (real thinking deltas only; auto-collapses on first answer token) */}
      <ThinkingAccordion thinking={msg.thinking} live={Boolean(live && !msg.answerStarted)} forceOpenWhileLive={true} />
      {/* Layer 2 — inline tool-call lines from REAL step_output plugin frames */}
      <ToolCallLines raw={msg.toolCallRaw} done={Boolean(msg.answerStarted || !live)} />
      {/* Loader vanishes on the FIRST token: fulfillment (answerStarted) OR any thinking delta. */}
      {live && !msg.answerStarted && !msg.thinking && <PluginSkeleton label={msg.pluginStatus || 'Routing your request…'} />}
      {/* Layer 3 — streamed answer */}
      <Markdown text={body} />
      {live && <span className="cursor-blink" />}
      {!live && options.length > 0 && (
        <div className="options">
          {options.map((o, i) => <button key={i} onClick={() => onOption?.(o)}>{o}</button>)}
        </div>
      )}
      {(msg.artifactIds || []).map(id => artifacts[id] && <ArtifactCard key={id} artifact={artifacts[id]} />)}
      {/* Per-assistant-message speaker: OnDemand TTS playback (fetch-then-play; Arabic voice offered via voice select). */}
      {!live && (msg.text || '').length > 40 && <AudioPlayer text={body} />}
      {showExports && (
        <div className="exportbar">
          <span>Export:</span>
          {['pptx', 'docx', 'pdf', 'xlsx'].map(f => (
            <button key={f} disabled={exportBusy} onClick={() => onExport?.(msg.id, f)}>{f.toUpperCase()}</button>
          ))}
          {exportBusy && <BilingualLoader size="sm" label="Generating document…" />}
        </div>
      )}
      <TraceCard routing={msg.routing} />
    </div>
  );
}

export function UserMessage({ msg }) {
  return (
    <div className="msg-user">
      <div>
        <div className="bubble" dir="auto">{msg.text}</div>
        {msg.fileName && <div className="fileref">📎 {msg.fileName}</div>}
      </div>
    </div>
  );
}
