// TerminalLogs.jsx — port of the playground's TerminalLogs panel. A collapsible terminal
// showing ondemand_agent.terminal frames ($ command + output, exit code, stderr).
import React, { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronDown } from 'lucide-react';

const isFailedLog = (log) =>
  log.isError || (typeof log.exitCode === 'number' && log.exitCode !== 0);

export default function TerminalLogs({ logs = [], title = 'OnDemand Agent logs' }) {
  const scrollRef = useRef(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, open]);

  if (!logs.length) return null;

  return (
    <div className="odaterm">
      <button
        type="button"
        className="odaterm__head"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? 'Collapse terminal logs' : 'Expand terminal logs'}
      >
        <span className="odaterm__title">
          <Terminal size={14} aria-hidden />
          <span className="odaterm__badge">{title}</span>
        </span>
        <ChevronDown size={13} aria-hidden className={`odaterm__chev${open ? ' open' : ''}`} />
      </button>

      <div className={`odaterm__wrap${open ? ' open' : ''}`}>
        <div ref={scrollRef} className={`odaterm__body${open ? ' open' : ''}`}>
          {logs.map((log, index) => {
            const failed = isFailedLog(log);
            const hasCommand = Boolean(log.command);
            return (
              <div key={log.seq ?? index} className="odaterm__row">
                <div className="odaterm__cmdline">
                  <span className="odaterm__cmd">
                    <span className="odaterm__prompt">$</span>
                    <span className="odaterm__cmdtext">
                      {hasCommand ? log.command : log.content}
                    </span>
                  </span>
                  {typeof log.exitCode === 'number' && (
                    <span className={`odaterm__exit${failed ? ' odaterm__exit--fail' : ''}`}>
                      exit {log.exitCode}
                    </span>
                  )}
                </div>
                {hasCommand && log.content && (
                  <pre className="odaterm__out">{log.content}</pre>
                )}
                {log.stderr && <pre className="odaterm__err">{log.stderr}</pre>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
