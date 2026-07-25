// VisualIntel.jsx — Real-time Visual Intelligence page (Section 19).
// Dual-session UX: the chat column talks to Session A (primary assistant);
// the visual canvas renders Session B (Visual Director) directives — hero
// visual + supporting tray, pause/resume, pin, ask-about-image. Fallback cards
// are typographic or carry the EXACT label 'AI-generated explanatory visual';
// a broken <img> can never render (server pre-validates every URL).
import React, { useCallback, useRef, useState } from 'react';
import { Pin, Pause, Play, ImageOff, MessageSquare } from 'lucide-react';

const ACCENT = '#159a7a';

function VisualCard({ v, onPin, onAsk, hero = false }) {
  if (!v) return null;
  const labeled = v.label && v.label !== 'typographic';
  return (
    <div data-testid={hero ? 'vi-hero' : 'vi-support'} style={{
      background: '#fff', border: `1px solid ${hero ? ACCENT : '#E5E7EB'}`, borderRadius: 12,
      padding: 12, width: hero ? '100%' : 180, boxShadow: '0 1px 2px rgba(29,37,44,.05)',
    }}>
      {v.image_url ? (
        <img src={v.image_url} alt={v.title} style={{ width: '100%', height: hero ? 220 : 90, objectFit: 'cover', borderRadius: 8 }} />
      ) : (
        <div data-testid="vi-typographic" style={{ height: hero ? 220 : 90, display: 'grid', placeItems: 'center', background: 'rgba(21,154,122,.06)', borderRadius: 8, color: '#1D252C', fontFamily: 'Lora, serif', fontSize: hero ? 22 : 13, textAlign: 'center', padding: 8 }}>
          <span><ImageOff size={hero ? 22 : 14} aria-hidden style={{ verticalAlign: '-3px', marginRight: 6, color: ACCENT }} />{v.title}</span>
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: hero ? 14.5 : 12, marginTop: 8 }}>{v.title}</div>
      {v.subtitle && <div style={{ fontSize: 12, color: '#5B6770' }}>{v.subtitle}</div>}
      {labeled && <div data-testid="vi-label" style={{ fontSize: 11, color: ACCENT, marginTop: 4, fontStyle: 'italic' }}>{v.label}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {v.image_url && <button data-testid="vi-pin" onClick={() => onPin?.(v)} style={btn}><Pin size={11} aria-hidden /> Pin</button>}
        {v.image_url && <button data-testid="vi-ask" onClick={() => onAsk?.(v)} style={btn}><MessageSquare size={11} aria-hidden /> Ask about this</button>}
      </div>
    </div>
  );
}
const btn = { border: `1px solid ${ACCENT}`, background: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, color: '#1D252C', display: 'inline-flex', alignItems: 'center', gap: 4 };

export default function VisualIntel({ onExit }) {
  const [viId, setViId] = useState(null);
  const [mode, setMode] = useState('active');
  const [turns, setTurns] = useState([]); // {q, answer, visual, bStatus, ttfvMs}
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState([]);
  const askRef = useRef(null); // when set, next send carries aboutImage

  const ensure = useCallback(async () => {
    if (viId) return viId;
    const r = await fetch('/api/visual-intel/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json();
    setViId(j.viId);
    return j.viId;
  }, [viId]);

  const send = useCallback(async (q) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    try {
      const id = await ensure();
      const body = { viId: id, text: q, aboutImage: askRef.current || null };
      askRef.current = null;
      const r = await fetch('/api/visual-intel/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      setTurns((t) => [...t, { q, ...j }]);
    } catch (e) {
      setTurns((t) => [...t, { q, answer: `Error: ${e.message}`, visual: null, bStatus: 'client_error' }]);
    } finally { setBusy(false); }
  }, [busy, ensure]);

  const toggleMode = useCallback(async () => {
    const id = await ensure();
    const next = mode === 'active' ? 'paused' : 'active';
    await fetch('/api/visual-intel/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viId: id, mode: next }) });
    setMode(next);
  }, [mode, ensure]);

  const pin = useCallback(async (v) => {
    const id = await ensure();
    await fetch('/api/visual-intel/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viId: id, url: v.image_url, title: v.title }) });
    setPinned((p) => [...p, v]);
  }, [ensure]);

  const last = turns[turns.length - 1];
  const vis = last?.visual;

  return (
    <div className="main main--intel" data-testid="vi-page" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, padding: 18, overflow: 'auto' }}>
      {/* Chat column — Session A */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/oda-logo-bw.png" alt="ODA" style={{ height: 26 }} />
          <b style={{ fontSize: 14 }}>Visual Intelligence</b>
          <span data-testid="vi-mode" style={{ marginLeft: 'auto', fontSize: 11, color: mode === 'active' ? ACCENT : '#8C96A0' }}>{mode === 'active' ? 'Visuals live' : 'Visuals paused'}</span>
          <button data-testid="vi-toggle" onClick={toggleMode} style={btn}>{mode === 'active' ? <><Pause size={11} aria-hidden /> Pause visuals</> : <><Play size={11} aria-hidden /> Resume visuals</>}</button>
          {onExit && <button onClick={onExit} style={btn}>Back</button>}
        </div>
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{t.q}</div>
              <div style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>{t.answer}</div>
              <div style={{ fontSize: 10.5, color: '#8C96A0' }}>director: {t.bStatus}{t.ttfvMs != null ? ` · first visual ${t.ttfvMs}ms` : ''}</div>
            </div>
          ))}
          {busy && <div style={{ fontSize: 12, color: ACCENT }}>Working…</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input data-testid="vi-input" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { send(text); setText(''); } }}
            placeholder="Ask the intelligence assistant…" style={{ flex: 1, border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 12px', fontSize: 13 }} />
          <button data-testid="vi-send" onClick={() => { send(text); setText(''); }} disabled={busy} style={{ ...btn, background: ACCENT, color: '#fff' }}>Send</button>
        </div>
      </div>
      {/* Visual canvas — Session B */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {vis?.world_focus?.region && (
          <div data-testid="vi-worldfocus" style={{ fontSize: 12, color: ACCENT }}>World focus: {vis.world_focus.region} ({vis.world_focus.lat}, {vis.world_focus.lng})</div>
        )}
        {vis ? <VisualCard v={vis.hero} hero onPin={pin} onAsk={(v) => { askRef.current = `${v.title} — ${v.image_url}`; }} />
          : <div style={{ color: '#8C96A0', fontSize: 13 }}>Visuals appear here as the conversation develops.</div>}
        {vis?.supporting?.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {vis.supporting.map((s, i) => <VisualCard key={i} v={s} onPin={pin} onAsk={(v) => { askRef.current = `${v.title} — ${v.image_url}`; }} />)}
          </div>
        )}
        {pinned.length > 0 && (
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em', color: ACCENT, marginBottom: 6 }}>Pinned</div>
            <div data-testid="vi-pinned" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {pinned.map((p, i) => <VisualCard key={i} v={p} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
