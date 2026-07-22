// BrainSelector.jsx — model ("brain") selector for the live-render page.
// The selected brain authors the FINAL document; GLM 4.7 stays interpreter-only
// (live incremental updates). Styles are self-contained in this file, scoped
// to .oda-live__brains, so no shared stylesheet is touched.
import React from 'react';

const FALLBACK_BRAINS = [
  { id: 'kimi3', label: 'Kimi K3', blurb: 'Fast broad worker' },
  { id: 'sonnet-5', label: 'Sonnet 5', blurb: 'Default substantive worker' },
  { id: 'opus-4.8', label: 'Opus 4.8', blurb: 'Deepest reasoning' },
  { id: 'fable', label: 'Fable 5', blurb: 'Long-form narrative' },
];

const CSS = `
.oda-live__brains { display: flex; gap: 8px; flex-wrap: wrap; }
.oda-live__brainbtn {
  appearance: none; cursor: pointer; text-align: left;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px; padding: 9px 14px; color: rgba(244,247,246,.85);
  font: 600 12.5px 'Montserrat', system-ui, sans-serif;
  transition: transform .15s ease, border-color .15s ease, background .15s ease;
}
.oda-live__brainbtn small {
  display: block; font-weight: 400; font-size: 10.5px;
  color: rgba(244,247,246,.5); margin-top: 2px;
}
.oda-live__brainbtn:hover:not(:disabled) { transform: translateY(-1px); border-color: rgba(29,172,137,.5); }
.oda-live__brainbtn.is-selected {
  background: linear-gradient(135deg, #159a7a, #1dac89); color: #fff;
  border-color: transparent;
}
.oda-live__brainbtn.is-selected small { color: rgba(255,255,255,.75); }
.oda-live__brainbtn:disabled { opacity: .45; cursor: not-allowed; }
.oda-live__braincap {
  margin-top: 8px; font: 400 11.5px 'Montserrat', system-ui, sans-serif;
  color: rgba(244,247,246,.55);
}
`;

export default function BrainSelector({ value, onChange, disabled = false, brains }) {
  const list = Array.isArray(brains) && brains.length ? brains : FALLBACK_BRAINS;
  const selected = list.find((b) => b.id === value) || list[1] || list[0];
  return (
    <div>
      <style>{CSS}</style>
      <div className="oda-live__brains" role="group" aria-label="Final document brain">
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`oda-live__brainbtn${value === b.id ? ' is-selected' : ''}`}
            aria-pressed={value === b.id}
            disabled={disabled}
            onClick={() => onChange?.(b.id)}
          >
            {b.label}
            {b.blurb && <small>{b.blurb}</small>}
          </button>
        ))}
      </div>
      <div className="oda-live__braincap">
        GLM 4.7 renders live · {selected?.label || 'Sonnet 5'} writes the final document
      </div>
    </div>
  );
}
