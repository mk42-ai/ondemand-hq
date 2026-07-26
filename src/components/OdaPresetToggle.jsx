import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const formatValue = (value) => {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'string' && value.length > 220) return `${value.slice(0, 220)}… (${value.length} chars)`;
  return String(value);
};

const ConfigRow = ({ label, value }) => (
  <div className="oda-preset-tip__row">
    <span className="oda-preset-tip__key">{label}</span>
    <span className="oda-preset-tip__val">{formatValue(value)}</span>
  </div>
);

export default function OdaPresetToggle({
  enabled,
  onToggle,
  preset,
  skills = [],
  loading = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const tipId = useId();
  const btnRef = useRef(null);
  const hideTimerRef = useRef(null);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const showPanel = useCallback(() => {
    clearHideTimer();
    setOpen(true);
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setOpen(false), 280);
  }, []);

  useEffect(() => () => clearHideTimer(), []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;

    const updatePosition = () => {
      const rect = btnRef.current.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const panelWidth = Math.min(420, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.left),
        window.innerWidth - panelWidth - margin,
      );
      const spaceAbove = Math.max(0, rect.top - margin - gap);
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
      const openAbove = spaceAbove >= 160 || spaceAbove >= spaceBelow;

      if (openAbove) {
        // Anchor with explicit top so the panel never extends above the viewport.
        const maxHeight = Math.min(480, spaceAbove);
        const top = Math.max(margin, rect.top - gap - maxHeight);
        const clampedMaxHeight = Math.max(120, rect.top - gap - top);
        setPanelStyle({
          position: 'fixed',
          left,
          top,
          width: panelWidth,
          maxHeight: clampedMaxHeight,
        });
        return;
      }

      setPanelStyle({
        position: 'fixed',
        left,
        top: rect.bottom + gap,
        width: panelWidth,
        maxHeight: Math.min(480, Math.max(120, spaceBelow)),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, preset]);

  const handleClick = useCallback(() => {
    if (disabled || loading || !preset) return;
    onToggle?.(!enabled);
  }, [disabled, enabled, loading, onToggle, preset]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const title = preset?.name || 'ODA';
  const skillNames = skills.length
    ? skills.map((s) => s.name || s.id)
    : [];

  const panel = open && preset && panelStyle ? (
    <div
      className="oda-preset-tip"
      id={tipId}
      role="tooltip"
      style={panelStyle}
      onMouseEnter={showPanel}
      onMouseLeave={scheduleHide}
    >
      <div className="oda-preset-tip__head">
        <strong>{preset.name || 'ODA'}</strong>
        <span className={`oda-preset-tip__state${enabled ? ' oda-preset-tip__state--on' : ''}`}>
          {enabled ? 'ON — full config sent on query' : 'OFF — click to enable'}
        </span>
      </div>
      <div className="oda-preset-tip__scroll">
        <ConfigRow label="Endpoint" value={preset.endpoint} />
        <ConfigRow label="Reasoning" value={`${preset.reasoningEffort}${preset.reasoningMode ? ` · ${preset.reasoningMode}` : ''}`} />
        <ConfigRow label="Temperature" value={preset.temperature} />
        <ConfigRow label="Top P" value={preset.topP} />
        <ConfigRow label="Presence penalty" value={preset.presencePenalty} />
        <ConfigRow label="Max tokens" value={preset.maxTokens} />
        <ConfigRow label="Response mode" value={preset.responseMode} />
        <ConfigRow label="Debug mode" value={preset.debugMode} />
        <ConfigRow label="RAG version" value={preset.ragVersion} />
        <ConfigRow label="Chat plugins" value={preset.chatPlugins} />
        <ConfigRow label="File plugins" value={preset.filePlugins} />
        <div className="oda-preset-tip__row oda-preset-tip__row--stack">
          <span className="oda-preset-tip__key">Skills</span>
          {skillNames.length ? (
            <ul className="oda-preset-tip__skills">
              {skillNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <span className="oda-preset-tip__val">—</span>
          )}
        </div>
        <ConfigRow label="Stop sequences" value={preset.stopSequences} />
        <div className="oda-preset-tip__row oda-preset-tip__row--stack">
          <span className="oda-preset-tip__key">Fulfillment prompt</span>
          <pre className="oda-preset-tip__prompt">{preset.fulfillmentPrompt || '—'}</pre>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="oda-preset-wrap">
        <button
          ref={btnRef}
          type="button"
          className={`oda-preset-btn${enabled ? ' oda-preset-btn--on' : ''}${loading ? ' oda-preset-btn--loading' : ''}`}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onMouseEnter={showPanel}
          onMouseLeave={scheduleHide}
          onFocus={showPanel}
          onBlur={scheduleHide}
          disabled={disabled || loading || !preset}
          aria-pressed={enabled}
          aria-describedby={open && preset ? tipId : undefined}
          aria-label={enabled ? `${title} preset enabled` : `${title} preset disabled`}
        >
          {loading ? '…' : title}
        </button>
      </div>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
    </>
  );
}
