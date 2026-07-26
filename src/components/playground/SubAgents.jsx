// SubAgents.jsx — port of the playground's SubAgents panel. Renders the todo list as a
// collapsible list of sub-agent cards (queued / running / done), driven by the message's
// `todo` (ondemand_agent.todo + subagent_status merges).
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const getSubAgentStatus = (item) => {
  if (item.done) return 'done';
  if (item.status === 'running') return 'running';
  return 'queued';
};

const STATUS_LABEL = { queued: 'Queued', running: 'Running', done: 'Done' };

/** First letter of the agent name's first word (e.g. "Research Agent" -> "R"). */
const getAvatarLabel = (name = '') => {
  const first = String(name).trim().split(/[\s_-]+/)[0];
  return (first[0] || 'A').toUpperCase();
};

export default function SubAgents({ todo }) {
  const [expanded, setExpanded] = useState(true);

  const subAgents = (todo ?? []).filter((item) => Boolean(item.agent));
  const allDone = subAgents.length > 0 && subAgents.every((item) => item.done);

  // Collapse automatically once every sub-agent has finished (user can reopen).
  useEffect(() => {
    if (allDone) setExpanded(false);
  }, [allDone]);

  if (!subAgents.length) return null;

  const totalCount = subAgents.length;
  const doneCount = subAgents.filter((item) => item.done).length;
  const runningCount = subAgents.filter((item) => getSubAgentStatus(item) === 'running').length;

  return (
    <div className="odasub">
      <button
        type="button"
        className="odasub__head"
        aria-expanded={expanded}
        aria-label="Toggle sub-agents"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="odasub__title">Sub-agents</span>
        <span className="odasub__meta">
          {runningCount > 0 && (
            <span className="odasub__running">{runningCount} running ·</span>
          )}
          <span><b>{doneCount}</b> of {totalCount} done</span>
          {expanded ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        </span>
      </button>

      {expanded && (
        <div className="odasub__list">
          {subAgents.map((item, index) => {
            const status = getSubAgentStatus(item);
            return (
              <div key={`${index}-${item.agent}`} className={`odasub__card odasub__card--${status}`}>
                <span className="odasub__avatar">{getAvatarLabel(item.agent)}</span>
                <div className="odasub__body">
                  <span className="odasub__name">{item.agent}</span>
                  <span className="odasub__desc">{item.description || item.subtask}</span>
                </div>
                <span className={`odasub__badge odasub__badge--${status}`}>
                  <span className={`odasub__dot odasub__dot--${status}`} aria-hidden />
                  {STATUS_LABEL[status]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
