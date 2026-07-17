import React, { useEffect, useRef, useState } from 'react';
import createGlobe from 'cobe';
import { motion, AnimatePresence } from 'framer-motion';

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
  const focusRef = useRef(null); // {lat,lng} to ease toward
  const [hover, setHover] = useState(null);

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
        if (focusRef.current) {
          const targetPhi = Math.PI - ((focusRef.current.lng * Math.PI) / 180) - Math.PI / 2;
          phiRef.current += (targetPhi - phiRef.current) * 0.06; // spring-ease toward country
        } else {
          phiRef.current += 0.0035; // idle rotation
        }
        state.phi = phiRef.current;
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
        {countries.map(c => (
          <motion.button
            key={c.iso} role="listitem"
            className={`ig-globe__row${c.critical ? ' crit' : ''}`}
            whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            onMouseEnter={() => { setHover(c); focusRef.current = { lat: c.lat, lng: c.lng }; }}
            onMouseLeave={() => { setHover(h => (h?.iso === c.iso ? null : h)); focusRef.current = null; }}
            onClick={() => onOpenCountry(c.iso)}
          >
            <span className="ig-globe__flag">{c.flag}</span>
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
            <div className="ig-hovercard__head">{hover.flag} <b>{hover.name}</b></div>
            {hover.hasData ? (
              <>
                <div className="ig-hovercard__row"><span>Status</span><b>{hover.critical ? 'Critical events' : hover.high ? 'Elevated' : 'Monitored'}</b></div>
                <div className="ig-hovercard__row"><span>Risk</span><b>{hover.riskScore ?? '—'}</b></div>
                <div className="ig-hovercard__row"><span>Opportunity</span><b>{hover.opportunityScore ?? '—'}</b></div>
                {hover.latest && <div className="ig-hovercard__latest">{hover.latest}</div>}
                <div className="ig-hovercard__cta">Open country intelligence →</div>
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
