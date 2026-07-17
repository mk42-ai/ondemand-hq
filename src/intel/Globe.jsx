import React, { useEffect, useRef, useState } from 'react';
import createGlobe from 'cobe';
import { motion, AnimatePresence } from 'framer-motion';
import Flag from './Flag.jsx';
import { ArrowRight, Crosshair } from 'lucide-react';

/**
 * GPU-accelerated globe landing (cobe/WebGL). Monitored countries glow as
 * markers sized by risk; hovering a country row shows a live status card.
 * All data comes from /api/intel/overview — countries without collected
 * intelligence render an explicit empty state (never simulated numbers).
 */
export default function Globe({ countries, onOpenCountry }) {
  const canvasRef = useRef(null);
  const globeRef = useRef(null);
  const phiRef = useRef(0);
  const thetaRef = useRef(0.25);
  const focusRef = useRef(null);    // {lat,lng} the globe eases toward (hover OR selected+toggle)
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);   // clicked country (single-click selects)
  const [focusMode, setFocusMode] = useState(true); // GLOBE TOGGLE: ON => rotate to selected country

  // Keep focus target in sync with toggle + selection: when the toggle is ON and a
  // country is selected, the globe eases to its real lat/lng; otherwise idle spin
  // (hover still previews focus transiently while the pointer is over a row).
  useEffect(() => {
    if (focusMode && selected) focusRef.current = { lat: selected.lat, lng: selected.lng };
    else focusRef.current = null;
  }, [focusMode, selected]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const markers = countries.map(c => ({
      location: [c.lat, c.lng],
      size: c.hasData ? Math.max(0.04, Math.min(0.12, (c.riskScore ?? 40) / 700)) : 0.03,
    }));
    let width = canvasRef.current.offsetWidth;
    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: width * 2, height: width * 2,
      phi: 0, theta: 0.25, dark: 0,
      diffuse: 1.15, mapSamples: 18000, mapBrightness: 5.2,
      baseColor: [0.94, 0.94, 0.95],
      markerColor: [0.69, 0.55, 0.23],     // ODA gold
      glowColor: [0.95, 0.93, 0.88],
      markers,
      onRender: (state) => {
        const IDLE_THETA = 0.25;
        if (focusRef.current) {
          // Center the selected country: phi from longitude, theta from latitude.
          const targetPhi = Math.PI - ((focusRef.current.lng * Math.PI) / 180) - Math.PI / 2;
          const targetTheta = Math.max(-0.6, Math.min(0.9, (focusRef.current.lat * Math.PI) / 180 * 0.9));
          // Shortest-path eased interpolation (spring-like, ~60fps, no jank).
          let dPhi = targetPhi - phiRef.current;
          dPhi = Math.atan2(Math.sin(dPhi), Math.cos(dPhi)); // wrap to [-π, π]
          phiRef.current += dPhi * 0.07;
          thetaRef.current += (targetTheta - thetaRef.current) * 0.07;
        } else {
          phiRef.current += 0.0035; // idle auto-spin
          thetaRef.current += (IDLE_THETA - thetaRef.current) * 0.05;
        }
        state.phi = phiRef.current;
        state.theta = thetaRef.current;
        state.width = width * 2; state.height = width * 2;
      },
    });
    globeRef.current = globe;
    const onResize = () => { width = canvasRef.current?.offsetWidth || width; };
    window.addEventListener('resize', onResize);
    return () => { globe.destroy(); window.removeEventListener('resize', onResize); };
    // markers depend on countries snapshot identity
  }, [countries]);

  return (
    <div className="ig-globe">
      <div className="ig-globe__canvaswrap">
        <canvas ref={canvasRef} className="ig-globe__canvas" aria-label="Monitored countries globe" />
      </div>
      <div className="ig-globe__list" role="list">
        <div className="ig-globe__controls">
          <button
            type="button" role="switch" aria-checked={focusMode}
            className={`ig-focus-toggle${focusMode ? ' on' : ''}`}
            title="When on, selecting a country rotates the globe to center it"
            onClick={() => setFocusMode(f => !f)}
          >
            <Crosshair size={13} aria-hidden />
            <span>Focus selected country</span>
            <span className={`ig-focus-toggle__knobtrack${focusMode ? ' on' : ''}`}><span className="ig-focus-toggle__knob" /></span>
          </button>
          {selected && (
            <div className="ig-globe__selrow">
              <Flag iso={selected.iso} size="sm" title={selected.name} /> <b>{selected.name}</b>
              <button className="ig-globe__openbtn" onClick={() => onOpenCountry(selected.iso)}>Open <ArrowRight size={11} aria-hidden /></button>
              <button className="ig-globe__clearbtn" onClick={() => setSelected(null)} aria-label="Clear selection">Clear</button>
            </div>
          )}
        </div>
        {countries.map(c => (
          <motion.button
            key={c.iso} role="listitem"
            className={`ig-globe__row${c.critical ? ' crit' : ''}${selected?.iso === c.iso ? ' sel' : ''}`}
            whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            onMouseEnter={() => { setHover(c); if (!(focusMode && selected)) focusRef.current = { lat: c.lat, lng: c.lng }; }}
            onMouseLeave={() => { setHover(h => (h?.iso === c.iso ? null : h)); if (!(focusMode && selected)) focusRef.current = null; }}
            onClick={() => { setSelected(c); if (!focusMode) onOpenCountry(c.iso); }}
            onDoubleClick={() => onOpenCountry(c.iso)}
          >
            <span className="ig-globe__flag"><Flag iso={c.iso} size="sm" title={c.name} /></span>
            <span className="ig-globe__name">{c.name}</span>
            <span style={{ flex: 1 }} />
            {c.hasData ? (
              <>
                {c.critical > 0 && <span className="ig-alert crit" title={`${c.critical} critical`}>{c.critical}</span>}
                {c.high > 0 && <span className="ig-alert high" title={`${c.high} high-impact`}>{c.high}</span>}
                <span className="ig-globe__risk" title="Risk score">{c.riskScore ?? '—'}</span>
              </>
            ) : (
              <span className="ig-globe__nodata">no data yet</span>
            )}
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {hover && (
          <motion.div
            key={hover.iso}
            className="ig-hovercard"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="ig-hovercard__head"><Flag iso={hover.iso} size="sm" title={hover.name} /> <b>{hover.name}</b></div>
            {hover.hasData ? (
              <>
                <div className="ig-hovercard__row"><span>Status</span><b>{hover.critical ? 'Critical events' : hover.high ? 'Elevated' : 'Monitored'}</b></div>
                <div className="ig-hovercard__row"><span>Risk</span><b>{hover.riskScore ?? '—'}</b></div>
                <div className="ig-hovercard__row"><span>Opportunity</span><b>{hover.opportunityScore ?? '—'}</b></div>
                {hover.latest && <div className="ig-hovercard__latest">{hover.latest}</div>}
                <div className="ig-hovercard__cta">Open country intelligence <ArrowRight size={11} aria-hidden style={{ verticalAlign: '-1px' }} /></div>
              </>
            ) : (
              <div className="ig-hovercard__latest">No intelligence collected yet — open the page and run the first collection.</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
