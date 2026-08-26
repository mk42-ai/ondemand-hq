// OndemandAgentDataParser.jsx — port of the playground's OndemandAgentDataParser.
// Recursively renders an agent event's `data` object: nested objects indent, arrays render
// inline, `skills` gets chip treatment, and HTTP(S) URLs render as file cards with
// Open / Download actions instead of raw links.
import React, { useRef } from 'react';
import { ExternalLink, Download } from 'lucide-react';

const INDENT_PX = 12;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function fileNameFromUrl(url) {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop() || 'file';
    return decodeURIComponent(base);
  } catch {
    return 'file';
  }
}

function fileExt(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toUpperCase();
}

function formatLeaf(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function DeliverableFile({ url, label, fileName: fileNameOverride, depth }) {
  const fileName = fileNameOverride || fileNameFromUrl(url);
  const ext = fileExt(fileName) || 'FILE';
  const padStyle = { paddingInlineStart: depth * INDENT_PX };

  return (
    <div className="odadeliv" style={padStyle}>
      {label && <div className="odaparse__key odadeliv__heading">{label}</div>}
      <div className="odadeliv__card">
        <span className="odadeliv__ext">{ext}</span>
        <div className="odadeliv__meta">
          <span className="odadeliv__name">{fileName}</span>
        </div>
        <div className="odadeliv__btns">
          <a
            className="odadeliv__btn odadeliv__btn--primary"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={13} aria-hidden />
            Open
          </a>
          <a
            className="odadeliv__btn"
            href={url}
            download={fileName}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={13} aria-hidden />
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

function DataEntry({ dataKey, value, depth }) {
  const padStyle = { paddingInlineStart: depth * INDENT_PX };

  if (isHttpUrl(value)) {
    return <DeliverableFile url={value} label={dataKey} depth={depth} />;
  }

  if (isPlainObject(value) && isHttpUrl(value.url)) {
    return (
      <DeliverableFile
        url={value.url}
        label={dataKey}
        fileName={typeof value.name === 'string' ? value.name : undefined}
        depth={depth}
      />
    );
  }

  if (dataKey === 'skills' && Array.isArray(value)) {
    return (
      <div className="odaparse__row" style={padStyle}>
        <div className="odaparse__key">Skills:</div>
        <div className="odaparse__skills">
          {value.map((s, i) => (
            <span key={i} className="odaparse__skill">{String(s)}</span>
          ))}
        </div>
      </div>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="odaparse__row" style={padStyle}>
          <span className="odaparse__key">{dataKey}:</span>{' '}
          <span className="odaparse__val">{'{}'}</span>
        </div>
      );
    }
    return (
      <div className="odaparse__row" style={padStyle}>
        <div className="odaparse__key">{dataKey}:</div>
        <div className="odaparse__nested">
          {entries.map(([k, v]) => (
            <DataEntry key={`${dataKey}.${k}`} dataKey={k} value={v} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isHttpUrl)) {
      return (
        <div className="odaparse__row" style={padStyle}>
          <div className="odaparse__key">{dataKey}:</div>
          <div className="odadeliv__list">
            {value.map((url, i) => (
              <DeliverableFile key={i} url={url} depth={depth + 1} />
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="odaparse__row" style={padStyle}>
        <span className="odaparse__key">{dataKey}:</span>{' '}
        <span className="odaparse__val">
          {value.map((item, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}
              {isPlainObject(item) || Array.isArray(item) ? JSON.stringify(item) : formatLeaf(item)}
            </span>
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className="odaparse__row" style={padStyle}>
      <span className="odaparse__key">{dataKey}:</span>{' '}
      <span className="odaparse__val">{formatLeaf(value)}</span>
    </div>
  );
}

export default function OndemandAgentDataParser({ agentData, className = '' }) {
  const data = agentData?.data ?? {};
  const ref = useRef(null);

  const entries = Object.entries(data);
  if (!entries.length) return null;

  return (
    <div className="odaparse">
      <div className={`odaparse__list${className ? ` ${className}` : ''}`} ref={ref}>
        {entries.map(([k, v]) => (
          <DataEntry key={k} dataKey={k} value={v} depth={0} />
        ))}
      </div>
    </div>
  );
}
