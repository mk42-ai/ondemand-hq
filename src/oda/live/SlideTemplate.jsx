// SlideTemplate.jsx — pre-cooked 4-slide live-render deck for the ODA
// Productivity Suite. Renders a fixed 2x2 grid of slide cards that stream
// from `pending` (skeleton) -> `filling` (streamed content) -> `final`
// (locked). Scoped entirely under the .oda-live namespace in live.css so it
// never collides with the .oda-ws workspace shell styles in oda.css.
import React from 'react';
import { CheckCircle2 } from 'lucide-react';

/**
 * The frozen 4-slide scaffold every live run starts from. Consumers clone
 * this shape and progressively fill it in as content streams in.
 */
export const SLIDE_SCAFFOLD = Object.freeze([
  Object.freeze({ no: 1, kind: 'headline', kicker: 'Understanding', title: '', bullets: Object.freeze([]), status: 'pending', confidence: null }),
  Object.freeze({ no: 2, kind: 'evidence', kicker: 'Evidence & analysis', title: '', bullets: Object.freeze([]), status: 'pending', confidence: null }),
  Object.freeze({ no: 3, kind: 'core', kicker: 'Core findings', title: '', bullets: Object.freeze([]), status: 'pending', confidence: null }),
  Object.freeze({ no: 4, kind: 'actions', kicker: 'Recommendations & next steps', title: '', bullets: Object.freeze([]), status: 'pending', confidence: null }),
]);

const CHIP_LABEL = { pending: 'Queued', filling: 'Rendering', final: 'Final' };

function StatusChip({ status }) {
  const label = CHIP_LABEL[status] || CHIP_LABEL.pending;
  return (
    <span className={`oda-live__chip oda-live__chip--${status}`}>
      {status === 'filling' && <span className="oda-live__dot" aria-hidden="true" />}
      <span>{label}</span>
      {status === 'final' && <CheckCircle2 size={11} aria-hidden="true" />}
    </span>
  );
}

function Confidence({ value }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="oda-live__conf">
      <div className="oda-live__conf-track">
        <div className="oda-live__conf-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="oda-live__conf-label">{pct}%</span>
    </div>
  );
}

function SkeletonTitle() {
  return (
    <div className="oda-live__skelblock" aria-hidden="true">
      <span className="oda-live__skel" style={{ width: '85%' }} />
      <span className="oda-live__skel" style={{ width: '60%' }} />
      <span className="oda-live__skel" style={{ width: '40%' }} />
    </div>
  );
}

function Bullets({ slide }) {
  if (slide.status === 'pending') {
    return (
      <ul className="oda-live__bullets" aria-hidden="true">
        <li className="oda-live__bullet oda-live__bullet--skel"><span className="oda-live__skel" style={{ width: '92%' }} /></li>
        <li className="oda-live__bullet oda-live__bullet--skel"><span className="oda-live__skel" style={{ width: '68%' }} /></li>
      </ul>
    );
  }
  const bullets = slide.bullets || [];
  return (
    <ul className="oda-live__bullets">
      {bullets.map((text, i) => (
        <li key={i + text} className="oda-live__bullet" style={{ animationDelay: `${i * 90}ms` }}>
          {slide.kind === 'actions' && <span className="oda-live__num">{i + 1}</span>}
          <span className="oda-live__bullet-text">{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Slide({ slide, isActive, logoUrl }) {
  const cls = [
    'oda-live__slide',
    `oda-live__slide--${slide.status}`,
    isActive ? 'is-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} data-kind={slide.kind}>
      <div className="oda-live__head">
        <span className="oda-live__badge">{String(slide.no).padStart(2, '0')}</span>
        <span className="oda-live__kicker">{slide.kicker}</span>
        <StatusChip status={slide.status} />
      </div>

      {slide.confidence != null && <Confidence value={slide.confidence} />}

      <div className="oda-live__body">
        {slide.status === 'pending'
          ? <SkeletonTitle />
          : <h3 className="oda-live__title" key={slide.title}>{slide.title}</h3>}
        <Bullets slide={slide} />
      </div>

      <img src={logoUrl || '/oda-logo.png'} className="oda-live__slidelogo" alt="ODA" />
    </div>
  );
}

/**
 * Renders the pre-cooked 4-slide live deck grid.
 * @param {object} p
 * @param {object[]} [p.slides]      4 slide objects shaped like SLIDE_SCAFFOLD entries
 * @param {number}  [p.activeSlide]  the `no` of the slide currently being narrated/streamed
 * @param {string}  [p.logoUrl]      override for the per-slide watermark logo
 */
export default function SlideTemplate({ slides, activeSlide, logoUrl }) {
  const deck = Array.isArray(slides) && slides.length ? slides : SLIDE_SCAFFOLD;
  return (
    <div className="oda-live">
      <div className="oda-live__deck">
        {deck.map((slide) => (
          <Slide key={slide.no} slide={slide} isActive={slide.no === activeSlide} logoUrl={logoUrl} />
        ))}
      </div>
    </div>
  );
}
