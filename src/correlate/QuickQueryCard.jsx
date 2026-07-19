// QuickQueryCard.jsx — ⚡ floating micro-answer card (GLM-4.7 Cerebras, streaming).
// Attach via <QuickQueryZap artifact={...}/> next to any mini-artifact (edge row,
// evidence card, narrative sentence, stat). Preloaded EN/AR ODA chips + micro
// prompt + live ms latency stamp + 'Continue in chat →' handoff.
import React, { useRef, useState } from 'react';
import { Zap, Send, ArrowRight, X } from 'lucide-react';

const CHIPS = [
  { q: 'Why does this edge matter to ODA?', lang: 'en' },
  { q: 'What changed vs yesterday?', lang: 'en' },
  { q: 'أثر هذا على دولة الإمارات؟', lang: 'ar' },
  { q: 'ما الخطوة التالية المقترحة؟', lang: 'ar' },
];

export function QuickQueryZap({ artifact, label = 'Quick Query', onContinueInChat }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="qq-anchor">
      <button className="qq-zap" title={`⚡ ${label}`} aria-label={`Quick Query on ${label}`}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>
        <Zap size={12} strokeWidth={2.4} />
      </button>
      {open && <QuickQueryCard artifact={artifact} onClose={() => setOpen(false)} onContinueInChat={onContinueInChat} />}
    </span>
  );
}

export default function QuickQueryCard({ artifact, onClose, onContinueInChat }) {
  const [answer, setAnswer] = useState('');
  const [ms, setMs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [micro, setMicro] = useState('');
  const lastQ = useRef('');

  const ask = async (q, lang) => {
    setBusy(true); setAnswer(''); setMs(null); setErr(null); lastQ.current = q;
    const t0 = performance.now();
    try {
      const res = await fetch('/api/quickquery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact, question: q, lang }),
      });
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (frame.match(/^event: (.+)$/m) || [])[1];
          const dl = (frame.match(/^data: (.+)$/m) || [])[1];
          if (!dl || dl === '[DONE]') continue;
          let d; try { d = JSON.parse(dl); } catch { continue; }
          if (ev === 'delta') setAnswer(a => a + d.text);
          else if (ev === 'done') setMs(d.ms ?? Math.round(performance.now() - t0));
          else if (ev === 'error') setErr(d.message);
        }
      }
      if (ms == null) setMs(m => m ?? Math.round(performance.now() - t0));
    } catch (e) { setErr(String(e.message)); }
    setBusy(false);
  };

  const isAr = /[\u0600-\u06FF]/.test(answer || lastQ.current);
  return (
    <div className="qq-card" onClick={e => e.stopPropagation()} dir={isAr ? 'rtl' : 'ltr'}>
      <div className="qq-card__head">
        <span><Zap size={12} /> Quick Query <em>GLM-4.7 · Cerebras</em></span>
        {ms != null && <span className="qq-ms" title="server-measured latency">{ms} ms</span>}
        <button className="qq-close" onClick={onClose} aria-label="Close"><X size={12} /></button>
      </div>
      <div className="qq-chips">
        {CHIPS.map(c => (
          <button key={c.q} dir={c.lang === 'ar' ? 'rtl' : 'ltr'} className="qq-chip"
            disabled={busy} onClick={() => ask(c.q, c.lang)}>{c.q}</button>
        ))}
      </div>
      <form className="qq-micro" onSubmit={e => { e.preventDefault(); if (micro.trim()) ask(micro.trim(), /[\u0600-\u06FF]/.test(micro) ? 'ar' : 'en'); }}>
        <input value={micro} onChange={e => setMicro(e.target.value)} placeholder="One-line question…" aria-label="Micro prompt" />
        <button type="submit" disabled={busy || !micro.trim()} aria-label="Ask"><Send size={12} /></button>
      </form>
      {(answer || busy) && <p className={`qq-answer${busy ? ' qq-answer--busy' : ''}`}>{answer || '…'}</p>}
      {err && <p className="qq-err">{err}</p>}
      <button className="qq-continue" onClick={() => onContinueInChat?.(artifact, lastQ.current, answer)}>
        Continue in chat <ArrowRight size={12} />
      </button>
    </div>
  );
}
