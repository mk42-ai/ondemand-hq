// ThinkingProcess.jsx — port of the playground's ThinkingProcess panel.
// Renders the PLANNING channels only: `thinking` (planning_thinking deltas) followed by
// `planningAnswer` (planning_output deltas). Step-level and fulfillment-level reasoning
// render further down the message, in StatusLogBlock and FulfilmentThinking respectively.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Markdown } from '../../markdown.jsx';

export default function ThinkingProcess({ message }) {
  const [open, setOpen] = useState(true);
  // The playground latches the panel shut once execution starts and disables the toggle.
  // Its trigger is a statusLog carrying a stepQuery; the public API never sends one, so the
  // equivalent signal here is the first answer token — both mean "planning is over".
  const [latched, setLatched] = useState(false);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!latched && message.answerStarted) {
      setOpen(false);
      setLatched(true);
    }
  }, [message.answerStarted, latched]);

  // Keep the newest reasoning in view. A ResizeObserver (not a scrollHeight read) is what
  // catches streamed markdown reflowing code blocks after paint.
  useEffect(() => {
    if (!open) return undefined;
    const root = scrollRef.current;
    const wrap = contentRef.current;
    if (!root || !wrap) return undefined;
    let raf = null;
    const snapToBottom = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    };
    const ro = new ResizeObserver(snapToBottom);
    ro.observe(wrap);
    snapToBottom();
    return () => { ro.disconnect(); if (raf != null) cancelAnimationFrame(raf); };
  }, [open]);

  const thinking = message.thinking || '';
  const planningAnswer = message.planningAnswer || '';
  if (!thinking.trim() && !planningAnswer.trim()) return null;

  return (
    <div className="pgthink">
      <button
        type="button"
        className="pgthink__head"
        onClick={() => setOpen(o => !o)}
        disabled={latched}
        aria-expanded={open}
      >
        <span className="pgthink__label">Thinking</span>
        {/* Matches the playground: once planning is over the panel latches shut and the
            affordance disappears rather than staying clickable. */}
        {!latched && <ChevronDown size={16} aria-hidden className={`pgthink__chev${open ? ' open' : ''}`} />}
      </button>
      <div className="pgthink__wrap">
        <div ref={scrollRef} className={`pgthink__body${open ? ' open' : ''}`}>
          <div ref={contentRef} className="pgthink__content">
            {thinking && <Markdown text={thinking} />}
            {planningAnswer && <Markdown text={planningAnswer} />}
          </div>
        </div>
        {open && <div className="pgthink__shadow" aria-hidden />}
      </div>
    </div>
  );
}
