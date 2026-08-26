// parseAgentic.js — reconstruct the playground's structured views from the public API.
//
// The playground reads its query plan and plugin cards off `statusLog.queryPlan` /
// `.executedAgents` / `.stepExecutionOutput`. The PUBLIC api does not populate those:
// verified live 2026-07-25, a full agentic turn emitted exactly two statusLog frames
// (`fulfilling`, `fulfillment_completed`) with empty agent arrays.
//
// The same information does arrive, as fenced JSON inside two delta channels:
//   planning_output -> planningAnswer -> { objective, steps: [{ user_query, depends, plugins }] }
//   step_output     -> pluginAnswer   -> { plugins: [{ pluginId, name, description,
//                                          api_request_parameters, identifier, ... }] }
// These helpers pull that back out so the ported UI has the same data to render.
//
// Both channels stream token-by-token, so every parse here must tolerate a half-written
// payload and simply return null until the JSON closes.

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g;

/** Every complete fenced JSON block in `text`, oldest first. Partial blocks are skipped. */
function jsonBlocks(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  FENCE_RE.lastIndex = 0;
  let m;
  while ((m = FENCE_RE.exec(text))) {
    try { out.push(JSON.parse(m[1])); } catch { /* still streaming, or not JSON */ }
  }
  // The model sometimes omits the fence entirely; try the bare text as a last resort.
  if (!out.length) {
    try { out.push(JSON.parse(text)); } catch { /* not ready */ }
  }
  return out;
}

/**
 * The query plan from `planningAnswer`.
 * The planner re-emits the whole plan each time it revises it, so the LAST complete
 * block wins — earlier ones are superseded drafts.
 * @returns {{objective: string, steps: Array}|null}
 */
export function parseQueryPlan(planningAnswer) {
  const blocks = jsonBlocks(planningAnswer).filter(
    b => b && typeof b === 'object' && (b.objective || Array.isArray(b.steps)),
  );
  if (!blocks.length) return null;
  const plan = blocks[blocks.length - 1];
  return {
    objective: typeof plan.objective === 'string' ? plan.objective : '',
    steps: Array.isArray(plan.steps) ? plan.steps : [],
  };
}

/**
 * The plugin calls from `pluginAnswer`, normalised to the shape the plugin cards render.
 * Accumulates across blocks (each step emits its own) and de-duplicates on
 * pluginId + serialised parameters, since a retried step repeats its call verbatim.
 * @returns {Array<{id,pluginId,name,description,params,identifier,hydrated}>}
 */
export function parsePluginCalls(pluginAnswer) {
  const calls = [];
  const seen = new Set();
  for (const block of jsonBlocks(pluginAnswer)) {
    if (!block || !Array.isArray(block.plugins)) continue;
    for (const p of block.plugins) {
      if (!p || typeof p !== 'object') continue;
      const params = p.api_request_parameters || p.parameters || {};
      const key = `${p.pluginId || ''}|${JSON.stringify(params)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({
        id: key,
        pluginId: p.pluginId || '',
        name: p.name || p.identifier || p.pluginId || 'plugin',
        description: typeof p.description === 'string' ? p.description : '',
        params,
        identifier: p.identifier || '',
        hydrated: p.all_parameters_hydrated !== false,
      });
    }
  }
  return calls;
}

/** The single most representative argument of a call, for the one-line card summary. */
export function summariseParams(params) {
  if (!params || typeof params !== 'object') return '';
  const preferred = params.query ?? params.q ?? params.search ?? params.url ?? params.prompt;
  const value = preferred !== undefined ? preferred : Object.values(params)[0];
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// The playground's status rows come from the CLIENT api as discrete statusLog frames
// (analyzing, plan_created, agents_retrieved, executing, execution_completed,
// execution_log_created, fulfilling, fulfillment_completed). The PUBLIC api sends only
// `fulfilling` + `fulfillment_completed` (verified live 2026-07-25 even on a heavy report
// query). So we SYNTHESISE the same visible timeline from the data we do receive — the
// parsed plan (planning_output) and plugin calls (step_output) — using the playground's
// exact row labels and colours. Same information, reconstructed row-for-row.
//
// Tones map to the playground's status icons: green (done), yellow (in-progress/executing),
// gray (retrieved), red (failed).

/** Exact playground status labels, keyed by synthetic statusType. */
export const STATUS_LABEL = {
  initializing: 'Initializing the process...',
  analyzing: 'Analyzing the prompt...',
  plan_created: 'Execution plan created',
  agents_retrieved: 'Retrieved the agents',
  executing: 'Executing the agents...',
  execution_completed: 'Agents execution completed',
  execution_log_created: 'Execution log created',
  fulfilling: 'Fulfilling the prompt...',
  fulfillment_completed: 'Fulfillment completed',
};

const TONE = {
  initializing: 'green', analyzing: 'green', plan_created: 'green',
  agents_retrieved: 'gray', executing: 'yellow', execution_completed: 'green',
  execution_log_created: 'green', fulfilling: 'green', fulfillment_completed: 'green',
};

/**
 * Build the ordered status-row timeline shown in StatusLogBlock, mirroring the playground.
 * Rows appear as their backing data arrives, so it animates in during streaming and lands
 * on the full sequence when done.
 *
 * @param {object} m live/persisted bot message (thinking, planningAnswer, pluginAnswer,
 *                   statusLogs, answerStarted, text, live)
 * @returns {Array<{key,type,tone,label,stepQuery?,plugins?,section?}>}
 */
export function buildStatusTimeline(m = {}) {
  const rows = [];
  const push = (type, extra = {}) => rows.push({ key: type, type, tone: TONE[type], label: STATUS_LABEL[type], ...extra });

  const hasThinking = Boolean((m.thinking || '').trim());
  const plan = parseQueryPlan(m.planningAnswer);
  const plugins = parsePluginCalls(m.pluginAnswer);
  const answerVisible = Boolean((m.text || '').trim());
  const realTypes = new Set((m.statusLogs || []).map(s => s.statusType));
  // The step-query line the playground prints under the analyzing/agent rows is the plan
  // objective (falling back to the first step's query).
  const stepQuery = plan?.objective || plan?.steps?.[0]?.user_query || plan?.steps?.[0]?.query || '';
  const done = !m.live;

  if (hasThinking || plan || plugins.length || answerVisible || realTypes.size) push('initializing');
  if (hasThinking || plan) push('analyzing');
  if (plan) {
    push('plan_created');
    push('analyzing', { key: 'analyzing-2', stepQuery });
  }
  if (plugins.length) {
    push('agents_retrieved', { plugins, stepQuery, section: null });
    // "Executing" is in-progress until the answer starts; then it settles into "completed".
    if (answerVisible || done || realTypes.has('fulfillment_completed')) {
      push('execution_completed', { plugins, stepQuery, section: 'Successfully Executed' });
    } else {
      push('executing', { plugins, stepQuery });
    }
  }
  if (plan && (answerVisible || done || realTypes.size)) push('execution_log_created');

  // Real frames from the public API — always trust these when present.
  if (realTypes.has('fulfilling') || answerVisible) push('fulfilling');
  if (realTypes.has('fulfillment_completed') || (done && answerVisible)) push('fulfillment_completed');

  return rows;
}
