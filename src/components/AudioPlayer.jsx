import React, { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.js';

/**
 * Read-aloud control on assistant messages — ChatGPT-inspired minimal voice UI.
 *  • idle: slim speaker SVG icon button
 *  • fetching: the icon pulses with a soft waveform-shimmer animation (no spinner)
 *  • playing: compact animated equalizer bars + small stop control
 *  • settings: speed (0.75–2×) + voice tucked into a '···' popover, no native dropdowns
 *  • AUTO-PLAY: playback starts the moment the OnDemand TTS audioUrl returns —
 *    the initiating click on the speaker is the user gesture, so autoplay is allowed.
 * All audio comes from the REAL OnDemand text_to_speech service via /api/speech/tts
 * (server parses the verified {message, data:{audioUrl}} shape). Nothing mocked.
 */
const VOICES = [
  { id: 'alloy',   label: 'Alloy' },
  { id: 'echo',    label: 'Echo' },
  { id: 'fable',   label: 'Fable' },
  { id: 'onyx',    label: 'Onyx · Arabic' },
  { id: 'nova',    label: 'Nova' },
  { id: 'shimmer', label: 'Shimmer' },
];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const CHUNK = 3500; // chars per TTS part (service input cap ~4k)

function chunkText(text) {
  const parts = [];
  let rest = (text || '').replace(/```[\s\S]*?```/g, ' ').trim(); // strip code blocks from speech
  while (rest.length > 0) {
    if (rest.length <= CHUNK) { parts.push(rest); break; }
    let cut = rest.lastIndexOf('. ', CHUNK);
    if (cut < CHUNK * 0.5) cut = CHUNK;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  return parts.filter(p => p.trim());
}

/** EN/AR auto-detect: predominantly Arabic text routes to the Arabic-designated voice (onyx). */
function detectDefaultVoice(text) {
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return arabic > latin ? 'onyx' : 'alloy';
}

const SpeakerIcon = ({ muted }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    {muted
      ? <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
  </svg>
);

const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);

/** Compact animated equalizer shown while audio plays. */
const Equalizer = () => (
  <span className="voice__eq" aria-hidden="true">
    <i /><i /><i /><i />
  </span>
);

export default function AudioPlayer({ text }) {
  const [state, setState] = useState('idle'); // idle | fetching | playing | paused | failed | unavailable
  const [urls, setUrls] = useState([]);
  const [part, setPart] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [voice, setVoice] = useState(() => detectDefaultVoice(text || ''));
  const [menuOpen, setMenuOpen] = useState(false);
  const [err, setErr] = useState(null);
  const audioRef = useRef(null);
  const menuRef = useRef(null);

  /* close popover on outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = speed;
  }, [speed, urls, part]);

  const stop = () => {
    const a = audioRef.current;
    if (a) { a.pause(); a.currentTime = 0; }
    setState('idle'); setPart(0); setUrls([]);
  };

  /** Fetch TTS then AUTO-PLAY — no second press. The speaker click is the gesture. */
  const generateAndPlay = async (v = voice) => {
    setState('fetching'); setErr(null); setUrls([]); setPart(0); setMenuOpen(false);
    try {
      const parts = chunkText(text);
      if (!parts.length) { setState('failed'); setErr('Nothing to read aloud.'); return; }
      const out = [];
      for (const p of parts.slice(0, 4)) { // bound cost: first 4 chunks (~14k chars)
        const r = await fetch('/api/speech/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: p, voice: v }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok && (j.url || j.hostedUrl)) out.push(j.url || j.hostedUrl);
        else {
          const e = j?.error || {};
          if (e.errorCode === 'SERVICE_NOT_SUBSCRIBED') { setState('unavailable'); setErr(t('speechUnavailable')); return; }
          throw new Error(`${e.userMessage || 'TTS failed'}${e.errorCode ? ` [${e.errorCode}]` : ''}`);
        }
      }
      setUrls(out);
      setState('playing'); // <audio autoPlay> starts immediately on src mount
    } catch (e) {
      setState('failed'); setErr(e.message);
    }
  };

  const onEnded = () => {
    if (part < urls.length - 1) setPart(part + 1); // next chunk auto-plays via autoPlay
    else stop();
  };

  /* keep playing across chunk advance */
  useEffect(() => {
    const a = audioRef.current;
    if (a && state === 'playing') a.play().catch(() => setState('paused'));
  }, [part, urls]);

  const togglePause = () => {
    const a = audioRef.current;
    if (!a) return;
    if (state === 'playing') { a.pause(); setState('paused'); }
    else { a.play().catch(() => {}); setState('playing'); }
  };

  if (state === 'unavailable') {
    return (
      <button className="voice__btn voice__btn--disabled" disabled
        title={err || 'Speech services are not enabled on this OnDemand workspace yet.'}
        aria-label="Audio unavailable">
        <SpeakerIcon muted />
      </button>
    );
  }

  if (state === 'failed') {
    return (
      <span className="voice__note" role="alert">
        {err} <button className="voice__retry" onClick={() => generateAndPlay()}>{t('retry')}</button>
      </span>
    );
  }

  if (state === 'idle') {
    return (
      <button className="voice__btn" onClick={() => generateAndPlay()} aria-label={t('listen')} title={t('listen')}>
        <SpeakerIcon />
      </button>
    );
  }

  if (state === 'fetching') {
    return (
      <span className="voice__btn voice__btn--fetching" aria-live="polite" title={t('preparing')}>
        <span className="voice__pulse" aria-hidden="true"><i /><i /><i /><i /></span>
      </span>
    );
  }

  /* playing | paused — compact floating-style control strip */
  return (
    <div className="voice" role="group" aria-label="Read aloud">
      <audio ref={audioRef} src={urls[part]} preload="auto" autoPlay
        onEnded={onEnded} onError={() => { setState('failed'); setErr('Audio failed to load.'); }} />
      <button className="voice__btn voice__btn--active" onClick={togglePause}
        aria-label={state === 'playing' ? t('pause') : t('play')} title={state === 'playing' ? t('pause') : t('play')}>
        {state === 'playing' ? <Equalizer /> : <SpeakerIcon />}
      </button>
      <button className="voice__btn voice__btn--stop" onClick={stop} aria-label={t('stop')} title={t('stop')}>
        <StopIcon />
      </button>
      {urls.length > 1 && <span className="voice__part">{part + 1}/{urls.length}</span>}
      <div className="voice__menuwrap" ref={menuRef}>
        <button className="voice__btn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu"
          aria-expanded={menuOpen} aria-label="Voice settings" title="Voice settings">
          <DotsIcon />
        </button>
        {menuOpen && (
          <div className="voice__menu" role="menu">
            <div className="voice__menuhead">Speed</div>
            <div className="voice__chips">
              {SPEEDS.map(s => (
                <button key={s} role="menuitemradio" aria-checked={speed === s}
                  className={`voice__chip${speed === s ? ' on' : ''}`}
                  onClick={() => { setSpeed(s); }}>{s}×</button>
              ))}
            </div>
            <div className="voice__menuhead">Voice</div>
            <div className="voice__voices">
              {VOICES.map(v => (
                <button key={v.id} role="menuitemradio" aria-checked={voice === v.id}
                  className={`voice__voice${voice === v.id ? ' on' : ''}`}
                  onClick={() => { setVoice(v.id); generateAndPlay(v.id); }}>{v.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
