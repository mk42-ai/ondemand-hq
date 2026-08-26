// FulfilmentThinking.jsx — port of the playground's FulfilmentThinking panel.
// Model-level reasoning emitted DURING the answer (fulfillment_thinking deltas). It is a
// separate panel from ThinkingProcess because it belongs to a different phase: planning
// reasoning precedes the answer, fulfillment reasoning runs alongside it.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Markdown } from '../../markdown.jsx';

export default function FulfilmentThinking({ message }) {
  const [open, setOpen] = useState(true);
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [message.fulfillmentThinking]);

  const text = message.fulfillmentThinking || '';
  if (!text.trim()) return null;

  return (
    <div className="pgfulfil">
      <button type="button" className="pgfulfil__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="pgfulfil__label">Thinking</span>
        <ChevronDown size={16} aria-hidden className={`pgfulfil__chev${open ? ' open' : ''}`} />
      </button>
      <div className="pgfulfil__wrap">
        <div ref={ref} className={`pgfulfil__body${open ? ' open' : ''}`}>
          <Markdown text={text} />
        </div>
        {open && <div className="pgfulfil__shadow" aria-hidden />}
      </div>
    </div>
  );
}
