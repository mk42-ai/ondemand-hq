// brains.js — ODA "brain" selection layer (user-chosen final-document author).
//
// EXTENDS the routing pattern already established in ./models.js: GLM 4.7
// remains the ONLY interpreter endpoint (see models.js's
// GLM_47_INTERPRETER_ENDPOINT_ID / assertEndpointAllowed) — it renders the
// live scaffold and emits control JSON, but it NEVER authors a shipped
// deliverable. This module adds a second, user-facing layer on top of that
// policy: a "brain" the operator explicitly picks from the live UI to author
// the FINAL document. Exactly as in models.js, there are NO silent
// downgrades — an unrecognised brain id or a forbidden endpoint throws
// rather than quietly substituting another model, and a failed upstream call
// surfaces its own error rather than being retried against a different brain.
//
// Plain ES module (repo "type":"module"), no external dependencies — the
// only sibling import is ../ondemand.js's syncQuery, exactly as models.js's
// workerCall() uses it.

import { syncQuery } from '../ondemand.js';

/**
 * @typedef {object} ODABrain
 * @property {string} id                             Canonical brain id (matches its BRAINS key).
 * @property {string} label                           Human-readable name for the selector UI.
 * @property {string} endpointId                      OnDemand endpoint id this brain calls.
 * @property {'low'|'medium'|'max'|null} reasoningEffort  null => omit the
 *   reasoningEffort field entirely on calls.
 * @property {string} blurb                           One-line description shown under the label.
 */

/**
 * @typedef {object} ODABrainCallLogEntry
 * @property {string} ts           ISO timestamp when the call started.
 * @property {string} brainId      Canonical brain id (see BRAINS).
 * @property {string} endpointId   Endpoint actually called.
 * @property {boolean} ok          Whether the call resolved without throwing.
 * @property {number} durationMs   Wall-clock duration of the call.
 * @property {number} chars        Length of the returned answer text (0 on failure).
 */

// ---------------------------------------------------------------------------
// Brain registry — exactly THREE brains (2026-07-23 model-routing fix): the
// user-selected brain AUTHORS THE FINAL DOCUMENT — no silent rerouting to
// Opus. All three endpoint ids were live-verified ACTIVE against
// the platform's endpoint registry (GET /config/v1/public/endpoints) at
// 2026-07-22T22:57Z.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, ODABrain>>} */
export const BRAINS = Object.freeze({
  'kimi3': Object.freeze({ id: 'kimi3', label: 'Kimi K3', endpointId: 'predefined-kimi-k3', reasoningEffort: 'medium', blurb: 'Fast broad worker' }),
  'sonnet-5': Object.freeze({ id: 'sonnet-5', label: 'Sonnet 5', endpointId: 'predefined-claude-sonnet-5', reasoningEffort: 'medium', blurb: 'Default substantive worker (1M ctx)' }),
  'opus-4.8': Object.freeze({ id: 'opus-4.8', label: 'Opus 4.8', endpointId: 'predefined-claude-4-8-opus', reasoningEffort: 'medium', blurb: 'Deepest reasoning' }),
});

/** Brain used unless the caller/user explicitly picks another — never applied as a silent fallback for an unknown id (see resolveBrain). */
export const DEFAULT_BRAIN = 'sonnet-5';

// ---------------------------------------------------------------------------
// Resolution — explicit alias table rather than fuzzy matching, so an
// unrecognised id always fails loudly instead of guessing.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const BRAIN_ALIASES = Object.freeze({
  'kimi': 'kimi3',
  'kimi-k3': 'kimi3',
  'sonnet': 'sonnet-5',
  'sonnet5': 'sonnet-5',
  'opus': 'opus-4.8',
  'opus4.8': 'opus-4.8',
  'opus-48': 'opus-4.8',
});

/**
 * Normalise (lower-case, trim) and resolve a caller-supplied brain id or
 * alias to its canonical BRAINS entry. NO silent fallback to DEFAULT_BRAIN —
 * an unrecognised id always throws, so the caller (route handler / UI) is
 * the one that decides what happens next.
 * @param {string} brainId
 * @returns {ODABrain}
 */
export function resolveBrain(brainId) {
  const normalised = String(brainId ?? '').trim().toLowerCase();
  const canonicalId = BRAIN_ALIASES[normalised] || normalised;
  const brain = BRAINS[canonicalId];
  if (!brain) {
    const err = new Error(`ODA unknown brain: "${brainId}" — valid ids are ${Object.keys(BRAINS).join(', ')}`);
    err.code = 'ODA_UNKNOWN_BRAIN';
    throw err;
  }
  return brain;
}

// ---------------------------------------------------------------------------
// Forbidden-endpoint guard — mirrors models.js's assertEndpointAllowed
// policy for the brain layer: Gemini/Flash tiers and any GLM-flavoured
// endpoint are hard-banned (GLM 4.7 stays interpreter-only and never authors
// a deliverable), and an empty endpointId is always rejected.
// ---------------------------------------------------------------------------

const FORBIDDEN_BRAIN_ENDPOINT_PATTERN = /gemini|flash|glm/i;

function forbiddenBrainEndpointError(message) {
  const err = new Error(`ODA forbidden brain endpoint: ${message}`);
  err.code = 'ODA_FORBIDDEN_ENDPOINT';
  return err;
}

/**
 * Throws if `brain`'s endpointId may never author a deliverable. NO silent
 * downgrades: there is no fallback brain and no alternate-endpoint retry
 * here — callers must let a thrown error propagate.
 * @param {ODABrain} brain
 * @returns {ODABrain}
 */
export function assertBrainAllowed(brain) {
  const endpointId = brain && brain.endpointId;
  if (!endpointId) {
    throw forbiddenBrainEndpointError(`empty endpointId supplied for brain "${brain && brain.id}"`);
  }
  if (FORBIDDEN_BRAIN_ENDPOINT_PATTERN.test(endpointId)) {
    throw forbiddenBrainEndpointError(`endpointId "${endpointId}" matches a forbidden pattern (Gemini, Flash, or GLM) — GLM never authors deliverables`);
  }
  return brain;
}

// ---------------------------------------------------------------------------
// Observability — in-memory ring buffer of the last 100 brain calls.
// ---------------------------------------------------------------------------

const BRAIN_CALL_LOG_LIMIT = 100;
/** @type {ODABrainCallLogEntry[]} */
const brainCallLog = [];

/** @param {ODABrainCallLogEntry} entry */
function recordBrainCall(entry) {
  brainCallLog.push(entry);
  if (brainCallLog.length > BRAIN_CALL_LOG_LIMIT) brainCallLog.shift();
}

/** @returns {ODABrainCallLogEntry[]} A shallow copy of the ring buffer (oldest first). */
export function getBrainCallLog() {
  return brainCallLog.map((entry) => ({ ...entry }));
}

// ---------------------------------------------------------------------------
// Brain call — the entry point the live surface uses once the user has
// picked which brain authors the final document.
// ---------------------------------------------------------------------------

/**
 * Run a query against the caller-selected brain — the brain-layer
 * counterpart to models.js's workerCall(), used when the OPERATOR (rather
 * than the fixed skill-surface routing table) chooses which model authors
 * the final document. Mirrors workerCall's syncQuery invocation shape
 * exactly (odSessionId/query/systemPrompt/pluginIds/endpointId/
 * reasoningEffort) and its error handling: on failure the error is tagged
 * (here `err.odaBrain`) and rethrown as-is — there is NO retry against a
 * different endpoint.
 *
 * Temperature note: models.js's workerCall relies on ../ondemand.js's
 * syncQuery, which currently builds `modelConfigs` itself
 * (`{ fulfillmentPrompt: systemPrompt, temperature: 0.2 }`) and exposes no
 * caller-side temperature override. brainCall is scoped to this file only —
 * per this module's brief it must not modify ../ondemand.js — so it passes
 * systemPrompt through unchanged, exactly as workerCall does, and syncQuery's
 * own 0.2 temperature applies upstream; a 0.4 override would require
 * syncQuery itself to grow a temperature parameter.
 *
 * @param {object} args
 * @param {string} args.brainId        Brain id or alias — see resolveBrain().
 * @param {string} args.sessionId      OnDemand session id (odSessionId).
 * @param {string} args.query
 * @param {string} [args.systemPrompt]
 * @param {string[]} [args.pluginIds]
 * @returns {Promise<string>} The brain's answer text.
 */
export async function brainCall({ brainId, sessionId, query, systemPrompt, pluginIds = [] } = {}) {
  const brain = assertBrainAllowed(resolveBrain(brainId));

  const startedAt = Date.now();
  const ts = new Date(startedAt).toISOString();
  let ok = false;
  let chars = 0;
  try {
    const result = await syncQuery({
      odSessionId: sessionId,
      query,
      systemPrompt,
      pluginIds,
      endpointId: brain.endpointId,
      // reasoningEffort omitted entirely when the brain's value is null.
      ...(brain.reasoningEffort ? { reasoningEffort: brain.reasoningEffort } : {}),
    });
    ok = true;
    chars = typeof result === 'string' ? result.length : 0;
    return result;
  } catch (err) {
    err.odaBrain = brainId;
    throw err;
  } finally {
    recordBrainCall({
      ts,
      brainId: brain.id,
      endpointId: brain.endpointId,
      ok,
      durationMs: Date.now() - startedAt,
      chars,
    });
  }
}

// ---------------------------------------------------------------------------
// Observability / UI surface — used by the /api/oda/brains route (wired
// separately) and by BrainSelector.jsx's static fallback.
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   brains: Array<{id: string, label: string, endpointId: string, reasoningEffort: ('low'|'medium'|'max'|null), blurb: string}>,
 *   default: string,
 *   policy: string,
 * }}
 */
export function describeBrains() {
  return {
    brains: Object.values(BRAINS).map(({ id, label, endpointId, reasoningEffort, blurb }) => ({ id, label, endpointId, reasoningEffort, blurb })),
    default: DEFAULT_BRAIN,
    policy: 'GLM 4.7 interprets; selected brain authors the final document; no silent downgrades',
  };
}
