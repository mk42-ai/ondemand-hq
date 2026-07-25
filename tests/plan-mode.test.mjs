// plan-mode.test.mjs — Plan Mode gate chain contract tests (AUDIT.md RC-1..RC-6 fix verification). Run: node --test tests/plan-mode.test.mjs
//
// These are contract tests against the Plan Mode overhaul being landed by Agents 1-2.
// All module imports are dynamic and guarded so a missing export produces a clear
// diagnostic assert.fail instead of a suite crash. No network calls anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ODA_NEVER_PARK = '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const odaDir = path.join(repoRoot, 'server', 'oda');

/** Guarded dynamic import — fails the calling test with a clear message. */
async function importModule(rel, label) {
  try {
    return await import(path.join(odaDir, rel));
  } catch (err) {
    assert.fail(`Could not import ${label} (${rel}): ${err && err.message ? err.message : err}`);
  }
}

function requireExport(mod, name, label) {
  if (!mod || mod[name] === undefined) {
    assert.fail(`Missing export '${name}' from ${label} — has Agent 1/2's change landed?`);
  }
  return mod[name];
}

// ---------------------------------------------------------------------------
// 1. gates.js — clarification gate type
// ---------------------------------------------------------------------------
test('gates: clarification gate type exists and constructs', async () => {
  const gates = await importModule('gates.js', 'gates.js');
  const GATE_TYPES = requireExport(gates, 'GATE_TYPES', 'gates.js');
  const createGate = requireExport(gates, 'createGate', 'gates.js');

  assert.ok(
    GATE_TYPES.includes('clarification'),
    `GATE_TYPES must include 'clarification' — got: ${JSON.stringify(GATE_TYPES)}`
  );

  let gate;
  try {
    gate = createGate({
      gateType: 'clarification',
      promptOverride: 'Which audience?',
      options: ['Board', 'Public', 'Skip this question'],
    });
  } catch (err) {
    assert.fail(`createGate({gateType:'clarification',...}) threw: ${err.message}`);
  }

  assert.ok(gate && gate.gateId, 'clarification gate must have a gateId');
  assert.equal(gate.prompt, 'Which audience?', 'promptOverride must flow into gate.prompt');
  assert.deepEqual(
    gate.options,
    ['Board', 'Public', 'Skip this question'],
    'options must be preserved on the gate'
  );
  assert.equal(gate.status, 'open', 'freshly created gate must be open');
});

// ---------------------------------------------------------------------------
// 2. runStore.js — createRun persists depth + clarification fields
// ---------------------------------------------------------------------------
test('runStore: createRun persists depth + clarification fields', async () => {
  const runStore = await importModule('runStore.js', 'runStore.js');
  const createRun = requireExport(runStore, 'createRun', 'runStore.js');

  let run;
  try {
    run = createRun({ text: 'test run', externalUserId: 't', depth: 'full' });
  } catch (err) {
    assert.fail(`createRun({..., depth:'full'}) threw: ${err.message}`);
  }

  assert.ok(run && run.request, 'createRun must return a run with a request object');
  assert.equal(run.request.depth, 'full', "run.request.depth must persist as 'full'");
  assert.ok(
    Array.isArray(run.clarifications),
    'run.clarifications must be an array (Plan Mode clarification log)'
  );
  assert.ok(
    Array.isArray(run.pendingClarifications),
    'run.pendingClarifications must be an array (queued clarifying questions)'
  );
});

// ---------------------------------------------------------------------------
// 3. runStore.js — addGate emits question.required; gate resolution flow
// ---------------------------------------------------------------------------
test('runStore: addGate emits question.required and gate resolution flow works', async () => {
  const runStore = await importModule('runStore.js', 'runStore.js');
  const gates = await importModule('gates.js', 'gates.js');
  const createRun = requireExport(runStore, 'createRun', 'runStore.js');
  const transition = requireExport(runStore, 'transition', 'runStore.js');
  const addGate = requireExport(runStore, 'addGate', 'runStore.js');
  const resolveGate = requireExport(runStore, 'resolveGate', 'runStore.js');
  const createGate = requireExport(gates, 'createGate', 'gates.js');

  const run = createRun({ text: 'gate flow run', externalUserId: 't', depth: 'quick' });

  // Legal transition chain per the new contract: created → interpreting → planning
  assert.doesNotThrow(() => transition(run, 'interpreting'), "transition(run,'interpreting') must be legal");
  assert.doesNotThrow(() => transition(run, 'planning'), "transition(run,'planning') must be legal");

  let gate;
  try {
    gate = addGate(
      run,
      createGate({ gateType: 'clarification', promptOverride: 'Q1?', options: ['A', 'Skip this question'] })
    );
  } catch (err) {
    assert.fail(`addGate(run, clarificationGate) threw: ${err.message}`);
  }
  assert.ok(gate && gate.gateId, 'addGate must return the gate (with gateId)');

  // addGate must emit question.required as the latest run event.
  assert.ok(Array.isArray(run.events) && run.events.length > 0, 'run.events must be a non-empty array');
  const lastEvent = run.events.at(-1);
  assert.equal(
    lastEvent.type,
    'question.required',
    `last run event after addGate must be 'question.required' — got '${lastEvent && lastEvent.type}'`
  );
  assert.equal(
    lastEvent.data && lastEvent.data.prompt,
    'Q1?',
    "question.required event data.prompt must carry the gate prompt 'Q1?'"
  );

  // planning → waiting_for_user must be a legal transition.
  assert.doesNotThrow(
    () => transition(run, 'waiting_for_user'),
    "transition(run,'waiting_for_user') must be legal from 'planning'"
  );

  // Resolve the gate — the stored gate must leave 'open' status.
  try {
    resolveGate(run, gate.gateId, { approved: true, choice: 'A' });
  } catch (err) {
    assert.fail(`resolveGate(run, gateId, {approved:true, choice:'A'}) threw: ${err.message}`);
  }
  const stored = (run.gates || []).find((g) => g.gateId === gate.gateId);
  assert.ok(stored, 'resolved gate must still be present in run.gates');
  assert.notEqual(stored.status, 'open', `resolved gate status must not remain 'open' — got '${stored.status}'`);

  // waiting_for_user → executing must be a legal transition (engine resume).
  assert.doesNotThrow(
    () => transition(run, 'executing'),
    "transition(run,'executing') must be legal from 'waiting_for_user'"
  );
});

// ---------------------------------------------------------------------------
// 4. interpreter.js — heuristic control carries clarifying_questions array
// ---------------------------------------------------------------------------
test('interpreter: heuristic control carries clarifying_questions array', async () => {
  const interpreter = await importModule('interpreter.js', 'interpreter.js');
  const heuristicInterpret = requireExport(interpreter, 'heuristicInterpret', 'interpreter.js');

  let control;
  try {
    control = heuristicInterpret('Benchmark cash transfer programmes');
  } catch (err) {
    assert.fail(`heuristicInterpret(text) threw: ${err.message}`);
  }
  assert.ok(control && typeof control === 'object', 'heuristicInterpret must return a control object');
  assert.ok(
    Array.isArray(control.clarifying_questions),
    `control.clarifying_questions must be an array — got: ${typeof control.clarifying_questions}`
  );
});

// ---------------------------------------------------------------------------
// 5. interpreter.js — interpretRequest signature accepts depth
// ---------------------------------------------------------------------------
test('interpreter: interpretRequest signature accepts depth', async () => {
  const interpreter = await importModule('interpreter.js', 'interpreter.js');
  const interpretRequest = requireExport(interpreter, 'interpretRequest', 'interpreter.js');
  assert.equal(typeof interpretRequest, 'function', 'interpretRequest must be a function');
  assert.ok(
    interpretRequest.toString().includes('depth'),
    "interpretRequest's signature/body must reference 'depth' ({sessionId, text, attachmentsSummary, output, depth})"
  );
});

// ---------------------------------------------------------------------------
// 6. orchestrator.js — message + gate APIs exported
// ---------------------------------------------------------------------------
test('orchestrator: message + gate APIs exported', async () => {
  const orchestrator = await importModule('orchestrator.js', 'orchestrator.js');
  assert.equal(
    typeof orchestrator.handleRunMessage,
    'function',
    "orchestrator.js must export handleRunMessage (RC-5 mid-run message API) — missing or not a function"
  );
  assert.equal(
    typeof orchestrator.resolveGateAndContinue,
    'function',
    'orchestrator.js must export resolveGateAndContinue — missing or not a function'
  );
  assert.ok(
    orchestrator.PRE_EXECUTION_GATE,
    'orchestrator.js must still export PRE_EXECUTION_GATE (truthy)'
  );
  assert.equal(
    typeof orchestrator.startRun,
    'function',
    'orchestrator.js must export startRun — missing or not a function'
  );
});

// ---------------------------------------------------------------------------
// 7. routes.js — mid-run message route registered (source text check)
// ---------------------------------------------------------------------------
test('routes: mid-run message route registered', () => {
  const routesPath = path.join(odaDir, 'routes.js');
  let src;
  try {
    src = fs.readFileSync(routesPath, 'utf8');
  } catch (err) {
    assert.fail(`Could not read ${routesPath}: ${err.message}`);
  }
  assert.ok(
    src.includes('runs/:id/message'),
    "server/oda/routes.js must register the 'runs/:id/message' route (RC-5)"
  );
});

// ---------------------------------------------------------------------------
// 8. orchestrator.js source — raiseRunGate live again (RC-1)
// ---------------------------------------------------------------------------
test('orchestrator source: raiseRunGate is live again (RC-1)', () => {
  const orchestratorPath = path.join(odaDir, 'orchestrator.js');
  let src;
  try {
    src = fs.readFileSync(orchestratorPath, 'utf8');
  } catch (err) {
    assert.fail(`Could not read ${orchestratorPath}: ${err.message}`);
  }
  assert.ok(
    src.includes('raiseNextClarification'),
    "orchestrator.js must contain 'raiseNextClarification' (clarification chain driver, RC-1)"
  );
  assert.ok(
    /await raiseRunGate\(/.test(src),
    "orchestrator.js must contain a real 'await raiseRunGate(' call site (not just a definition) — RC-1 gate raising must be live"
  );
  assert.ok(
    src.includes('synthesizeFinalPrompt'),
    "orchestrator.js must contain 'synthesizeFinalPrompt' (final prompt synthesis after gate chain)"
  );
});
