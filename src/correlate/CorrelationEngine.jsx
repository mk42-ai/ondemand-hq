// CorrelationEngine.jsx — Phase C visual layer. Obsidian-futuristic-on-white ODA
// design: react-force-graph-2d canvas (custom node draw: big country node, UAE
// entity initials, IG proof thumbnails; directional particles w/ recency-scaled
// speed; hover highlight + 15% dim; new-edge pulse from the daily diff), graphology
// PageRank/Louvain pre-pass (graphAdapter.js), controls rail (type chips, time +
// min-weight sliders, labels/physics toggles, date scrubber), ECharts cross-filter
// panels + novel D3 heat ring (EvidencePanels.jsx), hover proof popover, click
// lightbox + evidence drawer w/ 'Send to chat', bilingual EN/AR regeneration
// loader (RTL-safe), PNG + evidence-JSON export, ⚡ Quick Query everywhere.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { RefreshCw, Download, GitBranch, AlertTriangle, Search, Image as ImgIcon, X, ExternalLink, MessageSquare } from 'lucide-react';
import { adaptRun, filterGraph, TYPE_COLORS, PLATFORM_GLYPH } from './graphAdapter.js';
import EvidencePanels from './EvidencePanels.jsx';
import QuickQueryCard, { QuickQueryZap } from './QuickQueryCard.jsx';
import BilingualLoader from '../components/BilingualLoader.jsx';
import { LANG } from '../i18n.js';

const COUNTRIES = [{ iso: 'EG', name: 'Egypt' }];
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

export default function CorrelationEngine({ onExit, onSendToChat }) {
  const [iso, setIso] = useState('EG');
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const [err, setErr] = useState(null);
  // controls
  const [typeFilter, setTypeFilter] = useState(new Set());
  const [minWeight, setMinWeight] = useState(0);
  const [maxAgeDays, setMaxAgeDays] = useState(60);
  const [showLabels, setShowLabels] = useState(true);
  const [physics, setPhysics] = useState(true);
  const [platformFilter, setPlatformFilter] = useState(null);
  const [query, setQuery] = useState('');
  // interaction state
  const [hoverNode, setHoverNode] = useState(null);
  const [hoverLink, setHoverLink] = useState(null);
  const [popover, setPopover] = useState(null);       // {x, y, kind, data}
  const [lightbox, setLightbox] = useState(null);      // evidence record w/ media
  const [drawer, setDrawer] = useState(null);          // node or link → evidence list
  const [fps, setFps] = useState(null);
  const fgRef = useRef();
  const wrapRef = useRef();
  const imgCache = useRef({});
  const pulseT0 = useRef(Date.now());

  const evIndex = useMemo(() => Object.fromEntries(evidence.map(e => [e.id, e])), [evidence]);

  const loadRuns = useCallback(async (pickLatest = true) => {
    const r = await fetch(`/api/correlate/runs/${iso}`).then(x => x.json()).catch(() => ({ runs: [] }));
    setRuns(r.runs || []);
    if (pickLatest && r.runs?.length) setRunId(r.runs[r.runs.length - 1].id);
  }, [iso]);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => {
    fetch(`/api/correlate/evidence/${iso}`).then(x => x.json()).then(d => setEvidence(d.evidence || [])).catch(() => setEvidence([]));
  }, [iso, runId]);
  useEffect(() => {
    if (!runId) { setRun(null); return; }
    fetch(`/api/correlate/run/${iso}/${runId}`).then(x => x.json()).then(d => { setRun(d.run); pulseT0.current = Date.now(); })
      .catch(() => setErr('run load failed'));
  }, [iso, runId]);

  // Adapter + graphology pre-pass (pure — scrubber just feeds a different run).
  const adapted = useMemo(() => adaptRun(run, evIndex), [run, evIndex]);
  const graphData = useMemo(() => {
    let g = filterGraph(adapted, { types: typeFilter, minWeight, maxAgeDays });
    if (platformFilter) {
      const links = g.links.filter(l => (l.platforms || []).includes(platformFilter));
      const keep = new Set(links.flatMap(l => [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target]));
      g = { nodes: g.nodes.filter(n => keep.has(n.id)), links };
    }
    return g;
  }, [adapted, typeFilter, minWeight, maxAgeDays, platformFilter]);

  // Preload IG proof thumbnails for canvas drawing.
  useEffect(() => {
    for (const n of adapted.nodes) {
      if (n.img && !imgCache.current[n.img]) {
        const im = new Image(); im.src = n.img;
        im.onload = () => { imgCache.current[n.img] = im; };
      }
    }
  }, [adapted]);

  // Hover neighborhood highlight sets.
  const hoverSets = useMemo(() => {
    if (!hoverNode) return null;
    const nids = new Set([hoverNode.id]); const lids = new Set();
    for (const l of graphData.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === hoverNode.id || t === hoverNode.id) { lids.add(l.id); nids.add(s); nids.add(t); }
    }
    return { nids, lids };
  }, [hoverNode, graphData]);

  // zoomToFit on data load; FPS probe (~2s) for the 60fps budget check.
  useEffect(() => {
    if (!fgRef.current || !graphData.nodes.length) return;
    const t = setTimeout(() => fgRef.current && fgRef.current.zoomToFit(600, 60), 700);
    let frames = 0; const t0 = performance.now(); let raf;
    const tick = () => { frames++; if (performance.now() - t0 < 2000) raf = requestAnimationFrame(tick); else setFps(Math.round(frames / 2)); };
    raf = requestAnimationFrame(tick);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, [graphData.nodes.length, runId]);

  const searchGo = (e) => {
    e.preventDefault();
    const q = query.trim().toLowerCase(); if (!q || !fgRef.current) return;
    const n = graphData.nodes.find(n => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
    if (n && n.x != null) { fgRef.current.centerAt(n.x, n.y, 600); fgRef.current.zoom(4, 600); setHoverNode(n); }
  };

  const exportPNG = () => {
    const canvas = wrapRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `correlation-${iso}-${runId}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  const regenerate = async () => {
    setBusy(true); setErr(null); setLive({ thinking: '', tool: '', status: LANG === 'ar' ? 'جارٍ التشغيل…' : 'Running…' });
    try {
      const res = await fetch(`/api/correlate/regenerate/${iso}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: COUNTRIES.find(c => c.iso === iso)?.name || iso, trigger: 'manual' }),
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
          if (ev === 'planning_thinking' || ev === 'step_thinking') {
            const t = d?.thinking?.delta; if (t) setLive(l => ({ ...l, thinking: ((l?.thinking || '') + t).slice(-1500) }));
          } else if (ev === 'step_output') {
            const t = d?.output?.delta; if (t) setLive(l => ({ ...l, tool: ((l?.tool || '') + t).slice(-400) }));
          } else if (ev === 'statusLog') setLive(l => ({ ...l, status: d?.currentStatusLog?.statusMessage || l?.status }));
          else if (ev === 'run') setLive(l => ({ ...l, status: `v${d.version} · ${d.evidenceCount} evidence · ${d.edges} edges` }));
          else if (ev === 'error') setErr(d.message);
        }
      }
      await loadRuns(true);
    } catch (e) { setErr(String(e.message)); }
    setBusy(false); setTimeout(() => setLive(null), 3500);
  };

  // ---------- custom canvas painters ----------
  const paintNode = useCallback((node, ctx, scale) => {
    const dimmed = hoverSets && !hoverSets.nids.has(node.id);
    ctx.globalAlpha = dimmed ? 0.15 : 1;
    const r = Math.max(4, Math.sqrt(node.val) * 1.6);
    const isCountry = node.type === 'country' && node.id !== 'UAE';
    const R = isCountry ? r * 1.9 : node.id === 'UAE' ? r * 1.6 : r;
    // community tint halo
    ctx.beginPath(); ctx.arc(node.x, node.y, R + 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = node.tint + '22'; ctx.fill();
    const img = node.img && imgCache.current[node.img];
    if (img) {
      // IG-backed node: draw the downloaded proof thumbnail clipped in a circle
      ctx.save(); ctx.beginPath(); ctx.arc(node.x, node.y, R, 0, 2 * Math.PI); ctx.clip();
      ctx.drawImage(img, node.x - R, node.y - R, R * 2, R * 2); ctx.restore();
      ctx.beginPath(); ctx.arc(node.x, node.y, R, 0, 2 * Math.PI);
      ctx.lineWidth = 1.2 / scale; ctx.strokeStyle = '#c13584'; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(node.x, node.y, R, 0, 2 * Math.PI);
      ctx.fillStyle = isCountry ? '#b08d3c' : node.id === 'UAE' ? '#0f172a' : '#0f6b5c';
      ctx.fill();
      // UAE entity initials inside the disc
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${Math.max(2.6, R * 0.62)}px Montserrat, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(node.id.slice(0, isCountry ? 2 : 3), node.x, node.y + 0.2);
    }
    if (showLabels && scale > 1.2) {
      ctx.font = `${3.4}px Montserrat, sans-serif`; ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${node.label}${node.glyphs ? ' ' + node.glyphs : ''}`, node.x, node.y + R + 1.5);
    }
    ctx.globalAlpha = 1;
  }, [hoverSets, showLabels]);

  const paintLink = useCallback((link, ctx) => {
    // new-edge pulse: expanding ring at link midpoint for ~6s after run load
    if (!link.isNew) return;
    const age = (Date.now() - pulseT0.current) % 2200;
    const s = typeof link.source === 'object' ? link.source : null;
    const t = typeof link.target === 'object' ? link.target : null;
    if (!s || !t || s.x == null) return;
    const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
    const rr = 2 + (age / 2200) * 9;
    ctx.beginPath(); ctx.arc(mx, my, rr, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(176,141,60,${1 - age / 2200})`; ctx.lineWidth = 1.1; ctx.stroke();
  }, []);

  const openDrawer = (kind, data) => {
    const ids = kind === 'node' ? data.evidenceIds : data.evidenceIds;
    setDrawer({ kind, data, evidence: (ids || []).map(id => evIndex[id]).filter(Boolean) });
  };

  const narrativeParts = useMemo(() => run?.narrative?.text ? run.narrative.text.split(/(\[E:[^\]]+\])/g) : [], [run]);

  return (
    <div className="corr" ref={wrapRef}>
      <header className="corr-head">
        <div>
          <h1><GitBranch size={20} style={{ verticalAlign: '-3px' }} /> Correlation Engine</h1>
          <p>{run ? `${run.model} · run ${run.id} · ${run.evidenceCount} evidence` : 'no runs yet'}{fps != null && DEBUG ? ` · ${fps}fps` : ''}</p>
        </div>
        <div className="corr-head__actions">
          <form onSubmit={searchGo} className="corr-search">
            <Search size={13} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find node…" aria-label="Search node" />
          </form>
          <select value={iso} onChange={e => setIso(e.target.value)} aria-label="Country">
            {COUNTRIES.map(c => <option key={c.iso} value={c.iso}>{c.name}</option>)}
          </select>
          <button className="corr-btn" onClick={regenerate} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? (LANG === 'ar' ? 'جارٍ…' : 'Running…') : 'Regenerate now'}
          </button>
          <button className="corr-btn corr-btn--ghost" onClick={exportPNG} title="Export canvas as PNG"><ImgIcon size={14} /> PNG</button>
          {run && <a className="corr-btn corr-btn--ghost" href={`/api/correlate/download/${iso}/${run.id}`} download><Download size={14} /> JSON</a>}
          <button className="corr-btn corr-btn--ghost" onClick={onExit}>Close</button>
        </div>
      </header>

      {runs.length > 0 && (
        <div className="corr-scrubber" role="tablist" aria-label="Run versions (date scrubber)">
          {runs.map(r => (
            <button key={r.id} role="tab" aria-selected={r.id === runId}
              className={`corr-chip${r.id === runId ? ' active' : ''}`} onClick={() => setRunId(r.id)}
              title={`${r.model} · ${r.evidenceCount} evidence · +${r.diffSummary.newEdges}/−${r.diffSummary.removedEdges} edges`}>
              v{r.version} · {new Date(r.generatedAt).toUTCString().slice(5, 22)}
            </button>
          ))}
        </div>
      )}

      {busy && <BilingualLoader size="md" label={LANG === 'ar' ? 'محرك الترابط' : 'Correlation Engine'} />}
      {live && (
        <div className="corr-live">
          <div className="corr-live__status">{live.status}</div>
          {live.thinking && <details open className="corr-live__think"><summary>Thinking…</summary><pre>{live.thinking}</pre></details>}
          {live.tool && <pre className="corr-live__tool">{live.tool}</pre>}
        </div>
      )}
      {err && <div className="corr-err"><AlertTriangle size={14} /> {err}</div>}

      {run && (
        <section className="corr-narrative">
          <h2>Connected Dots <QuickQueryZap artifact={{ narrative: run.narrative.text, runId: run.id }} label="narrative" onContinueInChat={onSendToChat} /></h2>
          <p dir="auto">
            {narrativeParts.map((part, i) => /^\[E:/.test(part)
              ? <button key={i} className="corr-cite" title="open evidence"
                  onClick={() => { const id = 'E' + part.slice(3, -1).split(',')[0].replace(/^E:?/, ''); const ev = evIndex[id]; if (ev) setLightbox(ev); }}>{part}</button>
              : <span key={i}>{part}</span>)}
          </p>
        </section>
      )}

      <div className="corr-main">
        {/* controls rail */}
        <aside className="corr-rail" aria-label="Graph controls">
          <h3>Relationship</h3>
          <div className="corr-rail__chips">
            {Object.keys(TYPE_COLORS).map(t => (
              <button key={t} className={`corr-typechip${typeFilter.size === 0 || typeFilter.has(t) ? ' on' : ''}`}
                style={{ '--c': TYPE_COLORS[t] }}
                onClick={() => setTypeFilter(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}>{t}</button>
            ))}
            {typeFilter.size > 0 && <button className="corr-clearchip" onClick={() => setTypeFilter(new Set())}>all</button>}
          </div>
          <h3>Time range <small>{maxAgeDays}d</small></h3>
          <input type="range" min="3" max="60" value={maxAgeDays} onChange={e => setMaxAgeDays(+e.target.value)} aria-label="Max evidence age (days)" />
          <h3>Min weight <small>{minWeight.toFixed(2)}</small></h3>
          <input type="range" min="0" max="0.8" step="0.01" value={minWeight} onChange={e => setMinWeight(+e.target.value)} aria-label="Minimum edge weight" />
          <label className="corr-toggle"><input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> Labels</label>
          <label className="corr-toggle"><input type="checkbox" checked={physics} onChange={e => setPhysics(e.target.checked)} /> Physics</label>
          <div className="corr-legend corr-legend--rail">
            {Object.entries(PLATFORM_GLYPH).map(([p, g]) => <span key={p}>{g} {p}</span>)}
            <span>⚠ contradiction</span><span>◉ pulse = new vs prev run</span>
          </div>
        </aside>

        {/* the canvas */}
        <div className="corr-canvas" aria-label="Evidence graph canvas">
          {run && (
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              width={Math.max(520, Math.min(1080, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 620))}
              height={470}
              backgroundColor="#ffffff"
              cooldownTicks={physics ? 120 : 0}
              enableNodeDrag={true}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node, color, ctx) => { const r = Math.max(6, Math.sqrt(node.val) * 2.2); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI); ctx.fill(); }}
              linkColor={l => hoverSets ? (hoverSets.lids.has(l.id) ? l.baseColor : 'rgba(15,23,42,0.06)') : l.color}
              linkWidth={l => hoverSets && hoverSets.lids.has(l.id) ? l.width + 1.2 : l.width}
              linkLineDash={l => (l.contradiction ? [4, 2] : null)}
              linkDirectionalParticles={l => l.particles}
              linkDirectionalParticleSpeed={l => l.particleSpeed}
              linkDirectionalParticleWidth={l => 1.4 + l.weight * 2.4}
              linkCanvasObjectMode={() => 'after'}
              linkCanvasObject={paintLink}
              onNodeHover={(n, prev) => { setHoverNode(n || null); if (!n) setPopover(p => p?.kind === 'node' ? null : p); }}
              onLinkHover={(l) => {
                setHoverLink(l || null);
                if (l) {
                  const ev = (l.evidenceIds || []).map(id => evIndex[id]).filter(Boolean);
                  setPopover({ kind: 'link', data: l, evidence: ev });
                } else setPopover(p => p?.kind === 'link' ? null : p);
              }}
              onNodeClick={(n) => openDrawer('node', n)}
              onLinkClick={(l) => openDrawer('link', l)}
            />
          )}
          {/* hover proof popover */}
          {popover?.kind === 'link' && popover.evidence?.length > 0 && (
            <div className="corr-pop" dir="auto">
              <b>{popover.data.type}</b> — {popover.data.claim} {popover.data.contradiction && '⚠'}
              {popover.evidence.slice(0, 2).map(ev => (
                <div key={ev.id} className="corr-pop__ev">
                  <span className="corr-pop__src">{PLATFORM_GLYPH[ev.platform] || '•'} {ev.source} · {ev.publishDate || 'n.d.'}</span>
                  <span className="corr-pop__snip">{ev.snippet?.slice(0, 140)}</span>
                  {(ev.media || []).length > 0 && (
                    <span className="corr-pop__thumbs">
                      {ev.media.slice(0, 2).map(m => <img key={m} src={m} alt="IG proof" onClick={() => setLightbox(ev)} />)}
                    </span>
                  )}
                </div>
              ))}
              <em>click edge for full evidence drawer</em>
            </div>
          )}
        </div>

        {/* ECharts + D3 panels */}
        <EvidencePanels evidence={platformFilter ? evidence.filter(e => e.platform === platformFilter) : evidence}
          run={run} activePlatform={platformFilter}
          onFilterPlatform={setPlatformFilter}
          onFilterDate={() => { /* date click narrows time slider to 7d around it */ setMaxAgeDays(7); }} />
      </div>

      {/* lightbox */}
      {lightbox && (
        <div className="corr-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Evidence lightbox">
          <div className="corr-lightbox__box" onClick={e => e.stopPropagation()} dir="auto">
            <button className="corr-lightbox__x" onClick={() => setLightbox(null)}><X size={16} /></button>
            {(lightbox.media || []).map(m => <img key={m} src={m} alt="proof full" className="corr-lightbox__img" />)}
            <h3>{lightbox.source} {lightbox.platform === 'instagram' && <span className="corr-verified">verified</span>}</h3>
            <p>{lightbox.claim}</p>
            <div className="corr-lightbox__row">
              <a href={lightbox.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> open source</a>
              <span>{lightbox.publishDate || 'n.d.'} · conf {lightbox.confidence}</span>
              <QuickQueryZap artifact={lightbox} label="evidence" onContinueInChat={onSendToChat} />
            </div>
          </div>
        </div>
      )}

      {/* evidence drawer */}
      {drawer && (
        <aside className="corr-drawer" dir="auto" aria-label="Evidence drawer">
          <header>
            <b>{drawer.kind === 'node' ? drawer.data.label : `${drawer.data.source?.id || drawer.data.source} ↔ ${drawer.data.target?.id || drawer.data.target}`}</b>
            <QuickQueryZap artifact={drawer.kind === 'link' ? { edge: drawer.data.id, claim: drawer.data.claim, weight: drawer.data.weight, evidence: drawer.data.evidenceCount } : { node: drawer.data.id, evidence: drawer.data.evidenceIds?.length }} label={drawer.kind} onContinueInChat={onSendToChat} />
            <button onClick={() => setDrawer(null)} aria-label="Close drawer"><X size={14} /></button>
          </header>
          {drawer.evidence.length === 0 && <p className="corr-drawer__empty">No evidence records resolved.</p>}
          {drawer.evidence.map(ev => (
            <article key={ev.id} className="corr-evcard">
              <div className="corr-evcard__head">
                <span>{PLATFORM_GLYPH[ev.platform] || '•'} {ev.source}</span>
                <QuickQueryZap artifact={ev} label="evidence" onContinueInChat={onSendToChat} />
              </div>
              <p>{ev.claim}</p>
              {(ev.media || []).length > 0 && <div className="corr-evcard__thumbs">{ev.media.map(m => <img key={m} src={m} alt="proof" onClick={() => setLightbox(ev)} />)}</div>}
              <footer>
                <a href={ev.url} target="_blank" rel="noopener noreferrer">{ev.url.slice(0, 46)}…</a>
                <span>{ev.publishDate || 'n.d.'} · conf {ev.confidence}</span>
                <button className="corr-sendchat" onClick={() => onSendToChat?.(ev, 'Discuss this evidence', '')}><MessageSquare size={12} /> Send to chat</button>
              </footer>
            </article>
          ))}
        </aside>
      )}

      {run && (
        <section className="corr-edges">
          <h2>Edges ({run.graph.edges.length}) — all evidence-gated</h2>
          <table>
            <thead><tr><th>Edge</th><th>Type</th><th>W</th><th>Rec</th><th>Evidence</th><th>Platforms</th><th>⚡</th></tr></thead>
            <tbody>
              {run.graph.edges.slice().sort((a, b) => b.weight - a.weight).map(e => (
                <tr key={e.id} className={adapted.links.find(l => l.id === e.id)?.isNew ? 'corr-row--new' : ''}>
                  <td>{e.source} ↔ {e.target}<div className="corr-claim">{e.claim}</div></td>
                  <td><span className="corr-type" style={{ background: TYPE_COLORS[e.type] }}>{e.type}</span></td>
                  <td>{e.weight}</td><td>{e.recency}</td>
                  <td>{e.evidenceCount}</td>
                  <td>{(e.platforms || []).map(p => PLATFORM_GLYPH[p]).join(' ')}</td>
                  <td>{e.contradiction && '⚠ '}<QuickQueryZap artifact={{ edge: e.id, claim: e.claim, type: e.type, weight: e.weight, recency: e.recency, evidenceIds: e.evidenceIds }} label="edge" onContinueInChat={onSendToChat} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {DEBUG && run && (
        <details className="corr-debug" open>
          <summary>debug drawer (?debug=1)</summary>
          <pre>{JSON.stringify({ runId, stats: adapted.stats, fps, filters: { types: [...typeFilter], minWeight, maxAgeDays, platformFilter } }, null, 1)}</pre>
        </details>
      )}
    </div>
  );
}
