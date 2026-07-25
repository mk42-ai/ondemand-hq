// orchestrator.js — the ODA application run engine (MIGRATION_MAP M1).
// Replaces the Claude `oda:oda` command: GLM 4.7 interpretation → pipeline plan →
// resumable approval gates → sequenced Sonnet 5 worker execution over verified
// handoffs → Thinker–Worker–Verifier gate per artifact → revision routed to the
// defect-OWNING skill → orchestrator synthesis. Every emitted event corresponds
// to real backend state (no timer-faked progress), and every status change goes
// through the runStore's validated transition graph.

import { createOdSession } from '../ondemand.js';
import { workerCall, interpreterCall, assertEndpointAllowed } from './models.js';
import { interpretRequest } from './interpreter.js';
import { getManifest } from './manifests.js';
import { validatePipeline, nextRunnableNodes } from './sequencing.js';
import { buildContextBundle } from './contextLoader.js';
import { buildHandoff } from './handoff.js';
import {
  transition, addArtifact, setArtifactStatus, addGate, resolveGate, addEvidence,
  addDecision, _flushSync,
} from './runStore.js';
import { emitRunEvent } from './events.js';
import { verifyArtifact, planRevision, REVISE_POLICY, shouldEscalate } from './verifier.js';
import { createGate, GATE_DEFS } from './gates.js';
// Live-render upgrade (2026-07-22): GLM 4.7 slide director + selectable final-
// document brain + mandatory downloadable artifact + terminal ASCII banner.
import { initLiveDeck, directorHooks, isSubstantiveEvidence } from './liveDeck.js';
import { resolveBrain, brainCall, DEFAULT_BRAIN, BRAINS } from './brains.js';
import { packageRunArtifact } from './autoArtifact.js';
import { streamAuthoringWithLiveFeed } from './liveStream.js';
import { printRunBanner, printRunFooter } from './asciiLogo.js';

/** Skill id → central model-config surface (models.js ODA_MODEL_ROUTING keys). */
const SKILL_SURFACE = Object.freeze({
  'problem-solve': 'problem-solving',
  benchmark: 'benchmarking',
  'data-scout': 'data-interpretation',
  model: 'model-construction',
  storyline: 'storyline',
  design: 'design',
  translate: 'translation',
  media: 'media',
});

/** Pre-execution approval gate per primary skill (FULL mode, M4). */
const PRE_EXECUTION_GATE = Object.freeze({
  'problem-solve': 'problem_definition',
  benchmark: 'scope_edit',
  model: 'model_structure',
  storyline: 'storyline',
  translate: 'english_before_arabic',
  design: 'scope_edit',
  media: 'scope_edit',
  'data-scout': 'scope_edit',
});

/** Default produced artifact (logicalId/type) per skill+route. */
function nodeArtifactSpec(node) {
  if (node.skill === 'storyline') {
    if (node.route === 'SUMMARY') return { logicalId: `${node.nodeId}-summary`, type: 'one-pager-summary', title: 'Executive one-pager (five zones)' };
    if (node.route === 'TITLES') return { logicalId: `${node.nodeId}-titles`, type: 'action-titles-md', title: 'Ranked action titles' };
    return { logicalId: `${node.nodeId}-storyline`, type: 'storyline-md', title: 'Storyline spec' };
  }
  const map = {
    'problem-solve': { type: 'workbook-md', title: 'Problem-solving workbook' },
    benchmark: { type: 'benchmark-report-md', title: 'Benchmarking report' },
    'data-scout': { type: 'insight-pack-md', title: 'Evidence pack (cited)' },
    model: { type: 'xlsx-model', title: 'Quantitative model spec' },
    design: { type: 'deck-html', title: 'Branded deck (HTML)' },
    translate: { type: 'markdown', title: 'Arabic deliverable' },
    media: { type: 'media-bilingual-md', title: 'Bilingual media deliverable' },
  };
  const m = map[node.skill] || { type: 'markdown', title: 'Deliverable' };
  return { logicalId: `${node.nodeId}-${node.skill}`, ...m };
}

/**
 * Deliverable length target (2026-07-24 product rule): a DECK is authored at
 * ~10 slides and a DOCUMENT at ~5 pages. Both final builders create one
 * slide/page per top-level "## " section, so the target is expressed in those
 * sections. Deliverables with a FIXED shape (one-pager, action titles, Excel
 * models/data) keep their native size and take no target. Depth must come from
 * real analysis, structure and stated assumptions — never from padded or
 * invented content (the shared no-invent rule still binds).
 */
const DECK_SIZING =
  'LENGTH TARGET — author a SUBSTANTIAL deck of AT LEAST 10 slides: after the "# " title, write 9–11 distinct '
  + '"## " section headings (each becomes one slide) and develop every section with real content — a short lead '
  + 'line plus bullets, a small table, or 3–4 big numbers. Do not compress the story into a handful of slides. '
  + 'Cite the source for every figure (hyperlinked entity name). Relevant photography is added automatically, so '
  + 'design slides that leave room for one supporting image. ';
const DOC_SIZING =
  'LENGTH TARGET — author a substantial document of ABOUT 5 pages: after the "# " title, write AT LEAST 5 distinct '
  + '"## " section headings (the document renders roughly one section per page) and develop each with real depth — '
  + 'multiple paragraphs and/or bullets, plus a table where it fits — never a single line per section. ';

const XLSX_LIGHT =
  'KEEP IT LIGHT — this is a quick data deliverable, not a report. Gather ONLY the key figures/series and lay '
  + 'them out as clean markdown tables with a source per row (ISO dates, real numbers). No narrative, no deep '
  + 'research — the spreadsheet file is generated downstream from these tables. ';

function deliverableSizing(spec) {
  const t = spec.type;
  if (['deck-html', 'deck-pptx', 'arabic-pptx'].includes(t)) return DECK_SIZING;
  // Data/model: a light, tables-only pass — the .xlsx is built by the terminal tool.
  if (['xlsx-model', 'xlsx-data'].includes(t)) return XLSX_LIGHT;
  // Other fixed-shape deliverables: their format defines their length.
  if (['one-pager-summary', 'action-titles-md', 'image'].includes(t)) return '';
  // Everything else ships as a multi-page document (→ PDF).
  return DOC_SIZING;
}

// Format-NEUTRAL label for the worker brief. The raw artifact type "deck-html"
// nudged the model into emitting a full HTML document (raw <!DOCTYPE> tags then
// rendered as slide text) — the brief must describe WHAT to make, never a markup.
const DELIVERABLE_LABEL = Object.freeze({
  'deck-html': 'slide deck', 'deck-pptx': 'slide deck', 'arabic-pptx': 'slide deck (Arabic)',
  'workbook-md': 'problem-solving workbook', 'benchmark-report-md': 'benchmarking report',
  'insight-pack-md': 'evidence pack', 'fast-facts-md': 'fast-facts brief', 'storyline-md': 'storyline',
  'one-pager-summary': 'one-page executive summary', 'action-titles-md': 'action titles',
  'media-bilingual-md': 'bilingual media pack', 'xlsx-model': 'quantitative model',
  'xlsx-data': 'data workbook', markdown: 'document', docx: 'document', pdf: 'document',
});
const labelFor = (type) => DELIVERABLE_LABEL[type] || 'document';

// MODEL ROUTING (2026-07-24): ALL node authoring (plus interpret and verify)
// runs on a FAST model; the CHOSEN model (UI Brain selection) is reserved for the
// LAST call — the terminal plugin that produces the final file (see autoArtifact).
// Claude endpoints DO accept plugins, so the chosen model can drive that call.
// This replaces the blanket opus-4.8 authoring enforcement; the no-GLM/forbidden
// guard is kept via assertEndpointAllowed.
const FAST_AUTHOR_BRAIN = (process.env.ODA_FAST_BRAIN && BRAINS[process.env.ODA_FAST_BRAIN]) ? process.env.ODA_FAST_BRAIN : 'sonnet-5';

/** Authoring model for every node — the fast model. The chosen model is applied
 *  only at the terminal plugin call in autoArtifact. */
function authoringModelFor() {
  return { brainId: FAST_AUTHOR_BRAIN, endpointId: BRAINS[FAST_AUTHOR_BRAIN].endpointId, reasoningEffort: 'low' };
}

/** Live-deck hooks accessor — re-attaches after resume/restart (functions don't persist). */
function liveOf(run) {
  if (!run._live || typeof run._live.onInterpreted !== 'function') {
    if (!run.liveDeck) initLiveDeck(run);
    run._live = directorHooks(run, { persist: () => _flushSync(run) });
  }
  return run._live;
}

/** Lazily create the run's OnDemand chat session (one per run). */
async function ensureSession(run) {
  if (!run.odSessionId) {
    run.odSessionId = await createOdSession(`oda-run-${run.runId}`, []);
    _flushSync(run);
  }
  return run.odSessionId;
}

/**
 * Start (or restart) the run engine for a run in status 'idle' | 'failed'.
 * Runs asynchronously; errors mark the run failed with run.failed emitted.
 */
export async function startRun(run) {
  try {
    // ---- 0. LIVE DECK + BRAIN + TERMINAL BANNER (live-render upgrade) ----
    // Brain: validated at run creation (routes.js); default sonnet-5. GLM 4.7
    // remains interpreter-only — the brain authors the final document.
    run.brain = run.brain || DEFAULT_BRAIN;
    initLiveDeck(run);
    const live = liveOf(run);
    printRunBanner({ runId: run.runId, brain: run.brain, intent: run.request.text });

    // ---- 1. INTERPRET (GLM 4.7 → control JSON; heuristic fallback never fails) ----
    transition(run, 'interpreting');
    const sessionId = await ensureSession(run);
    const { control, source } = await interpretRequest({
      sessionId,
      text: run.request.text,
      attachmentsSummary: (run.request.attachments || []).map((a) => a.artifactId || a.name || '').join(', '),
      output: run.request.output || 'auto',
    });
    run.intent = control.intent;
    run.mode = control.mode;
    run.control = control;
    emitRunEvent(run, 'request.interpreted', { control, source, safeStatus: control.safe_status });
    live.onInterpreted(control); // slide 1 fills from the REAL interpretation

    // ---- 2. PLAN (validate pipeline against sequencing rules) ----
    transition(run, 'planning');
    validatePipeline(control.pipeline); // throws on an illegal graph (interpreter already normalises)
    run.pipeline = control.pipeline;
    run.nodeStates = {};
    for (const node of run.pipeline) {
      run.nodeStates[node.nodeId] = { status: 'queued', attempts: 0 };
      emitRunEvent(run, 'skill.queued', { nodeId: node.nodeId, skill: node.skill, mode: node.mode, route: node.route || null });
    }
    emitRunEvent(run, 'pipeline.selected', {
      pipeline: run.pipeline, deliverables: control.deliverables,
      workspaceRenderer: control.workspace_renderer, mode: control.mode,
    });
    live.onPipelineSelected(run.pipeline); // slides 1→final + 4 plan preview
    _flushSync(run);

    // ---- 3. PRE-EXECUTION PLAN-MODE GATES (RC-1 fix, 2026-07-25) ----
    // FULL-depth runs park on real backend gates again: GLM clarifying
    // questions raise a resumable 'clarification' gate chain, and a
    // requires_user_gate interpretation with no questions raises the classic
    // pre-execution scope gate. Set ODA_NEVER_PARK=1 (or fast depth) to keep
    // the 2026-07-23 auto-approve behaviour — a recorded decision plus a
    // non-blocking notice, never a 'Waiting for you' stop.
    const NEVER_PARK = process.env.ODA_NEVER_PARK === '1';
    const effectiveDepth = run.request.depth === 'full' ? 'full' : run.request.depth === 'fast' ? 'fast' : control.mode;
    const questions = Array.isArray(control.clarifying_questions) ? control.clarifying_questions.filter((q) => q && q.question) : [];
    if (!NEVER_PARK && effectiveDepth === 'full' && questions.length > 0) {
      run.pendingClarifications = questions.map((q, i) => ({
        index: i,
        question: q.question,
        options: Array.isArray(q.options) && q.options.length ? q.options.slice(0, 4) : null,
        why: q.why || null,
        answer: null,
      }));
      run.clarifications = [];
      await raiseNextClarification(run); // parks the run in waiting_for_user
      _flushSync(run);
      return run; // engine resumes via resolveGateAndContinue
    }
    if (!NEVER_PARK && effectiveDepth === 'full' && control.requires_user_gate && questions.length === 0) {
      // No GLM questions but full mode wants a confirmation — raise the classic pre-execution scope gate.
      await raiseRunGate(run, {
        gateType: PRE_EXECUTION_GATE[control.primary_skill] || 'scope_edit',
        nodeId: run.pipeline[0]?.nodeId || null,
        payload: { intent: control.intent, pipeline: run.pipeline.map((n) => n.skill) },
      });
      _flushSync(run);
      return run;
    }
    // ODA_NEVER_PARK=1 or fast depth: keep the auto-approve decision + notice.
    if (control.requires_user_gate && control.mode === 'full') {
      const hasAttachments = (run.request.attachments || []).length > 0;
      addDecision(run, {
        summary: `Scope auto-approved (${hasAttachments ? 'attachments supplied as optional input' : 'no attachments — web-sourced evidence'}) — ODA_NEVER_PARK/fast-depth runs never park on scope confirmation`,
        decidedBy: 'system',
      });
      emitRunEvent(run, 'skill.progress', {
        nodeId: run.pipeline[0]?.nodeId || null,
        note: `notice: scope confirmation auto-approved (ODA_NEVER_PARK or fast depth) — pipeline engaging immediately${hasAttachments ? ' (attachments in context)' : ' on web-sourced evidence'}`,
        notice: 'auto_approved_scope_gate',
      });
    }

    // ---- 4. EXECUTE ----
    transition(run, 'executing');
    await executePipeline(run);
    return run;
  } catch (err) {
    failRun(run, err);
    return run;
  }
}

/** Raise a gate: park the run and emit question.required (M4). */
async function raiseRunGate(run, { gateType, nodeId = null, payload = null, promptOverride = null, options = null }) {
  const gate = createGate({ gateType, nodeId, payload, promptOverride, options });
  addGate(run, gate); // emits the enriched question.required frame
  // Clarification CHAINS raise the next question while the run is ALREADY
  // parked — a waiting_for_user → waiting_for_user self-move is illegal in the
  // runStore graph, so only transition when the run is not yet parked
  // (e2e-proven 2026-07-25: resolve-gate-1 500 ODA_ILLEGAL_TRANSITION).
  if (run.status !== 'waiting_for_user') {
    transition(run, 'waiting_for_user', { reason: `gate:${gateType}` });
  }
  _flushSync(run);
  return gate;
}

/**
 * Raise the NEXT unanswered clarifying question as a 'clarification' gate.
 * raiseRunGate parks the run and emits question.required; the chain advances
 * one question at a time via resolveGateAndContinue. Returns the raised gate,
 * or null when every pending clarification has been answered.
 */
async function raiseNextClarification(run) {
  const entry = (run.pendingClarifications || []).find((e) => e.answer === null);
  if (!entry) return null;
  return raiseRunGate(run, {
    gateType: 'clarification',
    nodeId: null,
    payload: { index: entry.index, why: entry.why, total: run.pendingClarifications.length },
    promptOverride: entry.question,
    options: entry.options ? [...entry.options, 'Skip this question'] : ['Answer in your own words', 'Skip this question'],
  });
}

/**
 * GLM 4.7 final-prompt synthesis: folds the user's clarification answers into
 * ONE optimised authoring brief. Best-effort — a synthesis failure never fails
 * the run; the pipeline simply continues with the original request.
 */
async function synthesizeFinalPrompt(run) {
  try {
    const sessionId = await ensureSession(run);
    const qa = (run.clarifications || []).filter((c) => c.answer && c.answer !== '(skipped)');
    const raw = await interpreterCall({
      sessionId,
      systemPrompt: 'You are the ODA prompt synthesiser. Given the original request, the routed pipeline and the user\'s clarification answers, emit ONE final optimised authoring prompt (plain text, ≤300 words, British English, answer-first, no preamble, no JSON). It must fold every clarification answer into concrete instructions for the authoring model.',
      query: `ORIGINAL REQUEST:\n${run.request.text}\n\nPIPELINE: ${run.pipeline.map((n) => n.skill).join(' → ')}\nMODE: ${run.mode}\n\nCLARIFICATIONS:\n${qa.map((c) => `Q: ${c.question}\nA: ${c.answer}`).join('\n')}`,
    });
    run.finalPrompt = String(raw || '').trim().slice(0, 4000) || null;
  } catch (err) {
    console.warn(`[oda-orchestrator] final-prompt synthesis failed (${err.message}) — continuing with the original request`);
    run.finalPrompt = null;
  }
  if (run.finalPrompt) emitRunEvent(run, 'skill.progress', { nodeId: null, note: 'final prompt synthesised from clarifications (GLM 4.7)', notice: 'final_prompt_ready', safeStatus: 'Optimising the brief from your answers' });
}

/**
 * Handle a free-text user message posted to a run (POST /runs/:id/message).
 * If a gate is open, the text resolves it as an edited answer (this is how a
 * typed clarification answer arrives); otherwise the note is recorded as an
 * assumption for the next stage.
 */
export async function handleRunMessage(run, text) {
  const open = (run.gates || []).find((g) => g.status === 'open');
  if (open) return resolveGateAndContinue(run, open.gateId, { approved: true, choice: null, edits: { text } });
  run.assumptions.push(`User note (mid-run): ${String(text).slice(0, 400)}`);
  emitRunEvent(run, 'skill.progress', { nodeId: run.currentNodeId || null, note: 'user note recorded for the next stage', notice: 'user_note' });
  _flushSync(run);
  return run;
}

/**
 * Resolve a gate and resume the engine. Approved/edited → continue execution;
 * rejected → the run returns to planning and parks (the client may cancel or
 * re-plan). This is the resumable-gate contract: state lives server-side.
 */
export async function resolveGateAndContinue(run, gateId, { approved, choice = null, edits = null }) {
  const gate = (run.gates || []).find((g) => g.gateId === gateId);
  if (!gate) { const e = new Error(`gate ${gateId} not found on run ${run.runId}`); e.status = 404; throw e; }
  if (gate.status !== 'open') { const e = new Error(`gate ${gateId} already ${gate.status}`); e.status = 409; throw e; }

  const status = edits ? 'edited' : approved ? 'approved' : 'rejected';
  resolveGate(run, gateId, { approved: status !== 'rejected', choice, edits });
  gate.status = status;
  addDecision(run, { summary: `Gate ${gate.gateType} ${status}${choice ? ` (${choice})` : ''}`, decidedBy: 'user' });

  if (status === 'rejected' && gate.gateType !== 'clarification') {
    transition(run, 'planning', { reason: 'gate rejected' });
    _flushSync(run);
    return run;
  }
  // Apply edits to the parked payload where relevant (scope/problem edits ride
  // into the next handoff as user-approved facts).
  if (edits && typeof edits === 'object') {
    run.assumptions.push(`User edit at ${gate.gateType}: ${JSON.stringify(edits).slice(0, 400)}`);
  }
  // Clarification chain: record the answer (a rejected clarification counts as
  // skipped), raise the next unanswered question, and — once all are answered —
  // synthesise the final optimised prompt (GLM 4.7) before execution resumes.
  if (gate.gateType === 'clarification') {
    const entry = (run.pendingClarifications || []).find((e) => e.index === (gate.payload?.index ?? -1));
    const answerText = (edits && edits.text) ? edits.text : (choice && !/^skip/i.test(choice) ? choice : null);
    if (entry) entry.answer = answerText || '(skipped)';
    run.clarifications = (run.pendingClarifications || []).filter((e) => e.answer !== null).map((e) => ({ question: e.question, answer: e.answer }));
    const next = await raiseNextClarification(run);
    if (next) { _flushSync(run); return run; } // stay parked on the next question
    await synthesizeFinalPrompt(run); // all answered → GLM final prompt
  }
  transition(run, 'executing', { reason: `gate ${gate.gateType} ${status}` });
  // Continue the engine ASYNCHRONOUSLY — the gate endpoint answers immediately
  // and the client follows progress on the SSE stream (same contract as
  // POST /runs). verification_findings gates resume the REVISION path.
  const continuation = (gate.gateType === 'verification_findings' && gate.nodeId)
    ? executePipeline(run, { reviseNodeId: choice === 'Override and proceed' ? null : gate.nodeId, overrideNodeId: choice === 'Override and proceed' ? gate.nodeId : null })
    : executePipeline(run);
  continuation.catch((err) => failRun(run, err));
  return run;
}

/** Mark a run failed (single funnel — always emits run.failed). */
function failRun(run, err, nodeId = null) {
  try {
    run.error = { message: err?.message || String(err), ...(nodeId ? { nodeId } : {}) };
    if (run.status !== 'failed') transition(run, 'failed', { error: run.error.message });
    emitRunEvent(run, 'run.failed', { error: run.error.message, nodeId, errorCode: err?.errorCode || err?.code });
    _flushSync(run);
  } catch (inner) {
    console.error(`[oda-orchestrator] failRun cascade on ${run.runId}: ${inner.message}`);
  }
}

/**
 * The pipeline executor: runs every runnable node (verification-gated — a node
 * becomes runnable only when its dependencies are completed WITH verified
 * artifacts), parallelising genuinely independent nodes, until the pipeline
 * completes, parks at a gate, or fails.
 */
async function executePipeline(run, { reviseNodeId = null, overrideNodeId = null } = {}) {
  // A verification_findings override: accept the draft as-is (user decision).
  if (overrideNodeId) {
    const ns = run.nodeStates[overrideNodeId];
    const draft = [...run.artifacts].reverse().find((a) => a.nodeId === overrideNodeId && a.status !== 'superseded');
    if (draft) {
      setArtifactStatus(run, draft.artifactId, 'verified', { status: 'passed', findings: [], overriddenByUser: true }); // emits verification.passed
    }
    if (ns) { ns.status = 'completed'; ns.completedAt = new Date().toISOString(); }
    emitRunEvent(run, 'skill.completed', { nodeId: overrideNodeId, overriddenByUser: true });
  }
  if (reviseNodeId) {
    const ns = run.nodeStates[reviseNodeId];
    if (ns) ns.status = 'queued'; // re-run the node through the revise path
  }

  for (;;) {
    if (run.status === 'cancelled' || run.status === 'failed') return;
    if (run.status === 'waiting_for_user') return; // a mid-run gate parked us
    const runnable = nextRunnableNodes(run.pipeline, run.nodeStates, run.artifacts);
    if (!runnable.length) break;
    // ROOT_CAUSES Problem 2 fix (2026-07-25): DEPTH-0 IS SEQUENTIAL. When more
    // than one ROOT node (no dependencies) is runnable, only the FIRST in
    // pipeline order executes this iteration — its evidence/analysis lands on
    // the run BEFORE the next root's brief is built, so a root benchmark can
    // no longer race ahead of problem definition. Dependent parallel branches
    // (shared dependsOn deeper in the graph) still execute concurrently.
    const roots = runnable.filter((n) => !(n.dependsOn || []).length);
    let batch = runnable;
    if (roots.length > 1) {
      const firstRoot = run.pipeline.find((n) => roots.some((r) => r.nodeId === n.nodeId));
      batch = firstRoot ? [firstRoot] : [roots[0]];
      emitRunEvent(run, 'skill.progress', {
        nodeId: batch[0].nodeId,
        note: `sequential depth-0: ${batch[0].skill} runs first; ${roots.length - 1} sibling root(s) queued behind it`,
        notice: 'sequential_depth0',
      });
    }
    const results = await Promise.allSettled(batch.map((node) => executeNode(run, node)));
    const firstFailure = results.find((r) => r.status === 'rejected');
    if (firstFailure) { failRun(run, firstFailure.reason); return; }
    if (['waiting_for_user', 'cancelled', 'failed'].includes(run.status)) return;
  }

  const unfinished = Object.entries(run.nodeStates).filter(([, s]) => !['completed', 'skipped'].includes(s.status));
  if (unfinished.length) {
    // Nothing runnable but nodes remain → a dependency failed verification and
    // parked at a gate, or the graph stalled; if no open gate, that is a fault.
    if ((run.gates || []).some((g) => g.status === 'open')) return;
    failRun(run, new Error(`pipeline stalled: nodes ${unfinished.map(([id]) => id).join(', ')} not runnable and no open gate`));
    return;
  }

  await completeRun(run);
}

/** Execute ONE pipeline node end to end: brief → worker → verify → (revise loop). */
async function executeNode(run, node) {
  const ns = run.nodeStates[node.nodeId];
  ns.status = 'running';
  ns.startedAt = new Date().toISOString();
  ns.attempts = (ns.attempts || 0) + 1;
  emitRunEvent(run, 'skill.started', { nodeId: node.nodeId, skill: node.skill, mode: node.mode, route: node.route || null, attempt: ns.attempts });

  const sessionId = await ensureSession(run);
  const surface = SKILL_SURFACE[node.skill];
  const manifest = getManifest(node.skill).manifest;
  run.currentNodeId = node.nodeId;

  // ---- Typed handoff (M§6): inputs are the dependencies' verified artifacts ----
  const depArtifacts = (node.dependsOn || [])
    .map((depId) => [...run.artifacts].reverse().find((a) => a.nodeId === depId && a.status === 'verified'))
    .filter(Boolean);
  const sourceSkill = node.dependsOn?.length
    ? (run.pipeline.find((n) => n.nodeId === node.dependsOn[0])?.skill || 'oda')
    : 'oda';
  const spec = nodeArtifactSpec(node);
  const definitionOfDone = [
    `Produce the ${spec.title} (${spec.type}) satisfying the objective`,
    'Obey every shared ODA execution rule (voice, no-invent, tagging, sourcing, entity verification, partnership framing)',
    ...(manifest.verificationPolicy.checks || []).map((c) => `Pass check: ${c}`),
  ];
  const handoff = buildHandoff({
    run,
    sourceSkill,
    targetSkill: node.skill,
    objective: node.objective || run.intent || run.request.text,
    definitionOfDone,
    inputs: depArtifacts.map((a) => ({ artifactId: a.artifactId })),
    verifiedFacts: run.evidence.filter((e) => e.tag === 'fact').map((e) => e.claim).slice(0, 20),
    assumptions: run.assumptions.slice(0, 20),
    unresolvedQuestions: (run.pendingClarifications || []).filter((e) => e.answer === null).map((e) => e.question),
    expectedOutputType: spec.type,
    mode: node.mode,
    userApproved: (run.gates || []).some((g) => g.status !== 'open' && g.status !== 'rejected'),
    route: node.route,
  });

  // ---- Selective context (M6) ----
  const { systemPrompt, contextBlock, loadedRefs } = buildContextBundle({
    run, node, handoff,
    attachments: run.request.attachments || [],
    projectMemory: [],
    stepHint: node.objective || '',
  });
  run.contextBundle = { sharedRulesDigest: 'shared-rules-v1', loadedRefs };
  emitRunEvent(run, 'skill.progress', { nodeId: node.nodeId, note: 'context assembled', loadedRefs, safeStatus: safeStatusFor(node) });

  // ---- WORKER (Sonnet 5 — the only author of deliverable content) ----
  const sizing = deliverableSizing(spec);
  // The GLM-synthesised brief (from the user's clarification answers) leads the
  // worker query when present — it is the authoritative statement of intent.
  const briefBlock = run.finalPrompt ? `--- OPTIMISED BRIEF (GLM 4.7, from user clarifications — authoritative) ---\n${run.finalPrompt}\n\n` : '';
  const query = `${briefBlock}${contextBlock}\n\n--- PRODUCE ---\nA ${labelFor(spec.type)} in mode ${node.mode.toUpperCase()}. Objective: ${handoff.objective}\n${sizing}Author the deliverable as MARKDOWN ONLY — a single "# " title then "## " section headings (each "## " renders as one slide/page), with "- " bullets and GitHub-style pipe tables where they add clarity. Do NOT output HTML, <tags>, <!DOCTYPE>, CSS or code fences — markdown only. Return ONLY the deliverable content — no preamble, no self-commentary; append a final "Self-report" section (what you did, assumed, could not resolve).`;
  // MODEL ROUTING (2026-07-24): the CHOSEN brain (UI selection, default opus-4.8)
  // authors ONLY the terminal deliverable node; every earlier node authors on a
  // fast model. GLM interprets; the terminal plugin call packages on a fast
  // plugin-compatible endpoint. assertEndpointAllowed still rejects GLM/forbidden
  // endpoints for the worker role — no silent downgrades to a non-author model.
  const author = authoringModelFor();
  run.enforcedBrain = author.brainId;
  assertEndpointAllowed(author.endpointId, 'worker');
  emitRunEvent(run, 'skill.progress', {
    nodeId: node.nodeId,
    note: `drafting on ${author.brainId} (${author.endpointId}) — fast model; your selected model builds the final file`,
    endpointId: author.endpointId,
    authoringBrain: author.brainId,
  });
  // Concurrent Cerebras live feed (2026-07-23): the authoring runs as a TOKEN
  // STREAM; every 200 tokens the chunk is dispatched to Cerebras in parallel and
  // its digest patches the live-render cards. Falls back to the blocking brainCall.
  let draftText;
  try {
    draftText = await streamAuthoringWithLiveFeed({
      run, node, sessionId, query, systemPrompt,
      endpointId: author.endpointId, reasoningEffort: author.reasoningEffort,
      persist: () => _flushSync(run),
    });
  } catch (streamErr) {
    console.warn(`[oda-live] streaming authoring failed (${streamErr.message}) — falling back to sync ${author.brainId} call`);
    try {
      draftText = await brainCall({ brainId: author.brainId, sessionId, query, systemPrompt });
    } catch (authErr) {
      // 2026-07-23: one extra spaced retry — the transport layer already
      // retries 401/403/5xx/network, so this only fires on longer blips.
      console.warn(`[oda-live] sync authoring failed too (${authErr.message}) — one spaced retry in 5s`);
      await new Promise((res) => setTimeout(res, 5000));
      draftText = await brainCall({ brainId: author.brainId, sessionId, query, systemPrompt });
    }
  }

  const artifact = addArtifact(run, {
    logicalId: spec.logicalId, type: spec.type, title: spec.title,
    producedBy: node.skill, nodeId: node.nodeId,
    content: draftText, preview: String(draftText).slice(0, 800),
  });
  emitRunEvent(run, 'artifact.preview.updated', { artifactId: artifact.artifactId, preview: artifact.preview });

  // Evidence extraction (structured state, not prose): record tagged facts the
  // worker declared, if any, as evidence items (best-effort, non-fatal).
  for (const m of String(draftText).matchAll(/\*\*(?:tagged )?fact\*\*[:\s—-]*(.{10,180}?)(?:\n|$)/gi)) {
    const claim = m[1].trim();
    if (!isSubstantiveEvidence(claim)) continue; // meta/status lines never pollute run.evidence
    const evItem = addEvidence(run, { claim, tag: 'fact', addedBy: node.skill, nodeId: node.nodeId }); // emits evidence.added
    liveOf(run).onEvidence(evItem); // slide 2 fills from REAL evidence state
  }

  // GLM 4.7 slide director: slides 3+4 fill from the REAL draft artifact.
  try {
    await liveOf(run).onArtifactPreview(artifact, { interpreterCall, sessionId });
  } catch (dirErr) {
    console.warn(`[oda-live] slide director skipped: ${dirErr.message}`);
  }

  // ---- VERIFIER (Sonnet 5, surface 'verification'; independent per policy) ----
  await verifyNodeArtifact(run, node, artifact, definitionOfDone, manifest);
}

function safeStatusFor(node) {
  return {
    'data-scout': 'Gathering evidence',
    benchmark: 'Gathering evidence',
    'problem-solve': 'Structuring the analysis',
    model: 'Building the model',
    storyline: 'Preparing your document',
    design: 'Designing the deliverable',
    translate: 'Translating the document',
    media: 'Preparing your document',
  }[node.skill] || 'Understanding the request';
}

/** Verification + defect-owned revision loop for one node's artifact (M7). */
async function verifyNodeArtifact(run, node, artifact, definitionOfDone, manifest) {
  const ns = run.nodeStates[node.nodeId];
  const sessionId = await ensureSession(run);

  // VERIFICATION BY DEPTH (2026-07-24): the verifier is a full Sonnet pass +
  // revise loop (the slowest stage). FAST depth SKIPS it for speed; FULL depth
  // KEEPS it (the no-invent / sourcing / brand quality gate). Override with
  // ODA_VERIFY=1 (always verify) or ODA_VERIFY=0 (never verify). When skipped the
  // artifact ships immediately as verified with a recorded 'skipped' note.
  const verifyOn = process.env.ODA_VERIFY === '1' ? true
    : process.env.ODA_VERIFY === '0' ? false
    : (node.mode === 'full');
  if (!verifyOn) {
    setArtifactStatus(run, artifact.artifactId, 'verified', {
      status: 'skipped', artifactId: artifact.artifactId, nodeId: node.nodeId,
      verifiedAt: new Date().toISOString(), findings: [],
      note: 'verification skipped (speed mode; set ODA_VERIFY=1 to enable)',
    });
    addDecision(run, { summary: `Verification skipped for ${artifact.artifactId} (speed mode) — set ODA_VERIFY=1 to restore the no-invent quality gate`, decidedBy: 'system' });
    liveOf(run).onVerificationPassed(artifact.artifactId);
    ns.status = 'completed';
    ns.completedAt = new Date().toISOString();
    emitRunEvent(run, 'skill.completed', { nodeId: node.nodeId, skill: node.skill, artifactId: artifact.artifactId });
    _flushSync(run);
    return;
  }

  for (let round = 0; ; round++) {
    ns.status = 'verifying';
    transition(run, 'verifying');
    setArtifactStatus(run, artifact.artifactId, 'verifying'); // emits verification.started

    // 2026-07-23 (incident 2bc9fe01): the verifier INFRASTRUCTURE call is
    // guarded — a thrown 401/403/timeout/network error must NEVER hard-kill
    // the run. The artifact ships as verified/'passed_unverified' with an
    // honest decision + non-blocking notice, and the pipeline continues
    // (never-park rule). A verifier that RAN and returned findings keeps the
    // existing pass/revise/ship machinery below.
    let findings;
    try {
      findings = await verifyArtifact({
        artifact,
        definitionOfDone,
        checks: manifest.verificationPolicy.checks,
        sharedRules: 'Bundle hard rules apply: no-invent; fact/assumption/web tagging; WAM/u.ae entity verification; ODA voice; entity-name hyperlink sourcing; uppercase k/M/B/T units.',
        workerCall: (args) => workerCall({ ...args, sessionId }),
        independent: manifest.verificationPolicy.independentVerifier,
      });
    } catch (verifierErr) {
      const msg = verifierErr?.message || String(verifierErr);
      console.warn(`[oda-verify] verifier infrastructure error for ${artifact.artifactId}: ${msg} — shipping unverified (never fatal)`);
      addDecision(run, { summary: `Verifier unavailable for ${artifact.artifactId} (${msg}) — shipped unverified; runs never fail on verifier infrastructure errors`, decidedBy: 'system' });
      emitRunEvent(run, 'skill.progress', {
        nodeId: node.nodeId,
        note: `notice: verifier unavailable (${msg}) — shipping with unverified-findings note`,
        notice: 'verifier_unavailable',
        artifactId: artifact.artifactId,
        errorCode: verifierErr?.errorCode || null,
      });
      setArtifactStatus(run, artifact.artifactId, 'verified', {
        status: 'passed_unverified', artifactId: artifact.artifactId, nodeId: node.nodeId,
        verifiedAt: new Date().toISOString(), findings: [], infraError: msg,
        errorCode: verifierErr?.errorCode || verifierErr?.code || null,
      });
      liveOf(run).onVerificationPassed(artifact.artifactId);
      ns.status = 'completed';
      ns.completedAt = new Date().toISOString();
      emitRunEvent(run, 'skill.completed', { nodeId: node.nodeId, skill: node.skill, artifactId: artifact.artifactId });
      if (run.status === 'verifying') transition(run, 'executing');
      _flushSync(run);
      return;
    }
    findings.nodeId = node.nodeId;
    run.verification.push(findings);

    if (findings.status === 'passed') {
      setArtifactStatus(run, artifact.artifactId, 'verified', findings); // emits verification.passed
      liveOf(run).onVerificationPassed(artifact.artifactId);
      ns.status = 'completed';
      ns.completedAt = new Date().toISOString();
      emitRunEvent(run, 'skill.completed', { nodeId: node.nodeId, skill: node.skill, artifactId: artifact.artifactId });
      if (run.status === 'verifying') transition(run, 'executing');
      _flushSync(run);
      return;
    }

    // FAILED — route back to the defect-OWNING skill (never patch downstream).
    setArtifactStatus(run, artifact.artifactId, 'failed', findings); // emits verification.failed (full findings)

    if (shouldEscalate(round + 1)) {
      // ESCALATE (bundle cap reached). 2026-07-23: the run NEVER parks here —
      // the best artifact ships WITH its open findings recorded honestly
      // (decision + non-blocking notice) and the pipeline continues. This
      // removes the 'Waiting for you' dead-end entirely.
      addDecision(run, {
        summary: `Shipped ${artifact.artifactId} with ${findings.findings.length} open verification finding(s) — runs never park on verifier escalation`,
        decidedBy: 'system',
      });
      emitRunEvent(run, 'skill.progress', {
        nodeId: node.nodeId,
        note: `notice: shipped with ${findings.findings.length} open finding(s) — review recommended`,
        notice: 'shipped_with_open_findings',
        artifactId: artifact.artifactId,
      });
      setArtifactStatus(run, artifact.artifactId, 'verified', { ...findings, status: 'passed_with_findings' });
      liveOf(run).onVerificationPassed(artifact.artifactId);
      ns.status = 'completed';
      ns.completedAt = new Date().toISOString();
      emitRunEvent(run, 'skill.completed', { nodeId: node.nodeId, skill: node.skill, artifactId: artifact.artifactId });
      if (run.status === 'verifying') transition(run, 'executing');
      _flushSync(run);
      return;
    }

    // REVISE loop: each defect group goes to its owning skill's surface.
    // 2026-07-23: the revision authoring calls are guarded — an infrastructure
    // throw ships the CURRENT draft with its open findings instead of killing
    // the run (never-park, never-fatal).
    ns.status = 'revising';
    transition(run, 'revising');
    const groups = planRevision(findings, { producedBy: node.skill });
    let revisedText = artifact.content;
    const reviser = authoringModelFor(); // same fast model that authored this node
    try {
    for (const group of groups) {
      const owningSurface = SKILL_SURFACE[group.owningSkill] || SKILL_SURFACE[node.skill];
      emitRunEvent(run, 'skill.progress', { nodeId: node.nodeId, note: `revision by ${group.owningSkill}`, defects: group.findings.length });
      const { systemPrompt } = buildContextBundle({ run, node: { ...node, skill: group.owningSkill in SKILL_SURFACE ? group.owningSkill : node.skill }, handoff: null, attachments: [], projectMemory: [], stepHint: 'revision' });
      emitRunEvent(run, 'skill.progress', { nodeId: node.nodeId, note: `revision authoring on ${reviser.brainId} (${reviser.endpointId})`, endpointId: reviser.endpointId, owningSurface });
      revisedText = await brainCall({
        brainId: reviser.brainId,
        sessionId,
        systemPrompt,
        query: `--- ARTIFACT UNDER REVISION (${artifact.type}) ---\n${revisedText}\n\n--- VERIFIER FINDINGS (fix ONLY these; you own defects of your discipline) ---\n${group.findings.map((f, i) => `${i + 1}. [${f.severity}/${f.category}] at ${f.location}: ${f.message} → ${f.requiredAction}`).join('\n')}\n\nReturn the FULL corrected artifact content — no commentary.`,
      });
    }
    // New version of the same logical artifact; prior version preserved.
    artifact = addArtifact(run, {
      logicalId: artifact.logicalId, type: artifact.type, title: artifact.title,
      producedBy: node.skill, nodeId: node.nodeId,
      content: revisedText, preview: String(revisedText).slice(0, 800),
    });
    emitRunEvent(run, 'artifact.preview.updated', { artifactId: artifact.artifactId, preview: artifact.preview, revision: true });
    transition(run, 'executing'); // loop continues → verifying again
    } catch (revErr) {
      const msg = revErr?.message || String(revErr);
      console.warn(`[oda-revise] revision authoring unavailable for ${artifact.artifactId}: ${msg} — shipping current draft (never fatal)`);
      addDecision(run, { summary: `Revision authoring unavailable for ${artifact.artifactId} (${msg}) — shipped current draft with its open findings`, decidedBy: 'system' });
      emitRunEvent(run, 'skill.progress', {
        nodeId: node.nodeId,
        note: `notice: revision unavailable (${msg}) — shipping current draft with open findings`,
        notice: 'revision_unavailable',
        artifactId: artifact.artifactId,
      });
      setArtifactStatus(run, artifact.artifactId, 'verified', { ...findings, status: 'passed_with_findings', infraError: msg });
      liveOf(run).onVerificationPassed(artifact.artifactId);
      ns.status = 'completed';
      ns.completedAt = new Date().toISOString();
      emitRunEvent(run, 'skill.completed', { nodeId: node.nodeId, skill: node.skill, artifactId: artifact.artifactId });
      if (run.status === 'revising' || run.status === 'verifying') transition(run, 'executing');
      _flushSync(run);
      return;
    }
  }
}

/** Final synthesis (surface 'orchestrator-synthesis', Sonnet 5) + completion. */
async function completeRun(run) {
  const sessionId = await ensureSession(run);
  const verified = run.artifacts.filter((a) => a.status === 'verified');
  try {
    const synthesis = await brainCall({
      brainId: FAST_AUTHOR_BRAIN, // a short completion note — fast model, not the deep one
      sessionId,
      systemPrompt: 'You are the ODA orchestrator. Synthesise ONE short answer-first completion note (≤150 words, British English, ODA voice) telling the user what was produced, which artifacts are ready, and any assumptions to note. No new claims, no new figures.',
      query: `Request: ${run.request.text}\nIntent: ${run.intent}\nVerified artifacts:\n${verified.map((a) => `• ${a.title} (${a.type}, v${a.version})`).join('\n')}\nAssumptions: ${run.assumptions.join('; ') || '(none)'}`,
    });
    const summary = addArtifact(run, {
      logicalId: 'run-synthesis', type: 'markdown', title: 'Run synthesis',
      producedBy: 'oda', nodeId: 'oda', content: synthesis, preview: String(synthesis).slice(0, 800),
    });
    setArtifactStatus(run, summary.artifactId, 'verified', { status: 'passed', findings: [] });
  } catch (err) {
    // Synthesis failure does not un-verify delivered artifacts — complete honestly without it.
    console.warn(`[oda-orchestrator] synthesis failed on ${run.runId}: ${err.message}`);
  }
  // MANDATORY download URL (live-render upgrade): package the primary verified
  // artifact into a downloadable file BEFORE completing; surface it in the SSE
  // stream (artifact.download.ready + run.completed payload) and the run state.
  // The final document is authored by the OnDemand Agent plugin (hosted output),
  // which can take ~30–60s — keep the UI honest with a status ping first so the
  // completion step doesn't look hung.
  emitRunEvent(run, 'skill.progress', { nodeId: 'oda', safeStatus: 'Preparing your document', note: 'Generating the final document' });
  const pkg = await packageRunArtifact(run);
  if (pkg.downloadUrl) {
    emitRunEvent(run, 'artifact.download.ready', {
      artifactId: pkg.artifactId, downloadUrl: pkg.downloadUrl, format: pkg.format, bytes: pkg.bytes,
    });
  } else {
    console.warn(`[oda-live] packaging produced no download URL: ${pkg.reason}`);
  }
  liveOf(run).onRunCompleted({ downloadUrl: pkg.downloadUrl });
  transition(run, 'completed');
  run.timestamps.completedAt = new Date().toISOString();
  emitRunEvent(run, 'run.completed', {
    artifacts: run.artifacts.filter((a) => a.status === 'verified').map((a) => ({ artifactId: a.artifactId, type: a.type, title: a.title, version: a.version })),
    downloadUrl: pkg.downloadUrl || null,
    brain: run.brain || DEFAULT_BRAIN,
    durationMs: Date.parse(run.timestamps.completedAt) - Date.parse(run.timestamps.createdAt),
  });
  printRunFooter({ runId: run.runId, status: 'completed', downloadUrl: pkg.downloadUrl });
  _flushSync(run);
}

/**
 * Re-enter the engine after an explicit pause/resume (or process restart with a
 * hydrated run): continues executing queued nodes from durable state.
 */
export async function resumeEngine(run) {
  if (!['executing', 'verifying', 'revising'].includes(run.status)) return run;
  try {
    await executePipeline(run);
  } catch (err) {
    failRun(run, err);
  }
  return run;
}

export { SKILL_SURFACE, PRE_EXECUTION_GATE };
